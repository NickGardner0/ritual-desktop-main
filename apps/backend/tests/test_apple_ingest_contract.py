import base64
import hashlib
import hmac
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from schemas.wearables_apple import AppleIngestRequestV2, AppleIngestResponseV2
from services.wearables_service import WearablesService


class AppleIngestContractTests(unittest.TestCase):
    def setUp(self):
        self.service = WearablesService()

    def test_v2_request_schema_accepts_ios_payload_shape(self):
        payload = {
            "device_id": "device-123",
            "client_event_id": "event-123",
            "captured_at": "2026-02-27T12:00:00Z",
            "added": [
                {
                    "source": "apple_health",
                    "metric_type": "steps",
                    "start_time": "2026-02-26T00:00:00Z",
                    "end_time": "2026-02-27T00:00:00Z",
                    "value": 9876,
                    "unit": "count",
                    "external_id": "daily_steps_2026-02-26",
                    "attributed_date": "2026-02-26",
                    "source_bundle_id": "com.apple.health.aggregated",
                    "source_device_name": "Apple Health (Daily)",
                }
            ],
            "deleted": [],
            "modified": [],
            "anchors": {"steps": "anchor-token-base64"},
            "schema_version": 2,
            "signature": "dummy-signature",
        }

        request = AppleIngestRequestV2(**payload)

        self.assertEqual(request.device_id, "device-123")
        self.assertEqual(request.schema_version, 2)
        self.assertEqual(len(request.added), 1)
        self.assertEqual(request.anchors["steps"], "anchor-token-base64")

    def test_signature_canonical_contract_matches_ios(self):
        canonical = self.service.build_canonical_string(
            device_id="abc-device",
            client_event_id="abc-event",
            captured_at="2026-02-27T12:34:56Z",
        )
        self.assertEqual(canonical, "abc-device\nabc-event\n2026-02-27T12:34:56Z")

    def test_signature_verification_matches_hmac_sha256_contract(self):
        secret_bytes = b"0123456789abcdef0123456789abcdef"
        secret_b64 = base64.b64encode(secret_bytes).decode("utf-8")
        canonical = "device-1\nevent-1\n2026-02-27T13:00:00Z"

        expected = hmac.new(
            secret_bytes,
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        expected_signature = base64.b64encode(expected).decode("utf-8")

        self.assertTrue(
            self.service.verify_signature(
                device_secret=secret_b64,
                canonical_string=canonical,
                provided_signature=expected_signature,
            )
        )
        self.assertFalse(
            self.service.verify_signature(
                device_secret=secret_b64,
                canonical_string=canonical,
                provided_signature=expected_signature + "tampered",
            )
        )

    def test_anchor_confirmation_response_contract(self):
        response = AppleIngestResponseV2(
            success=True,
            added_results=[],
            deleted_results=[],
            modified_results=[],
            server_time="2026-02-27T13:15:00Z",
            next_poll_seconds=60,
            confirmed_anchors={"steps": "token-1", "hrv": "token-2"},
        )

        self.assertEqual(response.confirmed_anchors["steps"], "token-1")
        self.assertEqual(response.confirmed_anchors["hrv"], "token-2")


if __name__ == "__main__":
    unittest.main()
