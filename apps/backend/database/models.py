"""
SQLAlchemy database models
"""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship as orm_relationship
from datetime import datetime, timezone

Base = declarative_base()

def _utcnow_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)

class UserDB(Base):
    """User model for database"""
    __tablename__ = "users"
    
    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    full_name = Column(String)
    
    phone_number = Column(String, nullable=True)
    sms_welcome_sent_at = Column(DateTime, nullable=True)
    timezone = Column(String, nullable=True)  # e.g., "America/New_York"
    turso_db_name = Column(String, nullable=True)
    turso_db_url = Column(String, nullable=True)
    turso_provisioned_at = Column(DateTime, nullable=True)
    turso_migrated_at = Column(DateTime, nullable=True)

    # Onboarding data
    age_bracket = Column(String)
    gender = Column(String)
    country = Column(String)
    tracking_interests = Column(Text)  # JSON string array
    wearable_devices = Column(String)
    onboarding_completed = Column(Boolean, default=False)
    
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    
    # Relationships
    habits = orm_relationship("HabitDB", back_populates="user", cascade="all, delete-orphan")

class HabitDB(Base):
    """Habit model for database"""
    __tablename__ = "habits"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    icon = Column(String)
    is_custom = Column(Boolean, default=False)
    integration_source = Column(String)  # 'apple_health', 'whoop', 'oura', 'fitbit', 'garmin', null
    unit_type = Column(String)
    sensor_type = Column(String)  # 'Apple Watch', 'Whoop', 'Manual', etc.
    metric_type = Column(String)  # For wearables: 'steps', 'hr', 'hrv', 'sleep_session', etc.
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    
    # Relationships
    user = orm_relationship("UserDB", back_populates="habits")
    logs = orm_relationship("HabitLogDB", back_populates="habit", cascade="all, delete-orphan")

class HabitLogDB(Base):
    """Habit log model for database"""
    __tablename__ = "habit_logs"
    
    id = Column(String, primary_key=True)
    habit_id = Column(String, ForeignKey("habits.id"), nullable=False)
    habit_name = Column(String)  # Denormalized for performance and historical accuracy
    duration = Column(Integer)  # in seconds
    amount = Column(Float)
    date = Column(String, nullable=False)  # ISO date string
    completed_at = Column(String)  # ISO datetime string
    status = Column(String, nullable=False, default="completed")  # completed, skipped, missed
    notes = Column(Text)
    log_metadata = Column(Text)  # JSON string for additional data (e.g. Whoop sleep_onset, sleep_end)
    client_event_id = Column(String, nullable=True)  # Phase 5A: For idempotency checking
    source = Column(String, nullable=True)  # Phase 5A: Source of the log (ai_log_v2, screenshot, manual)
    origin_record_kind = Column(String, nullable=True)  # sample, event
    origin_record_id = Column(String, nullable=True)  # canonical wearable record ID
    
    # Import tracking fields (Phase: Robust Import System)
    import_run_id = Column(String, ForeignKey("import_runs.id", ondelete="SET NULL"), nullable=True)
    source_id = Column(String, nullable=True)  # Original record ID from wearable/source if available
    dedupe_key = Column(String, nullable=True, index=True)  # SHA256 hash for deduplication
    # Note: updated_at column removed - not synced to Turso Cloud. Use completed_at for now.

    # ── Location enrichment (Phase: Location Tracking) ──────────────────
    # Populated server-side at habit log creation by services.location.enrichment
    location_lat = Column(Float, nullable=True)
    location_lon = Column(Float, nullable=True)
    location_accuracy_m = Column(Float, nullable=True)
    location_source = Column(String, nullable=True)  # ios_scls, mac_one_shot, etc.
    location_place_label = Column(String, nullable=True)  # reverse-geocoded label
    location_confidence = Column(Float, nullable=True)  # 0.0-1.0
    location_resolved_at = Column(BigInteger, nullable=True)  # ms since epoch when resolver ran
    location_signal_age_ms = Column(BigInteger, nullable=True)  # how stale the signal was

    # Relationships
    habit = orm_relationship("HabitDB", back_populates="logs")
    import_run = orm_relationship("ImportRunDB", back_populates="logs")

    __table_args__ = (
        Index("idx_habit_logs_habit_date", "habit_id", "date"),
        Index("idx_habit_logs_habit_status_date", "habit_id", "status", "date"),
    )


class MetricFactRebuildRunDB(Base):
    """Audit record for derived metric fact rebuilds and reconciliation runs."""
    __tablename__ = "metric_fact_rebuild_runs"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    mode = Column(String, nullable=False, default="dry_run")  # dry_run, apply, reconcile
    status = Column(String, nullable=False, default="running")  # running, success, failed
    start_date = Column(String, nullable=True)
    end_date = Column(String, nullable=True)
    source_families_json = Column(Text, nullable=True)
    habit_ids_json = Column(Text, nullable=True)
    facts_seen = Column(Integer, nullable=False, default=0)
    facts_written = Column(Integer, nullable=False, default=0)
    facts_unchanged = Column(Integer, nullable=False, default=0)
    legacy_fallback_count = Column(Integer, nullable=False, default=0)
    summary_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    started_at = Column(DateTime, default=_utcnow_naive)
    completed_at = Column(DateTime, nullable=True)

    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_metric_fact_runs_user_created", "user_id", "created_at"),
        Index("idx_metric_fact_runs_user_status", "user_id", "status"),
    )


