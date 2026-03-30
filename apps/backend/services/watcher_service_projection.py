"""Extracted computer-use projection pipeline logic for WatcherService."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text
from services.watcher_service_local_db import (
    get_local_watcher_db_path_impl,
    merge_time_intervals_impl,
)

logger = logging.getLogger(__name__)


async def _find_computer_use_habit_impl(
    service,
    session,
    user_id: str,
) -> Optional[Tuple[str, str, str]]:
    """Resolve the user's Computer Time habit (legacy aliases supported)."""
    result = await session.execute(
        text(
            """
            SELECT id, name, unit_type FROM habits
            WHERE user_id = :user_id
              AND LOWER(name) = 'computer time'
            LIMIT 1
            """
        ),
        {"user_id": user_id},
    )
    row = result.fetchone()
    if row:
        return row[0], row[1], row[2] or "Hours"

    result = await session.execute(
        text(
            """
            SELECT id, name, unit_type FROM habits
            WHERE user_id = :user_id
              AND LOWER(name) = 'computer use'
            LIMIT 1
            """
        ),
        {"user_id": user_id},
    )
    row = result.fetchone()
    if row:
        return row[0], row[1], row[2] or "Hours"

    result = await session.execute(
        text(
            """
            SELECT id, name, unit_type FROM habits
            WHERE user_id = :user_id
              AND (LOWER(name) LIKE '%computer use%' OR LOWER(name) LIKE '%computer time%')
            LIMIT 1
            """
        ),
        {"user_id": user_id},
    )
    row = result.fetchone()
    if row:
        return row[0], row[1], row[2] or "Hours"
    return None


def _convert_active_ms_to_habit_unit_impl(
    service,
    unit_type: str,
    total_ms: int,
) -> Tuple[float, int]:
    """Convert active milliseconds into (amount, duration_seconds)."""
    duration_seconds = int(total_ms / 1000)
    unit_lower = (unit_type or "hours").lower()
    if unit_lower in ["hours", "hour"]:
        return round(total_ms / (1000 * 60 * 60), 2), duration_seconds
    if unit_lower in ["minutes", "minute"]:
        return round(total_ms / (1000 * 60), 2), duration_seconds
    return round(total_ms / (1000 * 60 * 60), 2), duration_seconds


def _computer_use_projection_dedupe_key_impl(
    service,
    habit_id: str,
    day: str,
) -> str:
    payload = f"computer_use_projection:{habit_id}:{day}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _computer_use_projection_metadata_impl(
    service,
    day: str,
    local_data: Dict[str, Any],
    db_path: str,
) -> str:
    metadata = {
        "projection_type": "computer_use_daily",
        "pipeline_version": service.COMPUTER_USE_PIPELINE_VERSION,
        "source_db": os.path.basename(db_path),
        "source": service.COMPUTER_USE_PROJECTION_SOURCE,
        "day": day,
        "active_ms": int(local_data.get("total_ms", 0) or 0),
        "active_hours": float(local_data.get("total_hours", 0) or 0),
        "events_count": int(local_data.get("events_count", 0) or 0),
        "afk_ms": int(local_data.get("afk_ms", 0) or 0),
        "computed_at": datetime.now().isoformat(),
    }
    top_domains = local_data.get("top_domains") or []
    if top_domains:
        metadata["top_domains"] = top_domains[:5]
    return json.dumps(metadata)


def _projection_source_rank_impl(
    service,
    source: Optional[str],
    notes: Optional[str],
) -> int:
    if source == service.COMPUTER_USE_PROJECTION_SOURCE:
        return 0
    if source == service.COMPUTER_USE_LEGACY_SOURCE:
        return 1
    if not source and (notes or "").lower().startswith("auto-synced from ritual watcher"):
        return 2
    return 9


