"""
SQLAlchemy ORM models for habits
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, Enum, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.utils.database import Base
import enum
from typing import Optional, List

# Match the Pydantic enum classes
class HabitCategoryEnum(str, enum.Enum):
    PRODUCTIVITY = "productivity"
    HEALTH = "health"
    FITNESS = "fitness"
    LEARNING = "learning"
    MINDFULNESS = "mindfulness"
    SOCIAL = "social"
    CREATIVE = "creative"
    CUSTOM = "custom"

class HabitFrequencyEnum(str, enum.Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    CUSTOM = "custom"

class Habit(Base):
    """SQLAlchemy ORM model for habits"""
    __tablename__ = "habits"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    emoji = Column(String, nullable=False)
    category = Column(Enum(HabitCategoryEnum), nullable=False)
    description = Column(Text, nullable=True)
    frequency = Column(Enum(HabitFrequencyEnum), nullable=False, default=HabitFrequencyEnum.DAILY)
    target_days = Column(ARRAY(Integer), nullable=True)  # 0-6 for weekdays
    target_count = Column(Integer, nullable=False, default=1)
    color = Column(String, nullable=True)
    icon = Column(String, nullable=True)
    user_id = Column(String, nullable=False)
    
    # Stats fields
    streak = Column(Integer, nullable=False, default=0)
    longest_streak = Column(Integer, nullable=False, default=0)
    total_completions = Column(Integer, nullable=False, default=0)
    
    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=True, onupdate=datetime.now)
    last_completed_at = Column(DateTime, nullable=True)
    next_due_at = Column(DateTime, nullable=True)
    
    def __repr__(self):
        return f"<Habit(id='{self.id}', name='{self.name}')>"


class HabitCompletion(Base):
    """SQLAlchemy ORM model for habit completions"""
    __tablename__ = "habit_completions"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    habit_id = Column(String, nullable=False)  # Foreign key to habits table
    completed_at = Column(DateTime, nullable=False, default=datetime.now)
    count = Column(Integer, nullable=False, default=1)
    notes = Column(Text, nullable=True)
    user_id = Column(String, nullable=False)  # For security/filtering
    
    def __repr__(self):
        return f"<HabitCompletion(id='{self.id}', habit_id='{self.habit_id}', completed_at='{self.completed_at}')>" 