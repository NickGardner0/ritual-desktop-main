"""Unit tests for wearable-first read helpers."""

from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace

from pydantic import ValidationError

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.unified_wearables_service import WearableQueryService
from schemas.wearables_unified import WearableQueryParams


class WearableQueryServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = WearableQueryService()

    def test_aggregate_metric_values_sums_cumulative_metrics(self):
        value, aggregation = self.service._aggregate_metric_values("steps", [1200, 300, 500])
        self.assertEqual(value, 2000)
        self.assertEqual(aggregation, "daily_total")

    def test_aggregate_metric_values_averages_non_cumulative_metrics(self):
        value, aggregation = self.service._aggregate_metric_values("heart_rate", [80, 90, 100])
        self.assertEqual(value, 90)
        self.assertEqual(aggregation, "daily_average")

    def test_aggregate_metric_values_uses_min_for_resting_heart_rate(self):
        value, aggregation = self.service._aggregate_metric_values("resting_heart_rate", [62, 58, 61])
        self.assertEqual(value, 58)
        self.assertEqual(aggregation, "daily_min")

    def test_select_rows_for_daily_totals_ignores_stale_daily_rollup_for_cumulative_metrics(self):
        rows = [
            SimpleNamespace(id="daily", rollup_level="daily", aggregation_kind="daily", value=192),
            SimpleNamespace(id="bucket-1", rollup_level="bucket_15m", aggregation_kind="bucket_15m", value=1740),
            SimpleNamespace(id="bucket-2", rollup_level="bucket_15m", aggregation_kind="bucket_15m", value=1746),
        ]

        preferred = self.service._select_rows_for_daily_totals("steps", rows)

        self.assertEqual([row.id for row in preferred], ["bucket-1", "bucket-2"])

    def test_select_rows_for_daily_totals_falls_back_to_daily_when_needed(self):
        rows = [
            SimpleNamespace(id="daily-1", rollup_level="daily", aggregation_kind="daily", value=8335),
            SimpleNamespace(id="daily-2", rollup_level="daily", aggregation_kind="daily", value=12),
        ]

        preferred = self.service._select_rows_for_daily_totals("steps", rows)

        self.assertEqual([row.id for row in preferred], ["daily-1", "daily-2"])

    def test_select_rows_for_daily_totals_prefers_daily_rollup_for_average_metrics(self):
        rows = [
            SimpleNamespace(id="daily", rollup_level="daily", aggregation_kind="daily", value=96),
            SimpleNamespace(id="sample-1", rollup_level="raw", aggregation_kind="point", value=103),
            SimpleNamespace(id="sample-2", rollup_level="raw", aggregation_kind="point", value=88),
        ]

        preferred = self.service._select_rows_for_daily_totals("heart_rate", rows)

        self.assertEqual([row.id for row in preferred], ["daily"])

    def test_select_provider_rows_prefers_matching_provider(self):
        grouped_rows = {
            "whoop": [SimpleNamespace(id="w1", provider="whoop", source_id="s1")],
            "apple_health": [
                SimpleNamespace(id="a1", provider="apple_health", source_id="s2"),
                SimpleNamespace(id="a2", provider="apple_health", source_id="s3"),
            ],
        }
        source_map = {
            "s2": SimpleNamespace(id="s2", provider="apple_health", source_kind="device", device_name="Apple Watch", device_model=None, device_type="watch", platform="ios", priority_rank=10, source_bundle_id=None, metadata_json=None),
            "s3": SimpleNamespace(id="s3", provider="apple_health", source_kind="device", device_name="iPhone", device_model=None, device_type="phone", platform="ios", priority_rank=50, source_bundle_id=None, metadata_json=None),
        }

        rows, provider, selected_source = self.service._select_provider_rows(grouped_rows, "apple_health", source_map)

        self.assertEqual(provider, "apple_health")
        self.assertEqual([row.id for row in rows], ["a1"])
        self.assertEqual(selected_source["device_name"], "Apple Watch")

    def test_select_provider_rows_uses_source_priority_without_preference(self):
        grouped_rows = {
            "whoop": [SimpleNamespace(id="w1", provider="whoop", source_id="s1")],
            "apple_health": [SimpleNamespace(id="a1", provider="apple_health", source_id="s2")],
        }
        source_map = {
            "s1": SimpleNamespace(id="s1", provider="whoop", source_kind="device", device_name="Whoop Strap", device_model=None, device_type="patch", platform=None, priority_rank=40, source_bundle_id=None, metadata_json=None),
            "s2": SimpleNamespace(id="s2", provider="apple_health", source_kind="device", device_name="Apple Watch", device_model=None, device_type="watch", platform="ios", priority_rank=10, source_bundle_id=None, metadata_json=None),
        }

        rows, provider, selected_source = self.service._select_provider_rows(grouped_rows, None, source_map)

        self.assertEqual(provider, "apple_health")
        self.assertEqual([row.id for row in rows], ["a1"])
        self.assertEqual(selected_source["priority_rank"], 10)

    def test_wearable_query_params_accepts_timeline_page_limit(self):
        params = WearableQueryParams(limit=5000)
        self.assertEqual(params.limit, 5000)

    def test_wearable_query_params_rejects_limit_above_page_cap(self):
        with self.assertRaises(ValidationError):
            WearableQueryParams(limit=5001)


if __name__ == "__main__":
    unittest.main()