class MetricDailyFactDB(Base):
    """Derived daily metric value used by product-facing analytics surfaces."""
    __tablename__ = "metric_daily_facts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    habit_id = Column(String, ForeignKey("habits.id", ondelete="CASCADE"), nullable=False)
    habit_name = Column(String, nullable=True)
    metric_key = Column(String, nullable=False)
    date = Column(String, nullable=False)
    value = Column(Float, nullable=False, default=0)
    unit = Column(String, nullable=False, default="count")
    source_family = Column(String, nullable=False)  # manual, wearable, plaid, watcher, legacy_habit_log
    provider = Column(String, nullable=True)
    record_count = Column(Integer, nullable=False, default=0)
    provenance_json = Column(Text, nullable=True)
    rebuild_run_id = Column(String, ForeignKey("metric_fact_rebuild_runs.id"), nullable=True)
    status = Column(String, nullable=False, default="complete")
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    habit = orm_relationship("HabitDB")
    rebuild_run = orm_relationship("MetricFactRebuildRunDB")

    __table_args__ = (
        Index("idx_metric_daily_facts_unique", "user_id", "habit_id", "metric_key", "date", unique=True),
        Index("idx_metric_daily_facts_user_date", "user_id", "date"),
        Index("idx_metric_daily_facts_user_habit_date", "user_id", "habit_id", "date"),
        Index("idx_metric_daily_facts_user_metric_date", "user_id", "metric_key", "date"),
    )


class ScheduledBlockDB(Base):
    """Calendar scheduled block model for week-view task planning."""
    __tablename__ = "scheduled_blocks"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    notes = Column(Text)
    day = Column(String, nullable=False)  # YYYY-MM-DD (user local date)
    start_minutes = Column(Integer, nullable=False)  # Minutes from midnight (0..1439)
    end_minutes = Column(Integer, nullable=False)  # Minutes from midnight (1..1440)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB", backref="scheduled_blocks")


# ================================
# IMPORT SYSTEM - Robust Import Infrastructure
# ================================

class ImportRunDB(Base):
    """
    Tracks every import as a first-class object for undo, progress tracking, and audit.
    """
    __tablename__ = "import_runs"
    
    id = Column(String, primary_key=True)  # UUID
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    
    # Source info
    source = Column(String, nullable=False)  # csv, screenshot, apple_health, whoop, oura, garmin
    file_name = Column(String, nullable=True)
    file_hash_sha256 = Column(String, nullable=True)  # For duplicate file detection
    file_size = Column(Integer, nullable=True)
    
    # Status tracking
    status = Column(String, nullable=False, default="created")  # created, parsing, ready, importing, completed, failed, canceled, undone
    
    # Timestamps
    created_at = Column(DateTime, default=_utcnow_naive)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    # Configuration
    options_json = Column(Text, nullable=True)  # JSON: {aggregation, conflict_policy, date_range, mapping, etc.}
    
    # Results
    summary_json = Column(Text, nullable=True)  # JSON: {total_rows, imported, skipped, updated, duplicates, errors, created_habit_ids}
    error_json = Column(Text, nullable=True)  # JSON: structured error list
    
    # Progress tracking
    progress_current = Column(Integer, default=0)
    progress_total = Column(Integer, default=0)
    
    # Undo support
    undo_available = Column(Boolean, default=False)
    undone_at = Column(DateTime, nullable=True)
    # V2: Enhanced undo with expiration and rollback package
    undo_expires_at = Column(DateTime, nullable=True)  # When undo expires (e.g., 7 days)
    undo_package_json = Column(Text, nullable=True)  # JSON: {logs_created, logs_updated, habits_created}
    
    # Relationships
    user = orm_relationship("UserDB")
    items = orm_relationship("ImportItemDB", back_populates="import_run", cascade="all, delete-orphan")
    logs = orm_relationship("HabitLogDB", back_populates="import_run")


class ImportItemDB(Base):
    """
    Staging table for import preview - stores normalized items that WOULD be imported.
    Allows user to review exactly what will be written before confirming.
    """
    __tablename__ = "import_items"
    
    id = Column(String, primary_key=True)  # UUID
    import_run_id = Column(String, ForeignKey("import_runs.id", ondelete="CASCADE"), nullable=False)
    
    # Data
    habit_key = Column(String, nullable=False)  # Stable key: integration_source:metric_type or csv:habit_name
    habit_name = Column(String, nullable=True)  # Display name
    date = Column(String, nullable=False)  # YYYY-MM-DD
    amount = Column(Float, nullable=True)
    unit_type = Column(String, nullable=True)
    
    # Original data
    raw_json = Column(Text, nullable=True)  # JSON string of original row/record
    row_index = Column(Integer, nullable=True)  # Original row number for CSV
    
    # Validation
    validation_status = Column(String, default="ok")  # ok, warning, error
    validation_messages = Column(Text, nullable=True)  # JSON array of validation messages
    
    # Deduplication
    dedupe_key = Column(String, nullable=True)  # For conflict detection
    conflict_status = Column(String, nullable=True)  # null, duplicate, conflict
    existing_log_id = Column(String, nullable=True)  # ID of existing log if conflict
    
    # Relationships
    import_run = orm_relationship("ImportRunDB", back_populates="items")


