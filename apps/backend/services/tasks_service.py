"""Task and routine persistence/service layer."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4

from sqlalchemy import and_, asc, desc, or_, select

from database.connection import get_db_session
from database.models import HabitDB, RoutineDB, RoutineRunDB, ScheduledBlockDB, TaskDB, TaskEventDB, WorkflowDefinitionDB, WorkflowRunDB
from database.models.base import _utcnow_naive
from schemas.tasks import (
    RoutineCreate,
    RoutineGenerateResponse,
    RoutinePreviewRequest,
    RoutinePreviewResponse,
    RoutineRead,
    RoutineRunRead,
    RoutineTaskTemplate,
    RoutineUpdate,
    TaskCreate,
    TaskRead,
    TaskUpdate,
)
from services.recurrence import (
    ensure_utc_naive,
    humanize_recurrence,
    next_run_at,
    next_run_preview,
    normalize_timezone,
    to_local,
    utc_now_naive,
)


class TaskNotFoundError(ValueError):
    pass


class RoutineNotFoundError(ValueError):
    pass


class TaskRoutineValidationError(ValueError):
    pass


def _json_load(raw: Optional[str], fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _json_dump(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


def _normalize_tags(tags: Optional[Iterable[str]]) -> List[str]:
    seen: set[str] = set()
    normalized: List[str] = []
    for tag in tags or []:
        value = str(tag).strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(value)
    return normalized


def _bounded_int(value: Any, *, fallback: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _scheduled_block_window(scheduled_for: datetime, timezone_name: str, config: Dict[str, Any]) -> tuple[str, int, int]:
    local = to_local(scheduled_for, timezone_name)
    duration = _bounded_int(config.get("duration_minutes"), fallback=60, minimum=5, maximum=720)
    start_minutes = local.hour * 60 + local.minute
    end_minutes = min(1440, start_minutes + duration)
    if end_minutes <= start_minutes:
        end_minutes = min(1440, start_minutes + 30)
    return local.date().isoformat(), start_minutes, end_minutes


def _task_to_schema(task: TaskDB) -> TaskRead:
    return TaskRead(
        id=task.id,
        user_id=task.user_id,
        title=task.title,
        notes=task.notes,
        status=task.status,  # type: ignore[arg-type]
        priority=task.priority,  # type: ignore[arg-type]
        due_at=task.due_at,
        scheduled_for=task.scheduled_for,
        completed_at=task.completed_at,
        source=task.source,  # type: ignore[arg-type]
        project=task.project,
        category=task.category,
        tags=_json_load(task.tags_json, []),
        routine_id=task.routine_id,
        routine_run_id=task.routine_run_id,
        linked_habit_id=task.linked_habit_id,
        linked_artifact_id=task.linked_artifact_id,
        client_event_id=task.client_event_id,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _routine_template_from_row(routine: RoutineDB) -> RoutineTaskTemplate:
    payload = _json_load(routine.task_template_json, {})
    if not isinstance(payload, dict):
        payload = {}
    return RoutineTaskTemplate(
        title=str(payload.get("title") or ""),
        notes=payload.get("notes"),
        project=payload.get("project"),
        category=payload.get("category"),
        tags=_normalize_tags(payload.get("tags") if isinstance(payload.get("tags"), list) else []),
        linked_habit_id=payload.get("linked_habit_id"),
    )


def _routine_to_schema(routine: RoutineDB) -> RoutineRead:
    config = _json_load(routine.trigger_config_json, {})
    tags = _json_load(routine.tags_json, [])
    preview = next_run_preview(
        trigger_type=routine.trigger_type,
        trigger_config=config,
        timezone_name=routine.timezone,
        first_run_at=routine.first_run_at,
        ends_at=routine.ends_at,
        last_completed_at=routine.last_run_at if routine.trigger_type == "on_completion" else None,
        count=6,
    ) if routine.status == "scheduled" else []
    return RoutineRead(
        id=routine.id,
        user_id=routine.user_id,
        title=routine.title,
        description=routine.description,
        status=routine.status,  # type: ignore[arg-type]
        kind=routine.kind,  # type: ignore[arg-type]
        trigger_type=routine.trigger_type,  # type: ignore[arg-type]
        trigger_config=config,
        timezone=routine.timezone,
        priority=routine.priority,  # type: ignore[arg-type]
        tags=_normalize_tags(tags if isinstance(tags, list) else []),
        task_template=_routine_template_from_row(routine),
        ai_workflow_definition_id=routine.ai_workflow_definition_id,
        first_run_at=routine.first_run_at,
        ends_at=routine.ends_at,
        last_run_at=routine.last_run_at,
        next_run_at=routine.next_run_at,
        client_event_id=routine.client_event_id,
        cadence_summary=humanize_recurrence(routine.trigger_type, config),
        next_preview=preview,
        created_at=routine.created_at,
        updated_at=routine.updated_at,
    )


def _routine_run_to_schema(run: RoutineRunDB) -> RoutineRunRead:
    return RoutineRunRead(
        id=run.id,
        routine_id=run.routine_id,
        user_id=run.user_id,
        scheduled_for=run.scheduled_for,
        status=run.status,  # type: ignore[arg-type]
        generated_task_id=run.generated_task_id,
        generated_scheduled_block_id=run.generated_scheduled_block_id,
        workflow_run_id=run.workflow_run_id,
        completed_at=run.completed_at,
        skipped_at=run.skipped_at,
        error_json=run.error_json,
        idempotency_key=run.idempotency_key,
        created_at=run.created_at,
        updated_at=run.updated_at,
    )


def _routine_agent_plan(routine: RoutineDB) -> Dict[str, Any]:
    """Per-run executor input for AI routines.

    Agent settings (instructions, tier, data sources, notify flags) are stored
    under `trigger_config.agent` on the routine — workflow definitions are
    unique per (user_id, kind), so routines share definitions and carry their
    own agent config into each run via the run's plan_json.
    """
    config = _json_load(routine.trigger_config_json, {})
    agent = config.get("agent") if isinstance(config, dict) else None
    plan: Dict[str, Any] = {"routine_id": routine.id}
    if isinstance(agent, dict):
        override = dict(agent)
        override.setdefault("instructions", routine.description or "")
        override["routine_name"] = routine.title
        plan["config_override"] = override
    elif routine.description:
        plan["config_override"] = {"instructions": routine.description, "routine_name": routine.title}
    return plan


def _compute_routine_next(routine: RoutineDB, *, reference_utc: Optional[datetime] = None) -> Optional[datetime]:
    if routine.status != "scheduled":
        return None
    return next_run_at(
        trigger_type=routine.trigger_type,
        trigger_config=_json_load(routine.trigger_config_json, {}),
        timezone_name=routine.timezone,
        reference_utc=reference_utc,
        first_run_at=routine.first_run_at,
        ends_at=routine.ends_at,
        last_completed_at=routine.last_run_at if routine.trigger_type == "on_completion" else None,
    )


class TasksService:
    async def list_tasks(
        self,
        user_id: str,
        *,
        view: Optional[str] = None,
        category: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 200,
    ) -> List[TaskRead]:
        limit = max(1, min(int(limit or 200), 500))
        now = utc_now_naive()
        today_start = datetime(now.year, now.month, now.day)
        tomorrow_start = today_start + timedelta(days=1)

        async with get_db_session() as session:
            filters = [TaskDB.user_id == user_id]
            if view == "today":
                filters.append(TaskDB.status == "open")
                filters.append(
                    or_(
                        and_(TaskDB.scheduled_for.is_not(None), TaskDB.scheduled_for < tomorrow_start),
                        and_(TaskDB.due_at.is_not(None), TaskDB.due_at < tomorrow_start),
                    )
                )
            elif view == "upcoming":
                filters.append(TaskDB.status == "open")
                filters.append(
                    or_(
                        TaskDB.scheduled_for >= tomorrow_start,
                        TaskDB.due_at >= tomorrow_start,
                    )
                )
            elif view == "anytime":
                filters.append(TaskDB.status == "open")
                filters.append(TaskDB.scheduled_for.is_(None))
                filters.append(TaskDB.due_at.is_(None))
            elif view == "completed":
                filters.append(TaskDB.status == "completed")
            elif view == "skipped":
                filters.append(TaskDB.status == "skipped")
            elif view == "archived":
                filters.append(TaskDB.status == "archived")
            else:
                filters.append(TaskDB.status != "archived")

            if category and category != "All":
                filters.append(TaskDB.category == category)
            if source and source != "all":
                filters.append(TaskDB.source == source)

            result = await session.execute(
                select(TaskDB)
                .where(*filters)
                .order_by(
                    asc(TaskDB.status),
                    asc(TaskDB.scheduled_for.is_(None)),
                    asc(TaskDB.scheduled_for),
                    asc(TaskDB.due_at.is_(None)),
                    asc(TaskDB.due_at),
                    desc(TaskDB.created_at),
                )
                .limit(limit)
            )
            return [_task_to_schema(item) for item in result.scalars().all()]

    async def create_task(self, user_id: str, payload: TaskCreate) -> TaskRead:
        title = payload.title.strip()
        if not title:
            raise TaskRoutineValidationError("title is required")

        async with get_db_session() as session:
            if payload.client_event_id:
                existing_result = await session.execute(
                    select(TaskDB).where(
                        TaskDB.user_id == user_id,
                        TaskDB.client_event_id == payload.client_event_id,
                    )
                )
                existing = existing_result.scalar_one_or_none()
                if existing:
                    return _task_to_schema(existing)

            if payload.routine_id:
                routine_result = await session.execute(
                    select(RoutineDB.id).where(
                        RoutineDB.id == payload.routine_id,
                        RoutineDB.user_id == user_id,
                    )
                )
                if routine_result.scalar_one_or_none() is None:
                    raise TaskRoutineValidationError("routine_id is not available")

            if payload.routine_run_id:
                run_result = await session.execute(
                    select(RoutineRunDB.id).where(
                        RoutineRunDB.id == payload.routine_run_id,
                        RoutineRunDB.user_id == user_id,
                    )
                )
                if run_result.scalar_one_or_none() is None:
                    raise TaskRoutineValidationError("routine_run_id is not available")

            now = _utcnow_naive()
            completed_at = _utcnow_naive() if payload.status == "completed" else None
            task = TaskDB(
                id=str(uuid4()),
                user_id=user_id,
                title=title,
                notes=payload.notes.strip() if payload.notes else None,
                status=payload.status,
                priority=payload.priority,
                due_at=ensure_utc_naive(payload.due_at),
                scheduled_for=ensure_utc_naive(payload.scheduled_for),
                completed_at=completed_at,
                source=payload.source,
                project=payload.project.strip() if payload.project else None,
                category=payload.category.strip() if payload.category else None,
                tags_json=_json_dump(_normalize_tags(payload.tags)),
                routine_id=payload.routine_id,
                routine_run_id=payload.routine_run_id,
                linked_habit_id=payload.linked_habit_id,
                linked_artifact_id=payload.linked_artifact_id,
                client_event_id=payload.client_event_id,
                created_at=now,
                updated_at=now,
            )
            session.add(task)
            session.add(
                TaskEventDB(
                    id=str(uuid4()),
                    task_id=task.id,
                    user_id=user_id,
                    event_type="created",
                    payload_json=_json_dump({"source": task.source}),
                    created_at=now,
                )
            )
            await session.commit()
            await session.refresh(task)
            return _task_to_schema(task)

    async def update_task(self, user_id: str, task_id: str, payload: TaskUpdate) -> TaskRead:
        async with get_db_session() as session:
            task = await session.get(TaskDB, task_id)
            if not task or task.user_id != user_id:
                raise TaskNotFoundError("Task not found")

            fields = getattr(payload, "model_fields_set", set())
            before_status = task.status

            if "title" in fields:
                title = (payload.title or "").strip()
                if not title:
                    raise TaskRoutineValidationError("title cannot be empty")
                task.title = title
            if "notes" in fields:
                task.notes = payload.notes.strip() if payload.notes else None
            if "status" in fields and payload.status is not None:
                task.status = payload.status
                if payload.status == "completed" and task.completed_at is None:
                    task.completed_at = _utcnow_naive()
                if payload.status != "completed":
                    task.completed_at = None
            if "priority" in fields and payload.priority is not None:
                task.priority = payload.priority
            if "due_at" in fields:
                task.due_at = ensure_utc_naive(payload.due_at)
            if "scheduled_for" in fields:
                task.scheduled_for = ensure_utc_naive(payload.scheduled_for)
            if "completed_at" in fields:
                task.completed_at = ensure_utc_naive(payload.completed_at)
            if "project" in fields:
                task.project = payload.project.strip() if payload.project else None
            if "category" in fields:
                task.category = payload.category.strip() if payload.category else None
            if "tags" in fields:
                task.tags_json = _json_dump(_normalize_tags(payload.tags))
            if "linked_habit_id" in fields:
                task.linked_habit_id = payload.linked_habit_id
            if "linked_artifact_id" in fields:
                task.linked_artifact_id = payload.linked_artifact_id

            now = _utcnow_naive()
            task.updated_at = now
            session.add(
                TaskEventDB(
                    id=str(uuid4()),
                    task_id=task.id,
                    user_id=user_id,
                    event_type="updated" if before_status == task.status else task.status,
                    payload_json=_json_dump({"status": task.status}),
                    created_at=now,
                )
            )

            if task.routine_id and task.status == "completed" and before_status != "completed":
                routine = await session.get(RoutineDB, task.routine_id)
                if routine and routine.user_id == user_id and routine.trigger_type == "on_completion":
                    routine.last_run_at = task.completed_at or now
                    routine.next_run_at = _compute_routine_next(routine, reference_utc=routine.last_run_at)
                    routine.updated_at = now

            await session.commit()
            await session.refresh(task)
            return _task_to_schema(task)

    async def list_routines(self, user_id: str) -> List[RoutineRead]:
        async with get_db_session() as session:
            result = await session.execute(
                select(RoutineDB)
                .where(RoutineDB.user_id == user_id, RoutineDB.status != "archived")
                .order_by(asc(RoutineDB.status), asc(RoutineDB.next_run_at.is_(None)), asc(RoutineDB.next_run_at), asc(RoutineDB.title))
            )
            return [_routine_to_schema(item) for item in result.scalars().all()]

    async def create_routine(self, user_id: str, payload: RoutineCreate) -> RoutineRead:
        title = payload.title.strip()
        if not title:
            raise TaskRoutineValidationError("title is required")

        async with get_db_session() as session:
            if payload.client_event_id:
                existing_result = await session.execute(
                    select(RoutineDB).where(
                        RoutineDB.user_id == user_id,
                        RoutineDB.client_event_id == payload.client_event_id,
                    )
                )
                existing = existing_result.scalar_one_or_none()
                if existing:
                    return _routine_to_schema(existing)

            if payload.ai_workflow_definition_id:
                workflow = await session.get(WorkflowDefinitionDB, payload.ai_workflow_definition_id)
                if not workflow or workflow.user_id != user_id:
                    raise TaskRoutineValidationError("AI workflow definition not found")
            if payload.task_template.linked_habit_id:
                habit = await session.get(HabitDB, payload.task_template.linked_habit_id)
                if not habit or habit.user_id != user_id:
                    raise TaskRoutineValidationError("linked habit not found")

            now = _utcnow_naive()
            template = payload.task_template.model_dump(mode="json")
            if not str(template.get("linked_habit_id") or "").strip():
                template["linked_habit_id"] = None
            if not str(template.get("title") or "").strip():
                template["title"] = title
            routine = RoutineDB(
                id=str(uuid4()),
                user_id=user_id,
                title=title,
                description=payload.description.strip() if payload.description else None,
                status=payload.status,
                kind=payload.kind,
                trigger_type=payload.trigger_type,
                trigger_config_json=_json_dump(payload.trigger_config),
                timezone=normalize_timezone(payload.timezone),
                priority=payload.priority,
                tags_json=_json_dump(_normalize_tags(payload.tags)),
                task_template_json=_json_dump({**template, "tags": _normalize_tags(template.get("tags") or [])}),
                ai_workflow_definition_id=payload.ai_workflow_definition_id,
                first_run_at=ensure_utc_naive(payload.first_run_at),
                ends_at=ensure_utc_naive(payload.ends_at),
                client_event_id=payload.client_event_id,
                created_at=now,
                updated_at=now,
            )
            routine.next_run_at = _compute_routine_next(routine)
            session.add(routine)
            await session.commit()
            await session.refresh(routine)
            return _routine_to_schema(routine)

    async def update_routine(self, user_id: str, routine_id: str, payload: RoutineUpdate) -> RoutineRead:
        async with get_db_session() as session:
            routine = await session.get(RoutineDB, routine_id)
            if not routine or routine.user_id != user_id:
                raise RoutineNotFoundError("Routine not found")

            fields = getattr(payload, "model_fields_set", set())
            if "ai_workflow_definition_id" in fields and payload.ai_workflow_definition_id:
                workflow = await session.get(WorkflowDefinitionDB, payload.ai_workflow_definition_id)
                if not workflow or workflow.user_id != user_id:
                    raise TaskRoutineValidationError("AI workflow definition not found")

            if "title" in fields:
                title = (payload.title or "").strip()
                if not title:
                    raise TaskRoutineValidationError("title cannot be empty")
                routine.title = title
            if "description" in fields:
                routine.description = payload.description.strip() if payload.description else None
            if "status" in fields and payload.status is not None:
                routine.status = payload.status
            if "kind" in fields and payload.kind is not None:
                routine.kind = payload.kind
            if "trigger_type" in fields and payload.trigger_type is not None:
                routine.trigger_type = payload.trigger_type
            if "trigger_config" in fields and payload.trigger_config is not None:
                routine.trigger_config_json = _json_dump(payload.trigger_config)
            if "timezone" in fields and payload.timezone is not None:
                routine.timezone = normalize_timezone(payload.timezone)
            if "priority" in fields and payload.priority is not None:
                routine.priority = payload.priority
            if "tags" in fields:
                routine.tags_json = _json_dump(_normalize_tags(payload.tags))
            if "task_template" in fields and payload.task_template is not None:
                if payload.task_template.linked_habit_id:
                    habit = await session.get(HabitDB, payload.task_template.linked_habit_id)
                    if not habit or habit.user_id != user_id:
                        raise TaskRoutineValidationError("linked habit not found")
                template = payload.task_template.model_dump(mode="json")
                if not str(template.get("linked_habit_id") or "").strip():
                    template["linked_habit_id"] = None
                routine.task_template_json = _json_dump(template)
            if "ai_workflow_definition_id" in fields:
                routine.ai_workflow_definition_id = payload.ai_workflow_definition_id
            if "first_run_at" in fields:
                routine.first_run_at = ensure_utc_naive(payload.first_run_at)
            if "ends_at" in fields:
                routine.ends_at = ensure_utc_naive(payload.ends_at)

            routine.next_run_at = _compute_routine_next(routine)
            routine.updated_at = _utcnow_naive()
            await session.commit()
            await session.refresh(routine)
            return _routine_to_schema(routine)

    async def list_routine_runs(self, user_id: str, *, routine_id: Optional[str] = None, limit: int = 50) -> List[RoutineRunRead]:
        filters = [RoutineRunDB.user_id == user_id]
        if routine_id:
            filters.append(RoutineRunDB.routine_id == routine_id)
        async with get_db_session() as session:
            result = await session.execute(
                select(RoutineRunDB)
                .where(*filters)
                .order_by(desc(RoutineRunDB.scheduled_for))
                .limit(max(1, min(limit, 100)))
            )
            return [_routine_run_to_schema(item) for item in result.scalars().all()]

    async def preview_routine(self, payload: RoutinePreviewRequest) -> RoutinePreviewResponse:
        return RoutinePreviewResponse(
            cadence_summary=humanize_recurrence(payload.trigger_type, payload.trigger_config),
            next_preview=next_run_preview(
                trigger_type=payload.trigger_type,
                trigger_config=payload.trigger_config,
                timezone_name=payload.timezone,
                reference_utc=payload.reference_utc,
                first_run_at=payload.first_run_at,
                ends_at=payload.ends_at,
                last_completed_at=payload.last_completed_at,
                count=payload.count,
            ),
        )

    async def run_routine_now(self, user_id: str, routine_id: str) -> RoutineRunRead:
        """Queue an immediate manual run for an AI routine and process it."""
        import asyncio

        from services.workflow_service import workflow_service

        async with get_db_session() as session:
            routine = await session.get(RoutineDB, routine_id)
            if not routine or routine.user_id != user_id:
                raise RoutineNotFoundError("Routine not found")
            if routine.kind not in {"ai_workflow", "mixed"} or not routine.ai_workflow_definition_id:
                raise TaskRoutineValidationError("This routine has no agent attached")

            now = _utcnow_naive()
            workflow_run = WorkflowRunDB(
                id=str(uuid4()),
                workflow_definition_id=routine.ai_workflow_definition_id,
                user_id=user_id,
                status="queued",
                trigger_source="manual",
                plan_json=_json_dump(_routine_agent_plan(routine)),
                created_at=now,
                updated_at=now,
            )
            session.add(workflow_run)
            run = RoutineRunDB(
                id=str(uuid4()),
                routine_id=routine.id,
                user_id=user_id,
                scheduled_for=now,
                status="generated",
                workflow_run_id=workflow_run.id,
                idempotency_key=f"routine:{routine.id}:manual:{workflow_run.id}",
                created_at=now,
                updated_at=now,
            )
            session.add(run)
            routine.last_run_at = now
            routine.updated_at = now
            await session.commit()
            await session.refresh(run)

        asyncio.create_task(workflow_service.process_run_by_id(workflow_run.id))
        return _routine_run_to_schema(run)

    async def generate_due_routines(
        self,
        user_id: str,
        *,
        reference_utc: Optional[datetime] = None,
        horizon_days: int = 0,
    ) -> RoutineGenerateResponse:
        reference = ensure_utc_naive(reference_utc) or utc_now_naive()
        horizon = reference + timedelta(days=max(0, min(horizon_days, 90)))
        created_runs: List[RoutineRunDB] = []
        generated_tasks = 0
        generated_scheduled_blocks = 0
        generated_workflows = 0
        skipped = 0

        async with get_db_session() as session:
            result = await session.execute(
                select(RoutineDB)
                .where(
                    RoutineDB.user_id == user_id,
                    RoutineDB.status == "scheduled",
                    RoutineDB.next_run_at.is_not(None),
                    RoutineDB.next_run_at <= horizon,
                )
                .order_by(asc(RoutineDB.next_run_at))
            )
            routines = list(result.scalars().all())

            for routine in routines:
                scheduled_for = routine.next_run_at
                if scheduled_for is None:
                    continue

                # Catch-up: when several occurrences were missed (app closed
                # across fire times), run only the most recent one and record
                # the older occurrences as skipped — never stampede.
                if routine.trigger_type != "on_completion":
                    missed: List[datetime] = []
                    cursor: Optional[datetime] = scheduled_for
                    while cursor is not None and cursor < reference and len(missed) < 60:
                        missed.append(cursor)
                        cursor = _compute_routine_next(routine, reference_utc=cursor + timedelta(seconds=1))
                    if len(missed) > 1:
                        for occurrence in missed[:-1]:
                            skip_key = f"routine:{routine.id}:{occurrence.isoformat()}"
                            skip_existing = await session.execute(
                                select(RoutineRunDB).where(RoutineRunDB.idempotency_key == skip_key)
                            )
                            if skip_existing.scalar_one_or_none():
                                continue
                            session.add(
                                RoutineRunDB(
                                    id=str(uuid4()),
                                    routine_id=routine.id,
                                    user_id=user_id,
                                    scheduled_for=occurrence,
                                    status="skipped",
                                    skipped_at=_utcnow_naive(),
                                    idempotency_key=skip_key,
                                    created_at=_utcnow_naive(),
                                    updated_at=_utcnow_naive(),
                                )
                            )
                            skipped += 1
                        scheduled_for = missed[-1]

                idempotency_key = f"routine:{routine.id}:{scheduled_for.isoformat()}"
                existing_result = await session.execute(
                    select(RoutineRunDB).where(RoutineRunDB.idempotency_key == idempotency_key)
                )
                existing = existing_result.scalar_one_or_none()
                if existing:
                    skipped += 1
                    routine.next_run_at = _compute_routine_next(
                        routine,
                        reference_utc=scheduled_for + timedelta(seconds=1),
                    )
                    continue

                run = RoutineRunDB(
                    id=str(uuid4()),
                    routine_id=routine.id,
                    user_id=user_id,
                    scheduled_for=scheduled_for,
                    status="generated",
                    idempotency_key=idempotency_key,
                    created_at=_utcnow_naive(),
                    updated_at=_utcnow_naive(),
                )
                session.add(run)

                template = _routine_template_from_row(routine)
                config = _json_load(routine.trigger_config_json, {})
                if not isinstance(config, dict):
                    config = {}
                routine_tags = _json_load(routine.tags_json, [])
                if not isinstance(routine_tags, list):
                    routine_tags = []

                if routine.kind in {"task", "habit_prompt", "mixed"}:
                    task_source = "habit" if routine.kind == "habit_prompt" else "routine"
                    task = TaskDB(
                        id=str(uuid4()),
                        user_id=user_id,
                        title=(template.title or routine.title).strip(),
                        notes=template.notes or routine.description,
                        status="open",
                        priority=routine.priority,
                        due_at=scheduled_for,
                        scheduled_for=scheduled_for,
                        source=task_source,
                        project=template.project,
                        category=template.category,
                        tags_json=_json_dump(_normalize_tags([*routine_tags, *template.tags])),
                        routine_id=routine.id,
                        routine_run_id=run.id,
                        linked_habit_id=template.linked_habit_id,
                        created_at=_utcnow_naive(),
                        updated_at=_utcnow_naive(),
                    )
                    session.add(task)
                    session.add(
                        TaskEventDB(
                            id=str(uuid4()),
                            task_id=task.id,
                            user_id=user_id,
                            event_type="created",
                            payload_json=_json_dump({"source": task.source, "routine_id": routine.id}),
                            created_at=_utcnow_naive(),
                        )
                    )
                    run.generated_task_id = task.id
                    generated_tasks += 1

                if routine.kind in {"calendar_block", "mixed"}:
                    day, start_minutes, end_minutes = _scheduled_block_window(
                        scheduled_for,
                        routine.timezone,
                        config,
                    )
                    block = ScheduledBlockDB(
                        id=str(uuid4()),
                        user_id=user_id,
                        title=(template.title or routine.title).strip(),
                        notes=template.notes or routine.description,
                        day=day,
                        start_minutes=start_minutes,
                        end_minutes=end_minutes,
                        created_at=_utcnow_naive(),
                        updated_at=_utcnow_naive(),
                    )
                    session.add(block)
                    run.generated_scheduled_block_id = block.id
                    generated_scheduled_blocks += 1

                if routine.kind in {"ai_workflow", "mixed"} and routine.ai_workflow_definition_id:
                    workflow_run = WorkflowRunDB(
                        id=str(uuid4()),
                        workflow_definition_id=routine.ai_workflow_definition_id,
                        user_id=user_id,
                        status="queued",
                        trigger_source="scheduled",
                        plan_json=_json_dump(_routine_agent_plan(routine)),
                        idempotency_key=f"{idempotency_key}:workflow",
                        created_at=_utcnow_naive(),
                        updated_at=_utcnow_naive(),
                    )
                    session.add(workflow_run)
                    run.workflow_run_id = workflow_run.id
                    generated_workflows += 1

                routine.last_run_at = scheduled_for
                if routine.trigger_type == "on_completion":
                    routine.next_run_at = None
                else:
                    routine.next_run_at = _compute_routine_next(
                        routine,
                        reference_utc=scheduled_for + timedelta(seconds=1),
                    )
                routine.updated_at = _utcnow_naive()
                created_runs.append(run)

            await session.commit()
            for run in created_runs:
                await session.refresh(run)

        return RoutineGenerateResponse(
            queued=len(created_runs),
            generated_tasks=generated_tasks,
            generated_scheduled_blocks=generated_scheduled_blocks,
            generated_workflow_runs=generated_workflows,
            skipped=skipped,
            runs=[_routine_run_to_schema(run) for run in created_runs],
        )


tasks_service = TasksService()
