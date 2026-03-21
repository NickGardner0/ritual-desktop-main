import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from schemas.screen_time import ScreenTimeIngestRequest
from services.screen_time_service import DOMAIN_DISCLOSURE


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


if __name__ == "__main__":
    unittest.main()
