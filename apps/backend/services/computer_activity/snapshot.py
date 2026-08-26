"""Snapshot building for computer activity analytics."""

from __future__ import annotations

import asyncio
import json
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
from services.computer_activity.common import (
    IPHONE_ACTIVITY_SOURCE,
    MAX_SINGLE_EVENT_MS,
    RAW_EVENT_FALLBACK_MAX_DAYS,
    REMOTE_AGGREGATE_TIMEOUT_SECONDS,
    REMOTE_RAW_READ_TIMEOUT_SECONDS,
    _activity_source_sql_clause,
    _aggregate_computer_activity_daily_rows_from_events_impl,
    _aggregate_computer_activity_daily_totals_from_events_impl,
    _build_computer_activity_sync_cache_key_impl,
    _clamp_single_event_span_impl,
    _escape_tinybird_literal_impl,
    _get_computer_activity_daily_rows_from_local_db_impl,
    _get_computer_activity_daily_totals_from_local_db_impl,
    _get_computer_activity_distinct_counts_from_local_db_impl,
    _log_activity_perf,
    _normalize_activity_source_filter,
    _perf_ms,
    _resolve_activity_user_ids,
    _split_interval_by_local_day,
    _sqlite_user_filter_clause,
)

logger = logging.getLogger(__name__)

def _empty_computer_activity_snapshot(
    *,
    source: str,
    empty_reason: str,
    state: Optional[str] = None,
    scope: str = "all_devices",
) -> Dict[str, Any]:
    resolved_state = state or ("sync_pending" if source == "sync_pending" else "empty")
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
        "state": resolved_state,
        "scope": scope,
        "last_synced_at": None,
        "sync_pending": resolved_state == "sync_pending",
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
        "scope": "all_devices",
        "last_synced_at": None,
        "sync_pending": False,
    }


def _parse_rollup_json_list(value: Any) -> List[Any]:
    if isinstance(value, list):
        return value
    if not isinstance(value, str) or not value.strip():
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def _normalize_rollup_intervals(value: Any) -> List[tuple[int, int]]:
    intervals: List[tuple[int, int]] = []
    for item in _parse_rollup_json_list(value):
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        try:
            start_ms = int(item[0])
            end_ms = int(item[1])
        except (TypeError, ValueError):
            continue
        if end_ms > start_ms:
            intervals.append((start_ms, end_ms))
    return intervals


