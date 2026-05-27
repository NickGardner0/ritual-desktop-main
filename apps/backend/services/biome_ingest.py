"""Ingest normalized iPhone App.InFocus events into activity_events."""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Sequence

from libsql_client import Statement
from sqlalchemy import func, or_, select

from database.connection import get_db_session
from database.models import HabitDB
from schemas.biome import BiomeActivityEvent
from services.location.resolver import resolve_for
from services.location.util import now_ms
from services.turso_activity_remote import execute_remote_activity_batch
from services.watcher_service_local_db import open_activity_connection_for_user

logger = logging.getLogger(__name__)

MAX_BIOME_EVENTS_PER_BATCH = 2_000
SOURCE = "biome_iphone"

ACTIVITY_COLUMNS = [
    "event_uid",
    "device_id",
    "user_id",
    "ts_start",
    "ts_end",
    "app_bundle_id",
    "app_name",
    "window_title",
    "window_title_hash",
    "window_owner_pid",
    "is_afk",
    "browser_url",
    "browser_domain",
    "is_incognito",
    "device_platform",
    "app_version",
    "app_build",
    "transition_reason",
    "biome_source_file",
    "location_lat",
    "location_lon",
    "location_accuracy_m",
    "location_source",
    "location_place_label",
    "location_confidence",
    "location_resolved_at",
    "location_signal_age_ms",
    "source",
    "created_at",
]


@dataclass(frozen=True)
class BiomeIngestResult:
    accepted: int
    rejected: int
    duplicates: int


def stable_biome_event_uid(event: BiomeActivityEvent) -> str:
    if event.event_uid:
        return event.event_uid.strip()
    bundle_digest = hashlib.sha256(event.app_bundle_id.encode("utf-8")).hexdigest()[:16]
    return f"biome:{event.device_id}:{bundle_digest}:{event.ts_start}"


async def ingest_biome_events(
    user_id: str,
    events: Sequence[BiomeActivityEvent],
) -> BiomeIngestResult:
    """Persist normalized iPhone foreground-app intervals.

    This writes into the same activity_events table used by desktop watcher data
    so existing computer/app/domain metrics can aggregate iPhone activity without
    a parallel analytics path.
    """
    if not events:
        return BiomeIngestResult(accepted=0, rejected=0, duplicates=0)
    if len(events) > MAX_BIOME_EVENTS_PER_BATCH:
        raise ValueError(f"batch too large; max {MAX_BIOME_EVENTS_PER_BATCH}")

    rows = await _events_to_rows(user_id, events)
    rows, in_batch_duplicates = _dedupe_rows(rows)
    if not rows:
        return BiomeIngestResult(accepted=0, rejected=0, duplicates=in_batch_duplicates)

    inserted = await _write_rows(user_id, rows)
    if inserted > 0:
        await _ensure_iphone_time_habit(user_id)
    duplicates = in_batch_duplicates + max(0, len(rows) - inserted)
    return BiomeIngestResult(
        accepted=inserted,
        rejected=0,
        duplicates=duplicates,
    )


async def _events_to_rows(
    user_id: str,
    events: Sequence[BiomeActivityEvent],
) -> List[Dict[str, Any]]:
    created_at = int(time.time() * 1000)
    rows: List[Dict[str, Any]] = []
    for event in events:
        location_fields = await _resolve_location_fields(user_id, event.ts_start)
        row: Dict[str, Any] = {
            "event_uid": stable_biome_event_uid(event),
            "device_id": event.device_id,
            "user_id": user_id,
            "ts_start": event.ts_start,
            "ts_end": event.ts_end,
            "app_bundle_id": event.app_bundle_id,
            "app_name": event.app_name,
            "window_title": event.window_title,
            "window_title_hash": None,
            "window_owner_pid": None,
            "is_afk": 0,
            "browser_url": event.browser_url,
            "browser_domain": event.browser_domain,
            "is_incognito": 1 if event.is_incognito else 0,
            "device_platform": "ios",
            "app_version": event.app_version,
            "app_build": event.app_build,
            "transition_reason": event.transition_reason,
            "biome_source_file": event.source_file,
            "source": SOURCE,
            "created_at": created_at,
        }
        row.update(location_fields)
        rows.append(row)
    return rows


async def _resolve_location_fields(user_id: str, ts_start: int) -> Dict[str, Any]:
    try:
        resolved = await resolve_for(user_id, ts_start)
    except Exception as exc:  # pragma: no cover - enrichment is best-effort
        logger.warning("Biome location resolve failed for user=%s: %s", user_id, exc)
        return {}
    if resolved is None:
        return {}
    return {
        "location_lat": resolved.lat,
        "location_lon": resolved.lon,
        "location_accuracy_m": resolved.horizontal_accuracy_m,
        "location_source": resolved.source,
        "location_place_label": resolved.place_label,
        "location_confidence": resolved.confidence,
        "location_resolved_at": now_ms(),
        "location_signal_age_ms": resolved.signal_age_ms,
    }


