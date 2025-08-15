from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from .db import Base

class HabitUnit(Base):
    __tablename__ = "habit_units"

    id = Column(UUID(as_uuid=True), primary_key=True)
    type = Column(String, unique=True, nullable=False)
    default_unit = Column(String, nullable=False)
    allowed_units = Column(String, nullable=False)  # Store as comma-separated string for SQLite
    created_at = Column(DateTime(timezone=True), server_default=func.now())
