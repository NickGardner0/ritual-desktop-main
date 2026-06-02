"""Unit tests for canonical metric fact helpers."""

from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.metric_facts_service import (  # noqa: E402
    FactDraft,
    MetricFactService,
    _classify_habit,
    _convert_value,
    _normalize_metric_key,
)


class MetricFactServiceHelperTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = MetricFactService()

    def test_sleep_aliases_normalize_to_sleep_total(self):
        self.assertEqual(_normalize_metric_key("sleep_session"), "sleep_total")
        self.assertEqual(_normalize_metric_key("sleep_duration"), "sleep_total")
        self.assertEqual(_normalize_metric_key("sleep"), "sleep_total")

    def test_whoop_sleep_minutes_convert_to_hours(self):
        self.assertAlmostEqual(
            _convert_value(420, "minutes", "Hours", "sleep_total"),
            7.0,
        )

    def test_watcher_active_ms_convert_to_hours(self):
        self.assertAlmostEqual(
            _convert_value(3_600_000, "milliseconds", "Hours", "computer_time"),
            1.0,
        )

    def test_source_classification_routes_product_facts(self):
        wearable = SimpleNamespace(integration_source="whoop", metric_type="sleep_session", name="Sleep Duration")
        spending = SimpleNamespace(integration_source="plaid", metric_type="daily_spending", name="Spending")
        watcher = SimpleNamespace(integration_source=None, metric_type="computer_time", name="Computer Time")
        manual = SimpleNamespace(integration_source=None, metric_type=None, name="Nicotine")

        self.assertEqual(_classify_habit(wearable), "wearable")
        self.assertEqual(_classify_habit(spending), "plaid")
        self.assertEqual(_classify_habit(watcher), "watcher")
        self.assertEqual(_classify_habit(manual), "manual")

    def test_wearable_sample_selection_avoids_daily_and_raw_double_counting(self):
        rows = [
            {"id": "daily", "value": 7, "rollup_level": "daily", "aggregation_kind": "daily"},
            {"id": "raw", "value": 7, "rollup_level": "raw", "aggregation_kind": "point"},
        ]

        selected = self.service._select_wearable_sample_rows("sleep_total", rows)

        self.assertEqual([row["id"] for row in selected], ["raw"])

    def test_reconciliation_passes_matching_hours_with_tolerance(self):
        draft = FactDraft(
            user_id="user-1",
            habit_id="habit-1",
            habit_name="Sleep Duration",
            metric_key="sleep_total",
            date="2026-05-14",
            value=7.0,
            unit="Hours",
            source_family="wearable",
            provider="whoop",
        )
        fact = SimpleNamespace(
            user_id="user-1",
            habit_id="habit-1",
            metric_key="sleep_total",
            date="2026-05-14",
            value=7.02,
        )

        report = self.service._build_reconciliation_report(
            [draft],
            [fact],
            dashboard_totals={"habit-1": 7.02},
        )

        self.assertTrue(report["ok"])
        self.assertEqual(report["mismatches"], [])
        self.assertEqual(report["missing"], [])
        self.assertAlmostEqual(report["habit_totals"][0]["expected_fact_total"], 7.0)
        self.assertAlmostEqual(report["habit_totals"][0]["dashboard_snapshot_total"], 7.02)

    def test_reconciliation_fails_missing_fact(self):
        draft = FactDraft(
            user_id="user-1",
            habit_id="habit-1",
            habit_name="Sleep Duration",
            metric_key="sleep_total",
            date="2026-05-14",
            value=7.0,
            unit="Hours",
            source_family="wearable",
            provider="whoop",
        )

        report = self.service._build_reconciliation_report([draft], [])

        self.assertFalse(report["ok"])
        self.assertEqual(report["missing"][0]["habit_id"], "habit-1")

    def test_reconciliation_fails_unit_tolerance_mismatch(self):
        draft = FactDraft(
            user_id="user-1",
            habit_id="habit-1",
            habit_name="Spending",
            metric_key="daily_spending",
            date="2026-05-14",
            value=12.25,
            unit="Dollars",
            source_family="plaid",
            provider="plaid",
        )
        fact = SimpleNamespace(
            user_id="user-1",
            habit_id="habit-1",
            metric_key="daily_spending",
            date="2026-05-14",
            value=12.30,
        )

        report = self.service._build_reconciliation_report([draft], [fact])

        self.assertFalse(report["ok"])
        self.assertEqual(report["mismatches"][0]["tolerance"], 0.01)

    def test_preserves_higher_local_recovery_watcher_fact(self):
        remote = FactDraft(
            user_id="user-1",
            habit_id="habit-computer",
            habit_name="Computer Time",
            metric_key="computer_time",
            date="2026-05-20",
            value=4.0,
            unit="Hours",
            source_family="watcher",
            provider="ritual_watcher",
            provenance={"aggregation": "turso_remote_raw_deoverlap"},
        )
        recovered = FactDraft(
            user_id="user-1",
            habit_id="habit-computer",
            habit_name="Computer Time",
            metric_key="computer_time",
            date="2026-05-20",
            value=7.5,
            unit="Hours",
            source_family="watcher",
            provider="ritual_watcher_local_recovery",
            provenance={"aggregation": "local_watcher_recovery_deoverlap"},
        )

        merged = self.service._preserve_higher_local_recovery_facts([remote], [recovered])

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].value, 7.5)
        self.assertEqual(merged[0].provider, "ritual_watcher_local_recovery")
        self.assertTrue(merged[0].provenance["preserved_over_lower_remote"])

    def test_remote_watcher_fact_wins_when_not_lower_than_recovery(self):
        remote = FactDraft(
            user_id="user-1",
            habit_id="habit-computer",
            habit_name="Computer Time",
            metric_key="computer_time",
            date="2026-05-20",
            value=8.0,
            unit="Hours",
            source_family="watcher",
            provider="ritual_watcher",
        )
        recovered = FactDraft(
            user_id="user-1",
            habit_id="habit-computer",
            habit_name="Computer Time",
            metric_key="computer_time",
            date="2026-05-20",
            value=7.5,
            unit="Hours",
            source_family="watcher",
            provider="ritual_watcher_local_recovery",
            provenance={"repair": "computer_time_fact_backfill"},
        )

        merged = self.service._preserve_higher_local_recovery_facts([remote], [recovered])

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].value, 8.0)
        self.assertEqual(merged[0].provider, "ritual_watcher")


if __name__ == "__main__":
    unittest.main()
