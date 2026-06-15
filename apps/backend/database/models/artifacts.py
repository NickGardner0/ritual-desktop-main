"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



class ArtifactDB(Base):
    """Durable artifact produced by reports or workflow runs."""
    __tablename__ = "artifacts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String, nullable=False)  # report | morning_brief | shutdown_review | notebook | plan | conversation_brief | ambient_digest
    source_type = Column(String, nullable=False)  # report_run | workflow_run | conversation
    source_id = Column(String, nullable=True)
    title = Column(String, nullable=False)
    slug = Column(String, nullable=True)
    status = Column(String, nullable=False, default="published")  # draft | published | archived
    summary = Column(Text, nullable=True)
    preview_text = Column(Text, nullable=True)
    folder_key = Column(String, nullable=True)
    is_pinned = Column(Boolean, nullable=False, default=False)
    body_json = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=False, default="{}")
    period_start = Column(String, nullable=True)
    period_end = Column(String, nullable=True)
    timezone = Column(String, nullable=False, default="America/New_York")
    conversation_id = Column(String, ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True)
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")
    conversation = orm_relationship("AIConversationDB")





class ArtifactRevisionDB(Base):
    """Full-snapshot revision log for an artifact."""
    __tablename__ = "artifact_revisions"

    id = Column(String, primary_key=True)
    artifact_id = Column(String, ForeignKey("artifacts.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    editor_type = Column(String, nullable=False)  # system | assistant | user
    body_json = Column(Text, nullable=False)
    summary = Column(Text, nullable=True)
    change_note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)

    artifact = orm_relationship("ArtifactDB")





class ArtifactLinkDB(Base):
    """Generic link table so docs can reference conversations, facts, workflow runs, and ambient events."""
    __tablename__ = "artifact_links"

    id = Column(String, primary_key=True)
    artifact_id = Column(String, ForeignKey("artifacts.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    target_type = Column(String, nullable=False)  # conversation | message | workflow_run | fact | ambient_signal
    target_id = Column(String, nullable=False)
    relationship = Column(String, nullable=False, default="linked")
    metadata_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)

    artifact = orm_relationship("ArtifactDB")
    user = orm_relationship("UserDB")



