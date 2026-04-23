import os
import sys
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.sms_log_enrichment_service import SmsLogEnrichmentService


def _log(day: str, *, amount=None):
    return SimpleNamespace(
        date=day,
        amount=amount,
        duration=None,
    )


class SmsLogEnrichmentServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_build_insight_prioritizes_weekly_delta_over_streak(self):
        service = SmsLogEnrichmentService()
        habit = SimpleNamespace(
            id="habit-1",
            name="Workout",
            unit_type="minutes",
            category="health",
            metric_type=None,
            integration_source=None,
        )
        logs = [
            _log("2026-04-14", amount=30),
            _log("2026-04-15", amount=30),
            _log("2026-04-16", amount=30),
            _log("2026-04-17", amount=30),
            _log("2026-04-18", amount=30),
            _log("2026-04-19", amount=30),
            _log("2026-04-20", amount=30),
            _log("2026-04-21", amount=30),
            _log("2026-04-22", amount=60),
        ]

        with patch.object(service, "_corroboration", AsyncMock(return_value=None)):
            insight_type, insight, metrics = await service._build_insight(
                user_id="user-1",
                habit=habit,
                logs=logs,
                amount=60,
                log_day=date.fromisoformat("2026-04-22"),
            )

        self.assertEqual(insight_type, "weekly_delta")
        self.assertIn("7-day average", insight)
        self.assertGreater(metrics["percent_delta"], 0)

    async def test_build_insight_prefers_streak_over_today_count(self):
        service = SmsLogEnrichmentService()
        habit = SimpleNamespace(
            id="habit-1",
            name="Meditation",
            unit_type="sessions",
            category="mindset",
            metric_type=None,
            integration_source=None,
        )
        logs = [
            _log("2026-04-20"),
            _log("2026-04-21"),
            _log("2026-04-22"),
            _log("2026-04-22"),
        ]

        with patch.object(service, "_corroboration", AsyncMock(return_value=None)):
            insight_type, insight, metrics = await service._build_insight(
                user_id="user-1",
                habit=habit,
                logs=logs,
                amount=None,
                log_day=date.fromisoformat("2026-04-22"),
            )

        self.assertEqual(insight_type, "streak")
        self.assertIn("3-day streak", insight)
        self.assertEqual(metrics["streak_days"], 3)
