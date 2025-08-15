# app/schemas/habit_log.py
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, field_validator
from uuid import UUID

class HabitLogBase(BaseModel):
    date: date
    duration: Optional[int] = None
    amount: Optional[float] = None
    unit: Optional[str] = None
    status: Optional[str] = 'completed'
    notes: Optional[str] = None

class HabitLogCreate(HabitLogBase):
    habit_id: str

class HabitLogUpdate(BaseModel):
    date: Optional[date] = None
    duration: Optional[int] = None
    amount: Optional[float] = None
    unit: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class HabitLogResponse(HabitLogBase):
    id: str
    habit_id: str
    user_id: str
    created_at: datetime

    @field_validator('id', 'habit_id', 'user_id', mode='before')
    @classmethod
    def convert_uuid_to_str(cls, value):
        """Convert UUID objects to strings"""
        if isinstance(value, UUID):
            return str(value)
        return value

    class Config:
        from_attributes = True 