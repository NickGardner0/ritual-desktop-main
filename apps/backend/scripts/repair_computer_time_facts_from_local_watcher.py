#!/usr/bin/env python
"""Repair Computer Time metric facts from local Watcher databases.

This script is intentionally append/update-only for the derived facts table. It
does not delete or mutate local watcher databases, remote watcher events, or
legacy habit logs.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from database.connection import init_database  # noqa: E402
from database.models import HabitDB  # noqa: E402
from services.metric_facts_service import FactDraft, MetricFactService, _target_unit  # noqa: E402
from services.watcher_service_computer_activity import (  # noqa: E402
    _aggregate_computer_activity_daily_totals_from_events_impl,
    _resolve_activity_user_ids,
)
from sqlalchemy import select  # noqa: E402
from database.connection import get_db_session  # noqa: E402


DEFAULT_RECOVERED_DB = Path.home() / ".ritual" / "activity.recovered.db"
DEFAULT_CURRENT_DB = Path.home() / ".ritual" / "activity.db"


def _default_range(days_back: int) -> tuple[str, str]:
    end = datetime.now().date()
    start = end - timedelta(days=max(1, int(days_back)) - 1)
    return start.isoformat(), end.isoformat()


def _range_ms(start_date: str, end_date: str) -> tuple[int, int]:
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _read_activity_rows(
    db_path: Path,
    *,
    activity_user_ids: list[str],
    start_ms: int,
    end_ms: int,
) -> tuple[list[tuple[Any, Any, Any, Any, Any]], dict[str, Any]]:
    if not db_path.exists():
        return [], {"path": str(db_path), "exists": False, "rows": 0}

    conn = sqlite3.connect(str(db_path))
    try:
        columns = _table_columns(conn, "activity_events")
        if not columns:
            return [], {"path": str(db_path), "exists": True, "rows": 0, "error": "missing_activity_events"}

        user_clause = ""
        params: list[Any] = [end_ms, start_ms]
        if "user_id" in columns and activity_user_ids:
            placeholders = ", ".join(["?"] * len(activity_user_ids))
            user_clause = f" AND user_id IN ({placeholders})"
            params.extend(activity_user_ids)

        rows = conn.execute(
            f"""
            SELECT
                ts_start,
                ts_end,
                COALESCE(is_afk, 0) AS is_afk,
                COALESCE(app_bundle_id, '') AS app_bundle_id,
                COALESCE(browser_domain, '') AS browser_domain
            FROM activity_events
            WHERE ts_start < ?
              AND ts_end > ?
              {user_clause}
              AND ts_end > ts_start
            ORDER BY ts_start ASC
            """,
            params,
        ).fetchall()
        return rows, {"path": str(db_path), "exists": True, "rows": len(rows)}
    finally:
        conn.close()


async def _load_habit(user_id: str, habit_id: str) -> HabitDB:
    async with get_db_session() as session:
        result = await session.execute(
            select(HabitDB).where(
                HabitDB.user_id == user_id,
                HabitDB.id == habit_id,
            )
        )
        habit = result.scalar_one_or_none()
        if habit is None:
            raise RuntimeError(f"Habit not found for user_id={user_id!r}, habit_id={habit_id!r}")
        return habit


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build Computer Time metric facts from local Watcher recovery databases.",
    )
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--habit-id", required=True)
    parser.add_argument("--days-back", type=int, default=3650)
    parser.add_argument("--start-date")
    parser.add_argument("--end-date")
    parser.add_argument("--recovered-db", default=str(DEFAULT_RECOVERED_DB))
    parser.add_argument("--current-db", default=str(DEFAULT_CURRENT_DB))
    parser.add_argument("--apply", action="store_true", help="Write derived metric facts. Default is dry-run.")
    args = parser.parse_args()

    await init_database()

    start_date, end_date = (
        (args.start_date, args.end_date)
        if args.start_date and args.end_date
        else _default_range(args.days_back)
    )
    start_ms, end_ms = _range_ms(start_date, end_date)
    activity_user_ids = _resolve_activity_user_ids(args.user_id)

    source_summaries: list[dict[str, Any]] = []
    combined_rows: list[tuple[Any, Any, Any, Any, Any]] = []
    for raw_path in [args.recovered_db, args.current_db]:
        rows, summary = _read_activity_rows(
            Path(raw_path).expanduser(),
            activity_user_ids=activity_user_ids,
            start_ms=start_ms,
            end_ms=end_ms,
        )
        source_summaries.append(summary)
        combined_rows.extend(rows)

    daily_rows = _aggregate_computer_activity_daily_totals_from_events_impl(
        combined_rows,
        start_ms,
        end_ms,
    )

    habit = await _load_habit(args.user_id, args.habit_id)
    unit = _target_unit(habit, "Hours")
    drafts = [
        FactDraft(
            user_id=args.user_id,
            habit_id=args.habit_id,
            habit_name=habit.name,
            metric_key="computer_time",
            date=str(row["day"])[:10],
            value=float(row.get("active_ms") or 0) / 3_600_000,
            unit=unit,
            source_family="watcher",
            provider="ritual_watcher_local_recovery",
            record_count=int(row.get("events_count") or 0),
            provenance={
                "aggregation": "local_watcher_recovery_deoverlap",
                "repair": "computer_time_fact_backfill",
                "source_databases": source_summaries,
                "activity_user_ids": activity_user_ids,
            },
        )
        for row in daily_rows
        if int(row.get("active_ms") or 0) > 0
    ]

    service = MetricFactService()
    run = await service._create_run(
        user_id=args.user_id,
        mode="apply" if args.apply else "dry_run",
        start_date=start_date,
        end_date=end_date,
        habit_ids=[args.habit_id],
        source_families=["watcher", "local_recovery"],
    )
    try:
        write_result = {"facts_written": 0, "facts_unchanged": len(drafts)}
        if args.apply:
            write_result = await service._upsert_fact_drafts(drafts, run_id=run.id)
        summary = service._summarize_drafts(drafts)
        await service._finish_run(
            run.id,
            status="success",
            facts_seen=len(drafts),
            facts_written=int(write_result["facts_written"]),
            facts_unchanged=int(write_result["facts_unchanged"]),
            legacy_fallback_count=0,
            summary=summary,
        )
    except Exception as exc:
        await service._finish_run(run.id, status="failed", error={"message": str(exc)})
        raise

    print(
        json.dumps(
            {
                "success": True,
                "dry_run": not args.apply,
                "run_id": run.id,
                "date_range": {"start_date": start_date, "end_date": end_date},
                "sources": source_summaries,
                "facts": {
                    "seen": len(drafts),
                    "written": write_result["facts_written"],
                    "unchanged": write_result["facts_unchanged"],
                },
                "summary": summary,
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
