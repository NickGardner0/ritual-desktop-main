"""Extracted computer-activity analytics/sync logic for WatcherService."""

from __future__ import annotations

import asyncio
import os
import time
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from services.watcher_service_local_db import (
    get_local_watcher_db_path_impl,
    merge_time_intervals_impl,
)
from services.turso_activity_remote import fetch_remote_activity_rows
from services.turso_user_service import turso_user_service

logger = logging.getLogger(__name__)

# Guardrail: extremely long single events are typically stale heartbeat artifacts.
# Keep this configurable, but default to 15 minutes for analytics rollups.
MAX_SINGLE_EVENT_MS = max(60_000, int(os.getenv("WATCHER_MAX_SINGLE_EVENT_MS", "900000")))
RAW_EVENT_FALLBACK_MAX_DAYS = max(1, int(os.getenv("WATCHER_RAW_EVENT_FALLBACK_MAX_DAYS", "45")))
REMOTE_AGGREGATE_TIMEOUT_SECONDS = max(
    0.5,
    float(os.getenv("WATCHER_REMOTE_AGGREGATE_TIMEOUT_SECONDS", "8")),
)
REMOTE_RAW_READ_TIMEOUT_SECONDS = max(
    0.5,
    float(os.getenv("WATCHER_REMOTE_RAW_READ_TIMEOUT_SECONDS", "6")),
)


def _resolve_activity_user_ids(target_user_id: str) -> List[str]:
    """Return the target user id plus any configured historical source id."""
    user_ids = [target_user_id]
    try:
        source_user_id = turso_user_service.resolve_migration_source_user_id(target_user_id)
    except Exception:
        source_user_id = target_user_id

    source_user_id = (source_user_id or "").strip()
    if source_user_id and source_user_id not in user_ids:
        user_ids.append(source_user_id)
    return user_ids


def _sqlite_user_filter_clause(user_ids: List[str]) -> tuple[str, List[Any]]:
    placeholders = ", ".join(["?"] * len(user_ids))
    return f" AND user_id IN ({placeholders})", list(user_ids)


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
    row_count: int | None = None,
    empty_reason: str | None = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    payload: Dict[str, Any] = {
        "operation": operation,
        "source": source,
        "user_id": user_id,
        "start_date": start_date,
        "end_date": end_date,
        "duration_ms": _perf_ms(start),
    }
    if row_count is not None:
        payload["row_count"] = row_count
    if empty_reason:
        payload["empty_reason"] = empty_reason
    if extra:
        payload.update(extra)
    logger.info("[Ritual][computer-activity] %s", payload)


def _escape_tinybird_literal_impl(value: str) -> str:
    return value.replace("'", "''")


def _build_computer_activity_sync_cache_key_impl(
    user_id: str,
    start_date: str,
    end_date: str,
) -> str:
    return f"{user_id}:{start_date}:{end_date}"


def _split_interval_by_local_day(start_ms: int, end_ms: int) -> List[tuple[str, int, int]]:
    """Split an interval into local day-bounded segments: (YYYY-MM-DD, seg_start_ms, seg_end_ms)."""
    if end_ms <= start_ms:
        return []

    segments: List[tuple[str, int, int]] = []
    cursor = start_ms

    while cursor < end_ms:
        cursor_dt = datetime.fromtimestamp(cursor / 1000)
        next_day = datetime(cursor_dt.year, cursor_dt.month, cursor_dt.day) + timedelta(days=1)
        next_day_ms = int(next_day.timestamp() * 1000)
        seg_end = min(end_ms, next_day_ms)
        segments.append((cursor_dt.strftime("%Y-%m-%d"), cursor, seg_end))
        cursor = seg_end

    return segments


def _clamp_single_event_span_impl(start_ms: int, end_ms: int) -> tuple[int, int]:
    """Clamp abnormally long single-event spans to reduce stale-heartbeat overcounting."""
    start_i = int(start_ms or 0)
    end_i = int(end_ms or 0)
    if end_i <= start_i:
        return start_i, start_i
    if MAX_SINGLE_EVENT_MS > 0 and (end_i - start_i) > MAX_SINGLE_EVENT_MS:
        end_i = start_i + MAX_SINGLE_EVENT_MS
    return start_i, end_i


