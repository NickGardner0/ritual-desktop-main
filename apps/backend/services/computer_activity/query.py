"""Query APIs for computer activity summaries and breakdowns."""

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
from services.computer_activity.deps import fetch_remote_activity_rows
from services.computer_activity.common import (
    REMOTE_RAW_READ_TIMEOUT_SECONDS,
    _activity_source_sql_clause,
    _clamp_single_event_span_impl,
    _log_activity_perf,
    _resolve_activity_user_ids,
    _split_interval_by_local_day,
)
from services.computer_activity.snapshot import _build_computer_activity_snapshot_impl

logger = logging.getLogger(__name__)

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
    source_filter: Optional[str] = None,
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
        source_filter=source_filter,
    )
    summary = dict(snapshot["summary"])
    summary.update(
        {
            "state": snapshot.get("state", "empty"),
            "scope": snapshot.get("scope", "all_devices"),
            "last_synced_at": snapshot.get("last_synced_at"),
            "empty_reason": snapshot.get("empty_reason"),
            "sync_pending": bool(snapshot.get("sync_pending")),
        }
    )
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
    source_filter: Optional[str] = None,
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
        source_filter=source_filter,
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
    source_filter: Optional[str] = None,
) -> List[Dict]:
    """Get daily usage breakdown for a specific app or website."""
    local_daily_rows = service._get_computer_activity_daily_rows_from_local_db(
        start_date=start_date,
        end_date=end_date,
        user_id=user_id,
        source_filter=source_filter,
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

    try:
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
        start_ms = int(start_date_obj.timestamp() * 1000)
        end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)
        activity_user_ids = _resolve_activity_user_ids(user_id)
        user_placeholders = ", ".join(["?"] * len(activity_user_ids))
        source_clause, source_params = _activity_source_sql_clause(source_filter)
        target_key = str(key or "").strip()
        kind_clause = (
            "AND (app_bundle_id = ? OR app_name = ?)"
            if kind == "app"
            else "AND browser_domain = ?"
        )
        kind_params: List[Any] = [target_key, target_key] if kind == "app" else [target_key]
        remote_result = await asyncio.wait_for(
            fetch_remote_activity_rows(
                user_id,
                f"""
                SELECT ts_start, ts_end
                FROM activity_events
                WHERE ts_start < ?
                  AND ts_end > ?
                  AND user_id IN ({user_placeholders})
                  AND ts_end > ts_start
                  AND COALESCE(is_afk, 0) = 0
                  {source_clause}
                  {kind_clause}
                ORDER BY ts_start ASC
                """,
                [end_ms, start_ms, *activity_user_ids, *source_params, *kind_params],
            ),
            timeout=REMOTE_RAW_READ_TIMEOUT_SECONDS,
        )
        if remote_result.rows:
            buckets: Dict[str, Dict[str, Any]] = defaultdict(
                lambda: {
                    "intervals": [],
                    "events_count": 0,
                    "first_start_ms": None,
                    "last_end_ms": None,
                }
            )
            for ts_start, ts_end in remote_result.rows:
                bounded_start, bounded_end = _clamp_single_event_span_impl(int(ts_start or 0), int(ts_end or 0))
                clipped_start = max(bounded_start, start_ms)
                clipped_end = min(bounded_end, end_ms)
                if clipped_end <= clipped_start:
                    continue
                for day, seg_start, seg_end in _split_interval_by_local_day(clipped_start, clipped_end):
                    bucket = buckets[day]
                    bucket["intervals"].append((seg_start, seg_end))
                    bucket["events_count"] += 1
                    bucket["first_start_ms"] = (
                        seg_start
                        if bucket["first_start_ms"] is None
                        else min(int(bucket["first_start_ms"]), seg_start)
                    )
                    bucket["last_end_ms"] = (
                        seg_end
                        if bucket["last_end_ms"] is None
                        else max(int(bucket["last_end_ms"]), seg_end)
                    )
            if buckets:
                output: List[Dict[str, Any]] = []
                for day, bucket in sorted(buckets.items(), key=lambda item: item[0]):
                    merged = merge_time_intervals_impl(bucket["intervals"])
                    active_ms = int(sum(end - start for start, end in merged))
                    if active_ms <= 0:
                        continue
                    output.append(
                        {
                            "day": day,
                            "active_ms": active_ms,
                            "events_count": int(bucket["events_count"]),
                            "first_start_ms": int(bucket["first_start_ms"]) if bucket["first_start_ms"] is not None else None,
                            "last_end_ms": int(bucket["last_end_ms"]) if bucket["last_end_ms"] is not None else None,
                            "source": remote_result.source or "turso_remote",
                        }
                    )
                if output:
                    return output
    except asyncio.TimeoutError:
        logger.info("Remote watcher breakdown timed out for user=%s kind=%s key=%s", user_id, kind, key)
    except Exception as exc:
        logger.info("Remote watcher breakdown unavailable for user=%s kind=%s key=%s: %s", user_id, kind, key, exc)

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
        source_clause, source_params = _activity_source_sql_clause(source_filter)

        if kind == "app":
            cursor.execute(
                """
                SELECT ts_start, ts_end, COALESCE(is_afk, 0) as is_afk
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                  {source_clause}
                  AND (app_bundle_id = ? OR app_name = ?)
                """.format(source_clause=source_clause),
                (start_ms, end_ms, *source_params, key, key),
            )
        else:
            cursor.execute(
                """
                SELECT ts_start, ts_end, COALESCE(is_afk, 0) as is_afk
                FROM activity_events
                WHERE ts_start >= ? AND ts_start < ?
                  {source_clause}
                  AND browser_domain = ?
                """.format(source_clause=source_clause),
                (start_ms, end_ms, *source_params, key),
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
