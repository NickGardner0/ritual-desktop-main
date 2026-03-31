"""Extracted activity-event and rollup analytics logic for WatcherService."""

from __future__ import annotations

import json
import os
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import delete, select, text

from database.models import (
    ActivityEventDB,
    DailyActivityRollupDB,
    WatcherDeviceDB,
    WatcherStateDB,
)
from services.watcher_service_local_db import (
    get_local_watcher_db_path_impl,
    open_activity_connection_for_user,
)
from services.watcher_service_computer_activity import (
    _aggregate_computer_activity_daily_rows_from_events_impl,
    _resolve_activity_user_ids,
    _sqlite_user_filter_clause,
)

logger = logging.getLogger(__name__)


def _rank_top_apps_from_daily_rows(
    daily_rows: List[Dict[str, Any]],
    limit: int,
    *,
    source: str,
) -> List[Dict[str, Any]]:
    grouped: Dict[tuple[str, str], Dict[str, Any]] = {}
    for row in daily_rows:
        app_bundle = str(row.get("app_bundle_id") or "unknown")
        app_name = str(row.get("app_name") or "Unknown")
        active_ms = int(row.get("active_ms", 0) or 0)
        if active_ms <= 0:
            continue

        key_tuple = (app_bundle, app_name)
        bucket = grouped.setdefault(
            key_tuple,
            {
                "app_bundle_id": app_bundle,
                "app_name": app_name,
                "total_active_ms": 0,
                "total_events": 0,
                "days_used": set(),
            },
        )
        bucket["total_active_ms"] += active_ms
        bucket["total_events"] += int(row.get("events_count", 0) or 0)
        day = str(row.get("day") or "")
        if day:
            bucket["days_used"].add(day)

    ranked = sorted(
        grouped.values(),
        key=lambda item: item["total_active_ms"],
        reverse=True,
    )[: max(1, int(limit or 10))]

    return [
        {
            "app_bundle_id": item["app_bundle_id"],
            "app_name": item["app_name"],
            "total_active_ms": int(item["total_active_ms"]),
            "total_events": int(item["total_events"]),
            "days_used": len(item["days_used"]),
            "hours": round(int(item["total_active_ms"]) / (1000 * 60 * 60), 2),
            "source": source,
        }
        for item in ranked
    ]


def _rank_top_domains_from_daily_rows(
    daily_rows: List[Dict[str, Any]],
    limit: int,
    *,
    source: str,
) -> List[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}
    for row in daily_rows:
        domain = str(row.get("browser_domain") or "").strip()
        active_ms = int(row.get("active_ms", 0) or 0)
        if not domain or active_ms <= 0:
            continue

        bucket = grouped.setdefault(
            domain,
            {
                "domain": domain,
                "total_active_ms": 0,
                "total_events": 0,
                "days_used": set(),
            },
        )
        bucket["total_active_ms"] += active_ms
        bucket["total_events"] += int(row.get("events_count", 0) or 0)
        day = str(row.get("day") or "")
        if day:
            bucket["days_used"].add(day)

    ranked = sorted(
        grouped.values(),
        key=lambda item: item["total_active_ms"],
        reverse=True,
    )[: max(1, int(limit or 10))]

    return [
        {
            "domain": item["domain"],
            "total_active_ms": int(item["total_active_ms"]),
            "total_events": int(item["total_events"]),
            "days_used": len(item["days_used"]),
            "hours": round(int(item["total_active_ms"]) / (1000 * 60 * 60), 2),
            "minutes": round(int(item["total_active_ms"]) / (1000 * 60), 1),
            "source": source,
        }
        for item in ranked
    ]


def _perf_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


def _log_activity_perf(
    operation: str,
    *,
    start: float,
    source: str,
    user_id: str,
    start_date: str,
    end_date: str,
    limit: int,
    row_count: int,
    empty_reason: Optional[str] = None,
) -> None:
    payload: Dict[str, Any] = {
        "operation": operation,
        "source": source,
        "user_id": user_id,
        "start_date": start_date,
        "end_date": end_date,
        "limit": limit,
        "row_count": row_count,
        "duration_ms": _perf_ms(start),
    }
    if empty_reason:
        payload["empty_reason"] = empty_reason
    logger.info("[Ritual][computer-activity] %s", payload)


