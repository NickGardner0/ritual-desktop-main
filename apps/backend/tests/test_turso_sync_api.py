import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api.core import create_core_router
from services.turso_user_service import DesktopSyncConfig, TursoProvisioningError


class _NoopLimiter:
    def limit(self, _rule):
        def decorator(fn):
            return fn

        return decorator


class _StubUserService:
    async def ensure_user_exists(self, **kwargs):
        return SimpleNamespace(
            id=kwargs["user_id"],
            email=kwargs.get("email") or "",
            full_name=kwargs.get("full_name"),
        )


class _StubHabitsService:
    pass


async def _get_current_user():
    return {
        "id": "user-1",
        "email": "user@example.com",
        "name": "User One",
        "phone": None,
    }


class TursoSyncApiTests(unittest.TestCase):
    plaintext_sync_headers = {
        "x-ritual-privacy-mode": "cloud_intelligence",
        "x-ritual-cloud-consents": "plaintext_sync",
    }

    def _build_client(self) -> TestClient:
        app = FastAPI()
        app.include_router(
            create_core_router(
                limiter=_NoopLimiter(),
                get_current_user=_get_current_user,
                user_service=_StubUserService(),
                habits_service=_StubHabitsService(),
                tinybird_service=None,
            )
        )
        return TestClient(app)

    def test_turso_sync_config_returns_scoped_shape_without_leaking_server_tokens(self):
        client = self._build_client()
        with patch(
            "api.core.turso_user_service.get_desktop_sync_config",
            AsyncMock(
                return_value=DesktopSyncConfig(
                    sync_url="libsql://ritual-user-1.turso.io",
                    auth_token="scoped-token",
                    expires_at="2026-03-27T12:00:00+00:00",
                    database_name="ritual-user-1",
                )
            ),
        ):
            response = client.get(
                "/api/user/turso-sync-config",
                headers=self.plaintext_sync_headers,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "sync_url": "libsql://ritual-user-1.turso.io",
                "auth_token": "scoped-token",
                "expires_at": "2026-03-27T12:00:00+00:00",
                "database_name": "ritual-user-1",
            },
        )
        self.assertNotIn("DATABASE_URL", response.text)
        self.assertNotIn("TURSO_PLATFORM_API_TOKEN", response.text)
        self.assertNotIn("admin", response.text.lower())

    def test_turso_sync_config_blocks_plaintext_sync_without_privacy_consent(self):
        client = self._build_client()

        response = client.get("/api/user/turso-sync-config")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["privacy_blocked"], True)
        self.assertEqual(response.json()["detail"]["required_consent"], "plaintext_sync")

    def test_turso_sync_config_maps_pending_migration_to_conflict(self):
        client = self._build_client()
        with patch(
            "api.core.turso_user_service.get_desktop_sync_config",
            AsyncMock(
                side_effect=TursoProvisioningError(
                    "Per-user Turso migration has not completed yet"
                )
            ),
        ):
            response = client.get(
                "/api/user/turso-sync-config",
                headers=self.plaintext_sync_headers,
            )

        self.assertEqual(response.status_code, 409)
        self.assertIn("migration", response.json()["detail"].lower())
