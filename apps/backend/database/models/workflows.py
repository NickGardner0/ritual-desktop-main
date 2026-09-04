"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



class ActionProfileDB(Base):
    """Execution profile that constrains workflow behavior."""
    __tablename__ = "action_profiles"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    mode = Column(String, nullable=False)  # observe | draft | organize | act
    is_default = Column(Boolean, nullable=False, default=False)
    rules_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")





class WorkflowDefinitionDB(Base):
    """Saved workflow definition for in-app routines."""
    __tablename__ = "workflow_definitions"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String, nullable=False)  # morning_brief | shutdown_review | daily_narrative | distraction_spiral
    name = Column(String, nullable=False)
    definition_family = Column(String, nullable=False, default="routine")  # routine | ambient
    trigger_type = Column(String, nullable=False, default="schedule")  # schedule | signal
    signal_kind = Column(String, nullable=True)
    cooldown_minutes = Column(Integer, nullable=False, default=240)
    quiet_hours_json = Column(Text, nullable=False, default="{}")
    status = Column(String, nullable=False, default="draft")  # draft | scheduled | paused
    timezone = Column(String, nullable=False, default="America/New_York")
    cadence = Column(String, nullable=False, default="daily")
    send_hour_local = Column(Integer, nullable=False, default=8)
    send_minute_local = Column(Integer, nullable=False, default=0)
    expected_duration_minutes = Column(Integer, nullable=False, default=30)
    send_weekdays_json = Column(Text, nullable=False, default="[]")
    delivery_channel = Column(String, nullable=False, default="in_app")
    delivery_json = Column(Text, nullable=False, default="{}")
    ranking_json = Column(Text, nullable=False, default="{}")
    config_json = Column(Text, nullable=False, default="{}")
    template_version = Column(Integer, nullable=False, default=1)
    action_profile_id = Column(String, ForeignKey("action_profiles.id"), nullable=False)
    last_run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    action_profile = orm_relationship("ActionProfileDB")





class WorkflowRunDB(Base):
    """Queued or processed execution of a workflow definition."""
    __tablename__ = "workflow_runs"

    id = Column(String, primary_key=True)
    workflow_definition_id = Column(String, ForeignKey("workflow_definitions.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(String, nullable=False, default="queued")  # queued | processing | completed | failed | canceled
    trigger_source = Column(String, nullable=False)  # manual | scheduled | backfill
    window_start = Column(DateTime, nullable=True)
    window_end = Column(DateTime, nullable=True)
    artifact_id = Column(String, ForeignKey("artifacts.id", ondelete="SET NULL"), nullable=True)
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True)
    plan_json = Column(Text, nullable=True)
    result_json = Column(Text, nullable=True)
    proposed_actions_json = Column(Text, nullable=True)
    policy_decisions_json = Column(Text, nullable=True)
    fact_suggestions_json = Column(Text, nullable=True)
    queue_suggestions_json = Column(Text, nullable=True)
    error_json = Column(Text, nullable=True)
    idempotency_key = Column(String, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    workflow_definition = orm_relationship("WorkflowDefinitionDB")
    user = orm_relationship("UserDB")
    artifact = orm_relationship("ArtifactDB")
    conversation = orm_relationship("AIConversationDB")





class ApprovalRequestDB(Base):
    """Approval queue entry for future workflow actions."""
    __tablename__ = "approval_requests"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workflow_run_id = Column(String, ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True)
    action_kind = Column(String, nullable=False)
    capability = Column(String, nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending | approved | rejected | expired
    reason = Column(Text, nullable=True)
    payload_json = Column(Text, nullable=False, default="{}")
    proposed_action_json = Column(Text, nullable=False, default="{}")
    policy_decision_json = Column(Text, nullable=False, default="{}")
    expires_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    workflow_run = orm_relationship("WorkflowRunDB")





class ActionReceiptDB(Base):
    """Audit log for every mutating action the backend applies or rejects."""
    __tablename__ = "action_receipts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workflow_run_id = Column(String, ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True)
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True)
    client_event_id = Column(String, nullable=True)
    action_kind = Column(String, nullable=False)
    capability = Column(String, nullable=False)
    target_ref = Column(String, nullable=True)
    # applied | rejected | approved_pending | undone
    status = Column(String, nullable=False, default="applied")
    before_json = Column(Text, nullable=True)
    after_json = Column(Text, nullable=True)
    undo_json = Column(Text, nullable=True)
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)

    user = orm_relationship("UserDB")
    workflow_run = orm_relationship("WorkflowRunDB")
    conversation = orm_relationship("AIConversationDB")

    __table_args__ = (
        Index(
            "idx_action_receipts_user_client_event",
            "user_id",
            "client_event_id",
            unique=True,
            sqlite_where=text("client_event_id IS NOT NULL"),
        ),
    )





class AmbientSignalEventDB(Base):
    """Signal evaluation history for in-app ambient agents."""
    __tablename__ = "ambient_signal_events"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    workflow_definition_id = Column(String, ForeignKey("workflow_definitions.id", ondelete="SET NULL"), nullable=True)
    workflow_run_id = Column(String, ForeignKey("workflow_runs.id", ondelete="SET NULL"), nullable=True)
    signal_kind = Column(String, nullable=False)
    status = Column(String, nullable=False, default="candidate")  # candidate | triggered | suppressed | dismissed | snoozed
    score = Column(Float, nullable=False, default=0.0)
    confidence = Column(Float, nullable=False, default=0.0)
    suppression_reason = Column(Text, nullable=True)
    dedupe_key = Column(String, nullable=True)
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    workflow_definition = orm_relationship("WorkflowDefinitionDB")
    workflow_run = orm_relationship("WorkflowRunDB")


