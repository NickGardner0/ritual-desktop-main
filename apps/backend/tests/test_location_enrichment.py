"""Unit tests for services.location.enrichment.

Covers: idempotency (no re-enrichment), null resolver result (no-op),
populated result (all columns set), timestamp parsing.
"""

import sys
import types
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch


# Stub database.connection
_fake_db_module = types.ModuleType("database.connection")


@asynccontextmanager
async def _unused_db_session():
    yield None


_fake_db_module.get_db_session = _unused_db_session
_previous_connection_module = sys.modules.get("database.connection")
sys.modules["database.connection"] = _fake_db_module


try:
    from services.location.enrichment import (  # noqa: E402
        _log_timestamp_ms,
        _user_id_from_log,
        enrich_habit_log,
    )
finally:
    if _previous_connection_module is None:
        sys.modules.pop("database.connection", None)
    else:
        sys.modules["database.connection"] = _previous_connection_module
from services.location.models import ResolvedLocation  # noqa: E402


class _FakeHabitLog:
    """Stand-in for HabitLogDB."""

    def __init__(self, **kwargs):
        self.id = kwargs.get("id", "log-1")
        self.completed_at = kwargs.get("completed_at")
        self.habit = kwargs.get("habit")
        self.location_lat = kwargs.get("location_lat")
        self.location_lon = None
        self.location_accuracy_m = None
        self.location_source = None
        self.location_place_label = None
        self.location_confidence = None
        self.location_resolved_at = None
        self.location_signal_age_ms = None


class _FakeHabit:
    def __init__(self, user_id):
        self.user_id = user_id


class TimestampParsingTests(unittest.TestCase):
    def test_iso_with_offset(self):
        log = _FakeHabitLog(completed_at="2026-05-27T14:30:45+00:00")
        ts = _log_timestamp_ms(log)
        self.assertIsNotNone(ts)
        # 2026-05-27T14:30:45 UTC = 1779892245 unix sec * 1000
        self.assertEqual(ts, 1779892245000)

    def test_iso_with_z(self):
        log = _FakeHabitLog(completed_at="2026-05-27T14:30:45Z")
        ts = _log_timestamp_ms(log)
        self.assertEqual(ts, 1779892245000)

    def test_malformed_falls_back_to_now(self):
        log = _FakeHabitLog(completed_at="not-a-date")
        ts = _log_timestamp_ms(log)
        self.assertIsNotNone(ts)
        # Should be close to current wall clock
        import time
        self.assertGreater(ts, int(time.time() * 1000) - 5000)

    def test_none_completed_at_falls_back_to_now(self):
        log = _FakeHabitLog(completed_at=None)
        ts = _log_timestamp_ms(log)
        self.assertIsNotNone(ts)


class UserIdResolutionTests(unittest.TestCase):
    def test_extracts_from_habit_relationship(self):
        habit = _FakeHabit(user_id="user-42")
        log = _FakeHabitLog(habit=habit)
        self.assertEqual(_user_id_from_log(log), "user-42")

    def test_returns_none_when_no_habit(self):
        log = _FakeHabitLog(habit=None)
        self.assertIsNone(_user_id_from_log(log))


class EnrichmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_skips_already_enriched(self):
        log = _FakeHabitLog(location_lat=40.0)
        mock_resolve = AsyncMock(return_value=None)
        with patch("services.location.enrichment.resolve_for", mock_resolve):
            result = await enrich_habit_log(log, user_id="user-1")
        self.assertEqual(result.location_lat, 40.0)
        mock_resolve.assert_not_called()

    async def test_no_user_id_no_op(self):
        log = _FakeHabitLog(habit=None)
        mock_resolve = AsyncMock(return_value=None)
        with patch("services.location.enrichment.resolve_for", mock_resolve):
            result = await enrich_habit_log(log)
        self.assertIsNone(result.location_lat)
        mock_resolve.assert_not_called()

    async def test_no_resolver_result_no_op(self):
        log = _FakeHabitLog(completed_at="2026-05-27T14:00:00Z")
        mock_resolve = AsyncMock(return_value=None)
        with patch("services.location.enrichment.resolve_for", mock_resolve):
            result = await enrich_habit_log(log, user_id="user-1")
        self.assertIsNone(result.location_lat)
        mock_resolve.assert_called_once()

    async def test_populates_all_columns_on_resolution(self):
        log = _FakeHabitLog(completed_at="2026-05-27T14:00:00Z")
        resolved = ResolvedLocation(
            lat=40.7128,
            lon=-74.0060,
            horizontal_accuracy_m=15.0,
            source="ios_scls",
            confidence=0.95,
            signal_age_ms=120_000,
            place_label="Home",
        )
        mock_resolve = AsyncMock(return_value=resolved)
        with patch("services.location.enrichment.resolve_for", mock_resolve):
            result = await enrich_habit_log(log, user_id="user-1")
        self.assertEqual(result.location_lat, 40.7128)
        self.assertEqual(result.location_lon, -74.0060)
        self.assertEqual(result.location_accuracy_m, 15.0)
        self.assertEqual(result.location_source, "ios_scls")
        self.assertEqual(result.location_place_label, "Home")
        self.assertAlmostEqual(result.location_confidence, 0.95, places=2)
        self.assertEqual(result.location_signal_age_ms, 120_000)
        self.assertIsNotNone(result.location_resolved_at)
        self.assertGreater(result.location_resolved_at, 1700000000000)

    async def test_resolver_exception_does_not_propagate(self):
        log = _FakeHabitLog(completed_at="2026-05-27T14:00:00Z")
        mock_resolve = AsyncMock(side_effect=RuntimeError("boom"))
        with patch("services.location.enrichment.resolve_for", mock_resolve):
            result = await enrich_habit_log(log, user_id="user-1")
        # Should swallow the exception and return the log unchanged
        self.assertIsNone(result.location_lat)


if __name__ == "__main__":
    unittest.main()
