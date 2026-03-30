#!/usr/bin/env python3
"""Backfill only the missing context tables into the current per-user Turso DB.

This is a targeted alternative to the full per-user migration flow. It copies:
  - context_sessions
  - context_snapshots
  - session_retrieval_docs

from the local desktop activity.db into the currently configured per-user Turso
database from ~/.ritual/turso_sync.json.

Usage:
  python3 apps/backend/scripts/backfill_missing_context_to_per_user_turso.py \
    --user-id <target-clerk-user-id>

  python3 apps/backend/scripts/backfill_missing_context_to_per_user_turso.py \
    --user-id <target-clerk-user-id> \
    --source-user-id <historical-clerk-user-id> \
    --apply
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

import libsql_experimental as libsql


TABLES = (
    "context_sessions",
    "context_snapshots",
    "session_retrieval_docs",
)
SYNC_EVERY = 1000


def _load_sync_config(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


def _connect_local_activity(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _connect_remote_replica(sync_url: str, auth_token: str):
    replica_dir = Path(tempfile.gettempdir()) / "ritual-targeted-context-backfill"
    replica_dir.mkdir(parents=True, exist_ok=True)
    replica_path = replica_dir / "context_backfill_replica.db"
    conn = libsql.connect(str(replica_path), sync_url=sync_url, auth_token=auth_token)
    conn.sync()
    return conn


def _columns_sqlite(conn, table_name: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]


def _columns_libsql(conn, table_name: str) -> list[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return [row[1] for row in rows]


def _count_local(conn: sqlite3.Connection, table_name: str, user_id: str) -> int:
    row = conn.execute(
        f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return int(row[0] or 0)


def _count_remote(conn, table_name: str, user_id: str) -> int:
    row = conn.execute(
        f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return int(row[0] or 0)


def _copy_table(
    local_conn: sqlite3.Connection,
    remote_conn,
    table_name: str,
    source_user_id: str,
    target_user_id: str,
    *,
    apply: bool,
) -> dict:
    local_columns = _columns_sqlite(local_conn, table_name)
    remote_columns = _columns_libsql(remote_conn, table_name)
    common_columns = [col for col in local_columns if col in remote_columns]
    if not common_columns:
        raise RuntimeError(f"No overlapping columns found for {table_name}")

    local_count = _count_local(local_conn, table_name, source_user_id)
    remote_before = _count_remote(remote_conn, table_name, target_user_id)

    result = {
        "table": table_name,
        "local_count": local_count,
        "remote_before": remote_before,
        "inserted": 0,
        "remote_after": remote_before,
    }

    if not apply or local_count == 0:
        return result

    column_list = ", ".join(common_columns)
    placeholders = ", ".join(["?"] * len(common_columns))
    last_id = int(
        remote_conn.execute(
            f"SELECT COALESCE(MAX(id), 0) FROM {table_name} WHERE user_id = ?",
            (target_user_id,),
        ).fetchone()[0]
        or 0
    )

    inserted = 0
    cursor = local_conn.execute(
        f"""
        SELECT {column_list}
        FROM {table_name}
        WHERE user_id = ? AND id > ?
        ORDER BY id ASC
        """,
        (source_user_id, last_id),
    )

    user_id_index = next((idx for idx, col in enumerate(common_columns) if col == "user_id"), None)

    for row in cursor:
        values = list(row)
        if user_id_index is not None:
            values[user_id_index] = target_user_id
        remote_conn.execute(
            f"INSERT OR IGNORE INTO {table_name} ({column_list}) VALUES ({placeholders})",
            tuple(values),
        )
        inserted += 1
        if inserted % SYNC_EVERY == 0:
            remote_conn.commit()
            remote_conn.sync()

    remote_conn.commit()
    remote_conn.sync()

    result["inserted"] = inserted
    result["remote_after"] = _count_remote(remote_conn, table_name, target_user_id)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill missing context tables into per-user Turso")
    parser.add_argument("--user-id", required=True, help="Clerk user id to backfill")
    parser.add_argument(
        "--source-user-id",
        help="Optional historical Clerk user id to copy from while writing rows to --user-id",
    )
    parser.add_argument(
        "--local-db-path",
        default=str(Path.home() / ".ritual" / "activity.db"),
        help="Local activity.db path",
    )
    parser.add_argument(
        "--sync-config-path",
        default=str(Path.home() / ".ritual" / "turso_sync.json"),
        help="Path to desktop Turso sync config JSON",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually copy rows. Without this flag, the script only prints counts.",
    )
    args = parser.parse_args()

    sync_config_path = Path(args.sync_config_path).expanduser().resolve()
    local_db_path = Path(args.local_db_path).expanduser().resolve()

    if not sync_config_path.exists():
        print(f"Missing sync config: {sync_config_path}", file=sys.stderr)
        return 2
    if not local_db_path.exists():
        print(f"Missing local DB: {local_db_path}", file=sys.stderr)
        return 2

    sync_config = _load_sync_config(sync_config_path)
    sync_url = str(sync_config.get("sync_url") or "").strip()
    auth_token = str(sync_config.get("auth_token") or "").strip()
    database_name = str(sync_config.get("database_name") or "").strip()
    if not sync_url or not auth_token or not database_name:
        print("Sync config is missing sync_url/auth_token/database_name", file=sys.stderr)
        return 2

    source_user_id = (args.source_user_id or "").strip() or args.user_id

    print("=" * 72)
    print("Targeted Context Backfill")
    print("=" * 72)
    print(f"Target User:  {args.user_id}")
    print(f"Source User:  {source_user_id}")
    print(f"Target DB:    {database_name}")
    print(f"Local DB:     {local_db_path}")
    print(f"Mode:         {'APPLY' if args.apply else 'DRY RUN'}")
    print()

    start = time.time()
    local_conn = _connect_local_activity(local_db_path)
    remote_conn = _connect_remote_replica(sync_url, auth_token)

    try:
        results = []
        for table_name in TABLES:
            result = _copy_table(
                local_conn,
                remote_conn,
                table_name,
                source_user_id,
                args.user_id,
                apply=args.apply,
            )
            results.append(result)
            print(
                f"{table_name}: local={result['local_count']:,} "
                f"remote_before={result['remote_before']:,} "
                f"inserted={result['inserted']:,} "
                f"remote_after={result['remote_after']:,}"
            )
    finally:
        local_conn.close()
        close = getattr(remote_conn, "close", None)
        if callable(close):
            close()

    print()
    print(f"Completed in {time.time() - start:.1f}s")
    if not args.apply:
        print("Dry run only. Re-run with --apply to copy rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