async def record_activity_event_impl(
    service,
    device_id: str,
    user_id: str,
    app_bundle_id: str,
    app_name: str,
    window_title: Optional[str] = None,
    window_owner_pid: Optional[int] = None,
    is_afk: bool = False,
    ts_start: Optional[int] = None,
    ts_end: Optional[int] = None,
) -> Optional[int]:
    """Record a new activity event and return its id."""
    now_ms = service._now_ms()
    ts_start = ts_start or now_ms
    ts_end = ts_end or now_ms

    async with service._get_db_session() as session:
        result = await session.execute(
            select(WatcherStateDB).where(WatcherStateDB.device_id == device_id)
        )
        state = result.scalar_one_or_none()

        title_mode = state.title_mode if state else "off"
        truncate_length = state.truncate_length if state else 80

        processed_title = None
        title_hash = None

        if window_title and title_mode != "off":
            if title_mode == "full":
                processed_title = window_title
            elif title_mode == "truncate":
                processed_title = service._truncate_title(window_title, truncate_length)
            elif title_mode == "hash":
                title_hash = service._hash_title(window_title)

        excluded = []
        if state and state.excluded_bundle_ids:
            excluded = json.loads(state.excluded_bundle_ids)

        if app_bundle_id in excluded:
            return None

        event = ActivityEventDB(
            device_id=device_id,
            user_id=user_id,
            ts_start=ts_start,
            ts_end=ts_end,
            app_bundle_id=app_bundle_id,
            app_name=app_name,
            window_title=processed_title,
            window_title_hash=title_hash,
            window_owner_pid=window_owner_pid,
            is_afk=1 if is_afk else 0,
            source="ritual_watcher_v1",
            created_at=now_ms,
        )
        session.add(event)
        await session.commit()
        await session.refresh(event)

        return event.id


async def update_event_end_time_impl(service, event_id: int, ts_end: int) -> bool:
    """Update the end time of an activity event."""
    async with service._get_db_session() as session:
        result = await session.execute(
            select(ActivityEventDB).where(ActivityEventDB.id == event_id)
        )
        event = result.scalar_one_or_none()

        if not event:
            return False

        event.ts_end = ts_end
        await session.commit()
        return True


