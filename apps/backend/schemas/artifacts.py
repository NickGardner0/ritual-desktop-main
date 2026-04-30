"""
Pydantic schemas for Ritual artifacts, revisions, and links.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

ArtifactKind = Literal[
    "report",
    "morning_brief",
    "shutdown_review",
    "notebook",
    "plan",
    "conversation_brief",
    "ambient_digest",
]
ArtifactStatus = Literal["draft", "published", "archived"]
ArtifactSourceType = Literal["report_run", "workflow_run", "conversation", "manual", "ambient_signal"]
ArtifactEditorType = Literal["system", "assistant", "user"]
ArtifactLinkTargetType = Literal["conversation", "message", "workflow_run", "fact", "ambient_signal"]


class ArtifactPeriod(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None
    timezone: str = "America/New_York"


class ArtifactSource(BaseModel):
    type: ArtifactSourceType
    id: Optional[str] = None


class ArtifactLinkRead(BaseModel):
    id: str
    artifact_id: str
    target_type: ArtifactLinkTargetType
    target_id: str
    relationship: str = "linked"
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None


class ArtifactListItem(BaseModel):
    id: str
    kind: ArtifactKind
    title: str
    slug: Optional[str] = None
    status: ArtifactStatus
    summary: Optional[str] = None
    preview_text: Optional[str] = None
    folder_key: Optional[str] = None
    is_pinned: bool = False
    period: ArtifactPeriod
    source: ArtifactSource
    conversation_id: Optional[str] = None
    created_at: Optional[datetime] = None
    published_at: Optional[datetime] = None


class ArtifactRevisionRead(BaseModel):
    id: str
    artifact_id: str
    version: int
    editor_type: ArtifactEditorType
    summary: Optional[str] = None
    change_note: Optional[str] = None
    created_at: Optional[datetime] = None


class ArtifactDetailRead(ArtifactListItem):
    body: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    revision_count: int = 0
    latest_revision: Optional[ArtifactRevisionRead] = None
    links: List[ArtifactLinkRead] = Field(default_factory=list)


class ArtifactListResponse(BaseModel):
    items: List[ArtifactListItem] = Field(default_factory=list)
    next_cursor: Optional[str] = None


class ArtifactRevisionListResponse(BaseModel):
    items: List[ArtifactRevisionRead] = Field(default_factory=list)


class ArtifactLinkListResponse(BaseModel):
    items: List[ArtifactLinkRead] = Field(default_factory=list)


class ArtifactCreate(BaseModel):
    kind: ArtifactKind
    title: str
    slug: Optional[str] = None
    status: ArtifactStatus = "draft"
    summary: Optional[str] = None
    preview_text: Optional[str] = None
    folder_key: Optional[str] = None
    is_pinned: bool = False
    body: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    period: ArtifactPeriod = Field(default_factory=ArtifactPeriod)
    source: ArtifactSource
    conversation_id: Optional[str] = None


class ArtifactUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    status: Optional[ArtifactStatus] = None
    summary: Optional[str] = None
    preview_text: Optional[str] = None
    folder_key: Optional[str] = None
    is_pinned: Optional[bool] = None
    body: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    period: Optional[ArtifactPeriod] = None
    base_version: Optional[int] = None


class ArtifactRevisionCreate(BaseModel):
    body: Dict[str, Any] = Field(default_factory=dict)
    summary: Optional[str] = None
    change_note: Optional[str] = None
    editor_type: ArtifactEditorType = "user"
    base_version: Optional[int] = None


class ArtifactLinkCreate(BaseModel):
    target_type: ArtifactLinkTargetType
    target_id: str
    relationship: str = "linked"
    metadata: Dict[str, Any] = Field(default_factory=dict)
