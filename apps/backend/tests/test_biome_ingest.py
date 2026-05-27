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
                        "services.biome_ingest.resolve_for",
                        AsyncMock(return_value=resolved),
                    ), patch(
                        "services.biome_ingest._ensure_iphone_time_habit",
                        AsyncMock(),
                    ) as ensure_habit:
                        result = await ingest_biome_events("user-1", [_event(), _event()])

            self.assertEqual(result.accepted, 1)
            self.assertEqual(result.duplicates, 1)
            ensure_habit.assert_awaited_once_with("user-1")
            row = conn.execute("SELECT * FROM activity_events").fetchone()
            self.assertEqual(row["source"], "biome_iphone")
            self.assertEqual(row["device_platform"], "ios")
            self.assertEqual(row["location_place_label"], "Home")
            self.assertEqual(row["biome_source_file"], "remote/device/App.InFocus/foo.segb")

    async def test_rejects_invalid_interval(self):
        with self.assertRaises(ValueError):
            _event(ts_start=100, ts_end=100)


if __name__ == "__main__":
    unittest.main()