def _dedupe_rows(rows: Iterable[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], int]:
    seen: set[str] = set()
    deduped: List[Dict[str, Any]] = []
    duplicates = 0
    for row in rows:
        uid = str(row["event_uid"])
        if uid in seen:
            duplicates += 1
            continue
        seen.add(uid)
        deduped.append(row)
    return deduped, duplicates


async def _write_rows(user_id: str, rows: Sequence[Dict[str, Any]]) -> int:
    statements = [_row_to_statement(row) for row in rows]
    remote_written = await execute_remote_activity_batch(user_id, statements)
    if remote_written:
        # libSQL batch does not return reliable per-statement affected row
        # counts across all supported transports. INSERT OR IGNORE makes this
        # idempotent; duplicates are counted precisely for in-batch duplicates.
        return len(rows)
    return await _write_rows_legacy(user_id, rows)


def _row_to_statement(row: Dict[str, Any]) -> Statement:
    sql = _insert_sql()
    return Statement(sql, [_jsonable(row.get(column)) for column in ACTIVITY_COLUMNS])


async def _write_rows_legacy(user_id: str, rows: Sequence[Dict[str, Any]]) -> int:
    async with open_activity_connection_for_user(user_id, write=True) as conn:
        if conn is None:
            raise RuntimeError("activity database unavailable")
        _ensure_legacy_columns(conn)
        inserted = 0
        for row in rows:
            before = conn.total_changes
            conn.execute(_insert_sql(), [_jsonable(row.get(column)) for column in ACTIVITY_COLUMNS])
            inserted += max(0, conn.total_changes - before)
        conn.commit()
        return inserted


def _insert_sql() -> str:
    columns = ", ".join(ACTIVITY_COLUMNS)
    placeholders = ", ".join(["?"] * len(ACTIVITY_COLUMNS))
    return f"""
        INSERT OR IGNORE INTO activity_events ({columns})
        VALUES ({placeholders})
    """


def _ensure_legacy_columns(conn: sqlite3.Connection) -> None:
    migrations = {
        "event_uid": "TEXT NOT NULL DEFAULT ''",
        "device_platform": "TEXT",
        "app_version": "TEXT",
        "app_build": "TEXT",
        "transition_reason": "TEXT",
        "biome_source_file": "TEXT",
        "location_lat": "REAL",
        "location_lon": "REAL",
        "location_accuracy_m": "REAL",
        "location_source": "TEXT",
        "location_place_label": "TEXT",
        "location_confidence": "REAL",
        "location_resolved_at": "INTEGER",
        "location_signal_age_ms": "INTEGER",
    }
    existing = {str(row[1]) for row in conn.execute("PRAGMA table_info(activity_events)").fetchall()}
    for name, column_sql in migrations.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE activity_events ADD COLUMN {name} {column_sql}")
    conn.execute(
        """
        UPDATE activity_events
        SET event_uid = printf('legacy-activity:%s:%s:%lld', device_id, user_id, id)
        WHERE event_uid IS NULL OR TRIM(event_uid) = ''
        """
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_events_event_uid
        ON activity_events(event_uid)
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_activity_events_source_ts
        ON activity_events(user_id, source, ts_start)
        """
    )


def _jsonable(value: Any) -> Any:
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, separators=(",", ":"))
    return value


async def _ensure_iphone_time_habit(user_id: str) -> None:
    """Create the first-class iPhone Time habit when Biome data arrives."""
    try:
        async with get_db_session() as session:
            existing = (
                await session.execute(
                    select(HabitDB.id).where(
                        HabitDB.user_id == user_id,
                        or_(
                            func.lower(HabitDB.name) == "iphone time",
                            HabitDB.integration_source == SOURCE,
                            HabitDB.metric_type.in_(["iphone_time", "iphone_screen_time", "screen_time"]),
                        ),
                    )
                )
            ).scalar_one_or_none()
            if existing:
                return
            session.add(
                HabitDB(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    name="iPhone Time",
                    category="Device Usage",
                    icon="lucide:smartphone",
                    is_custom=False,
                    integration_source=SOURCE,
                    unit_type="Hours",
                    sensor_type="iPhone (Biome)",
                    metric_type="iphone_time",
                )
            )
            await session.commit()
    except Exception as exc:  # pragma: no cover - habit creation must not drop activity data
        logger.warning("Failed ensuring iPhone Time habit for user=%s: %s", user_id, exc)
