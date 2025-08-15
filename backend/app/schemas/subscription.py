# app/schemas/subscription.py
from datetime import datetime
from pydantic import BaseModel, field_validator
from typing import Optional
from uuid import UUID

class SubscriptionBase(BaseModel):
    plan: str
    status: str
    is_trial: bool = False
    start_date: datetime
    end_date: Optional[datetime] = None

class SubscriptionCreate(SubscriptionBase):
    pass

class SubscriptionResponse(SubscriptionBase):
    id: str
    user_id: str
    created_at: datetime

    @field_validator('id', 'user_id', mode='before')
    @classmethod
    def convert_uuid_to_str(cls, value):
        """Convert UUID objects to strings"""
        if isinstance(value, UUID):
            return str(value)
        return value

    class Config:
        from_attributes = True 