from __future__ import annotations

import os
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ.setdefault("DATABASE_URL", "sqlite:///test-entity-service.db")
os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from schemas.entities import EntityRef, RelatedEntity  # noqa: E402
from services.entity_service import FORBIDDEN_ENTITY, EntityService  # noqa: E402


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

    async def test_maps_calendar_block_and_report_aliases(self):
        service = EntityService()
        service._load = AsyncMock(
            return_value=SimpleNamespace(
                id="block-1",
                title="Deep work",
                day="2026-08-17",
                start_minutes=540,
                end_minutes=600,
                updated_at=None,
            )
        )

        summary = await service.get_summary("user-1", "calendar", "block-1")

        self.assertEqual(summary.availability, "ok")
        self.assertEqual(summary.ref.type, "calendar_block")
        self.assertEqual(summary.subtitle, "2026-08-17 · 09:00–10:00")
        self.assertEqual(summary.privacyClass, "task")
        self.assertEqual(summary.route, "/calendar?block=block-1")
        service._load.assert_awaited_with("user-1", "calendar_block", "block-1")

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

        service._load = AsyncMock(side_effect=load)
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

        items = await service.related("user-1", "task", "task-1")

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].edge.relationship, "generated_by")
        self.assertEqual(items[0].edge.source, "fk")
        self.assertEqual(items[0].summary.title, "Morning")

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