def _aggregate_computer_activity_daily_rows_from_events_impl(
    rows: List[tuple[Any, Any, Any, Any, Any, Any]],
    start_ms: int,
    end_ms: int,
) -> List[Dict[str, Any]]:
    """Aggregate raw activity rows into day/app/domain rows with day clipping + de-overlap."""
    deduped_by_interval: Dict[
        tuple[int, int, str, str, int],
        tuple[int, int, str, str, str, int],
    ] = {}

    for ts_start, ts_end, app_bundle_id, app_name, browser_domain, is_afk in rows:
        start_i, end_i = _clamp_single_event_span_impl(int(ts_start or 0), int(ts_end or 0))
        if end_i <= start_i:
            continue

        app_bundle = str(app_bundle_id or "unknown")
        app = str(app_name or "Unknown")
        domain = str(browser_domain or "")
        afk_flag = int(is_afk or 0)

        dedup_key = (start_i, end_i, app_bundle, app, afk_flag)
        existing = deduped_by_interval.get(dedup_key)
        if not existing:
            deduped_by_interval[dedup_key] = (start_i, end_i, app_bundle, app, domain, afk_flag)
            continue

        existing_domain = existing[4]
        if not existing_domain and domain:
            deduped_by_interval[dedup_key] = (start_i, end_i, app_bundle, app, domain, afk_flag)

    deduped_rows = list(deduped_by_interval.values())
    deduped_rows.sort(key=lambda row: row[0])

    grouped: Dict[tuple[str, str, str, str], Dict[str, Any]] = defaultdict(
        lambda: {
            "active_intervals": [],
            "afk_intervals": [],
            "events_count": 0,
            "first_start_ms": None,
            "last_end_ms": None,
        }
    )

    for ts_start, ts_end, app_bundle_id, app_name, browser_domain, is_afk in deduped_rows:
        clipped_start = max(int(ts_start), start_ms)
        clipped_end = min(int(ts_end), end_ms)
        if clipped_end <= clipped_start:
            continue

        for day, seg_start, seg_end in _split_interval_by_local_day(clipped_start, clipped_end):
            key = (
                day,
                str(app_bundle_id or "unknown"),
                str(app_name or "Unknown"),
                str(browser_domain or ""),
            )
            bucket = grouped[key]
            if int(is_afk or 0) == 1:
                bucket["afk_intervals"].append((seg_start, seg_end))
            else:
                bucket["active_intervals"].append((seg_start, seg_end))
                bucket["events_count"] += 1
            bucket["first_start_ms"] = (
                seg_start
                if bucket["first_start_ms"] is None
                else min(bucket["first_start_ms"], seg_start)
            )
            bucket["last_end_ms"] = (
                seg_end
                if bucket["last_end_ms"] is None
                else max(bucket["last_end_ms"], seg_end)
            )

    output: List[Dict[str, Any]] = []
    for (day, app_bundle_id, app_name, browser_domain), bucket in grouped.items():
        merged_active = merge_time_intervals_impl(bucket["active_intervals"])
        merged_afk = merge_time_intervals_impl(bucket["afk_intervals"])
        active_ms = sum(seg_end - seg_start for seg_start, seg_end in merged_active)
        afk_ms = sum(seg_end - seg_start for seg_start, seg_end in merged_afk)

        if active_ms <= 0 and afk_ms <= 0:
            continue

        output.append(
            {
                "day": day,
                "app_bundle_id": app_bundle_id,
                "app_name": app_name,
                "browser_domain": browser_domain,
                "active_ms": int(active_ms),
                "afk_ms": int(afk_ms),
                "events_count": int(bucket["events_count"]),
                "first_start_ms": int(bucket["first_start_ms"]) if bucket["first_start_ms"] is not None else None,
                "last_end_ms": int(bucket["last_end_ms"]) if bucket["last_end_ms"] is not None else None,
            }
        )

    output.sort(key=lambda row: (row["day"], row["app_name"], row["browser_domain"]))
    return output


def _aggregate_computer_activity_daily_totals_from_events_impl(
    rows: List[tuple[Any, Any, Any, Any, Any]],
    start_ms: int,
    end_ms: int,
) -> List[Dict[str, Any]]:
    """Compute per-day de-overlapped totals across all apps/domains from raw activity rows."""
    grouped: Dict[str, Dict[str, Any]] = defaultdict(
        lambda: {
            "active_intervals": [],
            "afk_intervals": [],
            "events_count": 0,
            "apps_seen": set(),
            "domains_seen": set(),
        }
    )

    for ts_start, ts_end, is_afk, app_bundle_id, browser_domain in rows:
        bounded_start, bounded_end = _clamp_single_event_span_impl(int(ts_start or 0), int(ts_end or 0))
        clipped_start = max(bounded_start, start_ms)
        clipped_end = min(bounded_end, end_ms)
        if clipped_end <= clipped_start:
            continue

        for day, seg_start, seg_end in _split_interval_by_local_day(clipped_start, clipped_end):
            bucket = grouped[day]
            if int(is_afk or 0) == 1:
                bucket["afk_intervals"].append((seg_start, seg_end))
            else:
                bucket["active_intervals"].append((seg_start, seg_end))
                bucket["events_count"] += 1

                app_key = str(app_bundle_id or "").strip()
                if app_key:
                    bucket["apps_seen"].add(app_key)

                domain_key = str(browser_domain or "").strip()
                if domain_key:
                    bucket["domains_seen"].add(domain_key)

    output: List[Dict[str, Any]] = []
    for day in sorted(grouped.keys()):
        bucket = grouped[day]
        merged_active = merge_time_intervals_impl(bucket["active_intervals"])
        merged_afk = merge_time_intervals_impl(bucket["afk_intervals"])
        active_ms = int(sum(seg_end - seg_start for seg_start, seg_end in merged_active))
        afk_ms = int(sum(seg_end - seg_start for seg_start, seg_end in merged_afk))

        if active_ms <= 0 and afk_ms <= 0:
            continue

        output.append(
            {
                "day": day,
                "active_ms": active_ms,
                "afk_ms": afk_ms,
                "events_count": int(bucket["events_count"]),
                "apps_count": len(bucket["apps_seen"]),
                "domains_count": len(bucket["domains_seen"]),
            }
        )

    return output