class ImportMappingPresetDB(Base):
    """
    User-saved mapping presets for wearable and CSV imports.
    Allows users to reuse column mappings across multiple imports.
    """
    __tablename__ = "import_mapping_presets"
    
    id = Column(String, primary_key=True)  # UUID
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    
    # Preset info
    name = Column(String, nullable=False)
    source = Column(String, nullable=False)  # csv, whoop, oura, garmin, etc.
    
    # Mapping configuration
    mapping_json = Column(Text, nullable=False)  # JSON: column mappings, units, aggregation settings
    
    # Timestamps
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    
    # Relationships
    user = orm_relationship("UserDB")


class HabitAliasDB(Base):
    """
    Phase 5A: Habit alias model for fuzzy matching.
    Stores keywords/aliases that map to habits for natural language resolution.
    """
    __tablename__ = "habit_aliases"
    
    id = Column(String, primary_key=True)
    habit_id = Column(String, ForeignKey("habits.id", ondelete="CASCADE"), nullable=False)
    alias_text = Column(String, nullable=False)  # lowercase normalized
    created_at = Column(DateTime, default=_utcnow_naive)
    
    # Relationships
    habit = orm_relationship("HabitDB", backref="aliases")


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


class HabitProjectionPolicyDB(Base):
    """Per-habit projection priority for canonical wearable records."""
    __tablename__ = "habit_projection_policies"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    habit_id = Column(String, ForeignKey("habits.id"), nullable=False)
    canonical_metric_type = Column(String, nullable=True)
    projection_source_priority_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    habit = orm_relationship("HabitDB")

    __table_args__ = (
        Index("idx_habit_projection_policies_habit", "habit_id", unique=True),
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


class FinancialConnectionDB(Base):
    """Canonical connection state for a financial provider."""
    __tablename__ = "financial_connections"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    provider = Column(String, nullable=False)
    status = Column(String, nullable=False, default="active")  # active, paused, error, revoked
    access_token = Column(Text, nullable=True)
    item_id = Column(String, nullable=True)
    institution_id = Column(String, nullable=True)
    institution_name = Column(String, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_successful_sync_at = Column(DateTime, nullable=True)
    last_error_json = Column(Text, nullable=True)
    settings_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_financial_connections_user_provider", "user_id", "provider", unique=True),
    )


class FinancialAccountDB(Base):
    """Normalized financial accounts for a provider connection."""
    __tablename__ = "financial_accounts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("financial_connections.id"), nullable=False)
    provider_account_id = Column(String, nullable=False)
    name = Column(String, nullable=False)
    official_name = Column(String, nullable=True)
    mask = Column(String, nullable=True)
    account_type = Column(String, nullable=False)
    account_subtype = Column(String, nullable=True)
    currency = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    connection = orm_relationship("FinancialConnectionDB")

    __table_args__ = (
        Index("idx_financial_accounts_user_provider_account", "user_id", "provider_account_id", unique=True),
        Index("idx_financial_accounts_connection_active", "connection_id", "is_active"),
    )


class FinancialTransactionDB(Base):
    """Raw normalized transactions used for financial rollups."""
    __tablename__ = "financial_transactions"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    connection_id = Column(String, ForeignKey("financial_connections.id"), nullable=False)
    account_id = Column(String, ForeignKey("financial_accounts.id"), nullable=False)
    provider_transaction_id = Column(String, nullable=False)
    transaction_date = Column(String, nullable=False)
    authorized_at = Column(DateTime, nullable=True)
    posted_at = Column(DateTime, nullable=True)
    name = Column(String, nullable=False)
    merchant_name = Column(String, nullable=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, nullable=True)
    direction = Column(String, nullable=False)  # outflow, inflow
    pending = Column(Boolean, default=False)
    raw_category_json = Column(Text, nullable=True)
    raw_transaction_code = Column(String, nullable=True)
    counts_toward_spending = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    connection = orm_relationship("FinancialConnectionDB")
    account = orm_relationship("FinancialAccountDB")

    __table_args__ = (
        Index(
            "idx_financial_transactions_user_provider_transaction",
            "user_id",
            "provider_transaction_id",
            unique=True,
        ),
        Index("idx_financial_transactions_user_date", "user_id", "transaction_date"),
        Index("idx_financial_transactions_user_spending", "user_id", "counts_toward_spending", "transaction_date"),
    )


class FinancialSyncCursorDB(Base):
    """Per-connection cursor state for financial syncs."""
    __tablename__ = "financial_sync_cursors"

    id = Column(String, primary_key=True)
    connection_id = Column(String, ForeignKey("financial_connections.id"), nullable=False)
    cursor_key = Column(String, nullable=False)
    cursor_value = Column(Text, nullable=False)
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    connection = orm_relationship("FinancialConnectionDB")

    __table_args__ = (
        Index("idx_financial_sync_cursors_connection_key", "connection_id", "cursor_key", unique=True),
    )


class FinancialSyncRunDB(Base):
    """Observable sync runs for financial provider troubleshooting."""
    __tablename__ = "financial_sync_runs"

    id = Column(String, primary_key=True)
    connection_id = Column(String, ForeignKey("financial_connections.id"), nullable=True)
    provider = Column(String, nullable=False)
    trigger = Column(String, nullable=False)  # manual, backfill, scheduled
    status = Column(String, nullable=False, default="running")  # running, success, partial, failed
    started_at = Column(DateTime, default=_utcnow_naive)
    completed_at = Column(DateTime, nullable=True)
    items_seen = Column(Integer, default=0)
    items_written = Column(Integer, default=0)
    items_updated = Column(Integer, default=0)
    items_deleted = Column(Integer, default=0)
    error_json = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)

    connection = orm_relationship("FinancialConnectionDB")


