import os
import sys
import unittest
from unittest.mock import patch

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api import sendblue


class _FakeAsyncClient:
    def __init__(self, *, response=None, error=None, timeout=None):
        self._response = response
        self._error = error
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, json=None, headers=None):
        if self._error is not None:
            raise self._error
        return self._response


class _AsyncClientFactory:
    def __init__(self, *, response=None, error=None):
        self._response = response
        self._error = error
        self.last_client = None

    def __call__(self, *args, **kwargs):
        self.last_client = _FakeAsyncClient(
            response=self._response,
            error=self._error,
            timeout=kwargs.get("timeout"),
        )
        return self.last_client


class _FakeResponse:
    def __init__(self, *, status_code=200, text="ok", payload=None):
        self.status_code = status_code
        self.text = text
        self._payload = payload if payload is not None else {"text": "ok"}

    def json(self):
        return self._payload


class SendblueOrchestratorTests(unittest.IsolatedAsyncioTestCase):
    async def test_call_orchestrator_wraps_timeout_with_context(self):
        factory = _AsyncClientFactory(error=httpx.ReadTimeout("timed out"))

        with patch("api.sendblue.httpx.AsyncClient", factory):
            with self.assertRaises(RuntimeError) as ctx:
                await sendblue._call_orchestrator(
                    user_id="user-1",
                    conversation_id="conv-1",
                    turn_id="sms:message-1",
                    user_message_id="message-1",
                    user_message="How was my sleep this week?",
                    recent_messages=[],
                    media_urls=[],
                    timezone="America/New_York",
                )

        self.assertIsNotNone(factory.last_client)
        self.assertEqual(factory.last_client.timeout, sendblue.ORCHESTRATOR_TIMEOUT)
        self.assertIn("timed out after", str(ctx.exception))
        self.assertIn("/api/chat/sms", str(ctx.exception))

    async def test_call_orchestrator_returns_json_on_success(self):
        factory = _AsyncClientFactory(response=_FakeResponse(payload={"text": "Sleep looks steady."}))

        with patch("api.sendblue.httpx.AsyncClient", factory):
            result = await sendblue._call_orchestrator(
                user_id="user-1",
                conversation_id="conv-1",
                turn_id="sms:message-1",
                user_message_id="message-1",
                user_message="How was my sleep this week?",
                recent_messages=[],
                media_urls=[],
                timezone="America/New_York",
            )

        self.assertEqual(result, {"text": "Sleep looks steady."})
