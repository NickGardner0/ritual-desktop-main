"""Reverse geocoder: turn (lat, lon) into a human-friendly place label.

v1 uses OpenStreetMap Nominatim (free, rate-limited 1 req/s, requires User-Agent).
Future: swap for Apple MapKit Server-Side API (higher quota, JWT auth).

Best-effort: failures are logged and swallowed; the place_label stays null
and the user_location_state row is still valid for queries.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

from sqlalchemy import update

from database.connection import get_db_session
from database.models import UserLocationStateDB

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_USER_AGENT = os.getenv("RITUAL_NOMINATIM_UA", "RitualApp/1.0 (location-tracking)")
GEOCODE_TIMEOUT_S = 5.0
DEFAULT_PLACE_CONFIDENCE = 0.7


async def reverse_geocode(lat: float, lon: float) -> Optional[str]:
    """Return a short human label, or None on failure.

    Uses httpx if available; otherwise returns None. We import lazily so
    the geocoder is a no-op in environments without httpx.
    """
    try:
        import httpx  # type: ignore
    except ImportError:
        logger.debug("httpx not installed; reverse_geocode is a no-op")
        return None

    try:
        async with httpx.AsyncClient(timeout=GEOCODE_TIMEOUT_S) as client:
            response = await client.get(
                NOMINATIM_URL,
                params={"lat": lat, "lon": lon, "format": "json", "zoom": 18},
                headers={"User-Agent": NOMINATIM_USER_AGENT},
            )
            if response.status_code != 200:
                logger.info("Nominatim returned %d for (%f, %f)", response.status_code, lat, lon)
                return None
            data = response.json()
    except (asyncio.TimeoutError, Exception) as exc:
        logger.info("Nominatim error: %s", exc)
        return None

    addr = data.get("address", {}) if isinstance(data, dict) else {}
    return (
        data.get("name")
        or addr.get("amenity")
        or addr.get("road")
        or addr.get("suburb")
        or addr.get("neighbourhood")
        or addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or None
    )


async def enqueue_reverse_geocode(
    user_id: str,
    lat: float,
    lon: float,
) -> None:
    """Schedule reverse-geocoding and return without blocking ingest.

    This deliberately uses a separate DB session so location ingest can commit
    quickly even when the third-party geocoder is slow or unavailable.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        await _reverse_geocode_and_persist(user_id, lat, lon)
        return

    loop.create_task(_reverse_geocode_and_persist(user_id, lat, lon))


async def _reverse_geocode_and_persist(user_id: str, lat: float, lon: float) -> None:
    try:
        label = await reverse_geocode(lat, lon)
        if not label:
            return

        async with get_db_session() as session:
            await session.execute(
                update(UserLocationStateDB)
                .where(UserLocationStateDB.user_id == user_id)
                .values(place_label=label, place_confidence=DEFAULT_PLACE_CONFIDENCE)
            )
            await session.commit()
    except Exception as exc:  # pragma: no cover - best-effort background task
        logger.info("Reverse geocode background task failed: %s", exc)
