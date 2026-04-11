"""Tests for fire-and-forget background task helpers in habits_service."""

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


class FakeHabitsService:
    """Minimal stub that only mixes in the background-task helpers."""

    def __init__(self):
        self.tinybird_enabled = True
        self.tinybird = MagicMock()

    # Import the real methods from habits_service
    from services.habits_service import HabitsService

    _safe_background_task = HabitsService._safe_background_task
    _fire_habit_log_side_effects = HabitsService._fire_habit_log_side_effects
    _fire_habit_definition_side_effects = HabitsService._fire_habit_definition_side_effects


class TestSafeBackgroundTask(unittest.IsolatedAsyncioTestCase):
    async def test_success_runs_coroutine(self):
        svc = FakeHabitsService()
        called = False

        async def work():
            nonlocal called
            called = True

        await svc._safe_background_task(work(), "test_task")
        self.assertTrue(called)

    async def test_exception_is_logged_not_raised(self):
        svc = FakeHabitsService()

        async def failing():
            raise RuntimeError("boom")

        with patch("services.habits_service.logger") as mock_logger:
            await svc._safe_background_task(failing(), "failing_task")
            mock_logger.error.assert_called_once()
            self.assertIn("failing_task", mock_logger.error.call_args[0][1])


class TestFireAndForgetDoesNotBlock(unittest.IsolatedAsyncioTestCase):
    async def test_log_side_effects_return_immediately(self):
        """_fire_habit_log_side_effects should schedule tasks, not await them."""
        svc = FakeHabitsService()

        habit_log = MagicMock(
            id="log1",
            habit_id="h1",
            habit_name="Test",
            date="2026-04-10",
            completed_at="2026-04-10T12:00:00Z",
            amount=1,
            duration=0,
            status="completed",
        )
        habit = MagicMock(id="h1", name="Test", category="health")

        # Patch Tinybird sync to hang forever — if we await it, the test times out
        async def hang_forever(*a, **kw):
            await asyncio.sleep(9999)

        svc._sync_habit_log_to_tinybird = hang_forever

        with patch("services.habits_service.websocket_manager"):
            with patch("services.habits_service.search_service", create=True):
                # This should return instantly because it uses create_task
                svc._fire_habit_log_side_effects(habit_log, habit, "user1")

        # If we got here, the method didn't block on the hanging coroutine
        self.assertTrue(True)

    async def test_definition_side_effects_return_immediately(self):
        svc = FakeHabitsService()
        habit = MagicMock(id="h1", name="Test")

        async def hang_forever(*a, **kw):
            await asyncio.sleep(9999)

        svc._sync_habit_to_tinybird = hang_forever

        with patch("services.habits_service.search_service", create=True):
            svc._fire_habit_definition_side_effects(habit, "user1")

        self.assertTrue(True)


class TestBatchIndexingPayload(unittest.TestCase):
    """Verify batch indexing converts HabitLogDB → Pydantic before .model_dump()."""

    def test_habit_log_db_to_pydantic_produces_model_dump(self):
        """The converted Pydantic model must have .model_dump() that returns a dict
        with the expected keys — this is what search_service.index_habit_log receives."""
        from database.helpers import habit_log_db_to_pydantic
        from database.models import HabitLogDB

        row = HabitLogDB(
            id="log-1",
            habit_id="h-1",
            habit_name="Caffeine",
            duration=0,
            amount=2.0,
            date="2026-04-10",
            completed_at="2026-04-10T12:00:00Z",
            status="completed",
            notes="2 coffees",
            source="ai_log_v2",
            log_metadata=None,
        )

        pydantic_log = habit_log_db_to_pydantic(row)
        payload = pydantic_log.model_dump()

        self.assertIsInstance(payload, dict)
        self.assertEqual(payload["id"], "log-1")
        self.assertEqual(payload["habit_id"], "h-1")
        self.assertEqual(payload["habit_name"], "Caffeine")
        self.assertEqual(payload["amount"], 2.0)
        self.assertEqual(payload["date"], "2026-04-10")
        self.assertEqual(payload["status"], "completed")

    def test_sqlalchemy_row_has_no_model_dump(self):
        """HabitLogDB (SQLAlchemy) must NOT have .model_dump() — confirms the bug
        that existed before the fix."""
        from database.models import HabitLogDB

        row = HabitLogDB(id="x", habit_id="y", date="2026-01-01")
        self.assertFalse(hasattr(row, "model_dump"))


if __name__ == "__main__":
    unittest.main()
