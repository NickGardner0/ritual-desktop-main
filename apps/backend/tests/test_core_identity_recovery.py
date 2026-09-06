from __future__ import annotations

import unittest
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.account_context import ensure_current_user_record
from services.user_service import AccountIdentityConflictError


class FakeUserService:
    def __init__(self):
        self.calls = 0

    async def ensure_user_exists(self, **kwargs):
        self.calls += 1
        if self.calls == 1:
            raise AccountIdentityConflictError(
                email=kwargs["email"],
                existing_user_id="old-clerk-id",
                requested_user_id=kwargs["user_id"],
            )
        return SimpleNamespace(id=kwargs["user_id"], email=kwargs["email"])


class CoreIdentityRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_old_clerk_identity_is_erased_then_provisioning_retries(self):
        service = FakeUserService()
        with (
            patch("services.account_context.clerk_identity_exists", new=AsyncMock(return_value=False)),
            patch(
                "services.account_context.process_account_deletion",
                new=AsyncMock(return_value={"status": "completed"}),
            ) as erase,
        ):
            user = await ensure_current_user_record(
                service,
                {"id": "new-clerk-id", "email": "test@example.com"},
            )

        self.assertEqual(user.id, "new-clerk-id")
        self.assertEqual(service.calls, 2)
        erase.assert_awaited_once_with(
            "old-clerk-id",
            source="identity_conflict_recovery",
            event_id="identity-conflict:old-clerk-id:new-clerk-id",
        )

    async def test_existing_old_clerk_identity_fails_closed_without_erasure(self):
        service = FakeUserService()
        with (
            patch("services.account_context.clerk_identity_exists", new=AsyncMock(return_value=True)),
            patch("services.account_context.process_account_deletion", new=AsyncMock()) as erase,
        ):
            with self.assertRaises(AccountIdentityConflictError):
                await ensure_current_user_record(
                    service,
                    {"id": "new-clerk-id", "email": "test@example.com"},
                )

        self.assertEqual(service.calls, 1)
        erase.assert_not_awaited()