class IntegrationDB(Base):
    """Generic integration status row (provider-scoped per user)."""
    __tablename__ = "integrations"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    provider = Column(String, primary_key=True)  # e.g. "weather"
    enabled = Column(Boolean, nullable=False, default=False)
    connected_at = Column(DateTime, nullable=True)
    disabled_at = Column(DateTime, nullable=True)
    metadata_json = Column("metadata", Text, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)

    user = orm_relationship("UserDB")


class AIConversationDB(Base):
    """AI Chat conversation model for database"""
    __tablename__ = "ai_conversations"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=True)  # Optional title for the conversation
    response_mode = Column(String, default="text")  # 'text' or 'voice' - controls response style
    channel = Column(String, nullable=False, default="app")  # 'app', 'sms', or 'voice'
    auto_run_queued = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    # Relationships
    user = orm_relationship("UserDB", backref="ai_conversations")
    messages = orm_relationship("AIMessageDB", back_populates="conversation", cascade="all, delete-orphan", order_by="AIMessageDB.created_at")


class AIMessageDB(Base):
    """AI Chat message model for database"""
    __tablename__ = "ai_messages"

    id = Column(String, primary_key=True)
    conversation_id = Column(String, ForeignKey("ai_conversations.id"), nullable=False)
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    tool_payload = Column(Text, nullable=True)  # JSON string of tool results for canvas rehydration
    created_at = Column(DateTime, default=_utcnow_naive)

    # Relationships
    conversation = orm_relationship("AIConversationDB", back_populates="messages")


class SmsPreferencesDB(Base):
    """Per-user SMS/iMessage chatbot preferences."""
    __tablename__ = "sms_preferences"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=True)
    proactive_enabled = Column(Boolean, nullable=False, default=True)
    quiet_hours_start = Column(String, nullable=True)  # "22:00" local time
    quiet_hours_end = Column(String, nullable=True)     # "08:00"
    max_proactive_per_day = Column(Integer, nullable=False, default=1)
    allowed_triggers = Column(String, nullable=False, default="")  # comma-separated
    daily_narrative_enabled = Column(Boolean, nullable=False, default=True)
    interrupts_enabled = Column(Boolean, nullable=False, default=True)
    allowed_interrupt_kinds = Column(String, nullable=False, default="distraction_spiral")
    max_interrupts_per_day = Column(Integer, nullable=False, default=2)
    min_hours_between_interrupts = Column(Integer, nullable=False, default=4)
    last_proactive_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")


class UserUIPreferencesDB(Base):
    """Per-user UI appearance preferences (overview text color, etc.)."""
    __tablename__ = "user_ui_preferences"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    habit_text_color = Column(String, nullable=True)
    overview_view_mode = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")


