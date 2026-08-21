from pathlib import Path
import os
import sys
import unittest

os.environ.setdefault("DATABASE_URL", "sqlite:///test-habit-logs-all.db")
os.environ.setdefault("RITUAL_DB_LOCAL_ONLY", "1")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.whoop_sync_request import resolve_whoop_sync_options
from services.habit_logs_all_service import (
    dedupe_daily_rows_when_granular_exists,
    normalize_timeline_item,
    shift_date_key,
    sort_logs,
    build_habit_lookup,
)


class HabitLogsAllServiceTests(unittest.TestCase):
    def test_shift_date_key(self):
        self.assertEqual(shift_date_key("2026-08-21", -1), "2026-08-20")

    def test_normalize_matches_habit_and_keeps_sleep_times(self):
        lookup = build_habit_lookup(
            [
                {
                    "id": "h1",
                    "name": "Sleep",
                    "category": "Health",
                    "metric_type": "sleep_total",
                    "integration_source": "whoop",
                    "unit_type": "Hours",
                }
            ]
        )
        row = normalize_timeline_item(
            {
                "id": "evt-1",
                "kind": "wearable_event",
                "provider": "whoop",
                "metric_type": "sleep_total",
                "start_time": "2026-08-20T23:00:00Z",
                "end_time": "2026-08-21T07:00:00Z",
                "timestamp": "2026-08-20T23:00:00Z",
                "attributed_date": "2026-08-21",
                "value": 8,
                "metadata": {"sleep_onset": "2026-08-20T23:00:00Z", "sleep_end": "2026-08-21T07:00:00Z"},
            },
            lookup,
            "UTC",
        )
        self.assertIsNotNone(row)
        self.assertEqual(row["habit_id"], "h1")
        self.assertEqual(row["metadata"]["sleep_onset"], "2026-08-20T23:00:00Z")
        self.assertEqual(row["duration"], 28800)

    def test_dedupe_drops_daily_when_granular_exists(self):
        items = [
            {
                "kind": "wearable_sample",
                "provider": "apple_health",
                "metric_type": "hr",
                "attributed_date": "2026-08-21",
                "rollup_level": "daily",
            },
            {
                "kind": "wearable_sample",
                "provider": "apple_health",
                "metric_type": "hr",
                "attributed_date": "2026-08-21",
                "rollup_level": "1m",
            },
        ]
        kept = dedupe_daily_rows_when_granular_exists(items)
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["rollup_level"], "1m")

    def test_sort_logs_by_habit_name(self):
        rows = sort_logs(
            [{"habit_name": "Steps"}, {"habit_name": "Sleep"}],
            "habit",
            "asc",
        )
        self.assertEqual([row["habit_name"] for row in rows], ["Sleep", "Steps"])


class WhoopSyncOptionsTests(unittest.TestCase):
    def test_json_body_aliases_fill_query_gaps(self):
        days_back, force_full_sync, full_history = resolve_whoop_sync_options(
            body={"daysBack": 365, "forceFullSync": True}
        )
        self.assertEqual(days_back, 365)
        self.assertTrue(force_full_sync)
        self.assertFalse(full_history)

    def test_query_params_win_over_empty_body(self):
        days_back, force_full_sync, full_history = resolve_whoop_sync_options(
            days_back=14,
            full_history=True,
            body={},
        )
        self.assertEqual(days_back, 14)
        self.assertTrue(full_history)
        self.assertFalse(force_full_sync)
