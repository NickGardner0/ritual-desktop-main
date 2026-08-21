from __future__ import annotations

import asyncio
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.privacy_external_erasure import (
    build_external_erasure_plan,
    execute_external_erasure,
)
from services.privacy_policy import SENSITIVE_TINYBIRD_DATASOURCES


class FakeTinybird:
    def __init__(self):
        self.calls = []

    async def delete_by_condition(self, datasource, delete_condition, **kwargs):
        self.calls.append((datasource, delete_condition, kwargs))
        return {
            "success": True,
            "deleted_count": 3,
            "datasource": datasource,
        }


class PrivacyExternalErasureTests(unittest.TestCase):
    def test_plan_marks_manual_processors_without_claiming_deletion(self):
        plan = build_external_erasure_plan(
            "user-external",
            targets=["tinybird", "openpanel", "sentry"],
        )

        statuses = {item["target"]: item["status"] for item in plan["targets"]}
        self.assertEqual(statuses["tinybird"], "supported_by_api")
        self.assertEqual(statuses["openpanel"], "manual_required")
        self.assertEqual(statuses["sentry"], "manual_required")
        self.assertTrue(plan["requires_local_receipt"])

    def test_execute_mixed_external_erasure_receipts(self):
        fake_tinybird = FakeTinybird()

        with patch(
            "services.privacy_external_erasure.delete_private_sync_envelopes",
            new=lambda user_id: asyncio.sleep(0, result={
                "deleted_count": 2,
                "deletes_cloud_data": True,
            }),
        ):
            result = asyncio.run(execute_external_erasure(
                "user-external",
                targets=["private_sync_envelopes", "tinybird", "openpanel"],
                erasure_id="external-1",
                local_receipt_id="external-1",
                confirm_external_erasure=True,
                tinybird_service=fake_tinybird,
            ))

        self.assertEqual(
            result["deleted_count"],
            2 + (3 * len(SENSITIVE_TINYBIRD_DATASOURCES)),
        )
        self.assertEqual(result["manual_required_count"], 1)
        self.assertEqual(
            {call[0] for call in fake_tinybird.calls},
            set(SENSITIVE_TINYBIRD_DATASOURCES),
        )
        receipt_statuses = {item["target"]: item["status"] for item in result["targets"]}
        self.assertEqual(receipt_statuses["private_sync_envelopes"], "deleted")
        self.assertEqual(receipt_statuses["tinybird"], "completed")
        self.assertEqual(receipt_statuses["openpanel"], "manual_required")

    def test_execute_requires_confirmation(self):
        with self.assertRaisesRegex(ValueError, "explicit confirmation"):
            asyncio.run(execute_external_erasure(
                "user-external",
                targets=["tinybird"],
                erasure_id="external-1",
                local_receipt_id="external-1",
                confirm_external_erasure=False,
                tinybird_service=FakeTinybird(),
            ))


if __name__ == "__main__":
    unittest.main()
