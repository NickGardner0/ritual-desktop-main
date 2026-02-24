"""Pydantic schemas for weather integration endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class WeatherSyncRequest(BaseModel):
    """Client-provided location payload for a weather sync."""

    model_config = ConfigDict(populate_by_name=True)

    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    tz: Optional[str] = None
    location_label: Optional[str] = Field(default=None, alias="locationLabel")
    store_precise_location: bool = Field(default=False, alias="storePreciseLocation")


class WeatherCurrent(BaseModel):
    observed_at: datetime
    tz: str
    location_label: str
    condition_code: str
    temperature_c: float
    feels_like_c: float
    humidity: float
    wind_speed_mps: float
    wind_gust_mps: Optional[float] = None
    wind_direction_deg: float
    precip_probability: float
    precip_intensity: Optional[float] = None
    cloud_cover: Optional[float] = None
    pressure_hpa: Optional[float] = None
    visibility_m: Optional[float] = None


class WeatherDailySummary(BaseModel):
    date_local: str
    tz: str
    location_label: str
    condition_code: Optional[str] = None
    high_c: float
    low_c: float
    sunrise: Optional[datetime] = None
    sunset: Optional[datetime] = None
    uv_index_max: Optional[float] = None


class WeatherStatusResponse(BaseModel):
    enabled: bool = False
    last_sync_at: Optional[datetime] = None
    last_error: Optional[str] = None
    permission_required: Literal["location"] = "location"
    last_location_label: Optional[str] = None
    store_precise_location: bool = False


class WeatherSyncResponse(BaseModel):
    ok: bool
    cached: bool = False
    rate_limited: bool = False
    current: Optional[WeatherCurrent] = None
    today: Optional[WeatherDailySummary] = None


class WeatherCurrentResponse(BaseModel):
    enabled: bool
    current: Optional[WeatherCurrent] = None
    today: Optional[WeatherDailySummary] = None


class WeatherRangeResponse(BaseModel):
    observations: List[WeatherCurrent]


class WeatherKitHealthResponse(BaseModel):
    ok: bool
    status: str
    checked_at: datetime
    condition_code: Optional[str] = None
    temperature_c: Optional[float] = None
    detail: Optional[str] = None
