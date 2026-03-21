"""
Provider-neutral wearable API schemas.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class WearableProviderName(str, Enum):
    APPLE_HEALTH = "apple_health"
    WHOOP = "whoop"
    GARMIN = "garmin"
    OURA = "oura"
    FITBIT = "fitbit"


class WearableAuthMethod(str, Enum):
    SDK = "sdk"
    OAUTH = "oauth"
    IMPORT = "import"


class WearableConnectionStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ERROR = "error"
    REVOKED = "revoked"


class WearableCapability(BaseModel):
    provider: WearableProviderName
    display_name: str
    auth_method: WearableAuthMethod
    supports_sync: bool = True
    supports_webhook: bool = False
    supports_import_fallback: bool = False
    supports_metric_selection: bool = True
    supports_backfill: bool = True


class WearableConnectionRead(BaseModel):
    id: str
    provider: WearableProviderName
    auth_method: WearableAuthMethod
    status: WearableConnectionStatus
    provider_user_id: Optional[str] = None
    last_sync_at: Optional[str] = None
    last_successful_sync_at: Optional[str] = None
    last_error_json: Optional[Dict[str, Any]] = None
    tracked_metrics: List[str] = Field(default_factory=list)
    source_count: int = 0
    auto_sync_enabled: bool = True
    sync_hour: Optional[int] = None
    auto_sync_mode: Optional[str] = None
    auto_sync_note: Optional[str] = None
    latest_data_date: Optional[str] = None
    latest_sleep_date: Optional[str] = None
    latest_upstream_sleep_date: Optional[str] = None
    is_upstream_stale: bool = False
    stale_message: Optional[str] = None


class WearableSourceRead(BaseModel):
    id: str
    provider: WearableProviderName
    source_kind: str
    external_source_id: Optional[str] = None
    external_source_name: Optional[str] = None
    device_name: Optional[str] = None
    device_model: Optional[str] = None
    device_type: Optional[str] = None
    platform: Optional[str] = None
    source_bundle_id: Optional[str] = None
    priority_rank: int = 100
    is_active: bool = True
    metadata_json: Optional[Dict[str, Any]] = None


class WearableSampleRead(BaseModel):
    id: str
    provider: WearableProviderName
    metric_type: str
    provider_metric_type: Optional[str] = None
    external_id: Optional[str] = None
    recorded_at: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    attributed_date: Optional[str] = None
    value: float
    unit: str
    aggregation_kind: str
    confidence: Optional[float] = None
    timezone: Optional[str] = None
    source_id: Optional[str] = None
    attributes_json: Optional[Dict[str, Any]] = None
    deleted_at: Optional[str] = None


class WearableEventRead(BaseModel):
    id: str
    provider: WearableProviderName
    event_type: str
    provider_event_type: Optional[str] = None
    external_id: Optional[str] = None
    start_time: str
    end_time: str
    attributed_date: Optional[str] = None
    timezone: Optional[str] = None
    title: Optional[str] = None
    summary_value: Optional[float] = None
    summary_unit: Optional[str] = None
    source_id: Optional[str] = None
    details_json: Optional[Dict[str, Any]] = None
    deleted_at: Optional[str] = None


class WearableSyncRunRead(BaseModel):
    id: str
    provider: WearableProviderName
    trigger: str
    status: str
    started_at: str
    completed_at: Optional[str] = None
    items_seen: int = 0
    items_written: int = 0
    items_updated: int = 0
    items_deleted: int = 0
    error_json: Optional[Dict[str, Any]] = None
    metadata_json: Optional[Dict[str, Any]] = None


class WearableConnectionsResponse(BaseModel):
    providers: List[WearableCapability]
    connections: List[WearableConnectionRead]


class WearableSyncResponse(BaseModel):
    success: bool
    provider: WearableProviderName
    sync_run: WearableSyncRunRead
    message: Optional[str] = None


class WearableConnectionActionResponse(BaseModel):
    success: bool
    provider: WearableProviderName
    connection: Optional[WearableConnectionRead] = None
    authorization_url: Optional[str] = None
    message: Optional[str] = None


class WearableQueryParams(BaseModel):
    provider: Optional[WearableProviderName] = None
    metric_type: Optional[str] = None
    event_type: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    include_deleted: bool = False
    limit: int = Field(100, ge=1, le=500)
