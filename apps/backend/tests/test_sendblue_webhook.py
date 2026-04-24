import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api import sendblue


class _FakeRequest:
    def __init__(self, payload: dict):
        self._payload = payload
        self.headers = {}

    async def body(self):
        return b"{}"

    async def json(self):
        return self._payload


class SendblueWebhookTests(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_phone_number_gets_landing_page_onboarding_reply(self):
        request = _FakeRequest(
            {
                "is_outbound": False,
                "message_type": "message",
                "from_number": "+16315551234",
                "content": "hello",
            }
        )

        with patch.object(sendblue, "SENDBLUE_WEBHOOK_SECRET", ""), patch.object(
            sendblue, "RITUAL_LANDING_PAGE_URL", "https://ritualdb.com"
        ), patch("api.sendblue.UserService") as user_service_cls, patch(
            "api.sendblue._send_sms", AsyncMock(return_value=True)
        ) as send_sms:
            user_service_cls.return_value.get_user_by_phone = AsyncMock(return_value=None)

            result = await sendblue.sendblue_webhook(request)

        self.assertEqual(result, {"status": "ok", "error": "user_not_found"})
        send_sms.assert_awaited_once_with(
            "+16315551234",
            "Welcome to Ritual, to link this phone number and start interacting "
            "with the app through SMS, please download the desktop app: https://ritualdb.com",
        )
