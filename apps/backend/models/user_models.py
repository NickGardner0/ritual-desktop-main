"""
User-related Pydantic models for API requests/responses
"""

from pydantic import BaseModel
from typing import Literal, Optional, List
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
    client_surface: Literal["desktop", "web"] | None = "web"

class UserProfile(BaseModel):
    """User profile response"""
    id: str
    email: str
    full_name: Optional[str] = None
    phone_number: Optional[str] = None
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
