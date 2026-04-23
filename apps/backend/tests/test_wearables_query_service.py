"""Unit tests for wearable-first read helpers."""

from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.unified_wearables_service import WearableQueryService


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

    def test_select_provider_rows_prefers_matching_provider(self):
        grouped_rows = {
            "whoop": [SimpleNamespace(id="w1")],
            "apple_health": [SimpleNamespace(id="a1"), SimpleNamespace(id="a2")],
        }

        rows, provider = self.service._select_provider_rows(grouped_rows, "apple_health")

        self.assertEqual(provider, "apple_health")
        self.assertEqual([row.id for row in rows], ["a1", "a2"])

    def test_select_provider_rows_falls_back_to_mixed_without_preference(self):
        grouped_rows = {
            "whoop": [SimpleNamespace(id="w1")],
            "apple_health": [SimpleNamespace(id="a1")],
        }

        rows, provider = self.service._select_provider_rows(grouped_rows, None)

        self.assertEqual(provider, "mixed")
        self.assertEqual({row.id for row in rows}, {"w1", "a1"})


if __name__ == "__main__":
    unittest.main()
