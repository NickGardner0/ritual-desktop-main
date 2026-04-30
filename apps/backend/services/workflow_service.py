"""
Workflow definitions, seeded action profiles, approvals, execution policy, and ambient triggers.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import and_, desc, func, select

from database.connection import get_db_session
from database.models import (
    ActionProfileDB,
    ApprovalRequestDB,
    AmbientSignalEventDB,
    ArtifactDB,
    UserDB,
    WorkflowDefinitionDB,
    WorkflowRunDB,
)
from schemas.artifacts import ArtifactLinkCreate, ArtifactListItem
from schemas.workflows import (
    ActionProfileListResponse,
    ActionProfileRead,
    ActionProfileRules,
    ActionProfileUpdate,
    ApprovalListResponse,
    ApprovalRequestRead,
    InternalWorkflowExecuteResponse,
    PolicyDecision,
    ProposedAction,
    WorkflowDefinitionListResponse,
    WorkflowDefinitionRead,
    WorkflowDefinitionUpdate,
    WorkflowDelivery,
    WorkflowRunDetailRead,
    WorkflowRunListResponse,
    WorkflowRunQueueResponse,
    WorkflowRunRead,
    WorkflowSchedule,
)
from services.action_policy_service import action_policy_service
from services.artifact_service import artifact_service
from services.fact_service import fact_service

logger = logging.getLogger(__name__)

DASHBOARD_BASE_URL = os.getenv("DASHBOARD_BASE_URL", "https://desktop.ritualdb.com").rstrip("/")
INTERNAL_BACKEND_TOKEN = (os.getenv("INTERNAL_BACKEND_TOKEN") or "").strip()
WORKFLOW_EXECUTION_TIMEOUT = float(os.getenv("WORKFLOW_EXECUTION_TIMEOUT", "30"))
DEFAULT_WORKFLOWS_TIMEZONE = "America/New_York"


class WorkflowNotFoundError(ValueError):
    pass


class WorkflowValidationError(ValueError):
    pass


@dataclass
class _WorkflowWindow:
    start_utc: datetime
    end_utc: datetime
    start_local: str
    end_local: str


DEFAULT_WORKFLOW_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "morning_brief": {
        "name": "Morning Brief",
        "definition_family": "routine",
        "trigger_type": "schedule",
        "signal_kind": None,
        "status": "draft",
        "cadence": "daily",
        "send_hour_local": 8,
        "send_minute_local": 0,
        "send_weekdays": [0, 1, 2, 3, 4, 5, 6],
        "config": {
            "include_calendar": True,
            "include_streaks": True,
            "include_biometrics": True,
            "include_weekly_context": True,
        },
    },
    "shutdown_review": {
        "name": "Shutdown Review",
        "definition_family": "routine",
        "trigger_type": "schedule",
        "signal_kind": None,
        "status": "draft",
        "cadence": "daily",
        "send_hour_local": 18,
        "send_minute_local": 0,
        "send_weekdays": [0, 1, 2, 3, 4],
        "config": {
            "include_activity_summary": True,
            "include_habit_overview": True,
            "include_computer_time": True,
            "include_screen_time": True,
        },
    },
    "daily_narrative": {
        "name": "Daily Narrative",
        "definition_family": "ambient",
        "trigger_type": "signal",
        "signal_kind": "daily_narrative",
        "status": "paused",
        "cadence": "daily",
        "send_hour_local": 20,
        "send_minute_local": 30,
        "send_weekdays": [0, 1, 2, 3, 4, 5, 6],
        "cooldown_minutes": 1200,
        "config": {
            "publish_inbox_card": True,
            "publish_artifact": True,
            "suggest_reflection_prompt": True,
        },
        "ranking": {"minimum_score": 0.8, "minimum_confidence": 0.8},
    },
    "distraction_spiral": {
        "name": "Distraction Spiral Guardrail",
        "definition_family": "ambient",
        "trigger_type": "signal",
        "signal_kind": "distraction_spiral",
        "status": "paused",
        "cadence": "daily",
        "send_hour_local": 12,
        "send_minute_local": 0,
        "send_weekdays": [0, 1, 2, 3, 4, 5, 6],
        "cooldown_minutes": 240,
        "config": {
            "publish_inbox_card": True,
            "publish_artifact": True,
            "suggest_focus_block": True,
        },
        "ranking": {"minimum_score": 0.82, "minimum_confidence": 0.8},
    },
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class WorkflowService:
    def _parse_json(self, raw: Optional[str], fallback: Any) -> Any:
        if not raw:
            return fallback
        try:
            return json.loads(raw)
        except Exception:
            return fallback

    def _normalize_timezone(self, timezone_name: Optional[str]) -> str:
        candidate = (timezone_name or "").strip() or DEFAULT_WORKFLOWS_TIMEZONE
        try:
            ZoneInfo(candidate)
            return candidate
        except Exception:
            return DEFAULT_WORKFLOWS_TIMEZONE

    def _localize_reference(self, timezone_name: str, reference_utc: Optional[datetime] = None) -> datetime:
        utc_now = reference_utc or datetime.now(timezone.utc)
        if utc_now.tzinfo is None:
            utc_now = utc_now.replace(tzinfo=timezone.utc)
        return utc_now.astimezone(ZoneInfo(self._normalize_timezone(timezone_name)))

    def _compute_next_run(
        self,
        *,
        cadence: str,
        timezone_name: str,
        send_hour_local: int,
        send_minute_local: int,
        send_weekdays: List[int],
        reference_utc: Optional[datetime] = None,
    ) -> datetime:
        local_reference = self._localize_reference(timezone_name, reference_utc)
        tzinfo = local_reference.tzinfo

        def build_local_candidate(candidate_date: date) -> datetime:
            return datetime.combine(
                candidate_date,
                time(hour=send_hour_local, minute=send_minute_local),
                tzinfo=tzinfo,
            )

        weekdays = send_weekdays or [0, 1, 2, 3, 4, 5, 6]
        candidate_date = local_reference.date()
        for _ in range(14):
            candidate = build_local_candidate(candidate_date)
            if candidate > local_reference and candidate_date.weekday() in weekdays:
                return candidate.astimezone(timezone.utc).replace(tzinfo=None)
            candidate_date = candidate_date + timedelta(days=1)
        return build_local_candidate(candidate_date).astimezone(timezone.utc).replace(tzinfo=None)

    def _resolve_window(self, *, timezone_name: str, reference_utc: Optional[datetime] = None) -> _WorkflowWindow:
        local_reference = self._localize_reference(timezone_name, reference_utc)
        start_local = datetime.combine(local_reference.date(), time.min, tzinfo=local_reference.tzinfo)
        end_local = datetime.combine(local_reference.date(), time.max, tzinfo=local_reference.tzinfo)
        return _WorkflowWindow(
            start_utc=start_local.astimezone(timezone.utc).replace(tzinfo=None),
            end_utc=end_local.astimezone(timezone.utc).replace(tzinfo=None),
            start_local=start_local.date().isoformat(),
            end_local=end_local.date().isoformat(),
        )

    def _build_idempotency_key(self, definition: WorkflowDefinitionDB, next_run_at: datetime) -> str:
        local_dt = self._localize_reference(definition.timezone, next_run_at.replace(tzinfo=timezone.utc))
        slot = f"{local_dt.date().isoformat()}-{int(definition.send_hour_local or 0):02d}:{int(definition.send_minute_local or 0):02d}"
        return f"{definition.id}:{slot}"

    def _profile_to_schema(self, profile: ActionProfileDB) -> ActionProfileRead:
        return ActionProfileRead(
            id=profile.id,
            user_id=profile.user_id,
            name=profile.name,
            mode=profile.mode,  # type: ignore[arg-type]
            is_default=bool(profile.is_default),
            rules=ActionProfileRules.model_validate(action_policy_service.parse_rules(profile)),
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        )

    def _definition_to_schema(self, definition: WorkflowDefinitionDB, profile: ActionProfileDB) -> WorkflowDefinitionRead:
        delivery_config = self._parse_json(definition.delivery_json, {})
        return WorkflowDefinitionRead(
            id=definition.id,
            kind=definition.kind,  # type: ignore[arg-type]
            name=definition.name,
            definition_family=definition.definition_family,  # type: ignore[arg-type]
            trigger_type=definition.trigger_type,  # type: ignore[arg-type]
            signal_kind=definition.signal_kind,
            cooldown_minutes=int(definition.cooldown_minutes or 0),
            quiet_hours=self._parse_json(definition.quiet_hours_json, {}),
            status=definition.status,  # type: ignore[arg-type]
            schedule=WorkflowSchedule(
                timezone=definition.timezone,
                cadence=definition.cadence,
                send_hour_local=int(definition.send_hour_local or 0),
                send_minute_local=int(definition.send_minute_local or 0),
                send_weekdays=self._parse_json(definition.send_weekdays_json, []),
            ),
            delivery=WorkflowDelivery(
                channel=definition.delivery_channel,  # type: ignore[arg-type]
                publish=bool(delivery_config.get("publish", True)),
                inbox=bool(delivery_config.get("inbox", True)),
            ),
            ranking=self._parse_json(definition.ranking_json, {}),
            config=self._parse_json(definition.config_json, {}),
            action_profile=self._profile_to_schema(profile),
            last_run_at=definition.last_run_at,
            next_run_at=definition.next_run_at,
            last_error=definition.last_error,
            created_at=definition.created_at,
            updated_at=definition.updated_at,
        )

    def _artifact_summary_from_row(self, artifact: Optional[ArtifactDB]) -> Optional[ArtifactListItem]:
        if artifact is None:
            return None
        return ArtifactListItem(
            id=artifact.id,
            kind=artifact.kind,  # type: ignore[arg-type]
            title=artifact.title,
            slug=artifact.slug,
            status=artifact.status,  # type: ignore[arg-type]
            summary=artifact.summary,
            preview_text=artifact.preview_text,
            folder_key=artifact.folder_key,
            is_pinned=bool(artifact.is_pinned),
            period={
                "start": artifact.period_start,
                "end": artifact.period_end,
                "timezone": artifact.timezone or DEFAULT_WORKFLOWS_TIMEZONE,
            },
            source={"type": artifact.source_type, "id": artifact.source_id},
            conversation_id=artifact.conversation_id,
            created_at=artifact.created_at,
            published_at=artifact.published_at,
        )

    def _run_to_schema(self, run: WorkflowRunDB) -> WorkflowRunRead:
        return WorkflowRunRead(
            id=run.id,
            workflow_definition_id=run.workflow_definition_id,
            status=run.status,  # type: ignore[arg-type]
            trigger_source=run.trigger_source,  # type: ignore[arg-type]
            artifact_id=run.artifact_id,
            window_start=run.window_start,
            window_end=run.window_end,
            started_at=run.started_at,
            finished_at=run.finished_at,
            created_at=run.created_at,
            error_json=run.error_json,
        )

    def _approval_to_schema(self, approval: ApprovalRequestDB) -> ApprovalRequestRead:
        return ApprovalRequestRead(
            id=approval.id,
            user_id=approval.user_id,
            workflow_run_id=approval.workflow_run_id,
            action_kind=approval.action_kind,
            capability=approval.capability,
            status=approval.status,  # type: ignore[arg-type]
            reason=approval.reason,
            payload=self._parse_json(approval.payload_json, {}),
            proposed_action=self._parse_json(approval.proposed_action_json, {}),
            policy_decision=self._parse_json(approval.policy_decision_json, {}),
            expires_at=approval.expires_at,
            resolved_at=approval.resolved_at,
            created_at=approval.created_at,
            updated_at=approval.updated_at,
        )

    def _policy_decision_to_schema(self, payload: Dict[str, Any]) -> PolicyDecision:
        return PolicyDecision(
            action_kind=str(payload.get("action_kind") or "unknown"),
            capability=str(payload.get("capability") or "unknown"),
            outcome=payload.get("outcome") or "rejected",
            reason=payload.get("reason"),
            approval_request_id=payload.get("approval_request_id"),
            receipt_id=payload.get("receipt_id"),
        )

    async def _index_definition(self, definition: WorkflowDefinitionDB, profile: ActionProfileDB) -> None:
        try:
            from services.search_service import search_service

            await search_service.index_workflow_definition(
                self._definition_to_schema(definition, profile).model_dump(mode="json"),
                definition.user_id,
            )
        except Exception:
            logger.exception("Failed to index workflow definition %s", definition.id)

    async def ensure_default_action_profiles(self, session, user_id: str) -> List[ActionProfileDB]:
        result = await session.execute(
            select(ActionProfileDB).where(ActionProfileDB.user_id == user_id).order_by(ActionProfileDB.created_at.asc())
        )
        profiles = list(result.scalars().all())
        existing_by_mode = {item.mode: item for item in profiles}
        created = False
        for mode in ("observe", "draft", "organize", "act"):
            if mode in existing_by_mode:
                if not (existing_by_mode[mode].rules_json or "").strip():
                    existing_by_mode[mode].rules_json = json.dumps(action_policy_service.seed_rules_for_mode(mode))
                    existing_by_mode[mode].updated_at = _utc_now()
                    created = True
                continue
            profile = ActionProfileDB(
                id=str(uuid4()),
                user_id=user_id,
                name=mode.replace("_", " ").title(),
                mode=mode,
                is_default=1 if mode == "draft" else 0,
                rules_json=json.dumps(action_policy_service.seed_rules_for_mode(mode)),
                created_at=_utc_now(),
                updated_at=_utc_now(),
            )
            session.add(profile)
            profiles.append(profile)
            existing_by_mode[mode] = profile
            created = True
        if created:
            await session.flush()
        return profiles

    async def ensure_default_workflow_definitions(
        self,
        session,
        *,
        user_id: str,
        timezone_name: Optional[str],
    ) -> List[WorkflowDefinitionDB]:
        profiles = await self.ensure_default_action_profiles(session, user_id)
        draft_profile = next((item for item in profiles if item.mode == "draft"), None)
        if draft_profile is None:
            raise RuntimeError("Draft action profile was not created")

        normalized_timezone = self._normalize_timezone(timezone_name)
        result = await session.execute(
            select(WorkflowDefinitionDB)
            .where(WorkflowDefinitionDB.user_id == user_id)
            .order_by(WorkflowDefinitionDB.created_at.asc())
        )
        definitions = list(result.scalars().all())
        existing_by_kind = {item.kind: item for item in definitions}
        created = False

        for kind, defaults in DEFAULT_WORKFLOW_DEFINITIONS.items():
            if kind in existing_by_kind:
                continue
            definition = WorkflowDefinitionDB(
                id=str(uuid4()),
                user_id=user_id,
                kind=kind,
                name=defaults["name"],
                definition_family=defaults["definition_family"],
                trigger_type=defaults["trigger_type"],
                signal_kind=defaults.get("signal_kind"),
                cooldown_minutes=int(defaults.get("cooldown_minutes") or 240),
                quiet_hours_json=json.dumps(defaults.get("quiet_hours") or {}),
                status=defaults["status"],
                timezone=normalized_timezone,
                cadence=defaults["cadence"],
                send_hour_local=defaults["send_hour_local"],
                send_minute_local=defaults["send_minute_local"],
                send_weekdays_json=json.dumps(defaults["send_weekdays"]),
                delivery_channel="in_app",
                delivery_json=json.dumps({"publish": True, "inbox": True}),
                ranking_json=json.dumps(defaults.get("ranking") or {}),
                config_json=json.dumps(defaults["config"]),
                template_version=1,
                action_profile_id=draft_profile.id,
                created_at=_utc_now(),
                updated_at=_utc_now(),
            )
            session.add(definition)
            definitions.append(definition)
            created = True
        if created:
            await session.flush()
            for definition in definitions:
                profile = next((item for item in profiles if item.id == definition.action_profile_id), None)
                if profile is not None:
                    await self._index_definition(definition, profile)
        return definitions

    async def list_action_profiles(self, user_id: str) -> ActionProfileListResponse:
        async with get_db_session() as session:
            profiles = await self.ensure_default_action_profiles(session, user_id)
            await session.commit()
            profiles = sorted(
                profiles,
                key=lambda item: (0 if item.mode == "draft" else 1, item.created_at or datetime.min),
            )
            return ActionProfileListResponse(items=[self._profile_to_schema(item) for item in profiles])

    async def update_action_profile(self, *, user_id: str, profile_id: str, payload: ActionProfileUpdate) -> Optional[ActionProfileRead]:
        async with get_db_session() as session:
            await self.ensure_default_action_profiles(session, user_id)
            profile = await session.get(ActionProfileDB, profile_id)
            if profile is None or profile.user_id != user_id:
                return None
            if payload.name is not None:
                profile.name = payload.name
            if payload.rules is not None:
                profile.rules_json = json.dumps(payload.rules.model_dump(mode="json"))
            if payload.is_default is not None:
                if payload.is_default:
                    result = await session.execute(select(ActionProfileDB).where(ActionProfileDB.user_id == user_id))
                    for candidate in result.scalars().all():
                        candidate.is_default = candidate.id == profile.id
                        candidate.updated_at = _utc_now()
                else:
                    profile.is_default = False
            profile.updated_at = _utc_now()
            await session.commit()
            return self._profile_to_schema(profile)

    async def list_approvals(self, user_id: str) -> ApprovalListResponse:
        async with get_db_session() as session:
            result = await session.execute(
                select(ApprovalRequestDB)
                .where(ApprovalRequestDB.user_id == user_id)
                .order_by(desc(ApprovalRequestDB.created_at))
            )
            return ApprovalListResponse(items=[self._approval_to_schema(item) for item in result.scalars().all()])

    async def list_definitions(self, user_id: str, *, timezone_name: Optional[str]) -> WorkflowDefinitionListResponse:
        async with get_db_session() as session:
            await self.ensure_default_workflow_definitions(session, user_id=user_id, timezone_name=timezone_name)
            result = await session.execute(
                select(WorkflowDefinitionDB, ActionProfileDB)
                .join(ActionProfileDB, ActionProfileDB.id == WorkflowDefinitionDB.action_profile_id)
                .where(WorkflowDefinitionDB.user_id == user_id)
                .order_by(WorkflowDefinitionDB.definition_family.asc(), WorkflowDefinitionDB.created_at.asc())
            )
            await session.commit()
            return WorkflowDefinitionListResponse(
                items=[self._definition_to_schema(definition, profile) for definition, profile in result.all()]
            )

    async def update_definition(
        self,
        *,
        user_id: str,
        definition_id: str,
        timezone_name: Optional[str],
        payload: WorkflowDefinitionUpdate,
    ) -> WorkflowDefinitionRead:
        async with get_db_session() as session:
            await self.ensure_default_workflow_definitions(session, user_id=user_id, timezone_name=timezone_name)
            definition = await session.get(WorkflowDefinitionDB, definition_id)
            if not definition or definition.user_id != user_id:
                raise WorkflowNotFoundError("Workflow definition not found")

            current_profile = await session.get(ActionProfileDB, definition.action_profile_id)
            if current_profile is None:
                raise WorkflowValidationError("Action profile not found")

            target_profile = current_profile
            if payload.action_profile_id:
                target_profile = await session.get(ActionProfileDB, payload.action_profile_id)
                if not target_profile or target_profile.user_id != user_id:
                    raise WorkflowValidationError("Action profile not found")

            if payload.schedule is not None:
                definition.timezone = self._normalize_timezone(payload.schedule.timezone)
                definition.cadence = payload.schedule.cadence
                definition.send_hour_local = payload.schedule.send_hour_local
                definition.send_minute_local = payload.schedule.send_minute_local
                definition.send_weekdays_json = json.dumps(payload.schedule.send_weekdays)
            provided_fields = getattr(payload, "model_fields_set", set())

            if payload.definition_family is not None:
                definition.definition_family = payload.definition_family
            if payload.trigger_type is not None:
                definition.trigger_type = payload.trigger_type
            if "signal_kind" in provided_fields:
                definition.signal_kind = payload.signal_kind or None

            if payload.config is not None:
                definition.config_json = json.dumps(payload.config)
            if payload.ranking is not None:
                definition.ranking_json = json.dumps(payload.ranking)
            if payload.quiet_hours is not None:
                definition.quiet_hours_json = json.dumps(payload.quiet_hours)
            if payload.delivery is not None:
                if payload.delivery.channel != "in_app":
                    raise WorkflowValidationError("Only in-app delivery is supported")
                definition.delivery_json = json.dumps(payload.delivery.model_dump(mode="json"))
            if payload.cooldown_minutes is not None:
                definition.cooldown_minutes = max(0, int(payload.cooldown_minutes))
            if payload.action_profile_id:
                definition.action_profile_id = target_profile.id
            if payload.status is not None:
                definition.status = payload.status

            if target_profile.mode == "observe" and definition.status == "scheduled":
                raise WorkflowValidationError("Observe profile cannot be assigned to a scheduled workflow")
            if definition.status == "scheduled" and target_profile.mode not in {"draft", "organize", "act"}:
                raise WorkflowValidationError("Scheduled workflows require Draft, Organize, or Act profiles")

            if definition.status == "scheduled" and definition.trigger_type == "schedule":
                definition.next_run_at = self._compute_next_run(
                    cadence=definition.cadence,
                    timezone_name=definition.timezone,
                    send_hour_local=int(definition.send_hour_local or 0),
                    send_minute_local=int(definition.send_minute_local or 0),
                    send_weekdays=self._parse_json(definition.send_weekdays_json, []),
                )
            else:
                definition.next_run_at = None

            if definition.definition_family == "ambient" and definition.trigger_type != "signal":
                raise WorkflowValidationError("Ambient definitions must use signal triggers")
            if definition.definition_family == "routine" and definition.trigger_type != "schedule":
                raise WorkflowValidationError("Routine definitions must use schedule triggers")
            if definition.trigger_type == "signal" and not (definition.signal_kind or "").strip():
                raise WorkflowValidationError("Signal-triggered workflows require a signal kind")

            definition.updated_at = _utc_now()
            await session.commit()
            refreshed_profile = await session.get(ActionProfileDB, definition.action_profile_id)
            if refreshed_profile is None:
                raise WorkflowValidationError("Action profile missing after update")
            await self._index_definition(definition, refreshed_profile)
            return self._definition_to_schema(definition, refreshed_profile)

    async def queue_manual_run(self, *, user_id: str, definition_id: str, timezone_name: Optional[str]) -> WorkflowRunQueueResponse:
        async with get_db_session() as session:
            await self.ensure_default_workflow_definitions(session, user_id=user_id, timezone_name=timezone_name)
            definition = await session.get(WorkflowDefinitionDB, definition_id)
            if not definition or definition.user_id != user_id:
                raise WorkflowNotFoundError("Workflow definition not found")

            run = WorkflowRunDB(
                id=str(uuid4()),
                workflow_definition_id=definition.id,
                user_id=user_id,
                status="queued",
                trigger_source="manual",
                created_at=_utc_now(),
                updated_at=_utc_now(),
            )
            session.add(run)
            await session.commit()
            asyncio.create_task(self.process_run_by_id(run.id))
            return WorkflowRunQueueResponse(definition_id=definition.id, run=self._run_to_schema(run))

    async def list_runs(self, *, user_id: str, definition_id: Optional[str], limit: int = 20) -> WorkflowRunListResponse:
        limit = max(1, min(int(limit or 20), 100))
        async with get_db_session() as session:
            filters = [WorkflowRunDB.user_id == user_id]
            if definition_id:
                filters.append(WorkflowRunDB.workflow_definition_id == definition_id)
            result = await session.execute(
                select(WorkflowRunDB)
                .where(*filters)
                .order_by(desc(WorkflowRunDB.created_at))
                .limit(limit)
            )
            return WorkflowRunListResponse(items=[self._run_to_schema(item) for item in result.scalars().all()])

    async def get_run(self, *, user_id: str, run_id: str) -> Optional[WorkflowRunDetailRead]:
        async with get_db_session() as session:
            run = await session.get(WorkflowRunDB, run_id)
            if not run or run.user_id != user_id:
                return None
            artifact = await session.get(ArtifactDB, run.artifact_id) if run.artifact_id else None
            base = self._run_to_schema(run)
            return WorkflowRunDetailRead(
                **base.model_dump(),
                plan=self._parse_json(run.plan_json, None),
                result=self._parse_json(run.result_json, None),
                artifact=self._artifact_summary_from_row(artifact),
                proposed_actions=[
                    ProposedAction.model_validate(item)
                    for item in self._parse_json(run.proposed_actions_json, [])
                    if isinstance(item, dict)
                ],
                policy_decisions=[
                    self._policy_decision_to_schema(item)
                    for item in self._parse_json(run.policy_decisions_json, [])
                    if isinstance(item, dict)
                ],
                fact_suggestions=self._parse_json(run.fact_suggestions_json, []),
                queue_suggestions=self._parse_json(run.queue_suggestions_json, []),
            )

    async def dispatch_due_definitions(self) -> Dict[str, int]:
        queued = 0
        now = _utc_now()
        async with get_db_session() as session:
            result = await session.execute(
                select(WorkflowDefinitionDB)
                .where(
                    WorkflowDefinitionDB.definition_family == "routine",
                    WorkflowDefinitionDB.trigger_type == "schedule",
                    WorkflowDefinitionDB.status == "scheduled",
                    WorkflowDefinitionDB.next_run_at.is_not(None),
                    WorkflowDefinitionDB.next_run_at <= now,
                )
                .order_by(WorkflowDefinitionDB.next_run_at.asc())
            )
            definitions = list(result.scalars().all())
            for definition in definitions:
                idempotency_key = self._build_idempotency_key(definition, definition.next_run_at or now)
                existing = await session.execute(
                    select(func.count(WorkflowRunDB.id)).where(WorkflowRunDB.idempotency_key == idempotency_key)
                )
                if int(existing.scalar() or 0) == 0:
                    session.add(
                        WorkflowRunDB(
                            id=str(uuid4()),
                            workflow_definition_id=definition.id,
                            user_id=definition.user_id,
                            status="queued",
                            trigger_source="scheduled",
                            idempotency_key=idempotency_key,
                            created_at=_utc_now(),
                            updated_at=_utc_now(),
                        )
                    )
                    queued += 1
                definition.next_run_at = self._compute_next_run(
                    cadence=definition.cadence,
                    timezone_name=definition.timezone,
                    send_hour_local=int(definition.send_hour_local or 0),
                    send_minute_local=int(definition.send_minute_local or 0),
                    send_weekdays=self._parse_json(definition.send_weekdays_json, []),
                    reference_utc=(definition.next_run_at or now).replace(tzinfo=timezone.utc) + timedelta(seconds=1),
                )
                definition.updated_at = _utc_now()
            if definitions:
                await session.commit()
        return {"queued": queued}

    async def _call_dashboard_executor(
        self,
        *,
        user_id: str,
        run_id: str,
        workflow_kind: str,
        timezone_name: str,
        config: Dict[str, Any],
        window: _WorkflowWindow,
    ) -> Dict[str, Any]:
        if not INTERNAL_BACKEND_TOKEN:
            raise RuntimeError("INTERNAL_BACKEND_TOKEN is required for workflow execution")
        url = f"{DASHBOARD_BASE_URL}/api/internal/workflows/execute"
        payload = {
            "user_id": user_id,
            "workflow_run_id": run_id,
            "workflow_kind": workflow_kind,
            "timezone": timezone_name,
            "config": config,
            "window": {
                "start": window.start_utc.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                "end": window.end_utc.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
            },
        }
        async with httpx.AsyncClient(timeout=WORKFLOW_EXECUTION_TIMEOUT) as client:
            response = await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "x-backend-token": INTERNAL_BACKEND_TOKEN,
                },
                json=payload,
            )
        if response.status_code != 200:
            raise RuntimeError(f"Workflow executor returned {response.status_code}: {response.text[:300]}")
        return InternalWorkflowExecuteResponse.model_validate(response.json()).model_dump(mode="json")

    def _quiet_hours_active(self, timezone_name: str, quiet_hours: Dict[str, Any], now_utc: Optional[datetime] = None) -> bool:
        start = str(quiet_hours.get("start") or "").strip()
        end = str(quiet_hours.get("end") or "").strip()
        if not start or not end:
            return False
        try:
            local_now = self._localize_reference(timezone_name, now_utc)
            start_hour, start_minute = [int(part) for part in start.split(":", 1)]
            end_hour, end_minute = [int(part) for part in end.split(":", 1)]
            current_minutes = local_now.hour * 60 + local_now.minute
            start_minutes = start_hour * 60 + start_minute
            end_minutes = end_hour * 60 + end_minute
            if start_minutes <= end_minutes:
                return start_minutes <= current_minutes <= end_minutes
            return current_minutes >= start_minutes or current_minutes <= end_minutes
        except Exception:
            return False

    async def dispatch_ambient_candidates(self) -> Dict[str, int]:
        from services.sms_copilot_signal_service import sms_copilot_signal_service

        triggered = 0
        suppressed = 0
        now = _utc_now()

        async with get_db_session() as session:
            result = await session.execute(
                select(WorkflowDefinitionDB)
                .where(
                    WorkflowDefinitionDB.definition_family == "ambient",
                    WorkflowDefinitionDB.trigger_type == "signal",
                    WorkflowDefinitionDB.status == "scheduled",
                )
                .order_by(WorkflowDefinitionDB.created_at.asc())
            )
            definitions = list(result.scalars().all())
            for definition in definitions:
                if not definition.signal_kind:
                    continue
                user = await session.get(UserDB, definition.user_id)
                if user is None:
                    continue

                quiet_hours = self._parse_json(definition.quiet_hours_json, {})
                if self._quiet_hours_active(definition.timezone, quiet_hours, now):
                    session.add(
                        AmbientSignalEventDB(
                            id=str(uuid4()),
                            user_id=definition.user_id,
                            workflow_definition_id=definition.id,
                            workflow_run_id=None,
                            signal_kind=definition.signal_kind,
                            status="suppressed",
                            score=0.0,
                            confidence=0.0,
                            suppression_reason="quiet_hours",
                            dedupe_key=None,
                            payload_json=json.dumps({"reason": "quiet_hours"}),
                            created_at=_utc_now(),
                            updated_at=_utc_now(),
                        )
                    )
                    suppressed += 1
                    continue

                candidates = await sms_copilot_signal_service.evaluate_user(
                    user_id=definition.user_id,
                    now_utc=now.replace(tzinfo=timezone.utc),
                    kinds=[definition.signal_kind],
                )
                for candidate in candidates:
                    ranking = self._parse_json(definition.ranking_json, {})
                    min_score = float(ranking.get("minimum_score") or 0.0)
                    min_confidence = float(ranking.get("minimum_confidence") or 0.0)
                    if candidate.score < min_score or candidate.confidence < min_confidence:
                        session.add(
                            AmbientSignalEventDB(
                                id=str(uuid4()),
                                user_id=definition.user_id,
                                workflow_definition_id=definition.id,
                                workflow_run_id=None,
                                signal_kind=candidate.kind,
                                status="suppressed",
                                score=candidate.score,
                                confidence=candidate.confidence,
                                suppression_reason="below_threshold",
                                dedupe_key=candidate.dedupe_key,
                                payload_json=json.dumps(candidate.payload),
                                created_at=_utc_now(),
                                updated_at=_utc_now(),
                            )
                        )
                        suppressed += 1
                        continue

                    existing_event = await session.execute(
                        select(AmbientSignalEventDB)
                        .where(
                            AmbientSignalEventDB.user_id == definition.user_id,
                            AmbientSignalEventDB.dedupe_key == candidate.dedupe_key,
                        )
                    )
                    if existing_event.scalars().first() is not None:
                        continue

                    if int(definition.cooldown_minutes or 0) > 0:
                        recent_event = await session.execute(
                            select(AmbientSignalEventDB)
                            .where(
                                AmbientSignalEventDB.user_id == definition.user_id,
                                AmbientSignalEventDB.signal_kind == candidate.kind,
                                AmbientSignalEventDB.status == "triggered",
                                AmbientSignalEventDB.created_at >= _utc_now() - timedelta(minutes=int(definition.cooldown_minutes or 0)),
                            )
                            .order_by(desc(AmbientSignalEventDB.created_at))
                            .limit(1)
                        )
                        if recent_event.scalars().first() is not None:
                            session.add(
                                AmbientSignalEventDB(
                                    id=str(uuid4()),
                                    user_id=definition.user_id,
                                    workflow_definition_id=definition.id,
                                    workflow_run_id=None,
                                    signal_kind=candidate.kind,
                                    status="suppressed",
                                    score=candidate.score,
                                    confidence=candidate.confidence,
                                    suppression_reason="cooldown",
                                    dedupe_key=candidate.dedupe_key,
                                    payload_json=json.dumps(candidate.payload),
                                    created_at=_utc_now(),
                                    updated_at=_utc_now(),
                                )
                            )
                            suppressed += 1
                            continue

                    run = WorkflowRunDB(
                        id=str(uuid4()),
                        workflow_definition_id=definition.id,
                        user_id=definition.user_id,
                        status="queued",
                        trigger_source="signal",
                        idempotency_key=candidate.dedupe_key,
                        created_at=_utc_now(),
                        updated_at=_utc_now(),
                    )
                    session.add(run)
                    await session.flush()
                    session.add(
                        AmbientSignalEventDB(
                            id=str(uuid4()),
                            user_id=definition.user_id,
                            workflow_definition_id=definition.id,
                            workflow_run_id=run.id,
                            signal_kind=candidate.kind,
                            status="triggered",
                            score=candidate.score,
                            confidence=candidate.confidence,
                            suppression_reason=None,
                            dedupe_key=candidate.dedupe_key,
                            payload_json=json.dumps(candidate.payload),
                            created_at=_utc_now(),
                            updated_at=_utc_now(),
                        )
                    )
                    triggered += 1
            if definitions:
                await session.commit()
        return {"queued": triggered, "suppressed": suppressed}

    async def _process_run(self, *, session, run: WorkflowRunDB, definition: WorkflowDefinitionDB, user: UserDB) -> WorkflowRunDB:
        if run.status not in {"queued", "processing"}:
            return run
        run.status = "processing"
        run.started_at = _utc_now()
        run.updated_at = _utc_now()
        await session.commit()

        try:
            window = self._resolve_window(timezone_name=definition.timezone)
            run.window_start = window.start_utc
            run.window_end = window.end_utc
            await session.commit()

            payload = await self._call_dashboard_executor(
                user_id=user.id,
                run_id=run.id,
                workflow_kind=definition.kind,
                timezone_name=definition.timezone,
                config=self._parse_json(definition.config_json, {}),
                window=window,
            )
            artifact_payload = payload.get("artifact") or {}
            artifact_kind = str(artifact_payload.get("kind") or ("ambient_digest" if definition.definition_family == "ambient" else definition.kind))
            artifact_title = str(artifact_payload.get("title") or definition.name)
            artifact_summary = str(artifact_payload.get("summary") or "")
            artifact_body = artifact_payload.get("body") or {"schemaVersion": 1, "blocks": []}
            artifact_metadata = artifact_payload.get("metadata") or {}
            artifact_metadata.setdefault("definition_family", definition.definition_family)
            artifact = await artifact_service.create_workflow_artifact(
                session,
                user_id=user.id,
                kind=artifact_kind,
                source_id=run.id,
                title=artifact_title,
                summary=artifact_summary,
                body=artifact_body,
                metadata=artifact_metadata,
                period_start=window.start_local,
                period_end=window.end_local,
                timezone=definition.timezone,
                conversation_id=None,
                source_type="workflow_run",
                folder_key="ambient" if definition.definition_family == "ambient" else "routines",
            )
            run.artifact_id = artifact.id

            proposed_actions = payload.get("proposed_actions") or []
            policy_results = await action_policy_service.evaluate_actions(
                session,
                profile=await session.get(ActionProfileDB, definition.action_profile_id),
                user_id=user.id,
                workflow_run_id=run.id,
                conversation_id=None,
                proposed_actions=proposed_actions,
            )
            policy_decisions_json = [
                {
                    "action_kind": result.action_kind,
                    "capability": result.capability,
                    "outcome": result.outcome,
                    "reason": result.reason,
                    "approval_request_id": result.approval_request_id,
                    "receipt_id": result.receipt_id,
                }
                for result in policy_results
            ]
            fact_suggestions = payload.get("fact_suggestions") or []
            created_facts = await fact_service.create_suggestions(
                user_id=user.id,
                suggestions=fact_suggestions,
                source_type="workflow" if definition.definition_family == "routine" else "ambient",
                source_ref=run.id,
            )
            for fact in created_facts:
                await artifact_service.add_link(
                    user.id,
                    artifact.id,
                    ArtifactLinkCreate(target_type="fact", target_id=fact.id, relationship="suggested_from"),
                )

            run.plan_json = json.dumps(payload.get("plan") or {})
            run.result_json = json.dumps(payload.get("result") or {})
            run.proposed_actions_json = json.dumps(proposed_actions)
            run.policy_decisions_json = json.dumps(policy_decisions_json)
            run.fact_suggestions_json = json.dumps([item.model_dump(mode="json") for item in created_facts])
            run.queue_suggestions_json = json.dumps(payload.get("queue_suggestions") or [])
            run.error_json = None
            run.status = "completed"
            run.finished_at = _utc_now()
            run.updated_at = _utc_now()
            definition.last_run_at = run.finished_at
            definition.last_error = None
            definition.updated_at = _utc_now()
            await session.commit()
            await artifact_service._index_artifact(artifact)
        except Exception as exc:
            logger.exception("Workflow run %s failed", run.id)
            run.status = "failed"
            run.error_json = json.dumps({"message": str(exc)})
            run.finished_at = _utc_now()
            run.updated_at = _utc_now()
            definition.last_error = str(exc)
            definition.updated_at = _utc_now()
            await session.commit()
        return run

    async def process_run_by_id(self, run_id: str) -> None:
        async with get_db_session() as session:
            run = await session.get(WorkflowRunDB, run_id)
            if not run:
                return
            definition = await session.get(WorkflowDefinitionDB, run.workflow_definition_id)
            user = await session.get(UserDB, run.user_id)
            if not definition or not user:
                return
            await self._process_run(session=session, run=run, definition=definition, user=user)

    async def process_queued_runs(self, limit: int = 10) -> Dict[str, int]:
        processed = 0
        failed = 0
        async with get_db_session() as session:
            result = await session.execute(
                select(WorkflowRunDB)
                .where(WorkflowRunDB.status == "queued")
                .order_by(WorkflowRunDB.created_at.asc())
                .limit(limit)
            )
            runs = list(result.scalars().all())
            for run in runs:
                definition = await session.get(WorkflowDefinitionDB, run.workflow_definition_id)
                user = await session.get(UserDB, run.user_id)
                if not definition or not user:
                    run.status = "failed"
                    run.error_json = json.dumps({"message": "Missing workflow definition or user"})
                    run.finished_at = _utc_now()
                    run.updated_at = _utc_now()
                    failed += 1
                    await session.commit()
                    continue
                await self._process_run(session=session, run=run, definition=definition, user=user)
                if run.status == "completed":
                    processed += 1
                elif run.status == "failed":
                    failed += 1
        return {"processed": processed, "failed": failed}

    async def scheduler_tick(self) -> Dict[str, int]:
        dispatch = await self.dispatch_due_definitions()
        processed = await self.process_queued_runs()
        return {
            "queued": int(dispatch.get("queued", 0)),
            "processed": int(processed.get("processed", 0)),
            "failed": int(processed.get("failed", 0)),
        }

    async def ambient_tick(self) -> Dict[str, int]:
        dispatch = await self.dispatch_ambient_candidates()
        processed = await self.process_queued_runs()
        return {
            "queued": int(dispatch.get("queued", 0)),
            "suppressed": int(dispatch.get("suppressed", 0)),
            "processed": int(processed.get("processed", 0)),
            "failed": int(processed.get("failed", 0)),
        }


workflow_service = WorkflowService()
