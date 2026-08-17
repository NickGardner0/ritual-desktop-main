from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from services.wearables_unified.apple_ingest import WearableAppleIngestService


def _request(**overrides):
    values = {
        "device_id": "device-1",
        "client_event_id": "event-1",
        "captured_at": "2025-01-01T00:00:00Z",
        "signature": "signature",
        "metrics": [object()],
        "added": [object()],
        "deleted": [],
        "modified": [],
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class AppleIngestOutcomeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.security = SimpleNamespace(
            validate_signed_device_request=AsyncMock(
                return_value=SimpleNamespace(success=True, error=None)
            ),
            check_idempotency=AsyncMock(return_value=None),
            record_ingest_event=AsyncMock(),
        )
        self.sync = SimpleNamespace(
            backfill_legacy_apple_metrics=AsyncMock(),
            ingest_apple_metrics=AsyncMock(return_value=[("stored-1", "sample")]),
            delete_records_by_external_ids=AsyncMock(
                return_value={"samples": 1, "events": 0}
            ),
        )
        self.service = WearableAppleIngestService(
            device_security_service=self.security,
            sync_service=self.sync,
        )

    async def test_duplicate_is_successful_without_an_error_dialect(self):
        self.security.check_idempotency.return_value = object()

        result = await self.service.process_ingest_request("user-1", _request())

        self.assertEqual(result.outcome, "duplicate")
        self.assertTrue(result.success)
        self.assertIsNone(result.error)
        self.sync.ingest_apple_metrics.assert_not_awaited()
    async def test_validation_failure_is_typed_rejection(self):
        self.security.validate_signed_device_request.return_value = SimpleNamespace(
            success=False,
            error="Invalid signature",
        )

        result = await self.service.process_ingest_request("user-1", _request())

        self.assertEqual(result.outcome, "rejected")
        self.assertFalse(result.success)
        self.assertEqual(result.error_code, "invalid_signature")

    async def test_accepted_v1_result_is_not_positional(self):
        result = await self.service.process_ingest_request("user-1", _request())

        self.assertEqual(result.outcome, "accepted")
        self.assertTrue(result.success)
        self.assertEqual(result.results[0].stored_id, "stored-1")

    async def test_duplicate_v2_is_typed_and_does_not_upload(self):
        self.security.check_idempotency.return_value = object()

        result = await self.service.process_ingest_request_v2("user-1", _request())

        self.assertEqual(result.outcome, "duplicate")
        self.assertTrue(result.success)
        self.assertEqual(result.added_results, [])
        self.sync.ingest_apple_metrics.assert_not_awaited()
