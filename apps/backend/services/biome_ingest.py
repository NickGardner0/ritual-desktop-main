"""Ingest normalized iPhone App.InFocus events into activity_events."""

from __future__ import annotations

import json
import logging
import sqlite3
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

from libsql_client import Statement
from sqlalchemy import func, or_, select

from database.connection import get_db_session
from database.models import HabitDB
from schemas.biome import BiomeActivityEvent
from services.location.resolver import resolve_many_for
from services.location.util import now_ms
from services.turso_activity_remote import execute_remote_activity_batch, fetch_remote_activity_rows
from services.watcher_service_local_db import open_activity_connection_for_user

logger = logging.getLogger(__name__)

MAX_BIOME_EVENTS_PER_BATCH = 2_000
SOURCE = "biome_iphone"
EVENT_LOOKUP_CHUNK_SIZE = 500
IGNORED_BIOME_BUNDLE_IDS = {
    "com.apple.carplaysplashscreen",
    "com.apple.control-center",
    "com.apple.screenshotservicesservice",
    "com.apple.sleeplockscreen",
}
IGNORED_BIOME_BUNDLE_PREFIXES = {
    "com.apple.springboard",
}

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
    "biome_is_provisional",
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
    accepted_event_uids: tuple[str, ...] = ()
    duplicate_event_uids: tuple[str, ...] = ()
    rejected_event_uids: tuple[str, ...] = ()


@dataclass(frozen=True)
class ExistingEventInfo:
    event_uid: str
    ts_end: int
    biome_is_provisional: bool


@dataclass(frozen=True)
class WriteResult:
    accepted_event_uids: tuple[str, ...]
    duplicate_event_uids: tuple[str, ...]
    affected_dates: tuple[str, ...]

    @property
    def accepted(self) -> int:
        return len(self.accepted_event_uids)

    @property
    def duplicates(self) -> int:
        return len(self.duplicate_event_uids)


def stable_biome_event_uid(event: BiomeActivityEvent) -> str:
    """Return the canonical stable identity for a Biome foreground interval.

    Older clients included `ts_end` in `event_uid`, which made provisional
    intervals impossible to extend without creating duplicates. The backend now
    owns the canonical key and intentionally ignores client-provided IDs.
    """
    return f"biome:{event.device_id}:{event.app_bundle_id}:{event.ts_start}"


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

    valid_events: list[BiomeActivityEvent] = []
    rejected_event_uids: list[str] = []
    for event in events:
        if _is_ignored_biome_event(event):
            rejected_event_uids.append(stable_biome_event_uid(event))
        else:
            valid_events.append(event)
    if not valid_events:
        return BiomeIngestResult(
            accepted=0,
            rejected=len(rejected_event_uids),
            duplicates=0,
            rejected_event_uids=tuple(rejected_event_uids),
        )

    rows = await _events_to_rows(user_id, valid_events)
    rows, in_batch_duplicate_uids = _dedupe_rows(rows)
    if not rows:
        return BiomeIngestResult(
            accepted=0,
            rejected=len(rejected_event_uids),
            duplicates=len(in_batch_duplicate_uids),
            duplicate_event_uids=tuple(in_batch_duplicate_uids),
            rejected_event_uids=tuple(rejected_event_uids),
        )

    write_result = await _write_rows(user_id, rows)
    if write_result.accepted > 0:
        habit_id = await _ensure_iphone_time_habit(user_id)
        if habit_id and write_result.affected_dates:
            await _rebuild_iphone_time_facts_for_dates(
                user_id=user_id,
                habit_id=habit_id,
                dates=write_result.affected_dates,
            )
    duplicate_event_uids = (*in_batch_duplicate_uids, *write_result.duplicate_event_uids)
    return BiomeIngestResult(
        accepted=write_result.accepted,
        rejected=len(rejected_event_uids),
        duplicates=len(duplicate_event_uids),
        accepted_event_uids=write_result.accepted_event_uids,
        duplicate_event_uids=duplicate_event_uids,
        rejected_event_uids=tuple(rejected_event_uids),
    )


