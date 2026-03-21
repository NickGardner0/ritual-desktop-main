import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydantic import ValidationError

from schemas.biometrics import HeartRateSampleBatchIn, HeartRateSessionCreate
from services.biometrics_service import BiometricsService, STALE_AFTER_SECONDS


class BiometricsContractTests(unittest.TestCase):
    def test_batch_schema_accepts_valid_heart_rate_payload(self):
        payload = {
            "samples": [
                {
                    "id": "sample-1",
                    "session_id": "session-1",
                    "source_type": "whoop_ble_ios",
                    "source_device_id": "iphone-1",
                    "bpm_raw": 74,
                    "bpm_display": 73,
                    "quality_score": 0.92,
                    "is_outlier": False,
                    "rr_intervals_ms": [812.5, 807.2],
                    "contact_detected": True,
                    "received_at": "2026-03-15T23:10:05Z",
                }
            ]
        }

        request = HeartRateSampleBatchIn(**payload)

        self.assertEqual(len(request.samples), 1)
        self.assertEqual(request.samples[0].source_type.value, "whoop_ble_ios")
        self.assertEqual(request.samples[0].bpm_raw, 74)
        self.assertEqual(request.samples[0].rr_intervals_ms, [812.5, 807.2])

    def test_session_schema_rejects_unknown_source_type(self):
        with self.assertRaises(ValidationError):
            HeartRateSessionCreate(
                source_type="unknown_ble_source",
                source_device_id="device-1",
                started_at="2026-03-15T23:10:05Z",
            )

    def test_live_snapshot_becomes_stale_after_threshold(self):
        service = BiometricsService()
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        stale_row = SimpleNamespace(
            current_bpm=71,
            current_source_type="whoop_ble_ios",
            latest_sample_at=now - timedelta(seconds=STALE_AFTER_SECONDS + 5),
            connection_state="receiving",
        )
        fresh_row = SimpleNamespace(
            current_bpm=71,
            current_source_type="whoop_ble_ios",
            latest_sample_at=now - timedelta(seconds=5),
            connection_state="receiving",
        )

        stale = service._serialize_live(stale_row)
        fresh = service._serialize_live(fresh_row)

        self.assertTrue(stale.is_stale)
        self.assertEqual(stale.connection_state, "stale")
        self.assertFalse(fresh.is_stale)
        self.assertEqual(fresh.connection_state, "receiving")


if __name__ == "__main__":
    unittest.main()
