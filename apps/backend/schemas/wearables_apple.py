"""
Pydantic schemas for Apple Health wearables API.
Mirrors the TypeScript contracts in @ritual/shared-contracts.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Any, Literal, Dict
from datetime import datetime
from enum import Enum


class WearableSource(str, Enum):
    """Supported wearable data sources"""
    WHOOP = "whoop"
    APPLE_HEALTH = "apple_health"
    APPLE_SCREEN_TIME = "apple_screen_time"
    OURA = "oura"
    GARMIN = "garmin"
    FITBIT = "fitbit"


class MetricType(str, Enum):
    """Supported metric types - comprehensive Apple Watch data"""
    # Activity
    STEPS = "steps"
    ACTIVE_ENERGY = "active_energy"
    BASAL_ENERGY = "basal_energy"
    DISTANCE = "distance"
    FLIGHTS_CLIMBED = "flights_climbed"
    EXERCISE_TIME = "exercise_time"
    STAND_TIME = "stand_time"
    
    # Heart
    HR = "hr"
    HRV = "hrv"
    RESTING_HR = "resting_hr"
    WALKING_HR = "walking_hr"
    
    # Respiratory & Blood
    RESPIRATORY_RATE = "respiratory_rate"
    OXYGEN_SATURATION = "oxygen_saturation"
    
    # Sleep & Recovery
    SLEEP_SESSION = "sleep_session"
    SLEEP_ASLEEP = "sleep_asleep"
    SLEEP_AWAKE = "sleep_awake"
    SLEEP_REM = "sleep_rem"
    SLEEP_DEEP = "sleep_deep"
    SLEEP_CORE = "sleep_core"
    
    # Workouts & Mindfulness
    WORKOUT = "workout"
    MINDFUL_MINUTES = "mindful_minutes"

    # Body Measurements
    BODY_MASS = "body_mass"
    BODY_MASS_INDEX = "body_mass_index"
    BODY_FAT_PERCENTAGE = "body_fat_percentage"
    LEAN_BODY_MASS = "lean_body_mass"
    HEIGHT = "height"
    WAIST_CIRCUMFERENCE = "waist_circumference"

    # Nutrition
    DIETARY_ENERGY = "dietary_energy"
    DIETARY_PROTEIN = "dietary_protein"
    DIETARY_CARBS = "dietary_carbs"
    DIETARY_FAT = "dietary_fat"
    DIETARY_FIBER = "dietary_fiber"
    DIETARY_SUGAR = "dietary_sugar"
    DIETARY_WATER = "dietary_water"
    DIETARY_CAFFEINE = "dietary_caffeine"

    # Vitals (additional)
    BLOOD_PRESSURE_SYSTOLIC = "blood_pressure_systolic"
    BLOOD_PRESSURE_DIASTOLIC = "blood_pressure_diastolic"
    BLOOD_GLUCOSE = "blood_glucose"
    BODY_TEMPERATURE = "body_temperature"

    # Mobility
    WALKING_SPEED = "walking_speed"
    WALKING_STEP_LENGTH = "walking_step_length"
    WALKING_ASYMMETRY = "walking_asymmetry"

    # Screen Time
    SCREEN_TIME_TOTAL = "screen_time_total"
    SCREEN_TIME_APP_USAGE = "screen_time_app_usage"
    SCREEN_TIME_WEB_DOMAIN_USAGE = "screen_time_web_domain_usage"


class Unit(str, Enum):
    """Supported units"""
    COUNT = "count"
    BPM = "bpm"
    MS = "ms"
    KCAL = "kcal"
    SECONDS = "seconds"
    MINUTES = "minutes"
    HOURS = "hours"
    METERS = "meters"
    KILOMETERS = "km"
    MILES = "miles"
    PERCENT = "percent"
    BREATHS_PER_MINUTE = "breaths_per_minute"
    # Body measurement units
    KG = "kg"
    CM = "cm"
    # Nutrition units
    GRAMS = "g"
    MG = "mg"
    ML = "ml"
    # Vitals units
    MMHG = "mmHg"
    MMOL_PER_L = "mmol_per_L"
    CELSIUS = "celsius"
    # Mobility units
    METERS_PER_SECOND = "m_per_s"


class NormalizedMetricSchema(BaseModel):
    """
    Canonical normalized metric format for all wearable data sources.
    """
    # Identity (user_id resolved from auth, not required in request)
    source: WearableSource
    metric_type: MetricType
    
    # Time window - ISO8601 strings
    start_time: str = Field(..., description="ISO8601 start time")
    end_time: str = Field(..., description="ISO8601 end time")
    timezone: Optional[str] = Field(None, description="IANA timezone, e.g., 'America/New_York'")
    
    # Value
    value: float = Field(..., ge=0, description="Metric value (must be non-negative)")
    unit: Unit
    
    # Optional context
    confidence: Optional[float] = Field(None, ge=0, le=1, description="Confidence score 0..1")
    device_id: Optional[str] = None
    external_id: Optional[str] = Field(None, description="Source-specific ID (e.g., HealthKit sample UUID) - CRITICAL for incremental sync")
    
    # Source tracking for multi-source filtering
    source_bundle_id: Optional[str] = Field(None, description="Bundle ID of source app (e.g., com.apple.health)")
    source_device_name: Optional[str] = Field(None, description="Name of source device (e.g., Apple Watch Series 9)")
    
    # Sleep-specific: attributed date (wake day for overnight sleep)
    attributed_date: Optional[str] = Field(None, description="YYYY-MM-DD - the day this metric 'belongs to' in the UI")
    
    # Metadata
    recorded_at: Optional[str] = Field(None, description="ISO8601 timestamp when captured on device")
    aggregation_kind: Optional[Literal["point", "interval", "bucket_15m", "bucket_1h", "daily"]] = Field(
        None,
        description="Resolution of the metric payload",
    )
    rollup_window_minutes: Optional[int] = Field(
        None,
        ge=1,
        description="Bucket size in minutes for rolled-up metrics",
    )
    sample_count: Optional[int] = Field(
        None,
        ge=0,
        description="Number of source samples contributing to a rollup",
    )
    should_project_to_habit_logs: Optional[bool] = Field(
        True,
        description="Whether this record should be flattened into habit_logs",
    )
    raw_payload: Optional[Any] = Field(None, description="Original payload for debugging")
    
    @field_validator('start_time', 'end_time', 'recorded_at')
    @classmethod
    def validate_iso8601(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        try:
            # Try to parse as ISO8601
            datetime.fromisoformat(v.replace('Z', '+00:00'))
            return v
        except ValueError:
            raise ValueError(f"Invalid ISO8601 timestamp: {v}")


class AppleIngestRequest(BaseModel):
    """
    Request payload for ingesting Apple Health metrics (V1 - legacy).
    """
    device_id: str = Field(..., min_length=1, description="Device ID from registration")
    client_event_id: str = Field(..., min_length=1, description="Client-generated UUID for idempotency")
    captured_at: str = Field(..., description="ISO8601 timestamp when data was captured on device")
    metrics: List[NormalizedMetricSchema] = Field(
        ..., 
        min_length=1, 
        max_length=500,
        description="Array of normalized metrics (max 500 per request)"
    )
    hk_anchor: Optional[str] = Field(None, description="HealthKit anchor token for incremental sync")
    schema_version: int = Field(1, ge=1, le=10, description="Schema version (currently 1)")
    signature: str = Field(..., min_length=1, description="HMAC-SHA256 signature for request verification")
    
    @field_validator('captured_at')
    @classmethod
    def validate_captured_at(cls, v: str) -> str:
        try:
            datetime.fromisoformat(v.replace('Z', '+00:00'))
            return v
        except ValueError:
            raise ValueError(f"Invalid ISO8601 timestamp: {v}")


class AppleIngestRequestV2(BaseModel):
    """
    V2 Request payload with incremental sync support (added/deleted/modified).
    """
    device_id: str = Field(..., min_length=1, description="Device ID from registration")
    client_event_id: str = Field(..., min_length=1, description="Client-generated UUID for idempotency")
    captured_at: str = Field(..., description="ISO8601 timestamp when data was captured on device")
    
    # Incremental sync arrays
    added: List[NormalizedMetricSchema] = Field(
        default=[],
        max_length=500,
        description="New/updated metrics since last anchor"
    )
    deleted: List[str] = Field(
        default=[],
        max_length=500,
        description="HealthKit UUIDs of deleted samples"
    )
    modified: List[NormalizedMetricSchema] = Field(
        default=[],
        max_length=500,
        description="Modified metrics (same external_id, new values)"
    )
    
    # Anchors per metric type (for confirmation)
    anchors: Optional[Dict[str, str]] = Field(None, description="Anchors per metric type")
    
    schema_version: int = Field(2, ge=2, le=10, description="Schema version (2 for incremental)")
    signature: str = Field(..., min_length=1, description="HMAC-SHA256 signature")
    
    @field_validator('captured_at')
    @classmethod
    def validate_captured_at(cls, v: str) -> str:
        try:
            datetime.fromisoformat(v.replace('Z', '+00:00'))
            return v
        except ValueError:
            raise ValueError(f"Invalid ISO8601 timestamp: {v}")


class AppleIngestResult(BaseModel):
    """Per-metric result in the ingest response"""
    index: int = Field(..., ge=0, description="Index of the metric in the request array")
    success: bool
    stored_id: Optional[str] = Field(None, description="Backend-assigned ID if stored successfully")
    error: Optional[str] = Field(None, description="Error message if ingestion failed")


class AppleIngestResponse(BaseModel):
    """Response from the ingest endpoint (V1)"""
    success: bool = Field(..., description="True if at least one metric was stored")
    results: List[AppleIngestResult]
    server_time: str = Field(..., description="ISO8601 server time when request was processed")
    next_poll_seconds: Optional[int] = Field(None, ge=0, description="Suggested seconds until next poll")


class DeleteResult(BaseModel):
    """Result of a deletion operation"""
    external_id: str = Field(..., description="HealthKit UUID that was requested to be deleted")
    success: bool
    error: Optional[str] = None


class AppleIngestResponseV2(BaseModel):
    """Response from the V2 ingest endpoint with incremental sync support"""
    success: bool = Field(..., description="True if at least one operation succeeded")
    added_results: List[AppleIngestResult] = Field(default=[], description="Results for added metrics")
    deleted_results: List[DeleteResult] = Field(default=[], description="Results for deleted metrics")
    modified_results: List[AppleIngestResult] = Field(default=[], description="Results for modified metrics")
    server_time: str = Field(..., description="ISO8601 server time when request was processed")
    next_poll_seconds: Optional[int] = Field(None, ge=0, description="Suggested seconds until next poll")
    # Confirmed anchors - client should only update local anchors after receiving this
    confirmed_anchors: Optional[Dict[str, str]] = Field(None, description="Confirmed anchors per metric type")


class SyncStatusResponse(BaseModel):
    """Device sync status for desktop UI"""
    device_id: str
    device_name: str
    platform: str
    is_connected: bool = True
    last_successful_sync: Optional[str] = None
    last_sync_attempt: Optional[str] = None
    last_error: Optional[str] = None
    last_error_time: Optional[str] = None
    metrics_synced_today: int = 0
    background_sync_enabled: bool = True
    offline_queue_count: int = 0


class DeviceRegisterRequest(BaseModel):
    """Request to register a new device"""
    device_name: str = Field(..., min_length=1, max_length=100, description="User-friendly device name")
    platform: Literal["ios", "android"] = Field(..., description="Platform identifier")


class DeviceRegisterResponse(BaseModel):
    """Response from device registration"""
    device_id: str = Field(..., description="Assigned device ID (store in Keychain)")
    device_secret: str = Field(..., description="Device secret for request signing (store securely)")
    registered_at: str = Field(..., description="ISO8601 timestamp when device was registered")


class DeviceStatusResponse(BaseModel):
    """Device status information"""
    device_id: str
    device_name: str
    platform: str
    registered_at: str
    last_sync_at: Optional[str] = None
    is_active: bool
