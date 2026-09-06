"""Public Calendar V2 API contracts."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


CalendarEventKind = Literal["event", "task_allocation"]
CalendarEventOrigin = Literal["ritual", "google", "ai"]
CalendarStatus = Literal["confirmed", "tentative", "canceled"]
CalendarAvailability = Literal["busy", "free"]
CalendarVisibility = Literal["default", "public", "private", "confidential"]
CalendarSyncState = Literal["local", "pending", "synced", "conflict", "error"]
RecurrenceScope = Literal["occurrence", "following", "series"]
CalendarMode = Literal["plan", "review"]


class CalendarSourceRead(BaseModel):
    id: str
    account_id: Optional[str] = None
    provider: Optional[str] = None
    provider_calendar_id: Optional[str] = None
    name: str
    color: Optional[str] = None
    timezone: str
    access_role: str
    is_visible: bool
    is_primary: bool
    is_default_write: bool
    writable: bool
    last_sync_at: Optional[datetime] = None
    last_error: Optional[str] = None


class CalendarSourceUpdate(BaseModel):
    is_visible: Optional[bool] = None
    is_default_write: Optional[bool] = None
    color: Optional[str] = None


class CalendarEventFields(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: Optional[str] = None
    source_id: Optional[str] = None
    kind: CalendarEventKind = "event"
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    timezone: str = "UTC"
    all_day: bool = False
    status: CalendarStatus = "confirmed"
    availability: CalendarAvailability = "busy"
    visibility: CalendarVisibility = "default"
    location: Dict[str, Any] = Field(default_factory=dict)
    conference: Dict[str, Any] = Field(default_factory=dict)
    organizer: Dict[str, Any] = Field(default_factory=dict)
    attendees: List[Dict[str, Any]] = Field(default_factory=list)
    reminders: Dict[str, Any] = Field(default_factory=dict)
    recurrence: List[str] = Field(default_factory=list)
    task_id: Optional[str] = None
    routine_run_id: Optional[str] = None

    @model_validator(mode="after")
    def validate_time_range(self) -> "CalendarEventFields":
        if self.all_day:
            if not self.start_date or not self.end_date:
                raise ValueError("all-day events require start_date and exclusive end_date")
            if self.end_date <= self.start_date:
                raise ValueError("end_date must be after start_date")
        else:
            if not self.start_at or not self.end_at:
                raise ValueError("timed events require start_at and end_at")
            if self.end_at <= self.start_at:
                raise ValueError("end_at must be after start_at")
        if self.kind == "task_allocation" and not self.task_id:
            raise ValueError("task allocations require task_id")
        return self


class CalendarEventCreate(CalendarEventFields):
    origin: CalendarEventOrigin = "ritual"
    client_event_id: Optional[str] = None


class CalendarEventUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=500)
    description: Optional[str] = None
    source_id: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    timezone: Optional[str] = None
    all_day: Optional[bool] = None
    status: Optional[CalendarStatus] = None
    availability: Optional[CalendarAvailability] = None
    visibility: Optional[CalendarVisibility] = None
    location: Optional[Dict[str, Any]] = None
    conference: Optional[Dict[str, Any]] = None
    attendees: Optional[List[Dict[str, Any]]] = None
    reminders: Optional[Dict[str, Any]] = None
    recurrence: Optional[List[str]] = None
    recurrence_scope: RecurrenceScope = "series"
    occurrence_id: Optional[str] = None
    expected_revision: Optional[int] = None


class CalendarEventRead(BaseModel):
    id: str
    user_id: str
    source_id: Optional[str] = None
    source_name: Optional[str] = None
    source_color: Optional[str] = None
    kind: CalendarEventKind
    origin: CalendarEventOrigin
    title: str
    description: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    timezone: str
    all_day: bool
    status: CalendarStatus
    availability: CalendarAvailability
    visibility: CalendarVisibility
    location: Dict[str, Any] = Field(default_factory=dict)
    conference: Dict[str, Any] = Field(default_factory=dict)
    organizer: Dict[str, Any] = Field(default_factory=dict)
    attendees: List[Dict[str, Any]] = Field(default_factory=list)
    reminders: Dict[str, Any] = Field(default_factory=dict)
    recurrence: List[str] = Field(default_factory=list)
    recurring_event_id: Optional[str] = None
    task_id: Optional[str] = None
    routine_run_id: Optional[str] = None
    provider_event_id: Optional[str] = None
    provider_event_type: Optional[str] = None
    provider_etag: Optional[str] = None
    sync_state: CalendarSyncState
    revision: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class CalendarOccurrenceRead(BaseModel):
    id: str
    event_id: str
    source_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    kind: CalendarEventKind
    origin: CalendarEventOrigin
    task_id: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    timezone: str
    all_day: bool
    status: CalendarStatus
    availability: CalendarAvailability
    visibility: CalendarVisibility
    source_name: Optional[str] = None
    source_color: Optional[str] = None
    provider_event_type: Optional[str] = None
    sync_state: CalendarSyncState
    revision: int
    is_exception: bool = False
    conflict: bool = False


class CalendarTaskSummary(BaseModel):
    id: str
    title: str
    notes: Optional[str] = None
    status: str
    priority: str
    due_at: Optional[datetime] = None
    project: Optional[str] = None
    category: Optional[str] = None
    allocation_count: int = 0


class WorkflowTimelineItem(BaseModel):
    id: str
    definition_id: str
    name: str
    kind: str
    item_type: Literal["planned", "actual"]
    status: str
    start_at: datetime
    end_at: datetime
    expected_duration_minutes: int = 30
    approval_request_id: Optional[str] = None
    run_id: Optional[str] = None


class CalendarReviewData(BaseModel):
    habit_markers: List[Dict[str, Any]] = Field(default_factory=list)
    activity_sessions: List[Dict[str, Any]] = Field(default_factory=list)
    health_summaries: List[Dict[str, Any]] = Field(default_factory=list)
    planned_minutes: int = 0
    attributable_actual_minutes: int = 0
    linked_task_comparisons: List[Dict[str, Any]] = Field(default_factory=list)
    completed_task_count: int = 0


class CalendarSyncStatus(BaseModel):
    source_id: str
    status: str
    last_sync_at: Optional[datetime] = None
    error_code: Optional[str] = None


class CalendarRangeReadModel(BaseModel):
    start: datetime
    end: datetime
    timezone: str
    mode: CalendarMode
    occurrences: List[CalendarOccurrenceRead] = Field(default_factory=list)
    tasks: List[CalendarTaskSummary] = Field(default_factory=list)
    workflows: List[WorkflowTimelineItem] = Field(default_factory=list)
    sources: List[CalendarSourceRead] = Field(default_factory=list)
    sync: List[CalendarSyncStatus] = Field(default_factory=list)
    review: Optional[CalendarReviewData] = None
    proposals: List["CalendarMutationProposal"] = Field(default_factory=list)


class CalendarSearchResponse(BaseModel):
    events: List[CalendarEventRead] = Field(default_factory=list)
    tasks: List[CalendarTaskSummary] = Field(default_factory=list)
    workflows: List[WorkflowTimelineItem] = Field(default_factory=list)


class AvailabilityRequest(BaseModel):
    start: datetime
    end: datetime
    timezone: str = "UTC"
    workday_start_minutes: int = Field(default=480, ge=0, le=1439)
    workday_end_minutes: int = Field(default=1080, ge=1, le=1440)
    minimum_minutes: int = Field(default=30, ge=5, le=1440)
    source_ids: List[str] = Field(default_factory=list)


class AvailabilityWindow(BaseModel):
    start_at: datetime
    end_at: datetime


class AvailabilityResponse(BaseModel):
    timezone: str
    windows: List[AvailabilityWindow] = Field(default_factory=list)
    formatted_text: str


class CalendarPublishRequest(BaseModel):
    source_id: str


class CalendarRsvpRequest(BaseModel):
    response: Literal["accepted", "declined", "tentative", "needsAction"]


class CalendarConnectResponse(BaseModel):
    authorization_url: str


class CalendarAccountStatus(BaseModel):
    connected: bool
    account_id: Optional[str] = None
    email: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    last_error: Optional[str] = None


class CalendarMutationProposal(BaseModel):
    id: str
    action: str
    event_id: Optional[str] = None
    occurrence_id: Optional[str] = None
    before: Optional[Dict[str, Any]] = None
    after: Dict[str, Any] = Field(default_factory=dict)
    conflicts: List[str] = Field(default_factory=list)
    expires_at: datetime


class CalendarMutationDraft(BaseModel):
    action: Literal[
        "create_event",
        "update_event",
        "move_event",
        "resize_event",
        "delete_event",
        "rsvp",
        "publish",
        "create_task_allocation",
    ]
    event_id: Optional[str] = None
    occurrence_id: Optional[str] = None
    recurrence_scope: RecurrenceScope = "series"
    after: Dict[str, Any] = Field(default_factory=dict)


class CalendarProposalCreate(BaseModel):
    changes: List[CalendarMutationDraft] = Field(min_length=1, max_length=50)
    conversation_id: Optional[str] = None


class CalendarProposalApply(BaseModel):
    proposal_ids: List[str] = Field(min_length=1, max_length=50)


class CalendarProposalApplyResponse(BaseModel):
    applied: List[str] = Field(default_factory=list)
    failed: Dict[str, str] = Field(default_factory=dict)
    events: List[CalendarEventRead] = Field(default_factory=list)
