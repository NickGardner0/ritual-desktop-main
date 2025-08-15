# app/schemas/habit_unit.py
from datetime import datetime
from typing import List
from pydantic import BaseModel, field_validator
from uuid import UUID

class HabitUnitBase(BaseModel):
    type: str
    default_unit: str
    allowed_units: List[str]

class HabitUnitCreate(HabitUnitBase):
    pass

class HabitUnitResponse(HabitUnitBase):
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