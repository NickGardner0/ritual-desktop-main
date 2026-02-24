"""FastAPI router for Weather integration."""

from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from datetime import datetime, timedelta
import os
from typing import Deque, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from services.auth_service import AuthService

from .schemas import (
    WeatherCurrentResponse,
    WeatherKitHealthResponse,
    WeatherRangeResponse,
    WeatherStatusResponse,
    WeatherSyncRequest,
    WeatherSyncResponse,
)
from .service import WeatherKitConfigError, WeatherKitService
from .storage import WeatherStorage

router = APIRouter(tags=["weather"])

security = HTTPBearer()
auth_service = AuthService()
weather_service = WeatherKitService()
weather_storage = WeatherStorage()


class InMemoryIpRateLimiter:
    """Simple sliding-window limiter for per-IP weather sync requests."""

    def __init__(self, *, window_seconds: int, max_requests: int):
        self.window_seconds = max(1, window_seconds)
        self.max_requests = max(1, max_requests)
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def allow(self, key: str) -> bool:
        now_ts = datetime.utcnow().timestamp()
        oldest_allowed = now_ts - self.window_seconds

        async with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] < oldest_allowed:
                bucket.popleft()

            if len(bucket) >= self.max_requests:
                return False

            bucket.append(now_ts)
            return True


ip_rate_limiter = InMemoryIpRateLimiter(
    window_seconds=int(os.getenv("WEATHER_SYNC_IP_WINDOW_SECONDS", "600")),
    max_requests=int(os.getenv("WEATHER_SYNC_IP_MAX_REQUESTS", "30")),
)


def _location_bucket(lat: float, lon: float) -> str:
    precision = int(os.getenv("WEATHER_LOCATION_BUCKET_PRECISION", "2"))
    return f"{round(lat, precision):.{precision}f},{round(lon, precision):.{precision}f}"


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        user = await auth_service.get_user_from_token(credentials.credentials)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid authentication token")
        return user
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {exc}")


@router.get("/api/integrations/weather/status", response_model=WeatherStatusResponse)
async def weather_status(current_user=Depends(get_current_user)):
    return await weather_storage.get_status(current_user["id"])


@router.post("/api/integrations/weather/connect", response_model=WeatherStatusResponse)
async def weather_connect(current_user=Depends(get_current_user)):
    return await weather_storage.connect(current_user["id"])


@router.post("/api/integrations/weather/disconnect", response_model=WeatherStatusResponse)
async def weather_disconnect(current_user=Depends(get_current_user)):
    return await weather_storage.disconnect(current_user["id"])


@router.delete("/api/integrations/weather/data")
async def weather_delete_data(current_user=Depends(get_current_user)):
    await weather_storage.delete_user_weather_data(current_user["id"])
    return {"ok": True}


@router.post("/api/integrations/weather/sync", response_model=WeatherSyncResponse)
async def weather_sync(
    payload: WeatherSyncRequest,
    request: Request,
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    client_ip = request.client.host if request.client else "unknown"

    if not await ip_rate_limiter.allow(client_ip):
        raise HTTPException(status_code=429, detail="Too many weather sync requests from this IP")

    user_min_interval = int(os.getenv("WEATHER_SYNC_MIN_INTERVAL_SECONDS", "600"))
    bucket = _location_bucket(payload.lat, payload.lon)

    gate = await weather_storage.get_sync_gate(
        user_id=user_id,
        lat_bucket=bucket,
        min_interval_seconds=user_min_interval,
    )

    if not gate["enabled"]:
        raise HTTPException(status_code=400, detail="Weather integration is not connected")

    if gate["skip_fetch"]:
        return WeatherSyncResponse(
            ok=True,
            cached=True,
            rate_limited=True,
            current=gate["current"],
            today=gate["today"],
        )

    try:
        weatherkit_payload = await weather_service.fetch_weather(
            lat=payload.lat,
            lon=payload.lon,
            tz=payload.tz,
        )
        current, today = weather_service.normalize_weather_payload(
            weatherkit_payload,
            fallback_tz=payload.tz,
            fallback_location_label=payload.location_label,
        )
    except WeatherKitConfigError as exc:
        await weather_storage.mark_last_error(user_id, str(exc))
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        await weather_storage.mark_last_error(user_id, str(exc))
        raise HTTPException(status_code=502, detail=f"Weather sync failed: {exc}")

    metadata_updates = {
        "last_lat_bucket": bucket,
        "last_location_label": current.location_label,
        "last_tz": current.tz,
        "store_precise_location": bool(payload.store_precise_location),
    }

    if payload.store_precise_location:
        metadata_updates.update(
            {
                "last_lat": round(payload.lat, 5),
                "last_lon": round(payload.lon, 5),
            }
        )
    else:
        # Explicitly clear any previously stored precise coordinates.
        metadata_updates.update({"last_lat": None, "last_lon": None})

    stored_current, stored_today = await weather_storage.store_sync_result(
        user_id=user_id,
        current=current,
        today=today,
        metadata_updates=metadata_updates,
    )

    await weather_service.maybe_forward_to_tinybird(
        user_id=user_id,
        current=stored_current,
        today=stored_today,
    )

    return WeatherSyncResponse(ok=True, current=stored_current, today=stored_today)


@router.get("/api/weather/current", response_model=WeatherCurrentResponse)
async def weather_current(current_user=Depends(get_current_user)):
    payload = await weather_storage.get_current_payload(current_user["id"])
    return WeatherCurrentResponse(**payload)


@router.get("/api/weather/range", response_model=WeatherRangeResponse)
async def weather_range(
    start: Optional[datetime] = Query(default=None),
    end: Optional[datetime] = Query(default=None),
    current_user=Depends(get_current_user),
):
    end_value = end or datetime.utcnow()
    start_value = start or (end_value - timedelta(days=7))
    if start_value > end_value:
        raise HTTPException(status_code=400, detail="start must be before end")

    observations = await weather_storage.get_range(
        user_id=current_user["id"],
        start=start_value,
        end=end_value,
    )
    return WeatherRangeResponse(observations=observations)


@router.get("/api/health/weatherkit", response_model=WeatherKitHealthResponse)
async def weatherkit_health(
    lat: float = Query(default=37.3349),
    lon: float = Query(default=-122.0090),
    tz: str = Query(default="America/Los_Angeles"),
):
    checked_at = datetime.utcnow()

    if not weather_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail="WeatherKit is not configured (missing WEATHERKIT_* env vars)",
        )

    try:
        probe = await weather_service.weatherkit_health_probe(lat=lat, lon=lon, tz=tz)
        return WeatherKitHealthResponse(
            ok=True,
            status="healthy",
            checked_at=checked_at,
            condition_code=probe.get("condition_code"),
            temperature_c=probe.get("temperature_c"),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"WeatherKit probe failed: {exc}")
