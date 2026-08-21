from __future__ import annotations

import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from api.assistant_turns import create_assistant_turns_router  # noqa: E402
from schemas.assistant_turns import AssistantTurnRead  # noqa: E402


async def _current_user():
    return {"id": "user-1", "email": "user@example.com"}


def _turn(**overrides):
    payload = {
        "id": "turn-1",
        "user_id": "user-1",
        "conversation_id": "conv-1",
        "channel": "dashboard",
        "status": "running",
        "epoch": 1,
        "sequence": 1,
        "receipt_ids": [],
        "assistant_text": None,
        "tool_payload": None,
        "error": None,
        "created_at": None,
        "updated_at": None,
        "completed_at": None,
    }
    payload.update(overrides)
    return AssistantTurnRead(**payload)


class AssistantTurnsApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_assistant_turns_router(get_current_user=_current_user))
        self.client = TestClient(app)

    def test_get_missing_turn_is_404(self):
        with patch("api.assistant_turns.assistant_turn_service") as service:
            service.get_turn = AsyncMock(return_value=None)
            response = self.client.get("/api/assistant-turns/missing")
        self.assertEqual(response.status_code, 404)

    def test_upsert_conflict_is_409(self):
        with patch("api.assistant_turns.assistant_turn_service") as service:
            service.upsert_turn = AsyncMock(side_effect=ValueError("Illegal assistant turn transition completed -> queued"))
            response = self.client.post(
                "/api/assistant-turns",
                json={"id": "turn-1", "status": "queued", "channel": "dashboard"},
            )
        self.assertEqual(response.status_code, 409)

    def test_next_sequence(self):
        with patch("api.assistant_turns.assistant_turn_service") as service:
            service.next_sequence = AsyncMock(return_value=4)
            response = self.client.get("/api/assistant-turns/next-sequence?conversation_id=conv-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sequence"], 4)

    def test_get_turn(self):
        with patch("api.assistant_turns.assistant_turn_service") as service:
            service.get_turn = AsyncMock(return_value=_turn())
            response = self.client.get("/api/assistant-turns/turn-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "turn-1")


if __name__ == "__main__":
    unittest.main()
