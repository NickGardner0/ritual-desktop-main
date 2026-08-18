from __future__ import annotations

import os
import pathlib
import sys
import unittest
from contextlib import asynccontextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DATABASE_URL", "sqlite:///test-entity-mentions.db")
os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from database.models.entities import EntityReferenceDB  # noqa: E402
from schemas.entities import (  # noqa: E402
    EntityRef,
    RelatedEntity,
    parse_date_mention_query,
    parse_entity_mention_tokens,
    virtual_date_summary,
)
from services.entity_service import EntityService  # noqa: E402


class _ScalarResult:
    def __init__(self, rows):
        self._rows = list(rows)

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _FakeSession:
    def __init__(self, rows):
        self.rows = list(rows)
        self.added = []

    async def execute(self, stmt):
        params = stmt.compile().params
        keys = " ".join(params)
        if "client_event_id" in keys and "source_type" not in keys:
            client_event_id = next(value for key, value in params.items() if "client_event_id" in key)
            matches = [row for row in self.rows if row.client_event_id == client_event_id]
            return _ScalarResult(matches)
        live = [
            row
            for row in self.rows
            if row.deleted_at is None and row.relationship == "mentions"
        ]
        source_id = next((value for key, value in params.items() if "source_id" in key), None)
        if source_id:
            live = [row for row in live if row.source_id == source_id]
        return _ScalarResult(live)

    def add(self, row):
        self.rows.append(row)
        self.added.append(row)

    async def commit(self):
        return None

    async def refresh(self, row):
        if not getattr(row, "created_at", None):
            row.created_at = None


class EntityMentionContractTests(unittest.TestCase):
    def test_parse_tokens_canonicalizes_aliases_and_dedupes(self):
        refs = parse_entity_mention_tokens("See [[report:a1]] and [[artifact:a1]] plus [[calendar:b1]]")
        self.assertEqual(
            [(item.type, item.id) for item in refs],
            [("artifact", "a1"), ("calendar_block", "b1")],
        )

    def test_relative_dates_use_sunday_week_and_canonical_ids(self):
        today = date(2026, 8, 17)
        self.assertEqual(parse_date_mention_query("today", today=today), ("day", "2026-08-17"))
        self.assertEqual(parse_date_mention_query("yesterday", today=today), ("day", "2026-08-16"))
        self.assertEqual(parse_date_mention_query("tomorrow", today=today), ("day", "2026-08-18"))
        self.assertEqual(
            parse_date_mention_query("this week", today=today),
            ("time_window", "2026-08-16/2026-08-22"),
        )
        self.assertEqual(
            parse_date_mention_query("last week", today=today),
            ("time_window", "2026-08-09/2026-08-15"),
        )
        self.assertEqual(
            parse_date_mention_query("last 7 days", today=today),
            ("time_window", "2026-08-11/2026-08-17"),
        )

    def test_virtual_day_summary_title(self):
        summary = virtual_date_summary("day", "2026-08-17")
        self.assertIsNotNone(summary)
        self.assertEqual(summary.ref.type, "day")
        self.assertEqual(summary.route, "/calendar?date=2026-08-17")
        self.assertEqual(summary.privacyClass, "habit_log")
        self.assertEqual(summary.availability, "ok")


class EntityMentionServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_day_summary_skips_row_load(self):
        service = EntityService()
        service._load = AsyncMock(return_value=None)

        summary = await service.get_summary("user-1", "day", "2026-08-17")

        self.assertEqual(summary.availability, "ok")
        self.assertEqual(summary.ref.type, "day")
        self.assertEqual(summary.ref.id, "2026-08-17")
        self.assertEqual(summary.route, "/calendar?date=2026-08-17")
        service._load.assert_not_called()

    async def test_invalid_day_is_unknown(self):
        service = EntityService()
        summary = await service.get_summary("user-1", "day", "not-a-date")
        self.assertEqual(summary.availability, "unknown")

    async def test_day_related_includes_logs_and_blocks(self):
        service = EntityService()
        service._derived_edges = AsyncMock(
            return_value=[
                RelatedEntity(ref=EntityRef(type="habit_log", id="log-1"), relationship="logged_on", source="fk"),
                RelatedEntity(ref=EntityRef(type="calendar_block", id="block-1"), relationship="scheduled_on", source="fk"),
            ]
        )
        service._authored_edges = AsyncMock(return_value=[])

        async def load(_user_id, entity_type, entity_id):
            if entity_type == "habit_log" and entity_id == "log-1":
                return (
                    SimpleNamespace(
                        id="log-1",
                        habit_name="Walk",
                        date="2026-08-17",
                        status="completed",
                        completed_at=None,
                    ),
                    SimpleNamespace(name="Walk"),
                )
            if entity_type == "calendar_block" and entity_id == "block-1":
                return SimpleNamespace(
                    id="block-1",
                    title="Deep work",
                    day="2026-08-17",
                    start_minutes=540,
                    end_minutes=600,
                    updated_at=None,
                )
            return None

        service._load = AsyncMock(side_effect=load)
        items = await service.related("user-1", "day", "2026-08-17")
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0].edge.relationship, "logged_on")
        self.assertEqual(items[1].summary.ref.type, "calendar_block")

    async def test_sync_mentions_creates_dedupes_and_preserves_picker_refs(self):
        picker = EntityReferenceDB(
            id="ref-picker",
            user_id="user-1",
            source_type="task",
            source_id="task-1",
            target_type="habit",
            target_id="habit-keep",
            relationship="references",
            provenance="user",
            client_event_id=None,
        )
        stale = EntityReferenceDB(
            id="ref-stale",
            user_id="user-1",
            source_type="task",
            source_id="task-1",
            target_type="habit",
            target_id="habit-old",
            relationship="mentions",
            provenance="user",
            client_event_id="mention:task:task-1:habit:habit-old",
        )
        keep = EntityReferenceDB(
            id="ref-keep",
            user_id="user-1",
            source_type="task",
            source_id="task-1",
            target_type="habit",
            target_id="habit-keep",
            relationship="mentions",
            provenance="user",
            client_event_id="mention:task:task-1:habit:habit-keep",
        )
        session = _FakeSession([picker, stale, keep])

        @asynccontextmanager
        async def fake_session():
            yield session

        service = EntityService()
        with patch("services.entity_service.get_db_session", fake_session):
            items = await service.sync_mentions(
                "user-1",
                source=EntityRef(type="task", id="task-1"),
                targets=[
                    EntityRef(type="habit", id="habit-keep"),
                    EntityRef(type="habit", id="habit-keep"),
                    EntityRef(type="day", id="2026-08-17"),
                ],
            )

        self.assertIsNotNone(stale.deleted_at)
        self.assertIsNone(picker.deleted_at)
        self.assertEqual(picker.relationship, "references")
        target_ids = {(item.target.type, item.target.id) for item in items}
        self.assertEqual(target_ids, {("habit", "habit-keep"), ("day", "2026-08-17")})
        self.assertEqual(len(session.added), 1)
        self.assertEqual(session.added[0].relationship, "mentions")
        self.assertEqual(session.added[0].client_event_id, "mention:task:task-1:day:2026-08-17")

    async def test_search_prepends_virtual_date(self):
        service = EntityService()
        service._search_type = AsyncMock(return_value=[])

        @asynccontextmanager
        async def fake_session():
            yield SimpleNamespace()

        with patch("services.entity_service.get_db_session", fake_session):
            items = await service.search("user-1", "today", types=["day", "task"], limit=8)

        self.assertGreaterEqual(len(items), 1)
        self.assertEqual(items[0].ref.type, "day")
        self.assertEqual(items[0].availability, "ok")


if __name__ == "__main__":
    unittest.main()