def _is_ignored_biome_event(event: BiomeActivityEvent) -> bool:
    bundle_id = event.app_bundle_id.strip().lower()
    return bundle_id in IGNORED_BIOME_BUNDLE_IDS or any(
        bundle_id == prefix or bundle_id.startswith(f"{prefix}.")
        for prefix in IGNORED_BIOME_BUNDLE_PREFIXES
    )


async def _events_to_rows(
    user_id: str,
    events: Sequence[BiomeActivityEvent],
) -> List[Dict[str, Any]]:
    created_at = int(time.time() * 1000)
    rows: List[Dict[str, Any]] = []
    resolved_by_ts = await _resolve_location_fields_many(
        user_id,
        [event.ts_start for event in events],
    )
    for event in events:
        location_fields = resolved_by_ts.get(event.ts_start, {})
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
            "biome_is_provisional": 1 if event.biome_is_provisional else 0,
            "source": SOURCE,
            "created_at": created_at,
        }
        row.update(location_fields)
        rows.append(row)
    return rows


async def _resolve_location_fields_many(user_id: str, timestamps: Sequence[int]) -> Dict[int, Dict[str, Any]]:
    unique_timestamps = list(dict.fromkeys(int(ts) for ts in timestamps))
    try:
        resolved_by_ts = await resolve_many_for(user_id, unique_timestamps)
    except Exception as exc:  # pragma: no cover - enrichment is best-effort
        logger.warning("Biome location resolve failed for user=%s: %s", user_id, exc)
        return {}
    output: Dict[int, Dict[str, Any]] = {}
    resolved_at = now_ms()
    for ts, resolved in resolved_by_ts.items():
        if resolved is None:
            continue
        output[ts] = {
            "location_lat": resolved.lat,
            "location_lon": resolved.lon,
            "location_accuracy_m": resolved.horizontal_accuracy_m,
            "location_source": resolved.source,
            "location_place_label": resolved.place_label,
            "location_confidence": resolved.confidence,
            "location_resolved_at": resolved_at,
            "location_signal_age_ms": resolved.signal_age_ms,
        }
    return output


def _dedupe_rows(rows: Iterable[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], tuple[str, ...]]:
    seen: set[str] = set()
    deduped: List[Dict[str, Any]] = []
    duplicates: list[str] = []
    for row in rows:
        uid = str(row["event_uid"])
        if uid in seen:
            duplicates.append(uid)
            continue
        seen.add(uid)
        deduped.append(row)
    return deduped, tuple(duplicates)


async def _write_rows(user_id: str, rows: Sequence[Dict[str, Any]]) -> WriteResult:
    if not rows:
        return WriteResult((), (), ())
    existing = await _fetch_existing_events_remote(user_id, rows)
    if existing is not None:
        return await _write_rows_remote(user_id, rows, existing)
    return await _write_rows_legacy(user_id, rows)


async def _write_rows_remote(
    user_id: str,
    rows: Sequence[Dict[str, Any]],
    existing: Dict[str, ExistingEventInfo],
) -> WriteResult:
    ack = _classify_rows(rows, existing)
    statements = [_row_to_statement(row) for row in rows]
    remote_written = await execute_remote_activity_batch(user_id, statements)
    if not remote_written:
        return await _write_rows_legacy(user_id, rows)
    return ack


