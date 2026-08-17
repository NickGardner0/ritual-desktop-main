"""Deterministic demo habit data for disposable local databases.

This module deliberately has no executable entry point. Callers must provide a
service instance configured without Tinybird and an explicit disposable SQLite
URL. Production and remote database URLs are rejected before any service call.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from random import Random
import tempfile
from typing import Any, Protocol
from urllib.parse import unquote, urlparse

from models.habit_models import HabitCreate, HabitLogCreate


FIXTURE_SOURCE = "demo_fixture_v2"


class DemoHabitService(Protocol):
    tinybird_enabled: bool

    async def create_habit(self, payload: HabitCreate, user_id: str) -> Any: ...

    async def log_habit(
        self,
        habit_id: str,
        payload: HabitLogCreate,
        user_id: str,
    ) -> Any: ...

    async def get_habit_by_id(self, habit_id: str, user_id: str) -> Any: ...

    async def delete_habit(self, habit_id: str, user_id: str) -> None: ...


@dataclass(frozen=True)
class DemoFixtureReceipt:
    version: int
    user_id: str
    habit_ids: tuple[str, ...]
    log_ids: tuple[str, ...]
    source: str = FIXTURE_SOURCE

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["habit_ids"] = list(self.habit_ids)
        payload["log_ids"] = list(self.log_ids)
        return payload


def assert_disposable_database_url(database_url: str) -> Path | None:
    """Return the resolved SQLite path or reject a non-disposable target."""

    parsed = urlparse(database_url)
    if parsed.scheme not in {"sqlite", "sqlite+aiosqlite"}:
        raise ValueError("Demo fixtures require a disposable SQLite database URL")

    raw_path = unquote(parsed.path or "")
    if raw_path in {"", "/:memory:", ":memory:"}:
        return None

    resolved = Path(raw_path).resolve()
    temporary_root = Path(tempfile.gettempdir()).resolve()
    if resolved != temporary_root and temporary_root not in resolved.parents:
        raise ValueError(
            f"Demo fixture database must be inside {temporary_root}; got {resolved}"
        )
    return resolved


async def seed_demo_fixture(
    service: DemoHabitService,
    *,
    database_url: str,
    user_id: str,
    days: int = 14,
    random_seed: int = 20260817,
) -> DemoFixtureReceipt:
    """Seed deterministic data through the habit service and return cleanup IDs."""

    assert_disposable_database_url(database_url)
    if service.tinybird_enabled:
        raise ValueError("Demo fixtures refuse services with Tinybird enabled")
    if not user_id.strip():
        raise ValueError("user_id is required")

    bounded_days = max(1, min(int(days), 90))
    rng = Random(random_seed)
    definitions = (
        ("[Demo] Deep Work", "PRODUCTIVITY", "brain", "Hours"),
        ("[Demo] Meditation", "WELLNESS", "sparkles", "Minutes"),
        ("[Demo] Reading", "EDUCATION", "book", "Pages"),
    )
    habit_ids: list[str] = []
    log_ids: list[str] = []
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    for name, category, icon, unit in definitions:
        habit = await service.create_habit(
            HabitCreate(
                name=name,
                category=category,
                icon=icon,
                is_custom=True,
                unit_type=unit,
                source=FIXTURE_SOURCE,
                actor_type="system",
            ),
            user_id,
        )
        habit_id = str(habit.id)
        habit_ids.append(habit_id)

        for offset in range(bounded_days):
            if rng.random() < 0.25:
                continue
            completed_at = now - timedelta(days=offset, hours=rng.choice((0, 2, 5)))
            unit_lower = unit.lower()
            duration = None
            amount = None
            if "hour" in unit_lower:
                duration = int(max(0.25, rng.gauss(1.5, 0.45)) * 3600)
            elif "minute" in unit_lower:
                duration = int(max(5, rng.gauss(20, 6)) * 60)
            else:
                amount = float(max(1, round(rng.gauss(24, 7))))
            log = await service.log_habit(
                habit_id,
                HabitLogCreate(
                    duration=duration,
                    amount=amount,
                    date=completed_at.date().isoformat(),
                    completed_at=completed_at.isoformat(),
                    status="completed",
                    source=FIXTURE_SOURCE,
                    actor_type="system",
                    client_event_id=(
                        f"{FIXTURE_SOURCE}:{user_id}:{habit_id}:{completed_at.date().isoformat()}"
                    ),
                ),
                user_id,
            )
            log_ids.append(str(log.id))

    return DemoFixtureReceipt(
        version=1,
        user_id=user_id,
        habit_ids=tuple(habit_ids),
        log_ids=tuple(log_ids),
    )


async def cleanup_demo_fixture(
    service: DemoHabitService,
    receipt: DemoFixtureReceipt,
) -> None:
    """Idempotently remove the fixture habits and their cascading logs."""

    for habit_id in receipt.habit_ids:
        if await service.get_habit_by_id(habit_id, receipt.user_id) is not None:
            await service.delete_habit(habit_id, receipt.user_id)
