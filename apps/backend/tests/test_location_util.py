"""Unit tests for services.location.util — pure functions, no DB."""

import time
import unittest

from services.location.util import EARTH_RADIUS_M, haversine_m, now_ms


class HaversineTests(unittest.TestCase):
    """Sanity checks for the great-circle distance helper."""

    def test_zero_distance(self):
        d = haversine_m(40.7128, -74.0060, 40.7128, -74.0060)
        self.assertAlmostEqual(d, 0.0, places=6)

    def test_nyc_to_brooklyn_about_10km(self):
        # Lower Manhattan to Downtown Brooklyn ~10km as the crow flies
        nyc = (40.7128, -74.0060)
        brooklyn = (40.6924, -73.9905)
        d = haversine_m(*nyc, *brooklyn)
        self.assertGreater(d, 2_000)   # at least 2 km
        self.assertLess(d, 5_000)      # at most 5 km

    def test_nyc_to_la_about_3940km(self):
        # NYC to Los Angeles — known great-circle distance ~3940km
        nyc = (40.7128, -74.0060)
        la = (34.0522, -118.2437)
        d = haversine_m(*nyc, *la)
        self.assertGreater(d, 3_900_000)
        self.assertLess(d, 4_000_000)

    def test_antipodes_half_earth_circumference(self):
        # NYC's antipode is near Perth, Australia (roughly)
        d = haversine_m(0.0, 0.0, 0.0, 180.0)
        expected_half_circ = 3.141592653589793 * EARTH_RADIUS_M
        self.assertAlmostEqual(d, expected_half_circ, delta=1.0)

    def test_symmetric(self):
        a = (40.0, -74.0)
        b = (34.0, -118.0)
        self.assertAlmostEqual(haversine_m(*a, *b), haversine_m(*b, *a), places=3)


class NowMsTests(unittest.TestCase):
    def test_returns_int_close_to_current_time(self):
        before = int(time.time() * 1000)
        result = now_ms()
        after = int(time.time() * 1000)
        self.assertIsInstance(result, int)
        self.assertGreaterEqual(result, before)
        self.assertLessEqual(result, after + 10)


if __name__ == "__main__":
    unittest.main()
