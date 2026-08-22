from __future__ import annotations

import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
import sys

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database.models import AIMessageDB, AssistantTurnDB, Base, UserDB
from schemas.assistant_turns import AssistantTurnAccept, AssistantTurnCommit, AssistantTurnUpsert
from services import assistant_turn_service as service_module
from services.assistant_turn_service import AssistantTurnService


class AssistantTurnServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "assistant-turns.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.Session() as session:
            session.add(UserDB(id="user-1", email="turns@example.com"))
            await session.commit()

        @asynccontextmanager
        async def test_session():
            async with self.Session() as session:
                try:
                    yield session
                except Exception:
                    await session.rollback()
                    raise

        self._original_get_db_session = service_module.get_db_session
        service_module.get_db_session = test_session
        self.service = AssistantTurnService()

    async def asyncTearDown(self):
        service_module.get_db_session = self._original_get_db_session
        await self.engine.dispose()
        self._tmpdir.cleanup()

    async def test_accept_is_atomic_and_idempotent(self):
        payload = AssistantTurnAccept(
            id="turn-1",
            channel="dashboard",
            epoch=3,
            user_message="Plan my afternoon",
        )
        first = await self.service.accept_turn("user-1", payload)
        second = await self.service.accept_turn("user-1", payload)

        self.assertEqual(first.id, second.id)
        self.assertEqual(first.conversation_id, second.conversation_id)
        self.assertEqual(first.user_message_id, "turn-1:user")
        self.assertIsNotNone(first.accepted_at)
        async with self.Session() as session:
            message_count = await session.scalar(
                select(func.count(AIMessageDB.id)).where(AIMessageDB.id == "turn-1:user")
            )
            self.assertEqual(message_count, 1)

    async def test_accept_rejects_epoch_or_payload_replay_mismatch(self):
        await self.service.accept_turn(
            "user-1",
            AssistantTurnAccept(id="turn-mismatch", epoch=1, user_message="original"),
        )
        with self.assertRaisesRegex(ValueError, "epoch"):
            await self.service.accept_turn(
                "user-1",
                AssistantTurnAccept(id="turn-mismatch", epoch=2, user_message="original"),
            )
        with self.assertRaisesRegex(ValueError, "user message"):
            await self.service.accept_turn(
                "user-1",
                AssistantTurnAccept(id="turn-mismatch", epoch=1, user_message="changed"),
            )

    async def test_commit_writes_assistant_message_receipts_and_terminal_state_once(self):
        accepted = await self.service.accept_turn(
            "user-1",
            AssistantTurnAccept(id="turn-commit", epoch=1, user_message="Log water"),
        )
        await self.service.upsert_turn(
            "user-1",
            AssistantTurnUpsert(
                id=accepted.id,
                conversation_id=accepted.conversation_id,
                channel="dashboard",
                status="running",
                epoch=1,
                sequence=accepted.sequence,
            ),
        )
        payload = AssistantTurnCommit(
            epoch=1,
            assistant_text="Logged.",
            receipt_ids=["receipt-1", "receipt-1"],
            tool_payload={"ok": True},
        )
        first = await self.service.commit_turn("user-1", accepted.id, payload)
        second = await self.service.commit_turn("user-1", accepted.id, payload)

        self.assertEqual(first.status, "completed")
        self.assertEqual(first.receipt_ids, ["receipt-1"])
        self.assertEqual(first.commit_version, 1)
        self.assertEqual(second.commit_version, 1)
        async with self.Session() as session:
            assistant_count = await session.scalar(
                select(func.count(AIMessageDB.id)).where(
                    AIMessageDB.id == "turn-commit:assistant"
                )
            )
            self.assertEqual(assistant_count, 1)

        with self.assertRaisesRegex(ValueError, "conflicting commit"):
            await self.service.commit_turn(
                "user-1",
                accepted.id,
                AssistantTurnCommit(epoch=1, assistant_text="Different"),
            )

    async def test_commit_rejects_legacy_unaccepted_turn(self):
        async with self.Session() as session:
            session.add(
                AssistantTurnDB(
                    id="legacy-turn",
                    user_id="user-1",
                    channel="dashboard",
                    status="running",
                    epoch=0,
                    sequence=1,
                )
            )
            await session.commit()
        with self.assertRaisesRegex(ValueError, "not durably accepted"):
            await self.service.commit_turn(
                "user-1",
                "legacy-turn",
                AssistantTurnCommit(epoch=0, assistant_text="Must not commit"),
            )


if __name__ == "__main__":
    unittest.main()