async def _upsert_computer_use_projection_log_impl(
    service,
    session,
    habit_id: str,
    habit_name: str,
    unit_type: str,
    day: str,
    local_data: Dict[str, Any],
) -> Dict[str, Any]:
    """Upsert a single derived habit_log row for Computer Time projection."""
    total_ms = int(local_data.get("total_ms", 0) or 0)
    amount, duration_seconds = service._convert_active_ms_to_habit_unit(unit_type, total_ms)
    now_iso = datetime.now().isoformat()
    db_path = get_local_watcher_db_path_impl()
    metadata_json = service._computer_use_projection_metadata(day, local_data, db_path)
    dedupe_key = service._computer_use_projection_dedupe_key(habit_id, day)
    source_id = f"computer_use:{day}"
    notes = "Projected from Ritual Watcher (daily aggregate)"

    result = await session.execute(
        text(
            """
            SELECT id, amount, duration, source, notes, completed_at
            FROM habit_logs
            WHERE habit_id = :habit_id
              AND date = :date
            ORDER BY completed_at DESC
            """
        ),
        {"habit_id": habit_id, "date": day},
    )
    rows = result.fetchall()

    existing_log = None
    existing_rank = 99
    for row in rows:
        rank = service._projection_source_rank(row[3], row[4])
        if rank < existing_rank:
            existing_rank = rank
            existing_log = row

    if existing_log:
        log_id = existing_log[0]
        old_amount = existing_log[1] or 0
        previous_source = existing_log[3]
        await session.execute(
            text(
                """
                UPDATE habit_logs
                SET amount = :amount,
                    duration = :duration,
                    habit_name = :habit_name,
                    status = 'completed',
                    notes = :notes,
                    completed_at = :completed_at,
                    source = :source,
                    source_id = :source_id,
                    dedupe_key = :dedupe_key,
                    log_metadata = :log_metadata
                WHERE id = :log_id
                """
            ),
            {
                "log_id": log_id,
                "amount": amount,
                "duration": duration_seconds,
                "habit_name": habit_name,
                "notes": notes,
                "completed_at": now_iso,
                "source": service.COMPUTER_USE_PROJECTION_SOURCE,
                "source_id": source_id,
                "dedupe_key": dedupe_key,
                "log_metadata": metadata_json,
            },
        )
        return {
            "action": "updated",
            "log_id": log_id,
            "previous_amount": old_amount,
            "previous_source": previous_source,
            "amount": amount,
            "duration_seconds": duration_seconds,
            "total_ms": total_ms,
            "notes": notes,
            "source": service.COMPUTER_USE_PROJECTION_SOURCE,
            "log_metadata": metadata_json,
            "unit": unit_type,
            "habit_name": habit_name,
        }

    new_log_id = str(uuid.uuid4())
    await session.execute(
        text(
            """
            INSERT INTO habit_logs (
                id, habit_id, habit_name, date, amount, duration, status, notes,
                completed_at, source, source_id, dedupe_key, log_metadata
            )
            VALUES (
                :id, :habit_id, :habit_name, :date, :amount, :duration, :status, :notes,
                :completed_at, :source, :source_id, :dedupe_key, :log_metadata
            )
            """
        ),
        {
            "id": new_log_id,
            "habit_id": habit_id,
            "habit_name": habit_name,
            "date": day,
            "amount": amount,
            "duration": duration_seconds,
            "status": "completed",
            "notes": notes,
            "completed_at": now_iso,
            "source": service.COMPUTER_USE_PROJECTION_SOURCE,
            "source_id": source_id,
            "dedupe_key": dedupe_key,
            "log_metadata": metadata_json,
        },
    )
    return {
        "action": "created",
        "log_id": new_log_id,
        "amount": amount,
        "duration_seconds": duration_seconds,
        "total_ms": total_ms,
        "notes": notes,
        "source": service.COMPUTER_USE_PROJECTION_SOURCE,
        "log_metadata": metadata_json,
        "unit": unit_type,
        "habit_name": habit_name,
    }


