"""
SQLAlchemy ORM models for command palette actions
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, Enum, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.utils.database import Base
import enum
from typing import Optional, List

class ActionTypeEnum(str, enum.Enum):
    """Types of actions for the command palette"""
    QUICK_ACTION = "quick_action"
    NAVIGATION = "navigation"
    SHORTCUT = "shortcut"
    HABIT = "habit"
    FOCUS = "focus"
    COMMAND = "command"

class Action(Base):
    """SQLAlchemy ORM model for command palette actions"""
    __tablename__ = "actions"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    type = Column(Enum(ActionTypeEnum), nullable=False)
    emoji = Column(String, nullable=True)
    icon = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    shortcut = Column(String, nullable=True)
    category = Column(String, nullable=True)
    action_metadata = Column(JSONB, nullable=True)  # Store any additional metadata as JSON, renamed from metadata
    is_system = Column(Boolean, nullable=False, default=False)
    usage_count = Column(Integer, nullable=False, default=0)
    
    # For user-specific actions
    user_id = Column(String, nullable=True)  # Null for system actions
    
    # Timestamps
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    updated_at = Column(DateTime, nullable=True, onupdate=datetime.now)
    
    def __repr__(self):
        return f"<Action(id='{self.id}', name='{self.name}', type='{self.type}')>"


class UserFavorite(Base):
    """SQLAlchemy ORM model for user favorites"""
    __tablename__ = "user_favorites"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False)
    action_id = Column(String, nullable=False)  # Can point to either an action or a habit
    item_type = Column(String, nullable=False)  # "action" or "habit"
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    
    def __repr__(self):
        return f"<UserFavorite(user_id='{self.user_id}', action_id='{self.action_id}')>"


class UserRecent(Base):
    """SQLAlchemy ORM model for user recent actions"""
    __tablename__ = "user_recent"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False)
    action_id = Column(String, nullable=False)  # Can point to either an action or a habit
    item_type = Column(String, nullable=False)  # "action" or "habit"
    used_at = Column(DateTime, nullable=False, default=datetime.now)
    
    def __repr__(self):
        return f"<UserRecent(user_id='{self.user_id}', action_id='{self.action_id}')>" 