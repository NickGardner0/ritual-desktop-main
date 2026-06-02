"""Tests for iPhone Biome activity ingestion."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from schemas.biome import BiomeActivityEvent
from services.biome_ingest import ingest_biome_events, stable_biome_event_uid


def _event(**overrides) -> BiomeActivityEvent:
    base = {
        "device_id": "iphone-1",
        "app_bundle_id": "com.apple.MobileSMS",
        "app_name": "Messages",
        "ts_start": 1_700_000_000_000,
        "ts_end": 1_700_000_060_000,
        "source_file": "remote/device/App.InFocus/foo.segb",
    }
    base.update(overrides)
    return BiomeActivityEvent(**base)


def _make_conn(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE activity_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            app_bundle_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT,
            window_title_hash TEXT,
            window_owner_pid INTEGER,
            is_afk INTEGER NOT NULL DEFAULT 0,
            browser_url TEXT,
            browser_domain TEXT,
            is_incognito INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'ritual_watcher_v2',
            created_at INTEGER NOT NULL
        )
        """
    )
    conn.commit()
    return conn


class BiomeIngestTests(unittest.IsolatedAsyncioTestCase):
    async def test_stable_uid_is_deterministic(self):
        event = _event()
        self.assertEqual(stable_biome_event_uid(event), stable_biome_event_uid(event))
        self.assertTrue(stable_biome_event_uid(event).startswith("biome:iphone-1:"))
        self.assertEqual(
            stable_biome_event_uid(event),
            stable_biome_event_uid(_event(ts_end=event.ts_end + 60_000)),
        )

    async def test_legacy_write_adds_columns_enriches_and_dedupes(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = _make_conn(Path(tmp) / "activity.db")

            @asynccontextmanager
            async def fake_open(_user_id: str, *, write: bool = False):
                self.assertTrue(write)
                yield conn

            resolved = SimpleNamespace(
                lat=40.0,
                lon=-74.0,
                horizontal_accuracy_m=20.0,
                source="ios_scls",
                place_label="Home",
                confidence=0.8,
                signal_age_ms=1000,
            )

            with patch(
                "services.biome_ingest.execute_remote_activity_batch",
                AsyncMock(return_value=False),
            ):
                with patch("services.biome_ingest.open_activity_connection_for_user", fake_open):
                    with patch(
                        "services.biome_ingest.resolve_many_for",
                        AsyncMock(return_value={1_700_000_000_000: resolved}),
                    ), patch(
                        "services.biome_ingest._ensure_iphone_time_habit",
                        AsyncMock(return_value="habit-iphone-time"),
                    ) as ensure_habit, patch(
                        "services.biome_ingest._rebuild_iphone_time_facts_for_dates",
                        AsyncMock(),
                    ) as rebuild_facts:
                        result = await ingest_biome_events("user-1", [_event(), _event()])

            self.assertEqual(result.accepted, 1)
            self.assertEqual(result.duplicates, 1)
            self.assertEqual(result.accepted_event_uids, ("biome:iphone-1:com.apple.MobileSMS:1700000000000",))
            self.assertEqual(result.duplicate_event_uids, ("biome:iphone-1:com.apple.MobileSMS:1700000000000",))
            ensure_habit.assert_awaited_once_with("user-1")
            rebuild_facts.assert_awaited_once()
            row = conn.execute("SELECT * FROM activity_events").fetchone()
            self.assertEqual(row["source"], "biome_iphone")
            self.assertEqual(row["device_platform"], "ios")
            self.assertEqual(row["biome_is_provisional"], 0)
            self.assertEqual(row["location_place_label"], "Home")
            self.assertEqual(row["biome_source_file"], "remote/device/App.InFocus/foo.segb")

    async def test_provisional_update_uses_stable_uid(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = _make_conn(Path(tmp) / "activity.db")

            @asynccontextmanager
            async def fake_open(_user_id: str, *, write: bool = False):
                self.assertTrue(write)
                yield conn

            with patch(
                "services.biome_ingest.execute_remote_activity_batch",
                AsyncMock(return_value=False),
            ), patch("services.biome_ingest.open_activity_connection_for_user", fake_open), patch(
                "services.biome_ingest.resolve_many_for",
                AsyncMock(return_value={}),
            ), patch(
                "services.biome_ingest._ensure_iphone_time_habit",
                AsyncMock(return_value="habit-iphone-time"),
            ), patch(
                "services.biome_ingest._rebuild_iphone_time_facts_for_dates",
                AsyncMock(),
            ):
                first = await ingest_biome_events(
                    "user-1",
                    [_event(ts_end=1_700_000_030_000, biome_is_provisional=True)],
                )
                second = await ingest_biome_events(
                    "user-1",
                    [_event(ts_end=1_700_000_060_000, biome_is_provisional=False)],
                )

            self.assertEqual(first.accepted, 1)
            self.assertEqual(second.accepted, 1)
            row = conn.execute("SELECT event_uid, ts_end, biome_is_provisional FROM activity_events").fetchone()
            self.assertEqual(row["event_uid"], "biome:iphone-1:com.apple.MobileSMS:1700000000000")
            self.assertEqual(row["ts_end"], 1_700_000_060_000)
            self.assertEqual(row["biome_is_provisional"], 0)

    async def test_rejects_invalid_interval(self):
        with self.assertRaises(ValueError):
            _event(ts_start=100, ts_end=100)

    async def test_ignores_system_lockscreen_rows(self):
        result = await ingest_biome_events(
            "user-1",
            [
                _event(
                    app_bundle_id="com.apple.SleepLockScreen",
                    app_name="SleepLockScreen",
                    ts_start=1_700_000_000_000,
                    ts_end=1_700_000_001_000,
                )
            ],
        )

        self.assertEqual(result.accepted, 0)
        self.assertEqual(result.rejected, 1)
        self.assertEqual(
            result.rejected_event_uids,
            ("biome:iphone-1:com.apple.SleepLockScreen:1700000000000",),
        )

    async def test_ignores_springboard_and_system_ui_rows(self):
        valid_event = _event(
            app_bundle_id="com.apple.MobileSMS",
            app_name="Messages",
            ts_start=1_700_000_020_000,
            ts_end=1_700_000_021_000,
        )
        valid_uid = stable_biome_event_uid(valid_event)
        with patch("services.biome_ingest.resolve_many_for", AsyncMock(return_value={})), patch(
            "services.biome_ingest._write_rows",
            AsyncMock(
                return_value=SimpleNamespace(
                    accepted=1,
                    duplicates=0,
                    accepted_event_uids=(valid_uid,),
                    duplicate_event_uids=(),
                    affected_dates=(),
                )
            ),
        ), patch(
            "services.biome_ingest._ensure_iphone_time_habit",
            AsyncMock(return_value="habit-iphone-time"),
        ):
            result = await ingest_biome_events(
                "user-1",
                [
                    _event(
                        app_bundle_id="com.apple.springboard.home-screen-open-folder",
                        app_name="Home Screen",
                        ts_start=1_700_000_000_000,
                        ts_end=1_700_000_001_000,
                    ),
                    _event(
                        app_bundle_id="com.apple.ScreenshotServicesService",
                        app_name="Screenshot Services",
                        ts_start=1_700_000_010_000,
                        ts_end=1_700_000_011_000,
                    ),
                    valid_event,
                ],
            )

        self.assertEqual(result.accepted, 1)
        self.assertEqual(result.rejected, 2)
        self.assertEqual(result.accepted_event_uids, (valid_uid,))
        self.assertEqual(
            result.rejected_event_uids,
            (
                "biome:iphone-1:com.apple.springboard.home-screen-open-folder:1700000000000",
                "biome:iphone-1:com.apple.ScreenshotServicesService:1700000010000",
            ),
        )


if __name__ == "__main__":
    unittest.main()
