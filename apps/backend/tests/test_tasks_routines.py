from __future__ import annotations

import os
import tempfile
import unittest
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
import sys
from unittest.mock import AsyncMock, patch

os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")
os.environ.setdefault("DATABASE_URL", "sqlite:///test-tasks-routines.db")

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.tasks import create_tasks_router
from api.workflows import create_workflows_router
from database.models import Base, HabitDB, RoutineDB, ScheduledBlockDB, TaskDB, UserDB
from schemas.tasks import RoutineCreate, TaskCreate, TaskUpdate
from services.recurrence import humanize_recurrence, next_run_at, next_run_preview
from services.tasks_service import TaskRoutineValidationError, tasks_service


class RecurrenceTests(unittest.TestCase):
    def test_daily_preview_is_deterministic(self):
        preview = next_run_preview(
            trigger_type="daily",
            trigger_config={"interval": 2, "hour": 9, "minute": 0},
            timezone_name="America/New_York",
            reference_utc=datetime(2026, 6, 29, 12, 0, 0),
            count=3,
        )

        self.assertEqual([item.isoformat() for item in preview], [
            "2026-06-29T13:00:00",
            "2026-07-01T13:00:00",
            "2026-07-03T13:00:00",
        ])

    def test_weekly_preview_supports_multiple_weekdays(self):
        preview = next_run_preview(
            trigger_type="weekly",
            trigger_config={"interval": 1, "weekdays": [0, 2], "hour": 9},
            timezone_name="America/New_York",
            reference_utc=datetime(2026, 6, 29, 14, 0, 0),
            count=3,
        )

        self.assertEqual([item.isoformat() for item in preview], [
            "2026-07-01T13:00:00",
            "2026-07-06T13:00:00",
            "2026-07-08T13:00:00",
        ])

    def test_monthly_nth_weekday_and_completion_recurrence(self):
        monthly = next_run_at(
            trigger_type="monthly",
            trigger_config={"interval": 1, "mode": "nth_weekday", "ordinal": 1, "weekday": 0, "hour": 9},
            timezone_name="America/New_York",
            reference_utc=datetime(2026, 6, 29, 12, 0, 0),
        )
        completion = next_run_at(
            trigger_type="on_completion",
            trigger_config={"interval": 3, "unit": "months"},
            timezone_name="America/New_York",
            reference_utc=datetime(2026, 6, 29, 12, 0, 0),
            last_completed_at=datetime(2026, 6, 1, 12, 0, 0),
        )

        self.assertEqual(monthly.isoformat(), "2026-07-06T13:00:00")
        self.assertEqual(completion.isoformat(), "2026-09-01T12:00:00")
        self.assertEqual(humanize_recurrence("on_completion", {"interval": 3, "unit": "months"}), "3 months after completion")


class TasksRoutinesServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "tasks-routines.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with self.Session() as session:
            session.add(UserDB(id="user-tasks", email="tasks@example.com", full_name="Tasks User"))
            session.add(UserDB(id="user-other", email="other@example.com", full_name="Other User"))
            await session.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()
        self._tmpdir.cleanup()

    @asynccontextmanager
    async def db_session(self):
        async with self.Session() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    async def test_task_create_update_and_reload(self):
        with patch("services.tasks_service.get_db_session", self.db_session):
            created = await tasks_service.create_task(
                "user-tasks",
                TaskCreate(
                    title="Review experiment notes",
                    category="Experiments",
                    scheduled_for=datetime(2026, 6, 29, 13, 0, 0),
                ),
            )
            completed = await tasks_service.update_task(
                "user-tasks",
                created.id,
                TaskUpdate(status="completed"),
            )
            completed_tasks = await tasks_service.list_tasks("user-tasks", view="completed")

        self.assertEqual(created.title, "Review experiment notes")
        self.assertEqual(completed.status, "completed")
        self.assertEqual(len(completed_tasks), 1)
        self.assertEqual(completed_tasks[0].id, created.id)

    async def test_task_create_rejects_foreign_routine_link(self):
        async with self.Session() as session:
            session.add(
                RoutineDB(
                    id="routine-other",
                    user_id="user-other",
                    title="Other routine",
                    status="scheduled",
                    kind="task",
                    trigger_type="daily",
                    trigger_config_json='{"interval":1}',
                    task_template_json='{"title":"Other task"}',
                )
            )
            await session.commit()

        with patch("services.tasks_service.get_db_session", self.db_session):
            with self.assertRaises(TaskRoutineValidationError):
                await tasks_service.create_task(
                    "user-tasks",
                    TaskCreate(title="Should not link", routine_id="routine-other"),
                )

    async def test_routine_create_is_idempotent_by_client_event_id(self):
        with patch("services.tasks_service.get_db_session", self.db_session):
            first = await tasks_service.create_routine(
                "user-tasks",
                RoutineCreate(title="Weekly review", client_event_id="routine-event-1"),
            )
            second = await tasks_service.create_routine(
                "user-tasks",
                RoutineCreate(title="Weekly review duplicate", client_event_id="routine-event-1"),
            )

        self.assertEqual(first.id, second.id)
        self.assertEqual(second.title, "Weekly review")
        self.assertEqual(second.client_event_id, "routine-event-1")

    async def test_due_routine_generation_is_idempotent(self):
        scheduled_for = datetime(2026, 6, 29, 13, 0, 0)
        async with self.Session() as session:
            session.add(
                RoutineDB(
                    id="routine-1",
                    user_id="user-tasks",
                    title="Daily check-in",
                    status="scheduled",
                    kind="task",
                    trigger_type="daily",
                    trigger_config_json='{"interval":1,"hour":9,"minute":0}',
                    task_template_json='{"title":"Daily check-in task","category":"Personal","tags":["daily"]}',
                    tags_json='["routine"]',
                    next_run_at=scheduled_for,
                )
            )
            await session.commit()

        with patch("services.tasks_service.get_db_session", self.db_session):
            first = await tasks_service.generate_due_routines(
                "user-tasks",
                reference_utc=scheduled_for + timedelta(minutes=30),
            )
            async with self.Session() as session:
                routine = await session.get(RoutineDB, "routine-1")
                routine.next_run_at = scheduled_for
                await session.commit()
            second = await tasks_service.generate_due_routines(
                "user-tasks",
                reference_utc=scheduled_for + timedelta(minutes=30),
            )
            tasks = await tasks_service.list_tasks("user-tasks", view=None)

        self.assertEqual(first.generated_tasks, 1)
        self.assertEqual(first.queued, 1)
        self.assertEqual(second.generated_tasks, 0)
        self.assertEqual(second.skipped, 1)
        self.assertEqual(len([task for task in tasks if task.routine_id == "routine-1"]), 1)

    async def test_missed_occurrences_catch_up_once_and_skip_older(self):
        # Daily 9:00 AM New York routine; the app was closed for six days.
        first_due = datetime(2026, 6, 24, 13, 0, 0)  # 9:00 EDT in UTC
        async with self.Session() as session:
            session.add(
                RoutineDB(
                    id="routine-catchup",
                    user_id="user-tasks",
                    title="Daily brief",
                    status="scheduled",
                    kind="task",
                    trigger_type="daily",
                    trigger_config_json='{"interval":1,"hour":9,"minute":0}',
                    task_template_json='{"title":"Daily brief task","category":"Personal","tags":[]}',
                    tags_json='[]',
                    timezone="America/New_York",
                    next_run_at=first_due,
                )
            )
            await session.commit()

        reference = datetime(2026, 6, 29, 14, 0, 0)
        with patch("services.tasks_service.get_db_session", self.db_session):
            result = await tasks_service.generate_due_routines(
                "user-tasks",
                reference_utc=reference,
            )
            runs = await tasks_service.list_routine_runs("user-tasks", routine_id="routine-catchup", limit=20)

        # Six occurrences were missed (6/24-6/29); only the latest runs.
        self.assertEqual(result.queued, 1)
        self.assertEqual(result.generated_tasks, 1)
        self.assertEqual(result.skipped, 5)
        statuses = sorted(run.status for run in runs)
        self.assertEqual(statuses.count("skipped"), 5)
        self.assertEqual(statuses.count("generated"), 1)
        generated_run = next(run for run in runs if run.status == "generated")
        self.assertEqual(generated_run.scheduled_for, datetime(2026, 6, 29, 13, 0, 0))

        async with self.Session() as session:
            routine = await session.get(RoutineDB, "routine-catchup")
            self.assertEqual(routine.next_run_at, datetime(2026, 6, 30, 13, 0, 0))

    async def test_on_completion_routine_waits_for_generated_task_completion(self):
        scheduled_for = datetime(2026, 6, 29, 13, 0, 0)
        async with self.Session() as session:
            session.add(
                RoutineDB(
                    id="routine-completion",
                    user_id="user-tasks",
                    title="Water plants",
                    status="scheduled",
                    kind="task",
                    trigger_type="on_completion",
                    trigger_config_json='{"interval":2,"unit":"days"}',
                    task_template_json='{"title":"Water plants"}',
                    next_run_at=scheduled_for,
                )
            )
            await session.commit()

        with patch("services.tasks_service.get_db_session", self.db_session):
            generated = await tasks_service.generate_due_routines(
                "user-tasks",
                reference_utc=scheduled_for + timedelta(minutes=30),
            )
            task_id = generated.runs[0].generated_task_id
            self.assertIsNotNone(task_id)
            completed = await tasks_service.update_task(
                "user-tasks",
                task_id or "",
                TaskUpdate(status="completed", completed_at=scheduled_for + timedelta(hours=1)),
            )

        async with self.Session() as session:
            routine = await session.get(RoutineDB, "routine-completion")
            task = await session.get(TaskDB, task_id)

        self.assertEqual(completed.status, "completed")
        self.assertEqual(task.status, "completed")
        self.assertEqual(routine.next_run_at, scheduled_for + timedelta(days=2, hours=1))


class TasksRoutinesApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "tasks-routines-api.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with self.Session() as session:
            session.add(UserDB(id="user-api", email="api@example.com", full_name="API User"))
            session.add(HabitDB(id="habit-api", user_id="user-api", name="Recovery", category="Health"))
            await session.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()
        self._tmpdir.cleanup()

    @asynccontextmanager
    async def db_session(self):
        async with self.Session() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    def build_app(self) -> FastAPI:
        async def current_user():
            return {"id": "user-api", "email": "api@example.com", "timezone": "America/New_York"}

        app = FastAPI()
        app.include_router(create_tasks_router(get_current_user=current_user))
        app.include_router(create_workflows_router(get_current_user=current_user))
        return app

    async def api_client(self):
        transport = httpx.ASGITransport(app=self.build_app())
        return httpx.AsyncClient(transport=transport, base_url="http://testserver")

    async def test_task_api_crud_reschedule_skip_archive_reload(self):
        with patch("services.tasks_service.get_db_session", self.db_session):
            async with await self.api_client() as client:
                created_response = await client.post(
                    "/api/tasks",
                    json={
                        "title": "API task",
                        "category": "Work",
                        "scheduled_for": "2026-06-29T13:00:00",
                    },
                )
                self.assertEqual(created_response.status_code, 200)
                task_id = created_response.json()["id"]

                completed_response = await client.patch(f"/api/tasks/{task_id}", json={"status": "completed"})
                self.assertEqual(completed_response.status_code, 200)
                self.assertEqual(completed_response.json()["status"], "completed")

                rescheduled_response = await client.patch(
                    f"/api/tasks/{task_id}",
                    json={
                        "status": "open",
                        "scheduled_for": "2026-07-01T14:00:00",
                        "due_at": "2026-07-01T14:00:00",
                    },
                )
                self.assertEqual(rescheduled_response.status_code, 200)
                self.assertEqual(rescheduled_response.json()["status"], "open")

                skipped_response = await client.patch(f"/api/tasks/{task_id}", json={"status": "skipped"})
                self.assertEqual(skipped_response.status_code, 200)

                skipped_list = await client.get("/api/tasks?view=skipped")
                self.assertEqual(skipped_list.status_code, 200)
                self.assertEqual([item["id"] for item in skipped_list.json()["items"]], [task_id])

                archived_response = await client.patch(f"/api/tasks/{task_id}", json={"status": "archived"})
                self.assertEqual(archived_response.status_code, 200)

                archived_list = await client.get("/api/tasks?view=archived")
                self.assertEqual(archived_list.status_code, 200)
                self.assertEqual([item["id"] for item in archived_list.json()["items"]], [task_id])

    async def test_routine_api_generation_paused_noop_and_workflow_definition_create(self):
        with patch("services.tasks_service.get_db_session", self.db_session), patch(
            "services.workflow_service.get_db_session", self.db_session
        ), patch("services.workflow_service.workflow_service._index_definition", AsyncMock()):
            async with await self.api_client() as client:
                workflow_response = await client.post(
                    "/api/workflows/definitions",
                    json={
                        "kind": "shutdown_review",
                        "name": "Weekly Review",
                        "status": "scheduled",
                        "schedule": {
                            "timezone": "America/New_York",
                            "cadence": "weekly",
                            "send_hour_local": 16,
                            "send_minute_local": 0,
                            "send_weekdays": [4],
                        },
                        "config": {"ai_routine_template_key": "weekly_review"},
                    },
                )
                self.assertEqual(workflow_response.status_code, 200)
                workflow_id = workflow_response.json()["id"]

                routine_response = await client.post(
                    "/api/routines",
                    json={
                        "title": "API daily routine",
                        "status": "scheduled",
                        "kind": "mixed",
                        "trigger_type": "daily",
                        "trigger_config": {"interval": 1, "hour": 9, "minute": 0},
                        "task_template": {
                            "title": "Generated API task",
                            "category": "AI",
                            "tags": ["api"],
                            "linked_habit_id": "habit-api",
                        },
                        "ai_workflow_definition_id": workflow_id,
                    },
                )
                self.assertEqual(routine_response.status_code, 200)
                routine = routine_response.json()["items"][0]

                async with self.Session() as session:
                    row = await session.get(RoutineDB, routine["id"])
                    row.next_run_at = datetime(2026, 6, 29, 13, 0, 0)
                    await session.commit()

                generated = await client.post("/api/routines/generate-due?reference_utc=2026-06-29T13:30:00")
                self.assertEqual(generated.status_code, 200)
                self.assertEqual(generated.json()["generated_tasks"], 1)
                self.assertEqual(generated.json()["generated_scheduled_blocks"], 1)
                self.assertEqual(generated.json()["generated_workflow_runs"], 1)
                generated_run = generated.json()["runs"][0]
                self.assertIsNotNone(generated_run["generated_task_id"])
                self.assertIsNotNone(generated_run["generated_scheduled_block_id"])

                second = await client.post("/api/routines/generate-due?reference_utc=2026-06-29T13:30:00")
                self.assertEqual(second.status_code, 200)
                self.assertEqual(second.json()["generated_tasks"], 0)
                self.assertEqual(second.json()["generated_scheduled_blocks"], 0)

                async with self.Session() as session:
                    task = await session.get(TaskDB, generated_run["generated_task_id"])
                    block = await session.get(ScheduledBlockDB, generated_run["generated_scheduled_block_id"])
                    self.assertEqual(task.linked_habit_id, "habit-api")
                    self.assertEqual(block.day, "2026-06-29")
                    self.assertEqual(block.start_minutes, 540)
                    self.assertEqual(block.end_minutes, 600)

                paused_response = await client.post(
                    "/api/routines",
                    json={
                        "title": "Paused routine",
                        "status": "paused",
                        "kind": "task",
                        "trigger_type": "daily",
                        "trigger_config": {"interval": 1, "hour": 9, "minute": 0},
                        "task_template": {"title": "Should not generate"},
                    },
                )
                self.assertEqual(paused_response.status_code, 200)
                paused = paused_response.json()["items"][0]
                async with self.Session() as session:
                    row = await session.get(RoutineDB, paused["id"])
                    self.assertIsNone(row.next_run_at)


if __name__ == "__main__":
    unittest.main()
