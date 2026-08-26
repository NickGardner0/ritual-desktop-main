from __future__ import annotations

import pathlib
import os
import sys
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", "sqlite:///test-computed-computer-time.db")
os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")

from models.habit_models import HabitLogCreate  # noqa: E402
from services.habits_service import (  # noqa: E402
    ComputedMetricReadOnlyError,
    HabitsService,
    is_computed_computer_time_habit,
)
from services.computed_metrics_service import computed_metrics_service  # noqa: E402


class ComputedComputerTimeHabitTests(unittest.IsolatedAsyncioTestCase):
    def test_discriminator_uses_metric_type_not_display_name(self):
        self.assertTrue(is_computed_computer_time_habit(SimpleNamespace(metric_type="computer_time")))
        self.assertFalse(is_computed_computer_time_habit(SimpleNamespace(metric_type=None, name="Computer Time")))
        self.assertTrue(is_computed_computer_time_habit(SimpleNamespace(
            metric_type=None,
            name="Computer Use",
            is_custom=False,
            integration_source=None,
            sensor_type="Automatic",
        )))
        self.assertFalse(is_computed_computer_time_habit(SimpleNamespace(
            metric_type=None,
            name="Computer Time",
            is_custom=True,
        )))

    async def test_manual_log_is_rejected_before_any_write(self):
        service = HabitsService()

        @asynccontextmanager
        async def fake_session():
            yield SimpleNamespace()

        with patch("services.habits_service.get_db_session", fake_session), patch.object(
            service,
            "get_habit_by_id",
            AsyncMock(return_value=SimpleNamespace(
                id="computer-habit",
                name="Computer Time",
                metric_type="computer_time",
            )),
        ):
            with self.assertRaises(ComputedMetricReadOnlyError):
                await service.log_habit(
                    "computer-habit",
                    HabitLogCreate(date="2026-08-26", amount=1),
                    "user-1",
                )

    async def test_computed_provider_uses_rollups_and_never_projection_logs(self):
        habit = SimpleNamespace(
            id="computer-habit",
            name="Computer Time",
            category="Activity",
            metric_type="computer_time",
        )
        snapshot = {
            "state": "ready",
            "empty_reason": None,
            "last_synced_at": "2026-08-26T12:00:00Z",
            "summary": {"total_active_ms": 5_400_000, "total_events": 12},
            "daily": [
                {"day": "2026-08-25", "active_ms": 3_600_000},
                {"day": "2026-08-26", "active_ms": 1_800_000},
            ],
        }
        with patch(
            "services.watcher_service.watcher_service.get_computer_activity_snapshot",
            AsyncMock(return_value=snapshot),
        ):
            stats = await computed_metrics_service.build_habit_stats(
                user_id="user-1",
                habit=habit,
                start_date="2026-08-25",
                end_date="2026-08-26",
            )
        self.assertEqual(stats["total"], 1.5)
        self.assertEqual(stats["days_with_data"], 2)
        self.assertEqual(stats["total_entries"], 12)
        self.assertEqual(stats["state"], "ready")

    async def test_unavailable_computed_metric_is_not_a_factual_zero(self):
        habit = SimpleNamespace(
            id="computer-habit",
            name="Computer Time",
            category="Activity",
            metric_type="computer_time",
        )
        snapshot = {
            "state": "unavailable",
            "empty_reason": "aggregation_unavailable",
            "summary": {"total_active_ms": 0},
            "daily": [],
        }
        with patch(
            "services.watcher_service.watcher_service.get_computer_activity_snapshot",
            AsyncMock(return_value=snapshot),
        ):
            stats = await computed_metrics_service.build_habit_stats(
                user_id="user-1",
                habit=habit,
                start_date="2026-08-25",
                end_date="2026-08-26",
            )
        self.assertIsNone(stats["total"])
        self.assertEqual(stats["state"], "unavailable")


if __name__ == "__main__":
    unittest.main()
