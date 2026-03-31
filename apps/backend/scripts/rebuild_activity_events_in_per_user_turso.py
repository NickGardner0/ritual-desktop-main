#!/usr/bin/env python3
"""Wipe and fully rebuild activity_events in the current per-user Turso DB.

This is the brute-force recovery path for the split-user-id case where a
partial historical prefix already exists remotely and targeted backfills are
getting stuck or colliding on primary keys.

It:
  - reads local ~/.ritual/activity.db
  - selects rows for one or more local Clerk user ids
  - rewrites every copied row to the target Clerk user id
  - deletes remote activity_events first
  - bulk reinserts the full local set in large batches

Run this only while Ritual / ritual-watcher are stopped so no concurrent syncs
or fresh writes are happening.
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


TABLE_NAME = "activity_events"
BATCH_SIZE = 500
SYNC_EVERY = 50_000
PROGRESS_EVERY = 1_000


def _load_sync_config(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


def _connect_local_activity(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _connect_remote(sync_url: str, auth_token: str):
    replica_dir = (
        Path(tempfile.gettempdir())
        / f"ritual-activity-rebuild-{os.getpid()}-{int(time.time())}"
    )
    replica_dir.mkdir(parents=True, exist_ok=True)
    replica_path = replica_dir / "activity_rebuild_replica.db"
    conn = libsql.connect(str(replica_path), sync_url=sync_url, auth_token=auth_token)
    conn.sync()
    return conn


def _columns_sqlite(conn: sqlite3.Connection, table_name: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]


def _columns_libsql(conn, table_name: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]


def _count_local(conn: sqlite3.Connection, table_name: str, user_id: str) -> int:
    return int(
        conn.execute(
            f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ?",
            (user_id,),
        ).fetchone()[0]
        or 0
    )


def _count_remote(conn, table_name: str) -> int:
    return int(conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0] or 0)


def _remote_user_breakdown(conn, table_name: str) -> list[tuple[str, int]]:
    rows = conn.execute(
        f"SELECT user_id, COUNT(*) FROM {table_name} GROUP BY user_id ORDER BY COUNT(*) DESC"
    ).fetchall()
    return [(str(row[0]), int(row[1])) for row in rows]


def _build_union_cursor(
    local_conn: sqlite3.Connection,
    common_columns: list[str],
    source_user_ids: list[str],
):
    parts: list[str] = []
    params: list[str] = []
    col_list = ", ".join(common_columns)
    for user_id in source_user_ids:
        parts.append(
            f"SELECT {col_list} FROM {TABLE_NAME} WHERE user_id = ?"
        )
        params.append(user_id)
    sql = " UNION ALL ".join(parts) + " ORDER BY id ASC"
    return local_conn.execute(sql, tuple(params))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Wipe and rebuild activity_events in the current per-user Turso DB"
    )
    parser.add_argument("--user-id", required=True, help="Target Clerk user id")
    parser.add_argument(
        "--source-user-id",
        required=True,
        help="Historical Clerk user id to rewrite into --user-id",
    )
    parser.add_argument(
        "--include-target-user",
        action="store_true",
        help="Also include rows already owned by --user-id in local activity.db",
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
        help="Actually wipe and rebuild. Without this flag, the script only prints counts.",
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

    source_user_ids = [args.source_user_id]
    if args.include_target_user and args.user_id not in source_user_ids:
        source_user_ids.append(args.user_id)

    print("=" * 72)
    print("Full activity_events Rebuild")
    print("=" * 72)
    print(f"Target User:         {args.user_id}")
    print(f"Source User(s):      {', '.join(source_user_ids)}")
    print(f"Target DB:           {database_name}")
    print(f"Local DB:            {local_db_path}")
    print(f"Mode:                {'APPLY' if args.apply else 'DRY RUN'}")
    print()

    local_conn = _connect_local_activity(local_db_path)
    remote_conn = _connect_remote(sync_url, auth_token)
    start = time.time()

    try:
        local_columns = _columns_sqlite(local_conn, TABLE_NAME)
        remote_columns = _columns_libsql(remote_conn, TABLE_NAME)
        common_columns = [col for col in local_columns if col in remote_columns]
        if not common_columns:
            raise RuntimeError(f"No overlapping columns found for {TABLE_NAME}")

        user_id_index = next((i for i, col in enumerate(common_columns) if col == "user_id"), None)
        if user_id_index is None:
            raise RuntimeError("activity_events is missing user_id column overlap")

        local_total = sum(_count_local(local_conn, TABLE_NAME, user_id) for user_id in source_user_ids)
        remote_total = _count_remote(remote_conn, TABLE_NAME)
        remote_breakdown = _remote_user_breakdown(remote_conn, TABLE_NAME)

        print(f"Local rows selected: {local_total:,}")
        print(f"Remote rows before:  {remote_total:,}")
        print("Remote user breakdown before:")
        for user_id, count in remote_breakdown:
            print(f"  {user_id}: {count:,}")
        print()

        if not args.apply:
            print("Dry run only. Re-run with --apply to wipe and rebuild.")
            return 0

        print("Deleting remote activity_events...", flush=True)
        remote_conn.execute(f"DELETE FROM {TABLE_NAME}")
        remote_conn.commit()
        remote_conn.sync()
        close = getattr(remote_conn, "close", None)
        if callable(close):
            close()
        remote_conn = _connect_remote(sync_url, auth_token)
        print("Remote table cleared.", flush=True)

        column_list = ", ".join(common_columns)
        placeholders = ", ".join(["?"] * len(common_columns))
        insert_sql = f"INSERT INTO {TABLE_NAME} ({column_list}) VALUES ({placeholders})"
        cursor = _build_union_cursor(local_conn, common_columns, source_user_ids)

        inserted = 0
        failed = 0
        batch: list[tuple] = []

        for row in cursor:
            values = list(row)
            values[user_id_index] = args.user_id
            batch.append(tuple(values))

            if len(batch) >= BATCH_SIZE:
                try:
                    remote_conn.executemany(insert_sql, batch)
                    inserted += len(batch)
                except Exception:
                    for single_row in batch:
                        try:
                            remote_conn.execute(insert_sql, single_row)
                            inserted += 1
                        except Exception:
                            failed += 1
                batch = []

                if inserted > 0 and inserted % SYNC_EVERY == 0:
                    remote_conn.commit()
                    remote_conn.sync()
                    close = getattr(remote_conn, "close", None)
                    if callable(close):
                        close()
                    remote_conn = _connect_remote(sync_url, auth_token)

                if inserted > 0 and inserted % PROGRESS_EVERY == 0:
                    elapsed = time.time() - start
                    rate = inserted / elapsed if elapsed > 0 else 0
                    remaining = max(0, local_total - inserted)
                    eta = remaining / rate / 60 if rate > 0 else 0
                    print(
                        f"  {inserted:,}/{local_total:,} inserted "
                        f"({rate:.0f}/s, ~{eta:.1f}m left, failed={failed:,})",
                        flush=True,
                    )

        if batch:
            try:
                remote_conn.executemany(insert_sql, batch)
                inserted += len(batch)
            except Exception:
                for single_row in batch:
                    try:
                        remote_conn.execute(insert_sql, single_row)
                        inserted += 1
                    except Exception:
                        failed += 1

        remote_conn.commit()
        remote_conn.sync()

        final_remote_total = _count_remote(remote_conn, TABLE_NAME)
        print()
        print(
            f"Done. inserted={inserted:,} failed={failed:,} "
            f"final_remote_total={final_remote_total:,} elapsed={time.time() - start:.1f}s"
        )
        return 0
    finally:
        local_conn.close()
        close = getattr(remote_conn, "close", None)
        if callable(close):
            close()


if __name__ == "__main__":
    raise SystemExit(main())
