"""Focused unit tests for wearable event outbox helpers."""

from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.wearable_event_outbox_service import WearableEventOutboxService


class WearableEventOutboxServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = WearableEventOutboxService()

    def test_dedupe_key_is_stable_for_same_record(self):
        left = self.service._dedupe_key(
            user_id="user-1",
            provider="whoop",
            event_type="sleep_session_ingested",
            related_record_kind="event",
            related_record_id="event-1",
        )
        right = self.service._dedupe_key(
            user_id="user-1",
            provider="whoop",
            event_type="sleep_session_ingested",
            related_record_kind="event",
            related_record_id="event-1",
        )

        self.assertEqual(left, right)

    def test_dispatch_sleep_session_event_records_success(self):
        event = SimpleNamespace(
            id="outbox-1",
            user_id="user-1",
            provider="whoop",
            related_record_id="event-1",
            event_type="sleep_session_ingested",
            payload_json='{"duration_minutes":420}',
        )

        result = self._run(self.service._dispatch_event(event))

        self.assertEqual(result["disposition"], "recorded")

    def _run(self, coro):
        import asyncio

        return asyncio.run(coro)


if __name__ == "__main__":
    unittest.main()
