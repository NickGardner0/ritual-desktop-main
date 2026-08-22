"""Optimistic concurrency and idempotency tests for habit-log edits."""

from __future__ import annotations

import pathlib
import sys
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from models.habit_models import HabitLogUpdate  # noqa: E402
from services.habits_service import (  # noqa: E402
    HabitLogRevisionConflictError,
    HabitsService,
)


class _ScalarOne:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _RowCount:
    def __init__(self, rowcount: int):
        self.rowcount = rowcount


def _log(*, revision: int = 1, idempotency_key: str | None = None):
    return SimpleNamespace(
        id="log-1",
        habit_id="habit-1",
        habit_name="Walk",
        duration=None,
        amount=1.0,
        date="2026-08-22",
        completed_at="2026-08-22T12:00:00+00:00",
        status="completed",
        notes=None,
        source="manual",
        client_event_id=None,
        actor_type="user",
        actor_ref=None,
        revision=revision,
        last_update_idempotency_key=idempotency_key,
        log_metadata=None,
        location_lat=None,
        location_lon=None,
        location_accuracy_m=None,
        location_source=None,
        location_place_label=None,
        location_confidence=None,
        location_resolved_at=None,
        location_signal_age_ms=None,
    )


class _FakeSession:
    def __init__(self, log_row, *, claim_count: int = 1, concurrent_key: str | None = None):
        self.log_row = log_row
        self.claim_count = claim_count
        self.concurrent_key = concurrent_key
        self.execute_count = 0
        self.committed = False
        self.rolled_back = False

    async def execute(self, _query):
        self.execute_count += 1
        if self.execute_count == 1:
            return _ScalarOne(self.log_row)
        if self.execute_count == 2:
            return _RowCount(self.claim_count)
        return _ScalarOne(self.log_row)

    async def commit(self):
        self.committed = True

    async def rollback(self):
        self.rolled_back = True
        if self.concurrent_key:
            self.log_row.revision += 1
            self.log_row.status = "skipped"
            self.log_row.last_update_idempotency_key = self.concurrent_key

    def expire_all(self):
        pass

    async def refresh(self, row):
        row.revision = 2
        row.status = "skipped"
        row.last_update_idempotency_key = "edit-key-123"


class HabitLogUpdateTests(unittest.IsolatedAsyncioTestCase):
    async def test_revision_checked_update_commits_and_fans_out_once(self):
        service = HabitsService()
        service.tinybird_enabled = False
        session = _FakeSession(_log())

        @asynccontextmanager
        async def fake_session():
            yield session

        fire = MagicMock()
        with patch("services.habits_service.get_db_session", fake_session), patch.object(
            service,
            "get_habit_by_id",
            AsyncMock(return_value=SimpleNamespace(id="habit-1", name="Walk")),
        ), patch.object(
            service, "_refresh_metric_facts_for_logs", AsyncMock(return_value={})
        ), patch.object(service, "_fire_habit_log_side_effects", fire):
            result = await service.update_habit_log(
                "habit-1",
                "log-1",
                HabitLogUpdate(
                    expected_revision=1,
                    idempotency_key="edit-key-123",
                    status="skipped",
                ),
                "user-1",
            )

        self.assertTrue(session.committed)
        self.assertEqual(result.revision, 2)
        self.assertEqual(result.status, "skipped")
        fire.assert_called_once()
        self.assertEqual(fire.call_args.kwargs["revision"], 2)

    async def test_stale_revision_fails_before_update(self):
        service = HabitsService()
        session = _FakeSession(_log(revision=3))

        @asynccontextmanager
        async def fake_session():
            yield session

        with patch("services.habits_service.get_db_session", fake_session), patch.object(
            service,
            "get_habit_by_id",
            AsyncMock(return_value=SimpleNamespace(id="habit-1", name="Walk")),
        ):
            with self.assertRaises(HabitLogRevisionConflictError):
                await service.update_habit_log(
                    "habit-1",
                    "log-1",
                    HabitLogUpdate(
                        expected_revision=1,
                        idempotency_key="edit-key-123",
                        status="skipped",
                    ),
                    "user-1",
                )

        self.assertEqual(session.execute_count, 1)
        self.assertFalse(session.committed)

    async def test_repeated_idempotency_key_returns_existing_revision(self):
        service = HabitsService()
        session = _FakeSession(_log(revision=2, idempotency_key="edit-key-123"))

        @asynccontextmanager
        async def fake_session():
            yield session

        with patch("services.habits_service.get_db_session", fake_session), patch.object(
            service,
            "get_habit_by_id",
            AsyncMock(return_value=SimpleNamespace(id="habit-1", name="Walk")),
        ):
            result = await service.update_habit_log(
                "habit-1",
                "log-1",
                HabitLogUpdate(
                    expected_revision=1,
                    idempotency_key="edit-key-123",
                    status="skipped",
                ),
                "user-1",
            )

        self.assertEqual(result.revision, 2)
        self.assertEqual(session.execute_count, 1)
        self.assertFalse(session.committed)

    async def test_concurrent_duplicate_claim_returns_the_winning_write(self):
        service = HabitsService()
        session = _FakeSession(
            _log(),
            claim_count=0,
            concurrent_key="edit-key-123",
        )

        @asynccontextmanager
        async def fake_session():
            yield session

        with patch("services.habits_service.get_db_session", fake_session), patch.object(
            service,
            "get_habit_by_id",
            AsyncMock(return_value=SimpleNamespace(id="habit-1", name="Walk")),
        ):
            result = await service.update_habit_log(
                "habit-1",
                "log-1",
                HabitLogUpdate(
                    expected_revision=1,
                    idempotency_key="edit-key-123",
                    status="skipped",
                ),
                "user-1",
            )

        self.assertTrue(session.rolled_back)
        self.assertEqual(result.revision, 2)
        self.assertEqual(session.execute_count, 3)
        self.assertFalse(session.committed)


if __name__ == "__main__":
    unittest.main()