async def get_recent_events_impl(
    service,
    user_id: str,
    device_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """Get recent activity events."""
    async with service._get_db_session() as session:
        query = select(ActivityEventDB).where(ActivityEventDB.user_id == user_id)

        if device_id:
            query = query.where(ActivityEventDB.device_id == device_id)

        query = query.order_by(ActivityEventDB.ts_start.desc()).limit(limit).offset(offset)

        result = await session.execute(query)
        events = result.scalars().all()

        return [
            {
                "id": e.id,
                "device_id": e.device_id,
                "ts_start": e.ts_start,
                "ts_end": e.ts_end,
                "duration_ms": e.ts_end - e.ts_start,
                "app_bundle_id": e.app_bundle_id,
                "app_name": e.app_name,
                "window_title": e.window_title,
                "window_title_hash": e.window_title_hash,
                "is_afk": bool(e.is_afk),
            }
            for e in events
        ]


async def get_events_for_day_impl(
    service,
    user_id: str,
    day: str,
    device_id: Optional[str] = None,
    timezone: str = "UTC",
) -> List[Dict[str, Any]]:
    """Get all activity events for a specific day."""
    try:
        day_date = datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return []

    day_start_ms = int(day_date.timestamp() * 1000)
    day_end_ms = day_start_ms + (24 * 60 * 60 * 1000)

    async with service._get_db_session() as session:
        query = select(ActivityEventDB).where(
            ActivityEventDB.user_id == user_id,
            ActivityEventDB.ts_start >= day_start_ms,
            ActivityEventDB.ts_start < day_end_ms,
        )

        if device_id:
            query = query.where(ActivityEventDB.device_id == device_id)

        query = query.order_by(ActivityEventDB.ts_start.asc())

        result = await session.execute(query)
        events = result.scalars().all()

        return [
            {
                "id": e.id,
                "ts_start": e.ts_start,
                "ts_end": e.ts_end,
                "duration_ms": e.ts_end - e.ts_start,
                "app_bundle_id": e.app_bundle_id,
                "app_name": e.app_name,
                "window_title": e.window_title,
                "is_afk": bool(e.is_afk),
            }
            for e in events
        ]


async def compute_daily_rollup_impl(
    service,
    user_id: str,
    day: str,
    device_id: Optional[str] = None,
    force_recompute: bool = False,
) -> Dict[str, Any]:
    """Compute daily activity rollup from raw events."""
    try:
        day_date = datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return {"error": "Invalid day format"}

    day_start_ms = int(day_date.timestamp() * 1000)
    day_end_ms = day_start_ms + (24 * 60 * 60 * 1000)
    now_ms = service._now_ms()

    async with service._get_db_session() as session:
        if device_id:
            device_ids = [device_id]
        else:
            result = await session.execute(
                select(WatcherDeviceDB.device_id).where(WatcherDeviceDB.user_id == user_id)
            )
            device_ids = [r[0] for r in result.all()]

        if not device_ids:
            return {"day": day, "total_active_ms": 0, "apps": []}

        if force_recompute:
            for did in device_ids:
                await session.execute(
                    delete(DailyActivityRollupDB).where(
                        DailyActivityRollupDB.user_id == user_id,
                        DailyActivityRollupDB.device_id == did,
                        DailyActivityRollupDB.day == day,
                    )
                )

        rollups: Dict[Any, Dict[str, Any]] = {}

        for did in device_ids:
            result = await session.execute(
                select(WatcherStateDB).where(WatcherStateDB.device_id == did)
            )
            state = result.scalar_one_or_none()
            title_mode = state.title_mode if state else "off"

            result = await session.execute(
                select(ActivityEventDB).where(
                    ActivityEventDB.user_id == user_id,
                    ActivityEventDB.device_id == did,
                    ActivityEventDB.ts_start >= day_start_ms,
                    ActivityEventDB.ts_start < day_end_ms,
                    ActivityEventDB.is_afk == 0,
                )
            )
            events = result.scalars().all()

            for event in events:
                if title_mode in ["full", "truncate"]:
                    key = (did, event.app_bundle_id, event.window_title or "")
                elif title_mode == "hash":
                    key = (did, event.app_bundle_id, event.window_title_hash or "")
                else:
                    key = (did, event.app_bundle_id, "")

                event_start = max(event.ts_start, day_start_ms)
                event_end = min(event.ts_end, day_end_ms)
                duration_ms = max(0, event_end - event_start)

                if key not in rollups:
                    rollups[key] = {
                        "device_id": did,
                        "app_bundle_id": event.app_bundle_id,
                        "app_name": event.app_name,
                        "window_title": event.window_title if title_mode in ["full", "truncate"] else None,
                        "window_title_hash": event.window_title_hash if title_mode == "hash" else None,
                        "active_ms": 0,
                        "events_count": 0,
                    }

                rollups[key]["active_ms"] += duration_ms
                rollups[key]["events_count"] += 1

        for _, data in rollups.items():
            result = await session.execute(
                select(DailyActivityRollupDB).where(
                    DailyActivityRollupDB.user_id == user_id,
                    DailyActivityRollupDB.device_id == data["device_id"],
                    DailyActivityRollupDB.day == day,
                    DailyActivityRollupDB.app_bundle_id == data["app_bundle_id"],
                    DailyActivityRollupDB.window_title == data["window_title"],
                )
            )
            existing = result.scalar_one_or_none()

            if existing:
                existing.active_ms = data["active_ms"]
                existing.events_count = data["events_count"]
                existing.updated_at = now_ms
            else:
                rollup = DailyActivityRollupDB(
                    day=day,
                    device_id=data["device_id"],
                    user_id=user_id,
                    app_bundle_id=data["app_bundle_id"],
                    app_name=data["app_name"],
                    window_title=data["window_title"],
                    window_title_hash=data["window_title_hash"],
                    active_ms=data["active_ms"],
                    events_count=data["events_count"],
                    created_at=now_ms,
                    updated_at=now_ms,
                )
                session.add(rollup)

        await session.commit()

        total_active_ms = sum(r["active_ms"] for r in rollups.values())
        total_events = sum(r["events_count"] for r in rollups.values())

        return {
            "day": day,
            "total_active_ms": total_active_ms,
            "total_events": total_events,
            "apps_count": len(set(r["app_bundle_id"] for r in rollups.values())),
            "rollups_count": len(rollups),
        }


async def get_daily_summary_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Get daily activity summaries for a date range."""
    async with service._get_db_session() as session:
        query = select(DailyActivityRollupDB).where(
            DailyActivityRollupDB.user_id == user_id,
            DailyActivityRollupDB.day >= start_date,
            DailyActivityRollupDB.day <= end_date,
        )

        if device_id:
            query = query.where(DailyActivityRollupDB.device_id == device_id)

        query = query.order_by(
            DailyActivityRollupDB.day.desc(),
            DailyActivityRollupDB.active_ms.desc(),
        )

        result = await session.execute(query)
        rollups = result.scalars().all()

        days: Dict[str, Dict[str, Any]] = {}
        for r in rollups:
            if r.day not in days:
                days[r.day] = {
                    "day": r.day,
                    "total_active_ms": 0,
                    "total_events": 0,
                    "apps": [],
                }

            days[r.day]["total_active_ms"] += r.active_ms
            days[r.day]["total_events"] += r.events_count
            days[r.day]["apps"].append(
                {
                    "app_bundle_id": r.app_bundle_id,
                    "app_name": r.app_name,
                    "window_title": r.window_title,
                    "active_ms": r.active_ms,
                    "events_count": r.events_count,
                }
            )

        return list(days.values())


async def get_top_apps_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    limit: int = 10,
    device_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Get top apps by active time for a date range."""
    perf_start = time.perf_counter()
    start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
    end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
    start_ms = int(start_date_obj.timestamp() * 1000)
    end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)

    async with open_activity_connection_for_user(user_id) as conn:
        if conn is not None:
            params: list[Any] = [start_ms, end_ms, user_id]
            device_clause = ""
            if device_id:
                device_clause = " AND device_id = ?"
                params.append(device_id)

            rows = conn.execute(
                f"""
                SELECT
                    ts_start,
                    ts_end,
                    app_bundle_id,
                    app_name,
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                  AND user_id = ?
                  AND COALESCE(is_afk, 0) = 0
                  {device_clause}
                """,
                params,
            ).fetchall()

            if rows:
                daily_rows = _aggregate_computer_activity_daily_rows_from_events_impl(
                    [(row[0], row[1], row[2], row[3], "", 0) for row in rows],
                    start_ms,
                    end_ms,
                )
                result = _rank_top_apps_from_daily_rows(
                    daily_rows,
                    limit,
                    source="activity_db_dedup",
                )
                _log_activity_perf(
                    "top_apps",
                    start=perf_start,
                    source="activity_db_dedup",
                    user_id=user_id,
                    start_date=start_date,
                    end_date=end_date,
                    limit=limit,
                    row_count=len(result),
                )
                return result

    local_daily_rows = service._get_computer_activity_daily_rows_from_local_db(
        start_date=start_date,
        end_date=end_date,
        user_id=user_id,
    )
    if local_daily_rows:
        result = _rank_top_apps_from_daily_rows(
            local_daily_rows,
            limit,
            source="local_dedup",
        )
        if result:
            _log_activity_perf(
                "top_apps",
                start=perf_start,
                source="local_dedup",
                user_id=user_id,
                start_date=start_date,
                end_date=end_date,
                limit=limit,
                row_count=len(result),
            )
            return result

    tinybird_rows = await service._get_computer_activity_pipe_rows(
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        output="apps",
        limit=limit,
    )
    if tinybird_rows:
        result = [
            {
                "app_bundle_id": row.get("app_bundle_id"),
                "app_name": row.get("app_name"),
                "total_active_ms": int(row.get("total_active_ms", 0) or 0),
                "total_events": int(row.get("total_events", 0) or 0),
                "days_used": int(row.get("days_used", 0) or 0),
                "hours": round((int(row.get("total_active_ms", 0) or 0)) / (1000 * 60 * 60), 2),
                "source": "tinybird",
            }
            for row in tinybird_rows
        ]
        _log_activity_perf(
            "top_apps",
            start=perf_start,
            source="tinybird",
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            row_count=len(result),
        )
        return result

    import sqlite3

    db_path = get_local_watcher_db_path_impl()

    if not os.path.exists(db_path):
        logger.info("Local watcher database not found at: %s", db_path)
        _log_activity_perf(
            "top_apps",
            start=perf_start,
            source="missing_local_db",
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            row_count=0,
            empty_reason="local_db_missing",
        )
        return []

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        user_ids = _resolve_activity_user_ids(user_id)
        user_clause, user_params = _sqlite_user_filter_clause(user_ids)
        query = f"""
            SELECT
                ts_start,
                ts_end,
                app_bundle_id,
                app_name,
                browser_domain,
                COALESCE(is_afk, 0)
            FROM activity_events
            WHERE ts_start >= ? AND ts_start < ?
              AND COALESCE(is_afk, 0) = 0
              {user_clause}
        """
        params: list[Any] = [start_ms, end_ms, *user_params]
        if device_id:
            query += " AND device_id = ?"
            params.append(device_id)

        cursor.execute(
            query,
            params,
        )

        rows = cursor.fetchall()
        conn.close()

        logger.info(
            "Local watcher top apps %s to %s: %s apps",
            start_date,
            end_date,
            len(rows),
        )

        daily_rows = _aggregate_computer_activity_daily_rows_from_events_impl(rows, start_ms, end_ms)
        result = _rank_top_apps_from_daily_rows(daily_rows, limit, source="local_sql_dedup")
        _log_activity_perf(
            "top_apps",
            start=perf_start,
            source="local_sql_dedup",
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            row_count=len(result),
        )
        return result
    except Exception as e:
        logger.warning("Error reading top apps from local DB: %s", e)
        _log_activity_perf(
            "top_apps",
            start=perf_start,
            source="local_sql_error",
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            row_count=0,
            empty_reason=str(e),
        )
        return []


