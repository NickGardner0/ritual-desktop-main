"""Focused unit tests for wearable maintenance helpers."""

from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.wearable_maintenance_service import WearableMaintenanceService


class WearableMaintenanceServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = WearableMaintenanceService()

    def test_aggregate_rows_sums_cumulative_metrics(self):
        rows = [SimpleNamespace(value=1200), SimpleNamespace(value=300), SimpleNamespace(value=500)]
        value, aggregation = self.service._aggregate_rows("steps", rows)
        self.assertEqual(value, 2000)
        self.assertEqual(aggregation, "daily_total")

    def test_aggregate_rows_averages_non_cumulative_metrics(self):
        rows = [SimpleNamespace(value=80), SimpleNamespace(value=90), SimpleNamespace(value=100)]
        value, aggregation = self.service._aggregate_rows("heart_rate", rows)
        self.assertEqual(value, 90)
        self.assertEqual(aggregation, "daily_average")


if __name__ == "__main__":
    unittest.main()
