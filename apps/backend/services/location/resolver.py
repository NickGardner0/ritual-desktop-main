"""Resolver: pick the freshest, highest-confidence location signal for a given timestamp.

Used by services.location.enrichment to attach location to habit logs at create time.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional, Sequence

from sqlalchemy import select

from database.connection import get_db_session
from database.models import UserLocationPingDB, UserLocationStateDB
from services.location.models import ResolvedLocation

logger = logging.getLogger(__name__)


# (source, max_age_ms, base_confidence)
# Ordered: try high-confidence sources within tight windows first, then loosen.
TIER_RULES: list[tuple[str, int, float]] = [
    ("ios_scls",          5  * 60_000, 0.99),
    ("ios_one_shot",      5  * 60_000, 0.97),
    ("mac_bssid_trigger", 5  * 60_000, 0.98),
    ("mac_one_shot",      10 * 60_000, 0.95),
    ("ios_scls",          15 * 60_000, 0.85),
    ("ios_one_shot",      15 * 60_000, 0.80),
    ("garmin_workout",    10 * 60_000, 0.75),
    ("mac_one_shot",      30 * 60_000, 0.65),
    ("ios_scls",          60 * 60_000, 0.55),
]

# If state is within this window of the target timestamp, take it directly
# without scanning the pings table (fast path).
STATE_DIRECT_WINDOW_MS = 60 * 60_000  # 1 hour

# Confidence values for the state-direct path
STATE_BASE_CONFIDENCE = {
    "ios_scls": 0.99,
    "ios_one_shot": 0.97,
    "mac_bssid_trigger": 0.98,
    "mac_one_shot": 0.95,
}


@dataclass(frozen=True)
class _CandidatePing:
    lat: float
    lon: float
    horizontal_accuracy_m: Optional[float]
    source: str
    client_ts: int


async def resolve_for(user_id: str, target_ts_ms: int) -> Optional[ResolvedLocation]:
    """Resolve the best-available location signal at `target_ts_ms`.

    Returns None if no signal is available within the configured tier windows.
    """
    async with get_db_session() as session:
        # Fast path: materialized state within 1h of target.
        state = (
            await session.execute(
                select(UserLocationStateDB).where(UserLocationStateDB.user_id == user_id)
            )
        ).scalar_one_or_none()

        if state is not None:
            age_ms = target_ts_ms - state.ping_client_ts
            if (
                state.lat is not None
                and state.lon is not None
                and 0 <= age_ms <= STATE_DIRECT_WINDOW_MS
            ):
                return ResolvedLocation(
                    lat=state.lat,
                    lon=state.lon,
                    horizontal_accuracy_m=state.horizontal_accuracy_m,
                    source=state.source,
                    confidence=_decay_confidence(state.source, age_ms),
                    signal_age_ms=age_ms,
                    place_label=state.place_label,
                )

        max_window = max(window_ms for _, window_ms, _ in TIER_RULES)
        rows = (
            await session.execute(
                select(UserLocationPingDB).where(
                    UserLocationPingDB.user_id == user_id,
                    UserLocationPingDB.lat.is_not(None),
                    UserLocationPingDB.lon.is_not(None),
                    UserLocationPingDB.client_ts.between(
                        target_ts_ms - max_window,
                        target_ts_ms + max_window,
                    ),
                )
            )
        ).scalars().all()
        candidates = [
            _CandidatePing(
                lat=row.lat,
                lon=row.lon,
                horizontal_accuracy_m=row.horizontal_accuracy_m,
                source=row.source,
                client_ts=row.client_ts,
            )
            for row in rows
            if row.lat is not None and row.lon is not None
        ]
        resolved = _resolve_from_candidates(target_ts_ms, candidates)
        if resolved is not None:
            return resolved

    return None


async def resolve_many_for(
    user_id: str,
    target_timestamps_ms: Sequence[int],
) -> dict[int, Optional[ResolvedLocation]]:
    """Resolve many timestamps using one DB session and one candidate ping scan."""
    targets = list(dict.fromkeys(int(ts) for ts in target_timestamps_ms))
    if not targets:
        return {}
    min_target = min(targets)
    max_target = max(targets)
    max_window = max(window_ms for _, window_ms, _ in TIER_RULES)

    async with get_db_session() as session:
        state = (
            await session.execute(
                select(UserLocationStateDB).where(UserLocationStateDB.user_id == user_id)
            )
        ).scalar_one_or_none()
        rows = (
            await session.execute(
                select(UserLocationPingDB).where(
                    UserLocationPingDB.user_id == user_id,
                    UserLocationPingDB.lat.is_not(None),
                    UserLocationPingDB.lon.is_not(None),
                    UserLocationPingDB.client_ts.between(
                        min_target - max_window,
                        max_target + max_window,
                    ),
                )
            )
        ).scalars().all()

    candidates = [
        _CandidatePing(
            lat=row.lat,
            lon=row.lon,
            horizontal_accuracy_m=row.horizontal_accuracy_m,
            source=row.source,
            client_ts=row.client_ts,
        )
        for row in rows
        if row.lat is not None and row.lon is not None
    ]
    return {
        target: _resolve_from_state_or_candidates(target, state, candidates)
        for target in targets
    }


def _resolve_from_state_or_candidates(
    target_ts_ms: int,
    state: Optional[UserLocationStateDB],
    candidates: Sequence[_CandidatePing],
) -> Optional[ResolvedLocation]:
    if state is not None:
        age_ms = target_ts_ms - state.ping_client_ts
        if (
            state.lat is not None
            and state.lon is not None
            and 0 <= age_ms <= STATE_DIRECT_WINDOW_MS
        ):
            return ResolvedLocation(
                lat=state.lat,
                lon=state.lon,
                horizontal_accuracy_m=state.horizontal_accuracy_m,
                source=state.source,
                confidence=_decay_confidence(state.source, age_ms),
                signal_age_ms=age_ms,
                place_label=state.place_label,
            )
    return _resolve_from_candidates(target_ts_ms, candidates)


def _resolve_from_candidates(
    target_ts_ms: int,
    candidates: Sequence[_CandidatePing],
) -> Optional[ResolvedLocation]:
    for source, window_ms, conf in TIER_RULES:
        nearest = min(
            (
                candidate
                for candidate in candidates
                if candidate.source == source
                and abs(candidate.client_ts - target_ts_ms) <= window_ms
            ),
            key=lambda candidate: abs(candidate.client_ts - target_ts_ms),
            default=None,
        )
        if nearest is not None:
            return ResolvedLocation(
                lat=nearest.lat,
                lon=nearest.lon,
                horizontal_accuracy_m=nearest.horizontal_accuracy_m,
                source=nearest.source,
                confidence=conf,
                signal_age_ms=abs(target_ts_ms - nearest.client_ts),
                place_label=None,
            )
    return None


def _decay_confidence(source: str, age_ms: int) -> float:
    """Decay confidence linearly across the first hour."""
    base = STATE_BASE_CONFIDENCE.get(source, 0.7)
    decay_factor = min(1.0, max(0.0, age_ms) / (60 * 60_000)) * 0.3
    return max(0.4, base - decay_factor)
