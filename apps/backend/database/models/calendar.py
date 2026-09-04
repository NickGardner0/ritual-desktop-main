"""Calendar V2 persistence models.

Ritual-native events are canonical in the Ritual database. Provider-backed
events retain a normalized mirror here while the provider remains authoritative.
"""

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive


class CalendarAccountDB(Base):
    __tablename__ = "calendar_accounts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider = Column(String, nullable=False, default="google")
    provider_account_id = Column(String, nullable=False)
    email = Column(String, nullable=True)
    status = Column(String, nullable=False, default="active")
    scopes_json = Column(Text, nullable=False, default="[]")
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    consent_version = Column(String, nullable=False, default="calendar-v1")
    consented_at = Column(DateTime, nullable=False, default=_utcnow_naive)
    connected_at = Column(DateTime, nullable=False, default=_utcnow_naive)
    last_sync_at = Column(DateTime, nullable=True)
    last_error = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_calendar_accounts_user_provider", "user_id", "provider"),
        Index(
            "idx_calendar_accounts_provider_identity",
            "provider",
            "provider_account_id",
            unique=True,
        ),
    )


class CalendarSourceDB(Base):
    __tablename__ = "calendar_sources"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(String, ForeignKey("calendar_accounts.id", ondelete="CASCADE"), nullable=True)
    provider_calendar_id = Column(String, nullable=True)
    name = Column(String, nullable=False)
    color = Column(String, nullable=True)
    timezone = Column(String, nullable=False, default="UTC")
    access_role = Column(String, nullable=False, default="owner")
    is_visible = Column(Boolean, nullable=False, default=True)
    is_primary = Column(Boolean, nullable=False, default=False)
    is_default_write = Column(Boolean, nullable=False, default=False)
    sync_token = Column(Text, nullable=True)
    watch_channel_id = Column(String, nullable=True)
    watch_resource_id = Column(String, nullable=True)
    watch_token = Column(Text, nullable=True)
    watch_expires_at = Column(DateTime, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_error = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    account = orm_relationship("CalendarAccountDB")
    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_calendar_sources_user_visible", "user_id", "is_visible"),
        Index(
            "idx_calendar_sources_provider_calendar",
            "account_id",
            "provider_calendar_id",
            unique=True,
            sqlite_where=text("provider_calendar_id IS NOT NULL"),
        ),
    )


