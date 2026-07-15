"""Pydantic schemas for experiment workspaces."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


ExperimentStatus = Literal["active", "completed", "archived"]
ExperimentEntryKind = Literal["observation", "file", "metric", "conclusion"]


class ExperimentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)


class ExperimentUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    status: Optional[ExperimentStatus] = None


class ExperimentEntryCreate(BaseModel):
    kind: ExperimentEntryKind
    title: str = Field(min_length=1, max_length=160)
    content: Optional[str] = Field(default=None, max_length=20_000)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ExperimentEntryRead(BaseModel):
    id: str
    experiment_id: str
    kind: ExperimentEntryKind
    title: str
    content: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ExperimentThreadRead(BaseModel):
    id: str
    title: Optional[str] = None
    first_message: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ExperimentRead(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    status: ExperimentStatus
    thread_count: int = 0
    entry_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ExperimentListResponse(BaseModel):
    items: List[ExperimentRead] = Field(default_factory=list)


class ExperimentDetailRead(ExperimentRead):
    threads: List[ExperimentThreadRead] = Field(default_factory=list)
    entries: List[ExperimentEntryRead] = Field(default_factory=list)


class ExperimentThreadCreate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=120)
