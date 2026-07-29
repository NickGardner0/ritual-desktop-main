"""Tests for action receipt undo semantics."""

from __future__ import annotations

import pathlib
import sys
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.action_receipt_service import ActionReceiptService  # noqa: E402


class _ScalarOne:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeSession:
    def __init__(self, row, log_row=None):
        self.row = row
        self.log_row = log_row
        self.deleted = []
        self.committed = False
        self._calls = 0

    async def execute(self, _query):
        # After undo, subsequent receipt lookups should keep returning the receipt.
        if getattr(self.row, "status", None) == "undone":
            return _ScalarOne(self.row)
        self._calls += 1
        if self._calls == 1:
            return _ScalarOne(self.row)
        return _ScalarOne(self.log_row)

    def delete(self, row):
        self.deleted.append(row)

    async def commit(self):
        self.committed = True

    async def refresh(self, row):
        pass


class ActionReceiptServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_undo_deletes_habit_log_once(self):
        service = ActionReceiptService()
        receipt = SimpleNamespace(
            id="r1",
            user_id="u1",
            workflow_run_id=None,
            conversation_id="c1",
            client_event_id="e1",
            action_kind="logHabit",
            capability="habits.write",
            target_ref="log-1",
            status="applied",
            before_json=None,
            after_json='{"id":"log-1"}',
            undo_json='{"op":"delete_habit_log","habit_id":"h1","log_id":"log-1"}',
            metadata_json="{}",
            created_at=None,
        )
        log_row = SimpleNamespace(id="log-1")
        session = _FakeSession(receipt, log_row=log_row)

        @asynccontextmanager
        async def fake_session():
            yield session

        with patch("services.action_receipt_service.get_db_session", fake_session):
            # Typesense delete is best-effort and may fail to import in unit tests.
            first = await service.undo_receipt("u1", "r1")
            self.assertTrue(first.undone)
            self.assertFalse(first.noop)
            self.assertEqual(receipt.status, "undone")
            self.assertEqual(session.deleted, [log_row])

            second = await service.undo_receipt("u1", "r1")
            self.assertTrue(second.noop)


if __name__ == "__main__":
    unittest.main()
