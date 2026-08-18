"""Helpers for linking calendar scheduled blocks to TaskDB rows."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, Iterable, Optional
from uuid import uuid4

from sqlalchemy import select

from database.models import ScheduledBlockDB, TaskDB, TaskEventDB
from database.models.base import _utcnow_naive


def naive_datetime_from_day_minutes(day: str, start_minutes: int) -> datetime:
    year, month, day_n = (int(part) for part in day.split("-"))
    hours, minutes = divmod(max(0, int(start_minutes)), 60)
    return datetime(year, month, day_n, min(hours, 23), min(minutes, 59))


def scheduled_block_payload(block: ScheduledBlockDB, task_status: Optional[str] = None) -> dict:
    return {
        "id": block.id,
        "user_id": block.user_id,
        "title": block.title,
        "notes": block.notes,
        "day": block.day,
        "start_minutes": block.start_minutes,
        "end_minutes": block.end_minutes,
        "task_id": getattr(block, "task_id", None),
        "task_status": task_status,
        "created_at": block.created_at,
        "updated_at": block.updated_at,
    }


async def load_task_status_map(session, task_ids: Iterable[str]) -> Dict[str, str]:
    ids = [task_id for task_id in task_ids if task_id]
    if not ids:
        return {}
    result = await session.execute(select(TaskDB.id, TaskDB.status).where(TaskDB.id.in_(ids)))
    return {row.id: row.status for row in result.all()}


async def find_block_for_task(session, user_id: str, task_id: str) -> Optional[ScheduledBlockDB]:
    result = await session.execute(
        select(ScheduledBlockDB).where(
            ScheduledBlockDB.user_id == user_id,
            ScheduledBlockDB.task_id == task_id,
        )
    )
    return result.scalars().first()


async def get_or_create_calendar_task(
    session,
    *,
    user_id: str,
    title: str,
    notes: Optional[str],
    day: str,
    start_minutes: int,
    client_event_id: Optional[str] = None,
    existing_task_id: Optional[str] = None,
) -> TaskDB:
    if existing_task_id:
        task = await session.get(TaskDB, existing_task_id)
        if not task or task.user_id != user_id:
            raise ValueError("task_id is not available")
        return task

    if client_event_id:
        existing = await session.execute(
            select(TaskDB).where(
                TaskDB.user_id == user_id,
                TaskDB.client_event_id == client_event_id,
            )
        )
        found = existing.scalar_one_or_none()
        if found:
            return found

    now = _utcnow_naive()
    scheduled_for = naive_datetime_from_day_minutes(day, start_minutes)
    task = TaskDB(
        id=str(uuid4()),
        user_id=user_id,
        title=title,
        notes=notes,
        status="open",
        priority="none",
        due_at=scheduled_for,
        scheduled_for=scheduled_for,
        source="calendar",
        client_event_id=client_event_id,
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
            payload_json='{"source":"calendar"}',
            created_at=now,
        )
    )
    await session.flush()
    return task


async def sync_task_from_block(session, block: ScheduledBlockDB) -> Optional[TaskDB]:
    task_id = getattr(block, "task_id", None)
    if not task_id:
        return None
    task = await session.get(TaskDB, task_id)
    if not task or task.user_id != block.user_id:
        return None
    task.title = block.title
    task.notes = block.notes
    task.scheduled_for = naive_datetime_from_day_minutes(block.day, block.start_minutes)
    task.due_at = task.scheduled_for
    task.updated_at = _utcnow_naive()
    return task


async def sync_linked_blocks_from_task(session, task: TaskDB, *, fields: set[str]) -> None:
    if not fields.intersection({"title", "notes"}):
        return
    result = await session.execute(
        select(ScheduledBlockDB).where(
            ScheduledBlockDB.user_id == task.user_id,
            ScheduledBlockDB.task_id == task.id,
        )
    )
    now = _utcnow_naive()
    for block in result.scalars().all():
        if "title" in fields:
            block.title = task.title
        if "notes" in fields:
            block.notes = task.notes
        block.updated_at = now
