from __future__ import annotations

import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
import sys

from sqlalchemy import func, select
from sqlalchemy.dialects import sqlite
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.models import (
    AIConversationDB,
    AIMessageDB,
    AccountDeletionJobDB,
    ArtifactDB,
    ArtifactRevisionDB,
    Base,
    UserDB,
    WatcherDeviceDB,
    WatcherStateDB,
)
from services import account_deletion_service


class AccountDeletionServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "account-deletion.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        @asynccontextmanager
        async def test_session():
            async with self.Session() as session:
                yield session

        self._original_get_db_session = account_deletion_service.get_db_session
        account_deletion_service.get_db_session = test_session

    async def asyncTearDown(self):
        account_deletion_service.get_db_session = self._original_get_db_session
        await self.engine.dispose()
        self._tmpdir.cleanup()

    async def test_shared_erasure_deletes_transitive_rows_and_preserves_receipt(self):
        async with self.Session() as session:
            session.add_all([
                UserDB(id="user-delete", email="delete@example.com"),
                UserDB(id="user-keep", email="keep@example.com"),
                AccountDeletionJobDB(
                    user_id="user-delete",
                    source="test",
                    status="processing",
                ),
                AIConversationDB(
                    id="conversation-delete",
                    user_id="user-delete",
                    channel="app",
                ),
                AIMessageDB(
                    id="message-delete",
                    conversation_id="conversation-delete",
                    role="user",
                    content="erase me",
                ),
                ArtifactDB(
                    id="artifact-delete",
                    user_id="user-delete",
                    kind="report",
                    source_type="conversation",
                    title="Erase me",
                    body_json="{}",
                ),
                ArtifactRevisionDB(
                    id="revision-delete",
                    artifact_id="artifact-delete",
                    editor_type="user",
                    body_json="{}",
                ),
                WatcherDeviceDB(
                    device_id="device-delete",
                    user_id="user-delete",
                    device_name="Old Mac",
                    platform="macos",
                    created_at=1,
                ),
                WatcherStateDB(
                    id=1,
                    device_id="device-delete",
                    updated_at=1,
                ),
                AIConversationDB(
                    id="conversation-keep",
                    user_id="user-keep",
                    channel="app",
                ),
                AIMessageDB(
                    id="message-keep",
                    conversation_id="conversation-keep",
                    role="user",
                    content="keep me",
                ),
            ])
            await session.commit()

        result = await account_deletion_service.delete_shared_user_rows("user-delete")
        self.assertGreaterEqual(result["deleted_count"], 7)

        async with self.Session() as session:
            deleted_users = await session.scalar(
                select(func.count()).select_from(UserDB).where(UserDB.id == "user-delete")
            )
            kept_users = await session.scalar(
                select(func.count()).select_from(UserDB).where(UserDB.id == "user-keep")
            )
            deleted_messages = await session.scalar(
                select(func.count()).select_from(AIMessageDB).where(
                    AIMessageDB.id == "message-delete"
                )
            )
            kept_messages = await session.scalar(
                select(func.count()).select_from(AIMessageDB).where(
                    AIMessageDB.id == "message-keep"
                )
            )
            receipts = await session.scalar(
                select(func.count()).select_from(AccountDeletionJobDB).where(
                    AccountDeletionJobDB.user_id == "user-delete"
                )
            )

        self.assertEqual(deleted_users, 0)
        self.assertEqual(kept_users, 1)
        self.assertEqual(deleted_messages, 0)
        self.assertEqual(kept_messages, 1)
        self.assertEqual(receipts, 1)

    async def test_claim_is_idempotent_after_completion(self):
        async with self.Session() as session:
            session.add(
                AccountDeletionJobDB(
                    user_id="user-complete",
                    source="test",
                    status="completed",
                    attempts=1,
                    receipt_json='{"done": true}',
                )
            )
            await session.commit()

        claimed, receipt = await account_deletion_service._claim_job(
            "user-complete",
            source="clerk_webhook",
            event_id="msg_123",
        )

        self.assertFalse(claimed)
        self.assertEqual(receipt["status"], "completed")
        self.assertEqual(receipt["attempts"], 1)
        self.assertEqual(receipt["receipt"], {"done": True})

    def test_ownership_predicates_stay_below_turso_expression_depth(self):
        for table in Base.metadata.tables.values():
            if table.name == AccountDeletionJobDB.__tablename__:
                continue
            predicate = account_deletion_service._user_ownership_predicate(
                table,
                "user-delete",
            )
            if predicate is None:
                continue
            compiled = str(
                predicate.compile(
                    dialect=sqlite.dialect(),
                    compile_kwargs={"literal_binds": True},
                )
            )
            self.assertLessEqual(
                compiled.upper().count("EXISTS"),
                10,
                table.name,
            )
