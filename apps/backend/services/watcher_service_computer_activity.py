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
    open_activity_connection_for_user,
)

logger = logging.getLogger(__name__)

# Guardrail: extremely long single events are typically stale heartbeat artifacts.
# Keep this configurable, but default to 15 minutes for analytics rollups.
MAX_SINGLE_EVENT_MS = max(60_000, int(os.getenv("WATCHER_MAX_SINGLE_EVENT_MS", "900000")))


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
              AND ts_end > ts_start
            ORDER BY ts_start ASC
            """,
            (end_ms, start_ms),
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
              AND ts_end > ts_start
            ORDER BY ts_start ASC
            """,
            (end_ms, start_ms),
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
              AND ts_end > ts_start
              AND COALESCE(is_afk, 0) = 0
            """,
            (end_ms, start_ms),
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

        local_rows = service._get_computer_activity_daily_rows_from_local_db(start_date, end_date)
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
    start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
    end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
    start_ms = int(start_date_obj.timestamp() * 1000)
    end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)

    async with open_activity_connection_for_user(user_id) as conn:
        if conn is not None:
            params: list[Any] = [end_ms, start_ms, user_id]
            device_clause = ""
            if device_id:
                device_clause = " AND device_id = ?"
                params.append(device_id)

            rows = conn.execute(
                f"""
                SELECT
                    ts_start,
                    ts_end,
                    COALESCE(is_afk, 0) AS is_afk,
                    COALESCE(app_bundle_id, '') AS app_bundle_id,
                    COALESCE(browser_domain, '') AS browser_domain
                FROM activity_events
                WHERE ts_start < ? AND ts_end > ?
                  AND user_id = ?
                  AND ts_end > ts_start
                  {device_clause}
                ORDER BY ts_start ASC
                """,
                params,
            ).fetchall()

            if rows:
                local_daily_rows = _aggregate_computer_activity_daily_totals_from_events_impl(rows, start_ms, end_ms)
                total_active_ms = sum(int(row.get("active_ms", 0) or 0) for row in local_daily_rows)
                total_afk_ms = sum(int(row.get("afk_ms", 0) or 0) for row in local_daily_rows)
                total_events = sum(int(row.get("events_count", 0) or 0) for row in local_daily_rows)
                days_tracked = sum(1 for row in local_daily_rows if int(row.get("active_ms", 0) or 0) > 0)
                unique_apps = len({
                    str(row[3] or "").strip()
                    for row in rows
                    if str(row[3] or "").strip()
                })
                unique_domains = len({
                    str(row[4] or "").strip()
                    for row in rows
                    if str(row[4] or "").strip()
                })
                total_hours = round(total_active_ms / (1000 * 60 * 60), 2)
                avg_daily_hours = round(total_hours / max(days_tracked, 1), 2)

                return {
                    "total_active_ms": total_active_ms,
                    "total_hours": total_hours,
                    "total_events": total_events,
                    "days_tracked": days_tracked,
                    "unique_apps": unique_apps,
                    "unique_domains": unique_domains,
                    "total_afk_ms": total_afk_ms,
                    "avg_daily_hours": avg_daily_hours,
                    "source": "activity_db",
                }

    local_daily_rows = _get_computer_activity_daily_totals_from_local_db_impl(
        start_date=start_date,
        end_date=end_date,
    )
    if local_daily_rows:
        distinct_counts = _get_computer_activity_distinct_counts_from_local_db_impl(
            start_date=start_date,
            end_date=end_date,
        )
        total_active_ms = sum(int(row.get("active_ms", 0) or 0) for row in local_daily_rows)
        total_afk_ms = sum(int(row.get("afk_ms", 0) or 0) for row in local_daily_rows)
        total_events = sum(int(row.get("events_count", 0) or 0) for row in local_daily_rows)
        days_tracked = sum(1 for row in local_daily_rows if int(row.get("active_ms", 0) or 0) > 0)

        total_hours = round(total_active_ms / (1000 * 60 * 60), 2)
        avg_daily_hours = round(total_hours / max(days_tracked, 1), 2)

        return {
            "total_active_ms": int(total_active_ms),
            "total_hours": total_hours,
            "total_events": int(total_events),
            "days_tracked": int(days_tracked),
            "unique_apps": int(distinct_counts.get("unique_apps", 0)),
            "unique_domains": int(distinct_counts.get("unique_domains", 0)),
            "total_afk_ms": int(total_afk_ms),
            "avg_daily_hours": avg_daily_hours,
            "source": "local_dedup",
        }

    tinybird_rows = await service._get_computer_activity_pipe_rows(
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        output="summary",
    )
    if tinybird_rows:
        row = tinybird_rows[0]
        total_active_ms = int(row.get("total_active_ms", 0) or 0)
        total_events = int(row.get("total_events", 0) or 0)
        days_tracked = int(row.get("days_tracked", 0) or 0)
        unique_apps = int(row.get("unique_apps", 0) or 0)
        avg_daily_ms = float(row.get("avg_daily_ms", 0) or 0)

        return {
            "total_active_ms": total_active_ms,
            "total_hours": round(total_active_ms / (1000 * 60 * 60), 2),
            "total_events": total_events,
            "days_tracked": days_tracked,
            "unique_apps": unique_apps,
            "unique_domains": int(row.get("unique_domains", 0) or 0),
            "total_afk_ms": int(row.get("total_afk_ms", 0) or 0),
            "avg_daily_hours": round(avg_daily_ms / (1000 * 60 * 60), 2),
            "source": "tinybird",
        }

    import sqlite3

    db_path = get_local_watcher_db_path_impl()
    if not os.path.exists(db_path):
        logger.info("Local watcher database not found at: %s", db_path)
        return {
            "total_active_ms": 0,
            "total_hours": 0,
            "total_events": 0,
            "days_tracked": 0,
            "unique_apps": 0,
            "avg_daily_hours": 0,
        }

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
        start_ms = int(start_date_obj.timestamp() * 1000)
        end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)

        cursor.execute(
            """
            SELECT
                SUM(CASE WHEN COALESCE(is_afk, 0) = 0 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as total_active_ms,
                COUNT(*) as total_events,
                COUNT(DISTINCT date(ts_start/1000, 'unixepoch', 'localtime')) as days_tracked,
                COUNT(DISTINCT app_bundle_id) as unique_apps
            FROM activity_events
            WHERE ts_start >= ? AND ts_start < ?
            """,
            (start_ms, end_ms),
        )

        row = cursor.fetchone()
        conn.close()

        if not row or not row[0]:
            return {
                "total_active_ms": 0,
                "total_hours": 0,
                "total_events": 0,
                "days_tracked": 0,
                "unique_apps": 0,
                "avg_daily_hours": 0,
            }

        total_active_ms = row[0] or 0
        total_events = row[1] or 0
        days_tracked = row[2] or 0
        unique_apps = row[3] or 0

        total_hours = round(total_active_ms / (1000 * 60 * 60), 2)
        avg_daily_hours = round(total_hours / max(days_tracked, 1), 2)

        logger.info(
            "Local watcher summary %s to %s: %sh across %s days, %s apps",
            start_date,
            end_date,
            total_hours,
            days_tracked,
            unique_apps,
        )

        return {
            "total_active_ms": total_active_ms,
            "total_hours": total_hours,
            "total_events": total_events,
            "days_tracked": days_tracked,
            "unique_apps": unique_apps,
            "avg_daily_hours": avg_daily_hours,
        }
    except Exception as e:
        logger.warning("Error reading computer time summary from local DB: %s", e)
        return {
            "total_active_ms": 0,
            "total_hours": 0,
            "total_events": 0,
            "days_tracked": 0,
            "unique_apps": 0,
            "avg_daily_hours": 0,
        }


async def get_daily_computer_time_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
) -> List[Dict]:
    """Get daily computer time for charting.

    Uses fast SQL aggregation from the local watcher DB when available,
    falling back to Tinybird, then to the slower Python dedup path.
    The SQL path is ~100x faster than the Python dedup path and accurate
    enough for daily charting (minor overlap in events is negligible).
    """
    start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
    end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
    start_ms = int(start_date_obj.timestamp() * 1000)
    end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)

    async with open_activity_connection_for_user(user_id) as conn:
        if conn is not None:
            params: list[Any] = [end_ms, start_ms, user_id]
            device_clause = ""
            if device_id:
                device_clause = " AND device_id = ?"
                params.append(device_id)

            rows = conn.execute(
                f"""
                SELECT
                    ts_start,
                    ts_end,
                    COALESCE(is_afk, 0) AS is_afk,
                    COALESCE(app_bundle_id, '') AS app_bundle_id,
                    COALESCE(browser_domain, '') AS browser_domain
                FROM activity_events
                WHERE ts_start < ? AND ts_end > ?
                  AND user_id = ?
                  AND ts_end > ts_start
                  {device_clause}
                ORDER BY ts_start ASC
                """,
                params,
            ).fetchall()

            if rows:
                daily_rows = _aggregate_computer_activity_daily_totals_from_events_impl(rows, start_ms, end_ms)
                return [
                    {
                        "day": row["day"],
                        "active_hours": round((int(row["active_ms"] or 0)) / (1000 * 60 * 60), 2),
                        "active_ms": int(row["active_ms"] or 0),
                        "events_count": int(row["events_count"] or 0),
                        "apps_count": int(row["apps_count"] or 0),
                        "domains_count": int(row["domains_count"] or 0),
                        "source": "activity_db",
                    }
                    for row in daily_rows
                ]

    import sqlite3 as _sqlite3

    _db_path = get_local_watcher_db_path_impl()
    if os.path.exists(_db_path):
        try:
            _start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            _end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            _start_ms = int(_start_dt.timestamp() * 1000)
            _end_ms = int((_end_dt + timedelta(days=1)).timestamp() * 1000)

            _conn = _sqlite3.connect(_db_path)
            _cursor = _conn.cursor()
            _cursor.execute(
                """
                SELECT
                    date(ts_start/1000, 'unixepoch', 'localtime') as day,
                    SUM(CASE WHEN COALESCE(is_afk, 0) = 0 AND ts_end > ts_start
                        THEN ts_end - ts_start ELSE 0 END) as total_active_ms,
                    COUNT(*) as total_events,
                    COUNT(DISTINCT app_bundle_id) as unique_apps
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                GROUP BY day
                ORDER BY day ASC
                """,
                (_start_ms, _end_ms),
            )
            _rows = _cursor.fetchall()
            _conn.close()

            if _rows:
                logger.info(
                    "Fast SQL daily data %s to %s: %d days",
                    start_date, end_date, len(_rows),
                )
                return [
                    {
                        "day": r[0],
                        "active_hours": round((r[1] or 0) / (1000 * 60 * 60), 2),
                        "active_ms": r[1] or 0,
                        "events_count": r[2] or 0,
                        "apps_count": r[3] or 0,
                        "source": "local_sql",
                    }
                    for r in _rows
                ]
        except Exception as _e:
            logger.warning("Fast SQL daily query failed, falling back: %s", _e)

    tinybird_rows = await service._get_computer_activity_pipe_rows(
        user_id=user_id,
        start_date=start_date,
        end_date=end_date,
        output="daily",
    )
    if tinybird_rows:
        return [
            {
                "day": row.get("day"),
                "active_hours": round(
                    (int(row.get("total_active_ms", 0) or 0)) / (1000 * 60 * 60),
                    2,
                ),
                "active_ms": int(row.get("total_active_ms", 0) or 0),
                "afk_ms": int(row.get("total_afk_ms", 0) or 0),
                "events_count": int(row.get("total_events", 0) or 0),
                "apps_count": int(row.get("unique_apps", 0) or 0),
                "domains_count": int(row.get("unique_domains", 0) or 0),
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

        cursor.execute(
            """
            SELECT
                date(ts_start/1000, 'unixepoch', 'localtime') as day,
                SUM(CASE WHEN COALESCE(is_afk, 0) = 0 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as total_active_ms,
                COUNT(*) as total_events,
                COUNT(DISTINCT app_bundle_id) as unique_apps
            FROM activity_events
            WHERE ts_start >= ? AND ts_start < ?
            GROUP BY day
            ORDER BY day ASC
            """,
            (start_ms, end_ms),
        )

        rows = cursor.fetchall()
        conn.close()

        logger.info(
            "Local watcher daily data %s to %s: %s days",
            start_date,
            end_date,
            len(rows),
        )

        return [
            {
                "day": r[0],
                "active_hours": round((r[1] or 0) / (1000 * 60 * 60), 2),
                "active_ms": r[1] or 0,
                "events_count": r[2] or 0,
                "apps_count": r[3] or 0,
            }
            for r in rows
        ]
    except Exception as e:
        logger.warning("Error reading daily computer time from local DB: %s", e)
        return []


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
