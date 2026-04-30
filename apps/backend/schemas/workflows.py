"""
Pydantic schemas for Ritual workflows, action profiles, approvals, and runs.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from schemas.artifacts import ArtifactKind, ArtifactListItem

ActionProfileMode = Literal["observe", "draft", "organize", "act"]
WorkflowKind = Literal["morning_brief", "shutdown_review", "daily_narrative", "distraction_spiral"]
WorkflowStatus = Literal["draft", "scheduled", "paused"]
WorkflowDeliveryChannel = Literal["in_app"]
WorkflowRunStatus = Literal["queued", "processing", "completed", "failed", "canceled"]
WorkflowTriggerSource = Literal["manual", "scheduled", "backfill", "signal"]
WorkflowDefinitionFamily = Literal["routine", "ambient"]
WorkflowTriggerType = Literal["schedule", "signal"]
ApprovalStatus = Literal["pending", "approved", "rejected", "expired"]


class ActionProfileRules(BaseModel):
    read_scopes: List[str] = Field(default_factory=list)
    write_scopes: List[str] = Field(default_factory=list)
    delivery_scopes: List[str] = Field(default_factory=list)
    approval_policy: Dict[str, Any] = Field(default_factory=dict)
    budgets: Dict[str, Any] = Field(default_factory=dict)
    risk_limits: Dict[str, Any] = Field(default_factory=dict)


class ActionProfileRead(BaseModel):
    id: str
    user_id: str
    name: str
    mode: ActionProfileMode
    is_default: bool = False
    rules: ActionProfileRules = Field(default_factory=ActionProfileRules)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ActionProfileUpdate(BaseModel):
    name: Optional[str] = None
    rules: Optional[ActionProfileRules] = None
    is_default: Optional[bool] = None


class ActionProfileListResponse(BaseModel):
    items: List[ActionProfileRead] = Field(default_factory=list)


class WorkflowSchedule(BaseModel):
    timezone: str = "America/New_York"
    cadence: str = "daily"
    send_hour_local: int = Field(default=8, ge=0, le=23)
    send_minute_local: int = Field(default=0, ge=0, le=59)
    send_weekdays: List[int] = Field(default_factory=list)


class WorkflowDelivery(BaseModel):
    channel: WorkflowDeliveryChannel = "in_app"
    publish: bool = True
    inbox: bool = True


class WorkflowDefinitionRead(BaseModel):
    id: str
    kind: WorkflowKind
    name: str
    definition_family: WorkflowDefinitionFamily = "routine"
    trigger_type: WorkflowTriggerType = "schedule"
    signal_kind: Optional[str] = None
    cooldown_minutes: int = 240
    quiet_hours: Dict[str, Any] = Field(default_factory=dict)
    status: WorkflowStatus
    schedule: WorkflowSchedule
    delivery: WorkflowDelivery
    ranking: Dict[str, Any] = Field(default_factory=dict)
    config: Dict[str, Any] = Field(default_factory=dict)
    action_profile: ActionProfileRead
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    last_error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class WorkflowDefinitionListResponse(BaseModel):
    items: List[WorkflowDefinitionRead] = Field(default_factory=list)


class WorkflowDefinitionUpdate(BaseModel):
    definition_family: Optional[WorkflowDefinitionFamily] = None
    trigger_type: Optional[WorkflowTriggerType] = None
    signal_kind: Optional[str] = None
    status: Optional[WorkflowStatus] = None
    schedule: Optional[WorkflowSchedule] = None
    config: Optional[Dict[str, Any]] = None
    ranking: Optional[Dict[str, Any]] = None
    quiet_hours: Optional[Dict[str, Any]] = None
    delivery: Optional[WorkflowDelivery] = None
    cooldown_minutes: Optional[int] = None
    action_profile_id: Optional[str] = None


class ProposedAction(BaseModel):
    action_kind: str
    capability: str
    target_ref: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class PolicyDecision(BaseModel):
    action_kind: str
    capability: str
    outcome: Literal["applied", "requires_approval", "rejected"]
    reason: Optional[str] = None
    approval_request_id: Optional[str] = None
    receipt_id: Optional[str] = None


class WorkflowRunRead(BaseModel):
    id: str
    workflow_definition_id: str
    status: WorkflowRunStatus
    trigger_source: WorkflowTriggerSource
    artifact_id: Optional[str] = None
    window_start: Optional[datetime] = None
    window_end: Optional[datetime] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    error_json: Optional[str] = None


class WorkflowRunDetailRead(WorkflowRunRead):
    plan: Optional[Dict[str, Any]] = None
    result: Optional[Dict[str, Any]] = None
    artifact: Optional[ArtifactListItem] = None
    proposed_actions: List[ProposedAction] = Field(default_factory=list)
    policy_decisions: List[PolicyDecision] = Field(default_factory=list)
    fact_suggestions: List[Dict[str, Any]] = Field(default_factory=list)
    queue_suggestions: List[Dict[str, Any]] = Field(default_factory=list)


class WorkflowRunListResponse(BaseModel):
    items: List[WorkflowRunRead] = Field(default_factory=list)


class WorkflowRunQueueResponse(BaseModel):
    definition_id: str
    run: WorkflowRunRead


class ApprovalRequestRead(BaseModel):
    id: str
    user_id: str
    workflow_run_id: Optional[str] = None
    action_kind: str
    capability: Optional[str] = None
    status: ApprovalStatus
    reason: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    proposed_action: Dict[str, Any] = Field(default_factory=dict)
    policy_decision: Dict[str, Any] = Field(default_factory=dict)
    expires_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ApprovalListResponse(BaseModel):
    items: List[ApprovalRequestRead] = Field(default_factory=list)


class ActionReceiptRead(BaseModel):
    id: str
    user_id: str
    workflow_run_id: Optional[str] = None
    conversation_id: Optional[str] = None
    action_kind: str
    capability: str
    target_ref: Optional[str] = None
    status: str
    before: Optional[Dict[str, Any]] = None
    after: Optional[Dict[str, Any]] = None
    undo: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[datetime] = None


class InternalWorkflowWindow(BaseModel):
    start: datetime
    end: datetime


class InternalWorkflowExecuteRequest(BaseModel):
    user_id: str
    workflow_run_id: str
    workflow_kind: WorkflowKind
    timezone: str = "America/New_York"
    config: Dict[str, Any] = Field(default_factory=dict)
    window: InternalWorkflowWindow


class InternalWorkflowArtifactPayload(BaseModel):
    kind: ArtifactKind
    title: str
    summary: str
    body: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class InternalWorkflowExecuteResponse(BaseModel):
    plan: Dict[str, Any] = Field(default_factory=dict)
    artifact: InternalWorkflowArtifactPayload
    artifact_draft: Optional[Dict[str, Any]] = None
    result: Dict[str, Any] = Field(default_factory=dict)
    proposed_actions: List[ProposedAction] = Field(default_factory=list)
    fact_suggestions: List[Dict[str, Any]] = Field(default_factory=list)
    linked_entities: List[Dict[str, Any]] = Field(default_factory=list)
    queue_suggestions: List[Dict[str, Any]] = Field(default_factory=list)
