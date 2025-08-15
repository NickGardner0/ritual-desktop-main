from sqlalchemy import Column, String, Numeric, DateTime, ForeignKey, func, Text
from sqlalchemy.dialects.postgresql import UUID
from .db import Base

class HabitDataIntegration(Base):
    __tablename__ = "habit_data_integrations"

    id = Column(UUID(as_uuid=True), primary_key=True)
    habit_id = Column(UUID(as_uuid=True), ForeignKey("habits.id", ondelete="CASCADE"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"))
    source = Column(String, nullable=False)
    metric_name = Column(String, nullable=False)
    value = Column(Numeric, nullable=False)
    unit = Column(String)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    extra_data = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
