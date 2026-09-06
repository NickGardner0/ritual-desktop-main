"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



class WhoopIntegrationDB(Base):
    """Whoop integration model for database"""
    __tablename__ = "whoop_integrations"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, unique=True)
    whoop_user_id = Column(String, nullable=False)
    access_token = Column(String, nullable=False)
    refresh_token = Column(String)
    token_expires_at = Column(DateTime, nullable=False)
    connected_at = Column(DateTime, default=_utcnow_naive)
    last_sync_at = Column(DateTime)
    is_active = Column(Boolean, default=True)
    whoop_sync_hour = Column(Integer, default=9)  # Preferred sync hour (0-23), defaults to 9 AM
    scope = Column(String, nullable=True)  # OAuth scopes granted during authorization

    # Relationships
    user = orm_relationship("UserDB", backref="whoop_integration")





class WearableConnectionDB(Base):
    """Canonical connection state for a wearable provider."""
    __tablename__ = "wearable_connections"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    provider = Column(String, nullable=False)
    auth_method = Column(String, nullable=False)  # sdk, oauth, import
    provider_user_id = Column(String, nullable=True)
    status = Column(String, nullable=False, default="active")  # active, paused, error, revoked
    access_token = Column(String, nullable=True)
    refresh_token = Column(String, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    scopes_json = Column(Text, nullable=True)
    settings_json = Column(Text, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_successful_sync_at = Column(DateTime, nullable=True)
    last_error_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_wearable_connections_user_provider", "user_id", "provider", unique=True),
    )





class WearableSourceDB(Base):
    """Physical or logical origin for canonical wearable records."""
    __tablename__ = "wearable_sources"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("wearable_connections.id"), nullable=True)
    provider = Column(String, nullable=False)
    source_kind = Column(String, nullable=False)  # device, account, import
    external_source_id = Column(String, nullable=True)
    external_source_name = Column(String, nullable=True)
    device_name = Column(String, nullable=True)
    device_model = Column(String, nullable=True)
    device_type = Column(String, nullable=True)
    platform = Column(String, nullable=True)
    source_bundle_id = Column(String, nullable=True)
    priority_rank = Column(Integer, nullable=False, default=100)
    is_active = Column(Boolean, default=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    connection = orm_relationship("WearableConnectionDB")

    __table_args__ = (
        Index("idx_wearable_sources_user_provider_external", "user_id", "provider", "external_source_id", unique=False),
    )





class WearableRawPayloadDB(Base):
    """Debug/audit store for upstream wearable payloads."""
    __tablename__ = "wearable_raw_payloads"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("wearable_connections.id"), nullable=True)
    provider = Column(String, nullable=False)
    direction = Column(String, nullable=False)  # sdk_ingest, oauth_pull, webhook, import
    external_id = Column(String, nullable=True)
    payload_sha256 = Column(String, nullable=False)
    payload_json = Column(Text, nullable=False)
    received_at = Column(DateTime, default=_utcnow_naive)
    expires_at = Column(DateTime, nullable=True)
    normalization_error_json = Column(Text, nullable=True)

    user = orm_relationship("UserDB")
    connection = orm_relationship("WearableConnectionDB")

    __table_args__ = (
        Index("idx_wearable_raw_payloads_provider_received", "provider", "received_at"),
    )