def _get_computer_time_from_local_db_impl(service, day: str) -> Dict:
    """Read computer time from local watcher SQLite database."""
    import sqlite3

    db_path = get_local_watcher_db_path_impl()

    if not os.path.exists(db_path):
        logger.info("Local watcher database not found at: %s", db_path)
        return {
            "ok": False,
            "error": f"Database not found at {db_path}",
            "total_ms": 0,
            "total_hours": 0,
            "events_count": 0,
            "active_ms": 0,
            "afk_ms": 0,
        }

    try:
        conn = None
        cursor = None
        last_error = None

        for _ in range(3):
            try:
                conn = sqlite3.connect(
                    f"file:{db_path}?mode=ro",
                    uri=True,
                    timeout=2.0,
                )
                cursor = conn.cursor()
                cursor.execute("PRAGMA query_only = ON")
                break
            except Exception as e:
                last_error = e
                if conn:
                    conn.close()
                    conn = None
                time.sleep(0.15)

        if not conn or not cursor:
            raise last_error or RuntimeError("Failed to open local activity DB")

        day_date = datetime.strptime(day, "%Y-%m-%d")
        day_start_ms = int(day_date.timestamp() * 1000)
        day_end_ms = day_start_ms + (24 * 60 * 60 * 1000)

        cursor.execute(
            """
            SELECT ts_start, ts_end, COALESCE(is_afk, 0) as is_afk
            FROM activity_events
            WHERE ts_start < ? AND ts_end > ?
              AND ts_end > ts_start
            ORDER BY ts_start
            """,
            (day_end_ms, day_start_ms),
        )

        rows = cursor.fetchall()
        events_count = len(rows)

        active_intervals = []
        afk_intervals = []

        for ts_start, ts_end, is_afk in rows:
            clipped_start = max(ts_start, day_start_ms)
            clipped_end = min(ts_end, day_end_ms)
            if clipped_end <= clipped_start:
                continue

            if is_afk:
                afk_intervals.append((clipped_start, clipped_end))
            else:
                active_intervals.append((clipped_start, clipped_end))

        merged_active = merge_time_intervals_impl(active_intervals)
        merged_afk = merge_time_intervals_impl(afk_intervals)

        active_ms = sum(end - start for start, end in merged_active)
        afk_ms = sum(end - start for start, end in merged_afk)

        total_ms = active_ms
        total_hours = round(total_ms / (1000 * 60 * 60), 2)

        cursor.execute(
            """
            SELECT browser_domain, SUM(ts_end - ts_start) as total_ms
            FROM activity_events
            WHERE ts_start >= ? AND ts_start < ?
              AND browser_domain IS NOT NULL
              AND browser_domain != ''
              AND is_afk = 0
            GROUP BY browser_domain
            ORDER BY total_ms DESC
            LIMIT 5
            """,
            (day_start_ms, day_end_ms),
        )

        top_domains = [{"domain": r[0], "ms": r[1]} for r in cursor.fetchall()]

        conn.close()

        logger.info(
            "Local activity DB (%s) query for %s: %sms active = %sh (%s events, %s merged intervals)",
            os.path.basename(db_path),
            day,
            total_ms,
            total_hours,
            events_count,
            len(merged_active),
        )

        return {
            "ok": True,
            "total_ms": total_ms,
            "total_hours": total_hours,
            "events_count": events_count,
            "active_ms": active_ms,
            "afk_ms": afk_ms,
            "top_domains": top_domains,
        }
    except Exception as e:
        logger.warning("Error reading from local watcher DB: %s", e)
        return {
            "ok": False,
            "error": str(e),
            "total_ms": 0,
            "total_hours": 0,
            "events_count": 0,
            "active_ms": 0,
            "afk_ms": 0,
        }


