"""Regression tests for manual habit logging read-after-write consistency."""

from __future__ import annotations

import pathlib
import sys
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.habits_service import HabitsService  # noqa: E402


class _FakeScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeExecuteResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _FakeScalarResult(self._rows)


class _FakeSession:
    def __init__(self, rows):
        self._rows = rows
        self.added = []
        self.committed = False

    async def execute(self, _query):
        return _FakeExecuteResult(self._rows)

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        self.committed = True

    async def rollback(self):
        pass


class ManualLogConsistencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_refresh_metric_facts_uses_affected_habits_and_dates(self):
        service = HabitsService()
        rebuild = AsyncMock(return_value={"success": True})

        with patch("services.metric_facts_service.metric_fact_service.rebuild_facts", rebuild):
            result = await service._refresh_metric_facts_for_logs(
                user_id="user-1",
                logs=[
                    SimpleNamespace(habit_id="habit-workout", date="2026-05-29"),
                    SimpleNamespace(habit_id="habit-caffeine", date="2026-05-28"),
                ],
            )

        self.assertEqual(result, {"success": True})
        rebuild.assert_awaited_once_with(
            user_id="user-1",
            start_date="2026-05-28",
            end_date="2026-05-29",
            habit_ids=["habit-caffeine", "habit-workout"],
            include_legacy_fallback=True,
            apply=True,
        )

    async def test_batch_log_returns_canonical_snapshot_after_fact_refresh(self):
        service = HabitsService()
        service.tinybird_enabled = False
        habit = SimpleNamespace(
            id="habit-workout",
            name="Workout",
            category="Health",
            unit_type="Hours",
            integration_source=None,
            metric_type=None,
        )
        session = _FakeSession([habit])

        @asynccontextmanager
        async def fake_get_db_session():
            yield session

        refresh = AsyncMock(return_value={"success": True, "facts": {"written": 1}})
        snapshot = {
            "overviewStats": {
                "habit-workout": {"total": 1, "days_with_data": 1},
                "habit-caffeine": {"total": 450, "days_with_data": 4},
            }
        }
        build_snapshot = AsyncMock(return_value=snapshot)

        def fake_safe_background_task(coro, _name):
            coro.close()
            async def _noop():
                return None
            return _noop()

        def close_background_task(coro):
            coro.close()
            return SimpleNamespace(cancel=lambda: None)

        with patch("services.habits_service.get_db_session", fake_get_db_session), \
            patch("services.location.enrichment.enrich_habit_log", new=AsyncMock()), \
            patch.object(service, "_refresh_metric_facts_for_logs", refresh), \
            patch.object(service, "_build_post_write_overview_snapshot", build_snapshot), \
            patch.object(service, "_safe_background_task", new=fake_safe_background_task), \
            patch("services.habits_service.asyncio.create_task", side_effect=close_background_task):
            result = await service.batch_log_habits(
                items=[
                    {
                        "habit_id": "habit-workout",
                        "date": "2026-05-29",
                        "duration": 3600,
                        "source": "ai_log_v2_fast",
                        "notes": "worked out for 1 hour",
                    }
                ],
                user_id="user-1",
                client_event_id=None,
            )

        self.assertTrue(session.committed)
        self.assertTrue(result["success"])
        self.assertEqual(result["overview_snapshot"], snapshot)
        self.assertEqual(result["metric_facts"], {"success": True, "facts": {"written": 1}})
        self.assertEqual(result["affectedHabitIds"], ["habit-workout"])
        self.assertEqual(result["affectedDates"], ["2026-05-29"])
        self.assertEqual(result["results"][0]["value"], 1)
        self.assertEqual(result["results"][0]["unit"], "Hours")
        self.assertEqual(result["results"][0]["date"], "2026-05-29")
        refresh.assert_awaited_once()
        build_snapshot.assert_awaited_once_with(user_id="user-1")


if __name__ == "__main__":
    unittest.main()
