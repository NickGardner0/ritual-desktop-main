"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



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



