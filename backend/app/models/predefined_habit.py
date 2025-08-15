from sqlalchemy import Column, String, Enum, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from .db import Base

class PredefinedHabit(Base):
    __tablename__ = "predefined_habits"

    id = Column(UUID(as_uuid=True), primary_key=True)
    name = Column(String, nullable=False)
    type = Column(Enum("manual", "wearable", name="predefined_habit_type"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
