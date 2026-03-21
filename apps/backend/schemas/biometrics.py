"""
Pydantic schemas for WHOOP BLE heart-rate biometrics ingestion and queries.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


ALLOWED_SOURCE_TYPES = {"whoop_ble_ios", "whoop_ble_mac"}


class HeartRateSourceType(str, Enum):
    WHOOP_BLE_IOS = "whoop_ble_ios"
    WHOOP_BLE_MAC = "whoop_ble_mac"


class HeartRateResolution(str, Enum):
    RAW = "raw"
    ONE_MINUTE = "1m"


class HeartRateSessionStatus(str, Enum):
    ACTIVE = "active"
    DISCONNECTED = "disconnected"
    ENDED = "ended"


class HeartRateSampleIn(BaseModel):
    id: str = Field(..., min_length=1, max_length=128)
    session_id: str = Field(..., min_length=1, max_length=128)
    source_type: HeartRateSourceType
    source_device_id: str = Field(..., min_length=1, max_length=255)
    bpm_raw: int = Field(..., ge=30, le=220)
    bpm_display: int = Field(..., ge=30, le=220)
    quality_score: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    is_outlier: bool = False
    rr_intervals_ms: Optional[List[float]] = Field(default=None, max_length=20)
    contact_detected: Optional[bool] = None
    received_at: datetime

    @field_validator("rr_intervals_ms")
    @classmethod
    def validate_rr_intervals(cls, value: Optional[List[float]]) -> Optional[List[float]]:
        if value is None:
            return value
        cleaned = [float(item) for item in value if item is not None]
        for interval in cleaned:
            if interval <= 0 or interval > 10_000:
                raise ValueError("rr_intervals_ms values must be within (0, 10000]")
        return cleaned


class HeartRateSampleBatchIn(BaseModel):
    samples: List[HeartRateSampleIn] = Field(..., min_length=1, max_length=1000)


class HeartRateSessionCreate(BaseModel):
    id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    source_type: HeartRateSourceType
    source_device_id: str = Field(..., min_length=1, max_length=255)
    started_at: datetime
    status: HeartRateSessionStatus = HeartRateSessionStatus.ACTIVE
    app_version: Optional[str] = Field(default=None, max_length=64)
    device_model: Optional[str] = Field(default=None, max_length=128)


class HeartRateSessionEndRequest(BaseModel):
    ended_at: Optional[datetime] = None
    status: HeartRateSessionStatus = HeartRateSessionStatus.ENDED


class HeartRateSessionOut(BaseModel):
    id: str
    user_id: str
    source_type: str
    source_device_id: str
    status: str
    started_at: datetime
    ended_at: Optional[datetime] = None
    app_version: Optional[str] = None
    device_model: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class HeartRateSampleOut(BaseModel):
    id: str
    session_id: str
    source_type: str
    source_device_id: str
    bpm_raw: int
    bpm_display: int
    quality_score: Optional[float] = None
    is_outlier: bool
    rr_intervals_ms: Optional[List[float]] = None
    contact_detected: Optional[bool] = None
    received_at: datetime
    created_at: datetime


class LiveBiometricsOut(BaseModel):
    current_bpm: Optional[int] = None
    current_source_type: Optional[str] = None
    latest_sample_at: Optional[datetime] = None
    connection_state: str = "disconnected"
    is_stale: bool = True


class HeartRateRangePointOut(BaseModel):
    source_type: str
    bucket_start: Optional[datetime] = None
    bpm_avg: Optional[float] = None
    bpm_min: Optional[int] = None
    bpm_max: Optional[int] = None
    sample_count: Optional[int] = None
    received_at: Optional[datetime] = None
    bpm_raw: Optional[int] = None
    bpm_display: Optional[int] = None
    is_outlier: Optional[bool] = None


class HeartRateRangeQueryOut(BaseModel):
    resolution: HeartRateResolution
    points: List[HeartRateRangePointOut]


class HeartRateDaySummaryOut(BaseModel):
    day: date
    average_bpm: Optional[float] = None
    min_bpm: Optional[int] = None
    max_bpm: Optional[int] = None
    total_samples: int = 0
    lowest_window: Optional[Dict[str, Any]] = None
    highest_window: Optional[Dict[str, Any]] = None
    source_breakdown: List[Dict[str, Any]] = Field(default_factory=list)


class HeartRateBatchIngestResponse(BaseModel):
    success: bool
    inserted_count: int
    duplicate_count: int
    rollup_buckets_updated: int
    live: LiveBiometricsOut


class HeartRateDeleteResponse(BaseModel):
    success: bool
    deleted_samples: int
    deleted_sessions: int
    deleted_rollups: int
