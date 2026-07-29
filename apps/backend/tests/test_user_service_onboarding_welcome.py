import os
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.user_service import UserService


class _Result:
    def __init__(self, *, first=None):
        self._first = first

    def first(self):
        return self._first

    def scalar_one_or_none(self):
        return self._first


class _ExecResult:
    def __init__(self, rowcount: int):
        self.rowcount = rowcount


class _SessionContext:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _user_row(
    *,
    user_id: str,
    email: str = "nick@example.com",
    full_name: str = "Nick Gardner",
    phone_number: str | None = None,
    age_bracket: str | None = None,
    gender: str | None = None,
    country: str | None = None,
    tracking_interests: str | None = None,
    wearable_devices: str | None = None,
    onboarding_completed: bool = False,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
    timezone_name: str | None = None,
    sms_welcome_sent_at: datetime | None = None,
):
    return (
        user_id,
        email,
        full_name,
        phone_number,
        age_bracket,
        gender,
        country,
        tracking_interests,
        wearable_devices,
        onboarding_completed,
        created_at,
        updated_at,
        timezone_name,
        sms_welcome_sent_at,
    )


class UserServiceOnboardingWelcomeTests(unittest.IsolatedAsyncioTestCase):
    async def test_ensure_user_exists_sends_welcome_for_new_phone_signup(self):
        service = UserService()
        session = AsyncMock()
        session.add = Mock()
        session.execute = AsyncMock(
            side_effect=[_Result(first=None), _Result(first=None), _ExecResult(1)]
        )

        with patch("services.user_service.get_db_session", return_value=_SessionContext(session)), patch(
            "services.sms_onboarding_service.sms_onboarding_service.send_desktop_welcome",
            AsyncMock(return_value={"event_id": "evt_1", "sent": True, "conversation_id": "conv_1"}),
        ) as send_welcome:
            user = await service.ensure_user_exists(
                user_id="user-1",
                email="nick@example.com",
                full_name="Nick Gardner",
                phone_number="631-745-0064",
            )

        send_welcome.assert_awaited_once_with(
            user_id="user-1",
            phone_number="+16317450064",
            full_name="Nick Gardner",
        )
        self.assertEqual(user.phone_number, "+16317450064")
        self.assertIsInstance(user.sms_welcome_sent_at, datetime)
        self.assertEqual(session.commit.await_count, 2)

    async def test_ensure_user_exists_sends_welcome_when_phone_synced_from_clerk(self):
        service = UserService()
        session = AsyncMock()
        session.execute = AsyncMock(
            side_effect=[
                _Result(first=_user_row(user_id="user-1", phone_number=None, sms_welcome_sent_at=None)),
                None,
                _ExecResult(1),
            ]
        )

        with patch("services.user_service.get_db_session", return_value=_SessionContext(session)), patch(
            "services.sms_onboarding_service.sms_onboarding_service.send_desktop_welcome",
            AsyncMock(return_value={"event_id": "evt_1", "sent": True, "conversation_id": "conv_1"}),
        ) as send_welcome:
            user = await service.ensure_user_exists(
                user_id="user-1",
                email="nick@example.com",
                full_name="Nick Gardner",
                phone_number="631-745-0064",
            )

        send_welcome.assert_awaited_once_with(
            user_id="user-1",
            phone_number="+16317450064",
            full_name="Nick Gardner",
        )
        self.assertEqual(user.phone_number, "+16317450064")
        self.assertIsInstance(user.sms_welcome_sent_at, datetime)
        self.assertEqual(session.commit.await_count, 2)

    async def test_ensure_user_exists_skips_welcome_when_claim_already_taken(self):
        service = UserService()
        session = AsyncMock()
        session.execute = AsyncMock(
            side_effect=[
                _Result(first=_user_row(user_id="user-1", phone_number=None, sms_welcome_sent_at=None)),
                None,
                _ExecResult(0),
            ]
        )

        with patch("services.user_service.get_db_session", return_value=_SessionContext(session)), patch(
            "services.sms_onboarding_service.sms_onboarding_service.send_desktop_welcome",
            AsyncMock(return_value={"event_id": "evt_1", "sent": True, "conversation_id": "conv_1"}),
        ) as send_welcome:
            user = await service.ensure_user_exists(
                user_id="user-1",
                email="nick@example.com",
                full_name="Nick Gardner",
                phone_number="631-745-0064",
            )

        send_welcome.assert_not_awaited()
        self.assertEqual(user.phone_number, "+16317450064")
        self.assertIsNone(user.sms_welcome_sent_at)
        self.assertEqual(session.commit.await_count, 2)

    async def test_ensure_user_exists_skips_welcome_when_already_sent(self):
        service = UserService()
        sent_at = datetime.now(timezone.utc)
        session = AsyncMock()
        session.execute = AsyncMock(
            side_effect=[
                _Result(
                    first=_user_row(
                        user_id="user-1",
                        phone_number="+16317450064",
                        sms_welcome_sent_at=sent_at,
                    )
                ),
            ]
        )

        with patch("services.user_service.get_db_session", return_value=_SessionContext(session)), patch(
            "services.sms_onboarding_service.sms_onboarding_service.send_desktop_welcome",
            AsyncMock(return_value={"event_id": "evt_1", "sent": True, "conversation_id": "conv_1"}),
        ) as send_welcome:
            user = await service.ensure_user_exists(
                user_id="user-1",
                email="nick@example.com",
                full_name="Nick Gardner",
                phone_number="631-745-0064",
            )

        send_welcome.assert_not_awaited()
        self.assertEqual(user.phone_number, "+16317450064")
        self.assertEqual(user.sms_welcome_sent_at, sent_at)
        self.assertEqual(session.commit.await_count, 0)

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
                _Result(first=_user_row(user_id="user-1")),
                None,
                _Result(first=_user_row(user_id="user-1", phone_number="+16317450064")),
                _ExecResult(1),
            ]
        )

        with patch("services.user_service.get_db_session", return_value=_SessionContext(session)), patch(
            "services.sms_onboarding_service.sms_onboarding_service.send_desktop_welcome",
            AsyncMock(return_value={"event_id": "evt_1", "sent": True, "conversation_id": "conv_1"}),
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
                client_surface="desktop",
            )

        self.assertEqual(result.id, updated_user.id)
        send_welcome.assert_awaited_once_with(
            user_id="user-1",
            phone_number="+16317450064",
            full_name="Nick Gardner",
        )
        self.assertEqual(session.commit.await_count, 2)
        self.assertIsInstance(result.sms_welcome_sent_at, datetime)

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
                _Result(
                    first=_user_row(
                        user_id="user-1",
                        phone_number="+16317450064",
                        onboarding_completed=True,
                        sms_welcome_sent_at=existing_user.sms_welcome_sent_at,
                    )
                ),
                None,
                _Result(
                    first=_user_row(
                        user_id="user-1",
                        phone_number="+16317450064",
                        onboarding_completed=True,
                        sms_welcome_sent_at=existing_user.sms_welcome_sent_at,
                    )
                ),
            ]
        )

        with patch("services.user_service.get_db_session", return_value=_SessionContext(session)), patch(
            "services.sms_onboarding_service.sms_onboarding_service.send_desktop_welcome",
            AsyncMock(return_value={"event_id": "evt_1", "sent": True, "conversation_id": "conv_1"}),
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
                client_surface="desktop",
            )

        self.assertEqual(result.id, updated_user.id)
        send_welcome.assert_not_awaited()
        self.assertEqual(session.commit.await_count, 1)

    async def test_update_onboarding_skips_desktop_welcome_for_web_surface(self):
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
                _Result(first=_user_row(user_id="user-1")),
                None,
                _Result(first=_user_row(user_id="user-1", phone_number="+16317450064")),
            ]
        )

        with patch("services.user_service.get_db_session", return_value=_SessionContext(session)), patch(
            "services.sms_onboarding_service.sms_onboarding_service.send_desktop_welcome",
            AsyncMock(return_value={"event_id": "evt_1", "sent": True, "conversation_id": "conv_1"}),
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
                client_surface="web",
            )

        self.assertEqual(result.id, updated_user.id)
        send_welcome.assert_not_awaited()
        self.assertEqual(session.commit.await_count, 1)
