"""Tests for the bulk UPSERT rollup merge logic in watcher_service_activity.

Imports the real production helpers so tests break if the merge behavior
changes in ways that affect correctness.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.watcher_service_activity import (
    merge_rollups_with_existing,
    rollup_key_from_row,
)


def _mock_row(device_id, app_bundle_id, window_title, active_ms=0, events_count=0):
    row = MagicMock()
    row.device_id = device_id
    row.app_bundle_id = app_bundle_id
    row.window_title = window_title
    row.active_ms = active_ms
    row.events_count = events_count
    row.updated_at = 0
    return row


class TestRollupKeyFromRow(unittest.TestCase):
    def test_normal_row(self):
        row = _mock_row("d1", "com.app.a", "My Title")
        self.assertEqual(rollup_key_from_row(row), ("d1", "com.app.a", "My Title"))

    def test_none_window_title_becomes_empty(self):
        row = _mock_row("d1", "com.app.b", None)
        self.assertEqual(rollup_key_from_row(row), ("d1", "com.app.b", ""))


class TestMergeRollupsWithExisting(unittest.TestCase):
    def test_update_existing_rows(self):
        existing = [_mock_row("d1", "com.app.a", None, active_ms=100, events_count=2)]
        rollups = {
            ("d1", "com.app.a", ""): {
                "device_id": "d1",
                "app_bundle_id": "com.app.a",
                "active_ms": 5000,
                "events_count": 20,
            }
        }

        updates, inserts = merge_rollups_with_existing(rollups, existing, now_ms=9999)

        self.assertEqual(len(updates), 1)
        self.assertEqual(len(inserts), 0)
        self.assertIs(updates[0][0], existing[0])
        self.assertEqual(updates[0][1]["active_ms"], 5000)

    def test_insert_new_rows(self):
        rollups = {
            ("d1", "com.app.new", ""): {
                "device_id": "d1",
                "app_bundle_id": "com.app.new",
                "active_ms": 3000,
                "events_count": 10,
            }
        }

        updates, inserts = merge_rollups_with_existing(rollups, [], now_ms=1000)

        self.assertEqual(len(updates), 0)
        self.assertEqual(len(inserts), 1)
        self.assertEqual(inserts[0]["app_bundle_id"], "com.app.new")

    def test_mixed_update_and_insert(self):
        existing = [_mock_row("d1", "com.app.a", "Title")]
        rollups = {
            ("d1", "com.app.a", "Title"): {
                "device_id": "d1", "app_bundle_id": "com.app.a",
                "active_ms": 1000, "events_count": 5,
            },
            ("d1", "com.app.b", ""): {
                "device_id": "d1", "app_bundle_id": "com.app.b",
                "active_ms": 2000, "events_count": 8,
            },
        }

        updates, inserts = merge_rollups_with_existing(rollups, existing, now_ms=1)

        self.assertEqual(len(updates), 1)
        self.assertEqual(len(inserts), 1)
        self.assertEqual(updates[0][1]["app_bundle_id"], "com.app.a")
        self.assertEqual(inserts[0]["app_bundle_id"], "com.app.b")

    def test_empty_rollups(self):
        updates, inserts = merge_rollups_with_existing({}, [], now_ms=0)
        self.assertEqual(len(updates), 0)
        self.assertEqual(len(inserts), 0)

    def test_duplicate_keys_last_row_wins(self):
        """If two existing rows have the same composite key, the later one wins in the map."""
        row1 = _mock_row("d1", "com.app.a", None, active_ms=100)
        row2 = _mock_row("d1", "com.app.a", None, active_ms=200)
        rollups = {
            ("d1", "com.app.a", ""): {
                "device_id": "d1", "app_bundle_id": "com.app.a",
                "active_ms": 999, "events_count": 1,
            }
        }

        updates, inserts = merge_rollups_with_existing(rollups, [row1, row2], now_ms=0)
        self.assertEqual(len(updates), 1)
        # Should match row2 (last in list)
        self.assertIs(updates[0][0], row2)


if __name__ == "__main__":
    unittest.main()