def _build_snapshot_from_rollup_rows_impl(
    rows: List[tuple[Any, ...]],
    *,
    limit: int,
    scope: str,
) -> Optional[Dict[str, Any]]:
    if not rows:
        return None

    by_day: Dict[str, Dict[str, Any]] = {}
    app_groups: Dict[tuple[str, str], Dict[str, Any]] = {}
    domain_groups: Dict[str, Dict[str, Any]] = {}
    last_synced_at: Optional[int] = None

    for row in rows:
        day = str(row[0] or "").strip()
        if not day:
            continue
        day_bucket = by_day.setdefault(
            day,
            {
                "active_intervals": [],
                "afk_intervals": [],
                "events_count": 0,
                "apps": set(),
                "domains": set(),
            },
        )
        day_bucket["active_intervals"].extend(_normalize_rollup_intervals(row[1]))
        day_bucket["afk_intervals"].extend(_normalize_rollup_intervals(row[2]))
        day_bucket["events_count"] += max(0, int(row[3] or 0))

        for summary in _parse_rollup_json_list(row[4]):
            if not isinstance(summary, dict):
                continue
            bundle_id = str(
                summary.get("bundle_id") or summary.get("app_bundle_id") or "unknown"
            ).strip() or "unknown"
            app_name = str(
                summary.get("name") or summary.get("app_name") or bundle_id or "Unknown"
            ).strip() or "Unknown"
            active_ms = max(0, int(summary.get("active_ms") or 0))
            events_count = max(0, int(summary.get("events_count") or 0))
            if active_ms <= 0:
                continue
            day_bucket["apps"].add(bundle_id)
            bucket = app_groups.setdefault(
                (bundle_id, app_name),
                {"active_ms": 0, "events_count": 0, "days": set()},
            )
            bucket["active_ms"] += active_ms
            bucket["events_count"] += events_count
            bucket["days"].add(day)

        for summary in _parse_rollup_json_list(row[5]):
            if not isinstance(summary, dict):
                continue
            domain = str(summary.get("domain") or "").strip().lower()
            active_ms = max(0, int(summary.get("active_ms") or 0))
            events_count = max(0, int(summary.get("events_count") or 0))
            if not domain or active_ms <= 0:
                continue
            day_bucket["domains"].add(domain)
            bucket = domain_groups.setdefault(
                domain,
                {"active_ms": 0, "events_count": 0, "days": set()},
            )
            bucket["active_ms"] += active_ms
            bucket["events_count"] += events_count
            bucket["days"].add(day)

        updated_at = int(row[6] or 0)
        if updated_at > 0:
            last_synced_at = max(last_synced_at or 0, updated_at)

    if not by_day:
        return None

    daily: List[Dict[str, Any]] = []
    for day, bucket in sorted(by_day.items()):
        active_intervals = merge_time_intervals_impl(bucket["active_intervals"])
        afk_intervals = merge_time_intervals_impl(bucket["afk_intervals"])
        active_ms = sum(end - start for start, end in active_intervals)
        afk_ms = sum(end - start for start, end in afk_intervals)
        daily.append(
            {
                "day": day,
                "active_hours": round(active_ms / (1000 * 60 * 60), 2),
                "active_ms": active_ms,
                "afk_ms": afk_ms,
                "events_count": int(bucket["events_count"]),
                "apps_count": len(bucket["apps"]),
                "domains_count": len(bucket["domains"]),
                "source": "turso_rollups_v2",
            }
        )

    apps = sorted(app_groups.items(), key=lambda item: item[1]["active_ms"], reverse=True)[
        : max(1, min(int(limit or 10), 100))
    ]
    domains = sorted(domain_groups.items(), key=lambda item: item[1]["active_ms"], reverse=True)[
        : max(1, min(int(limit or 10), 100))
    ]
    total_active_ms = sum(int(row["active_ms"]) for row in daily)
    total_afk_ms = sum(int(row["afk_ms"]) for row in daily)
    total_events = sum(int(row["events_count"]) for row in daily)
    days_tracked = sum(1 for row in daily if int(row["active_ms"]) > 0)
    total_hours = round(total_active_ms / (1000 * 60 * 60), 2)

    return {
        "summary": {
            "total_active_ms": total_active_ms,
            "total_hours": total_hours,
            "total_events": total_events,
            "days_tracked": days_tracked,
            "unique_apps": len({bundle_id for bundle_id, _ in app_groups}),
            "unique_domains": len(domain_groups),
            "total_afk_ms": total_afk_ms,
            "avg_daily_hours": round(total_hours / max(days_tracked, 1), 2),
            "source": "turso_rollups_v2",
        },
        "daily": daily,
        "apps": [
            {
                "app_bundle_id": key[0],
                "app_name": key[1],
                "total_active_ms": int(bucket["active_ms"]),
                "total_events": int(bucket["events_count"]),
                "days_used": len(bucket["days"]),
                "hours": round(int(bucket["active_ms"]) / (1000 * 60 * 60), 2),
                "source": "turso_rollups_v2",
            }
            for key, bucket in apps
        ],
        "domains": [
            {
                "domain": domain,
                "total_active_ms": int(bucket["active_ms"]),
                "total_events": int(bucket["events_count"]),
                "days_used": len(bucket["days"]),
                "hours": round(int(bucket["active_ms"]) / (1000 * 60 * 60), 2),
                "minutes": round(int(bucket["active_ms"]) / (1000 * 60), 1),
                "source": "turso_rollups_v2",
            }
            for domain, bucket in domains
        ],
        "source": "turso_rollups_v2",
        "state": "ready" if total_active_ms > 0 else "empty",
        "scope": scope,
        "last_synced_at": last_synced_at,
        "sync_pending": False,
        "empty_reason": "no_activity_rows" if total_active_ms <= 0 else None,
    }


async def _fetch_remote_activity_rollup_snapshot_impl(
    *,
    user_id: str,
    activity_user_ids: List[str],
    start_date: str,
    end_date: str,
    limit: int,
    device_id: Optional[str] = None,
) -> tuple[Optional[Dict[str, Any]], Any]:
    user_placeholders = ", ".join(["?"] * len(activity_user_ids))
    params: List[Any] = [start_date, end_date, *activity_user_ids]
    device_clause = ""
    if device_id:
        device_clause = " AND device_id = ?"
        params.append(device_id)
    result = await fetch_remote_activity_rows(
        user_id,
        f"""
        SELECT
            date,
            active_intervals_json,
            afk_intervals_json,
            events_count,
            app_summaries_json,
            domain_summaries_json,
            updated_at
        FROM activity_daily_rollups
        WHERE date >= ? AND date <= ?
          AND user_id IN ({user_placeholders})
          {device_clause}
        ORDER BY date ASC, device_id ASC
        """,
        params,
    )
    if result.error or not result.rows:
        return None, result
    return (
        _build_snapshot_from_rollup_rows_impl(
            result.rows,
            limit=limit,
            scope="device" if device_id else "all_devices",
        ),
        result,
    )


