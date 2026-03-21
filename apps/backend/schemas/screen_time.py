"""
Pydantic schemas for Screen Time rollup ingestion and analytics.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class ScreenTimeBreakdownKind(str, Enum):
    TOTAL = "total"
    APP = "app"
    WEBSITE = "website"


class ScreenTimeRollupSchema(BaseModel):
    day: str = Field(..., description="YYYY-MM-DD in the device timezone")
    timezone: Optional[str] = Field(None, description="IANA timezone identifier")
    breakdown_kind: ScreenTimeBreakdownKind
    entity_key: str = Field(..., min_length=1, max_length=255)
    entity_label: str = Field(..., min_length=1, max_length=255)
    active_seconds: int = Field(..., ge=0, le=86400)
    sort_seconds: Optional[int] = Field(None, ge=0, le=86400)
    metadata_json: Optional[Dict[str, Any]] = None

    @field_validator("day")
    @classmethod
    def validate_day(cls, value: str) -> str:
        try:
            datetime.strptime(value, "%Y-%m-%d")
            return value
        except ValueError as exc:
            raise ValueError("day must be YYYY-MM-DD") from exc


class ScreenTimeIngestRequest(BaseModel):
    device_id: str = Field(..., min_length=1)
    client_event_id: str = Field(..., min_length=1)
    captured_at: str = Field(..., description="ISO8601 timestamp when rollups were captured")
    rollups: List[ScreenTimeRollupSchema] = Field(..., min_length=1, max_length=1000)
    schema_version: int = Field(1, ge=1, le=10)
    signature: str = Field(..., min_length=1)

    @field_validator("captured_at")
    @classmethod
    def validate_captured_at(cls, value: str) -> str:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            return value
        except ValueError as exc:
            raise ValueError(f"Invalid ISO8601 timestamp: {value}") from exc


class ScreenTimeIngestResult(BaseModel):
    index: int = Field(..., ge=0)
    success: bool
    stored_id: Optional[str] = None
    error: Optional[str] = None


class ScreenTimeIngestResponse(BaseModel):
    success: bool
    results: List[ScreenTimeIngestResult]
    server_time: str


class ScreenTimeSummaryResponse(BaseModel):
    success: bool
    data: Dict[str, Any]


class ScreenTimeTopItem(BaseModel):
    key: str
    label: str
    total_active_ms: int
    total_events: int = 0
    days_used: int = 0


class ScreenTimeBreakdownRow(BaseModel):
    day: str
    active_ms: int
    events_count: int = 0
    first_start_ms: Optional[int] = None
    last_end_ms: Optional[int] = None


class ScreenTimeDeviceRegisterRequest(BaseModel):
    device_name: str = Field(..., min_length=1, max_length=100)
    platform: Literal["ios", "android"] = Field(...)


class ScreenTimeDeviceRegisterResponse(BaseModel):
    device_id: str
    device_secret: str
    registered_at: str
