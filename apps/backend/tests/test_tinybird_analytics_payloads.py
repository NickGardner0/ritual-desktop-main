from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.tinybird_service import (
    format_habit_correlation_payload,
    format_habit_period_comparison_row,
    format_user_habits_summary_row,
    interpret_habit_correlation,
)


class TinybirdAnalyticsPayloadTests(unittest.TestCase):
    def test_summary_row_maps_weekly_change(self):
        row = format_user_habits_summary_row(
            {
                "habit_id": "h1",
                "habit_name": "Sleep",
                "unit": "hours",
                "total_logs": 12,
                "weekly_amount_change_pct": 8.5,
            }
        )
        self.assertEqual(row["habit_id"], "h1")
        self.assertEqual(row["weekly_amount_change_pct"], 8.5)
        self.assertEqual(row["last_7_days_avg"], 0)

    def test_custom_range_row_aliases_weekly_change(self):
        row = format_habit_period_comparison_row(
            {
                "habit_id": "h1",
                "amount_change_pct": 12.2,
                "first_day_amount": 5,
            }
        )
        self.assertEqual(row["weekly_amount_change_pct"], 12.2)
        self.assertEqual(row["amount_change_pct"], 12.2)
        self.assertEqual(row["first_day_amount"], 5)

    def test_correlation_empty_rows_are_not_success(self):
        payload = format_habit_correlation_payload({"data": []})
        self.assertFalse(payload["success"])
        self.assertIn("overlapping", payload["error"])

    def test_correlation_payload_matches_dashboard_shape(self):
        payload = format_habit_correlation_payload(
            {
                "data": [
                    {
                        "habit1_id": "a",
                        "habit1_name": "Sleep",
                        "habit1_mean": 7.2,
                        "habit2_id": "b",
                        "habit2_name": "Steps",
                        "habit2_mean": 8000,
                        "correlation": 0.8123,
                        "strength": "strong",
                        "direction": "positive",
                        "sample_size": 30,
                        "status": "ok",
                    }
                ]
            }
        )
        self.assertTrue(payload["success"])
        self.assertEqual(payload["data"]["habit1"]["id"], "a")
        self.assertEqual(payload["data"]["correlation"]["coefficient"], 0.812)
        self.assertIn("strong positive", payload["data"]["correlation"]["interpretation"])

    def test_insufficient_data_interpretation(self):
        text = interpret_habit_correlation(0, "insufficient_data", "", "Sleep", "Steps")
        self.assertIn("Need at least 7 days", text)