def _get_computer_activity_daily_rows_from_local_db_impl(
    service,
    start_date: str,
    end_date: str,
    user_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Aggregate local watcher events into computer_activity_daily rows with day clipping + de-overlap."""
    import sqlite3

    db_path = get_local_watcher_db_path_impl()
    if not os.path.exists(db_path):
        return []

    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        start_ms = int(start_dt.timestamp() * 1000)
        end_ms = int((end_dt + timedelta(days=1)).timestamp() * 1000)

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        user_clause = ""
        user_params: List[Any] = []
        if user_ids:
            user_clause, user_params = _sqlite_user_filter_clause(user_ids)

        cursor.execute(
            """
            SELECT
                ts_start,
                ts_end,
                COALESCE(app_bundle_id, 'unknown') AS app_bundle_id,
                COALESCE(app_name, 'Unknown') AS app_name,
                COALESCE(browser_domain, '') AS browser_domain,
                COALESCE(is_afk, 0) AS is_afk
            FROM activity_events
            WHERE ts_start < ? AND ts_end > ?
            """
            + user_clause
            + """
              AND ts_end > ts_start
            ORDER BY ts_start ASC
            """,
            (end_ms, start_ms, *user_params),
        )
        rows = cursor.fetchall()
        conn.close()

        return _aggregate_computer_activity_daily_rows_from_events_impl(rows, start_ms, end_ms)
    except Exception as e:
        logger.warning("Failed local computer_activity_daily aggregation: %s", e)
        return []


def _get_computer_activity_daily_totals_from_local_db_impl(
    start_date: str,
    end_date: str,
    user_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Compute de-overlapped day totals across all apps/domains from local watcher DB."""
    import sqlite3

    db_path = get_local_watcher_db_path_impl()
    if not os.path.exists(db_path):
        return []

    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        start_ms = int(start_dt.timestamp() * 1000)
        end_ms = int((end_dt + timedelta(days=1)).timestamp() * 1000)

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        user_clause = ""
        user_params: List[Any] = []
        if user_ids:
            user_clause, user_params = _sqlite_user_filter_clause(user_ids)
        cursor.execute(
            """
            SELECT
                ts_start,
                ts_end,
                COALESCE(is_afk, 0) AS is_afk,
                COALESCE(app_bundle_id, '') AS app_bundle_id,
                COALESCE(browser_domain, '') AS browser_domain
            FROM activity_events
            WHERE ts_start < ? AND ts_end > ?
            """
            + user_clause
            + """
              AND ts_end > ts_start
            ORDER BY ts_start ASC
            """,
            (end_ms, start_ms, *user_params),
        )
        rows = cursor.fetchall()
        conn.close()

        return _aggregate_computer_activity_daily_totals_from_events_impl(rows, start_ms, end_ms)
    except Exception as e:
        logger.warning("Failed local computer-activity daily totals aggregation: %s", e)
        return []


def _get_computer_activity_distinct_counts_from_local_db_impl(
    start_date: str,
    end_date: str,
    user_ids: Optional[List[str]] = None,
) -> Dict[str, int]:
    """Count unique apps/domains in range from local watcher DB (non-AFK, overlapping range)."""
    import sqlite3

    db_path = get_local_watcher_db_path_impl()
    if not os.path.exists(db_path):
        return {"unique_apps": 0, "unique_domains": 0}

    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        start_ms = int(start_dt.timestamp() * 1000)
        end_ms = int((end_dt + timedelta(days=1)).timestamp() * 1000)

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        user_clause = ""
        user_params: List[Any] = []
        if user_ids:
            user_clause, user_params = _sqlite_user_filter_clause(user_ids)
        cursor.execute(
            """
            SELECT
                COUNT(DISTINCT CASE
                    WHEN app_bundle_id IS NOT NULL AND app_bundle_id != '' THEN app_bundle_id
                    ELSE NULL
                END) AS unique_apps,
                COUNT(DISTINCT CASE
                    WHEN browser_domain IS NOT NULL AND browser_domain != '' THEN browser_domain
                    ELSE NULL
                END) AS unique_domains
            FROM activity_events
            WHERE ts_start < ? AND ts_end > ?
            """
            + user_clause
            + """
              AND ts_end > ts_start
              AND COALESCE(is_afk, 0) = 0
            """,
            (end_ms, start_ms, *user_params),
        )
        row = cursor.fetchone()
        conn.close()

        return {
            "unique_apps": int((row[0] if row else 0) or 0),
            "unique_domains": int((row[1] if row else 0) or 0),
        }
    except Exception as e:
        logger.warning("Failed local computer-activity distinct counts: %s", e)
        return {"unique_apps": 0, "unique_domains": 0}


def _empty_computer_activity_snapshot(
    *,
    source: str,
    empty_reason: str,
) -> Dict[str, Any]:
    return {
        "summary": {
            "total_active_ms": 0,
            "total_hours": 0,
            "total_events": 0,
            "days_tracked": 0,
            "unique_apps": 0,
            "unique_domains": 0,
            "total_afk_ms": 0,
            "avg_daily_hours": 0,
            "source": source,
        },
        "daily": [],
        "apps": [],
        "domains": [],
        "source": source,
        "state": "sync_pending" if source == "sync_pending" else "empty",
        "sync_pending": source == "sync_pending",
        "empty_reason": empty_reason,
    }


def _build_top_apps_from_daily_rows_impl(
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

        bucket = grouped.setdefault(
            (app_bundle, app_name),
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

    ranked = sorted(grouped.values(), key=lambda item: item["total_active_ms"], reverse=True)[
        : max(1, int(limit or 10))
    ]
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


def _build_top_domains_from_daily_rows_impl(
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

    ranked = sorted(grouped.values(), key=lambda item: item["total_active_ms"], reverse=True)[
        : max(1, int(limit or 10))
    ]
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


def _build_snapshot_from_event_rows_impl(
    rows: List[tuple[Any, Any, Any, Any, Any, Any]],
    *,
    start_ms: int,
    end_ms: int,
    source: str,
    limit: int,
) -> Dict[str, Any]:
    detailed_rows = _aggregate_computer_activity_daily_rows_from_events_impl(
        [(row[0], row[1], row[3], row[4], row[5], row[2]) for row in rows],
        start_ms,
        end_ms,
    )
    daily_totals = _aggregate_computer_activity_daily_totals_from_events_impl(
        [(row[0], row[1], row[2], row[3], row[5]) for row in rows],
        start_ms,
        end_ms,
    )

    total_active_ms = sum(int(row.get("active_ms", 0) or 0) for row in daily_totals)
    total_events = sum(int(row.get("events_count", 0) or 0) for row in daily_totals)
    days_tracked = sum(1 for row in daily_totals if int(row.get("active_ms", 0) or 0) > 0)
    total_afk_ms = sum(int(row.get("afk_ms", 0) or 0) for row in daily_totals)
    unique_apps = len(
        {
            str(row.get("app_bundle_id") or "").strip()
            for row in detailed_rows
            if str(row.get("app_bundle_id") or "").strip()
        }
    )
    unique_domains = len(
        {
            str(row.get("browser_domain") or "").strip()
            for row in detailed_rows
            if str(row.get("browser_domain") or "").strip()
        }
    )
    total_hours = round(total_active_ms / (1000 * 60 * 60), 2)

    return {
        "summary": {
            "total_active_ms": total_active_ms,
            "total_hours": total_hours,
            "total_events": total_events,
            "days_tracked": days_tracked,
            "unique_apps": unique_apps,
            "unique_domains": unique_domains,
            "total_afk_ms": total_afk_ms,
            "avg_daily_hours": round(total_hours / max(days_tracked, 1), 2),
            "source": source,
        },
        "daily": [
            {
                "day": row["day"],
                "active_hours": round(int(row["active_ms"]) / (1000 * 60 * 60), 2),
                "active_ms": int(row["active_ms"]),
                "afk_ms": int(row.get("afk_ms", 0) or 0),
                "events_count": int(row.get("events_count", 0) or 0),
                "apps_count": int(row.get("apps_count", 0) or 0),
                "domains_count": int(row.get("domains_count", 0) or 0),
                "source": source,
            }
            for row in daily_totals
        ],
        "apps": _build_top_apps_from_daily_rows_impl(detailed_rows, limit, source=source),
        "domains": _build_top_domains_from_daily_rows_impl(detailed_rows, limit, source=source),
        "source": source,
        "state": "ready",
        "sync_pending": False,
    }


def _fetch_local_activity_event_rows_impl(
    *,
    start_ms: int,
    end_ms: int,
    user_ids: List[str],
    device_id: Optional[str] = None,
) -> List[tuple[Any, Any, Any, Any, Any, Any]]:
    import sqlite3

    db_path = get_local_watcher_db_path_impl()
    if not os.path.exists(db_path):
        return []

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        user_clause, user_params = _sqlite_user_filter_clause(user_ids)
        device_clause = ""
        params: List[Any] = [end_ms, start_ms, *user_params]
        if device_id:
            device_clause = " AND device_id = ?"
            params.append(device_id)
        cursor.execute(
            """
            SELECT
                ts_start,
                ts_end,
                COALESCE(is_afk, 0) AS is_afk,
                COALESCE(app_bundle_id, '') AS app_bundle_id,
                COALESCE(app_name, '') AS app_name,
                COALESCE(browser_domain, '') AS browser_domain
            FROM activity_events
            WHERE ts_start < ? AND ts_end > ?
            """
            + user_clause
            + """
              AND ts_end > ts_start
            """
            + device_clause
            + """
            ORDER BY ts_start ASC
            """,
            params,
        )
        rows = cursor.fetchall()
        conn.close()
        return rows
    except Exception as exc:
        logger.warning("Failed local watcher activity query: %s", exc)
        return []


def _build_snapshot_from_sql_aggregate_rows_impl(
    *,
    daily_rows_raw: List[tuple[Any, ...]],
    app_rows_raw: List[tuple[Any, ...]],
    domain_rows_raw: List[tuple[Any, ...]],
    source: str,
) -> Optional[Dict[str, Any]]:
    if not daily_rows_raw:
        return None

    daily_rows = [
        {
            "day": str(row[0] or ""),
            "active_ms": int(row[1] or 0),
            "afk_ms": int(row[2] or 0),
            "events_count": int(row[3] or 0),
            "apps_count": int(row[4] or 0),
            "domains_count": int(row[5] or 0),
            "active_hours": round(int(row[1] or 0) / (1000 * 60 * 60), 2),
            "source": source,
        }
        for row in daily_rows_raw
        if row[0]
    ]
    if not daily_rows:
        return None

    app_rows = [
        {
            "app_bundle_id": str(row[0] or "unknown"),
            "app_name": str(row[1] or row[0] or "Unknown"),
            "total_active_ms": int(row[2] or 0),
            "total_events": int(row[3] or 0),
            "days_used": int(row[4] or 0),
            "hours": round(int(row[2] or 0) / (1000 * 60 * 60), 2),
            "source": source,
        }
        for row in app_rows_raw
        if int(row[2] or 0) > 0
    ]
    domain_rows = [
        {
            "domain": str(row[0] or ""),
            "total_active_ms": int(row[1] or 0),
            "total_events": int(row[2] or 0),
            "days_used": int(row[3] or 0),
            "hours": round(int(row[1] or 0) / (1000 * 60 * 60), 2),
            "minutes": round(int(row[1] or 0) / (1000 * 60), 1),
            "source": source,
        }
        for row in domain_rows_raw
        if row[0] and int(row[1] or 0) > 0
    ]

    total_active_ms = sum(int(row["active_ms"]) for row in daily_rows)
    total_afk_ms = sum(int(row["afk_ms"]) for row in daily_rows)
    total_events = sum(int(row["events_count"]) for row in daily_rows)
    days_tracked = sum(1 for row in daily_rows if int(row["active_ms"]) > 0)
    total_hours = round(total_active_ms / (1000 * 60 * 60), 2)

    return {
        "summary": {
            "total_active_ms": total_active_ms,
            "total_hours": total_hours,
            "total_events": total_events,
            "days_tracked": days_tracked,
            "unique_apps": len({row["app_bundle_id"] for row in app_rows}),
            "unique_domains": len({row["domain"] for row in domain_rows}),
            "total_afk_ms": total_afk_ms,
            "avg_daily_hours": round(total_hours / max(days_tracked, 1), 2),
            "source": source,
        },
        "daily": daily_rows,
        "apps": app_rows,
        "domains": domain_rows,
        "source": source,
        "state": "ready",
        "sync_pending": False,
    }


async def _fetch_remote_activity_sql_aggregate_snapshot_impl(
    *,
    user_id: str,
    activity_user_ids: List[str],
    start_ms: int,
    end_ms: int,
    limit: int,
    device_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    user_placeholders = ", ".join(["?"] * len(activity_user_ids))
    device_clause = ""
    base_filter_params: List[Any] = [end_ms, start_ms, *activity_user_ids]
    if device_id:
        device_clause = " AND device_id = ?"
        base_filter_params.append(device_id)

    cte = f"""
        WITH base AS (
            SELECT
                strftime('%Y-%m-%d', ts_start / 1000, 'unixepoch') AS day,
                MAX(ts_start, ?) AS start_ms,
                MIN(
                    CASE
                        WHEN (ts_end - ts_start) > ? THEN ts_start + ?
                        ELSE ts_end
                    END,
                    ?
                ) AS end_ms,
                COALESCE(is_afk, 0) AS is_afk,
                COALESCE(app_bundle_id, '') AS app_bundle_id,
                COALESCE(app_name, '') AS app_name,
                COALESCE(browser_domain, '') AS browser_domain
            FROM activity_events
            WHERE ts_start < ?
              AND ts_end > ?
              AND user_id IN ({user_placeholders})
              AND ts_end > ts_start
              {device_clause}
        ),
        clipped AS (
            SELECT *
            FROM base
            WHERE end_ms > start_ms
        ),
        active_intervals AS (
            SELECT day, start_ms, end_ms, app_bundle_id, app_name, browser_domain
            FROM clipped
            WHERE is_afk = 0
        ),
        afk_intervals AS (
            SELECT day, start_ms, end_ms
            FROM clipped
            WHERE is_afk = 1
        )
    """
    params_prefix = [start_ms, MAX_SINGLE_EVENT_MS, MAX_SINGLE_EVENT_MS, end_ms, *base_filter_params]

    daily_result = await fetch_remote_activity_rows(
        user_id,
        cte
        + """
        , active_ordered AS (
            SELECT *, MAX(end_ms) OVER (
                PARTITION BY day
                ORDER BY start_ms, end_ms
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ) AS prev_max_end
            FROM active_intervals
        ),
        active_grouped AS (
            SELECT *, SUM(
                CASE WHEN prev_max_end IS NULL OR start_ms > prev_max_end THEN 1 ELSE 0 END
            ) OVER (
                PARTITION BY day
                ORDER BY start_ms, end_ms
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS island_id
            FROM active_ordered
        ),
        active_islands AS (
            SELECT day, island_id, MIN(start_ms) AS island_start, MAX(end_ms) AS island_end
            FROM active_grouped
            GROUP BY day, island_id
        ),
        active_by_day AS (
            SELECT day, SUM(island_end - island_start) AS active_ms
            FROM active_islands
            GROUP BY day
        ),
        afk_ordered AS (
            SELECT *, MAX(end_ms) OVER (
                PARTITION BY day
                ORDER BY start_ms, end_ms
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ) AS prev_max_end
            FROM afk_intervals
        ),
        afk_grouped AS (
            SELECT *, SUM(
                CASE WHEN prev_max_end IS NULL OR start_ms > prev_max_end THEN 1 ELSE 0 END
            ) OVER (
                PARTITION BY day
                ORDER BY start_ms, end_ms
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS island_id
            FROM afk_ordered
        ),
        afk_islands AS (
            SELECT day, island_id, MIN(start_ms) AS island_start, MAX(end_ms) AS island_end
            FROM afk_grouped
            GROUP BY day, island_id
        ),
        afk_by_day AS (
            SELECT day, SUM(island_end - island_start) AS afk_ms
            FROM afk_islands
            GROUP BY day
        ),
        day_keys AS (
            SELECT day FROM active_by_day
            UNION
            SELECT day FROM afk_by_day
        ),
        event_counts AS (
            SELECT
                day,
                COUNT(*) AS events_count,
                COUNT(DISTINCT CASE WHEN app_bundle_id != '' THEN app_bundle_id ELSE NULL END) AS apps_count,
                COUNT(DISTINCT CASE WHEN browser_domain != '' THEN browser_domain ELSE NULL END) AS domains_count
            FROM active_intervals
            GROUP BY day
        )
        SELECT
            day_keys.day,
            COALESCE(active_by_day.active_ms, 0) AS active_ms,
            COALESCE(afk_by_day.afk_ms, 0) AS afk_ms,
            COALESCE(event_counts.events_count, 0) AS events_count,
            COALESCE(event_counts.apps_count, 0) AS apps_count,
            COALESCE(event_counts.domains_count, 0) AS domains_count
        FROM day_keys
        LEFT JOIN active_by_day ON active_by_day.day = day_keys.day
        LEFT JOIN afk_by_day ON afk_by_day.day = day_keys.day
        LEFT JOIN event_counts ON event_counts.day = day_keys.day
        ORDER BY day_keys.day ASC
        """,
        params_prefix,
    )
    if daily_result.error or not daily_result.rows:
        if daily_result.error:
            logger.info("Remote SQL aggregate daily read unavailable: %s", daily_result.error)
        return None

    app_result = await fetch_remote_activity_rows(
        user_id,
        cte
        + """
        , app_ordered AS (
            SELECT *, MAX(end_ms) OVER (
                PARTITION BY day, app_bundle_id
                ORDER BY start_ms, end_ms
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ) AS prev_max_end
            FROM active_intervals
            WHERE app_bundle_id != ''
        ),
        app_grouped AS (
            SELECT *, SUM(
                CASE WHEN prev_max_end IS NULL OR start_ms > prev_max_end THEN 1 ELSE 0 END
            ) OVER (
                PARTITION BY day, app_bundle_id
                ORDER BY start_ms, end_ms
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS island_id
            FROM app_ordered
        ),
        app_islands AS (
            SELECT
                day,
                app_bundle_id,
                MAX(app_name) AS app_name,
                island_id,
                MIN(start_ms) AS island_start,
                MAX(end_ms) AS island_end,
                COUNT(*) AS event_count
            FROM app_grouped
            GROUP BY day, app_bundle_id, island_id
        )
        SELECT app_bundle_id, MAX(app_name) AS app_name, SUM(island_end - island_start) AS total_active_ms,
               SUM(event_count) AS total_events, COUNT(DISTINCT day) AS days_used
        FROM app_islands
        GROUP BY app_bundle_id
        ORDER BY total_active_ms DESC
        LIMIT ?
        """,
        [*params_prefix, max(1, min(int(limit or 10), 100))],
    )
    domain_result = await fetch_remote_activity_rows(
        user_id,
        cte
        + """
        , domain_ordered AS (
            SELECT *, MAX(end_ms) OVER (
                PARTITION BY day, browser_domain
                ORDER BY start_ms, end_ms
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ) AS prev_max_end
            FROM active_intervals
            WHERE browser_domain != ''
        ),
        domain_grouped AS (
            SELECT *, SUM(
                CASE WHEN prev_max_end IS NULL OR start_ms > prev_max_end THEN 1 ELSE 0 END
            ) OVER (
                PARTITION BY day, browser_domain
                ORDER BY start_ms, end_ms
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS island_id
            FROM domain_ordered
        ),
        domain_islands AS (
            SELECT
                day,
                browser_domain,
                island_id,
                MIN(start_ms) AS island_start,
                MAX(end_ms) AS island_end,
                COUNT(*) AS event_count
            FROM domain_grouped
            GROUP BY day, browser_domain, island_id
        )
        SELECT browser_domain, SUM(island_end - island_start) AS total_active_ms,
               SUM(event_count) AS total_events, COUNT(DISTINCT day) AS days_used
        FROM domain_islands
        GROUP BY browser_domain
        ORDER BY total_active_ms DESC
        LIMIT ?
        """,
        [*params_prefix, max(1, min(int(limit or 10), 100))],
    )

    return _build_snapshot_from_sql_aggregate_rows_impl(
        daily_rows_raw=daily_result.rows,
        app_rows_raw=[] if app_result.error else app_result.rows,
        domain_rows_raw=[] if domain_result.error else domain_result.rows,
        source="turso_remote_sql_deoverlap",
    )


async def _build_computer_activity_snapshot_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    *,
    limit: int = 10,
    device_id: Optional[str] = None,
) -> Dict[str, Any]:
    start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
    end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
    start_ms = int(start_date_obj.timestamp() * 1000)
    end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)
    range_days = max(1, (end_date_obj - start_date_obj).days + 1)
    activity_user_ids = _resolve_activity_user_ids(user_id)
    user_placeholders = ", ".join(["?"] * len(activity_user_ids))
    params: List[Any] = [end_ms, start_ms, *activity_user_ids]
    device_clause = ""
    if device_id:
        device_clause = " AND device_id = ?"
        params.append(device_id)

    aggregate_timed_out = False
    try:
        aggregate_snapshot = await asyncio.wait_for(
            _fetch_remote_activity_sql_aggregate_snapshot_impl(
                user_id=user_id,
                activity_user_ids=activity_user_ids,
                start_ms=start_ms,
                end_ms=end_ms,
                limit=limit,
                device_id=device_id,
            ),
            timeout=REMOTE_AGGREGATE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        aggregate_timed_out = True
        aggregate_snapshot = None
        logger.warning(
            "Remote computer activity aggregate timed out after %.1fs for user=%s range=%s..%s",
            REMOTE_AGGREGATE_TIMEOUT_SECONDS,
            user_id,
            start_date,
            end_date,
        )
    if aggregate_snapshot:
        return aggregate_snapshot

    if aggregate_timed_out:
        local_rows = _fetch_local_activity_event_rows_impl(
            start_ms=start_ms,
            end_ms=end_ms,
            user_ids=activity_user_ids,
            device_id=device_id,
        )
        if local_rows:
            snapshot = _build_snapshot_from_event_rows_impl(
                local_rows,
                start_ms=start_ms,
                end_ms=end_ms,
                source="legacy_fallback",
                limit=limit,
            )
            snapshot["state"] = "legacy_fallback"
            return snapshot

        try:
            access = await turso_user_service.get_user_activity_access(user_id)
        except Exception:
            access = None
        if getattr(access, "use_per_user_db", False):
            return _empty_computer_activity_snapshot(
                source="sync_pending",
                empty_reason="remote_activity_aggregate_timeout",
            )

    remote_result = None
    raw_timed_out = False
    if range_days <= RAW_EVENT_FALLBACK_MAX_DAYS:
        try:
            remote_result = await asyncio.wait_for(
                fetch_remote_activity_rows(
                    user_id,
                    f"""
                    SELECT
                        ts_start,
                        ts_end,
                        COALESCE(is_afk, 0) AS is_afk,
                        COALESCE(app_bundle_id, '') AS app_bundle_id,
                        COALESCE(app_name, '') AS app_name,
                        COALESCE(browser_domain, '') AS browser_domain
                    FROM activity_events
                    WHERE ts_start < ? AND ts_end > ?
                      AND user_id IN ({user_placeholders})
                      AND ts_end > ts_start
                      {device_clause}
                    ORDER BY ts_start ASC
                    """,
                    params,
                ),
                timeout=REMOTE_RAW_READ_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            raw_timed_out = True
            logger.warning(
                "Remote computer activity raw fallback timed out after %.1fs for user=%s range=%s..%s",
                REMOTE_RAW_READ_TIMEOUT_SECONDS,
                user_id,
                start_date,
                end_date,
            )
        if remote_result is not None and remote_result.rows:
            return _build_snapshot_from_event_rows_impl(
                remote_result.rows,
                start_ms=start_ms,
                end_ms=end_ms,
                source="turso_remote",
                limit=limit,
            )
    else:
        logger.info(
            "Skipping raw activity row fallback for %s-day computer snapshot; compact aggregate unavailable",
            range_days,
        )

    local_rows = _fetch_local_activity_event_rows_impl(
        start_ms=start_ms,
        end_ms=end_ms,
        user_ids=activity_user_ids,
        device_id=device_id,
    )
    if local_rows:
        snapshot = _build_snapshot_from_event_rows_impl(
            local_rows,
            start_ms=start_ms,
            end_ms=end_ms,
            source="legacy_fallback",
            limit=limit,
        )
        snapshot["state"] = "legacy_fallback"
        return snapshot

    if remote_result is not None and remote_result.expected_remote:
        return _empty_computer_activity_snapshot(
            source="sync_pending",
            empty_reason=remote_result.error or "remote_activity_unhydrated",
        )
    if raw_timed_out:
        try:
            access = await turso_user_service.get_user_activity_access(user_id)
        except Exception:
            access = None
        if getattr(access, "use_per_user_db", False):
            return _empty_computer_activity_snapshot(
                source="sync_pending",
                empty_reason="remote_activity_raw_timeout",
            )
    if remote_result is None:
        try:
            access = await turso_user_service.get_user_activity_access(user_id)
        except Exception:
            access = None
        if getattr(access, "use_per_user_db", False):
            return _empty_computer_activity_snapshot(
                source="sync_pending",
                empty_reason="compact_activity_aggregate_unavailable",
            )

    return _empty_computer_activity_snapshot(
        source="legacy_fallback",
        empty_reason="no_activity_rows",
    )


async def get_computer_activity_snapshot_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    *,
    limit: int = 10,
    device_id: Optional[str] = None,
) -> Dict[str, Any]:
    return await _build_computer_activity_snapshot_impl(
        service,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        device_id=device_id,
    )


async def _sync_computer_activity_range_to_tinybird_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
) -> Dict[str, Any]:
    """Refresh computer_activity_daily rows in Tinybird for the selected date range."""
    cache_key = service._build_computer_activity_sync_cache_key(user_id, start_date, end_date)
    now_epoch = time.time()
    last_sync = service._computer_activity_sync_cache.get(cache_key)
    if last_sync and (now_epoch - last_sync) < service._computer_activity_sync_ttl_seconds:
        return {"success": True, "synced_rows": 0, "cached": True}

    lock = service._computer_activity_sync_locks.setdefault(cache_key, asyncio.Lock())
    async with lock:
        now_epoch = time.time()
        last_sync = service._computer_activity_sync_cache.get(cache_key)
        if last_sync and (now_epoch - last_sync) < service._computer_activity_sync_ttl_seconds:
            return {"success": True, "synced_rows": 0, "cached": True}

        tinybird = service._get_tinybird_service()
        if not tinybird:
            return {"success": False, "error": "Tinybird service unavailable"}

        local_rows = service._get_computer_activity_daily_rows_from_local_db(
            start_date,
            end_date,
            user_id=user_id,
        )
        now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        delete_condition = (
            f"user_id = '{service._escape_tinybird_literal(user_id)}' "
            f"AND day >= toDate('{service._escape_tinybird_literal(start_date)}') "
            f"AND day <= toDate('{service._escape_tinybird_literal(end_date)}')"
        )
        delete_result = await tinybird.delete_by_condition(
            "computer_activity_daily",
            delete_condition,
            wait_for_completion=True,
            timeout_seconds=90.0,
            poll_interval_seconds=2.0,
        )
        if not delete_result.get("success"):
            return {
                "success": False,
                "error": delete_result.get("error", "Tinybird delete failed"),
                "synced_rows": 0,
            }

        if not local_rows:
            service._computer_activity_sync_cache[cache_key] = now_epoch
            return {"success": True, "synced_rows": 0, "cached": False}

        events = [
            {
                "user_id": user_id,
                "device_id": "local",
                "day": row["day"],
                "app_bundle_id": row["app_bundle_id"],
                "app_name": row["app_name"],
                "active_ms": row["active_ms"],
                "afk_ms": row["afk_ms"],
                "events_count": row["events_count"],
                "title_hash": "none",
                "browser_domain": row["browser_domain"],
                "first_start_ms": row["first_start_ms"],
                "last_end_ms": row["last_end_ms"],
                "created_at": now_utc,
            }
            for row in local_rows
        ]

        chunk_size = 500
        synced_rows = 0
        for i in range(0, len(events), chunk_size):
            chunk = events[i : i + chunk_size]
            ingest_result = await tinybird.ingest_events("computer_activity_daily", chunk)
            if not ingest_result.get("success"):
                return {
                    "success": False,
                    "error": ingest_result.get("error", "Tinybird ingest failed"),
                    "synced_rows": synced_rows,
                }
            synced_rows += len(chunk)

        service._computer_activity_sync_cache[cache_key] = now_epoch
        return {"success": True, "synced_rows": synced_rows, "cached": False}


async def _query_computer_activity_summary_pipe_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    output: str,
    limit: int = 10,
    kind: Optional[str] = None,
    key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    tinybird = service._get_tinybird_service()
    if not tinybird:
        return []

    params: Dict[str, Any] = {
        "user_id": user_id,
        "start_date": start_date,
        "end_date": end_date,
        "output": output,
        "limit": max(1, min(int(limit or 10), 100)),
    }
    if kind:
        params["kind"] = kind
    if key:
        params["key"] = key

    try:
        result = await tinybird.query_pipe("computer_activity_summary", params)
        return result.get("data") or []
    except Exception as e:
        logger.warning("Tinybird computer_activity_summary query failed (%s): %s", output, e)
        return []


async def _get_computer_activity_pipe_rows_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    output: str,
    limit: int = 10,
    kind: Optional[str] = None,
    key: Optional[str] = None,
    refresh_before_read: bool = False,
) -> List[Dict[str, Any]]:
    # Reads are intentionally read-only by default. Forcing a Tinybird delete +
    # reingest on every request made dashboard traffic unexpectedly expensive.
    # Keep refresh available only for explicit call sites that truly need it.
    if refresh_before_read:
        sync_result = await service._sync_computer_activity_range_to_tinybird(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )
        if not sync_result.get("success"):
            logger.info(
                "Computer activity Tinybird sync unavailable: %s",
                sync_result.get("error"),
            )

    return await service._query_computer_activity_summary_pipe(
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        output=output,
        limit=limit,
        kind=kind,
        key=key,
    )


async def get_computer_time_summary_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
) -> Dict:
    """Get total computer time summary for a date range."""
    perf_start = time.perf_counter()
    snapshot = await _build_computer_activity_snapshot_impl(
        service,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        limit=10,
        device_id=device_id,
    )
    summary = dict(snapshot["summary"])
    _log_activity_perf(
        "summary",
        start=perf_start,
        source=str(snapshot.get("source") or summary.get("source") or "unknown"),
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        row_count=len(snapshot.get("daily") or []),
        empty_reason=snapshot.get("empty_reason"),
        extra={
            "state": snapshot.get("state"),
            "sync_pending": bool(snapshot.get("sync_pending")),
            "total_active_ms": int(summary.get("total_active_ms", 0) or 0),
            "events_count": int(summary.get("total_events", 0) or 0),
        },
    )
    return summary


async def get_daily_computer_time_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
) -> List[Dict]:
    """Get daily computer time for charting."""
    perf_start = time.perf_counter()
    snapshot = await _build_computer_activity_snapshot_impl(
        service,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        limit=10,
        device_id=device_id,
    )
    daily_rows = list(snapshot.get("daily") or [])
    _log_activity_perf(
        "daily",
        start=perf_start,
        source=str(snapshot.get("source") or "unknown"),
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        row_count=len(daily_rows),
        empty_reason=snapshot.get("empty_reason"),
        extra={
            "state": snapshot.get("state"),
            "sync_pending": bool(snapshot.get("sync_pending")),
        },
    )
    return daily_rows


