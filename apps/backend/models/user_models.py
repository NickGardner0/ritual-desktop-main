"""
User-related Pydantic models for API requests/responses
"""

from pydantic import BaseModel, Field
from typing import Any, Dict, Literal, Optional, List
from datetime import datetime

class OnboardingData(BaseModel):
    """Onboarding data submitted by user"""
    name: str
    age_bracket: str
    gender: str
    country: str
    tracking_interests: List[str]
    wearable_devices: List[str]
    phone_number: Optional[str] = None
    client_surface: Optional[Literal["desktop", "web"]] = "web"

class UserProfile(BaseModel):
    """User profile response"""
    id: str
    email: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
    timezone: Optional[str] = None
    age_bracket: Optional[str] = None
    gender: Optional[str] = None
    country: Optional[str] = None
    tracking_interests: Optional[List[str]] = None
    wearable_devices: Optional[List[str]] = None
    onboarding_completed: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


ActivationChecklistKey = Literal[
    "mac_activity",
    "apple_health",
    "oura",
    "whoop",
    "garmin",
    "ai_voice",
    "reminders",
]

ActivationChecklistStatus = Literal[
    "not_started",
    "seen",
    "skipped",
    "completed",
    "needs_attention",
]


class BootstrapUser(BaseModel):
    id: str
    email: str
    fullName: Optional[str] = None
    timezone: Optional[str] = None


class ActivationChecklistItem(BaseModel):
    key: ActivationChecklistKey
    status: ActivationChecklistStatus
    metadata: Optional[Dict[str, Any]] = None


class ActivationState(BaseModel):
    firstHabitId: Optional[str] = None
    firstLogId: Optional[str] = None
    activationCompleted: bool = False
    checklist: List[ActivationChecklistItem] = Field(default_factory=list)


class IntegrationActivationStatus(BaseModel):
    status: ActivationChecklistStatus = "not_started"


class UserBootstrapResponse(BaseModel):
    userExists: bool = True
    profileComplete: bool
    firstBehaviorLogged: bool
    permissionsSeen: bool
    user: BootstrapUser
    activation: ActivationState
    integrations: Dict[str, IntegrationActivationStatus]
    nextRoute: str


class BootstrapProfileUpdate(BaseModel):
    fullName: str
    timezone: str


class FirstBehaviorRequest(BaseModel):
    templateKey: Literal["sleep", "exercise", "focus", "mood", "custom"]
    customName: Optional[str] = None
    date: str
    completedAt: str
    amount: Optional[float] = None
    duration: Optional[int] = None
    notes: Optional[str] = None
    clientEventId: str


class ChecklistUpdateRequest(BaseModel):
    key: ActivationChecklistKey
    status: Literal["seen", "skipped", "completed", "needs_attention"]
    metadata: Optional[Dict[str, Any]] = None
