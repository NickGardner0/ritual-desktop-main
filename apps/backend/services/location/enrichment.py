"""Attach location data to habit logs at creation time.

Called from every code path that creates a HabitLogDB. Resolves location
from the freshest available signal via services.location.resolver.resolve_for.

Idempotent: calling twice on the same log is a no-op (preserves existing
location data). Safe to call before commit OR re-call to backfill.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from database.models import HabitLogDB
from services.location.resolver import resolve_for
from services.location.util import now_ms

logger = logging.getLogger(__name__)


async def enrich_habit_log(log: HabitLogDB, *, user_id: Optional[str] = None) -> HabitLogDB:
    """Populate `log.location_*` columns in-place if not already set.

    `user_id` may be passed explicitly when the log isn't yet bound to a
    relationship; otherwise it falls back to `log.habit.user_id` if available.

    Safe to call multiple times. Will not overwrite existing location data.
    """
    if log.location_lat is not None:
        return log  # already enriched

    resolved_user_id = user_id or _user_id_from_log(log)
    if not resolved_user_id:
        logger.debug("enrich_habit_log: no user_id resolvable; skipping")
        return log

    target_ts_ms = _log_timestamp_ms(log)
    if target_ts_ms is None:
        logger.debug("enrich_habit_log: no usable timestamp on log id=%s", log.id)
        return log

    try:
        resolved = await resolve_for(resolved_user_id, target_ts_ms)
    except Exception as exc:  # pragma: no cover — resolver is best-effort
        logger.warning("Location resolve failed for user=%s: %s", resolved_user_id, exc)
        return log

    if resolved is None:
        return log

    log.location_lat = resolved.lat
    log.location_lon = resolved.lon
    log.location_accuracy_m = resolved.horizontal_accuracy_m
    log.location_source = resolved.source
    log.location_place_label = resolved.place_label
    log.location_confidence = resolved.confidence
    log.location_resolved_at = now_ms()
    log.location_signal_age_ms = resolved.signal_age_ms
    return log


async def resolve_habit_location_fields(
    *,
    user_id: str,
    completed_at: Optional[str],
) -> dict:
    """Resolve location fields for non-ORM habit-log write paths.

    Some hot paths bulk insert dictionaries or raw SQL instead of constructing a
    `HabitLogDB` object. This returns the same `location_*` column values that
    `enrich_habit_log` would set, or an empty dict when no signal is available.
    """
    target_ts_ms = _completed_at_to_ms(completed_at)
    if target_ts_ms is None:
        target_ts_ms = now_ms()

    try:
        resolved = await resolve_for(user_id, target_ts_ms)
    except Exception as exc:  # pragma: no cover — resolver is best-effort
        logger.warning("Location resolve failed for user=%s: %s", user_id, exc)
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


def _user_id_from_log(log: HabitLogDB) -> Optional[str]:
    """Try to extract user_id without triggering a relationship load."""
    habit = getattr(log, "habit", None)
    if habit is not None:
        return getattr(habit, "user_id", None)
    return None


def _log_timestamp_ms(log: HabitLogDB) -> Optional[int]:
    """Convert HabitLog.completed_at (ISO string) to ms since epoch.

    Falls back to now_ms() if completed_at is missing or unparseable.
    """
    completed_at = getattr(log, "completed_at", None)
    parsed = _completed_at_to_ms(completed_at)
    if parsed is not None:
        return parsed
    if completed_at:
        logger.debug("Could not parse completed_at=%r on log id=%s", completed_at, log.id)

    # Fall back to wall clock
    return now_ms()


def _completed_at_to_ms(completed_at: Optional[str]) -> Optional[int]:
    if not completed_at:
        return None
    try:
        normalized = completed_at.replace("Z", "+00:00") if completed_at.endswith("Z") else completed_at
        dt = datetime.fromisoformat(normalized)
        return int(dt.timestamp() * 1000)
    except (ValueError, AttributeError):
        return None