async def get_top_domains_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    limit: int = 10,
    device_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Get top domains by active time for a date range."""
    perf_start = time.perf_counter()
    start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
    end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
    start_ms = int(start_date_obj.timestamp() * 1000)
    end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)

    async with open_activity_connection_for_user(user_id) as conn:
        if conn is not None:
            params: list[Any] = [start_ms, end_ms, user_id]
            device_clause = ""
            if device_id:
                device_clause = " AND device_id = ?"
                params.append(device_id)

            rows = conn.execute(
                f"""
                SELECT
                    ts_start,
                    ts_end,
                    browser_domain,
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                  AND user_id = ?
                  AND COALESCE(is_afk, 0) = 0
                  AND browser_domain IS NOT NULL
                  AND browser_domain != ''
                  {device_clause}
                """,
                params,
            ).fetchall()

            if rows:
                daily_rows = _aggregate_computer_activity_daily_rows_from_events_impl(
                    [(row[0], row[1], "browser", "Browser", row[2], 0) for row in rows],
                    start_ms,
                    end_ms,
                )
                result = _rank_top_domains_from_daily_rows(
                    daily_rows,
                    limit,
                    source="activity_db_dedup",
                )
                _log_activity_perf(
                    "top_domains",
                    start=perf_start,
                    source="activity_db_dedup",
                    user_id=user_id,
                    start_date=start_date,
                    end_date=end_date,
                    limit=limit,
                    row_count=len(result),
                )
                return result

    local_daily_rows = service._get_computer_activity_daily_rows_from_local_db(
        start_date=start_date,
        end_date=end_date,
        user_id=user_id,
    )
    if local_daily_rows:
        result = _rank_top_domains_from_daily_rows(
            local_daily_rows,
            limit,
            source="local_dedup",
        )
        if result:
            _log_activity_perf(
                "top_domains",
                start=perf_start,
                source="local_dedup",
                user_id=user_id,
                start_date=start_date,
                end_date=end_date,
                limit=limit,
                row_count=len(result),
            )
            return result

    tinybird_rows = await service._get_computer_activity_pipe_rows(
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        output="domains",
        limit=limit,
    )
    if tinybird_rows:
        result = [
            {
                "domain": row.get("browser_domain"),
                "total_active_ms": int(row.get("total_active_ms", 0) or 0),
                "total_events": int(row.get("total_events", 0) or 0),
                "days_used": int(row.get("days_used", 0) or 0),
                "hours": round((int(row.get("total_active_ms", 0) or 0)) / (1000 * 60 * 60), 2),
                "minutes": round((int(row.get("total_active_ms", 0) or 0)) / (1000 * 60), 1),
                "source": "tinybird",
            }
            for row in tinybird_rows
        ]
        _log_activity_perf(
            "top_domains",
            start=perf_start,
            source="tinybird",
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            row_count=len(result),
        )
        return result

    import sqlite3

    db_path = get_local_watcher_db_path_impl()

    if not os.path.exists(db_path):
        logger.info("Local watcher database not found at: %s", db_path)
        _log_activity_perf(
            "top_domains",
            start=perf_start,
            source="missing_local_db",
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            row_count=0,
            empty_reason="local_db_missing",
        )
        return []

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        user_ids = _resolve_activity_user_ids(user_id)
        user_clause, user_params = _sqlite_user_filter_clause(user_ids)
        query = f"""
            SELECT
                ts_start,
                ts_end,
                browser_domain
            FROM activity_events
            WHERE ts_start >= ? AND ts_start < ?
              AND COALESCE(is_afk, 0) = 0
              AND browser_domain IS NOT NULL
              AND browser_domain != ''
              {user_clause}
        """
        params: list[Any] = [start_ms, end_ms, *user_params]
        if device_id:
            query += " AND device_id = ?"
            params.append(device_id)

        cursor.execute(
            query,
            params,
        )

        rows = cursor.fetchall()
        conn.close()

        logger.info(
            "Local watcher top domains %s to %s: %s domains",
            start_date,
            end_date,
            len(rows),
        )

        daily_rows = _aggregate_computer_activity_daily_rows_from_events_impl(
            [(row[0], row[1], "browser", "Browser", row[2], 0) for row in rows],
            start_ms,
            end_ms,
        )
        result = _rank_top_domains_from_daily_rows(daily_rows, limit, source="local_sql_dedup")
        _log_activity_perf(
            "top_domains",
            start=perf_start,
            source="local_sql_dedup",
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            row_count=len(result),
        )
        return result
    except Exception as e:
        logger.warning("Error reading top domains from local DB: %s", e)
        _log_activity_perf(
            "top_domains",
            start=perf_start,
            source="local_sql_error",
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            row_count=0,
            empty_reason=str(e),
        )
        return []


async def get_domain_daily_breakdown_impl(
    service,
    user_id: str,
    domain: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Get daily breakdown for a specific domain."""
    async with service._get_db_session() as session:
        query = """
            SELECT
                day,
                SUM(active_ms) as total_active_ms,
                SUM(events_count) as total_events
            FROM daily_activity_rollups
            WHERE user_id = :user_id
              AND browser_domain = :domain
              AND day >= :start_date
              AND day <= :end_date
        """

        params = {
            "user_id": user_id,
            "domain": domain,
            "start_date": start_date,
            "end_date": end_date,
        }

        if device_id:
            query += " AND device_id = :device_id"
            params["device_id"] = device_id

        query += " GROUP BY day ORDER BY day ASC"

        result = await session.execute(text(query), params)
        rows = result.fetchall()

        return [
            {
                "day": r[0],
                "active_ms": r[1],
                "hours": round(r[1] / (1000 * 60 * 60), 2),
                "events_count": r[2],
            }
            for r in rows
        ]


