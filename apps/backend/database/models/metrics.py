"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



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



