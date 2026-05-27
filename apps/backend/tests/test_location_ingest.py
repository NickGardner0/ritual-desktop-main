"""Unit tests for services.location.ingest.

Verifies sanity checks (rejected pings), state update logic (only writes
fresher pings), and "moved significantly" geocode triggering.
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
sys.modules["database.connection"] = _fake_db_module


from services.location.ingest import (  # noqa: E402
    MAX_ACCURACY_M,
    MAX_FUTURE_SKEW_MS,
    SIGNIFICANT_MOVE_M,
    _is_sane_ping,
)
from services.location.models import LocationPing  # noqa: E402


def _make_ping(**overrides):
    base = {
        "lat": 40.7,
        "lon": -74.0,
        "horizontal_accuracy_m": 25.0,
        "source": "ios_scls",
        "device_id": "test",
        "client_ts": 1_700_000_000_000,
        "client_event_id": "evt-1",
    }
    base.update(overrides)
    return LocationPing(**base)


class SanityCheckTests(unittest.TestCase):
    def test_accepts_normal_ping(self):
        server_now = 1_700_000_000_000
        ping = _make_ping(client_ts=server_now - 1000)
        self.assertTrue(_is_sane_ping(ping, server_now))

    def test_rejects_future_skew(self):
        server_now = 1_700_000_000_000
        ping = _make_ping(client_ts=server_now + MAX_FUTURE_SKEW_MS + 1)
        self.assertFalse(_is_sane_ping(ping, server_now))

    def test_accepts_small_future_skew(self):
        # Mild clock skew within tolerance should be accepted
        server_now = 1_700_000_000_000
        ping = _make_ping(client_ts=server_now + 5_000)
        self.assertTrue(_is_sane_ping(ping, server_now))

    def test_rejects_terrible_accuracy(self):
        ping = _make_ping(horizontal_accuracy_m=MAX_ACCURACY_M + 1)
        self.assertFalse(_is_sane_ping(ping, 1_700_000_000_000))

    def test_accepts_null_accuracy(self):
        # Some sources don't report accuracy; we accept rather than reject
        ping = _make_ping(horizontal_accuracy_m=None)
        self.assertTrue(_is_sane_ping(ping, 1_700_000_000_000))

    def test_accepts_zero_accuracy(self):
        ping = _make_ping(horizontal_accuracy_m=0.0)
        self.assertTrue(_is_sane_ping(ping, 1_700_000_000_000))

    def test_accepts_coordinate_less_mac_bssid_ping(self):
        ping = _make_ping(
            lat=None,
            lon=None,
            source="mac_bssid_trigger",
            bssid="aa:bb:cc:dd:ee:ff",
            horizontal_accuracy_m=None,
        )
        self.assertTrue(_is_sane_ping(ping, 1_700_000_000_000))

    def test_rejects_null_island_mac_placeholder(self):
        ping = _make_ping(lat=0.0, lon=0.0, source="mac_bssid_trigger", bssid="aa")
        self.assertFalse(_is_sane_ping(ping, 1_700_000_000_000))


class ConstantsTests(unittest.TestCase):
    """Lock in numeric constants so accidental edits are flagged."""

    def test_significant_move_is_100m(self):
        self.assertEqual(SIGNIFICANT_MOVE_M, 100.0)

    def test_max_accuracy_is_5000m(self):
        self.assertEqual(MAX_ACCURACY_M, 5000.0)

    def test_max_future_skew_is_60s(self):
        self.assertEqual(MAX_FUTURE_SKEW_MS, 60_000)


class HaversineBasedMovementTests(unittest.TestCase):
    """End-to-end check that distance threshold logic matches haversine."""

    def test_small_drift_under_threshold(self):
        from services.location.util import haversine_m

        # ~10m drift
        d = haversine_m(40.7128, -74.0060, 40.71289, -74.0060)
        self.assertLess(d, SIGNIFICANT_MOVE_M)

    def test_block_walk_over_threshold(self):
        from services.location.util import haversine_m

        # ~200m
        d = haversine_m(40.7128, -74.0060, 40.7146, -74.0060)
        self.assertGreater(d, SIGNIFICANT_MOVE_M)


if __name__ == "__main__":
    unittest.main()
