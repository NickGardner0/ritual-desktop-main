"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive


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
    actor_type = Column(String, nullable=True)  # user | assistant | import | integration | system
    actor_ref = Column(String, nullable=True)  # conversation id, import run id, integration name, etc.
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
        Index(
            "idx_habit_logs_first_run_client_event",
            "client_event_id",
            unique=True,
            sqlite_where=text("client_event_id IS NOT NULL AND source = 'first_run'"),
        ),
        Index(
            "idx_habit_logs_habit_client_event",
            "habit_id",
            "client_event_id",
            unique=True,
            sqlite_where=text("client_event_id IS NOT NULL"),
        ),
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
    task_id = Column(String, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB", backref="scheduled_blocks")

    __table_args__ = (
        Index("idx_scheduled_blocks_user_task", "user_id", "task_id"),
    )


# ================================
# IMPORT SYSTEM - Robust Import Infrastructure
# ================================




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



