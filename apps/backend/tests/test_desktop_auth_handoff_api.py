from __future__ import annotations

from datetime import datetime, timedelta
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from api.desktop_auth import create_desktop_auth_router
from schemas.desktop_auth import DesktopAuthHandoffConsumeRead, DesktopAuthHandoffRead


async def _current_user():
    return {"id": "user-1", "email": "user@example.com"}


def _handoff(**overrides):
    now = datetime.utcnow()
    payload = {
        "id": "handoff-1",
        "channel": "qa",
        "protocol": "2",
        "status": "pending",
        "expires_at": now + timedelta(minutes=5),
        "created_at": now,
        "updated_at": now,
    }
    payload.update(overrides)
    return DesktopAuthHandoffRead(**payload)


def _consumed_handoff():
    return DesktopAuthHandoffConsumeRead(
        **_handoff(status="consumed").model_dump(),
        user_id="user-1",
    )


class DesktopAuthHandoffApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(create_desktop_auth_router(get_current_user=_current_user))
        self.client = TestClient(app)

    def test_public_consume_uses_nonce_channel_and_protocol(self):
        with patch("api.desktop_auth.desktop_auth_handoff_service") as service:
            service.consume = AsyncMock(return_value=_consumed_handoff())
            response = self.client.post(
                "/api/desktop-auth/handoffs/handoff-1/consume",
                json={
                    "nonce": "nonce-value-long-enough-for-a-v2-desktop-handoff",
                    "channel": "qa",
                    "protocol": "2",
                    "native_metadata": {
                        "app_version": "0.1.99",
                        "build_sha": "test-sha",
                        "bundle_id": "com.ritual.desktop.qa",
                    },
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "consumed")
        self.assertEqual(response.json()["user_id"], "user-1")

    def test_replay_conflict_is_409(self):
        with patch("api.desktop_auth.desktop_auth_handoff_service") as service:
            service.consume = AsyncMock(side_effect=ValueError("already consumed"))
            response = self.client.post(
                "/api/desktop-auth/handoffs/handoff-1/consume",
                json={
                    "nonce": "nonce-value-long-enough-for-a-v2-desktop-handoff",
                    "channel": "qa",
                    "protocol": "2",
                },
            )
        self.assertEqual(response.status_code, 409)

    def test_claim_failure_is_bound_to_the_same_nonce_identity(self):
        with patch("api.desktop_auth.desktop_auth_handoff_service") as service:
            service.fail_claim = AsyncMock(return_value=_handoff(status="failed"))
            response = self.client.post(
                "/api/desktop-auth/handoffs/handoff-1/claim-failed",
                json={
                    "nonce": "nonce-value-long-enough-for-a-v2-desktop-handoff",
                    "channel": "qa",
                    "protocol": "2",
                    "failure_code": "clerk_ticket_creation_failed",
                    "native_metadata": {
                        "app_version": "0.1.99",
                        "build_sha": "test-sha",
                        "bundle_id": "com.ritual.desktop.qa",
                    },
                },
            )
        self.assertEqual(response.status_code, 200)
        service.fail_claim.assert_awaited_once()

    def test_acknowledgement_is_user_bound(self):
        with patch("api.desktop_auth.desktop_auth_handoff_service") as service:
            service.acknowledge = AsyncMock(return_value=_handoff(status="acknowledged"))
            response = self.client.post(
                "/api/desktop-auth/handoffs/handoff-1/acknowledge",
                json={"outcome": "acknowledged"},
            )
        self.assertEqual(response.status_code, 200)
        service.acknowledge.assert_awaited_once()
        self.assertEqual(service.acknowledge.await_args.args[0], "user-1")


if __name__ == "__main__":
    unittest.main()
