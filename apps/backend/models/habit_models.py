"""
Pydantic models that mirror the TypeScript interfaces exactly
"""

from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, Literal
from datetime import datetime
import uuid

# ================================
# HABIT MODELS - Mirror TypeScript Habit interface
# ================================

class HabitBase(BaseModel):
    name: str
    category: str
    icon: Optional[str] = None
    is_custom: Optional[bool] = False
    integration_source: Optional[str] = None  # 'apple_health', 'whoop', 'oura', 'fitbit', 'garmin', null
    unit_type: Optional[str] = None
    sensor_type: Optional[str] = None  # 'Apple Watch', 'Whoop', 'Manual', etc.
    metric_type: Optional[str] = None  # For wearables: 'steps', 'hr', 'hrv', 'sleep_session', etc.

class HabitCreate(HabitBase):
    """Model for creating a new habit"""
    client_event_id: Optional[str] = None
    source: Optional[str] = None
    actor_type: Optional[Literal['user', 'assistant', 'import', 'integration', 'system']] = None
    actor_ref: Optional[str] = None
    conversation_id: Optional[str] = None

class HabitUpdate(BaseModel):
    """Model for updating a habit - all fields optional"""
    name: Optional[str] = None
    category: Optional[str] = None
    icon: Optional[str] = None
    is_custom: Optional[bool] = None
    integration_source: Optional[str] = None
    unit_type: Optional[str] = None
    sensor_type: Optional[str] = None
    metric_type: Optional[str] = None

class Habit(HabitBase):
    """Full habit model with all fields"""
    id: str
    user_id: str
    created_at: datetime
    updated_at: datetime
    was_inserted: Optional[bool] = True
    receipt_id: Optional[str] = None

    class Config:
        from_attributes = True

# ================================
# HABIT LOG MODELS - Mirror TypeScript HabitLog interface
# ================================

class HabitLogBase(BaseModel):
    duration: Optional[int] = None
    amount: Optional[float] = None
    date: str  # ISO date string
    completed_at: Optional[str] = None  # ISO datetime string
    status: Literal['completed', 'skipped', 'missed'] = 'completed'
    notes: Optional[str] = None

class HabitLogCreate(HabitLogBase):
    """Model for creating a new habit log"""
    client_event_id: Optional[str] = None
    source: Optional[str] = None
    actor_type: Optional[Literal['user', 'assistant', 'import', 'integration', 'system']] = None
    actor_ref: Optional[str] = None
    conversation_id: Optional[str] = None


class HabitLogUpdate(BaseModel):
    """Revision-checked editable fields for an existing habit log."""

    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    idempotency_key: str = Field(min_length=8, max_length=160)
    status: Optional[Literal['completed', 'skipped', 'missed']] = None
    date: Optional[str] = None
    completed_at: Optional[str] = None
    integration_source: Optional[str] = Field(default=None, max_length=120)

class HabitLog(HabitLogBase):
    """Full habit log model"""
    id: str
    habit_id: str
    habit_name: Optional[str] = None
    source: Optional[str] = None
    client_event_id: Optional[str] = None
    actor_type: Optional[str] = None
    actor_ref: Optional[str] = None
    revision: int = 1
    was_inserted: Optional[bool] = True
    receipt_id: Optional[str] = None
    log_metadata: Optional[str] = None
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None
    location_accuracy_m: Optional[float] = None
    location_source: Optional[str] = None
    location_place_label: Optional[str] = None
    location_confidence: Optional[float] = None
    location_resolved_at: Optional[int] = None
    location_signal_age_ms: Optional[int] = None
    
    class Config:
        from_attributes = True

# ================================
# USER MODELS
# ================================

class User(BaseModel):
    """User model for authentication"""
    id: str
    email: str
    full_name: Optional[str] = None
    created_at: Optional[datetime] = None

# ================================
# ANALYTICS MODELS - For Tinybird responses
# ================================

class HabitMetrics(BaseModel):
    """Habit metrics from Tinybird analytics"""
    habit_id: str
    habit_name: str
    total_completed: int
    total_duration: Optional[int] = None
    total_amount: Optional[float] = None
    last_completed_date: Optional[str] = None

class HabitTrend(BaseModel):
    """Habit trend data from Tinybird"""
    date: str
    habit_id: str
    habit_name: str
    count: int
    duration_seconds: int
    amount: float
    unit: str

# ================================
# RESPONSE MODELS
# ================================

class SuccessResponse(BaseModel):
    """Standard success response"""
    message: str
    success: bool = True

class ErrorResponse(BaseModel):
    """Standard error response"""
    detail: str
    success: bool = False