async def _fetch_existing_events_remote(
    user_id: str,
    rows: Sequence[Dict[str, Any]],
) -> Optional[Dict[str, ExistingEventInfo]]:
    event_uids = [str(row["event_uid"]) for row in rows]
    if not event_uids:
        return {}
    try:
        from services.turso_user_service import turso_user_service

        user = await turso_user_service.ensure_user_activity_database(user_id)
        if user is not None and user.turso_db_name and user.turso_db_url:
            await turso_user_service._ensure_remote_schema_once(  # noqa: SLF001
                user_id,
                user.turso_db_url,
                user.turso_db_name,
            )
    except Exception as exc:
        logger.warning("Unable to prepare remote activity schema for Biome lookup: %s", exc)
    existing: Dict[str, ExistingEventInfo] = {}
    saw_remote = False
    for chunk in _chunks(event_uids, EVENT_LOOKUP_CHUNK_SIZE):
        placeholders = ", ".join(["?"] * len(chunk))
        result = await fetch_remote_activity_rows(
            user_id,
            f"""
            SELECT event_uid, ts_end, COALESCE(biome_is_provisional, 0)
            FROM activity_events
            WHERE event_uid IN ({placeholders})
              AND COALESCE(source, '') = ?
            """,
            [*chunk, SOURCE],
        )
        if not result.expected_remote:
            return None
        saw_remote = True
        if result.error:
            raise RuntimeError(f"remote Biome existing-event lookup failed: {result.error}")
        existing.update(
            {
                str(row[0]): ExistingEventInfo(
                    event_uid=str(row[0]),
                    ts_end=int(row[1] or 0),
                    biome_is_provisional=bool(int(row[2] or 0)),
                )
                for row in result.rows
            }
        )
    return existing if saw_remote else {}


def _row_to_statement(row: Dict[str, Any]) -> Statement:
    sql = _insert_sql()
    return Statement(sql, [_jsonable(row.get(column)) for column in ACTIVITY_COLUMNS])


async def _write_rows_legacy(user_id: str, rows: Sequence[Dict[str, Any]]) -> WriteResult:
    async with open_activity_connection_for_user(user_id, write=True) as conn:
        if conn is None:
            raise RuntimeError("activity database unavailable")
        _ensure_legacy_columns(conn)
        existing = _fetch_existing_events_legacy(conn, rows)
        ack = _classify_rows(rows, existing)
        for row in rows:
            conn.execute(_insert_sql(), [_jsonable(row.get(column)) for column in ACTIVITY_COLUMNS])
        conn.commit()
        return ack


def _insert_sql() -> str:
    columns = ", ".join(ACTIVITY_COLUMNS)
    placeholders = ", ".join(["?"] * len(ACTIVITY_COLUMNS))
    return f"""
        INSERT INTO activity_events ({columns})
        VALUES ({placeholders})
        ON CONFLICT(event_uid) DO UPDATE SET
            ts_end = CASE
                WHEN excluded.ts_end > activity_events.ts_end THEN excluded.ts_end
                ELSE activity_events.ts_end
            END,
            app_name = excluded.app_name,
            window_title = COALESCE(excluded.window_title, activity_events.window_title),
            browser_url = COALESCE(excluded.browser_url, activity_events.browser_url),
            browser_domain = COALESCE(excluded.browser_domain, activity_events.browser_domain),
            app_version = COALESCE(excluded.app_version, activity_events.app_version),
            app_build = COALESCE(excluded.app_build, activity_events.app_build),
            transition_reason = COALESCE(excluded.transition_reason, activity_events.transition_reason),
            biome_source_file = COALESCE(excluded.biome_source_file, activity_events.biome_source_file),
            biome_is_provisional = CASE
                WHEN excluded.biome_is_provisional = 0 THEN 0
                ELSE COALESCE(activity_events.biome_is_provisional, 0)
            END,
            location_lat = COALESCE(activity_events.location_lat, excluded.location_lat),
            location_lon = COALESCE(activity_events.location_lon, excluded.location_lon),
            location_accuracy_m = COALESCE(activity_events.location_accuracy_m, excluded.location_accuracy_m),
            location_source = COALESCE(activity_events.location_source, excluded.location_source),
            location_place_label = COALESCE(activity_events.location_place_label, excluded.location_place_label),
            location_confidence = COALESCE(activity_events.location_confidence, excluded.location_confidence),
            location_resolved_at = COALESCE(activity_events.location_resolved_at, excluded.location_resolved_at),
            location_signal_age_ms = COALESCE(activity_events.location_signal_age_ms, excluded.location_signal_age_ms)
    """


