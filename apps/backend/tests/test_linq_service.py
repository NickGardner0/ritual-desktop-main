import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services import linq_service


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


class LinqServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_send_linq_message_creates_chat_with_expected_payload(self):
        _FakeAsyncClient.calls = []

        with patch.object(linq_service, "LINQ_API_KEY", "test-key"), patch.object(
            linq_service,
            "LINQ_FROM_NUMBER",
            "+1 (631) 745-0064",
        ), patch("services.linq_service.httpx.AsyncClient", _FakeAsyncClient):
            sent = await linq_service.send_linq_message(
                phone_number="631-555-1234",
                text="Welcome to Ritual.",
                display_name="Ritual",
            )

        self.assertTrue(sent)
        self.assertEqual(len(_FakeAsyncClient.calls), 1)
        call = _FakeAsyncClient.calls[0]
        self.assertEqual(call["url"], "https://api.linqapp.com/api/partner/v3/chats")
        self.assertEqual(call["json"]["from"], "+16317450064")
        self.assertEqual(call["json"]["to"], ["+16315551234"])
        self.assertEqual(call["json"]["display_name"], "Ritual")
        self.assertEqual(call["json"]["message"]["parts"][0]["value"], "Welcome to Ritual.")

    def test_build_onboarding_welcome_text_includes_core_examples(self):
        text = linq_service.build_onboarding_welcome_text("Nick")

        self.assertIn("Welcome to Ritual, Nick.", text)
        self.assertIn("30mg caffeine", text)
        self.assertIn("45 min workout", text)
        self.assertIn("Overview and Metrics", text)
