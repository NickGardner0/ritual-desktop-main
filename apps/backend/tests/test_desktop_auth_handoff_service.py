from __future__ import annotations

import tempfile
import unittest
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database.models import Base, DesktopAuthHandoffDB
from schemas.desktop_auth import (
    DesktopAuthHandoffAcknowledge,
    DesktopAuthHandoffClaimFailure,
    DesktopAuthHandoffConsume,
    DesktopAuthHandoffCreate,
)
from services import desktop_auth_handoff_service as service_module
from services.desktop_auth_handoff_service import DesktopAuthHandoffService, _utc_now


NONCE = "nonce-value-long-enough-for-a-v2-desktop-handoff"
HANDOFF_ID = "dah_0123456789abcdefghijkl"


class DesktopAuthHandoffServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "desktop-auth.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

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
        self.service = DesktopAuthHandoffService()

    async def asyncTearDown(self):
        service_module.get_db_session = self._original_get_db_session
        await self.engine.dispose()
        self._tmpdir.cleanup()

    async def _create(self):
        return await self.service.create(
            "user-1",
            DesktopAuthHandoffCreate(
                id=HANDOFF_ID,
                nonce_challenge=service_module._hash_nonce(NONCE),
                channel="qa",
                protocol="2",
                native_metadata={
                    "app_version": "0.1.99",
                    "build_sha": "test-sha",
                    "bundle_id": "com.ritual.desktop.qa",
                },
            ),
        )

    @staticmethod
    def _consume_payload(channel="qa", bundle_id="com.ritual.desktop.qa"):
        return DesktopAuthHandoffConsume(
            nonce=NONCE,
            channel=channel,
            protocol="2",
            native_metadata={
                "app_version": "0.1.99",
                "build_sha": "test-sha",
                "bundle_id": bundle_id,
            },
        )

    async def test_handoff_consumes_once_and_requires_acknowledgement(self):
        created = await self._create()
        self.assertEqual(created.status, "pending")
        consumed = await self.service.consume(
            created.id,
            self._consume_payload(),
        )
        self.assertEqual(consumed.status, "consumed")
        with self.assertRaisesRegex(ValueError, "already consumed"):
            await self.service.consume(
                created.id,
                self._consume_payload(),
            )
        acknowledged = await self.service.acknowledge(
            "user-1",
            created.id,
            DesktopAuthHandoffAcknowledge(outcome="acknowledged"),
        )
        self.assertEqual(acknowledged.status, "acknowledged")
        self.assertIsNotNone(acknowledged.acknowledged_at)

    async def test_mismatch_does_not_consume_pending_handoff(self):
        created = await self._create()
        with self.assertRaisesRegex(ValueError, "channel or protocol mismatch"):
            await self.service.consume(
                created.id,
                self._consume_payload("production", "com.ritual.desktop"),
            )
        current = await self.service.get("user-1", created.id)
        self.assertEqual(current.status, "pending")

    async def test_binary_identity_change_does_not_consume_pending_handoff(self):
        created = await self._create()
        mismatched = self._consume_payload()
        mismatched.native_metadata.build_sha = "different-sha"
        with self.assertRaisesRegex(ValueError, "binary identity changed"):
            await self.service.consume(created.id, mismatched)
        current = await self.service.get("user-1", created.id)
        self.assertEqual(current.status, "pending")

    async def test_ticket_creation_failure_reaches_a_truthful_terminal_state(self):
        created = await self._create()
        consume = self._consume_payload()
        await self.service.consume(created.id, consume)
        failed = await self.service.fail_claim(
            created.id,
            DesktopAuthHandoffClaimFailure(
                **consume.model_dump(),
                failure_code="clerk_ticket_creation_failed",
            ),
        )
        self.assertEqual(failed.status, "failed")
        self.assertEqual(failed.failure_code, "clerk_ticket_creation_failed")

    async def test_expired_handoff_fails_closed(self):
        created = await self._create()
        async with self.Session() as session:
            row = await session.scalar(
                select(DesktopAuthHandoffDB).where(DesktopAuthHandoffDB.id == created.id)
            )
            row.expires_at = _utc_now() - timedelta(seconds=1)
            await session.commit()
        with self.assertRaisesRegex(ValueError, "expired"):
            await self.service.consume(
                created.id,
                self._consume_payload(),
            )
        current = await self.service.get("user-1", created.id)
        self.assertEqual(current.status, "expired")


if __name__ == "__main__":
    unittest.main()
