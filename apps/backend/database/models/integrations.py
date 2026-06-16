"""SQLAlchemy model definitions."""

from sqlalchemy import Column, String, Boolean, Integer, BigInteger, Float, DateTime, Text, ForeignKey, Index, text
from sqlalchemy.orm import relationship as orm_relationship

from database.models.base import Base, _utcnow_naive



class IntegrationDB(Base):
    """Generic integration status row (provider-scoped per user)."""
    __tablename__ = "integrations"

    user_id = Column(String, ForeignKey("users.id"), primary_key=True)
    provider = Column(String, primary_key=True)  # e.g. "weather"
    enabled = Column(Boolean, nullable=False, default=False)
    connected_at = Column(DateTime, nullable=True)
    disabled_at = Column(DateTime, nullable=True)
    metadata_json = Column("metadata", Text, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)

    user = orm_relationship("UserDB")



