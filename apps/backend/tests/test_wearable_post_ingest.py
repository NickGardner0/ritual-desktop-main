"""Tests for the shared wearable post-ingest boundary."""

from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.wearables_unified.post_ingest import WearablePostIngestResult, WearablePostIngestService
from services.wearables_unified.sync_garmin import WearableGarminSyncMixin
from services.wearables_unified.sync_oura import WearableOuraSyncMixin
from services.wearables_unified.sync_whoop import WearableWhoopSyncMixin


class WearablePostIngestTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_affected_dates_skip_metric_fact_rebuild(self):
        rebuild = AsyncMock(return_value={"success": True})
        fake_metric_facts_module = SimpleNamespace(
            metric_fact_service=SimpleNamespace(rebuild_facts=rebuild)
        )

        with patch.dict(sys.modules, {"services.metric_facts_service": fake_metric_facts_module}):
            result = await WearablePostIngestService().run_for_provider_dates(
                user_id="user_1",
                provider="whoop",
                affected_dates=[],
                projected_records=0,
            )

        self.assertTrue(result.success)
        self.assertEqual(result.affected_dates, [])
        self.assertEqual(result.metric_facts, {"success": True, "reason": "no_affected_dates"})
        rebuild.assert_not_awaited()

    async def test_affected_dates_rebuild_metric_facts_once_for_date_window(self):
        rebuild = AsyncMock(return_value={"success": True, "facts_written": 2})
        fake_metric_facts_module = SimpleNamespace(
            metric_fact_service=SimpleNamespace(rebuild_facts=rebuild)
        )

        with patch.dict(sys.modules, {"services.metric_facts_service": fake_metric_facts_module}):
            result = await WearablePostIngestService().run_for_provider_dates(
                user_id="user_1",
                provider="whoop",
                affected_dates=[
                    "2026-06-02T08:00:00Z",
                    "2026-06-01",
                    "2026-06-02",
                    None,
                ],
                projected_records=3,
            )

        self.assertTrue(result.success)
        self.assertEqual(result.affected_dates, ["2026-06-01", "2026-06-02"])
        self.assertEqual(result.projected_records, 3)
        self.assertEqual(result.metric_facts, {"success": True, "facts_written": 2})
        rebuild.assert_awaited_once_with(
            user_id="user_1",
            start_date="2026-06-01",
            end_date="2026-06-02",
            apply=True,
        )

    async def test_metric_fact_rebuild_failure_is_reported_as_post_ingest_failure(self):
        rebuild = AsyncMock(side_effect=RuntimeError("fact rebuild failed"))
        fake_metric_facts_module = SimpleNamespace(
            metric_fact_service=SimpleNamespace(rebuild_facts=rebuild)
        )

        with patch.dict(sys.modules, {"services.metric_facts_service": fake_metric_facts_module}):
            result = await WearablePostIngestService().run_for_provider_dates(
                user_id="user_1",
                provider="whoop",
                affected_dates=["2026-06-02"],
                projected_records=1,
            )

        self.assertFalse(result.success)
        self.assertEqual(result.error, "fact rebuild failed")
        self.assertIsNone(result.metric_facts)


class _FakeConnectionService:
    async def get_or_create_connection(self, **_kwargs):
        return SimpleNamespace(id="connection_1")


class _FakePostIngestService:
    def __init__(self, result: WearablePostIngestResult):
        self.result = result
        self.calls = []

    async def run_for_provider_dates(self, **kwargs):
        self.calls.append(kwargs)
        return self.result


class _FakeWhoopSyncService(WearableWhoopSyncMixin):
    def __init__(self, post_ingest_result: WearablePostIngestResult):
        self.connection_service = _FakeConnectionService()
        self.post_ingest_service = _FakePostIngestService(post_ingest_result)
        self.update_connection_sync_state_calls = []
        self.events = []

    async def upsert_source(self, **_kwargs):
        return SimpleNamespace(id="source_1")

    async def store_raw_payload(self, **_kwargs):
        return SimpleNamespace(id="payload_1")

    async def _upsert_event(self, **kwargs):
        self.events.append(kwargs)
        return ("event_1", True)

    async def _project_and_emit_event(self, **_kwargs):
        return None

    async def update_connection_sync_state(self, **kwargs):
        self.update_connection_sync_state_calls.append(kwargs)

    def _duration_to_minutes(self, value):
        if value in (None, ""):
            return None
        return float(value) / 60.0


class _FakeNormalization:
    def canonicalize_metric_type(self, _provider, provider_metric_type):
        return provider_metric_type


class _FakeOuraSyncService(WearableOuraSyncMixin):
    def __init__(self, post_ingest_result: WearablePostIngestResult):
        self.connection_service = _FakeConnectionService()
        self.post_ingest_service = _FakePostIngestService(post_ingest_result)
        self.normalization = _FakeNormalization()
        self.update_connection_sync_state_calls = []
        self.samples = []

    async def upsert_source(self, **_kwargs):
        return SimpleNamespace(id="source_1")

    async def store_raw_payload(self, **_kwargs):
        return SimpleNamespace(id="payload_1")

    async def _upsert_sample(self, **kwargs):
        self.samples.append(kwargs)
        return ("sample_1", True)

    async def _project_and_emit_sample(self, **_kwargs):
        return None

    async def update_connection_sync_state(self, **kwargs):
        self.update_connection_sync_state_calls.append(kwargs)

    def _duration_to_minutes(self, value):
        if value in (None, ""):
            return None
        return float(value) / 60.0


