"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



class AiFactDB(Base):
    """Approved and pending semantic memory facts for Ritual AI."""
    __tablename__ = "ai_facts"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category = Column(String, nullable=False)  # goal | preference | constraint | routine | profile
    subject = Column(String, nullable=False)
    predicate = Column(String, nullable=False)
    value_json = Column(Text, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending | active | dismissed | archived
    confidence = Column(Float, nullable=False, default=0.5)
    source_type = Column(String, nullable=False, default="assistant")  # onboarding | assistant | workflow | ambient | user
    source_ref = Column(String, nullable=True)
    visibility = Column(String, nullable=False, default="private")  # private | prompt | ui
    last_confirmed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)
    updated_at = Column(DateTime, default=_utcnow_naive, onupdate=_utcnow_naive)

    user = orm_relationship("UserDB")





class AiFactEventDB(Base):
    """Audit/history table for fact changes."""
    __tablename__ = "ai_fact_events"

    id = Column(String, primary_key=True)
    fact_id = Column(String, ForeignKey("ai_facts.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_type = Column(String, nullable=False)  # suggested | approved | updated | dismissed | expired
    payload_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=_utcnow_naive)

    fact = orm_relationship("AiFactDB")
    user = orm_relationship("UserDB")