def _ensure_legacy_columns(conn: sqlite3.Connection) -> None:
    migrations = {
        "event_uid": "TEXT NOT NULL DEFAULT ''",
        "device_platform": "TEXT",
        "app_version": "TEXT",
        "app_build": "TEXT",
        "transition_reason": "TEXT",
        "biome_source_file": "TEXT",
        "biome_is_provisional": "INTEGER NOT NULL DEFAULT 0",
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


def _fetch_existing_events_legacy(
    conn: sqlite3.Connection,
    rows: Sequence[Dict[str, Any]],
) -> Dict[str, ExistingEventInfo]:
    event_uids = [str(row["event_uid"]) for row in rows]
    if not event_uids:
        return {}
    existing: Dict[str, ExistingEventInfo] = {}
    for chunk in _chunks(event_uids, EVENT_LOOKUP_CHUNK_SIZE):
        placeholders = ", ".join(["?"] * len(chunk))
        cursor = conn.execute(
            f"""
            SELECT event_uid, ts_end, COALESCE(biome_is_provisional, 0)
            FROM activity_events
            WHERE event_uid IN ({placeholders})
              AND COALESCE(source, '') = ?
            """,
            [*chunk, SOURCE],
        )
        existing.update(
            {
                str(row[0]): ExistingEventInfo(
                    event_uid=str(row[0]),
                    ts_end=int(row[1] or 0),
                    biome_is_provisional=bool(int(row[2] or 0)),
                )
                for row in cursor.fetchall()
            }
        )
    return existing


def _chunks(values: Sequence[str], size: int) -> list[Sequence[str]]:
    chunk_size = max(1, int(size))
    return [values[index : index + chunk_size] for index in range(0, len(values), chunk_size)]


def _classify_rows(
    rows: Sequence[Dict[str, Any]],
    existing: Dict[str, ExistingEventInfo],
) -> WriteResult:
    accepted: list[str] = []
    duplicates: list[str] = []
    affected_dates: set[str] = set()
    for row in rows:
        uid = str(row["event_uid"])
        previous = existing.get(uid)
        is_update = (
            previous is not None
            and (
                int(row.get("ts_end") or 0) > previous.ts_end
                or (previous.biome_is_provisional and not bool(int(row.get("biome_is_provisional") or 0)))
            )
        )
        if previous is None or is_update:
            accepted.append(uid)
            affected_dates.update(_dates_for_row(row))
        else:
            duplicates.append(uid)
    return WriteResult(
        accepted_event_uids=tuple(accepted),
        duplicate_event_uids=tuple(duplicates),
        affected_dates=tuple(sorted(affected_dates)),
    )


def _dates_for_row(row: Dict[str, Any]) -> set[str]:
    start_ms = int(row.get("ts_start") or 0)
    end_ms = max(start_ms + 1, int(row.get("ts_end") or 0))
    start_day = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).date()
    end_day = datetime.fromtimestamp((end_ms - 1) / 1000, tz=timezone.utc).date()
    days = {start_day.isoformat(), end_day.isoformat()}
    return days


async def _ensure_iphone_time_habit(user_id: str) -> Optional[str]:
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
                return str(existing)
            habit = HabitDB(
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
            session.add(habit)
            await session.commit()
            return habit.id
    except Exception as exc:  # pragma: no cover - habit creation must not drop activity data
        logger.warning("Failed ensuring iPhone Time habit for user=%s: %s", user_id, exc)
        return None


async def _rebuild_iphone_time_facts_for_dates(
    *,
    user_id: str,
    habit_id: str,
    dates: Sequence[str],
) -> None:
    try:
        from services.metric_facts_service import metric_fact_service

        await metric_fact_service.rebuild_facts(
            user_id=user_id,
            start_date=min(dates),
            end_date=max(dates),
            habit_ids=[habit_id],
            source_families=["watcher"],
            include_legacy_fallback=False,
            apply=True,
        )
    except Exception as exc:  # pragma: no cover - facts should not block raw activity ingest
        logger.warning("Failed rebuilding iPhone Time facts for user=%s: %s", user_id, exc)
