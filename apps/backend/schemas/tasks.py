"""Pydantic schemas for tasks and routines."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


TaskStatus = Literal[
    "open",
    "in_progress",
    "in_review",
    "completed",
    "canceled",
    "skipped",
    "archived",
]
TaskPriority = Literal["none", "low", "medium", "high", "urgent"]
TaskSource = Literal["manual", "routine", "ai", "calendar", "habit", "experiment"]

RoutineStatus = Literal["draft", "scheduled", "paused", "archived"]
RoutineKind = Literal["task", "ai_workflow", "habit_prompt", "calendar_block", "mixed"]
RoutineTriggerType = Literal["daily", "weekly", "monthly", "yearly", "on_completion"]
RoutineRunStatus = Literal["scheduled", "generated", "completed", "skipped", "failed"]


class TaskCreate(BaseModel):
    title: str
    notes: Optional[str] = None
    status: TaskStatus = "open"
    priority: TaskPriority = "none"
    due_at: Optional[datetime] = None
    scheduled_for: Optional[datetime] = None
    source: TaskSource = "manual"
    project: Optional[str] = None
    category: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    routine_id: Optional[str] = None
    routine_run_id: Optional[str] = None
    linked_habit_id: Optional[str] = None
    linked_artifact_id: Optional[str] = None
    client_event_id: Optional[str] = None
    conversation_id: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[TaskStatus] = None
    priority: Optional[TaskPriority] = None
    due_at: Optional[datetime] = None
    scheduled_for: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    project: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[List[str]] = None
    linked_habit_id: Optional[str] = None
    linked_artifact_id: Optional[str] = None


class TaskRead(BaseModel):
    id: str
    user_id: str
    title: str
    notes: Optional[str] = None
    status: TaskStatus
    priority: TaskPriority
    due_at: Optional[datetime] = None
    scheduled_for: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    source: TaskSource
    project: Optional[str] = None
    category: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    routine_id: Optional[str] = None
    routine_run_id: Optional[str] = None
    linked_habit_id: Optional[str] = None
    linked_artifact_id: Optional[str] = None
    client_event_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    receipt_id: Optional[str] = None
    was_inserted: Optional[bool] = None


class TaskListResponse(BaseModel):
    items: List[TaskRead] = Field(default_factory=list)


class RoutineTaskTemplate(BaseModel):
    title: str = ""
    notes: Optional[str] = None
    project: Optional[str] = None
    category: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    linked_habit_id: Optional[str] = None


class RoutineCreate(BaseModel):
    title: str
    description: Optional[str] = None
    status: RoutineStatus = "scheduled"
    kind: RoutineKind = "task"
    trigger_type: RoutineTriggerType = "daily"
    trigger_config: Dict[str, Any] = Field(default_factory=lambda: {"interval": 1})
    timezone: str = "America/New_York"
    priority: TaskPriority = "none"
    tags: List[str] = Field(default_factory=list)
    task_template: RoutineTaskTemplate = Field(default_factory=RoutineTaskTemplate)
    ai_workflow_definition_id: Optional[str] = None
    first_run_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    client_event_id: Optional[str] = None


class RoutineUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[RoutineStatus] = None
    kind: Optional[RoutineKind] = None
    trigger_type: Optional[RoutineTriggerType] = None
    trigger_config: Optional[Dict[str, Any]] = None
    timezone: Optional[str] = None
    priority: Optional[TaskPriority] = None
    tags: Optional[List[str]] = None
    task_template: Optional[RoutineTaskTemplate] = None
    ai_workflow_definition_id: Optional[str] = None
    first_run_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None


class RoutineRead(BaseModel):
    id: str
    user_id: str
    title: str
    description: Optional[str] = None
    status: RoutineStatus
    kind: RoutineKind
    trigger_type: RoutineTriggerType
    trigger_config: Dict[str, Any] = Field(default_factory=dict)
    timezone: str
    priority: TaskPriority
    tags: List[str] = Field(default_factory=list)
    task_template: RoutineTaskTemplate = Field(default_factory=RoutineTaskTemplate)
    ai_workflow_definition_id: Optional[str] = None
    first_run_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    client_event_id: Optional[str] = None
    cadence_summary: str
    next_preview: List[datetime] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RoutineListResponse(BaseModel):
    items: List[RoutineRead] = Field(default_factory=list)


class RoutineRunRead(BaseModel):
    id: str
    routine_id: str
    user_id: str
    scheduled_for: datetime
    status: RoutineRunStatus
    generated_task_id: Optional[str] = None
    generated_scheduled_block_id: Optional[str] = None
    workflow_run_id: Optional[str] = None
    completed_at: Optional[datetime] = None
    skipped_at: Optional[datetime] = None
    error_json: Optional[str] = None
    idempotency_key: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RoutineGenerateResponse(BaseModel):
    queued: int = 0
    generated_tasks: int = 0
    generated_scheduled_blocks: int = 0
    generated_workflow_runs: int = 0
    skipped: int = 0
    runs: List[RoutineRunRead] = Field(default_factory=list)


class RoutinePreviewRequest(BaseModel):
    trigger_type: RoutineTriggerType
    trigger_config: Dict[str, Any] = Field(default_factory=dict)
    timezone: str = "America/New_York"
    reference_utc: Optional[datetime] = None
    first_run_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    last_completed_at: Optional[datetime] = None
    count: int = Field(default=6, ge=1, le=24)


class RoutinePreviewResponse(BaseModel):
    cadence_summary: str
    next_preview: List[datetime] = Field(default_factory=list)
