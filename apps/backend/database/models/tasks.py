"""Task and routine model definitions."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive


class TaskDB(Base):
    """A concrete user-visible commitment."""

    __tablename__ = "tasks"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    notes = Column(Text, nullable=True)
    # User-facing: open | in_progress | in_review | completed | canceled.
    # skipped and archived remain readable for legacy/internal records.
    status = Column(String, nullable=False, default="open")
    priority = Column(String, nullable=False, default="none")  # none | low | medium | high | urgent
    due_at = Column(DateTime, nullable=True)
    scheduled_for = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    source = Column(String, nullable=False, default="manual")  # manual | routine | ai | calendar | habit | experiment
    project = Column(String, nullable=True)
    category = Column(String, nullable=True)
    tags_json = Column(Text, nullable=False, default="[]")
    routine_id = Column(String, ForeignKey("routines.id", ondelete="SET NULL"), nullable=True)
    routine_run_id = Column(String, ForeignKey("routine_runs.id", ondelete="SET NULL"), nullable=True)
    linked_habit_id = Column(String, ForeignKey("habits.id", ondelete="SET NULL"), nullable=True)
    linked_artifact_id = Column(String, ForeignKey("artifacts.id", ondelete="SET NULL"), nullable=True)
    client_event_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    routine = orm_relationship("RoutineDB", foreign_keys=[routine_id])
    routine_run = orm_relationship("RoutineRunDB", foreign_keys=[routine_run_id])

    __table_args__ = (
        Index("idx_tasks_user_status_scheduled", "user_id", "status", "scheduled_for"),
        Index("idx_tasks_user_status_due", "user_id", "status", "due_at"),
        Index("idx_tasks_user_source", "user_id", "source"),
        Index("idx_tasks_user_client_event", "user_id", "client_event_id", unique=True),
    )


class RoutineDB(Base):
    """A reusable rule that can generate tasks or workflow runs."""

    __tablename__ = "routines"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="scheduled")  # draft | scheduled | paused | archived
    kind = Column(String, nullable=False, default="task")  # task | ai_workflow | habit_prompt | calendar_block | mixed
    trigger_type = Column(String, nullable=False, default="daily")
    trigger_config_json = Column(Text, nullable=False, default="{}")
    timezone = Column(String, nullable=False, default="America/New_York")
    priority = Column(String, nullable=False, default="none")
    tags_json = Column(Text, nullable=False, default="[]")
    task_template_json = Column(Text, nullable=False, default="{}")
    ai_workflow_definition_id = Column(String, ForeignKey("workflow_definitions.id", ondelete="SET NULL"), nullable=True)
    first_run_at = Column(DateTime, nullable=True)
    ends_at = Column(DateTime, nullable=True)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    client_event_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    ai_workflow_definition = orm_relationship("WorkflowDefinitionDB")
    runs = orm_relationship("RoutineRunDB", back_populates="routine", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_routines_user_status_next", "user_id", "status", "next_run_at"),
        Index("idx_routines_user_kind", "user_id", "kind"),
        Index("idx_routines_user_client_event", "user_id", "client_event_id", unique=True),
    )


class RoutineRunDB(Base):
    """A generated or executed routine occurrence."""

    __tablename__ = "routine_runs"

    id = Column(String, primary_key=True)
    routine_id = Column(String, ForeignKey("routines.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    scheduled_for = Column(DateTime, nullable=False)
    status = Column(String, nullable=False, default="scheduled")  # scheduled | generated | completed | skipped | failed
    generated_task_id = Column(String, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    generated_scheduled_block_id = Column(String, ForeignKey("scheduled_blocks.id", ondelete="SET NULL"), nullable=True)
    workflow_run_id = Column(String, ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True)
    completed_at = Column(DateTime, nullable=True)
    skipped_at = Column(DateTime, nullable=True)
    error_json = Column(Text, nullable=True)
    idempotency_key = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    routine = orm_relationship("RoutineDB", back_populates="runs")
    generated_task = orm_relationship("TaskDB", foreign_keys=[generated_task_id])
    generated_scheduled_block = orm_relationship("ScheduledBlockDB")
    workflow_run = orm_relationship("WorkflowRunDB")

    __table_args__ = (
        Index("idx_routine_runs_user_status_scheduled", "user_id", "status", "scheduled_for"),
        Index("idx_routine_runs_routine_scheduled", "routine_id", "scheduled_for"),
        Index("idx_routine_runs_idempotency", "idempotency_key", unique=True),
    )


class TaskEventDB(Base):
    """Lightweight audit trail for task changes."""

    __tablename__ = "task_events"

    id = Column(String, primary_key=True)
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String, nullable=False)
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)

    user = orm_relationship("UserDB")
    task = orm_relationship("TaskDB")

    __table_args__ = (
        Index("idx_task_events_task_created", "task_id", "created_at"),
        Index("idx_task_events_user_created", "user_id", "created_at"),
    )
