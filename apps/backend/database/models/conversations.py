"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



class AIConversationDB(Base):
    """AI Chat conversation model for database"""
    __tablename__ = "ai_conversations"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    experiment_id = Column(String, ForeignKey("experiments.id", ondelete="SET NULL"), nullable=True)
    title = Column(String, nullable=True)  # Optional title for the conversation
    response_mode = Column(String, default="text")  # 'text' or 'voice' - controls response style
    channel = Column(String, nullable=False, default="app")  # 'app', 'sms', or 'voice'
    auto_run_queued = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    # Relationships
    user = orm_relationship("UserDB", backref="ai_conversations")
    experiment = orm_relationship("ExperimentDB", back_populates="threads")
    messages = orm_relationship("AIMessageDB", back_populates="conversation", cascade="all, delete-orphan", order_by="AIMessageDB.created_at")
    assistant_turns = orm_relationship("AssistantTurnDB", back_populates="conversation", cascade="all, delete-orphan")





class AIMessageDB(Base):
    """AI Chat message model for database"""
    __tablename__ = "ai_messages"

    id = Column(String, primary_key=True)
    conversation_id = Column(String, ForeignKey("ai_conversations.id"), nullable=False)
    role = Column(String, nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    tool_payload = Column(Text, nullable=True)  # JSON string of tool results for canvas rehydration
    created_at = Column(DateTime, default=_utcnow_naive)

    # Relationships
    conversation = orm_relationship("AIConversationDB", back_populates="messages")





class ConversationQueueItemDB(Base):
    """Queued follow-up prompts for a conversation."""
    __tablename__ = "conversation_queue_items"

    id = Column(String, primary_key=True)
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    prompt_text = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending | running | completed | canceled | stale | failed
    source = Column(String, nullable=False, default="manual")  # manual | reply_chip | suggestion | workflow
    after_message_id = Column(String, nullable=True)
    position = Column(Integer, nullable=False, default=0)
    auto_run = Column(Boolean, nullable=False, default=False)
    error_json = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    conversation = orm_relationship("AIConversationDB")
    user = orm_relationship("UserDB")


class AssistantTurnDB(Base):
    """Durable assistant turn owner for web/SMS chat."""
    __tablename__ = "assistant_turns"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=True)
    channel = Column(String, nullable=False, default="dashboard")
    status = Column(String, nullable=False, default="queued")
    epoch = Column(Integer, nullable=False, default=0)
    sequence = Column(Integer, nullable=False, default=0)
    receipt_ids_json = Column(Text, nullable=False, default="[]")
    assistant_text = Column(Text, nullable=True)
    tool_payload_json = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)
    completed_at = Column(DateTime, nullable=True)

    user = orm_relationship("UserDB")
    conversation = orm_relationship("AIConversationDB", back_populates="assistant_turns")

    __table_args__ = (
        Index("idx_assistant_turns_user_created", "user_id", "created_at"),
        Index("idx_assistant_turns_conversation_sequence", "conversation_id", "sequence"),
    )


