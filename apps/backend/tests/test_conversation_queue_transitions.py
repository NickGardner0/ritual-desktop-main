from __future__ import annotations

import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database.models import AIConversationDB, Base, ConversationQueueItemDB, UserDB
from services import conversation_queue_service as queue_module
from services.conversation_queue_service import ConversationQueueService, ConversationQueueTransitionConflict


class ConversationQueueTransitionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "queue.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.Session() as session:
            session.add(UserDB(id="user-1", email="queue@example.com"))
            session.add(AIConversationDB(id="conversation-1", user_id="user-1"))
            session.add(
                ConversationQueueItemDB(
                    id="item-1",
                    conversation_id="conversation-1",
                    user_id="user-1",
                    prompt_text="Continue",
                    status="pending",
                    source="manual",
                )
            )
            await session.commit()

        @asynccontextmanager
        async def test_session():
            async with self.Session() as session:
                yield session

        self._original_get_db_session = queue_module.get_db_session
        queue_module.get_db_session = test_session
        self.service = ConversationQueueService()

    async def asyncTearDown(self):
        queue_module.get_db_session = self._original_get_db_session
        await self.engine.dispose()
        self._tmpdir.cleanup()

    async def test_only_one_pending_to_running_claim_wins(self):
        claimed = await self.service.claim_next_item("user-1", "conversation-1", "item-1")
        self.assertEqual(claimed.item.status, "running")
        self.assertIsNotNone(claimed.item.started_at)

        with self.assertRaises(ConversationQueueTransitionConflict) as conflict:
            await self.service.claim_next_item("user-1", "conversation-1", "item-1")
        self.assertEqual(conflict.exception.item.status, "running")

    async def test_stale_completion_cannot_overwrite_cancel(self):
        await self.service.claim_next_item("user-1", "conversation-1", "item-1")
        canceled = await self.service.transition_item(
            "user-1",
            "conversation-1",
            "item-1",
            expected_statuses={"pending", "running"},
            status="canceled",
        )
        self.assertEqual(canceled.status, "canceled")

        with self.assertRaises(ConversationQueueTransitionConflict) as conflict:
            await self.service.transition_item(
                "user-1",
                "conversation-1",
                "item-1",
                expected_statuses={"running"},
                status="completed",
            )
        self.assertEqual(conflict.exception.item.status, "canceled")

    async def test_failed_transition_owns_error_and_completion_timestamp(self):
        await self.service.claim_next_item("user-1", "conversation-1", "item-1")
        failed = await self.service.transition_item(
            "user-1",
            "conversation-1",
            "item-1",
            expected_statuses={"running"},
            status="failed",
            error={"message": "execution failed"},
        )
        self.assertEqual(failed.status, "failed")
        self.assertEqual(failed.error, {"message": "execution failed"})
        self.assertIsNotNone(failed.completed_at)
