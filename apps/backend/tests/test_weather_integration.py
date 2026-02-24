"""Weather integration unit tests."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from integrations.weather import router as weather_router
from integrations.weather.schemas import WeatherCurrent, WeatherDailySummary, WeatherSyncRequest
from integrations.weather.service import WeatherKitService


class _FakeClient:
    host = "127.0.0.1"


class _FakeRequest:
    client = _FakeClient()


class _AllowAllLimiter:
    async def allow(self, _key: str) -> bool:
        return True


class _FakeStorage:
    def __init__(self) -> None:
        self.last_error = None
        self.last_metadata_updates = None

    async def get_sync_gate(self, user_id: str, lat_bucket: str, min_interval_seconds: int):
        return {
            "enabled": True,
            "skip_fetch": False,
            "current": None,
            "today": None,
            "metadata": {},
        }

    async def mark_last_error(self, user_id: str, message: str):
        self.last_error = message

    async def store_sync_result(self, user_id: str, current: WeatherCurrent, today: WeatherDailySummary, metadata_updates: dict):
        self.last_metadata_updates = metadata_updates
        return current, today


class _FakeWeatherService:
    async def fetch_weather(self, lat: float, lon: float, tz: str | None = None):
        return {"ok": True}

    def normalize_weather_payload(self, payload: dict, fallback_tz: str | None, fallback_location_label: str | None):
        current = WeatherCurrent(
            observed_at=datetime(2026, 1, 2, 10, 0, tzinfo=timezone.utc),
            tz=fallback_tz or "UTC",
            location_label=fallback_location_label or "Near you",
            condition_code="Clear",
            temperature_c=12.3,
            feels_like_c=11.8,
            humidity=0.51,
            wind_speed_mps=2.1,
            wind_gust_mps=None,
            wind_direction_deg=180.0,
            precip_probability=0.05,
            precip_intensity=None,
            cloud_cover=0.1,
            pressure_hpa=1015.2,
            visibility_m=10000.0,
        )
        today = WeatherDailySummary(
            date_local="2026-01-02",
            tz=fallback_tz or "UTC",
            location_label=fallback_location_label or "Near you",
            condition_code="Clear",
            high_c=14.0,
            low_c=6.0,
            sunrise=datetime(2026, 1, 2, 12, 20, tzinfo=timezone.utc),
            sunset=datetime(2026, 1, 2, 21, 15, tzinfo=timezone.utc),
            uv_index_max=4.0,
        )
        return current, today

    async def maybe_forward_to_tinybird(self, user_id: str, current: WeatherCurrent, today: WeatherDailySummary | None):
        return None


class WeatherNormalizationTests(unittest.TestCase):
    def test_normalize_weatherkit_payload_maps_fields(self):
        service = WeatherKitService()

        payload = {
            "timezone": "America/New_York",
            "currentWeather": {
                "asOf": "2026-02-10T14:22:00Z",
                "conditionCode": "MostlyCloudy",
                "temperature": 8.4,
                "temperatureApparent": 6.9,
                "humidity": 0.62,
                "windSpeed": 4.1,
                "windGust": 6.7,
                "windDirection": 205,
                "precipitationChance": 0.35,
                "precipitationIntensity": 0.1,
                "cloudCover": 0.79,
                "pressure": 1012.5,
                "visibility": 9200,
            },
            "forecastDaily": {
                "days": [
                    {
                        "forecastStart": "2026-02-10T05:00:00Z",
                        "conditionCode": "MostlyCloudy",
                        "temperatureMax": 11.2,
                        "temperatureMin": 2.1,
                        "sunrise": "2026-02-10T11:56:00Z",
                        "sunset": "2026-02-10T22:21:00Z",
                        "maxUvIndex": 3,
                    }
                ]
            },
        }

        current, today = service.normalize_weather_payload(
            payload,
            fallback_tz="America/New_York",
            fallback_location_label="Yorktown Heights, NY",
        )

        self.assertEqual(current.condition_code, "MostlyCloudy")
        self.assertEqual(current.location_label, "Yorktown Heights, NY")
        self.assertAlmostEqual(current.temperature_c, 8.4)
        self.assertAlmostEqual(current.feels_like_c, 6.9)
        self.assertAlmostEqual(current.precip_probability, 0.35)
        self.assertAlmostEqual(current.wind_speed_mps, 4.1)

        self.assertIsNotNone(today)
        assert today is not None
        self.assertEqual(today.date_local, "2026-02-10")
        self.assertAlmostEqual(today.high_c, 11.2)
        self.assertAlmostEqual(today.low_c, 2.1)


class WeatherSyncRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_sync_route_persists_with_bucketed_location(self):
        fake_storage = _FakeStorage()
        fake_service = _FakeWeatherService()

        payload = WeatherSyncRequest(
            lat=40.7128,
            lon=-74.0060,
            tz="America/New_York",
            locationLabel="New York, NY",
            storePreciseLocation=False,
        )

        with patch.object(weather_router, "weather_storage", fake_storage), patch.object(
            weather_router, "weather_service", fake_service
        ), patch.object(weather_router, "ip_rate_limiter", _AllowAllLimiter()):
            result = await weather_router.weather_sync(
                payload=payload,
                request=_FakeRequest(),
                current_user={"id": "user_123"},
            )

        self.assertTrue(result.ok)
        self.assertFalse(result.cached)
        self.assertIsNotNone(result.current)
        self.assertIsNotNone(fake_storage.last_metadata_updates)
        self.assertEqual(fake_storage.last_metadata_updates["store_precise_location"], False)
        self.assertIsNone(fake_storage.last_metadata_updates["last_lat"])
        self.assertIsNone(fake_storage.last_metadata_updates["last_lon"])


if __name__ == "__main__":
    unittest.main()
