import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services import sendblue_service


class _FakeResponse:
    def __init__(self, status_code=201, text="ok"):
        self.status_code = status_code
        self.text = text


class _FakeAsyncClient:
    calls = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, headers=None, json=None):
        _FakeAsyncClient.calls.append(
            {
                "url": url,
                "headers": headers,
                "json": json,
            }
        )
        return _FakeResponse()


class SendblueServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_send_message_posts_to_sendblue_with_expected_payload(self):
        _FakeAsyncClient.calls = []

        with patch.object(sendblue_service, "SENDBLUE_API_KEY", "test-key"), patch.object(
            sendblue_service, "SENDBLUE_API_SECRET", "test-secret"
        ), patch.object(
            sendblue_service,
            "SENDBLUE_FROM_NUMBER",
            "+1 (835) 276-1673",
        ), patch("services.sendblue_service.httpx.AsyncClient", _FakeAsyncClient):
            sent = await sendblue_service.send_message(
                phone_number="631-555-1234",
                text="Welcome to Ritual.",
            )

        self.assertTrue(sent)
        self.assertEqual(len(_FakeAsyncClient.calls), 1)
        call = _FakeAsyncClient.calls[0]
        self.assertEqual(call["url"], "https://api.sendblue.co/api/send-message")
        self.assertEqual(call["json"]["number"], "+16315551234")
        self.assertEqual(call["json"]["content"], "Welcome to Ritual.")
        self.assertEqual(call["json"]["from_number"], "+18352761673")
        self.assertEqual(call["headers"]["sb-api-key-id"], "test-key")
        self.assertEqual(call["headers"]["sb-api-secret-key"], "test-secret")

    def test_build_onboarding_welcome_text_includes_core_examples(self):
        text = sendblue_service.build_onboarding_welcome_text("Nick")

        self.assertIn("Welcome to Ritual, Nick.", text)
        self.assertIn("30mg caffeine", text)
        self.assertIn("45 min workout", text)
        self.assertIn("Overview and Metrics", text)