class WearableSampleDB(Base):
    """Canonical scalar and time-series wearable data."""
    __tablename__ = "wearable_samples"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("wearable_connections.id"), nullable=True)
    source_id = Column(String, ForeignKey("wearable_sources.id"), nullable=True)
    provider = Column(String, nullable=False)
    metric_type = Column(String, nullable=False)
    provider_metric_type = Column(String, nullable=True)
    external_id = Column(String, nullable=True)
    recorded_at = Column(DateTime, nullable=True)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    attributed_date = Column(String, nullable=True)
    value = Column(Float, nullable=False)
    unit = Column(String, nullable=False)
    aggregation_kind = Column(String, nullable=False, default="point")
    rollup_level = Column(String, nullable=False, default="raw")
    rollup_window_minutes = Column(Integer, nullable=True)
    sample_count = Column(Integer, nullable=True)
    should_project_to_habit_logs = Column(Boolean, nullable=False, default=True)
    confidence = Column(Float, nullable=True)
    timezone = Column(String, nullable=True)
    attributes_json = Column(Text, nullable=True)
    raw_payload_id = Column(String, ForeignKey("wearable_raw_payloads.id"), nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    deleted_at = Column(DateTime, nullable=True)

    user = orm_relationship("UserDB")
    connection = orm_relationship("WearableConnectionDB")
    source = orm_relationship("WearableSourceDB")
    raw_payload = orm_relationship("WearableRawPayloadDB")

    __table_args__ = (
        Index("idx_wearable_samples_user_metric_recorded", "user_id", "metric_type", "recorded_at"),
        Index("idx_wearable_samples_user_provider_date", "user_id", "provider", "attributed_date"),
        Index("idx_wearable_samples_user_provider_external", "user_id", "provider", "external_id"),
        Index("idx_wearable_samples_user_metric_start", "user_id", "metric_type", "start_time"),
        Index("idx_wearable_samples_user_metric_date_rollup", "user_id", "metric_type", "attributed_date", "rollup_level"),
    )





class WearableEventDB(Base):
    """Canonical interval-based wearable records such as sleep sessions and workouts."""
    __tablename__ = "wearable_events"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("wearable_connections.id"), nullable=True)
    source_id = Column(String, ForeignKey("wearable_sources.id"), nullable=True)
    provider = Column(String, nullable=False)
    event_type = Column(String, nullable=False)
    provider_event_type = Column(String, nullable=True)
    external_id = Column(String, nullable=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    attributed_date = Column(String, nullable=True)
    timezone = Column(String, nullable=True)
    title = Column(String, nullable=True)
    summary_value = Column(Float, nullable=True)
    summary_unit = Column(String, nullable=True)
    details_json = Column(Text, nullable=True)
    raw_payload_id = Column(String, ForeignKey("wearable_raw_payloads.id"), nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    deleted_at = Column(DateTime, nullable=True)

    user = orm_relationship("UserDB")
    connection = orm_relationship("WearableConnectionDB")
    source = orm_relationship("WearableSourceDB")
    raw_payload = orm_relationship("WearableRawPayloadDB")

    __table_args__ = (
        Index("idx_wearable_events_user_type_start", "user_id", "event_type", "start_time"),
        Index("idx_wearable_events_user_provider_external", "user_id", "provider", "external_id"),
        Index("idx_wearable_events_user_type_date_start", "user_id", "event_type", "attributed_date", "start_time"),
    )





class WearableSyncCursorDB(Base):
    """Per-provider cursor/checkpoint state."""
    __tablename__ = "wearable_sync_cursors"

    id = Column(String, primary_key=True)
    connection_id = Column(String, ForeignKey("wearable_connections.id"), nullable=False)
    source_id = Column(String, ForeignKey("wearable_sources.id"), nullable=True)
    cursor_key = Column(String, nullable=False)
    cursor_type = Column(String, nullable=False)  # anchor, page_token, timestamp, webhook_checkpoint
    cursor_value = Column(Text, nullable=False)
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    connection = orm_relationship("WearableConnectionDB")
    source = orm_relationship("WearableSourceDB")

    __table_args__ = (
        Index("idx_wearable_sync_cursors_unique", "connection_id", "source_id", "cursor_key", unique=True),
    )





class WearableSyncRunDB(Base):
    """Observable sync runs for troubleshooting and resumability."""
    __tablename__ = "wearable_sync_runs"

    id = Column(String, primary_key=True)
    connection_id = Column(String, ForeignKey("wearable_connections.id"), nullable=True)
    provider = Column(String, nullable=False)
    trigger = Column(String, nullable=False)  # manual, scheduled, webhook, background_sdk, backfill, import
    status = Column(String, nullable=False, default="running")  # running, success, partial, failed
    started_at = Column(DateTime, default=_utcnow_naive)
    completed_at = Column(DateTime, nullable=True)
    items_seen = Column(Integer, default=0)
    items_written = Column(Integer, default=0)
    items_updated = Column(Integer, default=0)
    items_deleted = Column(Integer, default=0)
    error_json = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)

    connection = orm_relationship("WearableConnectionDB")





class WearableIngestJobBatchDB(Base):
    """Batch grouping for queued wearable ingest jobs."""
    __tablename__ = "wearable_ingest_job_batches"

    id = Column(String, primary_key=True)
    provider = Column(String, nullable=True)
    requested_by_user_id = Column(String, ForeignKey("users.id"), nullable=True)
    trigger = Column(String, nullable=True)
    status = Column(String, nullable=False, default="queued")  # queued, running, succeeded, failed, canceled
    total_jobs = Column(Integer, nullable=False, default=0)
    completed_jobs = Column(Integer, nullable=False, default=0)
    failed_jobs = Column(Integer, nullable=False, default=0)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    requested_by_user = orm_relationship("UserDB")





class WearableIngestJobDB(Base):
    """DB-backed queue of heavy wearable ingest jobs."""
    __tablename__ = "wearable_ingest_jobs"

    id = Column(String, primary_key=True)
    batch_id = Column(String, ForeignKey("wearable_ingest_job_batches.id"), nullable=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("wearable_connections.id"), nullable=True)
    provider = Column(String, nullable=False)
    job_type = Column(String, nullable=False)  # provider_backfill, raw_payload_replay, apple_legacy_backfill
    trigger = Column(String, nullable=False, default="manual")
    status = Column(String, nullable=False, default="queued")  # queued, running, succeeded, failed, canceled
    metric_scope_json = Column(Text, nullable=True)
    start_date = Column(String, nullable=True)
    end_date = Column(String, nullable=True)
    payload_json = Column(Text, nullable=True)
    result_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    idempotency_key = Column(String, nullable=True)
    sync_run_id = Column(String, ForeignKey("wearable_sync_runs.id"), nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    last_attempt_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    batch = orm_relationship("WearableIngestJobBatchDB")
    user = orm_relationship("UserDB")
    connection = orm_relationship("WearableConnectionDB")
    sync_run = orm_relationship("WearableSyncRunDB")

    __table_args__ = (
        Index("idx_wearable_ingest_jobs_status_created", "status", "created_at"),
        Index("idx_wearable_ingest_jobs_user_provider", "user_id", "provider"),
        Index("idx_wearable_ingest_jobs_idempotency", "idempotency_key", unique=True),
    )





class WearableOutboxEventDB(Base):
    """Durable internal wearable event outbox for downstream app features."""
    __tablename__ = "wearable_outbox_events"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("wearable_connections.id"), nullable=True)
    source_id = Column(String, ForeignKey("wearable_sources.id"), nullable=True)
    provider = Column(String, nullable=False)
    event_type = Column(String, nullable=False)
    delivery_target = Column(String, nullable=False, default="internal")
    related_record_kind = Column(String, nullable=False)  # sample, event, job
    related_record_id = Column(String, nullable=False)
    status = Column(String, nullable=False, default="queued")  # queued, running, succeeded, failed, canceled
    payload_json = Column(Text, nullable=True)
    result_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    dedupe_key = Column(String, nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=5)
    available_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    user = orm_relationship("UserDB")
    connection = orm_relationship("WearableConnectionDB")
    source = orm_relationship("WearableSourceDB")

    __table_args__ = (
        Index("idx_wearable_outbox_events_status_available", "status", "available_at"),
        Index("idx_wearable_outbox_events_user_provider", "user_id", "provider"),
        Index("idx_wearable_outbox_events_dedupe", "dedupe_key", unique=True),
    )





# ================================
# WEARABLE METRICS - Apple Health + Multi-source support
# ================================

class WearableDeviceDB(Base):
    """
    Registered wearable device for a user.
    Each device gets a unique ID and secret for request signing.
    """
    __tablename__ = "wearable_devices"
    
    id = Column(String, primary_key=True)  # UUID
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    provider = Column(String, nullable=False, default="apple_health")
    connection_id = Column(String, ForeignKey("wearable_connections.id"), nullable=True)
    device_name = Column(String, nullable=False)  # e.g., "Nick's iPhone"
    platform = Column(String, nullable=False)  # ios, android
    device_secret_hash = Column(String, nullable=False)  # HMAC key (stored plaintext for now, can encrypt later)
    registered_at = Column(DateTime, default=_utcnow_naive)
    last_sync_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    sdk_version = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    
    # Relationships - using back_populates instead of backref to avoid conflicts
    user = orm_relationship("UserDB")  # No backref to avoid mapper conflicts
    connection = orm_relationship("WearableConnectionDB")
    metrics = orm_relationship("WearableMetricDB", back_populates="device", cascade="all, delete-orphan")
    ingest_events = orm_relationship("WearableIngestEventDB", back_populates="device", cascade="all, delete-orphan")





class WearableMetricDB(Base):
    """
    Normalized wearable metric storage.
    Supports multiple sources: apple_health, whoop, oura, garmin, fitbit.
    """
    __tablename__ = "wearable_metrics"
    
    id = Column(String, primary_key=True)  # UUID
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    device_id = Column(String, ForeignKey("wearable_devices.id"), nullable=True)
    
    # Source and type
    source = Column(String, nullable=False)  # whoop, apple_health, oura, garmin, fitbit
    metric_type = Column(String, nullable=False)  # sleep_session, hr, hrv, steps, active_energy, etc.
    
    # Time window
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    timezone = Column(String, nullable=True)  # e.g., "America/New_York"
    
    # Value
    value = Column(Float, nullable=False)
    unit = Column(String, nullable=False)  # count, bpm, ms, kcal, seconds, minutes, hours
    
    # Context
    confidence = Column(Float, nullable=True)  # 0..1
    external_id = Column(String, nullable=True)  # Source-specific ID (e.g., HealthKit sample UUID)
    
    # Metadata
    recorded_at = Column(DateTime, nullable=True)  # When captured on device
    raw_payload = Column(Text, nullable=True)  # JSON string of original data
    created_at = Column(DateTime, default=_utcnow_naive)
    
    # Relationships - using back_populates instead of backref to avoid conflicts
    user = orm_relationship("UserDB")  # No backref to avoid mapper conflicts
    device = orm_relationship("WearableDeviceDB", back_populates="metrics")





class WearableIngestEventDB(Base):
    """
    Tracks ingest events for idempotency and debugging.
    Each client_event_id should only be processed once per device.
    """
    __tablename__ = "wearable_ingest_events"
    
    id = Column(String, primary_key=True)  # UUID
    device_id = Column(String, ForeignKey("wearable_devices.id"), nullable=False)
    client_event_id = Column(String, nullable=False)  # UUID from client
    metrics_count = Column(Integer, nullable=False)
    success_count = Column(Integer, nullable=False)
    error_count = Column(Integer, nullable=False)
    received_at = Column(DateTime, default=_utcnow_naive)
    status = Column(String, nullable=False)  # success, partial, failed
    
    # Relationships
    device = orm_relationship("WearableDeviceDB", back_populates="ingest_events")





class ScreenTimeRollupDB(Base):
    """
    Daily Screen Time rollups uploaded from the iPhone companion app.
    Stores only aggregate usage, never raw URL/path/browser history.
    """
    __tablename__ = "screen_time_rollups"

    id = Column(String, primary_key=True)  # UUID
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    device_id = Column(String, ForeignKey("wearable_devices.id"), nullable=False)
    provider = Column(String, nullable=False, default="apple_screen_time")
    day = Column(String, nullable=False)  # YYYY-MM-DD in device local time
    timezone = Column(String, nullable=True)
    breakdown_kind = Column(String, nullable=False)  # total, app, website
    entity_key = Column(String, nullable=False)  # __total__, bundle id, or domain
    entity_label = Column(String, nullable=False)  # display label for UI
    active_seconds = Column(Integer, nullable=False, default=0)
    sort_seconds = Column(Integer, nullable=False, default=0)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    device = orm_relationship("WearableDeviceDB")


# ================================
# HEART RATE BIOMETRICS - WHOOP BLE canonical stream
# ================================




# ================================
# HEART RATE BIOMETRICS - WHOOP BLE canonical stream
# ================================

class HeartRateSessionDB(Base):
    """
    Collector session created by the iPhone companion or optional Mac fallback.
    """
    __tablename__ = "heart_rate_sessions"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    source_type = Column(String, nullable=False)  # whoop_ble_ios, whoop_ble_mac
    source_device_id = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")  # active, disconnected, ended
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    app_version = Column(String, nullable=True)
    device_model = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_heart_rate_sessions_user_started", "user_id", "started_at"),
        Index("idx_heart_rate_sessions_user_status", "user_id", "status"),
    )





