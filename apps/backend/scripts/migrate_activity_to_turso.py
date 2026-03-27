#!/usr/bin/env python3
"""
Migrate screen activity data from local activity.db to Turso cloud.

Creates the context_snapshots, session_retrieval_docs, context_sessions,
and activity_events tables in Turso, then bulk-inserts all rows.

Usage:
    cd apps/backend
    python scripts/migrate_activity_to_turso.py

Environment:
    DATABASE_URL - Turso cloud URL (libsql://...)
    TURSO_LOCAL_ENCRYPTION_KEY - optional encryption key
"""

import os
import sys
import time
import sqlite3
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ACTIVITY_DB_PATH = os.path.expanduser("~/.ritual/activity.db")
TURSO_REPLICA_PATH = str(backend_dir / ".turso_replica.db")
DATABASE_URL = os.getenv("DATABASE_URL", "")
BATCH_SIZE = 500

# Tables to migrate (in dependency order)
TABLES_TO_MIGRATE = [
    "context_sessions",
    "activity_events",
    "context_snapshots",
    "session_retrieval_docs",
]

# ---------------------------------------------------------------------------
# Table DDL — exactly matching activity.db schema
# ---------------------------------------------------------------------------

TABLE_DDL = {
    "context_snapshots": """
        CREATE TABLE IF NOT EXISTS context_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            activity_event_id INTEGER,
            session_id INTEGER,
            ts INTEGER NOT NULL,
            source_type TEXT NOT NULL,
            app_bundle_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT,
            browser_url TEXT,
            browser_domain TEXT,
            tab_title TEXT,
            document_title TEXT,
            visible_text_raw TEXT NOT NULL DEFAULT '',
            visible_text_norm TEXT NOT NULL DEFAULT '',
            capture_quality REAL NOT NULL DEFAULT 0.0,
            dedup_key TEXT NOT NULL,
            is_sensitive_redacted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            capture_components_json TEXT,
            ax_richness_score REAL NOT NULL DEFAULT 0.0,
            selected_text_present INTEGER NOT NULL DEFAULT 0,
            document_path TEXT,
            ax_source TEXT,
            capture_trigger TEXT,
            trigger_to_snapshot_ms INTEGER,
            ui_elements_json TEXT
        )
    """,
    "context_snapshots_indexes": [
        "CREATE INDEX IF NOT EXISTS idx_cs_ts ON context_snapshots(ts)",
        "CREATE INDEX IF NOT EXISTS idx_cs_app_ts ON context_snapshots(app_bundle_id, ts)",
        "CREATE INDEX IF NOT EXISTS idx_cs_domain_ts ON context_snapshots(browser_domain, ts)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_cs_dedup ON context_snapshots(dedup_key)",
        "CREATE INDEX IF NOT EXISTS idx_cs_session_ts ON context_snapshots(session_id, ts)",
    ],
    "session_retrieval_docs": """
        CREATE TABLE IF NOT EXISTS session_retrieval_docs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL UNIQUE,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            source_kind TEXT NOT NULL DEFAULT 'context_session',
            chunk_start_ts INTEGER NOT NULL,
            chunk_end_ts INTEGER NOT NULL,
            app_name TEXT,
            browser_domain TEXT,
            window_title TEXT,
            document_title TEXT,
            raw_visible_text TEXT NOT NULL DEFAULT '',
            contextual_retrieval_text TEXT NOT NULL DEFAULT '',
            capture_quality REAL NOT NULL DEFAULT 0.0,
            context_version INTEGER NOT NULL DEFAULT 1,
            session_position INTEGER NOT NULL DEFAULT 0,
            session_count INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            embedded_at INTEGER DEFAULT NULL
        )
    """,
    "session_retrieval_docs_indexes": [
        "CREATE INDEX IF NOT EXISTS idx_srd_time ON session_retrieval_docs(chunk_start_ts, chunk_end_ts)",
    ],
    "context_sessions": """
        CREATE TABLE IF NOT EXISTS context_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            start_ts INTEGER NOT NULL,
            end_ts INTEGER NOT NULL,
            primary_app_bundle_id TEXT,
            primary_app_name TEXT,
            primary_domain TEXT,
            dominant_title TEXT,
            representative_text TEXT,
            coverage_score REAL NOT NULL DEFAULT 0.0,
            snapshot_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """,
    "context_sessions_indexes": [
        "CREATE INDEX IF NOT EXISTS idx_csess_time ON context_sessions(start_ts, end_ts)",
    ],
    "activity_events": """
        CREATE TABLE IF NOT EXISTS activity_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            app_bundle_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT,
            window_title_hash TEXT,
            window_owner_pid INTEGER,
            is_afk INTEGER NOT NULL DEFAULT 0,
            browser_url TEXT,
            browser_domain TEXT,
            is_incognito INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'ritual_watcher_v2',
            created_at INTEGER NOT NULL
        )
    """,
    "activity_events_indexes": [
        "CREATE INDEX IF NOT EXISTS idx_ae_ts_start ON activity_events(ts_start)",
        "CREATE INDEX IF NOT EXISTS idx_ae_ts_end ON activity_events(ts_end)",
        "CREATE INDEX IF NOT EXISTS idx_ae_device_ts ON activity_events(device_id, ts_start)",
        "CREATE INDEX IF NOT EXISTS idx_ae_device_ts_end ON activity_events(device_id, ts_end DESC)",
        "CREATE INDEX IF NOT EXISTS idx_ae_user_device_ts ON activity_events(user_id, device_id, ts_start)",
        "CREATE INDEX IF NOT EXISTS idx_ae_domain ON activity_events(browser_domain)",
    ],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_turso_conn():
    """Connect to Turso via the local replica (syncs to cloud)."""
    import libsql_experimental as libsql

    parsed = urlparse(DATABASE_URL)
    qs = parse_qs(parsed.query)
    auth_token = qs.get("authToken", [""])[0]
    sync_url = f"libsql://{parsed.hostname}"

    conn = libsql.connect(
        TURSO_REPLICA_PATH,
        sync_url=sync_url,
        auth_token=auth_token,
    )
    # Sync from cloud first to get current state
    conn.sync()
    return conn


def get_local_conn():
    """Connect to local activity.db (read-only)."""
    conn = sqlite3.connect(f"file:{ACTIVITY_DB_PATH}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def table_exists_turso(turso_conn, table_name: str) -> bool:
    """Check if a table exists in Turso."""
    result = turso_conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return (result[0] or 0) > 0


def count_rows(conn, table_name: str) -> int:
    """Count rows in a table."""
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    except Exception:
        return 0


def get_columns(conn, table_name: str) -> list:
    """Get column names for a table from local DB."""
    cursor = conn.execute(f"PRAGMA table_info({table_name})")
    return [row[1] for row in cursor.fetchall()]


# ---------------------------------------------------------------------------
# Migration
# ---------------------------------------------------------------------------

def create_tables(turso_conn):
    """Create all tables and indexes in Turso."""
    print("\n--- Creating tables in Turso ---")
    for table_name in TABLES_TO_MIGRATE:
        ddl = TABLE_DDL.get(table_name)
        if not ddl:
            continue

        exists = table_exists_turso(turso_conn, table_name)
        if exists:
            count = count_rows(turso_conn, table_name)
            print(f"  {table_name}: already exists ({count} rows)")
        else:
            turso_conn.execute(ddl)
            print(f"  {table_name}: created")

        # Create indexes
        indexes = TABLE_DDL.get(f"{table_name}_indexes", [])
        for idx_sql in indexes:
            try:
                turso_conn.execute(idx_sql)
            except Exception as e:
                if "already exists" not in str(e).lower():
                    print(f"    Warning: index failed: {e}")

    turso_conn.sync()
    print("  Tables synced to Turso cloud")


def migrate_table(local_conn, turso_conn, table_name: str, skip_existing: bool = True):
    """Migrate all rows from local table to Turso."""
    local_count = count_rows(local_conn, table_name)
    turso_count = count_rows(turso_conn, table_name)

    if skip_existing and turso_count >= local_count and turso_count > 0:
        print(f"  {table_name}: already migrated ({turso_count} rows in Turso, {local_count} local)")
        return 0

    columns = get_columns(local_conn, table_name)
    col_list = ", ".join(columns)
    placeholders = ", ".join(["?"] * len(columns))

    # If Turso already has some rows, only insert missing ones
    if turso_count > 0 and skip_existing:
        # Get max ID in Turso to resume
        max_id = turso_conn.execute(f"SELECT MAX(id) FROM {table_name}").fetchone()[0] or 0
        cursor = local_conn.execute(
            f"SELECT {col_list} FROM {table_name} WHERE id > ? ORDER BY id ASC",
            (max_id,),
        )
        print(f"  {table_name}: resuming from id > {max_id} ({turso_count} already in Turso)")
    else:
        cursor = local_conn.execute(f"SELECT {col_list} FROM {table_name} ORDER BY id ASC")

    inserted = 0
    failed = 0
    batch = []
    start = time.time()

    for row in cursor:
        batch.append(tuple(row))
        if len(batch) >= BATCH_SIZE:
            try:
                turso_conn.executemany(
                    f"INSERT OR IGNORE INTO {table_name} ({col_list}) VALUES ({placeholders})",
                    batch,
                )
                inserted += len(batch)
            except Exception as e:
                # Fall back to individual inserts
                for single_row in batch:
                    try:
                        turso_conn.execute(
                            f"INSERT OR IGNORE INTO {table_name} ({col_list}) VALUES ({placeholders})",
                            single_row,
                        )
                        inserted += 1
                    except Exception:
                        failed += 1
            batch = []

            if inserted % 5000 == 0:
                turso_conn.sync()
                elapsed = time.time() - start
                rate = inserted / elapsed if elapsed > 0 else 0
                print(f"    ... {inserted} inserted ({rate:.0f} rows/s)")

    # Final batch
    if batch:
        try:
            turso_conn.executemany(
                f"INSERT OR IGNORE INTO {table_name} ({col_list}) VALUES ({placeholders})",
                batch,
            )
            inserted += len(batch)
        except Exception:
            for single_row in batch:
                try:
                    turso_conn.execute(
                        f"INSERT OR IGNORE INTO {table_name} ({col_list}) VALUES ({placeholders})",
                        single_row,
                    )
                    inserted += 1
                except Exception:
                    failed += 1

    turso_conn.sync()
    elapsed = time.time() - start
    print(f"  {table_name}: {inserted} inserted, {failed} failed ({elapsed:.1f}s)")
    return inserted


def main():
    print("=" * 60)
    print("Migrate activity.db → Turso Cloud")
    print("=" * 60)
    print(f"  Source: {ACTIVITY_DB_PATH}")
    print(f"  Target: {DATABASE_URL[:60]}...")
    print(f"  Replica: {TURSO_REPLICA_PATH}")

    if not os.path.exists(ACTIVITY_DB_PATH):
        print(f"\nERROR: activity.db not found at {ACTIVITY_DB_PATH}")
        sys.exit(1)

    if not DATABASE_URL:
        print("\nERROR: DATABASE_URL not set")
        sys.exit(1)

    # Connect
    print("\nConnecting...")
    local_conn = get_local_conn()
    turso_conn = get_turso_conn()

    # Show local data summary
    print("\nLocal data summary:")
    for table in TABLES_TO_MIGRATE:
        count = count_rows(local_conn, table)
        print(f"  {table}: {count:,} rows")

    # Create tables
    create_tables(turso_conn)

    # Migrate each table
    total_start = time.time()
    total_inserted = 0
    for table in TABLES_TO_MIGRATE:
        print(f"\nMigrating {table}...")
        inserted = migrate_table(local_conn, turso_conn, table)
        total_inserted += inserted

    total_elapsed = time.time() - total_start

    # Verify
    print("\n--- Verification ---")
    for table in TABLES_TO_MIGRATE:
        local_count = count_rows(local_conn, table)
        turso_count = count_rows(turso_conn, table)
        match = "OK" if turso_count >= local_count else "MISMATCH"
        print(f"  {table}: local={local_count:,} turso={turso_count:,} [{match}]")

    print(f"\n{'=' * 60}")
    print(f"  Migration complete!")
    print(f"  Total inserted: {total_inserted:,}")
    print(f"  Duration: {total_elapsed:.1f}s")
    print(f"{'=' * 60}")

    local_conn.close()


if __name__ == "__main__":
    main()
