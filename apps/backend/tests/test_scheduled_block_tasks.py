from __future__ import annotations

import os
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
import sys
from unittest.mock import patch
from datetime import datetime

os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")
os.environ.setdefault("DATABASE_URL", "sqlite:///test-scheduled-block-tasks.db")

import httpx
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.core import create_core_router
from api.tasks import create_tasks_router
from database.models import Base, ScheduledBlockDB, TaskDB, UserDB


class _Limiter:
    def limit(self, _value):
        return lambda function: function


class ScheduledBlockTaskLinkTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "scheduled-block-tasks.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with self.Session() as session:
            session.add(UserDB(id="user-cal", email="cal@example.com", full_name="Cal User"))
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
            return {"id": "user-cal", "email": "cal@example.com", "timezone": "America/New_York"}

        app = FastAPI()
        app.include_router(
            create_core_router(
                limiter=_Limiter(),
                get_current_user=current_user,
                user_service=object(),
                habits_service=object(),
                tinybird_service=object(),
            )
        )
        app.include_router(create_tasks_router(get_current_user=current_user))
        return app

    async def api_client(self):
        transport = httpx.ASGITransport(app=self.build_app())
        return httpx.AsyncClient(transport=transport, base_url="http://testserver")

    async def test_create_returns_task_id_and_is_idempotent(self):
        with patch("api.core.get_db_session", self.db_session), patch(
            "services.tasks_service.get_db_session", self.db_session
        ):
            async with await self.api_client() as client:
                payload = {
                    "title": "Deep work",
                    "notes": "Ship the task model",
                    "day": "2026-08-18",
                    "start_minutes": 9 * 60,
                    "end_minutes": 10 * 60,
                    "client_event_id": "cal-event-1",
                }
                first = await client.post("/api/calendar/scheduled-blocks", json=payload)
                self.assertEqual(first.status_code, 200, first.text)
                body = first.json()
                self.assertTrue(body["task_id"])
                self.assertEqual(body["task_status"], "open")

                second = await client.post("/api/calendar/scheduled-blocks", json=payload)
                self.assertEqual(second.status_code, 200, second.text)
                self.assertEqual(second.json()["id"], body["id"])
                self.assertEqual(second.json()["task_id"], body["task_id"])

                listed = await client.get("/api/calendar/scheduled-blocks")
                self.assertEqual(len(listed.json()), 1)

                async with self.Session() as session:
                    task = await session.get(TaskDB, body["task_id"])
                    self.assertEqual(task.source, "calendar")
                    self.assertEqual(task.title, "Deep work")
                    self.assertEqual(task.client_event_id, "cal-event-1")

    async def test_unlinked_legacy_block_get_and_put_attaches_task(self):
        async with self.Session() as session:
            session.add(
                ScheduledBlockDB(
                    id="legacy-block",
                    user_id="user-cal",
                    title="Old block",
                    notes="pre-link",
                    day="2026-08-18",
                    start_minutes=600,
                    end_minutes=660,
                    created_at=datetime(2026, 8, 18, 12, 0, 0),
                    updated_at=datetime(2026, 8, 18, 12, 0, 0),
                )
            )
            await session.commit()

        with patch("api.core.get_db_session", self.db_session), patch(
            "services.tasks_service.get_db_session", self.db_session
        ):
            async with await self.api_client() as client:
                fetched = await client.get("/api/calendar/scheduled-blocks")
                self.assertEqual(fetched.status_code, 200, fetched.text)
                row = fetched.json()[0]
                self.assertEqual(row["id"], "legacy-block")
                self.assertIsNone(row["task_id"])

                updated = await client.put(
                    "/api/calendar/scheduled-blocks/legacy-block",
                    json={"title": "Old block now a task"},
                )
                self.assertEqual(updated.status_code, 200, updated.text)
                self.assertTrue(updated.json()["task_id"])
                self.assertEqual(updated.json()["title"], "Old block now a task")

                patched = await client.patch(
                    f"/api/tasks/{updated.json()['task_id']}",
                    json={"title": "Synced from task"},
                )
                self.assertEqual(patched.status_code, 200, patched.text)

                again = await client.get("/api/calendar/scheduled-blocks")
                self.assertEqual(again.json()[0]["title"], "Synced from task")


if __name__ == "__main__":
    unittest.main()
