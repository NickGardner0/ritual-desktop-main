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


class WearableDeliveryMode(str, Enum):
    CLIENT_SDK = "client_sdk"
    REST_PULL = "rest_pull"
    WEBHOOK_STREAM = "webhook_stream"
    WEBHOOK_PING = "webhook_ping"
    FILE_IMPORT = "file_import"


class WearableLiveSyncMode(str, Enum):
    OFF = "off"
    DAILY_ONLY = "daily_only"
    GRANULAR = "granular"


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
    delivery_modes: List[WearableDeliveryMode] = Field(default_factory=list)
    supports_webhook: bool = False
    supports_import_fallback: bool = False
    supports_metric_selection: bool = True
    supports_backfill: bool = True
    supports_async_backfill: bool = False
    supports_live_sync_mode_selection: bool = False
    max_historical_days: Optional[int] = None
    default_live_sync_mode: WearableLiveSyncMode = WearableLiveSyncMode.DAILY_ONLY
    supports_anchor_confirmed_ingest: bool = False


class WearableSyncPlanRead(BaseModel):
    provider: WearableProviderName
    metric_type: str
    sync_mode: WearableLiveSyncMode
    delivery_mode: WearableDeliveryMode
    backfill_mode: str
    safe_history_days: int
    projects_to_habit_logs: bool = True
    capability_provider: Optional[WearableProviderName] = None


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
    capability: Optional[WearableCapability] = None
    sync_plans: List[WearableSyncPlanRead] = Field(default_factory=list)


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


class WearableSourceSummaryRead(BaseModel):
    """Compact source payload embedded in query results."""

    id: str
    provider: str
    source_kind: str
    device_name: Optional[str] = None
    device_model: Optional[str] = None
    device_type: Optional[str] = None
    platform: Optional[str] = None
    priority_rank: int
    source_bundle_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)


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
    rollup_level: Optional[str] = None
    rollup_window_minutes: Optional[int] = None
    sample_count: Optional[int] = None
    should_project_to_habit_logs: Optional[bool] = None
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
    limit: int = Field(100, ge=1, le=5000)


class WearableTimelineItemRead(BaseModel):
    id: str
    kind: str
    provider: Optional[str] = None
    metric_type: Optional[str] = None
    event_type: Optional[str] = None
    habit_id: Optional[str] = None
    habit_name: Optional[str] = None
    title: Optional[str] = None
    timestamp: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    attributed_date: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    aggregation_kind: Optional[str] = None
    rollup_level: Optional[str] = None
    rollup_window_minutes: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    source_device_name: Optional[str] = None


class WearableTimelineResponse(BaseModel):
    items: List[WearableTimelineItemRead]
    next_cursor: Optional[str] = None


class WearableSeriesPointRead(BaseModel):
    timestamp: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    value: float
    unit: Optional[str] = None
    provider: Optional[str] = None
    metric_type: str
    aggregation_kind: Optional[str] = None
    rollup_level: Optional[str] = None
    rollup_window_minutes: Optional[int] = None
    attributed_date: Optional[str] = None
    source_device_name: Optional[str] = None
    selected_source: Optional[WearableSourceSummaryRead] = None


class WearableSeriesResponse(BaseModel):
    metric_type: str
    resolution: str
    resolved_resolution: Optional[str] = None
    selected_source: Optional[WearableSourceSummaryRead] = None
    points: List[WearableSeriesPointRead]


class WearableDailyMetricValueRead(BaseModel):
    value: float
    unit: Optional[str] = None
    aggregation: Optional[str] = None
    provider: Optional[str] = None
    selected_source: Optional[WearableSourceSummaryRead] = None


class WearableDailyTotalRead(BaseModel):
    date: str
    metrics: Dict[str, WearableDailyMetricValueRead]


class WearableDailyTotalsResponse(BaseModel):
    days: List[WearableDailyTotalRead]


class WearableIngestJobRead(BaseModel):
    id: str
    batch_id: Optional[str] = None
    user_id: str
    provider: WearableProviderName
    job_type: str
    trigger: str
    status: str
    metric_scope: Optional[Dict[str, Any]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    attempts: int = 0
    max_attempts: int = 3
    payload: Optional[Dict[str, Any]] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None
    idempotency_key: Optional[str] = None
    sync_run_id: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class WearableIngestJobBatchRead(BaseModel):
    id: str
    provider: Optional[WearableProviderName] = None
    requested_by_user_id: Optional[str] = None
    trigger: Optional[str] = None
    status: str
    total_jobs: int = 0
    completed_jobs: int = 0
    failed_jobs: int = 0
    metadata: Optional[Dict[str, Any]] = None
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class WearableIngestJobsResponse(BaseModel):
    jobs: List[WearableIngestJobRead]
    count: int


class WearableRawPayloadRead(BaseModel):
    id: str
    user_id: str
    provider: WearableProviderName
    direction: str
    external_id: Optional[str] = None
    payload_sha256: str
    received_at: str
    expires_at: Optional[str] = None
    normalization_error: Optional[Dict[str, Any]] = None


class WearableRawPayloadsResponse(BaseModel):
    payloads: List[WearableRawPayloadRead]
    count: int


class WearableOutboxEventRead(BaseModel):
    id: str
    user_id: str
    provider: WearableProviderName
    event_type: str
    delivery_target: str
    related_record_kind: str
    related_record_id: str
    status: str
    attempts: int = 0
    max_attempts: int = 5
    payload: Optional[Dict[str, Any]] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None
    created_at: str
    available_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class WearableOutboxEventsResponse(BaseModel):
    events: List[WearableOutboxEventRead]
    count: int
