from __future__ import annotations

import json
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
import sys

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.models import Base, ImportRunDB
from models.import_models import ImportRunSummary, ImportStatus
from services import import_service as import_service_module
from services.import_service import ImportRunTransitionConflict, ImportService


class ImportRunTransitionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "import-transitions.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        @asynccontextmanager
        async def test_session():
            async with self.Session() as session:
                yield session

        self._original_get_db_session = import_service_module.get_db_session
        import_service_module.get_db_session = test_session
        self.service = ImportService()

    async def asyncTearDown(self):
        import_service_module.get_db_session = self._original_get_db_session
        await self.engine.dispose()
        self._tmpdir.cleanup()

    async def _insert_run(self, status: ImportStatus) -> None:
        async with self.Session() as session:
            session.add(
                ImportRunDB(
                    id="run-1",
                    user_id="user-1",
                    source="csv",
                    status=status.value,
                    summary_json=json.dumps(ImportRunSummary().model_dump()),
                    error_json=json.dumps([{"error": "stale"}]),
                )
            )
            await session.commit()

    async def test_only_one_ready_to_importing_claim_wins(self):
        await self._insert_run(ImportStatus.READY)

        claimed = await self.service.transition_import_run(
            "run-1",
            expected_statuses={ImportStatus.READY},
            status=ImportStatus.IMPORTING,
        )
        self.assertEqual(claimed.status, ImportStatus.IMPORTING)
        self.assertIsNotNone(claimed.started_at)

        with self.assertRaises(ImportRunTransitionConflict) as raised:
            await self.service.transition_import_run(
                "run-1",
                expected_statuses={ImportStatus.READY},
                status=ImportStatus.IMPORTING,
            )
        self.assertEqual(raised.exception.current_status, ImportStatus.IMPORTING.value)

    async def test_terminal_transition_owns_progress_result_and_error_clearing(self):
        await self._insert_run(ImportStatus.IMPORTING)
        summary = ImportRunSummary(total_rows=3, imported=3)

        completed = await self.service.transition_import_run(
            "run-1",
            expected_statuses={ImportStatus.IMPORTING},
            status=ImportStatus.COMPLETED,
            summary=summary,
            progress_current=3,
            progress_total=3,
        )

        self.assertEqual(completed.status, ImportStatus.COMPLETED)
        self.assertEqual(completed.progress_current, 3)
        self.assertEqual(completed.progress_total, 3)
        self.assertEqual(completed.summary.imported, 3)
        self.assertIsNone(completed.errors)
        self.assertIsNotNone(completed.completed_at)
        self.assertTrue(completed.undo_available)

    async def test_late_progress_cannot_overwrite_cancellation(self):
        await self._insert_run(ImportStatus.IMPORTING)
        await self.service.transition_import_run(
            "run-1",
            expected_statuses={ImportStatus.IMPORTING},
            status=ImportStatus.CANCELED,
        )

        with self.assertRaises(ImportRunTransitionConflict):
            await self.service.update_import_progress("run-1", 1, 10)
