import asyncio
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.turso_activity_remote import RemoteActivityRowsResult
from services.watcher_service_computer_activity import _build_computer_activity_snapshot_impl


class WatcherComputerActivitySnapshotTests(unittest.IsolatedAsyncioTestCase):
    async def test_snapshot_uses_activity_events_before_project_time_rollups(self):
        calls = []

        async def fake_fetch_remote_activity_rows(user_id, sql, args=None):
            calls.append(sql)
            if "FROM activity_events" in sql and "GROUP BY day" in sql:
                return RemoteActivityRowsResult(
                    expected_remote=True,
                    source="turso_remote",
                    rows=[("2026-05-01", 3_600_000, 0, 2, 1, 0)],
                )
            if "FROM activity_events" in sql and "GROUP BY app_bundle_id" in sql:
                return RemoteActivityRowsResult(
                    expected_remote=True,
                    source="turso_remote",
                    rows=[("com.apple.Terminal", "Terminal", 3_600_000, 2, 1)],
                )
            if "FROM activity_events" in sql and "GROUP BY browser_domain" in sql:
                return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])
            if "FROM project_time_daily_rollups" in sql:
                return RemoteActivityRowsResult(
                    expected_remote=True,
                    source="turso_remote",
                    rows=[("2026-05-01", 72_000_000_000, 99, "[]", "[]")],
                )
            return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])

        with patch(
            "services.watcher_service_computer_activity.fetch_remote_activity_rows",
            new=fake_fetch_remote_activity_rows,
        ), patch(
            "services.watcher_service_computer_activity.turso_user_service.resolve_migration_source_user_id",
            return_value="user-1",
        ), patch(
            "services.watcher_service_computer_activity.turso_user_service.get_user_activity_access",
            new=AsyncMock(return_value=SimpleNamespace(use_per_user_db=True)),
        ):
            snapshot = await _build_computer_activity_snapshot_impl(
                SimpleNamespace(),
                user_id="user-1",
                start_date="2026-05-01",
                end_date="2026-05-01",
            )

        self.assertEqual(snapshot["source"], "turso_remote_sql_deoverlap")
        self.assertEqual(snapshot["summary"]["total_active_ms"], 3_600_000)
        self.assertEqual(snapshot["summary"]["total_hours"], 1.0)
        self.assertFalse(any("project_time_daily_rollups" in sql for sql in calls))

    async def test_remote_activity_timeout_returns_fast_sync_pending_snapshot(self):
        async def slow_fetch_remote_activity_rows(user_id, sql, args=None):
            await asyncio.sleep(0.05)
            return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])

        with patch(
            "services.watcher_service_computer_activity.fetch_remote_activity_rows",
            new=slow_fetch_remote_activity_rows,
        ), patch(
            "services.watcher_service_computer_activity.REMOTE_AGGREGATE_TIMEOUT_SECONDS",
            0.01,
        ), patch(
            "services.watcher_service_computer_activity._fetch_local_activity_event_rows_impl",
            return_value=[],
        ), patch(
            "services.watcher_service_computer_activity.turso_user_service.resolve_migration_source_user_id",
            return_value="user-1",
        ), patch(
            "services.watcher_service_computer_activity.turso_user_service.get_user_activity_access",
            new=AsyncMock(return_value=SimpleNamespace(use_per_user_db=True)),
        ):
            snapshot = await _build_computer_activity_snapshot_impl(
                SimpleNamespace(),
                user_id="user-1",
                start_date="2026-05-01",
                end_date="2026-05-01",
            )

        self.assertEqual(snapshot["source"], "sync_pending")
        self.assertEqual(snapshot["empty_reason"], "remote_activity_aggregate_timeout")
        self.assertTrue(snapshot["sync_pending"])

    async def test_desktop_snapshot_excludes_biome_source_by_default(self):
        calls = []

        async def fake_fetch_remote_activity_rows(user_id, sql, args=None):
            calls.append((sql, list(args or [])))
            if "GROUP BY day" in sql:
                return RemoteActivityRowsResult(
                    expected_remote=True,
                    source="turso_remote",
                    rows=[("2026-05-01", 1_800_000, 0, 1, 1, 0)],
                )
            return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])

        with patch(
            "services.watcher_service_computer_activity.fetch_remote_activity_rows",
            new=fake_fetch_remote_activity_rows,
        ), patch(
            "services.watcher_service_computer_activity.turso_user_service.resolve_migration_source_user_id",
            return_value="user-1",
        ):
            snapshot = await _build_computer_activity_snapshot_impl(
                SimpleNamespace(),
                user_id="user-1",
                start_date="2026-05-01",
                end_date="2026-05-01",
            )

        self.assertEqual(snapshot["summary"]["total_active_ms"], 1_800_000)
        self.assertTrue(any("COALESCE(source, '') != ?" in sql for sql, _ in calls))
        self.assertTrue(any(args and args[-1] == "biome_iphone" for _, args in calls))

    async def test_iphone_snapshot_filters_to_biome_source(self):
        calls = []

        async def fake_fetch_remote_activity_rows(user_id, sql, args=None):
            calls.append((sql, list(args or [])))
            if "GROUP BY day" in sql:
                return RemoteActivityRowsResult(
                    expected_remote=True,
                    source="turso_remote",
                    rows=[("2026-05-01", 600_000, 0, 1, 1, 0)],
                )
            return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])

        with patch(
            "services.watcher_service_computer_activity.fetch_remote_activity_rows",
            new=fake_fetch_remote_activity_rows,
        ), patch(
            "services.watcher_service_computer_activity.turso_user_service.resolve_migration_source_user_id",
            return_value="user-1",
        ):
            snapshot = await _build_computer_activity_snapshot_impl(
                SimpleNamespace(),
                user_id="user-1",
                start_date="2026-05-01",
                end_date="2026-05-01",
                source_filter="biome_iphone",
            )

        self.assertEqual(snapshot["summary"]["total_active_ms"], 600_000)
        self.assertTrue(any("COALESCE(source, '') = ?" in sql for sql, _ in calls))
        self.assertTrue(any(args and args[-1] == "biome_iphone" for _, args in calls))


if __name__ == "__main__":
    unittest.main()
