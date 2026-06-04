from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.wearable_provider_strategies import (  # noqa: E402
    PROVIDER_STRATEGIES,
    ProviderStrategyContext,
    list_provider_strategies,
    sync_provider_with_strategy,
)


class WearableProviderStrategyTests(unittest.IsolatedAsyncioTestCase):
    def test_provider_strategies_advertise_explicit_capabilities(self):
        self.assertEqual(list_provider_strategies(), ["garmin", "oura", "whoop"])
        self.assertTrue(PROVIDER_STRATEGIES["whoop"].capabilities.supports_backfill)
        self.assertEqual(PROVIDER_STRATEGIES["oura"].capabilities.auth_type, "oauth")
        self.assertTrue(PROVIDER_STRATEGIES["garmin"].capabilities.supports_webhook)
        self.assertIn(
            "sleep_total",
            PROVIDER_STRATEGIES["whoop"].capabilities.supported_metrics,
        )

    async def test_whoop_strategy_surfaces_partial_post_ingest_failure(self):
        class FakeWhoop:
            async def fetch_whoop_sync_payload(self, *_args, **_kwargs):
                return {"payload": True}

            async def write_whoop_sync_payload(self, *_args, **_kwargs):
                return {
                    "status": "partial",
                    "data": {"sleep": 1},
                    "canonical_sync_error": "fact rebuild failed",
                }

        result = await PROVIDER_STRATEGIES["whoop"].sync(
            ProviderStrategyContext(
                user_id="user_1",
                services=SimpleNamespace(whoop_service=FakeWhoop()),
            )
        )

        self.assertEqual(result.status, "partial")
        self.assertEqual(result.items_seen, 1)
        self.assertEqual(result.items_written, 1)
        self.assertEqual(result.error, {"message": "fact rebuild failed"})

    async def test_oura_strategy_uses_fetch_then_canonical_write(self):
        class FakeOura:
            def __init__(self):
                self.payload = {"start_date": "2026-06-01", "end_date": "2026-06-02"}
                self.writes = []

            async def fetch_oura_sync_payload(self, user_id, *, days_back=None, force_full_sync=False):
                assert user_id == "user_1"
                assert days_back == 7
                assert force_full_sync is True
                return self.payload

            async def write_oura_sync_payload(self, user_id, payload):
                self.writes.append((user_id, payload))
                return {"samples": 2, "events": 3, "post_ingest_success": True}

        fake_oura = FakeOura()
        result = await sync_provider_with_strategy(
            provider="oura",
            user_id="user_1",
            services=SimpleNamespace(oura_service=fake_oura),
            days_back=7,
            force_full_sync=True,
        )

        self.assertEqual(result.status, "success")
        self.assertEqual(result.items_seen, 5)
        self.assertEqual(result.items_written, 5)
        self.assertEqual(
            fake_oura.writes,
            [("user_1", {**fake_oura.payload, "provider": "oura"})],
        )

    async def test_garmin_strategy_refreshes_account_and_marks_webhook_driven(self):
        class FakeGarmin:
            def __init__(self):
                self.writes = []

            async def fetch_garmin_account_payload(self, user_id):
                assert user_id == "user_1"
                return {"provider_user_id": "garmin-user", "permissions": {"steps": True}}

            async def write_garmin_account_payload(self, user_id, payload):
                self.writes.append((user_id, payload))

        fake_garmin = FakeGarmin()
        result = await sync_provider_with_strategy(
            provider="garmin",
            user_id="user_1",
            services=SimpleNamespace(garmin_service=fake_garmin),
        )

        self.assertEqual(result.status, "success")
        self.assertEqual(result.items_seen, 1)
        self.assertTrue(result.data["data"]["webhook_driven"])
        self.assertEqual(fake_garmin.writes[0][1]["provider_user_id"], "garmin-user")
        self.assertEqual(fake_garmin.writes[0][1]["provider"], "garmin")

    async def test_whoop_strategy_returns_retryable_failure_for_timeout(self):
        class TimeoutWhoop:
            async def fetch_whoop_sync_payload(self, *_args, **_kwargs):
                raise TimeoutError("Provider request timed out")

        result = await PROVIDER_STRATEGIES["whoop"].sync(
            ProviderStrategyContext(
                user_id="user_1",
                services=SimpleNamespace(whoop_service=TimeoutWhoop()),
            )
        )

        self.assertEqual(result.status, "retryable_failed")
        self.assertEqual(result.items_seen, 0)
        self.assertEqual(result.items_written, 0)
        self.assertTrue(result.error["retryable"])
        self.assertIn("timed out", result.error["message"])

    async def test_oura_strategy_returns_terminal_failure_for_auth_error(self):
        class AuthOura:
            async def fetch_oura_sync_payload(self, *_args, **_kwargs):
                raise ValueError("Unauthorized: invalid token")

        result = await PROVIDER_STRATEGIES["oura"].sync(
            ProviderStrategyContext(
                user_id="user_1",
                services=SimpleNamespace(oura_service=AuthOura()),
            )
        )

        self.assertEqual(result.status, "terminal_failed")
        self.assertFalse(result.error["retryable"])
        self.assertIn("invalid token", result.error["message"])

    async def test_garmin_strategy_returns_retryable_failure_for_5xx(self):
        class UnavailableGarmin:
            async def fetch_garmin_account_payload(self, *_args, **_kwargs):
                raise RuntimeError("service unavailable")

        result = await PROVIDER_STRATEGIES["garmin"].sync(
            ProviderStrategyContext(
                user_id="user_1",
                services=SimpleNamespace(garmin_service=UnavailableGarmin()),
            )
        )

        self.assertEqual(result.status, "retryable_failed")
        self.assertTrue(result.error["retryable"])

    async def test_unknown_strategy_is_rejected(self):
        with self.assertRaises(ValueError):
            await sync_provider_with_strategy(
                provider="fitbit",
                user_id="user_1",
                services=SimpleNamespace(),
            )


if __name__ == "__main__":
    unittest.main()
