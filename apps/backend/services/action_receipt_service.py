"""Action receipts for mutating AI/user actions with undo support."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import uuid4

from sqlalchemy import select

from database.connection import get_db_session
from database.models import ActionReceiptDB, HabitDB, HabitLogDB, TaskDB
from schemas.workflows import ActionReceiptRead, ActionReceiptUndoResponse

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.utcnow()


def _loads(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


class ActionReceiptService:
    def to_schema(self, row: ActionReceiptDB) -> ActionReceiptRead:
        undo = _loads(row.undo_json)
        status = row.status or "applied"
        return ActionReceiptRead(
            id=row.id,
            user_id=row.user_id,
            workflow_run_id=row.workflow_run_id,
            conversation_id=row.conversation_id,
            client_event_id=getattr(row, "client_event_id", None),
            action_kind=row.action_kind,
            capability=row.capability,
            target_ref=row.target_ref,
            status=status,
            before=_loads(row.before_json),
            after=_loads(row.after_json),
            undo=undo,
            metadata=_loads(row.metadata_json) or {},
            created_at=row.created_at,
            undoable=bool(undo) and status == "applied",
        )

    async def create_receipt(
        self,
        session,
        *,
        user_id: str,
        action_kind: str,
        capability: str,
        target_ref: Optional[str] = None,
        conversation_id: Optional[str] = None,
        client_event_id: Optional[str] = None,
        before: Optional[Dict[str, Any]] = None,
        after: Optional[Dict[str, Any]] = None,
        undo: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        status: str = "applied",
    ) -> ActionReceiptDB:
        if client_event_id:
            existing = await session.execute(
                select(ActionReceiptDB).where(
                    ActionReceiptDB.user_id == user_id,
                    ActionReceiptDB.client_event_id == client_event_id,
                )
            )
            existing_row = existing.scalar_one_or_none()
            if existing_row:
                return existing_row

        receipt = ActionReceiptDB(
            id=str(uuid4()),
            user_id=user_id,
            workflow_run_id=None,
            conversation_id=conversation_id,
            client_event_id=client_event_id,
            action_kind=action_kind,
            capability=capability,
            target_ref=target_ref,
            status=status,
            before_json=json.dumps(before) if before is not None else None,
            after_json=json.dumps(after) if after is not None else None,
            undo_json=json.dumps(undo) if undo is not None else None,
            metadata_json=json.dumps(metadata or {}),
            created_at=_utc_now(),
        )
        session.add(receipt)
        await session.flush()
        return receipt

    async def get_receipt(self, user_id: str, receipt_id: str) -> Optional[ActionReceiptRead]:
        async with get_db_session() as session:
            result = await session.execute(
                select(ActionReceiptDB).where(
                    ActionReceiptDB.id == receipt_id,
                    ActionReceiptDB.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            if not row:
                return None
            return self.to_schema(row)

    async def get_by_client_event_id(
        self, user_id: str, client_event_id: str
    ) -> Optional[ActionReceiptRead]:
        async with get_db_session() as session:
            result = await session.execute(
                select(ActionReceiptDB).where(
                    ActionReceiptDB.user_id == user_id,
                    ActionReceiptDB.client_event_id == client_event_id,
                )
            )
            row = result.scalar_one_or_none()
            if not row:
                return None
            return self.to_schema(row)

    async def get_db_by_client_event_id(
        self, session, user_id: str, client_event_id: str
    ) -> Optional[ActionReceiptDB]:
        result = await session.execute(
            select(ActionReceiptDB).where(
                ActionReceiptDB.user_id == user_id,
                ActionReceiptDB.client_event_id == client_event_id,
            )
        )
        return result.scalar_one_or_none()

    async def undo_receipt(self, user_id: str, receipt_id: str) -> ActionReceiptUndoResponse:
        async with get_db_session() as session:
            result = await session.execute(
                select(ActionReceiptDB).where(
                    ActionReceiptDB.id == receipt_id,
                    ActionReceiptDB.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            if not row:
                raise LookupError("Action receipt not found")

            if row.status == "undone":
                return ActionReceiptUndoResponse(
                    receipt=self.to_schema(row),
                    undone=True,
                    noop=True,
                )

            undo = _loads(row.undo_json)
            if not undo:
                raise ValueError("Receipt is not undoable")

            op = str(undo.get("op") or "")
            if op == "delete_habit_log":
                habit_id = str(undo.get("habit_id") or "")
                log_id = str(undo.get("log_id") or "")
                log_result = await session.execute(
                    select(HabitLogDB)
                    .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
                    .where(
                        HabitLogDB.id == log_id,
                        HabitLogDB.habit_id == habit_id,
                        HabitDB.user_id == user_id,
                    )
                )
                log_row = log_result.scalar_one_or_none()
                if log_row:
                    session.delete(log_row)
            elif op == "delete_habit":
                habit_id = str(undo.get("habit_id") or "")
                habit_result = await session.execute(
                    select(HabitDB).where(
                        HabitDB.id == habit_id,
                        HabitDB.user_id == user_id,
                    )
                )
                habit_row = habit_result.scalar_one_or_none()
                if habit_row:
                    session.delete(habit_row)
            elif op == "archive_task":
                task_id = str(undo.get("task_id") or "")
                task_result = await session.execute(
                    select(TaskDB).where(
                        TaskDB.id == task_id,
                        TaskDB.user_id == user_id,
                    )
                )
                task_row = task_result.scalar_one_or_none()
                if task_row and task_row.status in {"open", "in_progress", "in_review"}:
                    task_row.status = "archived"
                    task_row.updated_at = _utc_now()
            else:
                raise ValueError(f"Unsupported undo operation: {op}")

            row.status = "undone"
            await session.commit()
            await session.refresh(row)
            return ActionReceiptUndoResponse(
                receipt=self.to_schema(row),
                undone=True,
                noop=False,
            )


action_receipt_service = ActionReceiptService()
