"""Durable scheduler occurrence claims."""

from sqlalchemy import Column, DateTime, Index, Integer, String, Text, UniqueConstraint

from database.models.base import Base, _utcnow_naive


class SchedulerOccurrenceClaimDB(Base):
    """One lease and terminal result for a normalized clock occurrence."""

    __tablename__ = "scheduler_occurrence_claims"

    id = Column(String, primary_key=True)
    job_key = Column(String, nullable=False)
    scope_key = Column(String, nullable=False, default="global")
    scheduled_for = Column(DateTime, nullable=False)
    status = Column(String, nullable=False, default="running")
    lease_owner = Column(String, nullable=True)
    lease_expires_at = Column(DateTime, nullable=True)
    attempt_count = Column(Integer, nullable=False, default=1)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    __table_args__ = (
        UniqueConstraint(
            "job_key",
            "scope_key",
            "scheduled_for",
            name="uq_scheduler_occurrence_identity",
        ),
        Index("idx_scheduler_occurrence_status_lease", "status", "lease_expires_at"),
        Index("idx_scheduler_occurrence_job_scheduled", "job_key", "scheduled_for"),
    )
