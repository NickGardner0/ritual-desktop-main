# app/schemas/habit_data_integration.py
from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, field_validator
from uuid import UUID

class HabitDataIntegrationBase(BaseModel):
    source: str
    metric_name: str
    value: float
    unit: Optional[str] = None
    timestamp: datetime
    extra_data: Optional[Dict[str, Any]] = None

class HabitDataIntegrationCreate(HabitDataIntegrationBase):
    habit_id: str

class HabitDataIntegrationResponse(HabitDataIntegrationBase):
    id: str
    habit_id: str
    user_id: str

    @field_validator('id', 'habit_id', 'user_id', mode='before')
    @classmethod
    def convert_uuid_to_str(cls, value):
        """Convert UUID objects to strings"""
        if isinstance(value, UUID):
            return str(value)
        return value

    class Config:
        from_attributes = True 