async def sync_to_computer_use_habit_impl(
    service,
    user_id: str,
    day: Optional[str] = None,
) -> Dict:
    """Sync watcher data to the user's Computer Time habit."""
    if not day:
        day = datetime.now().strftime("%Y-%m-%d")

    try:
        async with service._get_db_session() as session:
            resolved_habit = await service._find_computer_use_habit(session, user_id)
            if not resolved_habit:
                return {
                    "success": False,
                    "error": "No 'Computer Time' habit found. Please create a habit named 'Computer Time' first.",
                    "synced": False,
                }

            habit_id, habit_name, unit_type = resolved_habit

            summary = await service.get_computer_time_summary(
                user_id=user_id,
                start_date=day,
                end_date=day,
            )
            top_domains = await service.get_top_domains(
                user_id=user_id,
                start_date=day,
                end_date=day,
                limit=5,
            )
            local_data = {
                "ok": True,
                "total_ms": int(summary.get("total_active_ms", 0) or 0),
                "total_hours": float(summary.get("total_hours", 0) or 0),
                "events_count": int(summary.get("total_events", 0) or 0),
                "active_ms": int(summary.get("total_active_ms", 0) or 0),
                "afk_ms": int(summary.get("total_afk_ms", 0) or 0),
                "top_domains": top_domains[:5] if isinstance(top_domains, list) else [],
            }

            # Do not write a zero-value Computer Time projection when there is no
            # meaningful activity evidence. In cloud/backend environments the
            # local watcher DB is often unavailable, and a temporary empty
            # summary should not overwrite a previously correct projected value.
            if (
                int(local_data.get("total_ms", 0) or 0) <= 0
                and int(local_data.get("events_count", 0) or 0) <= 0
            ):
                logger.info(
                    "Skipping computer-use projection for %s because no activity evidence was available",
                    day,
                )
                return {
                    "success": True,
                    "synced": False,
                    "skipped": True,
                    "reason": "no_activity_evidence",
                    "habit_id": habit_id,
                    "habit_name": habit_name,
                    "day": day,
                    "amount": 0,
                    "unit": unit_type,
                    "total_ms": 0,
                    "projection": {
                        "enabled": False,
                        "source": service.COMPUTER_USE_PROJECTION_SOURCE,
                        "pipeline_version": service.COMPUTER_USE_PIPELINE_VERSION,
                    },
                }

            computer_sync = await service._sync_computer_activity_range_to_tinybird(
                user_id=user_id,
                start_date=day,
                end_date=day,
            )
            if not computer_sync.get("success"):
                logger.info(
                    "computer_activity_daily sync skipped: %s",
                    computer_sync.get("error"),
                )

            projection_result = await service._upsert_computer_use_projection_log(
                session=session,
                habit_id=habit_id,
                habit_name=habit_name,
                unit_type=unit_type,
                day=day,
                local_data=local_data,
            )

            await session.commit()

            logger.info(
                "%s computer-use projection log %s for %s: %s %s",
                projection_result["action"].capitalize(),
                projection_result["log_id"],
                day,
                projection_result["amount"],
                unit_type,
            )

            await service._sync_habit_log_to_tinybird(
                log_id=projection_result["log_id"],
                habit_id=habit_id,
                habit_name=habit_name,
                user_id=user_id,
                date=day,
                amount=projection_result["amount"],
                duration_seconds=projection_result["duration_seconds"],
                unit_type=unit_type,
                source=projection_result["source"],
                notes=projection_result["notes"],
            )

            response: Dict[str, Any] = {
                "success": True,
                "synced": True,
                "action": projection_result["action"],
                "habit_id": habit_id,
                "habit_name": habit_name,
                "day": day,
                "amount": projection_result["amount"],
                "unit": unit_type,
                "log_id": projection_result["log_id"],
                "total_ms": projection_result["total_ms"],
                "projection": {
                    "enabled": True,
                    "source": service.COMPUTER_USE_PROJECTION_SOURCE,
                    "pipeline_version": service.COMPUTER_USE_PIPELINE_VERSION,
                    "dedupe_key": service._computer_use_projection_dedupe_key(habit_id, day),
                },
            }
            if projection_result.get("previous_amount") is not None:
                response["previous_amount"] = projection_result["previous_amount"]
            return response
    except Exception as e:
        import traceback

        logger.error("Error syncing to habit: %s", e)
        logger.debug(traceback.format_exc())
        return {
            "success": False,
            "error": str(e),
            "synced": False,
        }


