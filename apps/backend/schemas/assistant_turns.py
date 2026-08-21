"""Pydantic schemas for durable assistant turns."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

AssistantTurnStatus = Literal["queued", "running", "committing", "completed", "failed", "canceled"]
AssistantChannel = Literal["dashboard", "sms"]


class AssistantTurnUpsert(BaseModel):
    id: str
    conversation_id: Optional[str] = None
    channel: AssistantChannel = "dashboard"
    status: AssistantTurnStatus
    epoch: int = 0
    sequence: int = 0
    receipt_ids: List[str] = Field(default_factory=list)
    assistant_text: Optional[str] = None
    tool_payload: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    completed_at: Optional[str] = None


class AssistantTurnRead(BaseModel):
    id: str
    user_id: str
    conversation_id: Optional[str] = None
    channel: str
    status: str
    epoch: int
    sequence: int
    receipt_ids: List[str] = Field(default_factory=list)
    assistant_text: Optional[str] = None
    tool_payload: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class AssistantTurnSequenceRead(BaseModel):
    sequence: int
