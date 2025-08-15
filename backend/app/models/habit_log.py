from sqlalchemy import Column, String, Integer, Numeric, Enum, Date, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from .db import Base

class HabitLog(Base):
    __tablename__ = "habit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True)
    habit_id = Column(UUID(as_uuid=True), ForeignKey("habits.id", ondelete="CASCADE"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"))
    date = Column(Date, nullable=False)
    duration = Column(Integer)
    amount = Column(Numeric)
    unit = Column(String)
    status = Column(Enum("completed", "skipped", "missed", name="habit_status"), default="completed")
    notes = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
