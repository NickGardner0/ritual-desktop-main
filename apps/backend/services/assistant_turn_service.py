"""Durable assistant turn store."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import func, select

from database.connection import get_db_session
from database.models import AssistantTurnDB
from schemas.assistant_turns import AssistantTurnRead, AssistantTurnUpsert

logger = logging.getLogger(__name__)

LEGAL_TRANSITIONS = {
    "queued": {"queued", "running", "canceled", "failed"},
    "running": {"running", "committing", "canceled", "failed"},
    "committing": {"committing", "completed", "failed"},
    "completed": {"completed"},
    "failed": {"failed", "queued", "running"},
    "canceled": {"canceled"},
}


def _utc_now() -> datetime:
    return datetime.utcnow()


def _loads_list(raw: Optional[str]) -> list:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    return value if isinstance(value, list) else []


def _loads_dict(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


class AssistantTurnService:
    def to_schema(self, row: AssistantTurnDB) -> AssistantTurnRead:
        return AssistantTurnRead(
            id=row.id,
            user_id=row.user_id,
            conversation_id=row.conversation_id,
            channel=row.channel,
            status=row.status,
            epoch=int(row.epoch or 0),
            sequence=int(row.sequence or 0),
            receipt_ids=_loads_list(row.receipt_ids_json),
            assistant_text=row.assistant_text,
            tool_payload=_loads_dict(row.tool_payload_json),
            error=row.error,
            created_at=row.created_at,
            updated_at=row.updated_at,
            completed_at=row.completed_at,
        )

    async def get_turn(self, user_id: str, turn_id: str) -> Optional[AssistantTurnRead]:
        async with get_db_session() as session:
            result = await session.execute(
                select(AssistantTurnDB).where(
                    AssistantTurnDB.id == turn_id,
                    AssistantTurnDB.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            return self.to_schema(row) if row else None

    async def next_sequence(self, user_id: str, conversation_id: Optional[str]) -> int:
        async with get_db_session() as session:
            query = select(func.max(AssistantTurnDB.sequence)).where(AssistantTurnDB.user_id == user_id)
            if conversation_id:
                query = query.where(AssistantTurnDB.conversation_id == conversation_id)
            result = await session.execute(query)
            current = result.scalar()
            return int(current or 0) + 1

    async def upsert_turn(self, user_id: str, payload: AssistantTurnUpsert) -> AssistantTurnRead:
        async with get_db_session() as session:
            result = await session.execute(
                select(AssistantTurnDB).where(
                    AssistantTurnDB.id == payload.id,
                    AssistantTurnDB.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            now = _utc_now()
            if row is None:
                row = AssistantTurnDB(
                    id=payload.id,
                    user_id=user_id,
                    conversation_id=payload.conversation_id,
                    channel=payload.channel,
                    status=payload.status,
                    epoch=payload.epoch,
                    sequence=payload.sequence,
                    receipt_ids_json=json.dumps(payload.receipt_ids or []),
                    assistant_text=payload.assistant_text,
                    tool_payload_json=json.dumps(payload.tool_payload) if payload.tool_payload is not None else None,
                    error=payload.error,
                    created_at=now,
                    updated_at=now,
                    completed_at=now if payload.status in {"completed", "failed", "canceled"} else None,
                )
                session.add(row)
                await session.flush()
                return self.to_schema(row)

            allowed = LEGAL_TRANSITIONS.get(row.status or "queued", set())
            if payload.status not in allowed:
                raise ValueError(f"Illegal assistant turn transition {row.status} -> {payload.status}")

            row.conversation_id = payload.conversation_id or row.conversation_id
            row.channel = payload.channel or row.channel
            row.status = payload.status
            row.epoch = payload.epoch
            if payload.sequence:
                row.sequence = payload.sequence
            row.receipt_ids_json = json.dumps(payload.receipt_ids or [])
            row.assistant_text = payload.assistant_text
            row.tool_payload_json = json.dumps(payload.tool_payload) if payload.tool_payload is not None else row.tool_payload_json
            row.error = payload.error
            row.updated_at = now
            if payload.status in {"completed", "failed", "canceled"}:
                row.completed_at = now
            elif payload.status in {"queued", "running"}:
                row.completed_at = None
            await session.flush()
            return self.to_schema(row)


assistant_turn_service = AssistantTurnService()
