"""Ingest location pings from clients.

Writes to `user_location_pings` (append-only) and updates `user_location_state`
(materialized current location). Idempotent on `client_event_id`.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from database.connection import get_db_session
from database.models import UserLocationPingDB, UserLocationStateDB
from services.location.models import LocationPing
from services.location.util import haversine_m, now_ms

logger = logging.getLogger(__name__)

# Pings older than this aren't useful for "current state" updates,
# but we still record them for historical lookups.
MAX_STATE_LAG_MS = 24 * 60 * 60 * 1000  # 24 hours

# Pings with accuracy worse than this are dropped entirely as noise.
MAX_ACCURACY_M = 5000.0

# Pings from this far in the future indicate a broken client clock — drop.
MAX_FUTURE_SKEW_MS = 60_000

# Distance threshold for "moved significantly" — triggers re-geocoding.
SIGNIFICANT_MOVE_M = 100.0


@dataclass
class IngestResult:
    accepted: int
    rejected: int
    duplicates: int
    accepted_ids: tuple[str, ...] = ()
    duplicate_ids: tuple[str, ...] = ()
    rejected_ids: tuple[str, ...] = ()


async def ingest_location_pings(
    user_id: str,
    pings: list[LocationPing],
) -> IngestResult:
    """Insert pings and update materialized state.

    Idempotent: pings with a `client_event_id` already present are counted
    as duplicates and not re-inserted.
    """
    if not pings:
        return IngestResult(0, 0, 0)

    server_now = now_ms()
    accepted = 0
    duplicates = 0
    rejected = 0
    accepted_ids: list[str] = []
    duplicate_ids: list[str] = []
    rejected_ids: list[str] = []
    accepted_timestamps: list[int] = []
    freshest: Optional[LocationPing] = None

    async with get_db_session() as session:
        for ping in pings:
            if not _is_sane_ping(ping, server_now):
                rejected += 1
                rejected_ids.append(ping.client_event_id)
                continue

            stmt = (
                sqlite_insert(UserLocationPingDB)
                .values(
                    user_id=user_id,
                    lat=ping.lat,
                    lon=ping.lon,
                    horizontal_accuracy_m=ping.horizontal_accuracy_m,
                    source=ping.source,
                    device_id=ping.device_id,
                    bssid=ping.bssid,
                    ssid=ping.ssid,
                    client_ts=ping.client_ts,
                    server_ts=server_now,
                    client_event_id=ping.client_event_id,
                    raw_payload=json.dumps(ping.model_dump()),
                )
                .on_conflict_do_nothing(index_elements=["client_event_id"])
            )

            result = await session.execute(stmt)
            if result.rowcount and result.rowcount > 0:
                accepted += 1
                accepted_ids.append(ping.client_event_id)
                accepted_timestamps.append(ping.client_ts)
                if freshest is None or ping.client_ts > freshest.client_ts:
                    freshest = ping
            else:
                duplicates += 1
                duplicate_ids.append(ping.client_event_id)

        if freshest is not None:
            await _maybe_update_state(session, user_id, freshest, server_now)

        await session.commit()

    if accepted_timestamps:
        await _backfill_after_accepted_pings(user_id, accepted_timestamps)

    logger.info(
        "Location ingest user=%s accepted=%d duplicates=%d rejected=%d",
        user_id, accepted, duplicates, rejected,
    )
    return IngestResult(
        accepted=accepted,
        rejected=rejected,
        duplicates=duplicates,
        accepted_ids=tuple(accepted_ids),
        duplicate_ids=tuple(duplicate_ids),
        rejected_ids=tuple(rejected_ids),
    )


def _is_sane_ping(ping: LocationPing, server_now: int) -> bool:
    if ping.client_ts > server_now + MAX_FUTURE_SKEW_MS:
        return False
    if ping.horizontal_accuracy_m is not None and ping.horizontal_accuracy_m > MAX_ACCURACY_M:
        return False
    has_coords = ping.lat is not None and ping.lon is not None
    if not has_coords:
        return ping.source in {"mac_one_shot", "mac_bssid_trigger"} and bool(ping.bssid or ping.ssid)
    if ping.lat == 0.0 and ping.lon == 0.0 and ping.source.startswith("mac_"):
        return False
    return True


async def _maybe_update_state(
    session,
    user_id: str,
    ping: LocationPing,
    server_now: int,
) -> None:
    """Update materialized state only if the new ping is fresher than current."""
    if ping.lat is None or ping.lon is None:
        return

    if server_now - ping.client_ts > MAX_STATE_LAG_MS:
        return

    current = (
        await session.execute(
            select(UserLocationStateDB).where(UserLocationStateDB.user_id == user_id)
        )
    ).scalar_one_or_none()

    if current is not None and current.ping_client_ts >= ping.client_ts:
        return  # we have something fresher already

    moved_significantly = (
        current is None
        or haversine_m(current.lat, current.lon, ping.lat, ping.lon) > SIGNIFICANT_MOVE_M
    )

    # Preserve place label if we haven't moved far — avoids unnecessary re-geocodes
    place_label = None if moved_significantly else (current.place_label if current else None)
    place_confidence = None if moved_significantly else (current.place_confidence if current else None)

    if current is None:
        session.add(
            UserLocationStateDB(
                user_id=user_id,
                lat=ping.lat,
                lon=ping.lon,
                horizontal_accuracy_m=ping.horizontal_accuracy_m,
                source=ping.source,
                ping_client_ts=ping.client_ts,
                updated_at=server_now,
                place_label=place_label,
                place_confidence=place_confidence,
            )
        )
    else:
        current.lat = ping.lat
        current.lon = ping.lon
        current.horizontal_accuracy_m = ping.horizontal_accuracy_m
        current.source = ping.source
        current.ping_client_ts = ping.client_ts
        current.updated_at = server_now
        if moved_significantly:
            current.place_label = None
            current.place_confidence = None

    if moved_significantly:
        # Reverse-geocode runs as fire-and-forget inside ingest_location_pings
        # so the response is fast and geocoder failures don't block writes.
        try:
            from services.location.geocoder import enqueue_reverse_geocode

            await enqueue_reverse_geocode(user_id, ping.lat, ping.lon)
        except Exception as exc:  # pragma: no cover — geocoder is best-effort
            logger.warning("Reverse geocode skipped for user=%s: %s", user_id, exc)


async def _backfill_after_accepted_pings(user_id: str, accepted_timestamps: list[int]) -> None:
    try:
        from services.location.backfill import DEFAULT_BACKFILL_WINDOW_MS, backfill_recent_location_for_user

        await backfill_recent_location_for_user(
            user_id,
            start_ts_ms=min(accepted_timestamps) - DEFAULT_BACKFILL_WINDOW_MS,
            end_ts_ms=max(accepted_timestamps) + DEFAULT_BACKFILL_WINDOW_MS,
        )
    except Exception as exc:  # pragma: no cover - location backfill must not fail ingest
        logger.warning("Location backfill skipped for user=%s: %s", user_id, exc)
