"""WeatherKit client, normalization, and optional analytics forwarding."""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from zoneinfo import ZoneInfo

import httpx
import jwt

from services.tinybird_service import TinybirdService

from .schemas import WeatherCurrent, WeatherDailySummary


class WeatherKitConfigError(RuntimeError):
    pass


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp_01(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return max(0.0, min(1.0, value))


def _parse_datetime(raw: Any) -> Optional[datetime]:
    if raw in (None, ""):
        return None
    try:
        text = str(raw).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _resolve_tz(tz_name: Optional[str]) -> ZoneInfo:
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except Exception:
            pass
    return ZoneInfo("UTC")


class WeatherKitService:
    def __init__(self) -> None:
        self.team_id = os.getenv("WEATHERKIT_TEAM_ID", "").strip()
        self.key_id = os.getenv("WEATHERKIT_KEY_ID", "").strip()
        self.service_id = os.getenv("WEATHERKIT_SERVICE_ID", "").strip()
        self.private_key_source = os.getenv("WEATHERKIT_PRIVATE_KEY_P8", "")

        self.base_url = os.getenv(
            "WEATHERKIT_BASE_URL",
            "https://weatherkit.apple.com/api/v1/weather",
        ).rstrip("/")
        self.language = os.getenv("WEATHERKIT_LANGUAGE", "en").strip() or "en"
        self.datasets = os.getenv(
            "WEATHERKIT_DATASETS",
            "currentWeather,forecastDaily",
        ).strip()

        self._cached_token: Optional[str] = None
        self._cached_token_exp_unix: int = 0
        self._token_lock = asyncio.Lock()

        self._tinybird: Optional[TinybirdService] = None
        self._tinybird_enabled = os.getenv("WEATHER_FORWARD_TINYBIRD", "false").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        if self._tinybird_enabled:
            try:
                self._tinybird = TinybirdService()
            except Exception:
                self._tinybird = None

    def is_configured(self) -> bool:
        return bool(self.team_id and self.key_id and self.private_key_source and self.service_id)

    def _read_private_key(self) -> str:
        raw = self.private_key_source.strip()
        if not raw:
            raise WeatherKitConfigError("WEATHERKIT_PRIVATE_KEY_P8 is not configured")

        if raw.startswith("-----BEGIN"):
            return raw.replace("\\n", "\n")

        path = Path(raw).expanduser()
        if path.exists() and path.is_file():
            return path.read_text(encoding="utf-8")

        # Supports one-line env style where newlines are escaped.
        if "\\n" in raw:
            return raw.replace("\\n", "\n")

        raise WeatherKitConfigError(
            "WEATHERKIT_PRIVATE_KEY_P8 must contain PEM contents or a readable .p8 file path"
        )

    def _validate_config(self) -> None:
        if not self.team_id:
            raise WeatherKitConfigError("WEATHERKIT_TEAM_ID is required")
        if not self.key_id:
            raise WeatherKitConfigError("WEATHERKIT_KEY_ID is required")
        if not self.service_id:
            raise WeatherKitConfigError("WEATHERKIT_SERVICE_ID is required")
        if not self.private_key_source:
            raise WeatherKitConfigError("WEATHERKIT_PRIVATE_KEY_P8 is required")

    async def _get_bearer_token(self) -> str:
        self._validate_config()

        now = int(time.time())
        if self._cached_token and now < self._cached_token_exp_unix - 120:
            return self._cached_token

        async with self._token_lock:
            now = int(time.time())
            if self._cached_token and now < self._cached_token_exp_unix - 120:
                return self._cached_token

            exp = now + 55 * 60
            payload = {
                "iss": self.team_id,
                "iat": now,
                "exp": exp,
                "sub": self.service_id,
            }
            headers = {
                "kid": self.key_id,
                # Apple expects {TEAM_ID}.{SERVICE_ID} identifier in JWT header.
                "id": f"{self.team_id}.{self.service_id}",
            }

            token = jwt.encode(
                payload,
                self._read_private_key(),
                algorithm="ES256",
                headers=headers,
            )
            self._cached_token = token
            self._cached_token_exp_unix = exp
            return token

    async def fetch_weather(self, lat: float, lon: float, tz: Optional[str] = None) -> Dict[str, Any]:
        token = await self._get_bearer_token()
        url = f"{self.base_url}/{self.language}/{lat:.4f}/{lon:.4f}"

        params: Dict[str, str] = {
            "dataSets": self.datasets,
            "units": "m",
        }
        if tz:
            params["timezone"] = tz

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )

        if response.status_code == 401:
            raise RuntimeError("WeatherKit authorization failed (401)")
        if response.status_code >= 400:
            raise RuntimeError(
                f"WeatherKit request failed ({response.status_code}): {response.text[:250]}"
            )

        return response.json()

    def normalize_weather_payload(
        self,
        payload: Dict[str, Any],
        *,
        fallback_tz: Optional[str],
        fallback_location_label: Optional[str],
    ) -> Tuple[WeatherCurrent, Optional[WeatherDailySummary]]:
        current_raw = payload.get("currentWeather") or {}
        if not current_raw:
            raise ValueError("WeatherKit payload missing currentWeather")

        tz_name = fallback_tz or payload.get("timezone") or "UTC"
        location_label = (fallback_location_label or "Near you").strip() or "Near you"

        observed_at = _parse_datetime(current_raw.get("asOf")) or datetime.now(timezone.utc)

        humidity = _clamp_01(_to_float(current_raw.get("humidity")))
        precip_probability = _clamp_01(_to_float(current_raw.get("precipitationChance")))
        cloud_cover = _clamp_01(_to_float(current_raw.get("cloudCover")))
        temperature = _to_float(current_raw.get("temperature"))
        temperature_apparent = _to_float(current_raw.get("temperatureApparent"))

        current = WeatherCurrent(
            observed_at=observed_at,
            tz=tz_name,
            location_label=location_label,
            condition_code=str(current_raw.get("conditionCode") or "unknown"),
            temperature_c=temperature or 0.0,
            feels_like_c=temperature_apparent if temperature_apparent is not None else (temperature or 0.0),
            humidity=humidity if humidity is not None else 0.0,
            wind_speed_mps=_to_float(current_raw.get("windSpeed")) or 0.0,
            wind_gust_mps=_to_float(current_raw.get("windGust")),
            wind_direction_deg=_to_float(current_raw.get("windDirection")) or 0.0,
            precip_probability=precip_probability if precip_probability is not None else 0.0,
            precip_intensity=_to_float(current_raw.get("precipitationIntensity")),
            cloud_cover=cloud_cover,
            pressure_hpa=_to_float(current_raw.get("pressure")),
            visibility_m=_to_float(current_raw.get("visibility")),
        )

        today: Optional[WeatherDailySummary] = None
        daily_days = ((payload.get("forecastDaily") or {}).get("days") or [])
        if daily_days:
            today_raw = daily_days[0]
            tz_info = _resolve_tz(tz_name)
            today_start = _parse_datetime(today_raw.get("forecastStart")) or observed_at
            date_local = today_start.astimezone(tz_info).date().isoformat()
            today = WeatherDailySummary(
                date_local=date_local,
                tz=tz_name,
                location_label=location_label,
                condition_code=str(today_raw.get("conditionCode")) if today_raw.get("conditionCode") else None,
                high_c=_to_float(today_raw.get("temperatureMax")) or 0.0,
                low_c=_to_float(today_raw.get("temperatureMin")) or 0.0,
                sunrise=_parse_datetime(today_raw.get("sunrise")),
                sunset=_parse_datetime(today_raw.get("sunset")),
                uv_index_max=_to_float(today_raw.get("maxUvIndex")),
            )

        return current, today

    async def weatherkit_health_probe(
        self,
        lat: float,
        lon: float,
        tz: str = "UTC",
    ) -> Dict[str, Any]:
        payload = await self.fetch_weather(lat=lat, lon=lon, tz=tz)
        current, _ = self.normalize_weather_payload(
            payload,
            fallback_tz=tz,
            fallback_location_label="Health Probe",
        )
        return {
            "condition_code": current.condition_code,
            "temperature_c": current.temperature_c,
        }

    async def maybe_forward_to_tinybird(
        self,
        user_id: str,
        current: WeatherCurrent,
        today: Optional[WeatherDailySummary],
    ) -> None:
        if not self._tinybird_enabled or self._tinybird is None:
            return

        event = {
            "id": f"weather_{user_id}_{int(current.observed_at.timestamp())}",
            "user_id": user_id,
            "observed_at": current.observed_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "tz": current.tz,
            "location_label": current.location_label,
            "condition_code": current.condition_code,
            "temperature_c": current.temperature_c,
            "feels_like_c": current.feels_like_c,
            "humidity": current.humidity,
            "wind_speed_mps": current.wind_speed_mps,
            "wind_gust_mps": current.wind_gust_mps or 0.0,
            "wind_direction_deg": current.wind_direction_deg,
            "precip_probability": current.precip_probability,
            "precip_intensity": current.precip_intensity or 0.0,
            "cloud_cover": current.cloud_cover or 0.0,
            "pressure_hpa": current.pressure_hpa or 0.0,
            "visibility_m": current.visibility_m or 0.0,
            "today_high_c": today.high_c if today else None,
            "today_low_c": today.low_c if today else None,
            "uv_index_max": today.uv_index_max if today else None,
            "source": "weatherkit",
        }

        try:
            await self._tinybird.ingest_events("weather_observations", [event])
        except Exception:
            # Analytics forwarding is optional and non-blocking for core sync.
            return
