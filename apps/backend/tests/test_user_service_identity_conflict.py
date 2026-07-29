from __future__ import annotations

import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
import sys

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.models import Base, UserDB
from services import user_service as user_service_module
from services.user_service import AccountIdentityConflictError, UserService


class UserServiceIdentityConflictTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "identity-conflict.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        @asynccontextmanager
        async def test_session():
            async with self.Session() as session:
                yield session

        self._original_get_db_session = user_service_module.get_db_session
        user_service_module.get_db_session = test_session

    async def asyncTearDown(self):
        user_service_module.get_db_session = self._original_get_db_session
        await self.engine.dispose()
        self._tmpdir.cleanup()

    async def test_reused_email_with_new_clerk_id_reports_identity_conflict(self):
        async with self.Session() as session:
            session.add(UserDB(id="old-clerk-id", email="test@example.com"))
            await session.commit()

        with self.assertRaises(AccountIdentityConflictError) as raised:
            await UserService().ensure_user_exists(
                user_id="new-clerk-id",
                email="TEST@example.com",
            )

        self.assertEqual(raised.exception.existing_user_id, "old-clerk-id")
        self.assertEqual(raised.exception.requested_user_id, "new-clerk-id")
