#!/usr/bin/env python3
"""
Fast migration of activity.db tables to Turso cloud.
Batches 5,000 rows between syncs for ~10x speedup over row-by-row sync.
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
SYNC_EVERY = 5000  # rows between cloud syncs


def migrate_table(turso, local, table_name: str):
    turso_count = turso.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    local_count = local.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]

    if turso_count >= local_count and turso_count > 0:
        print(f"  {table_name}: already done ({turso_count:,})")
        return

    cols = [c[1] for c in local.execute(f"PRAGMA table_info({table_name})").fetchall()]
    col_list = ", ".join(cols)
    placeholders = ", ".join(["?" for _ in cols])

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

    for row in cursor:
        try:
            turso.execute(
                f"INSERT OR IGNORE INTO {table_name} ({col_list}) VALUES ({placeholders})",
                tuple(row),
            )
            inserted += 1
        except Exception:
            failed += 1

        if inserted % SYNC_EVERY == 0 and inserted > 0:
            turso.commit()
            turso.sync()
            elapsed = time.time() - start
            rate = inserted / elapsed if elapsed > 0 else 0
            left = remaining - inserted
            eta = left / rate / 60 if rate > 0 else 0
            print(
                f"    {inserted:,}/{remaining:,} ({rate:.0f}/s, ~{eta:.0f}m left)",
                flush=True,
            )

    turso.commit()
    turso.sync()
    elapsed = time.time() - start
    final = turso.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    print(f"  {table_name}: done — {inserted:,} inserted, {failed} failed ({elapsed:.0f}s, total {final:,})", flush=True)


def main():
    print("=" * 50, flush=True)
    print("Fast Turso Migration", flush=True)
    print("=" * 50, flush=True)

    turso = libsql.connect(
        "/tmp/turso_fast_migrate.db",
        sync_url=sync_url,
        auth_token=auth_token,
    )
    turso.sync()

    local = sqlite3.connect(f"file:{ACTIVITY_DB}?mode=ro", uri=True, timeout=5.0)
    local.row_factory = sqlite3.Row

    # Migrate in priority order
    for table in ["context_snapshots", "context_sessions", "activity_events"]:
        print(f"\n--- {table} ---", flush=True)
        migrate_table(turso, local, table)

    print("\n" + "=" * 50, flush=True)
    print("Migration complete!", flush=True)

    # Verify March 25 data
    mar25 = turso.execute(
        "SELECT COUNT(*) FROM context_snapshots WHERE date(ts/1000, 'unixepoch', 'localtime') = '2026-03-25'"
    ).fetchone()[0]
    print(f"context_snapshots for Mar 25: {mar25}", flush=True)


if __name__ == "__main__":
    main()
