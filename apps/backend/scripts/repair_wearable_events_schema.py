#!/usr/bin/env python3
"""
Repair script for wearable_events schema corruption.

Fixes: "malformed database schema (idx_wearable_events_user_type_start) - no such table: main.wearable_events"

Modes:
  Local:  Fixes the local replica file (stop backend first).
          Use when local file is OK but schema is broken.
  Remote: Fixes the Turso cloud DB via HTTP, then quarantines the local replica.
          Use when local file is corrupted ("database disk image is malformed").

  python scripts/repair_wearable_events_schema.py          # try local
  python scripts/repair_wearable_events_schema.py --remote # fix cloud, then resync
"""

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

db_path = backend_dir / ".turso_replica.db"

INDEX_NAMES = [
    "idx_wearable_events_user_type_start",
    "idx_wearable_events_user_provider_external",
]

WEARABLE_EVENTS_TABLE = """
CREATE TABLE IF NOT EXISTS wearable_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    connection_id TEXT,
    source_id TEXT,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    provider_event_type TEXT,
    external_id TEXT,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    attributed_date TEXT,
    timezone TEXT,
    title TEXT,
    summary_value REAL,
    summary_unit TEXT,
    details_json TEXT,
    raw_payload_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(connection_id) REFERENCES wearable_connections(id),
    FOREIGN KEY(source_id) REFERENCES wearable_sources(id),
    FOREIGN KEY(raw_payload_id) REFERENCES wearable_raw_payloads(id)
)
"""

INDEX_SQLS = [
    "CREATE INDEX IF NOT EXISTS idx_wearable_events_user_type_start ON wearable_events (user_id, event_type, start_time)",
    "CREATE INDEX IF NOT EXISTS idx_wearable_events_user_provider_external ON wearable_events (user_id, provider, external_id)",
]

REMOTE_SQLS = [
    "DROP INDEX IF EXISTS idx_wearable_events_user_type_start",
    "DROP INDEX IF EXISTS idx_wearable_events_user_provider_external",
    WEARABLE_EVENTS_TABLE.strip(),
] + INDEX_SQLS


def run_local():
    """Repair local replica file directly."""
    print("🔧 Repairing local replica...")
    print("=" * 50)

    if not db_path.exists():
        print(f"❌ Database not found: {db_path}")
        sys.exit(1)

    try:
        conn = sqlite3.connect(str(db_path), timeout=10)
    except sqlite3.OperationalError as e:
        if "locked" in str(e).lower() or "busy" in str(e).lower():
            print("❌ Database is locked. Stop the backend and run again.")
        else:
            print(f"❌ Cannot connect: {e}")
        sys.exit(1)

    try:
        cursor = conn.cursor()
        conn.execute("PRAGMA writable_schema = 1")
        for name in INDEX_NAMES:
            cursor.execute("DELETE FROM sqlite_master WHERE type='index' AND name=?", (name,))
            if cursor.rowcount:
                print(f"  ✓ Removed {name}")
        conn.execute("PRAGMA writable_schema = 0")
        conn.commit()

        cursor.executescript(WEARABLE_EVENTS_TABLE)
        conn.commit()
        print("  ✓ Table created")

        for sql in INDEX_SQLS:
            cursor.execute(sql)
            conn.commit()
        print("  ✓ Indexes created")

        # Skip integrity_check - it can raise "disk image is malformed" if file is corrupt
        print("\n✅ Repair complete. Restart the backend.")
    except sqlite3.DatabaseError as e:
        conn.close()
        if "malformed" in str(e).lower():
            print(f"\n❌ Local file is corrupted: {e}")
            print("\n💡 Run with --remote to fix the cloud database and resync:")
            print("   python scripts/repair_wearable_events_schema.py --remote")
        else:
            print(f"\n❌ Error: {e}")
        sys.exit(1)
    except Exception as e:
        conn.close()
        print(f"\n❌ Error: {e}")
        sys.exit(1)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def run_remote():
    """Fix schema on Turso cloud via HTTP, then quarantine local replica."""
    from dotenv import load_dotenv
    load_dotenv(backend_dir / ".env")

    import httpx

    url = os.getenv("DATABASE_URL")
    if not url or "turso.io" not in url:
        print("❌ DATABASE_URL not set or invalid. Check backend/.env")
        sys.exit(1)

    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    auth_token = query.get("authToken", [None])[0]
    if not auth_token:
        print("❌ DATABASE_URL must include authToken.")
        sys.exit(1)

    pipeline_url = f"https://{parsed.netloc}/v2/pipeline"
    print("🔧 Repairing Turso cloud database...")
    print("=" * 50)

    requests = [
        {"type": "execute", "stmt": {"sql": sql}}
        for sql in REMOTE_SQLS
    ]
    requests.append({"type": "close"})

    try:
        resp = httpx.post(
            pipeline_url,
            headers={
                "Authorization": f"Bearer {auth_token}",
                "Content-Type": "application/json",
            },
            json={"requests": requests},
            timeout=30,
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        print(f"❌ Turso API error: {e.response.status_code} {e.response.text[:200]}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Request failed: {e}")
        sys.exit(1)

    # Check for SQL errors in response
    data = resp.json()
    for r in data.get("results", []):
        if "error" in r:
            print(f"❌ SQL error: {r['error']}")
            sys.exit(1)

    print("  ✓ Schema fixed on cloud")

    # Quarantine corrupted local replica
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    moved = []
    for f in [db_path, db_path.with_suffix(".db-wal"), db_path.with_suffix(".db-shm")]:
        if f.exists():
            dest = f.with_name(f"{f.name}.corrupt-{ts}")
            try:
                shutil.move(str(f), str(dest))
                moved.append(f.name)
            except Exception as e:
                print(f"  ⚠ Could not move {f.name}: {e}")

    if moved:
        print(f"  ✓ Quarantined local replica: {', '.join(moved)}")

    print("\n✅ Done. Restart the backend to resync a fresh local replica.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", action="store_true", help="Fix cloud DB via HTTP, then quarantine local replica")
    args = ap.parse_args()

    if args.remote:
        run_remote()
    else:
        run_local()