class CalendarEventDB(Base):
    __tablename__ = "calendar_events"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source_id = Column(String, ForeignKey("calendar_sources.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String, nullable=False, default="event")  # event | task_allocation
    origin = Column(String, nullable=False, default="ritual")  # ritual | google | ai
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    start_at = Column(DateTime, nullable=True)
    end_at = Column(DateTime, nullable=True)
    start_date = Column(String, nullable=True)
    end_date = Column(String, nullable=True)
    timezone = Column(String, nullable=False, default="UTC")
    all_day = Column(Boolean, nullable=False, default=False)
    status = Column(String, nullable=False, default="confirmed")
    availability = Column(String, nullable=False, default="busy")
    visibility = Column(String, nullable=False, default="default")
    location_json = Column(Text, nullable=False, default="{}")
    conference_json = Column(Text, nullable=False, default="{}")
    organizer_json = Column(Text, nullable=False, default="{}")
    attendees_json = Column(Text, nullable=False, default="[]")
    reminders_json = Column(Text, nullable=False, default="{}")
    recurrence_json = Column(Text, nullable=False, default="[]")
    recurring_event_id = Column(String, ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=True)
    original_start_at = Column(DateTime, nullable=True)
    original_start_date = Column(String, nullable=True)
    task_id = Column(String, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    routine_run_id = Column(String, ForeignKey("routine_runs.id", ondelete="SET NULL"), nullable=True)
    provider_event_id = Column(String, nullable=True)
    provider_event_type = Column(String, nullable=True)
    provider_etag = Column(String, nullable=True)
    ical_uid = Column(String, nullable=True)
    provider_payload_json = Column(Text, nullable=False, default="{}")
    sync_state = Column(String, nullable=False, default="local")
    client_event_id = Column(String, nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    source = orm_relationship("CalendarSourceDB")
    task = orm_relationship("TaskDB")
    routine_run = orm_relationship("RoutineRunDB")
    recurring_event = orm_relationship("CalendarEventDB", remote_side=[id])
    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_calendar_events_user_time", "user_id", "start_at", "end_at"),
        Index("idx_calendar_events_user_dates", "user_id", "start_date", "end_date"),
        Index("idx_calendar_events_user_task", "user_id", "task_id"),
        Index(
            "idx_calendar_events_provider_identity",
            "source_id",
            "provider_event_id",
            unique=True,
            sqlite_where=text("provider_event_id IS NOT NULL"),
        ),
        Index(
            "idx_calendar_events_user_client_event",
            "user_id",
            "client_event_id",
            unique=True,
            sqlite_where=text("client_event_id IS NOT NULL"),
        ),
    )


class CalendarOccurrenceDB(Base):
    __tablename__ = "calendar_occurrences"

    id = Column(String, primary_key=True)
    event_id = Column(String, ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False)
    override_event_id = Column(String, ForeignKey("calendar_events.id", ondelete="SET NULL"), nullable=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source_id = Column(String, ForeignKey("calendar_sources.id", ondelete="SET NULL"), nullable=True)
    provider_instance_id = Column(String, nullable=True)
    original_start_at = Column(DateTime, nullable=True)
    original_start_date = Column(String, nullable=True)
    start_at = Column(DateTime, nullable=True)
    end_at = Column(DateTime, nullable=True)
    start_date = Column(String, nullable=True)
    end_date = Column(String, nullable=True)
    timezone = Column(String, nullable=False, default="UTC")
    all_day = Column(Boolean, nullable=False, default=False)
    status = Column(String, nullable=False, default="confirmed")
    is_exception = Column(Boolean, nullable=False, default=False)
    revision = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    event = orm_relationship("CalendarEventDB", foreign_keys=[event_id])
    override_event = orm_relationship("CalendarEventDB", foreign_keys=[override_event_id])
    source = orm_relationship("CalendarSourceDB")
    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_calendar_occurrences_user_time", "user_id", "start_at", "end_at"),
        Index("idx_calendar_occurrences_user_dates", "user_id", "start_date", "end_date"),
        Index("idx_calendar_occurrences_event_original", "event_id", "original_start_at", "original_start_date"),
        Index("idx_calendar_occurrences_override", "override_event_id"),
        Index(
            "idx_calendar_occurrences_provider_instance",
            "source_id",
            "provider_instance_id",
            unique=True,
            sqlite_where=text("provider_instance_id IS NOT NULL"),
        ),
    )


class CalendarSyncRunDB(Base):
    __tablename__ = "calendar_sync_runs"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(String, ForeignKey("calendar_accounts.id", ondelete="CASCADE"), nullable=True)
    source_id = Column(String, ForeignKey("calendar_sources.id", ondelete="SET NULL"), nullable=True)
    trigger = Column(String, nullable=False)
    status = Column(String, nullable=False, default="running")
    cursor_reset = Column(Boolean, nullable=False, default=False)
    imported_count = Column(Integer, nullable=False, default=0)
    deleted_count = Column(Integer, nullable=False, default=0)
    error_code = Column(String, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    started_at = Column(DateTime, nullable=False, default=_utcnow_naive)
    finished_at = Column(DateTime, nullable=True)

    account = orm_relationship("CalendarAccountDB")
    source = orm_relationship("CalendarSourceDB")
    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_calendar_sync_runs_user_started", "user_id", "started_at"),
        Index("idx_calendar_sync_runs_source_status", "source_id", "status"),
    )