class HeartRateSampleDB(Base):
    """
    Raw live heart-rate samples received from BLE collectors.
    """
    __tablename__ = "heart_rate_samples"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    session_id = Column(String, ForeignKey("heart_rate_sessions.id"), nullable=False)
    source_type = Column(String, nullable=False)
    source_device_id = Column(String, nullable=False)
    bpm_raw = Column(Integer, nullable=False)
    bpm_display = Column(Integer, nullable=False)
    quality_score = Column(Float, nullable=True)
    is_outlier = Column(Boolean, nullable=False, default=False)
    rr_intervals_json = Column(Text, nullable=True)
    contact_detected = Column(Boolean, nullable=True)
    received_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=_utcnow_naive)

    user = orm_relationship("UserDB")
    session = orm_relationship("HeartRateSessionDB")

    __table_args__ = (
        Index("idx_heart_rate_samples_user_received", "user_id", "received_at"),
        Index("idx_heart_rate_samples_user_source_received", "user_id", "source_type", "received_at"),
        Index("idx_heart_rate_samples_session_received", "session_id", "received_at"),
    )





class HeartRateRollup1mDB(Base):
    """
    One-minute rollups derived from raw heart-rate samples for charts and overlays.
    """
    __tablename__ = "heart_rate_1m_rollups"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    bucket_start = Column(DateTime, nullable=False)
    source_preference = Column(String, nullable=False)
    sample_count = Column(Integer, nullable=False)
    bpm_avg = Column(Float, nullable=False)
    bpm_min = Column(Integer, nullable=False)
    bpm_max = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=_utcnow_naive)

    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_heart_rate_rollups_user_bucket_source", "user_id", "bucket_start", "source_preference", unique=True),
    )





class LiveBiometricsStateDB(Base):
    """
    Current live heart-rate snapshot per user.
    """
    __tablename__ = "live_biometrics_state"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    current_bpm = Column(Integer, nullable=True)
    current_source_type = Column(String, nullable=True)
    latest_sample_at = Column(DateTime, nullable=True)
    connection_state = Column(String, nullable=True)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")


# ================================
# RITUAL WATCHER - Computer Activity Tracking
# ================================


