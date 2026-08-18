from __future__ import annotations

import os
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite:///test-entities-api.db")
os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.entities import create_entities_router  # noqa: E402
from schemas.entities import EntityRef, EntitySummary  # noqa: E402


async def _current_user():
    return {"id": "user-1", "email": "user@example.com"}


def _summary(entity_type: str, entity_id: str, title: str) -> EntitySummary:
    return EntitySummary(
        ref=EntityRef(type=entity_type, id=entity_id),
        title=title,
        route=f"/{entity_type}?id={entity_id}",
        privacyClass="task" if entity_type == "task" else "habit_definition",
        availability="ok",
    )


class EntitiesApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_entities_router(get_current_user=_current_user))
        self.client = TestClient(app)

    def test_batch_resolve(self):
        items = [_summary("task", "task-1", "Buy milk")]
        with patch("api.entities.entity_service") as service:
            service.resolve_many = AsyncMock(return_value=items)
            response = self.client.post(
                "/api/entities/resolve",
                json={"refs": [{"type": "task", "id": "task-1"}]},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["items"][0]["title"], "Buy milk")

    def test_privacy_header_marks_sensitive_search_blocked(self):
        with patch("api.entities.entity_service") as service:
            service.search = AsyncMock(return_value=[])
            response = self.client.get(
                "/api/entities/search?q=walk&types=habit",
                headers={"x-ritual-privacy-mode": "local_only"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["privacy_blocked"])
        service.search.assert_awaited()

    def test_unknown_type_is_rejected(self):
        response = self.client.get("/api/entities/widget/block-1")
        self.assertEqual(response.status_code, 422)

    def test_calendar_alias_canonicalizes(self):
        with patch("api.entities.entity_service") as service:
            service.get_summary = AsyncMock(return_value=_summary("calendar_block", "block-1", "Deep work"))
            response = self.client.get("/api/entities/calendar/block-1")

        self.assertEqual(response.status_code, 200)
        service.get_summary.assert_awaited_with("user-1", "calendar_block", "block-1")

    def test_report_alias_canonicalizes(self):
        with patch("api.entities.entity_service") as service:
            service.get_summary = AsyncMock(return_value=_summary("artifact", "a1", "Morning brief"))
            response = self.client.get("/api/entities/report/a1")

        self.assertEqual(response.status_code, 200)
        service.get_summary.assert_awaited_with("user-1", "artifact", "a1")

    def test_search_aliases_are_canonicalized(self):
        with patch("api.entities.entity_service") as service:
            service.search = AsyncMock(return_value=[])
            response = self.client.get("/api/entities/search?q=walk&types=report,calendar")

        self.assertEqual(response.status_code, 200)
        service.search.assert_awaited_with(
            "user-1",
            "walk",
            types=["artifact", "calendar_block"],
            limit=20,
        )

    def test_entity_ref_aliases_are_canonical(self):
        self.assertEqual(EntityRef(type="report", id="a1").type, "artifact")
        self.assertEqual(EntityRef(type="calendar", id="b1").type, "calendar_block")

    def test_day_summary_route(self):
        with patch("api.entities.entity_service") as service:
            service.get_summary = AsyncMock(return_value=_summary("day", "2026-08-17", "Aug 17, 2026"))
            response = self.client.get("/api/entities/day/2026-08-17")

        self.assertEqual(response.status_code, 200)
        service.get_summary.assert_awaited_with("user-1", "day", "2026-08-17")

    def test_time_window_summary_uses_query_lookup(self):
        with patch("api.entities.entity_service") as service:
            service.get_summary = AsyncMock(
                return_value=_summary("time_window", "2026-08-11/2026-08-17", "Aug range")
            )
            response = self.client.get(
                "/api/entities/summary",
                params={"entity_type": "time_window", "entity_id": "2026-08-11/2026-08-17"},
            )

        self.assertEqual(response.status_code, 200)
        service.get_summary.assert_awaited_with("user-1", "time_window", "2026-08-11/2026-08-17")

    def test_sync_mentions_endpoint(self):
        with patch("api.entities.entity_service") as service:
            service.sync_mentions = AsyncMock(return_value=[])
            response = self.client.post(
                "/api/entities/references/sync",
                json={
                    "source": {"type": "task", "id": "task-1"},
                    "targets": [{"type": "habit", "id": "habit-1"}, {"type": "report", "id": "a1"}],
                    "provenance": "user",
                },
            )

        self.assertEqual(response.status_code, 200)
        kwargs = service.sync_mentions.await_args.kwargs
        self.assertEqual(kwargs["source"].type, "task")
        self.assertEqual([(item.type, item.id) for item in kwargs["targets"]], [("habit", "habit-1"), ("artifact", "a1")])


if __name__ == "__main__":
    unittest.main()