class _FakeGarminSyncService(WearableGarminSyncMixin):
    def __init__(self, post_ingest_result: WearablePostIngestResult):
        self.connection_service = _FakeConnectionService()
        self.post_ingest_service = _FakePostIngestService(post_ingest_result)
        self.normalization = _FakeNormalization()
        self.update_connection_sync_state_calls = []
        self.samples = []

    async def upsert_source(self, **_kwargs):
        return SimpleNamespace(id="source_1")

    async def store_raw_payload(self, **_kwargs):
        return SimpleNamespace(id="payload_1")

    async def _upsert_sample(self, **kwargs):
        self.samples.append(kwargs)
        return ("sample_1", True)

    async def _project_and_emit_sample(self, **_kwargs):
        return None

    async def update_connection_sync_state(self, **kwargs):
        self.update_connection_sync_state_calls.append(kwargs)

    def _extract_collection(self, payload, *keys):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return value
        return []

    def _extract_date_value(self, record):
        return record.get("calendarDate") or record.get("date")

    def _get_first(self, record, *keys, default=None):
        for key in keys:
            value = record.get(key)
            if value not in (None, ""):
                return value
        return default


def _whoop_sleep_payload():
    return {
        "records": [
            {
                "id": "sleep_1",
                "cycle_id": "cycle_1",
                "start": "2026-06-01T23:00:00Z",
                "end": "2026-06-02T07:00:00Z",
                "score": {
                    "stage_summary": {
                        "total_rem_sleep_time_milli": 90 * 60_000,
                        "total_slow_wave_sleep_time_milli": 60 * 60_000,
                        "total_light_sleep_time_milli": 240 * 60_000,
                    }
                },
            }
        ]
    }


class WhoopPostIngestRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_whoop_sleep_sync_marks_success_only_after_post_ingest_success(self):
        service = _FakeWhoopSyncService(
            WearablePostIngestResult(
                provider="whoop",
                user_id="user_1",
                affected_dates=["2026-06-02"],
                projected_records=1,
                metric_facts={"success": True, "facts_written": 1},
            )
        )

        result = await service.ingest_whoop_data(
            user_id="user_1",
            provider_user_id="whoop_user_1",
            recovery_data=None,
            sleep_data=_whoop_sleep_payload(),
            workout_data=None,
            cycle_data=None,
        )

        self.assertEqual(result["events"], 1)
        self.assertTrue(result["post_ingest_success"])
        self.assertEqual(result["metric_facts"], {"success": True, "facts_written": 1})
        self.assertEqual(
            service.post_ingest_service.calls[0]["affected_dates"],
            ["2026-06-02"],
        )
        self.assertEqual(
            service.update_connection_sync_state_calls,
            [{"connection_id": "connection_1"}],
        )

    async def test_whoop_sleep_sync_records_error_when_post_ingest_fails(self):
        service = _FakeWhoopSyncService(
            WearablePostIngestResult(
                provider="whoop",
                user_id="user_1",
                affected_dates=["2026-06-02"],
                projected_records=1,
                error="fact rebuild failed",
            )
        )

        result = await service.ingest_whoop_data(
            user_id="user_1",
            provider_user_id="whoop_user_1",
            recovery_data=None,
            sleep_data=_whoop_sleep_payload(),
            workout_data=None,
            cycle_data=None,
        )

        self.assertEqual(result["events"], 1)
        self.assertFalse(result["post_ingest_success"])
        self.assertEqual(result["metric_facts_error"], "fact rebuild failed")
        self.assertEqual(len(service.update_connection_sync_state_calls), 1)
        self.assertEqual(service.update_connection_sync_state_calls[0]["connection_id"], "connection_1")
        self.assertEqual(
            service.update_connection_sync_state_calls[0]["error"]["message"],
            "Whoop post-ingest failed",
        )

    async def test_oura_sync_runs_shared_post_ingest_for_affected_dates(self):
        service = _FakeOuraSyncService(
            WearablePostIngestResult(
                provider="oura",
                user_id="user_1",
                affected_dates=["2026-06-02"],
                projected_records=1,
                metric_facts={"success": True, "facts_written": 1},
            )
        )

        result = await service.ingest_oura_data(
            user_id="user_1",
            provider_user_id="oura_user_1",
            personal_info={"email": "oura@example.com"},
            access_token=None,
            refresh_token=None,
            token_expires_at=None,
            daily_sleep_records=[{"id": "sleep_day_1", "day": "2026-06-02", "score": 88}],
            sleep_records=[],
            daily_readiness_records=[],
            daily_activity_records=[],
            workout_records=[],
            heartrate_records=[],
        )

        self.assertEqual(result["samples"], 1)
        self.assertTrue(result["post_ingest_success"])
        self.assertEqual(
            service.post_ingest_service.calls[0]["affected_dates"],
            ["2026-06-02"],
        )
        self.assertEqual(service.update_connection_sync_state_calls, [{"connection_id": "connection_1"}])

    async def test_garmin_sync_runs_shared_post_ingest_for_affected_dates(self):
        service = _FakeGarminSyncService(
            WearablePostIngestResult(
                provider="garmin",
                user_id="user_1",
                affected_dates=["2026-06-02"],
                projected_records=1,
                metric_facts={"success": True, "facts_written": 1},
            )
        )

        result = await service.ingest_garmin_payload(
            user_id="user_1",
            provider_user_id="garmin_user_1",
            payload={
                "dailySummaries": [
                    {"summaryId": "summary_1", "calendarDate": "2026-06-02", "steps": 1234}
                ]
            },
            access_token=None,
            refresh_token=None,
            token_expires_at=None,
        )

        self.assertEqual(result["samples"], 1)
        self.assertTrue(result["post_ingest_success"])
        self.assertEqual(
            service.post_ingest_service.calls[0]["affected_dates"],
            ["2026-06-02"],
        )
        self.assertEqual(service.update_connection_sync_state_calls, [{"connection_id": "connection_1"}])


if __name__ == "__main__":
    unittest.main()
