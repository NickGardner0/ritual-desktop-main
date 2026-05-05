#!/usr/bin/env python3
"""Backfill compact project-time rows and optionally purge raw cloud memory data.

This script intentionally requires an explicit database path and an explicit
purge confirmation. Dry-run mode is the default.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Iterable

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from services.project_time_service import (  # noqa: E402
    ATTRIBUTION_VERSION,
    _build_sessions,
    _counts_json,
    _date_from_ms,
    _ensure_schema,
    _load_rules,
    _rebuild_daily_rollups_for_dates,
)


RAW_TABLES = (
    "context_snapshots",
    "session_retrieval_docs",
    "memory_chunks",
    "memory_embedding_jobs",
)


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        (table_name,),
    ).fetchone()
    return row is not None


def count_table(conn: sqlite3.Connection, table_name: str) -> int:
    if not table_exists(conn, table_name):
        return 0
    return int(conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0] or 0)


def date_range(conn: sqlite3.Connection, table_name: str, column_name: str) -> tuple[int | None, int | None]:
    if not table_exists(conn, table_name):
        return None, None
    row = conn.execute(f"SELECT MIN({column_name}), MAX({column_name}) FROM {table_name}").fetchone()
    if not row:
        return None, None
    return row[0], row[1]


def estimate_raw_bytes(conn: sqlite3.Connection) -> int:
    total = 0
    for table in RAW_TABLES:
        if not table_exists(conn, table):
            continue
        try:
            for row in conn.execute(f"SELECT * FROM {table}"):
                total += len(json.dumps(dict(row), default=str))
        except Exception:
            total += count_table(conn, table) * 512
    return total


def iter_user_ranges(conn: sqlite3.Connection) -> Iterable[tuple[str, int, int]]:
    if not table_exists(conn, "activity_events"):
        return []
    rows = conn.execute(
        """
        SELECT user_id, MIN(ts_start) AS min_ts, MAX(ts_end) AS max_ts
        FROM activity_events
        WHERE user_id IS NOT NULL AND user_id != ''
        GROUP BY user_id
        """
    ).fetchall()
    return [(str(row["user_id"]), int(row["min_ts"]), int(row["max_ts"])) for row in rows if row["min_ts"] and row["max_ts"]]


def backfill_user(conn: sqlite3.Connection, user_id: str, start_ms: int, end_ms: int) -> dict:
    _ensure_schema(conn)
    rules = _load_rules(conn, user_id)
    rows = conn.execute(
        """
        SELECT id, event_uid, user_id, device_id, ts_start, ts_end, app_bundle_id,
               app_name, window_title, browser_domain, is_afk
        FROM activity_events
        WHERE user_id = ? AND ts_end > ? AND ts_start < ?
        ORDER BY ts_start ASC, id ASC
        """,
        (user_id, start_ms, end_ms),
    ).fetchall()
    sessions = _build_sessions(rows, rules, start_ms, end_ms)
    start_date = _date_from_ms(start_ms)
    end_date = _date_from_ms(max(start_ms, end_ms - 1))
    now = int(time.time() * 1000)

    conn.execute(
        "DELETE FROM project_time_sessions WHERE user_id = ? AND end_ts > ? AND start_ts < ?",
        (user_id, start_ms, end_ms),
    )
    conn.execute(
        "DELETE FROM project_time_daily_rollups WHERE user_id = ? AND date >= ? AND date <= ?",
        (user_id, start_date, end_date),
    )
    for session in sessions:
        conn.execute(
            """
            INSERT OR REPLACE INTO project_time_sessions (
                session_uid, user_id, device_id, date, timezone,
                start_ts, end_ts, active_ms, afk_ms,
                project_key, project_name, task_key, task_name,
                classification_source, confidence, status,
                apps_json, domains_json, artifacts_json, summary_text,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'local', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
            """,
            (
                session["session_uid"],
                user_id,
                session["device_id"],
                session["date"],
                session["start_ts"],
                session["end_ts"],
                session["active_ms"],
                session["project_key"],
                session["project_name"],
                session["task_key"],
                session["task_name"],
                session["classification_source"],
                session["confidence"],
                _counts_json(session["apps"]),
                _counts_json(session["domains"]),
                json.dumps(session["artifacts"][:20], separators=(",", ":")),
                session["summary_text"][:500],
                now,
                now,
            ),
        )
    _rebuild_daily_rollups_for_dates(conn, user_id, sorted({session["date"] for session in sessions}))
    return {"user_id": user_id, "sessions_written": len(sessions), "start_date": start_date, "end_date": end_date}


def purge_raw(conn: sqlite3.Connection) -> dict[str, int]:
    deleted: dict[str, int] = {}
    for table in RAW_TABLES:
        if not table_exists(conn, table):
            deleted[table] = 0
            continue
        deleted[table] = int(conn.execute(f"DELETE FROM {table}").rowcount or 0)
    return deleted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-path", required=True, help="Path to a user Turso replica or cloud-memory SQLite DB")
    parser.add_argument("--write", action="store_true", help="Write compact project_time_* rows from activity_events")
    parser.add_argument("--purge", action="store_true", help="Purge raw memory tables after backfill verification")
    parser.add_argument("--confirm-purge", default="", help='Must be exactly "PURGE_RAW_MEMORY" when --purge is used')
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser()
    if not db_path.exists():
        raise SystemExit(f"Database not found: {db_path}")
    if args.purge and args.confirm_purge != "PURGE_RAW_MEMORY":
        raise SystemExit('--purge requires --confirm-purge PURGE_RAW_MEMORY')

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        raw_counts = {table: count_table(conn, table) for table in RAW_TABLES}
        activity_start, activity_end = date_range(conn, "activity_events", "ts_start")
        report = {
            "db_path": str(db_path),
            "mode": "write" if args.write else "dry-run",
            "raw_counts": raw_counts,
            "estimated_raw_bytes": estimate_raw_bytes(conn),
            "activity_range": {
                "start_ts": activity_start,
                "end_ts": activity_end,
                "start_date": _date_from_ms(activity_start) if activity_start else None,
                "end_date": _date_from_ms(activity_end) if activity_end else None,
            },
            "backfill": [],
            "purge": None,
        }

        if args.write:
            for user_id, start_ms, end_ms in iter_user_ranges(conn):
                report["backfill"].append(backfill_user(conn, user_id, start_ms, end_ms))
            conn.commit()

        if args.purge:
            report["purge"] = purge_raw(conn)
            conn.commit()

        print(json.dumps(report, indent=2, sort_keys=True))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
