"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



class SmsPreferencesDB(Base):
    """Per-user SMS/iMessage chatbot preferences."""
    __tablename__ = "sms_preferences"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=True)
    proactive_enabled = Column(Boolean, nullable=False, default=True)
    quiet_hours_start = Column(String, nullable=True)  # "22:00" local time
    quiet_hours_end = Column(String, nullable=True)     # "08:00"
    max_proactive_per_day = Column(Integer, nullable=False, default=1)
    allowed_triggers = Column(String, nullable=False, default="")  # comma-separated
    daily_narrative_enabled = Column(Boolean, nullable=False, default=True)
    interrupts_enabled = Column(Boolean, nullable=False, default=True)
    allowed_interrupt_kinds = Column(String, nullable=False, default="distraction_spiral")
    max_interrupts_per_day = Column(Integer, nullable=False, default=2)
    min_hours_between_interrupts = Column(Integer, nullable=False, default=4)
    last_proactive_sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")





class SmsCopilotEventDB(Base):
    """Persisted outbound copilot events and their delivery lifecycle."""
    __tablename__ = "sms_copilot_events"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String, nullable=False)
    status = Column(String, nullable=False, default="candidate")
    score = Column(Float, nullable=False, default=0.0)
    confidence = Column(Float, nullable=False, default=0.0)
    novelty_score = Column(Float, nullable=False, default=0.0)
    actionability_score = Column(Float, nullable=False, default=0.0)
    dedupe_key = Column(String, nullable=False)
    suppression_reason = Column(String, nullable=True)
    trigger_window_start = Column(DateTime, nullable=True)
    trigger_window_end = Column(DateTime, nullable=True)
    headline = Column(String, nullable=True)
    body = Column(Text, nullable=True)
    metrics_json = Column(Text, nullable=True)
    response_options_json = Column(Text, nullable=True)
    assistant_message_id = Column(String, nullable=True)
    user_reply_message_id = Column(String, nullable=True)
    provider_message_id = Column(String, nullable=True)
    sent_at = Column(DateTime, nullable=True)
    replied_at = Column(DateTime, nullable=True)
    acted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    conversation = orm_relationship("AIConversationDB")





class BehaviorBaselineSnapshotDB(Base):
    """Computed behavior baselines used to score copilot interventions."""
    __tablename__ = "behavior_baseline_snapshots"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    metric_key = Column(String, nullable=False)
    lookback_days = Column(Integer, nullable=False, default=14)
    baseline_json = Column(Text, nullable=False)
    computed_at = Column(DateTime, default=_utcnow_naive)

    user = orm_relationship("UserDB")


# ================================
# WEARABLE METRICS - Apple Health + Multi-source support
# ================================


