"""
SQLAlchemy database models
"""

from sqlalchemy import Column, String, Boolean, Integer, Float, DateTime, Text, ForeignKey, Index
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
    origin_record_kind = Column(String, nullable=True)  # sample, event
    origin_record_id = Column(String, nullable=True)  # canonical wearable record ID
    
    # Import tracking fields (Phase: Robust Import System)
    import_run_id = Column(String, ForeignKey("import_runs.id", ondelete="SET NULL"), nullable=True)
    source_id = Column(String, nullable=True)  # Original record ID from wearable/source if available
    dedupe_key = Column(String, nullable=True, index=True)  # SHA256 hash for deduplication
    # Note: updated_at column removed - not synced to Turso Cloud. Use completed_at for now.
    
    # Relationships
    habit = relationship("HabitDB", back_populates="logs")
    import_run = relationship("ImportRunDB", back_populates="logs")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB", backref="scheduled_blocks")


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
    scope = Column(String, nullable=True)  # OAuth scopes granted during authorization

    # Relationships
    user = relationship("UserDB", backref="whoop_integration")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")

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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")
    connection = relationship("WearableConnectionDB")

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
    received_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)

    user = relationship("UserDB")
    connection = relationship("WearableConnectionDB")

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
    confidence = Column(Float, nullable=True)
    timezone = Column(String, nullable=True)
    attributes_json = Column(Text, nullable=True)
    raw_payload_id = Column(String, ForeignKey("wearable_raw_payloads.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)

    user = relationship("UserDB")
    connection = relationship("WearableConnectionDB")
    source = relationship("WearableSourceDB")
    raw_payload = relationship("WearableRawPayloadDB")

    __table_args__ = (
        Index("idx_wearable_samples_user_metric_recorded", "user_id", "metric_type", "recorded_at"),
        Index("idx_wearable_samples_user_provider_date", "user_id", "provider", "attributed_date"),
        Index("idx_wearable_samples_user_provider_external", "user_id", "provider", "external_id"),
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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)

    user = relationship("UserDB")
    connection = relationship("WearableConnectionDB")
    source = relationship("WearableSourceDB")
    raw_payload = relationship("WearableRawPayloadDB")

    __table_args__ = (
        Index("idx_wearable_events_user_type_start", "user_id", "event_type", "start_time"),
        Index("idx_wearable_events_user_provider_external", "user_id", "provider", "external_id"),
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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    connection = relationship("WearableConnectionDB")
    source = relationship("WearableSourceDB")

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
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    items_seen = Column(Integer, default=0)
    items_written = Column(Integer, default=0)
    items_updated = Column(Integer, default=0)
    items_deleted = Column(Integer, default=0)
    error_json = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)

    connection = relationship("WearableConnectionDB")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")

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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")
    connection = relationship("FinancialConnectionDB")

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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")
    connection = relationship("FinancialConnectionDB")
    account = relationship("FinancialAccountDB")

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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    connection = relationship("FinancialConnectionDB")

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
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    items_seen = Column(Integer, default=0)
    items_written = Column(Integer, default=0)
    items_updated = Column(Integer, default=0)
    items_deleted = Column(Integer, default=0)
    error_json = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=True)

    connection = relationship("FinancialConnectionDB")


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

    user = relationship("UserDB")


class AIConversationDB(Base):
    """AI Chat conversation model for database"""
    __tablename__ = "ai_conversations"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=True)  # Optional title for the conversation
    response_mode = Column(String, default="text")  # 'text' or 'voice' - controls response style
    channel = Column(String, nullable=False, default="app")  # 'app', 'sms', or 'voice'
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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")
    conversation = relationship("AIConversationDB")


class BehaviorBaselineSnapshotDB(Base):
    """Computed behavior baselines used to score copilot interventions."""
    __tablename__ = "behavior_baseline_snapshots"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    metric_key = Column(String, nullable=False)
    lookback_days = Column(Integer, nullable=False, default=14)
    baseline_json = Column(Text, nullable=False)
    computed_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("UserDB")


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
    registered_at = Column(DateTime, default=datetime.utcnow)
    last_sync_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    sdk_version = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    
    # Relationships - using back_populates instead of backref to avoid conflicts
    user = relationship("UserDB")  # No backref to avoid mapper conflicts
    connection = relationship("WearableConnectionDB")
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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")
    device = relationship("WearableDeviceDB")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")

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
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("UserDB")
    session = relationship("HeartRateSessionDB")

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
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("UserDB")

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
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB")


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
    generated_at = Column(DateTime, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    error_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    schedule = relationship("ReportScheduleDB")
    user = relationship("UserDB")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    report_run = relationship("ReportRunDB")
    user = relationship("UserDB")
