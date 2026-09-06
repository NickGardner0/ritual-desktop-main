import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services.auth_service import AuthService


class AuthServiceTests(unittest.IsolatedAsyncioTestCase):
    def build_service(self) -> AuthService:
        with patch.dict(
            os.environ,
            {
                "CLERK_JWKS_URL": "https://clerk.ritualdb.com/.well-known/jwks.json",
                "CLERK_ISSUER": "https://clerk.ritualdb.com",
                "CLERK_AUTHORIZED_PARTIES": "https://desktop.ritualdb.com,http://localhost:3000",
            },
            clear=False,
        ):
            return AuthService()

    async def test_verified_session_enforces_issuer_and_authorized_party(self):
        service = self.build_service()
        service.jwks_client = Mock()
        service.jwks_client.get_signing_key_from_jwt.return_value = SimpleNamespace(key="public-key")
        service._fetch_user_info_from_clerk = AsyncMock(return_value={"email": "user@example.com", "phone": None})
        payload = {
            "sub": "user-1",
            "iss": "https://clerk.ritualdb.com",
            "azp": "https://desktop.ritualdb.com",
            "exp": 2_000_000_000,
            "iat": 1_999_999_000,
        }

        with patch("services.auth_service.jwt.decode", return_value=payload) as decode:
            user = await service.get_user_from_token("session-token")

        self.assertEqual(user["id"], "user-1")
        _, kwargs = decode.call_args
        self.assertEqual(kwargs["issuer"], "https://clerk.ritualdb.com")
        self.assertEqual(kwargs["algorithms"], ["RS256"])
        self.assertTrue(kwargs["options"]["verify_nbf"])
        self.assertIn("sub", kwargs["options"]["require"])

    async def test_rejects_token_from_unauthorized_party(self):
        service = self.build_service()
        service.jwks_client = Mock()
        service.jwks_client.get_signing_key_from_jwt.return_value = SimpleNamespace(key="public-key")
        payload = {
            "sub": "user-1",
            "iss": "https://clerk.ritualdb.com",
            "azp": "https://attacker.example",
            "exp": 2_000_000_000,
            "iat": 1_999_999_000,
        }

        with patch("services.auth_service.jwt.decode", return_value=payload):
            user = await service.get_user_from_token("session-token")

        self.assertIsNone(user)

    async def test_rejects_pending_clerk_session(self):
        service = self.build_service()
        service.jwks_client = Mock()
        service.jwks_client.get_signing_key_from_jwt.return_value = SimpleNamespace(key="public-key")
        payload = {
            "sub": "user-1",
            "iss": "https://clerk.ritualdb.com",
            "azp": "https://desktop.ritualdb.com",
            "sts": "pending",
            "exp": 2_000_000_000,
            "iat": 1_999_999_000,
        }

        with patch("services.auth_service.jwt.decode", return_value=payload):
            user = await service.get_user_from_token("session-token")

        self.assertIsNone(user)
