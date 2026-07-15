"""Focused persistence tests for experiment workspaces."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("DATABASE_URL", "sqlite:///test-experiments.db")

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database.models import (
    AIConversationDB,
    AIMessageDB,
    Base,
    ExperimentDB,
    ExperimentEntryDB,
    UserDB,
)
from schemas.experiments import ExperimentCreate, ExperimentEntryCreate, ExperimentThreadCreate
from services.experiment_service import ExperimentNotFoundError, experiment_service


class ExperimentServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "experiments.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(
                lambda sync_connection: Base.metadata.create_all(
                    sync_connection,
                    tables=[
                        UserDB.__table__,
                        ExperimentDB.__table__,
                        ExperimentEntryDB.__table__,
                        AIConversationDB.__table__,
                        AIMessageDB.__table__,
                    ],
                )
            )
        async with self.Session() as session:
            session.add_all(
                [
                    UserDB(id="user-one", email="one@example.com", full_name="One"),
                    UserDB(id="user-two", email="two@example.com", full_name="Two"),
                ]
            )
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

    async def test_workspace_owns_threads_and_typed_entries(self):
        with patch("services.experiment_service.get_db_session", self.db_session):
            experiment = await experiment_service.create_experiment(
                "user-one",
                ExperimentCreate(title="Caffeine timing", description="Test afternoon cutoff."),
            )
            thread = await experiment_service.create_thread(
                "user-one",
                experiment.id,
                ExperimentThreadCreate(title="Baseline week"),
            )
            observation = await experiment_service.create_entry(
                "user-one",
                experiment.id,
                ExperimentEntryCreate(
                    kind="observation",
                    title="Day one",
                    content="Energy held steady after 3 PM.",
                    metadata={"day": 1},
                ),
            )
            detail = await experiment_service.get_experiment("user-one", experiment.id)
            recent = await experiment_service.list_experiments("user-one")

        self.assertEqual(detail.thread_count, 1)
        self.assertEqual(detail.entry_count, 1)
        self.assertEqual(detail.threads[0].id, thread.id)
        self.assertEqual(detail.entries[0].id, observation.id)
        self.assertEqual(detail.entries[0].metadata, {"day": 1})
        self.assertEqual([item.id for item in recent], [experiment.id])

    async def test_workspace_access_is_user_scoped(self):
        with patch("services.experiment_service.get_db_session", self.db_session):
            experiment = await experiment_service.create_experiment(
                "user-one",
                ExperimentCreate(title="Private experiment"),
            )
            with self.assertRaises(ExperimentNotFoundError):
                await experiment_service.get_experiment("user-two", experiment.id)
            with self.assertRaises(ExperimentNotFoundError):
                await experiment_service.create_thread(
                    "user-two",
                    experiment.id,
                    ExperimentThreadCreate(),
                )


if __name__ == "__main__":
    unittest.main()