async def reconcile_computer_use_projection_impl(
    service,
    user_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: int = 14,
    auto_repair: bool = True,
    tolerance_seconds: int = 60,
) -> Dict[str, Any]:
    """Verify projected Computer Time rows and optionally auto-repair."""
    try:
        if start_date:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
        else:
            end_for_start = (
                datetime.strptime(end_date, "%Y-%m-%d").date()
                if end_date
                else datetime.now().date()
            )
            span = max(int(days_back), 1)
            start_dt = end_for_start - timedelta(days=span - 1)

        if end_date:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
        else:
            end_dt = datetime.now().date()

        if start_dt > end_dt:
            start_dt, end_dt = end_dt, start_dt

        async with service._get_db_session() as session:
            resolved_habit = await service._find_computer_use_habit(session, user_id)
            if not resolved_habit:
                return {
                    "success": False,
                    "error": "No 'Computer Time' habit found.",
                    "reconciled": False,
                }
            habit_id, habit_name, unit_type = resolved_habit

            existing_result = await session.execute(
                text(
                    """
                    SELECT date, id, amount, duration, source, notes
                    FROM habit_logs
                    WHERE habit_id = :habit_id
                      AND date >= :start_date
                      AND date <= :end_date
                    ORDER BY date ASC, completed_at DESC
                    """
                ),
                {
                    "habit_id": habit_id,
                    "start_date": start_dt.strftime("%Y-%m-%d"),
                    "end_date": end_dt.strftime("%Y-%m-%d"),
                },
            )
            rows = existing_result.fetchall()

        preferred_by_day: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            day = row[0]
            row_info = {
                "date": day,
                "log_id": row[1],
                "amount": row[2] or 0,
                "duration": row[3] or 0,
                "source": row[4],
                "notes": row[5] or "",
            }
            rank = service._projection_source_rank(row_info["source"], row_info["notes"])
            existing = preferred_by_day.get(day)
            if not existing or rank < existing["rank"]:
                row_info["rank"] = rank
                preferred_by_day[day] = row_info

        mismatches: List[Dict[str, Any]] = []
        repaired_days = 0
        checked_days = (end_dt - start_dt).days + 1

        for offset in range(checked_days):
            day = (start_dt + timedelta(days=offset)).strftime("%Y-%m-%d")
            summary = await service.get_computer_time_summary(
                user_id=user_id,
                start_date=day,
                end_date=day,
            )
            local_data = {
                "ok": True,
                "total_ms": int(summary.get("total_active_ms", 0) or 0),
                "total_hours": float(summary.get("total_hours", 0) or 0),
                "events_count": int(summary.get("total_events", 0) or 0),
                "active_ms": int(summary.get("total_active_ms", 0) or 0),
                "afk_ms": int(summary.get("total_afk_ms", 0) or 0),
            }

            expected_amount, expected_duration = service._convert_active_ms_to_habit_unit(
                unit_type,
                int(local_data.get("total_ms", 0) or 0),
            )
            existing = preferred_by_day.get(day)

            if not existing:
                mismatches.append(
                    {
                        "day": day,
                        "reason": "missing_projection_log",
                        "expected_amount": expected_amount,
                        "expected_duration_seconds": expected_duration,
                    }
                )
                continue

            actual_duration = int(existing.get("duration") or 0)
            actual_amount = float(existing.get("amount") or 0)
            duration_delta = abs(actual_duration - expected_duration)
            amount_delta = abs(actual_amount - expected_amount)

            if duration_delta > max(int(tolerance_seconds), 0) or amount_delta > 0.01:
                mismatches.append(
                    {
                        "day": day,
                        "reason": "value_mismatch",
                        "log_id": existing.get("log_id"),
                        "source": existing.get("source"),
                        "expected_amount": expected_amount,
                        "actual_amount": actual_amount,
                        "expected_duration_seconds": expected_duration,
                        "actual_duration_seconds": actual_duration,
                        "duration_delta_seconds": duration_delta,
                        "amount_delta": round(amount_delta, 4),
                    }
                )

        repairs: List[Dict[str, Any]] = []
        if auto_repair and mismatches:
            for mismatch in mismatches:
                day = mismatch.get("day")
                if not day:
                    continue
                repaired = await service.sync_to_computer_use_habit(user_id=user_id, day=day)
                repairs.append(repaired)
                if repaired.get("success") and repaired.get("synced"):
                    repaired_days += 1

        return {
            "success": True,
            "reconciled": len(mismatches) == 0 or repaired_days > 0,
            "habit_id": habit_id,
            "habit_name": habit_name,
            "unit": unit_type,
            "start_date": start_dt.strftime("%Y-%m-%d"),
            "end_date": end_dt.strftime("%Y-%m-%d"),
            "checked_days": checked_days,
            "mismatch_count": len(mismatches),
            "mismatches": mismatches,
            "auto_repair": auto_repair,
            "repaired_days": repaired_days,
            "repairs": repairs,
            "projection_source": service.COMPUTER_USE_PROJECTION_SOURCE,
            "pipeline_version": service.COMPUTER_USE_PIPELINE_VERSION,
        }
    except Exception as e:
        return {
            "success": False,
            "reconciled": False,
            "error": str(e),
            "mismatch_count": 0,
            "mismatches": [],
            "repaired_days": 0,
            "repairs": [],
        }


