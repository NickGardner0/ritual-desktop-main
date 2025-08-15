from sqlalchemy import Column, String, Boolean, Enum, ForeignKey, DateTime, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from .db import Base

class Habit(Base):
    __tablename__ = "habits"

    id = Column(UUID(as_uuid=True), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"))
    name = Column(String, nullable=False)
    category = Column(Enum("manual", "wearable", name="habit_category"), nullable=False)
    integration_source = Column(String)
    unit_type = Column(String)
    target_duration = Column(Integer)  # Target duration in seconds
    is_custom = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    icon = Column(String, nullable=True)
