"""Unit tests for services.location.models — Pydantic validation."""

import unittest

from pydantic import ValidationError

from services.location.models import (
    LocationPing,
    LocationPingBatch,
    ResolvedLocation,
)


class LocationPingValidationTests(unittest.TestCase):
    """Confirm Pydantic guards against bad client payloads."""

    def _valid_payload(self, **overrides):
        base = {
            "lat": 40.7128,
            "lon": -74.0060,
            "horizontal_accuracy_m": 25.0,
            "source": "ios_scls",
            "device_id": "test-device",
            "client_ts": 1700000000000,
            "client_event_id": "evt-abc-123",
        }
        base.update(overrides)
        return base

    def test_valid_payload_parses(self):
        ping = LocationPing(**self._valid_payload())
        self.assertEqual(ping.lat, 40.7128)
        self.assertEqual(ping.source, "ios_scls")

    def test_latitude_out_of_range_rejected(self):
        with self.assertRaises(ValidationError):
            LocationPing(**self._valid_payload(lat=95.0))

    def test_negative_latitude_below_range_rejected(self):
        with self.assertRaises(ValidationError):
            LocationPing(**self._valid_payload(lat=-91.0))

    def test_longitude_out_of_range_rejected(self):
        with self.assertRaises(ValidationError):
            LocationPing(**self._valid_payload(lon=181.0))

    def test_unknown_source_rejected(self):
        with self.assertRaises(ValidationError):
            LocationPing(**self._valid_payload(source="bogus_source"))

    def test_negative_accuracy_rejected(self):
        with self.assertRaises(ValidationError):
            LocationPing(**self._valid_payload(horizontal_accuracy_m=-1.0))

    def test_empty_client_event_id_rejected(self):
        with self.assertRaises(ValidationError):
            LocationPing(**self._valid_payload(client_event_id=""))

    def test_accuracy_optional(self):
        ping = LocationPing(**self._valid_payload(horizontal_accuracy_m=None))
        self.assertIsNone(ping.horizontal_accuracy_m)

    def test_extra_fields_ignored(self):
        payload = self._valid_payload()
        payload["unknown_field"] = "should not break"
        ping = LocationPing(**payload)
        self.assertEqual(ping.lat, 40.7128)

    def test_mac_bssid_ping_can_omit_coordinates(self):
        ping = LocationPing(
            source="mac_bssid_trigger",
            bssid="aa:bb:cc:dd:ee:ff",
            ssid="Office",
            client_ts=1700000000000,
            client_event_id="evt-bssid",
        )
        self.assertIsNone(ping.lat)
        self.assertIsNone(ping.lon)

    def test_non_mac_source_requires_coordinates(self):
        with self.assertRaises(ValidationError):
            LocationPing(
                source="ios_scls",
                client_ts=1700000000000,
                client_event_id="evt-no-coords",
            )

    def test_partial_coordinates_rejected(self):
        with self.assertRaises(ValidationError):
            LocationPing(**self._valid_payload(lon=None))


class LocationPingBatchTests(unittest.TestCase):
    def test_empty_batch_allowed(self):
        batch = LocationPingBatch(pings=[])
        self.assertEqual(batch.pings, [])

    def test_batch_with_pings(self):
        batch = LocationPingBatch(
            pings=[
                {
                    "source": "mac_one_shot",
                    "bssid": "aa:bb:cc:dd:ee:ff",
                    "client_ts": 1700000000000,
                    "client_event_id": "evt-1",
                },
                {
                    "lat": 1.0,
                    "lon": 1.0,
                    "source": "ios_scls",
                    "client_ts": 1700000001000,
                    "client_event_id": "evt-2",
                },
            ],
        )
        self.assertEqual(len(batch.pings), 2)


class ResolvedLocationTests(unittest.TestCase):
    def test_valid(self):
        rl = ResolvedLocation(
            lat=40.0,
            lon=-74.0,
            source="ios_scls",
            confidence=0.99,
            signal_age_ms=120,
        )
        self.assertEqual(rl.source, "ios_scls")

    def test_confidence_clamped(self):
        with self.assertRaises(ValidationError):
            ResolvedLocation(
                lat=40.0,
                lon=-74.0,
                source="ios_scls",
                confidence=1.5,
                signal_age_ms=0,
            )

    def test_negative_signal_age_rejected(self):
        with self.assertRaises(ValidationError):
            ResolvedLocation(
                lat=40.0,
                lon=-74.0,
                source="ios_scls",
                confidence=0.5,
                signal_age_ms=-1,
            )


if __name__ == "__main__":
    unittest.main()
