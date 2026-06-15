"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



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
    biome_is_provisional = Column(Integer, nullable=False, default=0)
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



