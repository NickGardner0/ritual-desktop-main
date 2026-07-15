"""Experiment workspace model definitions."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive


class ExperimentDB(Base):
    """A durable workspace for a user-run experiment."""

    __tablename__ = "experiments"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="active")  # active | completed | archived
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    threads = orm_relationship("AIConversationDB", back_populates="experiment", passive_deletes=True)
    entries = orm_relationship(
        "ExperimentEntryDB",
        back_populates="experiment",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        Index("idx_experiments_user_updated", "user_id", "updated_at"),
        Index("idx_experiments_user_status", "user_id", "status"),
    )


class ExperimentEntryDB(Base):
    """A durable observation, file reference, metric, or conclusion."""

    __tablename__ = "experiment_entries"

    id = Column(String, primary_key=True)
    experiment_id = Column(String, ForeignKey("experiments.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String, nullable=False)  # observation | file | metric | conclusion
    title = Column(String, nullable=False)
    content = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    experiment = orm_relationship("ExperimentDB", back_populates="entries")
    user = orm_relationship("UserDB")

    __table_args__ = (
        Index("idx_experiment_entries_experiment_kind", "experiment_id", "kind", "created_at"),
        Index("idx_experiment_entries_user_updated", "user_id", "updated_at"),
    )
