"""Idempotency, provenance, and action receipt tests for habit mutations."""

from __future__ import annotations

import pathlib
import sys
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from models.habit_models import HabitCreate, HabitLogCreate  # noqa: E402
from services.habits_service import HabitsService  # noqa: E402


class _ScalarOne:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, *, execute_results=None):
        self.added = []
        self.flushed = False
        self.committed = False
        self._execute_results = list(execute_results or [])
        self._refresh_target = None

    async def execute(self, _query):
        if self._execute_results:
            return self._execute_results.pop(0)
        return _ScalarOne(None)

    def add(self, row):
        self.added.append(row)
        if getattr(row, "id", None) is None:
            row.id = "generated-id"

    async def flush(self):
        self.flushed = True
        for row in self.added:
            if getattr(row, "id", None) is None:
                row.id = "generated-id"

    async def commit(self):
        self.committed = True

    async def refresh(self, row):
        self._refresh_target = row

    async def rollback(self):
        pass


class HabitLogIdempotencyTests(unittest.IsolatedAsyncioTestCase):
    async def test_log_habit_duplicate_client_event_skips_fanout(self):
        service = HabitsService()
        service.tinybird_enabled = False
        existing = SimpleNamespace(
            id="log-1",
            habit_id="habit-1",
            habit_name="Walk",
            duration=None,
            amount=1.0,
            date="2026-07-29",
            completed_at=None,
            status="completed",
            notes=None,
            source="ai_chat",
            client_event_id="evt-1",
            actor_type="assistant",
            actor_ref="conv-1",
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
        session = _FakeSession(
            execute_results=[
                _ScalarOne(existing),
                _ScalarOne(SimpleNamespace(id="receipt-1")),
            ]
        )

        @asynccontextmanager
        async def fake_session():
            yield session

        fire = MagicMock()
        with patch("services.habits_service.get_db_session", fake_session), patch.object(
            service, "get_habit_by_id", AsyncMock(return_value=SimpleNamespace(id="habit-1", name="Walk", category="fitness", unit_type="count"))
        ), patch.object(service, "_fire_habit_log_side_effects", fire), patch.object(
            service, "_refresh_metric_facts_for_logs", AsyncMock(return_value={})
        ):
            result = await service.log_habit(
                "habit-1",
                HabitLogCreate(
                    date="2026-07-29",
                    amount=1.0,
                    client_event_id="evt-1",
                    source="ai_chat",
                    actor_type="assistant",
                    conversation_id="conv-1",
                ),
                "user-1",
            )

        self.assertEqual(result.id, "log-1")
        self.assertFalse(result.was_inserted)
        self.assertEqual(result.receipt_id, "receipt-1")
        fire.assert_not_called()

    async def test_log_habit_persists_provenance_and_receipt(self):
        service = HabitsService()
        service.tinybird_enabled = False
        habit = SimpleNamespace(
            id="habit-1",
            name="Walk",
            category="fitness",
            unit_type="count",
            integration_source=None,
            metric_type=None,
        )
        session = _FakeSession(execute_results=[_ScalarOne(None)])

        @asynccontextmanager
        async def fake_session():
            yield session

        create_receipt = AsyncMock(
            return_value=SimpleNamespace(id="receipt-new")
        )
        with patch("services.habits_service.get_db_session", fake_session), patch.object(
            service, "get_habit_by_id", AsyncMock(return_value=habit)
        ), patch(
            "services.habits_service.action_receipt_service.create_receipt",
            create_receipt,
        ), patch.object(
            service, "_fire_habit_log_side_effects", MagicMock()
        ), patch.object(
            service, "_refresh_metric_facts_for_logs", AsyncMock(return_value={})
        ), patch(
            "services.location.enrichment.enrich_habit_log",
            AsyncMock(),
        ):
            result = await service.log_habit(
                "habit-1",
                HabitLogCreate(
                    date="2026-07-29",
                    amount=2.0,
                    client_event_id="evt-new",
                    source="ai_chat",
                    actor_type="assistant",
                    conversation_id="conv-9",
                ),
                "user-1",
            )

        self.assertTrue(result.was_inserted)
        self.assertEqual(result.receipt_id, "receipt-new")
        self.assertEqual(result.actor_type, "assistant")
        self.assertEqual(result.source, "ai_chat")
        self.assertEqual(result.client_event_id, "evt-new")
        create_receipt.assert_awaited()
        self.assertTrue(session.committed)
        undo = create_receipt.await_args.kwargs["undo"]
        self.assertEqual(undo["op"], "delete_habit_log")

    async def test_create_habit_idempotent_via_receipt(self):
        service = HabitsService()
        service.tinybird_enabled = False
        existing_habit = SimpleNamespace(
            id="habit-existing",
            user_id="user-1",
            name="Meditation",
            category="mindfulness",
            icon=None,
            is_custom=True,
            integration_source=None,
            unit_type=None,
            sensor_type="Manual",
            metric_type=None,
            created_at="2026-07-29T00:00:00",
            updated_at="2026-07-29T00:00:00",
        )
        receipt = SimpleNamespace(
            id="receipt-h",
            after_json='{"id":"habit-existing"}',
        )
        session = _FakeSession(
            execute_results=[
                _ScalarOne(receipt),
                _ScalarOne(existing_habit),
            ]
        )

        @asynccontextmanager
        async def fake_session():
            yield session

        fire = MagicMock()
        with patch("services.habits_service.get_db_session", fake_session), patch.object(
            service, "_fire_habit_definition_side_effects", fire
        ):
            result = await service.create_habit(
                HabitCreate(
                    name="Meditation",
                    category="mindfulness",
                    client_event_id="evt-habit",
                    actor_type="assistant",
                    conversation_id="conv-1",
                ),
                "user-1",
            )

        self.assertEqual(result.id, "habit-existing")
        self.assertFalse(result.was_inserted)
        self.assertEqual(result.receipt_id, "receipt-h")
        fire.assert_not_called()


if __name__ == "__main__":
    unittest.main()
