"""Unit tests for services.location.resolver.

Verifies the tier-rule cascade picks the best signal for a given timestamp,
the state-direct fast path works when state is fresh, and confidence decays
correctly with signal age.
"""

import sys
import types
import unittest
from contextlib import asynccontextmanager
from unittest.mock import patch


# Stub database.connection so importing the service doesn't require libsql.
_fake_db_module = types.ModuleType("database.connection")


@asynccontextmanager
async def _unused_db_session():
    yield None


_fake_db_module.get_db_session = _unused_db_session
sys.modules["database.connection"] = _fake_db_module


from services.location.resolver import (  # noqa: E402
    STATE_DIRECT_WINDOW_MS,
    TIER_RULES,
    _decay_confidence,
    resolve_for,
)


# ── Fakes ──────────────────────────────────────────────────────────────────


class _FakeStateRow:
    """Minimal stand-in for UserLocationStateDB."""

    def __init__(
        self,
        *,
        lat=40.7,
        lon=-74.0,
        horizontal_accuracy_m=20.0,
        source="ios_scls",
        ping_client_ts=0,
        place_label=None,
    ):
        self.lat = lat
        self.lon = lon
        self.horizontal_accuracy_m = horizontal_accuracy_m
        self.source = source
        self.ping_client_ts = ping_client_ts
        self.place_label = place_label


class _FakePingRow:
    """Minimal stand-in for UserLocationPingDB."""

    def __init__(self, *, lat, lon, source, client_ts, horizontal_accuracy_m=30.0):
        self.lat = lat
        self.lon = lon
        self.horizontal_accuracy_m = horizontal_accuracy_m
        self.source = source
        self.client_ts = client_ts


class _FakeExecuteResult:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


class _FakeSession:
    """Returns scripted results for each execute() call.

    The resolver issues one query for state, then up to len(TIER_RULES) queries
    for tiered ping lookups. Provide a list of rows in call order.
    """

    def __init__(self, rows):
        self._rows = list(rows)

    async def execute(self, *args, **kwargs):
        if self._rows:
            return _FakeExecuteResult(self._rows.pop(0))
        return _FakeExecuteResult(None)


def _fake_session_factory(rows):
    @asynccontextmanager
    async def _ctx():
        yield _FakeSession(rows)

    return _ctx


# ── Tests ──────────────────────────────────────────────────────────────────


class StateDirectPathTests(unittest.IsolatedAsyncioTestCase):
    """When materialized state is fresh, resolver returns it without scanning pings."""

    async def test_returns_state_when_within_direct_window(self):
        target_ts = 1_700_000_000_000
        state = _FakeStateRow(ping_client_ts=target_ts - 30_000, source="ios_scls")
        with patch(
            "services.location.resolver.get_db_session",
            _fake_session_factory([state]),
        ):
            result = await resolve_for("user-1", target_ts)
        self.assertIsNotNone(result)
        self.assertEqual(result.source, "ios_scls")
        self.assertEqual(result.signal_age_ms, 30_000)
        self.assertGreater(result.confidence, 0.9)

    async def test_state_outside_direct_window_falls_through(self):
        target_ts = 1_700_000_000_000
        # State is 2 hours old → outside STATE_DIRECT_WINDOW_MS (1h), falls to tier scan
        old_state = _FakeStateRow(ping_client_ts=target_ts - 2 * 60 * 60_000, source="ios_scls")
        # No tier matches available
        rows = [old_state] + [None] * len(TIER_RULES)
        with patch(
            "services.location.resolver.get_db_session",
            _fake_session_factory(rows),
        ):
            result = await resolve_for("user-1", target_ts)
        self.assertIsNone(result)

    async def test_state_in_future_does_not_match(self):
        target_ts = 1_700_000_000_000
        # State is from the future relative to target → age < 0, skip direct path
        future_state = _FakeStateRow(ping_client_ts=target_ts + 60_000, source="ios_scls")
        rows = [future_state] + [None] * len(TIER_RULES)
        with patch(
            "services.location.resolver.get_db_session",
            _fake_session_factory(rows),
        ):
            result = await resolve_for("user-1", target_ts)
        self.assertIsNone(result)


class TieredFallbackTests(unittest.IsolatedAsyncioTestCase):
    """When state is stale or absent, resolver scans tier rules in order."""

    async def test_returns_first_matching_tier(self):
        target_ts = 1_700_000_000_000
        # No state row, but the first tier (ios_scls within 5min) has a hit
        hit = _FakePingRow(
            lat=40.0,
            lon=-74.0,
            source="ios_scls",
            client_ts=target_ts - 60_000,  # 1 min ago
        )
        rows = [None, hit]
        with patch(
            "services.location.resolver.get_db_session",
            _fake_session_factory(rows),
        ):
            result = await resolve_for("user-1", target_ts)
        self.assertIsNotNone(result)
        self.assertEqual(result.source, "ios_scls")
        self.assertEqual(result.signal_age_ms, 60_000)
        # Confidence should match the first tier rule (0.99)
        self.assertAlmostEqual(result.confidence, 0.99, places=2)

    async def test_falls_through_to_later_tier_when_earlier_empty(self):
        target_ts = 1_700_000_000_000
        # Skip first 3 tiers, hit on tier 4 (ios_scls within 15min)
        hit = _FakePingRow(
            lat=41.0,
            lon=-73.0,
            source="ios_scls",
            client_ts=target_ts - 10 * 60_000,
        )
        rows = [None, None, None, None, hit]  # state + 3 misses + hit
        with patch(
            "services.location.resolver.get_db_session",
            _fake_session_factory(rows),
        ):
            result = await resolve_for("user-1", target_ts)
        self.assertIsNotNone(result)
        self.assertEqual(result.source, "ios_scls")

    async def test_returns_none_when_all_tiers_empty(self):
        target_ts = 1_700_000_000_000
        rows = [None] + [None] * len(TIER_RULES)
        with patch(
            "services.location.resolver.get_db_session",
            _fake_session_factory(rows),
        ):
            result = await resolve_for("user-1", target_ts)
        self.assertIsNone(result)


class ConfidenceDecayTests(unittest.TestCase):
    """Pure-function test: _decay_confidence behaves correctly with age."""

    def test_fresh_signal_high_confidence(self):
        # 0 age → full base confidence
        c = _decay_confidence("ios_scls", 0)
        self.assertAlmostEqual(c, 0.99, places=2)

    def test_one_hour_old_decays(self):
        c = _decay_confidence("ios_scls", 60 * 60_000)
        # base 0.99 minus 0.3 decay = 0.69
        self.assertAlmostEqual(c, 0.69, places=2)

    def test_floor_at_0_4(self):
        # Way beyond an hour — should still floor at 0.4
        c = _decay_confidence("ios_scls", 10 * 60 * 60_000)
        self.assertGreaterEqual(c, 0.4)

    def test_unknown_source_uses_default_base(self):
        c = _decay_confidence("unknown_source", 0)
        self.assertAlmostEqual(c, 0.7, places=2)


if __name__ == "__main__":
    unittest.main()
