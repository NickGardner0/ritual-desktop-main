"""Tinybird sync for computer activity rollups."""

from __future__ import annotations

import asyncio
import time
import logging
from datetime import datetime, timezone
from typing import Any, Dict

logger = logging.getLogger(__name__)

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


