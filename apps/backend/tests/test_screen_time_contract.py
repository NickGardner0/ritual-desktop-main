import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from schemas.screen_time import ScreenTimeIngestRequest
from services.screen_time_service import DOMAIN_DISCLOSURE, ScreenTimeService


class ScreenTimeContractTests(unittest.TestCase):
    def test_screen_time_ingest_request_accepts_daily_rollups(self):
        payload = {
            "device_id": "screen-time-device-1",
            "client_event_id": "event-1",
            "captured_at": "2026-03-12T10:00:00Z",
            "rollups": [
                {
                    "day": "2026-03-12",
                    "timezone": "America/New_York",
                    "breakdown_kind": "total",
                    "entity_key": "__total__",
                    "entity_label": "Total Screen Time",
                    "active_seconds": 14220,
                    "sort_seconds": 14220,
                    "metadata_json": {"source": "screen_time"},
                },
                {
                    "day": "2026-03-12",
                    "timezone": "America/New_York",
                    "breakdown_kind": "app",
                    "entity_key": "com.apple.mobilesafari",
                    "entity_label": "Safari",
                    "active_seconds": 3600,
                    "sort_seconds": 3600,
                    "metadata_json": None,
                },
            ],
            "schema_version": 1,
            "signature": "dummy-signature",
        }

        request = ScreenTimeIngestRequest(**payload)

        self.assertEqual(request.device_id, "screen-time-device-1")
        self.assertEqual(len(request.rollups), 2)
        self.assertEqual(request.rollups[0].breakdown_kind.value, "total")
        self.assertEqual(request.rollups[1].entity_label, "Safari")

    def test_domain_disclosure_copy_mentions_apple_exposed_domains(self):
        self.assertIn("Apple exposes", DOMAIN_DISCLOSURE)


class ScreenTimeBiomeTests(unittest.IsolatedAsyncioTestCase):
    async def test_summary_prefers_biome_activity_snapshot(self):
        service = ScreenTimeService()
        with patch.object(service, "list_devices", AsyncMock(return_value=[])), patch.object(
            service,
            "_get_biome_snapshot",
            AsyncMock(
                return_value={
                    "summary": {"total_active_ms": 3_600_000, "total_events": 4},
                    "daily": [{"day": "2026-05-01", "active_ms": 3_600_000}],
                    "domains": [],
                }
            ),
        ):
            summary = await service.get_summary("user-1", "2026-05-01", "2026-05-01")

        self.assertEqual(summary["source"], "biome_iphone")
        self.assertEqual(summary["total_active_ms"], 3_600_000)
        self.assertTrue(summary["is_connected"])

    async def test_top_apps_reads_biome_snapshot_rows_first(self):
        service = ScreenTimeService()
        with patch.object(
            service,
            "_get_biome_snapshot",
            AsyncMock(
                return_value={
                    "apps": [
                        {
                            "app_bundle_id": "com.apple.MobileSMS",
                            "app_name": "Messages",
                            "total_active_ms": 120_000,
                            "total_events": 2,
                            "days_used": 1,
                        }
                    ]
                }
            ),
        ):
            rows = await service.get_top_items(
                "user-1",
                "2026-05-01",
                "2026-05-01",
                kind="app",
                limit=10,
            )

        self.assertEqual(rows[0]["app_bundle_id"], "com.apple.MobileSMS")
        self.assertEqual(rows[0]["source"], "biome_iphone")


if __name__ == "__main__":
    unittest.main()
