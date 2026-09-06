from __future__ import annotations

import os
import pathlib
import sys
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DATABASE_URL", "sqlite:///test-entity-service.db")
os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from schemas.entities import EntityRef, RelatedEntity  # noqa: E402
from services.entity_service import FORBIDDEN_ENTITY, EntityService  # noqa: E402


@asynccontextmanager
async def fake_db_session():
    yield SimpleNamespace()


class EntityServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_maps_task_summary_and_route(self):
        service = EntityService()
        service._load = AsyncMock(
            return_value=SimpleNamespace(
                id="task-1",
                title="Buy milk",
                category="Personal",
                source="manual",
                status="open",
                updated_at=None,
            )
        )

        summary = await service.get_summary("user-1", "task", "task-1")

        self.assertEqual(summary.availability, "ok")
        self.assertEqual(summary.title, "Buy milk")
        self.assertEqual(summary.privacyClass, "task")
        self.assertEqual(summary.route, "/tasks?task=task-1")

    async def test_maps_calendar_event_and_calendar_alias(self):
        service = EntityService()
        service._load = AsyncMock(
            return_value=SimpleNamespace(
                id="event-1",
                title="Deep work",
                start_date="2026-08-17",
                start_at=None,
                status="confirmed",
                updated_at=None,
            )
        )

        summary = await service.get_summary("user-1", "calendar", "event-1")

        self.assertEqual(summary.availability, "ok")
        self.assertEqual(summary.ref.type, "calendar_event")
        self.assertEqual(summary.subtitle, "2026-08-17")
        self.assertEqual(summary.privacyClass, "calendar_event")
        self.assertEqual(summary.route, "/calendar?event=event-1")
        service._load.assert_awaited_with("user-1", "calendar_event", "event-1")

    async def test_missing_id_is_unknown(self):
        service = EntityService()
        service._load = AsyncMock(return_value=None)

        summary = await service.get_summary("user-1", "task", "missing")

        self.assertEqual(summary.availability, "unknown")
        self.assertEqual(summary.title, "Unknown")

    async def test_wrong_user_is_forbidden(self):
        service = EntityService()
        service._load = AsyncMock(return_value=FORBIDDEN_ENTITY)

        summary = await service.get_summary("user-1", "task", "task-1")

        self.assertEqual(summary.availability, "forbidden")
        self.assertEqual(summary.title, "Unavailable")

    async def test_task_fk_related_projects_routine(self):
        service = EntityService()

        async def load(_user_id, entity_type, entity_id):
            if entity_type == "task" and entity_id == "task-1":
                return SimpleNamespace(
                    id="task-1",
                    title="Buy milk",
                    category="Personal",
                    source="routine",
                    status="open",
                    updated_at=None,
                )
            if entity_type == "routine" and entity_id == "routine-1":
                return SimpleNamespace(
                    id="routine-1",
                    title="Morning",
                    kind="recurring_task",
                    status="scheduled",
                    updated_at=None,
                )
            return None

        async def load_many(_session, _user_id, entity_type, ids):
            loaded = {}
            for entity_id in ids:
                row = await load(_user_id, entity_type, entity_id)
                if row is not None:
                    loaded[(entity_type, entity_id)] = row
            return loaded

        service._load = AsyncMock(side_effect=load)
        service._load_many = AsyncMock(side_effect=load_many)
        service._derived_edges = AsyncMock(
            return_value=[
                RelatedEntity(
                    ref=EntityRef(type="routine", id="routine-1"),
                    relationship="generated_by",
                    source="fk",
                )
            ]
        )
        service._authored_edges = AsyncMock(return_value=[])
        with patch("services.entity_service.get_db_session", fake_db_session):
            items = await service.related("user-1", "task", "task-1")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].edge.relationship, "generated_by")
        self.assertEqual(items[0].edge.source, "fk")
        self.assertEqual(items[0].summary.title, "Morning")

    async def test_resolve_many_batches_by_type_instead_of_n_plus_one_loads(self):
        service = EntityService()
        service._load = AsyncMock(side_effect=AssertionError("_load should not run per ref"))

        async def load_many(_session, _user_id, entity_type, ids):
            loaded = {}
            for entity_id in ids:
                if entity_type == "task":
                    loaded[(entity_type, entity_id)] = SimpleNamespace(
                        id=entity_id,
                        title=f"Task {entity_id}",
                        category="Work",
                        source="manual",
                        status="open",
                        updated_at=None,
                    )
                elif entity_type == "habit":
                    loaded[(entity_type, entity_id)] = SimpleNamespace(
                        id=entity_id,
                        name=f"Habit {entity_id}",
                        category="Health",
                        icon=None,
                        updated_at=None,
                    )
            return loaded

        service._load_many = AsyncMock(side_effect=load_many)
        with patch("services.entity_service.get_db_session", fake_db_session):
            items = await service.resolve_many(
                "user-1",
                [
                    EntityRef(type="task", id="task-1"),
                    EntityRef(type="habit", id="habit-1"),
                    EntityRef(type="task", id="task-2"),
                    EntityRef(type="task", id="task-1"),
                ],
            )

        self.assertEqual([item.title for item in items], ["Task task-1", "Habit habit-1", "Task task-2"])
        self.assertEqual(service._load_many.await_count, 2)
        types_loaded = sorted(call.args[2] for call in service._load_many.await_args_list)
        self.assertEqual(types_loaded, ["habit", "task"])
        service._load.assert_not_called()

    async def test_evidence_relationship_requires_experiment(self):
        service = EntityService()
        with self.assertRaisesRegex(ValueError, "experiment"):
            await service.create_reference(
                "user-1",
                source=EntityRef(type="task", id="task-1"),
                target=EntityRef(type="habit", id="habit-1"),
                relationship="supports",
            )


if __name__ == "__main__":
    unittest.main()
