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
from services.computer_activity.deps import fetch_remote_activity_rows, turso_user_service

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
IPHONE_ACTIVITY_SOURCE = "biome_iphone"


def _normalize_activity_source_filter(source_filter: Optional[str]) -> str:
    normalized = (source_filter or "desktop").strip().lower()
    if normalized in {"all", "any", "*"}:
        return "all"
    if normalized in {"iphone", "ios", IPHONE_ACTIVITY_SOURCE}:
        return IPHONE_ACTIVITY_SOURCE
    return "desktop"


def _activity_source_sql_clause(source_filter: Optional[str], *, alias: Optional[str] = None) -> tuple[str, List[Any]]:
    """Return a safe SQL source filter for activity_events.

    Desktop computer time must not accidentally absorb iPhone Biome foreground
    events, while the iPhone Screen Time surface needs an explicit source-only
    view over the same table.
    """
    source = _normalize_activity_source_filter(source_filter)
    column = f"{alias}.source" if alias else "source"
    if source == "all":
        return "", []
    if source == IPHONE_ACTIVITY_SOURCE:
        return f" AND COALESCE({column}, '') = ?", [IPHONE_ACTIVITY_SOURCE]
    return f" AND COALESCE({column}, '') != ?", [IPHONE_ACTIVITY_SOURCE]


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
    source_filter: Optional[str] = None,
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
        source_clause, source_params = _activity_source_sql_clause(source_filter)

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
            + source_clause
            + """
              AND ts_end > ts_start
            ORDER BY ts_start ASC
            """,
            (end_ms, start_ms, *user_params, *source_params),
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
    source_filter: Optional[str] = None,
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
        source_clause, source_params = _activity_source_sql_clause(source_filter)
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
            + source_clause
            + """
              AND ts_end > ts_start
            ORDER BY ts_start ASC
            """,
            (end_ms, start_ms, *user_params, *source_params),
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
    source_filter: Optional[str] = None,
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
        source_clause, source_params = _activity_source_sql_clause(source_filter)
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
            + source_clause
            + """
              AND ts_end > ts_start
              AND COALESCE(is_afk, 0) = 0
            """,
            (end_ms, start_ms, *user_params, *source_params),
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


