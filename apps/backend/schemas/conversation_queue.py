"""
Pydantic schemas for queued conversation follow-ups.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

ConversationQueueStatus = Literal["pending", "running", "completed", "canceled", "stale", "failed"]
ConversationQueueSource = Literal["manual", "reply_chip", "suggestion", "workflow"]


class ConversationQueueItemRead(BaseModel):
    id: str
    conversation_id: str
    user_id: str
    prompt_text: str
    status: ConversationQueueStatus
    source: ConversationQueueSource
    after_message_id: Optional[str] = None
    position: int = 0
    auto_run: bool = False
    error: Optional[Dict[str, Any]] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ConversationQueueCreate(BaseModel):
    prompt_text: str
    source: ConversationQueueSource = "manual"
    after_message_id: Optional[str] = None
    auto_run: bool = False


class ConversationQueueUpdate(BaseModel):
    status: Optional[ConversationQueueStatus] = None
    position: Optional[int] = None
    auto_run: Optional[bool] = None
    error: Optional[Dict[str, Any]] = None


class ConversationQueueTransition(BaseModel):
    error: Optional[Dict[str, Any]] = None


class ConversationQueueListResponse(BaseModel):
    items: List[ConversationQueueItemRead] = Field(default_factory=list)
    auto_run_queued: bool = False


class ConversationQueueRunResponse(BaseModel):
    item: ConversationQueueItemRead
    stale: bool = False
