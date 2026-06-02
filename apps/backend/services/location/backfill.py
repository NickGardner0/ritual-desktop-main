"""Bounded backfills for rows that missed location at write time."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Sequence

from libsql_client import Statement
from sqlalchemy import select

from database.connection import get_db_session
from database.models import HabitDB, HabitLogDB
from services.location.enrichment import _completed_at_to_ms
from services.location.resolver import resolve_many_for
from services.location.util import now_ms
from services.turso_activity_remote import execute_remote_activity_batch, fetch_remote_activity_rows
from services.watcher_service_local_db import open_activity_connection_for_user

logger = logging.getLogger(__name__)

DEFAULT_BACKFILL_WINDOW_MS = 60 * 60_000
DEFAULT_BACKFILL_LIMIT = 500
BIOME_SOURCE = "biome_iphone"


@dataclass(frozen=True)
class BackfillCounts:
    habit_logs: int = 0
    activity_events: int = 0


async def backfill_recent_location_for_user(
    user_id: str,
    *,
    start_ts_ms: int,
    end_ts_ms: int,
    limit: int = DEFAULT_BACKFILL_LIMIT,
) -> BackfillCounts:
    """Backfill nearby habit logs and activity events after late location pings."""
    habit_count = await backfill_habit_logs_missing_location(
        user_id,
        start_ts_ms=start_ts_ms,
        end_ts_ms=end_ts_ms,
        limit=limit,
    )
    activity_count = await backfill_activity_events_missing_location(
        user_id,
        start_ts_ms=start_ts_ms,
        end_ts_ms=end_ts_ms,
        limit=limit,
    )
    return BackfillCounts(habit_logs=habit_count, activity_events=activity_count)


async def backfill_habit_logs_missing_location(
    user_id: str,
    *,
    start_ts_ms: int,
    end_ts_ms: int,
    limit: int = DEFAULT_BACKFILL_LIMIT,
) -> int:
    start_date = _date_for_ms(start_ts_ms - DEFAULT_BACKFILL_WINDOW_MS)
    end_date = _date_for_ms(end_ts_ms + DEFAULT_BACKFILL_WINDOW_MS)
    async with get_db_session() as session:
        rows = (
            await session.execute(
                select(HabitLogDB)
                .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
                .where(
                    HabitDB.user_id == user_id,
                    HabitLogDB.location_lat.is_(None),
                    HabitLogDB.date >= start_date,
                    HabitLogDB.date <= end_date,
                )
                .limit(max(1, int(limit)))
            )
        ).scalars().all()
        candidates: list[tuple[HabitLogDB, int]] = []
        for row in rows:
            ts = _completed_at_to_ms(row.completed_at) or _date_start_ms(row.date)
            if start_ts_ms <= ts <= end_ts_ms:
                candidates.append((row, ts))
        if not candidates:
            return 0
        resolved = await resolve_many_for(user_id, [ts for _, ts in candidates])
        resolved_at = now_ms()
        updated = 0
        for row, ts in candidates:
            location = resolved.get(ts)
            if location is None:
                continue
            row.location_lat = location.lat
            row.location_lon = location.lon
            row.location_accuracy_m = location.horizontal_accuracy_m
            row.location_source = location.source
            row.location_place_label = location.place_label
            row.location_confidence = location.confidence
            row.location_resolved_at = resolved_at
            row.location_signal_age_ms = location.signal_age_ms
            updated += 1
        if updated:
            await session.commit()
        return updated


async def backfill_activity_events_missing_location(
    user_id: str,
    *,
    start_ts_ms: int,
    end_ts_ms: int,
    limit: int = DEFAULT_BACKFILL_LIMIT,
) -> int:
    rows = await _fetch_activity_rows(user_id, start_ts_ms=start_ts_ms, end_ts_ms=end_ts_ms, limit=limit)
    if not rows:
        return 0
    resolved = await resolve_many_for(user_id, [int(row["ts_start"]) for row in rows])
    updates: list[dict[str, Any]] = []
    resolved_at = now_ms()
    for row in rows:
        ts_start = int(row["ts_start"])
        location = resolved.get(ts_start)
        if location is None:
            continue
        updates.append(
            {
                "event_uid": row["event_uid"],
                "location_lat": location.lat,
                "location_lon": location.lon,
                "location_accuracy_m": location.horizontal_accuracy_m,
                "location_source": location.source,
                "location_place_label": location.place_label,
                "location_confidence": location.confidence,
                "location_resolved_at": resolved_at,
                "location_signal_age_ms": location.signal_age_ms,
            }
        )
    if not updates:
        return 0
    if await _write_activity_updates_remote(user_id, updates):
        return len(updates)
    return await _write_activity_updates_legacy(user_id, updates)


async def _fetch_activity_rows(
    user_id: str,
    *,
    start_ts_ms: int,
    end_ts_ms: int,
    limit: int,
) -> list[dict[str, Any]]:
    result = await fetch_remote_activity_rows(
        user_id,
        """
        SELECT event_uid, ts_start
        FROM activity_events
        WHERE user_id = ?
          AND COALESCE(source, '') = ?
          AND location_lat IS NULL
          AND ts_start >= ?
          AND ts_start <= ?
        ORDER BY ts_start ASC
        LIMIT ?
        """,
        [user_id, BIOME_SOURCE, int(start_ts_ms), int(end_ts_ms), max(1, int(limit))],
    )
    if result.expected_remote:
        if result.error:
            logger.info("Activity location backfill remote read unavailable: %s", result.error)
            return []
        return [
            {"event_uid": str(row[0]), "ts_start": int(row[1])}
            for row in result.rows
            if row[0]
        ]

    async with open_activity_connection_for_user(user_id, write=False) as conn:
        if conn is None:
            return []
        cursor = conn.execute(
            """
            SELECT event_uid, ts_start
            FROM activity_events
            WHERE user_id = ?
              AND COALESCE(source, '') = ?
              AND location_lat IS NULL
              AND ts_start >= ?
              AND ts_start <= ?
            ORDER BY ts_start ASC
            LIMIT ?
            """,
            [user_id, BIOME_SOURCE, int(start_ts_ms), int(end_ts_ms), max(1, int(limit))],
        )
        return [
            {"event_uid": str(row[0]), "ts_start": int(row[1])}
            for row in cursor.fetchall()
            if row[0]
        ]


async def _write_activity_updates_remote(user_id: str, updates: Sequence[dict[str, Any]]) -> bool:
    sql = _activity_update_sql()
    statements = [
        Statement(
            sql,
            [
                update["location_lat"],
                update["location_lon"],
                update["location_accuracy_m"],
                update["location_source"],
                update["location_place_label"],
                update["location_confidence"],
                update["location_resolved_at"],
                update["location_signal_age_ms"],
                update["event_uid"],
            ],
        )
        for update in updates
    ]
    return await execute_remote_activity_batch(user_id, statements)


async def _write_activity_updates_legacy(user_id: str, updates: Sequence[dict[str, Any]]) -> int:
    async with open_activity_connection_for_user(user_id, write=True) as conn:
        if conn is None:
            return 0
        sql = _activity_update_sql()
        updated = 0
        for update in updates:
            before = conn.total_changes
            conn.execute(
                sql,
                [
                    update["location_lat"],
                    update["location_lon"],
                    update["location_accuracy_m"],
                    update["location_source"],
                    update["location_place_label"],
                    update["location_confidence"],
                    update["location_resolved_at"],
                    update["location_signal_age_ms"],
                    update["event_uid"],
                ],
            )
            updated += max(0, conn.total_changes - before)
        conn.commit()
        return updated


def _activity_update_sql() -> str:
    return """
        UPDATE activity_events
        SET location_lat = ?,
            location_lon = ?,
            location_accuracy_m = ?,
            location_source = ?,
            location_place_label = ?,
            location_confidence = ?,
            location_resolved_at = ?,
            location_signal_age_ms = ?
        WHERE event_uid = ?
          AND location_lat IS NULL
    """


def _date_for_ms(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()


def _date_start_ms(value: str) -> int:
    try:
        dt = datetime.fromisoformat(value[:10]).replace(tzinfo=timezone.utc)
    except Exception:
        dt = datetime.now(timezone.utc)
    return int(dt.timestamp() * 1000)