async def get_usage_daily_breakdown_impl(
    service,
    user_id: str,
    kind: str,
    key: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
) -> List[Dict]:
    """Get daily usage breakdown for a specific app or website."""
    local_daily_rows = service._get_computer_activity_daily_rows_from_local_db(
        start_date=start_date,
        end_date=end_date,
        user_id=user_id,
    )
    if local_daily_rows:
        target_key = str(key or "").strip().lower()
        buckets: Dict[str, Dict[str, Any]] = {}

        for row in local_daily_rows:
            row_day = str(row.get("day") or "")
            if not row_day:
                continue

            app_bundle = str(row.get("app_bundle_id") or "").strip().lower()
            app_name = str(row.get("app_name") or "").strip().lower()
            domain = str(row.get("browser_domain") or "").strip().lower()

            matches = False
            if kind == "app":
                matches = bool(target_key) and (app_bundle == target_key or app_name == target_key)
            else:
                matches = bool(target_key) and domain == target_key

            if not matches:
                continue

            active_ms = int(row.get("active_ms", 0) or 0)
            if active_ms <= 0:
                continue

            bucket = buckets.setdefault(
                row_day,
                {
                    "active_ms": 0,
                    "events_count": 0,
                    "first_start_ms": None,
                    "last_end_ms": None,
                },
            )
            bucket["active_ms"] += active_ms
            bucket["events_count"] += int(row.get("events_count", 0) or 0)

            first_start = row.get("first_start_ms")
            if first_start is not None:
                first_i = int(first_start)
                bucket["first_start_ms"] = (
                    first_i
                    if bucket["first_start_ms"] is None
                    else min(int(bucket["first_start_ms"]), first_i)
                )

            last_end = row.get("last_end_ms")
            if last_end is not None:
                last_i = int(last_end)
                bucket["last_end_ms"] = (
                    last_i
                    if bucket["last_end_ms"] is None
                    else max(int(bucket["last_end_ms"]), last_i)
                )

        if buckets:
            return [
                {
                    "day": day,
                    "active_ms": int(bucket["active_ms"]),
                    "events_count": int(bucket["events_count"]),
                    "first_start_ms": int(bucket["first_start_ms"]) if bucket["first_start_ms"] is not None else None,
                    "last_end_ms": int(bucket["last_end_ms"]) if bucket["last_end_ms"] is not None else None,
                    "source": "local_dedup",
                }
                for day, bucket in sorted(buckets.items(), key=lambda item: item[0])
            ]

    tinybird_rows = await service._get_computer_activity_pipe_rows(
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        output="breakdown",
        kind=kind,
        key=key,
        limit=400,
    )
    if tinybird_rows:
        return [
            {
                "day": row.get("day"),
                "active_ms": int(row.get("active_ms", 0) or 0),
                "events_count": int(row.get("events_count", 0) or 0),
                "first_start_ms": int(row.get("first_start_ms"))
                if row.get("first_start_ms") is not None
                else None,
                "last_end_ms": int(row.get("last_end_ms"))
                if row.get("last_end_ms") is not None
                else None,
                "source": "tinybird",
            }
            for row in tinybird_rows
        ]

    import sqlite3

    db_path = get_local_watcher_db_path_impl()
    if not os.path.exists(db_path):
        logger.info("Local watcher database not found at: %s", db_path)
        return []

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
        start_ms = int(start_date_obj.timestamp() * 1000)
        end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)

        if kind == "app":
            cursor.execute(
                """
                SELECT ts_start, ts_end, COALESCE(is_afk, 0) as is_afk
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                  AND (app_bundle_id = ? OR app_name = ?)
                """,
                (start_ms, end_ms, key, key),
            )
        else:
            cursor.execute(
                """
                SELECT ts_start, ts_end, COALESCE(is_afk, 0) as is_afk
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                  AND browser_domain = ?
                """,
                (start_ms, end_ms, key),
            )

        rows = cursor.fetchall()
        conn.close()

        buckets: Dict[str, Dict[str, Any]] = {}

        for ts_start, ts_end, is_afk in rows:
            if is_afk:
                continue
            if ts_end <= ts_start:
                continue

            day_key = datetime.fromtimestamp(ts_start / 1000).strftime("%Y-%m-%d")

            if day_key not in buckets:
                buckets[day_key] = {
                    "intervals": [],
                    "events_count": 0,
                }

            buckets[day_key]["intervals"].append((ts_start, ts_end))
            buckets[day_key]["events_count"] += 1

        results = []
        for day_key in sorted(buckets.keys()):
            intervals = buckets[day_key]["intervals"]
            merged = merge_time_intervals_impl(intervals)
            active_ms = sum(end - start for start, end in merged)
            first_start_ms = merged[0][0] if merged else None
            last_end_ms = merged[-1][1] if merged else None

            results.append(
                {
                    "day": day_key,
                    "active_ms": active_ms,
                    "events_count": buckets[day_key]["events_count"],
                    "first_start_ms": first_start_ms,
                    "last_end_ms": last_end_ms,
                }
            )

        logger.info(
            "Local watcher breakdown %s %s %s to %s: %s days",
            kind,
            key,
            start_date,
            end_date,
            len(results),
        )

        return results
    except Exception as e:
        logger.warning("Error reading usage breakdown from local DB: %s", e)
        return []
