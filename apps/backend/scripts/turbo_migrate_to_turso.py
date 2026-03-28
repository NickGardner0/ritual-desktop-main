#!/usr/bin/env python3
"""
Turbo migration of activity.db tables to Turso cloud.

Uses executemany with large batches (10,000 rows) and syncs every 50,000 rows
for maximum throughput. ~10-50x faster than row-by-row migration.

Usage:
    cd apps/backend
    python scripts/turbo_migrate_to_turso.py
"""

import os, sqlite3, time, sys
import libsql_experimental as libsql
from urllib.parse import urlparse, parse_qs
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "")
parsed = urlparse(DATABASE_URL)
qs = parse_qs(parsed.query)
auth_token = qs.get("authToken", [""])[0]
sync_url = f"libsql://{parsed.hostname}"

ACTIVITY_DB = os.path.expanduser("~/.ritual/activity.db")

# Tuning knobs
BATCH_SIZE = 10_000       # rows per executemany call
SYNC_EVERY = 50_000       # rows between cloud syncs
PROGRESS_EVERY = 10_000   # rows between progress prints

TABLES = [
    "context_sessions",
    "context_snapshots",
    "session_retrieval_docs",
    "activity_events",
]


def migrate_table(turso, local, table_name: str):
    turso_count = turso.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    local_count = local.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]

    if turso_count >= local_count and turso_count > 0:
        print(f"  {table_name}: already done ({turso_count:,})")
        return 0

    cols = [c[1] for c in local.execute(f"PRAGMA table_info({table_name})").fetchall()]
    col_list = ", ".join(cols)
    placeholders = ", ".join(["?" for _ in cols])
    insert_sql = f"INSERT OR IGNORE INTO {table_name} ({col_list}) VALUES ({placeholders})"

    max_id = 0
    if turso_count > 0:
        max_id = turso.execute(f"SELECT MAX(id) FROM {table_name}").fetchone()[0] or 0

    remaining = local_count - turso_count
    print(f"  {table_name}: {turso_count:,} done, {remaining:,} remaining", flush=True)

    cursor = local.execute(
        f"SELECT {col_list} FROM {table_name} WHERE id > ? ORDER BY id ASC",
        (max_id,),
    )

    inserted = 0
    failed = 0
    start = time.time()
    batch = []

    for row in cursor:
        batch.append(tuple(row))

        if len(batch) >= BATCH_SIZE:
            try:
                turso.executemany(insert_sql, batch)
                inserted += len(batch)
            except Exception:
                # Fall back to individual inserts for this batch
                for single_row in batch:
                    try:
                        turso.execute(insert_sql, single_row)
                        inserted += 1
                    except Exception:
                        failed += 1
            batch = []

            if inserted % SYNC_EVERY == 0 and inserted > 0:
                turso.commit()
                turso.sync()

            if inserted % PROGRESS_EVERY == 0:
                elapsed = time.time() - start
                rate = inserted / elapsed if elapsed > 0 else 0
                left = remaining - inserted
                eta = left / rate / 60 if rate > 0 else 0
                print(
                    f"    {inserted:,}/{remaining:,} ({rate:.0f}/s, ~{eta:.1f}m left)",
                    flush=True,
                )

    # Final batch
    if batch:
        try:
            turso.executemany(insert_sql, batch)
            inserted += len(batch)
        except Exception:
            for single_row in batch:
                try:
                    turso.execute(insert_sql, single_row)
                    inserted += 1
                except Exception:
                    failed += 1

    turso.commit()
    turso.sync()

    elapsed = time.time() - start
    rate = inserted / elapsed if elapsed > 0 else 0
    final = turso.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    print(
        f"  {table_name}: done -- {inserted:,} inserted, {failed} failed "
        f"({elapsed:.0f}s, {rate:.0f}/s, total {final:,})",
        flush=True,
    )
    return inserted


def main():
    print("=" * 60, flush=True)
    print("Turbo Turso Migration (executemany + large batches)", flush=True)
    print("=" * 60, flush=True)
    print(f"  Source: {ACTIVITY_DB}")
    print(f"  Target: {sync_url}")
    print(f"  Batch size: {BATCH_SIZE:,}, sync every: {SYNC_EVERY:,}")

    if not os.path.exists(ACTIVITY_DB):
        print(f"\nERROR: {ACTIVITY_DB} not found")
        sys.exit(1)
    if not DATABASE_URL:
        print("\nERROR: DATABASE_URL not set")
        sys.exit(1)

    turso = libsql.connect(
        "/tmp/turso_turbo_migrate.db",
        sync_url=sync_url,
        auth_token=auth_token,
    )
    turso.sync()

    local = sqlite3.connect(f"file:{ACTIVITY_DB}?mode=ro", uri=True, timeout=5.0)
    local.row_factory = sqlite3.Row

    # Show current state
    print("\nCurrent state:")
    for table in TABLES:
        lc = local.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        tc = turso.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: local={lc:,}  turso={tc:,}  delta={lc - tc:,}")

    total_start = time.time()
    total_inserted = 0

    for table in TABLES:
        print(f"\n--- {table} ---", flush=True)
        total_inserted += migrate_table(turso, local, table)

    total_elapsed = time.time() - total_start

    # Final verification
    print(f"\n{'=' * 60}")
    print("Verification:")
    all_ok = True
    for table in TABLES:
        lc = local.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        tc = turso.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        status = "OK" if tc >= lc else "MISMATCH"
        if tc < lc:
            all_ok = False
        print(f"  {table}: local={lc:,}  turso={tc:,}  [{status}]")

    print(f"\n  Total inserted: {total_inserted:,}")
    print(f"  Duration: {total_elapsed:.0f}s ({total_elapsed / 60:.1f}m)")
    print(f"  Status: {'ALL TABLES VERIFIED' if all_ok else 'SOME TABLES INCOMPLETE'}")
    print(f"{'=' * 60}")

    local.close()


if __name__ == "__main__":
    main()
