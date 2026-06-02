from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.wearable_provider_sync_registry import (  # noqa: E402
    WearableProviderSyncServices,
    list_provider_sync_adapters,
    sync_wearable_provider_account,
)


class FakeWhoopService:
    def __init__(self):
        self.fetch_calls = []
        self.write_calls = []

    async def fetch_whoop_sync_payload(self, user_id, days_back=None, force_full_sync=False, full_history=False):
        payload = {
            "user_id": user_id,
            "days_back": days_back,
            "force_full_sync": force_full_sync,
            "full_history": full_history,
        }
        self.fetch_calls.append(payload)
        return payload

    async def write_whoop_sync_payload(self, user_id, payload):
        self.write_calls.append({"user_id": user_id, "payload": payload})
        return {
            "user_id": user_id,
            "days_back": payload["days_back"],
            "force_full_sync": payload["force_full_sync"],
            "full_history": payload["full_history"],
            "data": {"sleep": 2, "recovery": 1, "workouts": 3},
        }


class FakeOuraService:
    def __init__(self):
        self.fetch_calls = []
        self.write_calls = []

    async def fetch_oura_sync_payload(self, user_id, days_back=None, force_full_sync=False):
        self.fetch_calls.append(
            {
                "user_id": user_id,
                "days_back": days_back,
                "force_full_sync": force_full_sync,
            }
        )
        return {
            "start_date": "2026-06-01",
            "end_date": "2026-06-02",
            "records": ["sample"],
        }

    async def write_oura_sync_payload(self, user_id, payload):
        self.write_calls.append({"user_id": user_id, "payload": payload})
        return {"samples": 4, "events": 2, "post_ingest_success": True}


class FakeGarminService:
    def __init__(self):
        self.fetch_calls = []
        self.write_calls = []

    async def fetch_garmin_account_payload(self, user_id):
        self.fetch_calls.append({"user_id": user_id})
        return {"provider_user_id": "garmin-user", "permissions": {"activity": True}}

    async def write_garmin_account_payload(self, user_id, payload):
        self.write_calls.append({"user_id": user_id, "payload": payload})


class WearableProviderSyncRegistryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.services = WearableProviderSyncServices(
            whoop_service=FakeWhoopService(),
            oura_service=FakeOuraService(),
            garmin_service=FakeGarminService(),
        )

    async def test_whoop_sync_uses_shared_result_contract(self):
        result = await sync_wearable_provider_account(
            provider="whoop",
            user_id="user-1",
            services=self.services,
            days_back=7,
            force_full_sync=True,
        )

        self.assertEqual(result.status, "success")
        self.assertEqual(result.items_seen, 6)
        self.assertEqual(result.items_written, 6)
        self.assertEqual(result.data["days_back"], 7)
        self.assertTrue(result.data["force_full_sync"])
        self.assertEqual(self.services.whoop_service.write_calls[0]["user_id"], "user-1")

    async def test_whoop_sync_propagates_full_history_backfill_flag(self):
        result = await sync_wearable_provider_account(
            provider="whoop",
            user_id="user-1",
            services=self.services,
            force_full_sync=True,
            full_history=True,
        )

        self.assertTrue(result.data["full_history"])
        self.assertTrue(self.services.whoop_service.fetch_calls[-1]["full_history"])

    async def test_cloud_provider_adapters_are_registered_explicitly(self):
        self.assertEqual(list_provider_sync_adapters(), ["garmin", "oura", "whoop"])

    async def test_oura_sync_counts_samples_and_events(self):
        result = await sync_wearable_provider_account(
            provider="oura",
            user_id="user-1",
            services=self.services,
        )

        self.assertEqual(result.items_seen, 6)
        self.assertEqual(result.message, "Oura sync completed.")
        self.assertEqual(self.services.oura_service.fetch_calls[0]["user_id"], "user-1")
        self.assertEqual(self.services.oura_service.write_calls[0]["payload"]["records"], ["sample"])

    async def test_garmin_sync_models_webhook_driven_ingest(self):
        result = await sync_wearable_provider_account(
            provider="garmin",
            user_id="user-1",
            services=self.services,
        )

        self.assertEqual(result.items_seen, 1)
        self.assertIn("webhook-driven", result.message)
        self.assertEqual(self.services.garmin_service.fetch_calls[0]["user_id"], "user-1")
        self.assertEqual(
            self.services.garmin_service.write_calls[0]["payload"]["provider_user_id"],
            "garmin-user",
        )

    async def test_apple_health_sync_is_device_managed(self):
        result = await sync_wearable_provider_account(
            provider="apple_health",
            user_id="user-1",
            services=self.services,
        )

        self.assertEqual(result.status, "success")
        self.assertEqual(result.items_seen, 0)
        self.assertIn("iOS companion", result.message)

    async def test_unsupported_provider_can_be_partial_or_strict(self):
        partial = await sync_wearable_provider_account(
            provider="fitbit",
            user_id="user-1",
            services=self.services,
        )
        self.assertEqual(partial.status, "partial")
        self.assertIsNotNone(partial.error)

        with self.assertRaises(ValueError):
            await sync_wearable_provider_account(
                provider="fitbit",
                user_id="user-1",
                services=self.services,
                unsupported_as_partial=False,
            )


if __name__ == "__main__":
    unittest.main()
