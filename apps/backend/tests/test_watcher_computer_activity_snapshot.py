import asyncio
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.turso_activity_remote import RemoteActivityRowsResult
from services.watcher_service_computer_activity import _build_computer_activity_snapshot_impl
from services.watcher_service_projection import sync_to_computer_use_habit_range_impl


class WatcherComputerActivitySnapshotTests(unittest.IsolatedAsyncioTestCase):
    async def test_snapshot_prefers_activity_daily_rollups(self):
        calls = []

        async def fake_fetch_remote_activity_rows(user_id, sql, args=None):
            calls.append(sql)
            if "FROM activity_daily_rollups" in sql:
                return RemoteActivityRowsResult(
                    expected_remote=True,
                    source="turso_remote",
                    rows=[(
                        "2026-05-01",
                        "[[0,3600000]]",
                        "[]",
                        2,
                        '[{"bundle_id":"com.apple.Terminal","name":"Terminal","active_ms":3600000,"events_count":2}]',
                        "[]",
                        1_777_600_000_000,
                    )],
                )
            return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])

        with patch(
            "services.computer_activity.snapshot.fetch_remote_activity_rows",
            new=fake_fetch_remote_activity_rows,
        ), patch(
            "services.computer_activity.common.turso_user_service.resolve_migration_source_user_id",
            return_value="user-1",
        ), patch(
            "services.computer_activity.snapshot.turso_user_service.get_user_activity_access",
            new=AsyncMock(return_value=SimpleNamespace(use_per_user_db=True)),
        ):
            snapshot = await _build_computer_activity_snapshot_impl(
                SimpleNamespace(),
                user_id="user-1",
                start_date="2026-05-01",
                end_date="2026-05-01",
            )

        self.assertEqual(snapshot["source"], "turso_rollups_v2")
        self.assertEqual(snapshot["summary"]["total_active_ms"], 3_600_000)
        self.assertEqual(snapshot["summary"]["total_hours"], 1.0)
        self.assertFalse(any("FROM activity_events" in sql for sql in calls))

    async def test_rollup_timeout_uses_short_range_raw_fallback(self):
        async def slow_fetch_remote_activity_rows(user_id, sql, args=None):
            if "FROM activity_daily_rollups" in sql:
                await asyncio.sleep(0.05)
                return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])
            return RemoteActivityRowsResult(
                expected_remote=True,
                source="turso_remote",
                rows=[(1_777_651_200_000, 1_777_651_800_000, 0, "com.apple.Terminal", "Terminal", "")],
            )

        with patch(
            "services.computer_activity.snapshot.fetch_remote_activity_rows",
            new=slow_fetch_remote_activity_rows,
        ), patch(
            "services.computer_activity.snapshot.REMOTE_AGGREGATE_TIMEOUT_SECONDS",
            0.01,
        ), patch(
            "services.computer_activity.snapshot._fetch_local_activity_event_rows_impl",
            return_value=[],
        ), patch(
            "services.computer_activity.common.turso_user_service.resolve_migration_source_user_id",
            return_value="user-1",
        ), patch(
            "services.computer_activity.snapshot.turso_user_service.get_user_activity_access",
            new=AsyncMock(return_value=SimpleNamespace(use_per_user_db=True)),
        ):
            snapshot = await _build_computer_activity_snapshot_impl(
                SimpleNamespace(),
                user_id="user-1",
                start_date="2026-05-01",
                end_date="2026-05-01",
            )

        self.assertEqual(snapshot["source"], "turso_remote")
        self.assertEqual(snapshot["summary"]["total_active_ms"], 600_000)
        self.assertFalse(snapshot["sync_pending"])

    async def test_long_range_without_rollups_is_sync_pending_not_factual_zero(self):
        async def fake_fetch_remote_activity_rows(user_id, sql, args=None):
            return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])

        with patch(
            "services.computer_activity.snapshot.fetch_remote_activity_rows",
            new=fake_fetch_remote_activity_rows,
        ), patch(
            "services.computer_activity.snapshot._fetch_local_activity_event_rows_impl",
            return_value=[],
        ), patch(
            "services.computer_activity.common.turso_user_service.resolve_migration_source_user_id",
            return_value="user-1",
        ):
            snapshot = await _build_computer_activity_snapshot_impl(
                SimpleNamespace(),
                user_id="user-1",
                start_date="2025-01-01",
                end_date="2026-05-01",
            )

        self.assertEqual(snapshot["state"], "sync_pending")
        self.assertTrue(snapshot["sync_pending"])
        self.assertEqual(snapshot["empty_reason"], "activity_rollups_not_materialized")

    async def test_short_range_with_ready_empty_sources_is_factual_empty(self):
        async def fake_fetch_remote_activity_rows(user_id, sql, args=None):
            return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])

        with patch(
            "services.computer_activity.snapshot.fetch_remote_activity_rows",
            new=fake_fetch_remote_activity_rows,
        ), patch(
            "services.computer_activity.snapshot._fetch_local_activity_event_rows_impl",
            return_value=[],
        ), patch(
            "services.computer_activity.common.turso_user_service.resolve_migration_source_user_id",
            return_value="user-1",
        ):
            snapshot = await _build_computer_activity_snapshot_impl(
                SimpleNamespace(),
                user_id="user-1",
                start_date="2026-05-01",
                end_date="2026-05-01",
            )

        self.assertEqual(snapshot["state"], "empty")
        self.assertFalse(snapshot["sync_pending"])
        self.assertEqual(snapshot["empty_reason"], "no_activity_rows")

    async def test_range_projection_preserves_typed_pending_state(self):
        service = SimpleNamespace(
            get_computer_activity_snapshot=AsyncMock(return_value={
                "state": "sync_pending",
                "empty_reason": "activity_rollups_not_materialized",
                "daily": [],
            })
        )

        result = await sync_to_computer_use_habit_range_impl(
            service,
            user_id="user-1",
            start_date="2026-05-01",
            end_date="2026-05-02",
        )

        self.assertFalse(result["success"])
        self.assertFalse(result["synced"])
        self.assertEqual(result["state"], "sync_pending")
        self.assertEqual(result["reason"], "activity_rollups_not_materialized")

    async def test_desktop_snapshot_excludes_biome_source_by_default(self):
        calls = []

        async def fake_fetch_remote_activity_rows(user_id, sql, args=None):
            calls.append((sql, list(args or [])))
            if "FROM activity_daily_rollups" in sql:
                return RemoteActivityRowsResult(
                    expected_remote=True,
                    source="turso_remote",
                    rows=[("2026-05-01", "[[0,1800000]]", "[]", 1, "[]", "[]", 1)],
                )
            return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])

        with patch(
            "services.computer_activity.snapshot.fetch_remote_activity_rows",
            new=fake_fetch_remote_activity_rows,
        ), patch(
            "services.computer_activity.common.turso_user_service.resolve_migration_source_user_id",
            return_value="user-1",
        ):
            snapshot = await _build_computer_activity_snapshot_impl(
                SimpleNamespace(),
                user_id="user-1",
                start_date="2026-05-01",
                end_date="2026-05-01",
            )

        self.assertEqual(snapshot["summary"]["total_active_ms"], 1_800_000)
        self.assertTrue(any("FROM activity_daily_rollups" in sql for sql, _ in calls))
        self.assertFalse(any("FROM activity_events" in sql for sql, _ in calls))

    async def test_iphone_snapshot_filters_to_biome_source(self):
        calls = []

        async def fake_fetch_remote_activity_rows(user_id, sql, args=None):
            calls.append((sql, list(args or [])))
            if "FROM activity_events" in sql:
                return RemoteActivityRowsResult(
                    expected_remote=True,
                    source="turso_remote",
                    rows=[(1_777_651_200_000, 1_777_651_800_000, 0, "com.apple.MobileSafari", "Safari", "example.com")],
                )
            return RemoteActivityRowsResult(expected_remote=True, source="turso_remote", rows=[])

        with patch(
            "services.computer_activity.snapshot.fetch_remote_activity_rows",
            new=fake_fetch_remote_activity_rows,
        ), patch(
            "services.computer_activity.common.turso_user_service.resolve_migration_source_user_id",
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
