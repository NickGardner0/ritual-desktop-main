# app/schemas/habit.py
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, field_validator
from uuid import UUID

class HabitBase(BaseModel):
    name: str
    category: str
    integration_source: Optional[str] = None
    unit_type: Optional[str] = None
    target_duration: Optional[int] = None  # Target duration in seconds
    is_custom: Optional[bool] = True
    icon: Optional[str] = None

class HabitCreate(HabitBase):
    pass

class HabitUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    integration_source: Optional[str] = None
    unit_type: Optional[str] = None
    target_duration: Optional[int] = None
    is_custom: Optional[bool] = None
    icon: Optional[str] = None

class HabitResponse(HabitBase):
    id: str
    user_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    icon: Optional[str] = None

    @field_validator('id', 'user_id', mode='before')
    @classmethod
    def convert_uuid_to_str(cls, value):
        """Convert UUID objects to strings"""
        if isinstance(value, UUID):
            return str(value)
        return value

    class Config:
        from_attributes = True 