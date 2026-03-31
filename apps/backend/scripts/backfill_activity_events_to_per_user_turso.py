#!/usr/bin/env python3
"""Backfill historical activity_events into the current per-user Turso DB.

This is a targeted alternative to the full per-user migration flow. It copies
rows from the local desktop activity.db into the currently configured per-user
Turso database from ~/.ritual/turso_sync.json while rewriting user_id to the
target Clerk user id.

It is designed for the historical split-user-id case where:
  - most old watcher history belongs to an older Clerk user id
  - newer rows belong to the current Clerk user id
  - the per-user Turso DB contains only an early prefix of activity_events

Usage:
  python3 apps/backend/scripts/backfill_activity_events_to_per_user_turso.py \
    --user-id <target-clerk-user-id> \
    --source-user-id <historical-clerk-user-id>

  python3 apps/backend/scripts/backfill_activity_events_to_per_user_turso.py \
    --user-id <target-clerk-user-id> \
    --source-user-id <historical-clerk-user-id> \
    --include-target-user \
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


TABLE_NAME = "activity_events"
WRITE_RETRY_LIMIT = 5
WRITE_RETRY_DELAY_SECONDS = 1.5
BATCH_SIZE = 200
SYNC_EVERY_ROWS = 5_000
PROGRESS_EVERY_ROWS = 1_000


def _is_retryable_write_error(error: Exception) -> bool:
    message = str(error).lower()
    return any(
        marker in message
        for marker in (
            "wal_insert_begin failed",
            "stream not found",
            "hrana",
            "404 not found",
            "database is locked",
            "sqlite_busy",
            "busy",
            "locked",
        )
    )


def _load_sync_config(path: Path) -> dict:
    with path.open() as f:
        return json.load(f)


def _connect_local_activity(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _connect_remote_replica(sync_url: str, auth_token: str):
    replica_dir = (
        Path(tempfile.gettempdir())
        / f"ritual-targeted-activity-backfill-{os.getpid()}-{int(time.time())}"
    )
    replica_dir.mkdir(parents=True, exist_ok=True)
    replica_path = replica_dir / "activity_backfill_replica.db"
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


def _max_remote_id(conn, table_name: str, user_id: str) -> int:
    row = conn.execute(
        f"SELECT COALESCE(MAX(id), 0) FROM {table_name} WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return int(row[0] or 0)


def _max_remote_id_within_limit(conn, table_name: str, user_id: str, max_id: int) -> int:
    row = conn.execute(
        f"SELECT COALESCE(MAX(id), 0) FROM {table_name} WHERE user_id = ? AND id <= ?",
        (user_id, max_id),
    ).fetchone()
    return int(row[0] or 0)


def _count_local_prefix(
    conn: sqlite3.Connection,
    table_name: str,
    user_id: str,
    max_id: int,
) -> int:
    row = conn.execute(
        f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ? AND id <= ?",
        (user_id, max_id),
    ).fetchone()
    return int(row[0] or 0)


def _count_remote_prefix(
    conn,
    table_name: str,
    user_id: str,
    max_id: int,
) -> int:
    row = conn.execute(
        f"SELECT COUNT(*) FROM {table_name} WHERE user_id = ? AND id <= ?",
        (user_id, max_id),
    ).fetchone()
    return int(row[0] or 0)


def _min_local_id(conn: sqlite3.Connection, table_name: str, user_id: str) -> int:
    row = conn.execute(
        f"SELECT COALESCE(MIN(id), 0) FROM {table_name} WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return int(row[0] or 0)


def _max_remote_id_lt(conn, table_name: str, user_id: str, upper_id: int) -> int:
    row = conn.execute(
        f"SELECT COALESCE(MAX(id), 0) FROM {table_name} WHERE user_id = ? AND id < ?",
        (user_id, upper_id),
    ).fetchone()
    return int(row[0] or 0)


def _max_remote_id_gte(conn, table_name: str, user_id: str, lower_id: int) -> int:
    row = conn.execute(
        f"SELECT COALESCE(MAX(id), 0) FROM {table_name} WHERE user_id = ? AND id >= ?",
        (user_id, lower_id),
    ).fetchone()
    return int(row[0] or 0)


def _copy_id_bounds(
    local_conn: sqlite3.Connection,
    remote_conn,
    source_user_id: str,
    target_user_id: str,
) -> tuple[int, int | None, int]:
    remote_before = _count_remote(remote_conn, TABLE_NAME, target_user_id)
    source_local_max_id = int(
        local_conn.execute(
            f"SELECT COALESCE(MAX(id), 0) FROM {TABLE_NAME} WHERE user_id = ?",
            (source_user_id,),
        ).fetchone()[0]
        or 0
    )
    source_local_min_id = _min_local_id(local_conn, TABLE_NAME, source_user_id)
    if source_local_max_id <= 0 or source_local_min_id <= 0:
        return 0, None, remote_before

    if source_user_id != target_user_id:
        target_local_min_id = _min_local_id(local_conn, TABLE_NAME, target_user_id)
        if (
            target_local_min_id > 0
            and target_local_min_id > source_local_max_id
        ):
            lower_exclusive = _max_remote_id_lt(
                remote_conn,
                TABLE_NAME,
                target_user_id,
                target_local_min_id,
            )
            upper_inclusive = source_local_max_id
            return min(lower_exclusive, upper_inclusive), upper_inclusive, remote_before

    if source_user_id == target_user_id:
        lower_exclusive = max(
            source_local_min_id - 1,
            _max_remote_id_gte(
                remote_conn,
                TABLE_NAME,
                target_user_id,
                source_local_min_id,
            ),
        )
        return min(lower_exclusive, source_local_max_id), source_local_max_id, remote_before

    remote_prefix_count = _count_remote_prefix(
        remote_conn,
        TABLE_NAME,
        target_user_id,
        source_local_max_id,
    )
    remote_prefix_max_id = _max_remote_id_within_limit(
        remote_conn,
        TABLE_NAME,
        target_user_id,
        source_local_max_id,
    )
    if remote_prefix_count <= 0 or remote_prefix_max_id <= 0:
        return 0, source_local_max_id, remote_before

    local_prefix_count = _count_local_prefix(
        local_conn,
        TABLE_NAME,
        source_user_id,
        remote_prefix_max_id,
    )
    if local_prefix_count == remote_prefix_count:
        return remote_prefix_max_id, source_local_max_id, remote_before
    return 0, source_local_max_id, remote_before


def _execute_with_retry(remote_conn, sql: str, values: tuple, sync_url: str, auth_token: str):
    last_error: Exception | None = None
    for attempt in range(1, WRITE_RETRY_LIMIT + 1):
        try:
            return remote_conn.execute(sql, values), remote_conn
        except Exception as error:
            last_error = error
            if not _is_retryable_write_error(error) or attempt == WRITE_RETRY_LIMIT:
                raise
            time.sleep(WRITE_RETRY_DELAY_SECONDS * attempt)
            close = getattr(remote_conn, "close", None)
            if callable(close):
                close()
            remote_conn = _connect_remote_replica(sync_url, auth_token)
    assert last_error is not None
    raise last_error


def _executemany_with_retry(remote_conn, sql: str, batch: list[tuple], sync_url: str, auth_token: str):
    last_error: Exception | None = None
    for attempt in range(1, WRITE_RETRY_LIMIT + 1):
        try:
            remote_conn.executemany(sql, batch)
            return remote_conn
        except Exception as error:
            last_error = error
            if not _is_retryable_write_error(error) or attempt == WRITE_RETRY_LIMIT:
                raise
            time.sleep(WRITE_RETRY_DELAY_SECONDS * attempt)
            close = getattr(remote_conn, "close", None)
            if callable(close):
                close()
            remote_conn = _connect_remote_replica(sync_url, auth_token)
    assert last_error is not None
    raise last_error


def _copy_from_source(
    local_conn: sqlite3.Connection,
    remote_conn,
    common_columns: list[str],
    source_user_id: str,
    target_user_id: str,
    *,
    apply: bool,
    sync_url: str,
    auth_token: str,
) -> tuple[dict, object]:
    local_count = _count_local(local_conn, TABLE_NAME, source_user_id)
    resume_after_id, upper_inclusive, remote_before = _copy_id_bounds(
        local_conn,
        remote_conn,
        source_user_id,
        target_user_id,
    )

    result = {
        "table": TABLE_NAME,
        "source_user_id": source_user_id,
        "target_user_id": target_user_id,
        "local_count": local_count,
        "remote_before": remote_before,
        "resume_after_id": resume_after_id,
        "upper_inclusive": upper_inclusive,
        "inserted": 0,
    }

    if not apply or local_count == 0:
        return result, remote_conn

    if upper_inclusive is None:
        remaining = 0
    else:
        remaining = max(0, upper_inclusive - max(0, resume_after_id))
    print(
        f"Starting {TABLE_NAME} copy from {source_user_id}: "
        f"local={local_count:,} "
        f"resume_after_id={resume_after_id:,} "
        f"upper_inclusive={upper_inclusive if upper_inclusive is not None else 'none'} "
        f"remaining_estimate={remaining:,}",
        flush=True,
    )

    user_id_index = next((idx for idx, col in enumerate(common_columns) if col == "user_id"), None)
    if user_id_index is None:
        raise RuntimeError("activity_events is missing user_id column overlap")

    column_list = ", ".join(common_columns)
    placeholders = ", ".join(["?"] * len(common_columns))
    insert_sql = f"INSERT OR IGNORE INTO {TABLE_NAME} ({column_list}) VALUES ({placeholders})"

    predicate = "user_id = ?"
    params: list[object] = [source_user_id]
    if resume_after_id > 0:
        predicate += " AND id > ?"
        params.append(resume_after_id)
    if upper_inclusive is not None:
        predicate += " AND id <= ?"
        params.append(upper_inclusive)

    cursor = local_conn.execute(
        f"""
        SELECT {column_list}
        FROM {TABLE_NAME}
        WHERE {predicate}
        ORDER BY id ASC
        """,
        tuple(params),
    )

    inserted = 0
    failed = 0
    since_sync = 0
    start = time.time()
    batch: list[tuple] = []

    def flush_batch(batch_rows: list[tuple]):
        nonlocal remote_conn, inserted, failed, since_sync
        if not batch_rows:
            return
        try:
            remote_conn = _executemany_with_retry(
                remote_conn,
                insert_sql,
                batch_rows,
                sync_url,
                auth_token,
            )
            inserted += len(batch_rows)
            since_sync += len(batch_rows)
            return
        except Exception:
            # Fall back to row-by-row only for the problematic batch.
            pass

        for values in batch_rows:
            try:
                _, remote_conn = _execute_with_retry(
                    remote_conn,
                    insert_sql,
                    values,
                    sync_url,
                    auth_token,
                )
                inserted += 1
                since_sync += 1
            except Exception:
                failed += 1

    for row in cursor:
        values = list(row)
        values[user_id_index] = target_user_id
        batch.append(tuple(values))

        if len(batch) >= BATCH_SIZE:
            flush_batch(batch)
            batch = []

            if inserted > 0 and inserted % PROGRESS_EVERY_ROWS == 0:
                elapsed = time.time() - start
                rate = inserted / elapsed if elapsed > 0 else 0
                remaining = max(0, local_count - inserted)
                eta_minutes = remaining / rate / 60 if rate > 0 else 0
                print(
                    f"    {source_user_id}: {inserted:,}/{local_count:,} copied "
                    f"({rate:.0f} rows/s, ~{eta_minutes:.1f}m left, failed={failed:,})",
                    flush=True,
                )

            if since_sync >= SYNC_EVERY_ROWS:
                remote_conn.commit()
                remote_conn.sync()
                close = getattr(remote_conn, "close", None)
                if callable(close):
                    close()
                remote_conn = _connect_remote_replica(sync_url, auth_token)
                since_sync = 0

    if batch:
        flush_batch(batch)

    remote_conn.commit()
    remote_conn.sync()

    result["inserted"] = inserted
    result["failed"] = failed
    return result, remote_conn


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill activity_events into per-user Turso")
    parser.add_argument("--user-id", required=True, help="Target Clerk user id")
    parser.add_argument(
        "--source-user-id",
        required=True,
        help="Historical Clerk user id to copy from while rewriting rows to --user-id",
    )
    parser.add_argument(
        "--include-target-user",
        action="store_true",
        help="Also copy any missing rows already owned by --user-id in the local DB",
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

    source_user_ids = [args.source_user_id]
    if args.include_target_user and args.user_id not in source_user_ids:
        source_user_ids.append(args.user_id)

    print("=" * 72)
    print("Targeted activity_events Backfill")
    print("=" * 72)
    print(f"Target User:         {args.user_id}")
    print(f"Source User(s):      {', '.join(source_user_ids)}")
    print(f"Target DB:           {database_name}")
    print(f"Local DB:            {local_db_path}")
    print(f"Include target tail: {'yes' if args.include_target_user else 'no'}")
    print(f"Mode:                {'APPLY' if args.apply else 'DRY RUN'}")
    print()

    start = time.time()
    local_conn = _connect_local_activity(local_db_path)
    remote_conn = _connect_remote_replica(sync_url, auth_token)
    try:
        local_columns = _columns_sqlite(local_conn, TABLE_NAME)
        remote_columns = _columns_libsql(remote_conn, TABLE_NAME)
        common_columns = [col for col in local_columns if col in remote_columns]
        if not common_columns:
            raise RuntimeError(f"No overlapping columns found for {TABLE_NAME}")

        remote_before_total = _count_remote(remote_conn, TABLE_NAME, args.user_id)
        results: list[dict] = []
        for source_user_id in source_user_ids:
            result, remote_conn = _copy_from_source(
                local_conn,
                remote_conn,
                common_columns,
                source_user_id,
                args.user_id,
                apply=args.apply,
                sync_url=sync_url,
                auth_token=auth_token,
            )
            results.append(result)
            print(
                f"{TABLE_NAME} from {source_user_id}: "
                f"local={result['local_count']:,} "
                f"remote_before={result['remote_before']:,} "
                f"resume_after_id={result['resume_after_id']:,} "
                f"inserted={result['inserted']:,} "
                f"failed={result.get('failed', 0):,}"
            )

        remote_after_total = _count_remote(remote_conn, TABLE_NAME, args.user_id)
        print()
        print(
            f"{TABLE_NAME}: remote_before_total={remote_before_total:,} "
            f"remote_after_total={remote_after_total:,} "
            f"net_added={max(0, remote_after_total - remote_before_total):,}"
        )
        print()
        print(f"Completed in {time.time() - start:.1f}s")
    finally:
        local_conn.close()
        close = getattr(remote_conn, "close", None)
        if callable(close):
            close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
