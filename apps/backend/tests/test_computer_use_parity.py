import sys
import types
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

# Inject a lightweight database.connection stub so importing watcher_service
# does not require sqlite+aiolibsql in unit-test environments.
fake_connection_module = types.ModuleType("database.connection")

@asynccontextmanager
async def _unused_db_session():
    yield None

fake_connection_module.get_db_session = _unused_db_session
sys.modules["database.connection"] = fake_connection_module

from services.watcher_service import WatcherService


class _FakeExecuteResult:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeSession:
    def __init__(self, row):
        self._row = row

    async def execute(self, *args, **kwargs):
        return _FakeExecuteResult(self._row)


def _fake_db_session_factory(row):
    @asynccontextmanager
    async def _ctx():
        yield _FakeSession(row)

    return _ctx


class ComputerUseParityTests(unittest.IsolatedAsyncioTestCase):
    async def test_range_parity_passes_within_tolerance(self):
        service = WatcherService()
        service.get_computer_time_summary = AsyncMock(return_value={"total_active_ms": 7_200_000})  # 2 hours
        service._find_computer_use_habit = AsyncMock(
            return_value=("habit-1", "Computer Use", "Hours")
        )

        # SUM(duration)=7200s, SUM(amount)=2.0h, rows_count=7
        with patch("services.watcher_service.get_db_session", _fake_db_session_factory((7200, 2.0, 7))):
            result = await service.validate_computer_use_range_parity(
                user_id="user-1",
                start_date="2026-02-10",
                end_date="2026-02-16",
                tolerance_seconds=60,
            )

        self.assertTrue(result["success"])
        self.assertTrue(result["parity_ok"])
        self.assertEqual(result["duration_delta_seconds"], 0)

    async def test_range_parity_fails_outside_tolerance(self):
        service = WatcherService()
        service.get_computer_time_summary = AsyncMock(return_value={"total_active_ms": 7_200_000})  # 2 hours
        service._find_computer_use_habit = AsyncMock(
            return_value=("habit-1", "Computer Use", "Hours")
        )

        # SUM(duration)=6600s (delta 600s), amount off by 0.2h -> should fail.
        with patch("services.watcher_service.get_db_session", _fake_db_session_factory((6600, 1.8, 7))):
            result = await service.validate_computer_use_range_parity(
                user_id="user-1",
                start_date="2026-02-10",
                end_date="2026-02-16",
                tolerance_seconds=60,
            )

        self.assertTrue(result["success"])
        self.assertFalse(result["parity_ok"])
        self.assertGreater(result["duration_delta_seconds"], 60)


if __name__ == "__main__":
    unittest.main()
