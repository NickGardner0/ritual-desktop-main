from __future__ import annotations

import base64
from datetime import datetime, timezone
import unittest
from pathlib import Path
import sys
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.account_deletion import create_account_deletion_router, verify_clerk_webhook


async def _current_user():
    return {"id": "user-delete", "email": "delete@example.com"}


class AccountDeletionApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(
            create_account_deletion_router(get_current_user=_current_user)
        )
        self.client = TestClient(app)

    def test_verified_user_deleted_webhook_runs_coordinator(self):
        with (
            patch(
                "api.account_deletion.verify_clerk_webhook",
                return_value={"type": "user.deleted", "data": {"id": "user-delete"}},
            ),
            patch(
                "api.account_deletion.process_account_deletion",
                new=AsyncMock(return_value={"status": "completed"}),
            ) as process,
        ):
            response = self.client.post(
                "/api/webhooks/clerk",
                content=b'{"type":"user.deleted"}',
                headers={"svix-id": "msg_123"},
            )

        self.assertEqual(response.status_code, 200)
        process.assert_awaited_once_with(
            "user-delete",
            source="clerk_webhook",
            event_id="msg_123",
        )

    def test_clerk_webhook_signature_is_verified_against_raw_body(self):
        from svix.webhooks import Webhook

        secret = "whsec_" + base64.b64encode(b"ritual-test-secret").decode()
        payload = b'{"type":"user.deleted","data":{"id":"user-delete"}}'
        timestamp = datetime.now(timezone.utc)
        webhook = Webhook(secret)
        headers = {
            "svix-id": "msg_verified",
            "svix-timestamp": str(int(timestamp.timestamp())),
            "svix-signature": webhook.sign(
                "msg_verified",
                timestamp,
                payload.decode(),
            ),
        }

        with patch.dict(
            "os.environ",
            {"CLERK_WEBHOOK_SIGNING_SECRET": secret},
        ):
            event = verify_clerk_webhook(payload, headers)

        self.assertEqual(event["type"], "user.deleted")
        self.assertEqual(event["data"]["id"], "user-delete")

    def test_invalid_webhook_is_rejected(self):
        with patch(
            "api.account_deletion.verify_clerk_webhook",
            side_effect=ValueError("bad signature"),
        ):
            response = self.client.post(
                "/api/webhooks/clerk",
                content=b"{}",
            )

        self.assertEqual(response.status_code, 400)

    def test_partial_webhook_processing_returns_error_so_clerk_retries(self):
        with (
            patch(
                "api.account_deletion.verify_clerk_webhook",
                return_value={"type": "user.deleted", "data": {"id": "user-delete"}},
            ),
            patch(
                "api.account_deletion.process_account_deletion",
                new=AsyncMock(return_value={"status": "partial"}),
            ),
        ):
            response = self.client.post(
                "/api/webhooks/clerk",
                content=b'{"type":"user.deleted"}',
                headers={"svix-id": "msg_retry"},
            )

        self.assertEqual(response.status_code, 500)

    def test_authenticated_delete_removes_clerk_then_runs_coordinator(self):
        with (
            patch(
                "api.account_deletion.delete_clerk_identity",
                new=AsyncMock(return_value={"status": "deleted"}),
            ) as delete_clerk,
            patch(
                "api.account_deletion.process_account_deletion",
                new=AsyncMock(return_value={"status": "completed"}),
            ) as process,
        ):
            response = self.client.delete("/api/user/account")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["deleted"])
        delete_clerk.assert_awaited_once_with("user-delete")
        process.assert_awaited_once_with(
            "user-delete",
            source="authenticated_request",
        )