async def validate_computer_use_range_parity_impl(
    service,
    user_id: str,
    start_date: str,
    end_date: str,
    tolerance_seconds: int = 60,
) -> Dict[str, Any]:
    """Validate parity between computer activity totals and projected habit logs."""
    try:
        summary = await service.get_computer_time_summary(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )
        expected_total_ms = int(summary.get("total_active_ms", 0) or 0)

        async with service._get_db_session() as session:
            resolved_habit = await service._find_computer_use_habit(session, user_id)
            if not resolved_habit:
                return {
                    "success": False,
                    "error": "No 'Computer Time' habit found.",
                    "parity_ok": False,
                }

            habit_id, habit_name, unit_type = resolved_habit
            expected_amount, expected_duration_seconds = service._convert_active_ms_to_habit_unit(
                unit_type,
                expected_total_ms,
            )

            projection_sum = await session.execute(
                text(
                    """
                    SELECT
                        COALESCE(SUM(duration), 0) as total_duration_seconds,
                        COALESCE(SUM(amount), 0) as total_amount,
                        COUNT(*) as rows_count
                    FROM habit_logs
                    WHERE habit_id = :habit_id
                      AND date >= :start_date
                      AND date <= :end_date
                      AND source = :source
                      AND (status = 'completed' OR status IS NULL)
                    """
                ),
                {
                    "habit_id": habit_id,
                    "start_date": start_date,
                    "end_date": end_date,
                    "source": service.COMPUTER_USE_PROJECTION_SOURCE,
                },
            )
            row = projection_sum.fetchone()

        actual_duration_seconds = int((row[0] if row else 0) or 0)
        actual_amount = float((row[1] if row else 0) or 0)
        rows_count = int((row[2] if row else 0) or 0)

        duration_delta_seconds = abs(actual_duration_seconds - expected_duration_seconds)
        amount_delta = abs(actual_amount - expected_amount)
        parity_ok = (
            duration_delta_seconds <= max(int(tolerance_seconds), 0)
            and amount_delta <= 0.01
        )

        return {
            "success": True,
            "parity_ok": parity_ok,
            "start_date": start_date,
            "end_date": end_date,
            "habit_id": habit_id,
            "habit_name": habit_name,
            "unit": unit_type,
            "projection_source": service.COMPUTER_USE_PROJECTION_SOURCE,
            "expected_total_active_ms": expected_total_ms,
            "expected_duration_seconds": expected_duration_seconds,
            "actual_duration_seconds": actual_duration_seconds,
            "duration_delta_seconds": duration_delta_seconds,
            "expected_amount": expected_amount,
            "actual_amount": actual_amount,
            "amount_delta": round(amount_delta, 4),
            "rows_count": rows_count,
            "tolerance_seconds": max(int(tolerance_seconds), 0),
        }
    except Exception as e:
        return {
            "success": False,
            "parity_ok": False,
            "error": str(e),
        }


async def sync_to_computer_use_habit_range_impl(
    service,
    user_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: int = 7,
    auto_reconcile: bool = False,
    tolerance_seconds: int = 60,
) -> Dict[str, Any]:
    """Sync a date range of watcher data into the user's Computer Time habit."""
    try:
        if start_date:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
        else:
            end_for_start = (
                datetime.strptime(end_date, "%Y-%m-%d").date()
                if end_date
                else datetime.now().date()
            )
            span = max(int(days_back), 1)
            start_dt = end_for_start - timedelta(days=span - 1)

        if end_date:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
        else:
            end_dt = datetime.now().date()

        if start_dt > end_dt:
            start_dt, end_dt = end_dt, start_dt

        total_days = (end_dt - start_dt).days + 1
        results: List[Dict[str, Any]] = []
        synced_days = 0

        for offset in range(total_days):
            day_dt = start_dt + timedelta(days=offset)
            day = day_dt.strftime("%Y-%m-%d")
            day_result = await service.sync_to_computer_use_habit(user_id=user_id, day=day)
            results.append(day_result)
            if day_result.get("success") and day_result.get("synced"):
                synced_days += 1

        response: Dict[str, Any] = {
            "success": True,
            "synced": synced_days > 0,
            "requested_days": total_days,
            "synced_days": synced_days,
            "start_date": start_dt.strftime("%Y-%m-%d"),
            "end_date": end_dt.strftime("%Y-%m-%d"),
            "results": results,
            "projection_source": service.COMPUTER_USE_PROJECTION_SOURCE,
            "pipeline_version": service.COMPUTER_USE_PIPELINE_VERSION,
        }

        if auto_reconcile:
            reconciliation = await service.reconcile_computer_use_projection(
                user_id=user_id,
                start_date=response["start_date"],
                end_date=response["end_date"],
                auto_repair=True,
                tolerance_seconds=tolerance_seconds,
            )
            response["reconciliation"] = reconciliation
            response["reconciled"] = reconciliation.get("reconciled", False)

        return response
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "synced": False,
            "requested_days": 0,
            "synced_days": 0,
            "results": [],
        }
