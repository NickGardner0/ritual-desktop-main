"""Pydantic schemas for internal SMS copilot APIs."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SmsCopilotEvaluateRequest(BaseModel):
    user_id: str
    kinds: List[str] = Field(default_factory=list)
    dry_run: bool = True
    now_utc: Optional[datetime] = None


class SmsLogConfirmationRequest(BaseModel):
    user_id: str
    habit_id: str
    amount: Optional[float] = None
    note: Optional[str] = None
    logged_at: Optional[datetime] = None


class SmsCopilotCandidateRead(BaseModel):
    kind: str
    score: float
    confidence: float
    novelty_score: float
    actionability_score: float
    dedupe_key: str
    payload: Dict[str, Any]


class SmsCopilotEventRead(BaseModel):
    id: str
    user_id: str
    conversation_id: Optional[str] = None
    kind: str
    status: str
    score: float
    confidence: float
    novelty_score: float
    actionability_score: float
    dedupe_key: str
    suppression_reason: Optional[str] = None
    headline: Optional[str] = None
    body: Optional[str] = None
    metrics: Dict[str, Any] = Field(default_factory=dict)
    response_options: List[str] = Field(default_factory=list)
    assistant_message_id: Optional[str] = None
    user_reply_message_id: Optional[str] = None
    provider_message_id: Optional[str] = None
    trigger_window_start: Optional[datetime] = None
    trigger_window_end: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    replied_at: Optional[datetime] = None
    acted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