def _fetch_local_activity_event_rows_impl(
    *,
    start_ms: int,
    end_ms: int,
    user_ids: List[str],
    device_id: Optional[str] = None,
    source_filter: Optional[str] = None,
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
        source_clause, source_params = _activity_source_sql_clause(source_filter)
        params.extend(source_params)
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
            + source_clause
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
    source_filter: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    user_placeholders = ", ".join(["?"] * len(activity_user_ids))
    device_clause = ""
    base_filter_params: List[Any] = [end_ms, start_ms, *activity_user_ids]
    if device_id:
        device_clause = " AND device_id = ?"
        base_filter_params.append(device_id)
    source_clause, source_params = _activity_source_sql_clause(source_filter)
    base_filter_params.extend(source_params)

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
              {source_clause}
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
    source_filter: Optional[str] = None,
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
    source_clause, source_params = _activity_source_sql_clause(source_filter)
    params.extend(source_params)

    rollup_result = None
    rollup_timed_out = False
    if _normalize_activity_source_filter(source_filter) == "desktop":
        try:
            rollup_snapshot, rollup_result = await asyncio.wait_for(
                _fetch_remote_activity_rollup_snapshot_impl(
                    user_id=user_id,
                    activity_user_ids=activity_user_ids,
                    start_date=start_date,
                    end_date=end_date,
                    limit=limit,
                    device_id=device_id,
                ),
                timeout=REMOTE_AGGREGATE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            rollup_timed_out = True
            rollup_snapshot = None
            logger.warning(
                "Remote computer activity rollup read timed out after %.1fs for user=%s range=%s..%s",
                REMOTE_AGGREGATE_TIMEOUT_SECONDS,
                user_id,
                start_date,
                end_date,
            )
        if rollup_snapshot:
            return rollup_snapshot

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
                      {source_clause}
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
        source_filter=source_filter,
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

    if rollup_timed_out:
        return _empty_computer_activity_snapshot(
            source="unavailable",
            state="unavailable",
            scope="device" if device_id else "all_devices",
            empty_reason="remote_activity_rollup_timeout",
        )
    if remote_result is not None and remote_result.expected_remote and remote_result.error:
        return _empty_computer_activity_snapshot(
            source="unavailable",
            state="unavailable",
            scope="device" if device_id else "all_devices",
            empty_reason=remote_result.error or "remote_activity_unhydrated",
        )
    if raw_timed_out:
        try:
            access = await turso_user_service.get_user_activity_access(user_id)
        except Exception:
            access = None
        if getattr(access, "use_per_user_db", False):
            return _empty_computer_activity_snapshot(
                source="unavailable",
                state="unavailable",
                scope="device" if device_id else "all_devices",
                empty_reason="remote_activity_raw_timeout",
            )
    if rollup_result is not None and rollup_result.error:
        return _empty_computer_activity_snapshot(
            source="unavailable",
            state="unavailable",
            scope="device" if device_id else "all_devices",
            empty_reason=rollup_result.error,
        )
    if range_days > RAW_EVENT_FALLBACK_MAX_DAYS and rollup_result is not None and rollup_result.expected_remote:
        return _empty_computer_activity_snapshot(
            source="sync_pending",
            state="sync_pending",
            scope="device" if device_id else "all_devices",
            empty_reason="activity_rollups_not_materialized",
        )
    if remote_result is None and rollup_result is None:
        try:
            access = await turso_user_service.get_user_activity_access(user_id)
        except Exception:
            access = None
        if getattr(access, "use_per_user_db", False):
            return _empty_computer_activity_snapshot(
                source="sync_pending",
                state="sync_pending",
                scope="device" if device_id else "all_devices",
                empty_reason="activity_rollups_unavailable",
            )

    return _empty_computer_activity_snapshot(
        source="legacy_fallback",
        state="empty",
        scope="device" if device_id else "all_devices",
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
    source_filter: Optional[str] = None,
) -> Dict[str, Any]:
    return await _build_computer_activity_snapshot_impl(
        service,
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        device_id=device_id,
        source_filter=source_filter,
    )
