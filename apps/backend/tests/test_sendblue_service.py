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

    def test_get_ritual_vcard_url_returns_none_without_public_backend_url(self):
        with patch.object(sendblue_service, "BACKEND_PUBLIC_URL", ""):
            self.assertIsNone(sendblue_service.get_ritual_vcard_url())

    def test_get_ritual_vcard_url_builds_expected_path(self):
        with patch.object(sendblue_service, "BACKEND_PUBLIC_URL", "https://api.ritual.test/"):
            self.assertEqual(
                sendblue_service.get_ritual_vcard_url(),
                "https://api.ritual.test/api/contact/ritual.vcf",
            )

    async def test_send_message_treats_202_accepted_as_success(self):
        _FakeAsyncClient.calls = []

        class _AcceptedAsyncClient(_FakeAsyncClient):
            async def post(self, url, headers=None, json=None):
                _FakeAsyncClient.calls.append(
                    {
                        "url": url,
                        "headers": headers,
                        "json": json,
                    }
                )
                return _FakeResponse(status_code=202, text="accepted")

        with patch.object(sendblue_service, "SENDBLUE_API_KEY", "test-key"), patch.object(
            sendblue_service, "SENDBLUE_API_SECRET", "test-secret"
        ), patch.object(
            sendblue_service,
            "SENDBLUE_FROM_NUMBER",
            "+1 (835) 276-1673",
        ), patch("services.sendblue_service.httpx.AsyncClient", _AcceptedAsyncClient):
            sent = await sendblue_service.send_message(
                phone_number="631-555-1234",
                text="Welcome to Ritual.",
            )

        self.assertTrue(sent)
