"""
SQLAlchemy database models
"""

from sqlalchemy import Column, String, Boolean, Integer, Float, DateTime, Text, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()

class UserDB(Base):
    """User model for database"""
    __tablename__ = "users"
    
    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    full_name = Column(String)
    
    # Onboarding data
    age_bracket = Column(String)
    gender = Column(String)
    country = Column(String)
    tracking_interests = Column(Text)  # JSON string array
    wearable_devices = Column(String)
    onboarding_completed = Column(Boolean, default=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    habits = relationship("HabitDB", back_populates="user", cascade="all, delete-orphan")

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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("UserDB", back_populates="habits")
    logs = relationship("HabitLogDB", back_populates="habit", cascade="all, delete-orphan")

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
    
    # Import tracking fields (Phase: Robust Import System)
    import_run_id = Column(String, ForeignKey("import_runs.id", ondelete="SET NULL"), nullable=True)
    source_id = Column(String, nullable=True)  # Original record ID from wearable/source if available
    dedupe_key = Column(String, nullable=True, index=True)  # SHA256 hash for deduplication
    # Note: updated_at column removed - not synced to Turso Cloud. Use completed_at for now.
    
    # Relationships
    habit = relationship("HabitDB", back_populates="logs")
    import_run = relationship("ImportRunDB", back_populates="logs")


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
    created_at = Column(DateTime, default=datetime.utcnow)
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
    user = relationship("UserDB")
    items = relationship("ImportItemDB", back_populates="import_run", cascade="all, delete-orphan")
    logs = relationship("HabitLogDB", back_populates="import_run")


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
    import_run = relationship("ImportRunDB", back_populates="items")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("UserDB")


class HabitAliasDB(Base):
    """
    Phase 5A: Habit alias model for fuzzy matching.
    Stores keywords/aliases that map to habits for natural language resolution.
    """
    __tablename__ = "habit_aliases"
    
    id = Column(String, primary_key=True)
    habit_id = Column(String, ForeignKey("habits.id", ondelete="CASCADE"), nullable=False)
    alias_text = Column(String, nullable=False)  # lowercase normalized
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    habit = relationship("HabitDB", backref="aliases")


class WhoopIntegrationDB(Base):
    """Whoop integration model for database"""
    __tablename__ = "whoop_integrations"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, unique=True)
    whoop_user_id = Column(String, nullable=False)
    access_token = Column(String, nullable=False)
    refresh_token = Column(String)
    token_expires_at = Column(DateTime, nullable=False)
    connected_at = Column(DateTime, default=datetime.utcnow)
    last_sync_at = Column(DateTime)
    is_active = Column(Boolean, default=True)
    whoop_sync_hour = Column(Integer, default=9)  # Preferred sync hour (0-23), defaults to 9 AM
    
    # Relationships
    user = relationship("UserDB", backref="whoop_integration")


class AIConversationDB(Base):
    """AI Chat conversation model for database"""
    __tablename__ = "ai_conversations"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=True)  # Optional title for the conversation
    response_mode = Column(String, default="text")  # 'text' or 'voice' - controls response style
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user = relationship("UserDB", backref="ai_conversations")
    messages = relationship("AIMessageDB", back_populates="conversation", cascade="all, delete-orphan", order_by="AIMessageDB.created_at")


class AIMessageDB(Base):
    """AI Chat message model for database"""
    __tablename__ = "ai_messages"
    
    id = Column(String, primary_key=True)
    conversation_id = Column(String, ForeignKey("ai_conversations.id"), nullable=False)
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    tool_payload = Column(Text, nullable=True)  # JSON string of tool results for canvas rehydration
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    conversation = relationship("AIConversationDB", back_populates="messages")


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
    device_name = Column(String, nullable=False)  # e.g., "Nick's iPhone"
    platform = Column(String, nullable=False)  # ios, android
    device_secret_hash = Column(String, nullable=False)  # HMAC key (stored plaintext for now, can encrypt later)
    registered_at = Column(DateTime, default=datetime.utcnow)
    last_sync_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    
    # Relationships - using back_populates instead of backref to avoid conflicts
    user = relationship("UserDB")  # No backref to avoid mapper conflicts
    metrics = relationship("WearableMetricDB", back_populates="device", cascade="all, delete-orphan")
    ingest_events = relationship("WearableIngestEventDB", back_populates="device", cascade="all, delete-orphan")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships - using back_populates instead of backref to avoid conflicts
    user = relationship("UserDB")  # No backref to avoid mapper conflicts
    device = relationship("WearableDeviceDB", back_populates="metrics")


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
    received_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String, nullable=False)  # success, partial, failed
    
    # Relationships
    device = relationship("WearableDeviceDB", back_populates="ingest_events")


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
    user = relationship("UserDB")
    state = relationship("WatcherStateDB", back_populates="device", uselist=False, cascade="all, delete-orphan")
    events = relationship("ActivityEventDB", back_populates="device", cascade="all, delete-orphan")


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
    device = relationship("WatcherDeviceDB", back_populates="state")


class ActivityEventDB(Base):
    """
    Raw activity event from the watcher.
    Append-only table for tracking active applications and windows.
    V2: Added browser URL tracking and incognito detection.
    """
    __tablename__ = "activity_events"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
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
    source = Column(String, nullable=False, default="ritual_watcher_v2")
    created_at = Column(Integer, nullable=False)  # Unix ms
    
    # Relationships
    device = relationship("WatcherDeviceDB", back_populates="events")
    user = relationship("UserDB")


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
    user = relationship("UserDB")


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
    user = relationship("UserDB")


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
    user = relationship("UserDB")


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