async def get_browser_summary_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Get overall browser usage summary including top domains."""
    browser_ids = [
        "com.apple.Safari",
        "com.google.Chrome",
        "org.mozilla.firefox",
        "com.brave.Browser",
        "com.microsoft.edgemac",
        "company.thebrowser.Browser",
    ]

    async with service._get_db_session() as session:
        bundle_placeholders = ",".join([f"'{b}'" for b in browser_ids])
        query = f"""
            SELECT
                SUM(active_ms) as total_browser_ms,
                COUNT(DISTINCT day) as days_tracked
            FROM daily_activity_rollups
            WHERE user_id = :user_id
              AND day >= :start_date
              AND day <= :end_date
              AND app_bundle_id IN ({bundle_placeholders})
        """

        params = {
            "user_id": user_id,
            "start_date": start_date,
            "end_date": end_date,
        }

        if device_id:
            query += " AND device_id = :device_id"
            params["device_id"] = device_id

        result = await session.execute(text(query), params)
        row = result.fetchone()

        total_browser_ms = row[0] or 0
        days_tracked = row[1] or 0

        top_domains = await service.get_top_domains(
            user_id,
            start_date,
            end_date,
            limit=10,
            device_id=device_id,
        )

        return {
            "total_browser_ms": total_browser_ms,
            "total_browser_hours": round(total_browser_ms / (1000 * 60 * 60), 2),
            "days_tracked": days_tracked,
            "avg_daily_hours": round(
                total_browser_ms / (1000 * 60 * 60) / max(days_tracked, 1),
                2,
            ),
            "top_domains": top_domains,
            "unique_domains": len(top_domains),
        }


async def get_afk_summary_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Get AFK vs active time summary."""
    try:
        summary = service._get_afk_summary_from_local_db(start_date, end_date)
        if summary:
            return summary
    except Exception as e:
        logger.info("Could not read AFK data from local DB: %s", e)

    async with service._get_db_session() as session:
        query = """
            SELECT
                SUM(CASE WHEN is_afk = 0 THEN active_ms ELSE 0 END) as active_ms,
                SUM(CASE WHEN is_afk = 1 THEN active_ms ELSE 0 END) as afk_ms,
                SUM(active_ms) as total_ms
            FROM daily_activity_rollups
            WHERE user_id = :user_id
              AND day >= :start_date
              AND day <= :end_date
        """

        params = {
            "user_id": user_id,
            "start_date": start_date,
            "end_date": end_date,
        }

        if device_id:
            query += " AND device_id = :device_id"
            params["device_id"] = device_id

        result = await session.execute(text(query), params)
        row = result.fetchone()

        active_ms = row[0] or 0
        afk_ms = row[1] or 0
        total_ms = row[2] or 0

        return {
            "active_ms": active_ms,
            "active_hours": round(active_ms / (1000 * 60 * 60), 2),
            "afk_ms": afk_ms,
            "afk_hours": round(afk_ms / (1000 * 60 * 60), 2),
            "total_ms": total_ms,
            "total_hours": round(total_ms / (1000 * 60 * 60), 2),
            "active_percentage": round(active_ms / max(total_ms, 1) * 100, 1),
        }


