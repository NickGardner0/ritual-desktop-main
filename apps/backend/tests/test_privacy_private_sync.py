from __future__ import annotations

import json
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
import sys
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.models import Base, PrivateSyncDeviceDB, PrivateSyncEnvelopeDB, PrivateSyncKeyGrantDB, UserDB
from services.privacy_private_sync import (
    delete_private_sync_envelopes,
    list_private_sync_devices,
    list_private_sync_envelopes,
    list_private_sync_key_grants,
    put_private_sync_key_grants,
    put_private_sync_envelopes,
    register_private_sync_device,
    revoke_private_sync_device,
)


def envelope(
    envelope_id: str,
    *,
    revision: int = 1,
    ciphertext_sha256: str = "ciphertext-hash-1",
) -> dict:
    return {
        "envelope_id": envelope_id,
        "collection": "habit_logs",
        "record_id": "log-private",
        "record_type": "habit_log",
        "revision": revision,
        "key_version": 1,
        "algorithm": "AES-256-GCM",
        "nonce": "bm9uY2U=",
        "ciphertext": "ZW5jcnlwdGVkLXJlY29yZA==",
        "aad": "eyJjb2xsZWN0aW9uIjoiaGFiaXRfbG9ncyJ9",
        "ciphertext_sha256": ciphertext_sha256,
        "tombstone": False,
        "client_updated_at": "2026-06-23T12:00:00Z",
    }


def key_grant(
    grant_id: str,
    *,
    recipient_device_id: str = "device-2",
    ciphertext_sha256: str = "grant-hash-1",
) -> dict:
    return {
        "grant_id": grant_id,
        "recipient_device_id": recipient_device_id,
        "key_version": 1,
        "algorithm": "AES-256-GCM",
        "nonce": "bm9uY2U=",
        "ciphertext": "ZW5jcnlwdGVkLWtleQ==",
        "aad": "eyJkZXZpY2UiOiJkZXZpY2UtMiJ9",
        "ciphertext_sha256": ciphertext_sha256,
    }


class PrivacyPrivateSyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        db_path = Path(self._tmpdir.name) / "privacy-private-sync.db"
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
        self.Session = async_sessionmaker(self.engine, expire_on_commit=False)

        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        async with self.Session() as session:
            session.add(
                UserDB(
                    id="user-private-sync",
                    email="private-sync@example.com",
                    full_name="Private Sync User",
                )
            )
            await session.commit()

    async def asyncTearDown(self):
        await self.engine.dispose()
        self._tmpdir.cleanup()

    @asynccontextmanager
    async def db_session(self):
        async with self.Session() as session:
            yield session

    async def test_put_stores_ciphertext_only_envelope(self):
        with patch("services.privacy_private_sync.get_db_session", self.db_session):
            device = await register_private_sync_device(
                "user-private-sync",
                device_id="device-1",
                device_name="This Mac",
                platform="macos",
            )
            result = await put_private_sync_envelopes(
                "user-private-sync",
                [envelope("habit_logs:log-private")],
                device_id="device-1",
                client_id="client-1",
            )

        self.assertEqual(device["status"], "active")
        self.assertEqual(result["accepted_count"], 1)
        self.assertEqual(result["ignored_count"], 0)
        self.assertEqual(result["max_server_revision"], 1)

        async with self.Session() as session:
            row = (
                await session.execute(
                    select(PrivateSyncEnvelopeDB).where(
                        PrivateSyncEnvelopeDB.user_id == "user-private-sync"
                    )
                )
            ).scalar_one()

        serialized = json.dumps(
            {
                "envelope_id": row.envelope_id,
                "collection": row.collection,
                "record_id": row.record_id,
                "record_type": row.record_type,
                "nonce": row.nonce,
                "ciphertext": row.ciphertext,
                "aad": row.aad,
                "ciphertext_sha256": row.ciphertext_sha256,
            }
        )
        self.assertNotIn("Private Medication", serialized)
        self.assertNotIn("sensitive dosage note", serialized)
        self.assertEqual(row.algorithm, "AES-256-GCM")
        self.assertEqual(row.client_id, "client-1")

    async def test_delta_listing_and_idempotent_updates(self):
        with patch("services.privacy_private_sync.get_db_session", self.db_session):
            await register_private_sync_device(
                "user-private-sync",
                device_id="device-1",
                device_name="This Mac",
                platform="macos",
            )
            first = await put_private_sync_envelopes(
                "user-private-sync",
                [
                    envelope("habit_logs:log-private", revision=2, ciphertext_sha256="hash-2"),
                    envelope("habit_logs:log-second", revision=1, ciphertext_sha256="hash-3"),
                ],
                device_id="device-1",
            )
            stale = await put_private_sync_envelopes(
                "user-private-sync",
                [envelope("habit_logs:log-private", revision=1, ciphertext_sha256="stale-hash")],
                device_id="device-1",
            )
            duplicate = await put_private_sync_envelopes(
                "user-private-sync",
                [envelope("habit_logs:log-private", revision=2, ciphertext_sha256="hash-2")],
                device_id="device-1",
            )
            delta = await list_private_sync_envelopes(
                "user-private-sync",
                device_id="device-1",
                since_server_revision=0,
                limit=10,
            )
            after_first = await list_private_sync_envelopes(
                "user-private-sync",
                device_id="device-1",
                since_server_revision=1,
                limit=10,
            )

        self.assertEqual(first["accepted_count"], 2)
        self.assertEqual(first["max_server_revision"], 2)
        self.assertEqual(stale["accepted_count"], 0)
        self.assertEqual(stale["ignored_count"], 1)
        self.assertEqual(duplicate["accepted_count"], 0)
        self.assertEqual(duplicate["ignored_count"], 1)
        self.assertEqual([item["server_revision"] for item in delta["envelopes"]], [1, 2])
        self.assertEqual(delta["next_since_server_revision"], 2)
        self.assertEqual([item["server_revision"] for item in after_first["envelopes"]], [2])

    async def test_delete_private_sync_envelopes_preserves_user(self):
        with patch("services.privacy_private_sync.get_db_session", self.db_session):
            await register_private_sync_device(
                "user-private-sync",
                device_id="device-1",
                device_name="This Mac",
                platform="macos",
            )
            await put_private_sync_envelopes(
                "user-private-sync",
                [envelope("habit_logs:log-private")],
                device_id="device-1",
            )
            result = await delete_private_sync_envelopes("user-private-sync")
            remaining = await list_private_sync_envelopes("user-private-sync", device_id="device-1")

        self.assertEqual(result["deleted_count"], 1)
        self.assertEqual(remaining["returned_count"], 0)

        async with self.Session() as session:
            user = await session.get(UserDB, "user-private-sync")
        self.assertIsNotNone(user)

    async def test_device_key_grants_and_revoke_gate_envelope_access(self):
        with patch("services.privacy_private_sync.get_db_session", self.db_session):
            first = await register_private_sync_device(
                "user-private-sync",
                device_id="device-1",
                device_name="This Mac",
                platform="macos",
            )
            second = await register_private_sync_device(
                "user-private-sync",
                device_id="device-2",
                device_name="Travel Mac",
                platform="macos",
            )

            with self.assertRaises(PermissionError):
                await put_private_sync_envelopes(
                    "user-private-sync",
                    [envelope("habit_logs:pending-device")],
                    device_id="device-2",
                )

            grants = await put_private_sync_key_grants(
                "user-private-sync",
                [key_grant("grant-1")],
                sender_device_id="device-1",
            )
            devices = await list_private_sync_devices("user-private-sync")
            listed_grants = await list_private_sync_key_grants(
                "user-private-sync",
                device_id="device-2",
            )
            accepted = await put_private_sync_envelopes(
                "user-private-sync",
                [envelope("habit_logs:trusted-device", ciphertext_sha256="hash-trusted")],
                device_id="device-2",
            )
            revoked = await revoke_private_sync_device(
                "user-private-sync",
                requester_device_id="device-1",
                device_id="device-2",
            )

            with self.assertRaises(PermissionError):
                await list_private_sync_envelopes("user-private-sync", device_id="device-2")

        self.assertEqual(first["status"], "active")
        self.assertEqual(second["status"], "pending")
        self.assertEqual(grants["accepted_count"], 1)
        self.assertEqual(listed_grants["grant_count"], 1)
        self.assertEqual(accepted["accepted_count"], 1)
        self.assertTrue(revoked["revoked"])
        statuses = {device["device_id"]: device["status"] for device in devices["devices"]}
        self.assertEqual(statuses["device-1"], "active")
        self.assertEqual(statuses["device-2"], "active")

        async with self.Session() as session:
            device_count = (
                await session.execute(select(PrivateSyncDeviceDB))
            ).scalars().all()
            grant_count = (
                await session.execute(select(PrivateSyncKeyGrantDB))
            ).scalars().all()
        self.assertEqual(len(device_count), 2)
        self.assertEqual(len(grant_count), 1)

if __name__ == "__main__":
    unittest.main()
