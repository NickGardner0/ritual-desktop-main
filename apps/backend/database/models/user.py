"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive


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


class AccountDeletionJobDB(Base):
    """Durable, data-minimized receipt for coordinated account erasure.

    This row intentionally does not reference ``users`` so it survives deletion
    of the account and can make Clerk webhook retries idempotent.
    """

    __tablename__ = "account_deletion_jobs"

    user_id = Column(String, primary_key=True)
    event_id = Column(String, nullable=True)
    source = Column(String, nullable=False)
    email_hash = Column(String, nullable=True)
    status = Column(String, nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    receipt_json = Column(Text, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    completed_at = Column(DateTime, nullable=True)


class UserActivationStateDB(Base):
    """Durable first-run activation state for a user's personal setup."""
    __tablename__ = "user_activation_state"

    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    profile_completed_at = Column(DateTime, nullable=True)
    first_habit_id = Column(String, ForeignKey("habits.id", ondelete="SET NULL"), nullable=True)
    first_log_id = Column(String, ForeignKey("habit_logs.id", ondelete="SET NULL"), nullable=True)
    first_behavior_logged_at = Column(DateTime, nullable=True)
    permissions_seen_at = Column(DateTime, nullable=True)
    activation_completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    first_habit = orm_relationship("HabitDB")
    first_log = orm_relationship("HabitLogDB")





class UserActivationChecklistItemDB(Base):
    """Persisted activation checklist status for optional integrations and permissions."""
    __tablename__ = "user_activation_checklist_items"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key = Column(String, nullable=False)
    status = Column(String, nullable=False, default="not_started")
    metadata_json = Column(Text, nullable=True)
    seen_at = Column(DateTime, nullable=True)
    skipped_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_activation_checklist_user_key", "user_id", "key", unique=True),
    )





class UserUIPreferencesDB(Base):
    """Per-user UI appearance preferences (overview text color, etc.)."""
    __tablename__ = "user_ui_preferences"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    habit_text_color = Column(String, nullable=True)
    overview_view_mode = Column(String, nullable=True)
    calendar_preferences_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

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