def _get_afk_summary_from_local_db_impl(
    service,
    start_date: str,
    end_date: str,
) -> Optional[Dict[str, Any]]:
    """Read AFK summary from local watcher database."""
    import sqlite3

    db_path = get_local_watcher_db_path_impl()
    if not os.path.exists(db_path):
        return None

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
        start_ms = int(start_dt.timestamp() * 1000)
        end_ms = int(end_dt.timestamp() * 1000)

        cursor.execute(
            """
            SELECT SUM(ts_end - ts_start)
            FROM activity_events
            WHERE ts_start >= ? AND ts_start < ? AND is_afk = 0
            """,
            (start_ms, end_ms),
        )
        active_ms = cursor.fetchone()[0] or 0

        cursor.execute(
            """
            SELECT SUM(ts_end - ts_start)
            FROM afk_events
            WHERE ts_start >= ? AND ts_start < ? AND status = 'afk'
            """,
            (start_ms, end_ms),
        )
        afk_ms = cursor.fetchone()[0] or 0

        conn.close()

        total_ms = active_ms + afk_ms

        return {
            "active_ms": active_ms,
            "active_hours": round(active_ms / (1000 * 60 * 60), 2),
            "afk_ms": afk_ms,
            "afk_hours": round(afk_ms / (1000 * 60 * 60), 2),
            "total_ms": total_ms,
            "total_hours": round(total_ms / (1000 * 60 * 60), 2),
            "active_percentage": round(active_ms / max(total_ms, 1) * 100, 1),
        }
    except Exception as e:
        logger.warning("Error reading AFK data: %s", e)
        return None
