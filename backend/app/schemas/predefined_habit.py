# app/schemas/predefined_habit.py
from datetime import datetime
from pydantic import BaseModel, field_validator
from uuid import UUID

class PredefinedHabitBase(BaseModel):
    name: str
    type: str

class PredefinedHabitCreate(PredefinedHabitBase):
    pass

class PredefinedHabitResponse(PredefinedHabitBase):
    id: str
    created_at: datetime

    @field_validator('id', mode='before')
    @classmethod
    def convert_uuid_to_str(cls, value):
        """Convert UUID objects to strings"""
        if isinstance(value, UUID):
            return str(value)
        return value

    class Config:
        from_attributes = True 