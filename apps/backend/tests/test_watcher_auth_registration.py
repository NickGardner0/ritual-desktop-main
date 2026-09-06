"""Regression coverage for watcher routes using canonical application auth."""

from __future__ import annotations

import os
import pathlib
import sys
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DATABASE_URL", "sqlite:///watcher-auth-test.db")
os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from api.watcher import include_watcher_router  # noqa: E402
from api.watcher_common import get_current_user as watcher_auth_dependency  # noqa: E402


class WatcherAuthRegistrationTests(unittest.TestCase):
    def test_watcher_routes_use_canonical_auth_dependency(self):
        app = FastAPI()
        authenticated_tokens = []

        async def canonical_auth(request, credentials):
            authenticated_tokens.append(credentials.credentials)
            return {"id": "user-1", "email": "user@example.com"}

        include_watcher_router(app, get_current_user=canonical_auth)

        self.assertIn(watcher_auth_dependency, app.dependency_overrides)
        with patch(
            "api.watcher_devices.watcher_service.get_user_devices",
            AsyncMock(return_value=[]),
        ):
            response = TestClient(app).get(
                "/api/watcher/devices",
                headers={"Authorization": "Bearer test-token"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"devices": []})
        self.assertEqual(authenticated_tokens, ["test-token"])

    def test_watcher_routes_preserve_internal_service_auth(self):
        app = FastAPI()
        canonical_auth_calls = []

        async def canonical_auth(request, credentials):
            canonical_auth_calls.append(credentials.credentials)
            return {"id": "unexpected", "email": None}

        include_watcher_router(app, get_current_user=canonical_auth)

        with patch.dict(os.environ, {"INTERNAL_API_KEY": "test-internal-key"}), patch(
            "api.watcher_devices.watcher_service.get_user_devices",
            AsyncMock(return_value=[]),
        ) as list_devices:
            response = TestClient(app).get(
                "/api/watcher/devices",
                headers={
                    "X-User-ID": "internal-user",
                    "X-Internal-Key": "test-internal-key",
                },
            )

        self.assertEqual(response.status_code, 200)
        list_devices.assert_awaited_once_with("internal-user")
        self.assertEqual(canonical_auth_calls, [])


if __name__ == "__main__":
    unittest.main()
