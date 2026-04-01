import os
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.user_service import UserService


class _Result:
    def __init__(self, *, one=None, one_or_none=None):
        self._one = one
        self._one_or_none = one_or_none

    def scalar_one(self):
        return self._one

    def scalar_one_or_none(self):
        return self._one_or_none


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


class UserServiceOnboardingWelcomeTests(unittest.IsolatedAsyncioTestCase):
    async def test_update_onboarding_sends_welcome_once_when_phone_present(self):
        service = UserService()
        existing_user = SimpleNamespace(
            id="user-1",
            onboarding_completed=False,
            sms_welcome_sent_at=None,
            phone_number=None,
        )
        updated_user = SimpleNamespace(
            id="user-1",
            full_name="Nick Gardner",
            phone_number="+16317450064",
            sms_welcome_sent_at=None,
        )

        session = AsyncMock()
        session.execute = AsyncMock(
            side_effect=[
                _Result(one_or_none=existing_user),
                None,
                _Result(one=updated_user),
                None,
            ]
        )

        with patch("services.user_service.get_db_session", return_value=_SessionContext(session)), patch(
            "services.user_service.send_onboarding_welcome",
            AsyncMock(return_value=True),
        ) as send_welcome:
            result = await service.update_onboarding(
                user_id="user-1",
                name="Nick Gardner",
                age_bracket="25-34",
                gender="Male",
                country="US",
                tracking_interests=["Productivity"],
                wearable_devices=["Whoop"],
                phone_number="631-745-0064",
            )

        self.assertEqual(result, updated_user)
        send_welcome.assert_awaited_once_with("+16317450064", "Nick Gardner")
        self.assertEqual(session.commit.await_count, 2)
        self.assertIsInstance(updated_user.sms_welcome_sent_at, datetime)

    async def test_update_onboarding_skips_welcome_when_already_sent(self):
        service = UserService()
        existing_user = SimpleNamespace(
            id="user-1",
            onboarding_completed=True,
            sms_welcome_sent_at=datetime.now(timezone.utc),
            phone_number="+16317450064",
        )
        updated_user = SimpleNamespace(
            id="user-1",
            full_name="Nick Gardner",
            phone_number="+16317450064",
            sms_welcome_sent_at=existing_user.sms_welcome_sent_at,
        )

        session = AsyncMock()
        session.execute = AsyncMock(
            side_effect=[
                _Result(one_or_none=existing_user),
                None,
                _Result(one=updated_user),
            ]
        )

        with patch("services.user_service.get_db_session", return_value=_SessionContext(session)), patch(
            "services.user_service.send_onboarding_welcome",
            AsyncMock(return_value=True),
        ) as send_welcome:
            result = await service.update_onboarding(
                user_id="user-1",
                name="Nick Gardner",
                age_bracket="25-34",
                gender="Male",
                country="US",
                tracking_interests=["Productivity"],
                wearable_devices=["Whoop"],
                phone_number="631-745-0064",
            )

        self.assertEqual(result, updated_user)
        send_welcome.assert_not_awaited()
        self.assertEqual(session.commit.await_count, 1)
