"""Focused unit tests for wearable ingest job helpers."""

from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace

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

    def test_backfill_jobs_emit_completion_events(self):
        job = SimpleNamespace(job_type="provider_backfill")
        self.assertTrue(self.service._should_emit_completion_outbox_event(job))

    def test_raw_payload_replay_jobs_do_not_emit_completion_events(self):
        job = SimpleNamespace(job_type="raw_payload_replay")
        self.assertFalse(self.service._should_emit_completion_outbox_event(job))

    def test_completion_payload_includes_metric_scope(self):
        job = SimpleNamespace(
            id="job-1",
            provider="whoop",
            job_type="provider_backfill",
            metric_scope_json='{"metrics":["sleep_total"]}',
            start_date="2026-04-01",
            end_date="2026-04-07",
        )

        payload = self.service._build_completion_outbox_payload(job=job, result={"written": 12})

        self.assertEqual(payload["job_id"], "job-1")
        self.assertEqual(payload["metric_scope"], {"metrics": ["sleep_total"]})


if __name__ == "__main__":
    unittest.main()
