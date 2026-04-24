"""Focused unit tests for wearable ingest job helpers."""

from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.wearable_ingest_job_service import WearableIngestJobService


class WearableIngestJobServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = WearableIngestJobService()

    def test_idempotency_key_is_stable_for_equivalent_metric_scope(self):
        left = self.service._idempotency_key(
            provider="whoop",
            user_id="user-1",
            job_type="provider_backfill",
            metric_scope={"metrics": ["sleep_total", "hrv"], "full_history": True},
            start_date="2026-01-01",
            end_date="2026-01-31",
            payload=None,
        )
        right = self.service._idempotency_key(
            provider="whoop",
            user_id="user-1",
            job_type="provider_backfill",
            metric_scope={"full_history": True, "metrics": ["sleep_total", "hrv"]},
            start_date="2026-01-01",
            end_date="2026-01-31",
            payload=None,
        )

        self.assertEqual(left, right)

    def test_days_back_is_inclusive(self):
        self.assertEqual(self.service._days_back("2026-04-01", "2026-04-03"), 3)
        self.assertEqual(self.service._days_back("2026-04-01", "2026-04-01"), 1)


if __name__ == "__main__":
    unittest.main()