class SmsCopilotEventDB(Base):
    """Persisted outbound copilot events and their delivery lifecycle."""
    __tablename__ = "sms_copilot_events"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String, nullable=False)
    status = Column(String, nullable=False, default="candidate")
    score = Column(Float, nullable=False, default=0.0)
    confidence = Column(Float, nullable=False, default=0.0)
    novelty_score = Column(Float, nullable=False, default=0.0)
    actionability_score = Column(Float, nullable=False, default=0.0)
    dedupe_key = Column(String, nullable=False)
    suppression_reason = Column(String, nullable=True)
    trigger_window_start = Column(DateTime, nullable=True)
    trigger_window_end = Column(DateTime, nullable=True)
    headline = Column(String, nullable=True)
    body = Column(Text, nullable=True)
    metrics_json = Column(Text, nullable=True)
    response_options_json = Column(Text, nullable=True)
    assistant_message_id = Column(String, nullable=True)
    user_reply_message_id = Column(String, nullable=True)
    provider_message_id = Column(String, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    replied_at = Column(DateTime, nullable=True)
    acted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    conversation = orm_relationship("AIConversationDB")


class BehaviorBaselineSnapshotDB(Base):
    """Computed behavior baselines used to score copilot interventions."""
    __tablename__ = "behavior_baseline_snapshots"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    metric_key = Column(String, nullable=False)
    lookback_days = Column(Integer, nullable=False, default=14)
    baseline_json = Column(Text, nullable=False)
    computed_at = Column(DateTime, default=_utcnow_naive)

    user = orm_relationship("UserDB")


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

class WatcherDeviceDB(Base):
    """
    Device running the Ritual Watcher.
    Each device gets a unique ID for tracking.
    """
    __tablename__ = "watcher_devices"
    
    device_id = Column(String, primary_key=True)  # UUID
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    device_name = Column(String, nullable=False)
    platform = Column(String, nullable=False, default="macos")
    os_version = Column(String, nullable=True)
    created_at = Column(Integer, nullable=False)  # Unix ms
    last_seen_at = Column(Integer, nullable=True)  # Unix ms
    
    # Relationships
    user = orm_relationship("UserDB")
    state = orm_relationship("WatcherStateDB", back_populates="device", uselist=False, cascade="all, delete-orphan")
    events = orm_relationship("ActivityEventDB", back_populates="device", cascade="all, delete-orphan")


class WatcherStateDB(Base):
    """
    Configuration and status for a watcher instance.
    """
    __tablename__ = "watcher_state"
    
    id = Column(Integer, primary_key=True)
    device_id = Column(String, ForeignKey("watcher_devices.device_id", ondelete="CASCADE"), nullable=False, unique=True)
    is_enabled = Column(Integer, nullable=False, default=0)
    poll_interval_ms = Column(Integer, nullable=False, default=2000)
    last_seen_ts = Column(Integer, nullable=True)  # Unix ms
    accessibility_status = Column(String, nullable=False, default="unknown")  # unknown, granted, denied
    title_mode = Column(String, nullable=False, default="off")  # off, full, truncate, hash
    truncate_length = Column(Integer, default=80)
    excluded_bundle_ids = Column(Text, nullable=True)  # JSON array
    sync_analytics = Column(Integer, nullable=False, default=0)
    sync_raw_to_cloud = Column(Integer, nullable=False, default=0)
    afk_timeout_seconds = Column(Integer, nullable=False, default=900)  # 15 min default
    updated_at = Column(Integer, nullable=False)  # Unix ms
    
    # Relationships
    device = orm_relationship("WatcherDeviceDB", back_populates="state")


class ActivityEventDB(Base):
    """
    Raw activity event from the watcher.
    Append-only table for tracking active applications and windows.
    V2: Added browser URL tracking and incognito detection.
    """
    __tablename__ = "activity_events"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    event_uid = Column(String, nullable=False, default="")
    device_id = Column(String, ForeignKey("watcher_devices.device_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    ts_start = Column(Integer, nullable=False)  # Unix ms
    ts_end = Column(Integer, nullable=False)  # Unix ms
    app_bundle_id = Column(String, nullable=False)
    app_name = Column(String, nullable=False)
    window_title = Column(String, nullable=True)  # NULL if permission denied or title_mode = off
    window_title_hash = Column(String, nullable=True)  # SHA256 if title_mode = hash
    window_owner_pid = Column(Integer, nullable=True)
    is_afk = Column(Integer, nullable=False, default=0)  # 0 = active, 1 = AFK
    # V2: Browser tracking fields
    browser_url = Column(String, nullable=True)  # Full URL (if url_mode = full)
    browser_domain = Column(String, nullable=True)  # Domain only (e.g., "github.com")
    is_incognito = Column(Integer, nullable=False, default=0)  # 0 = normal, 1 = incognito/private
    device_platform = Column(String, nullable=True)
    app_version = Column(String, nullable=True)
    app_build = Column(String, nullable=True)
    transition_reason = Column(String, nullable=True)
    biome_source_file = Column(String, nullable=True)
    location_lat = Column(Float, nullable=True)
    location_lon = Column(Float, nullable=True)
    location_accuracy_m = Column(Float, nullable=True)
    location_source = Column(String, nullable=True)
    location_place_label = Column(String, nullable=True)
    location_confidence = Column(Float, nullable=True)
    location_resolved_at = Column(BigInteger, nullable=True)
    location_signal_age_ms = Column(BigInteger, nullable=True)
    source = Column(String, nullable=False, default="ritual_watcher_v2")
    created_at = Column(Integer, nullable=False)  # Unix ms
    
    # Relationships
    device = orm_relationship("WatcherDeviceDB", back_populates="events")
    user = orm_relationship("UserDB")


class DailyActivityRollupDB(Base):
    """
    Aggregated daily activity data.
    Computed from activity_events for dashboard display.
    V2: Added browser_domain and afk_ms tracking.
    """
    __tablename__ = "daily_activity_rollups"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    day = Column(String, nullable=False)  # YYYY-MM-DD
    device_id = Column(String, ForeignKey("watcher_devices.device_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    app_bundle_id = Column(String, nullable=False)
    app_name = Column(String, nullable=False)
    window_title = Column(String, nullable=True)
    window_title_hash = Column(String, nullable=True)
    browser_domain = Column(String, nullable=True)  # V2: Domain for browser apps
    active_ms = Column(Integer, nullable=False, default=0)
    afk_ms = Column(Integer, nullable=False, default=0)  # V2: Time spent AFK
    events_count = Column(Integer, nullable=False, default=0)
    created_at = Column(Integer, nullable=False)
    updated_at = Column(Integer, nullable=False)
    
    # Relationships
    user = orm_relationship("UserDB")


class AfkEventDB(Base):
    """
    AFK (Away From Keyboard) events.
    Tracks when user is active vs AFK for accurate time calculations.
    """
    __tablename__ = "afk_events"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String, ForeignKey("watcher_devices.device_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    ts_start = Column(Integer, nullable=False)  # Unix ms
    ts_end = Column(Integer, nullable=False)  # Unix ms
    status = Column(String, nullable=False)  # 'afk' or 'not-afk'
    created_at = Column(Integer, nullable=False)  # Unix ms
    
    # Relationships
    user = orm_relationship("UserDB")


class DomainDailyRollupDB(Base):
    """
    Aggregated daily data by domain (for browser tracking).
    Shows time spent on each website per day.
    """
    __tablename__ = "domain_daily_rollups"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    day = Column(String, nullable=False)  # YYYY-MM-DD
    device_id = Column(String, ForeignKey("watcher_devices.device_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    domain = Column(String, nullable=False)  # e.g., "github.com"
    active_ms = Column(Integer, nullable=False, default=0)
    events_count = Column(Integer, nullable=False, default=0)
    created_at = Column(Integer, nullable=False)
    updated_at = Column(Integer, nullable=False)
    
    # Relationships
    user = orm_relationship("UserDB")


class WatcherSyncOutboxDB(Base):
    """
    Queue for optional cloud sync of watcher data.
    """
    __tablename__ = "watcher_sync_outbox"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String, ForeignKey("watcher_devices.device_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False)  # 'rollup' or 'raw_event'
    payload_json = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending, sent, failed
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    created_at = Column(Integer, nullable=False)
    last_attempt_at = Column(Integer, nullable=True)


class WatcherAppExclusionDB(Base):
    """
    Per-user app exclusions for privacy.
    """
    __tablename__ = "watcher_app_exclusions"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    bundle_id = Column(String, nullable=False)
    app_name = Column(String, nullable=True)
    reason = Column(String, nullable=True)  # 'privacy', 'sensitive', 'user_preference'
    created_at = Column(Integer, nullable=False)


class ArtifactDB(Base):
    """Durable artifact produced by reports or workflow runs."""
    __tablename__ = "artifacts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String, nullable=False)  # report | morning_brief | shutdown_review | notebook | plan | conversation_brief | ambient_digest
    source_type = Column(String, nullable=False)  # report_run | workflow_run | conversation
    source_id = Column(String, nullable=True)
    title = Column(String, nullable=False)
    slug = Column(String, nullable=True)
    status = Column(String, nullable=False, default="published")  # draft | published | archived
    summary = Column(Text, nullable=True)
    preview_text = Column(Text, nullable=True)
    folder_key = Column(String, nullable=True)
    is_pinned = Column(Boolean, nullable=False, default=False)
    body_json = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=False, default="{}")
    period_start = Column(String, nullable=True)
    period_end = Column(String, nullable=True)
    timezone = Column(String, nullable=False, default="America/New_York")
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True)
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    conversation = orm_relationship("AIConversationDB")


class ArtifactRevisionDB(Base):
    """Full-snapshot revision log for an artifact."""
    __tablename__ = "artifact_revisions"

    id = Column(String, primary_key=True)
    artifact_id = Column(String, ForeignKey("artifacts.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    editor_type = Column(String, nullable=False)  # system | assistant | user
    body_json = Column(Text, nullable=False)
    summary = Column(Text, nullable=True)
    change_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)

    artifact = orm_relationship("ArtifactDB")


class ArtifactLinkDB(Base):
    """Generic link table so docs can reference conversations, facts, workflow runs, and ambient events."""
    __tablename__ = "artifact_links"

    id = Column(String, primary_key=True)
    artifact_id = Column(String, ForeignKey("artifacts.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    target_type = Column(String, nullable=False)  # conversation | message | workflow_run | fact | ambient_signal
    target_id = Column(String, nullable=False)
    relationship = Column(String, nullable=False, default="linked")
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)

    artifact = orm_relationship("ArtifactDB")
    user = orm_relationship("UserDB")


class ActionProfileDB(Base):
    """Execution profile that constrains workflow behavior."""
    __tablename__ = "action_profiles"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    mode = Column(String, nullable=False)  # observe | draft | organize | act
    is_default = Column(Boolean, nullable=False, default=False)
    rules_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")


class WorkflowDefinitionDB(Base):
    """Saved workflow definition for in-app routines."""
    __tablename__ = "workflow_definitions"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String, nullable=False)  # morning_brief | shutdown_review | daily_narrative | distraction_spiral
    name = Column(String, nullable=False)
    definition_family = Column(String, nullable=False, default="routine")  # routine | ambient
    trigger_type = Column(String, nullable=False, default="schedule")  # schedule | signal
    signal_kind = Column(String, nullable=True)
    cooldown_minutes = Column(Integer, nullable=False, default=240)
    quiet_hours_json = Column(Text, nullable=False, default="{}")
    status = Column(String, nullable=False, default="draft")  # draft | scheduled | paused
    timezone = Column(String, nullable=False, default="America/New_York")
    cadence = Column(String, nullable=False, default="daily")
    send_hour_local = Column(Integer, nullable=False, default=8)
    send_minute_local = Column(Integer, nullable=False, default=0)
    send_weekdays_json = Column(Text, nullable=False, default="[]")
    delivery_channel = Column(String, nullable=False, default="in_app")
    delivery_json = Column(Text, nullable=False, default="{}")
    ranking_json = Column(Text, nullable=False, default="{}")
    config_json = Column(Text, nullable=False, default="{}")
    template_version = Column(Integer, nullable=False, default=1)
    action_profile_id = Column(String, ForeignKey("action_profiles.id"), nullable=False)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    action_profile = orm_relationship("ActionProfileDB")


class WorkflowRunDB(Base):
    """Queued or processed execution of a workflow definition."""
    __tablename__ = "workflow_runs"

    id = Column(String, primary_key=True)
    workflow_definition_id = Column(String, ForeignKey("workflow_definitions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, nullable=False, default="queued")  # queued | processing | completed | failed | canceled
    trigger_source = Column(String, nullable=False)  # manual | scheduled | backfill
    window_start = Column(DateTime, nullable=True)
    window_end = Column(DateTime, nullable=True)
    artifact_id = Column(String, ForeignKey("artifacts.id", ondelete="SET NULL"), nullable=True)
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True)
    plan_json = Column(Text, nullable=True)
    result_json = Column(Text, nullable=True)
    proposed_actions_json = Column(Text, nullable=True)
    policy_decisions_json = Column(Text, nullable=True)
    fact_suggestions_json = Column(Text, nullable=True)
    queue_suggestions_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    idempotency_key = Column(String, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    workflow_definition = orm_relationship("WorkflowDefinitionDB")
    user = orm_relationship("UserDB")
    artifact = orm_relationship("ArtifactDB")
    conversation = orm_relationship("AIConversationDB")


class ApprovalRequestDB(Base):
    """Approval queue entry for future workflow actions."""
    __tablename__ = "approval_requests"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workflow_run_id = Column(String, ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True)
    action_kind = Column(String, nullable=False)
    capability = Column(String, nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending | approved | rejected | expired
    reason = Column(Text, nullable=True)
    payload_json = Column(Text, nullable=False, default="{}")
    proposed_action_json = Column(Text, nullable=False, default="{}")
    policy_decision_json = Column(Text, nullable=False, default="{}")
    expires_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    workflow_run = orm_relationship("WorkflowRunDB")


class ActionReceiptDB(Base):
    """Audit log for every mutating action the backend applies or rejects."""
    __tablename__ = "action_receipts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workflow_run_id = Column(String, ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True)
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True)
    action_kind = Column(String, nullable=False)
    capability = Column(String, nullable=False)
    target_ref = Column(String, nullable=True)
    status = Column(String, nullable=False, default="applied")  # applied | rejected | approved_pending
    before_json = Column(Text, nullable=True)
    after_json = Column(Text, nullable=True)
    undo_json = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)

    user = orm_relationship("UserDB")
    workflow_run = orm_relationship("WorkflowRunDB")
    conversation = orm_relationship("AIConversationDB")


class ConversationQueueItemDB(Base):
    """Queued follow-up prompts for a conversation."""
    __tablename__ = "conversation_queue_items"

    id = Column(String, primary_key=True)
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    prompt_text = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending | running | completed | canceled | stale | failed
    source = Column(String, nullable=False, default="manual")  # manual | reply_chip | suggestion | workflow
    after_message_id = Column(String, nullable=True)
    position = Column(Integer, nullable=False, default=0)
    auto_run = Column(Boolean, nullable=False, default=False)
    error_json = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    conversation = orm_relationship("AIConversationDB")
    user = orm_relationship("UserDB")


class AiFactDB(Base):
    """Approved and pending semantic memory facts for Ritual AI."""
    __tablename__ = "ai_facts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category = Column(String, nullable=False)  # goal | preference | constraint | routine | profile
    subject = Column(String, nullable=False)
    predicate = Column(String, nullable=False)
    value_json = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending | active | dismissed | archived
    confidence = Column(Float, nullable=False, default=0.5)
    source_type = Column(String, nullable=False, default="assistant")  # onboarding | assistant | workflow | ambient | user
    source_ref = Column(String, nullable=True)
    visibility = Column(String, nullable=False, default="private")  # private | prompt | ui
    last_confirmed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")


class AiFactEventDB(Base):
    """Audit/history table for fact changes."""
    __tablename__ = "ai_fact_events"

    id = Column(String, primary_key=True)
    fact_id = Column(String, ForeignKey("ai_facts.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String, nullable=False)  # suggested | approved | updated | dismissed | expired
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)

    fact = orm_relationship("AiFactDB")
    user = orm_relationship("UserDB")


class AmbientSignalEventDB(Base):
    """Signal evaluation history for in-app ambient agents."""
    __tablename__ = "ambient_signal_events"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workflow_definition_id = Column(String, ForeignKey("workflow_definitions.id", ondelete="SET NULL"), nullable=True)
    workflow_run_id = Column(String, ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True)
    signal_kind = Column(String, nullable=False)
    status = Column(String, nullable=False, default="candidate")  # candidate | triggered | suppressed | dismissed | snoozed
    score = Column(Float, nullable=False, default=0.0)
    confidence = Column(Float, nullable=False, default=0.0)
    suppression_reason = Column(Text, nullable=True)
    dedupe_key = Column(String, nullable=True)
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    workflow_definition = orm_relationship("WorkflowDefinitionDB")
    workflow_run = orm_relationship("WorkflowRunDB")


class ReportScheduleDB(Base):
    """Scheduled recurring habit-report definition."""
    __tablename__ = "report_schedules"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    cadence = Column(String, nullable=False)  # daily | weekly | monthly
    status = Column(String, nullable=False, default="draft")  # draft | scheduled | paused
    timezone = Column(String, nullable=False, default="America/New_York")
    delivery_channel = Column(String, nullable=False, default="email")
    delivery_label = Column(String, nullable=False)
    send_hour_local = Column(Integer, nullable=False, default=8)
    send_minute_local = Column(Integer, nullable=False, default=0)
    send_weekday = Column(Integer, nullable=True)  # Monday=0 .. Sunday=6
    send_day_of_month = Column(Integer, nullable=True)  # 1..31
    recipients_json = Column(Text, nullable=False, default="[]")
    sections_json = Column(Text, nullable=False, default="[]")
    last_sent_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")


class ReportRunDB(Base):
    """Generated report instance for a given schedule/cadence window."""
    __tablename__ = "report_runs"

    id = Column(String, primary_key=True)
    schedule_id = Column(String, ForeignKey("report_schedules.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    cadence = Column(String, nullable=False)
    status = Column(String, nullable=False, default="queued")  # queued | processing | sent | failed
    period_start = Column(String, nullable=False)  # YYYY-MM-DD in user local time
    period_end = Column(String, nullable=False)  # YYYY-MM-DD in user local time
    subject = Column(String, nullable=True)
    summary_json = Column(Text, nullable=True)
    email_html = Column(Text, nullable=True)
    artifact_id = Column(String, ForeignKey("artifacts.id", ondelete="SET NULL"), nullable=True)
    generated_at = Column(DateTime, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    error_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    schedule = orm_relationship("ReportScheduleDB")
    user = orm_relationship("UserDB")
    artifact = orm_relationship("ArtifactDB")


class ReportNotificationDB(Base):
    """Per-recipient notification/delivery record for a report run."""
    __tablename__ = "report_notifications"

    id = Column(String, primary_key=True)
    report_run_id = Column(String, ForeignKey("report_runs.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel = Column(String, nullable=False, default="email")
    recipient_email = Column(String, nullable=False)
    status = Column(String, nullable=False, default="queued")  # queued | sent | failed
    provider_message_id = Column(String, nullable=True)
    payload_json = Column(Text, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    report_run = orm_relationship("ReportRunDB")
    user = orm_relationship("UserDB")


# ───────────────────────────────────────────────────────────────────────────
# Location Tracking (Phase: Location Tracking)
# ───────────────────────────────────────────────────────────────────────────


class UserLocationPingDB(Base):
    """Append-only event log of every position report from any client.

    Sources: ios_scls (iPhone Significant-Change Location Service),
    ios_one_shot, mac_one_shot, mac_bssid_trigger, garmin_workout, manual.
    """
    __tablename__ = "user_location_pings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    lat = Column(Float, nullable=True)  # WGS84 latitude; null for BSSID-only Mac pings
    lon = Column(Float, nullable=True)  # WGS84 longitude; null for BSSID-only Mac pings
    horizontal_accuracy_m = Column(Float, nullable=True)
    source = Column(String, nullable=False)  # ios_scls, mac_one_shot, etc.
    device_id = Column(String, nullable=True)
    bssid = Column(String, nullable=True)  # Mac-only Wi-Fi fingerprint
    ssid = Column(String, nullable=True)   # Mac-only Wi-Fi network name
    client_ts = Column(BigInteger, nullable=False)  # ms since epoch when client captured
    server_ts = Column(BigInteger, nullable=False)  # ms since epoch when backend received
    client_event_id = Column(String, unique=True, nullable=True)  # idempotency key
    raw_payload = Column(Text, nullable=True)  # full client JSON for debugging

    __table_args__ = (
        Index("ix_loc_pings_user_ts", "user_id", "client_ts"),
        Index("ix_loc_pings_user_source_ts", "user_id", "source", "client_ts"),
    )


class UserLocationStateDB(Base):
    """Materialized current location per user. One row per user, updated by ingest endpoint."""
    __tablename__ = "user_location_state"

    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    horizontal_accuracy_m = Column(Float, nullable=True)
    source = Column(String, nullable=False)
    ping_client_ts = Column(BigInteger, nullable=False)  # when client captured (freshness signal)
    updated_at = Column(BigInteger, nullable=False)  # when this row was last written
    place_label = Column(String, nullable=True)  # reverse-geocoded, e.g. "Home", "Equinox Brooklyn"
    place_confidence = Column(Float, nullable=True)  # 0.0-1.0
