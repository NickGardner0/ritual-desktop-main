"""Tests for late-arriving location backfill helpers."""

from __future__ import annotations

import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from services.location.backfill import backfill_habit_logs_missing_location


class _FakeScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _FakeScalars(self._rows)


class _FakeSession:
    def __init__(self, rows):
        self.rows = rows
        self.committed = False

    async def execute(self, *_args, **_kwargs):
        return _FakeResult(self.rows)

    async def commit(self):
        self.committed = True


class LocationBackfillTests(unittest.IsolatedAsyncioTestCase):
    async def test_backfills_habit_logs_missing_location(self):
        log = SimpleNamespace(
            completed_at="2026-05-28T12:00:00+00:00",
            date="2026-05-28",
            location_lat=None,
            location_lon=None,
            location_accuracy_m=None,
            location_source=None,
            location_place_label=None,
            location_confidence=None,
            location_resolved_at=None,
            location_signal_age_ms=None,
        )
        session = _FakeSession([log])
        resolved = SimpleNamespace(
            lat=40.7,
            lon=-74.0,
            horizontal_accuracy_m=20.0,
            source="ios_scls",
            place_label="Home",
            confidence=0.9,
            signal_age_ms=1_000,
        )

        @asynccontextmanager
        async def fake_db_session():
            yield session

        with patch("services.location.backfill.get_db_session", fake_db_session), patch(
            "services.location.backfill.resolve_many_for",
            AsyncMock(return_value={1_779_969_600_000: resolved}),
        ):
            count = await backfill_habit_logs_missing_location(
                "user-1",
                start_ts_ms=1_779_969_600_000,
                end_ts_ms=1_779_969_600_000,
            )

        self.assertEqual(count, 1)
        self.assertEqual(log.location_lat, 40.7)
        self.assertEqual(log.location_place_label, "Home")
        self.assertTrue(session.committed)


if __name__ == "__main__":
    unittest.main()
