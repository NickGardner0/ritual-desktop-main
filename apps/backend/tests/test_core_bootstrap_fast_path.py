from __future__ import annotations

from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import BackgroundTasks, Response
from starlette.requests import Request


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.core import create_core_router  # noqa: E402
from database.models import UserActivationStateDB, UserDB  # noqa: E402


class _Limiter:
    def limit(self, _value):
        return lambda function: function


class _UserService:
    def __init__(self):
        self.calls = []

    async def ensure_user_exists(self, **kwargs):
        self.calls.append(kwargs)
        user = UserDB(
            id=kwargs["user_id"],
            email=kwargs["email"],
            full_name="Test User",
            timezone=None,
            onboarding_completed=False,
        )
        user._ritual_created = True
        user._ritual_initial_activation_state = UserActivationStateDB(
            user_id=user.id,
        )
        return user


class CoreBootstrapFastPathTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_user_returns_without_waiting_for_existing_user_queries(self):
        user_service = _UserService()

        async def get_current_user():
            return {
                "id": "new-user",
                "email": "test@example.com",
                "name": "Test User",
                "phone": None,
            }

        router = create_core_router(
            limiter=_Limiter(),
            get_current_user=get_current_user,
            user_service=user_service,
            habits_service=object(),
            tinybird_service=object(),
        )
        endpoint = next(
            route.endpoint
            for route in router.routes
            if route.path == "/api/user/bootstrap"
        )
        request = Request({
            "type": "http",
            "method": "GET",
            "path": "/api/user/bootstrap",
            "headers": [],
        })
        response = Response()
        background_tasks = BackgroundTasks()
        current_user = await get_current_user()

        with patch(
            "api.core.activation_service.get_bootstrap",
            new=AsyncMock(),
        ) as existing_bootstrap:
            bootstrap = await endpoint(
                request,
                response,
                background_tasks,
                current_user,
            )

        existing_bootstrap.assert_not_awaited()
        self.assertEqual(bootstrap.nextRoute, "/onboarding?s=signup")
        self.assertEqual(response.headers["x-ritual-bootstrap-mode"], "created")
        self.assertIn("identity;dur=", response.headers["server-timing"])
        self.assertEqual(len(background_tasks.tasks), 1)
        self.assertFalse(user_service.calls[0]["send_welcome_sms"])


if __name__ == "__main__":
    unittest.main()
