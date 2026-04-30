"""
Pydantic schemas for Ritual AI facts and fact events.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

AiFactCategory = Literal["goal", "preference", "constraint", "routine", "profile"]
AiFactStatus = Literal["pending", "active", "dismissed", "archived"]
AiFactSourceType = Literal["onboarding", "assistant", "workflow", "ambient", "user"]
AiFactVisibility = Literal["private", "prompt", "ui"]


class AiFactRead(BaseModel):
    id: str
    user_id: str
    category: AiFactCategory
    subject: str
    predicate: str
    value: Dict[str, Any] = Field(default_factory=dict)
    status: AiFactStatus
    confidence: float = 0.5
    source_type: AiFactSourceType
    source_ref: Optional[str] = None
    visibility: AiFactVisibility = "private"
    last_confirmed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class AiFactCreate(BaseModel):
    category: AiFactCategory
    subject: str
    predicate: str
    value: Dict[str, Any] = Field(default_factory=dict)
    status: AiFactStatus = "pending"
    confidence: float = 0.5
    source_type: AiFactSourceType = "user"
    source_ref: Optional[str] = None
    visibility: AiFactVisibility = "prompt"
    expires_at: Optional[datetime] = None


class AiFactUpdate(BaseModel):
    category: Optional[AiFactCategory] = None
    subject: Optional[str] = None
    predicate: Optional[str] = None
    value: Optional[Dict[str, Any]] = None
    status: Optional[AiFactStatus] = None
    confidence: Optional[float] = None
    visibility: Optional[AiFactVisibility] = None
    expires_at: Optional[datetime] = None


class AiFactEventRead(BaseModel):
    id: str
    fact_id: str
    user_id: str
    event_type: str
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None


class AiFactListResponse(BaseModel):
    items: List[AiFactRead] = Field(default_factory=list)


class AiFactEventListResponse(BaseModel):
    items: List[AiFactEventRead] = Field(default_factory=list)
