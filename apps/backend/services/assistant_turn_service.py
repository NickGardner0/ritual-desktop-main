"""Durable assistant turn store."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from database.connection import get_db_session
from database.models import AIConversationDB, AIMessageDB, AssistantTurnDB
from schemas.assistant_turns import (
    AssistantTurnAccept,
    AssistantTurnCommit,
    AssistantTurnRead,
    AssistantTurnUpsert,
)

logger = logging.getLogger(__name__)

LEGAL_TRANSITIONS = {
    "queued": {"queued", "running", "canceled", "failed_retryable", "failed"},
    "running": {"running", "committing", "canceled", "failed_retryable", "failed"},
    "committing": {"committing", "completed", "failed_retryable", "failed"},
    "completed": {"completed"},
    "failed": {"failed", "queued", "running"},
    "failed_retryable": {"failed_retryable", "queued", "running"},
    "canceled": {"canceled"},
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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
            user_message_id=row.user_message_id,
            user_message_text=row.user_message_text,
            accepted_at=row.accepted_at,
            commit_version=int(row.commit_version or 0),
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

    @staticmethod
    def _validate_acceptance(
        row: AssistantTurnDB,
        user_id: str,
        payload: AssistantTurnAccept,
    ) -> None:
        if row.user_id != user_id:
            raise ValueError("Assistant turn ID is already owned by another user")
        if row.channel != payload.channel:
            raise ValueError("Assistant turn channel does not match its accepted channel")
        if int(row.epoch or 0) != payload.epoch:
            raise ValueError("Assistant turn epoch does not match its accepted epoch")
        if row.user_message_text is not None and row.user_message_text != payload.user_message:
            raise ValueError("Assistant turn user message does not match its accepted payload")
        if payload.user_message_id and row.user_message_id not in {None, payload.user_message_id}:
            raise ValueError("Assistant turn user message ID does not match its accepted payload")
        if payload.conversation_id and row.conversation_id not in {None, payload.conversation_id}:
            raise ValueError("Assistant turn conversation does not match its accepted conversation")

    async def _resolve_conversation(
        self,
        session,
        *,
        user_id: str,
        conversation_id: Optional[str],
        channel: str,
        response_mode: str,
        now: datetime,
    ) -> AIConversationDB:
        if conversation_id:
            result = await session.execute(
                select(AIConversationDB).where(AIConversationDB.id == conversation_id)
            )
            conversation = result.scalar_one_or_none()
            if conversation is None or conversation.user_id != user_id:
                raise ValueError("Conversation not found")
            return conversation

        conversation = AIConversationDB(
            id=str(uuid.uuid4()),
            user_id=user_id,
            response_mode=response_mode,
            channel="app",
            created_at=now,
            updated_at=now,
        )
        session.add(conversation)
        await session.flush()
        return conversation

    async def _persist_message_once(
        self,
        session,
        *,
        message_id: str,
        conversation_id: str,
        role: str,
        content: str,
        tool_payload: Optional[Dict[str, Any]],
        now: datetime,
    ) -> None:
        result = await session.execute(select(AIMessageDB).where(AIMessageDB.id == message_id))
        existing = result.scalar_one_or_none()
        encoded_tool_payload = json.dumps(tool_payload, sort_keys=True) if tool_payload is not None else None
        if existing is not None:
            if (
                existing.conversation_id != conversation_id
                or existing.role != role
                or existing.content != content
                or existing.tool_payload != encoded_tool_payload
            ):
                raise ValueError(f"Stable assistant message ID {message_id} has conflicting content")
            return
        session.add(
            AIMessageDB(
                id=message_id,
                conversation_id=conversation_id,
                role=role,
                content=content,
                tool_payload=encoded_tool_payload,
                created_at=now,
            )
        )

    async def _claim_or_persist_user_message(
        self,
        session,
        *,
        payload: AssistantTurnAccept,
        conversation_id: str,
        now: datetime,
    ) -> str:
        if not payload.record_user_message_in_conversation:
            return f"{payload.id}:accepted"
        message_id = payload.user_message_id or f"{payload.id}:user"
        if payload.user_message_id:
            result = await session.execute(
                select(AIMessageDB).where(AIMessageDB.id == payload.user_message_id)
            )
            existing = result.scalar_one_or_none()
            if (
                existing is None
                or existing.conversation_id != conversation_id
                or existing.role != "user"
                or existing.content != payload.user_message
            ):
                raise ValueError("Accepted user message does not match the durable conversation message")
            return message_id
        await self._persist_message_once(
            session,
            message_id=message_id,
            conversation_id=conversation_id,
            role="user",
            content=payload.user_message,
            tool_payload=None,
            now=now,
        )
        return message_id

    async def accept_turn(self, user_id: str, payload: AssistantTurnAccept) -> AssistantTurnRead:
        """Atomically claim a stable turn and persist its user message before execution."""
        async with get_db_session() as session:
            result = await session.execute(
                select(AssistantTurnDB).where(AssistantTurnDB.id == payload.id)
            )
            row = result.scalar_one_or_none()
            now = _utc_now()
            if row is not None:
                self._validate_acceptance(row, user_id, payload)
                if row.accepted_at is not None:
                    return self.to_schema(row)
                conversation = await self._resolve_conversation(
                    session,
                    user_id=user_id,
                    conversation_id=row.conversation_id or payload.conversation_id,
                    channel=payload.channel,
                    response_mode=payload.response_mode,
                    now=now,
                )
                row.conversation_id = conversation.id
                row.user_message_id = await self._claim_or_persist_user_message(
                    session,
                    payload=payload,
                    conversation_id=conversation.id,
                    now=now,
                )
                row.user_message_text = payload.user_message
                row.accepted_at = now
                row.updated_at = now
                conversation.updated_at = now
                await session.commit()
                return self.to_schema(row)

            conversation = await self._resolve_conversation(
                session,
                user_id=user_id,
                conversation_id=payload.conversation_id,
                channel=payload.channel,
                response_mode=payload.response_mode,
                now=now,
            )
            sequence_result = await session.execute(
                select(func.max(AssistantTurnDB.sequence)).where(
                    AssistantTurnDB.user_id == user_id,
                    AssistantTurnDB.conversation_id == conversation.id,
                )
            )
            user_message_id = await self._claim_or_persist_user_message(
                session,
                payload=payload,
                conversation_id=conversation.id,
                now=now,
            )
            row = AssistantTurnDB(
                id=payload.id,
                user_id=user_id,
                conversation_id=conversation.id,
                channel=payload.channel,
                status="queued",
                epoch=payload.epoch,
                sequence=int(sequence_result.scalar() or 0) + 1,
                user_message_id=user_message_id,
                user_message_text=payload.user_message,
                accepted_at=now,
                commit_version=0,
                receipt_ids_json="[]",
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            conversation.updated_at = now
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                retry = await session.execute(
                    select(AssistantTurnDB).where(AssistantTurnDB.id == payload.id)
                )
                existing = retry.scalar_one_or_none()
                if existing is None:
                    raise
                self._validate_acceptance(existing, user_id, payload)
                if existing.accepted_at is None:
                    raise ValueError("Concurrent assistant turn acceptance did not commit")
                return self.to_schema(existing)
            return self.to_schema(row)

    async def commit_turn(
        self,
        user_id: str,
        turn_id: str,
        payload: AssistantTurnCommit,
    ) -> AssistantTurnRead:
        """Atomically persist assistant content, receipts, and terminal completion."""
        async with get_db_session() as session:
            result = await session.execute(
                select(AssistantTurnDB).where(
                    AssistantTurnDB.id == turn_id,
                    AssistantTurnDB.user_id == user_id,
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise LookupError("Assistant turn not found")
            if row.accepted_at is None or not row.user_message_id:
                raise ValueError("Assistant turn was not durably accepted")
            if int(row.epoch or 0) != payload.epoch:
                raise ValueError("Assistant turn epoch does not match its accepted epoch")

            normalized_receipts = list(dict.fromkeys(payload.receipt_ids))
            if row.status == "completed":
                if (
                    row.assistant_text != payload.assistant_text
                    or _loads_list(row.receipt_ids_json) != normalized_receipts
                    or _loads_dict(row.tool_payload_json) != payload.tool_payload
                ):
                    raise ValueError("Completed assistant turn has conflicting commit content")
                return self.to_schema(row)
            if row.status not in {"running", "committing"}:
                raise ValueError(f"Assistant turn cannot commit from {row.status}")
            if not row.conversation_id:
                raise ValueError("Accepted assistant turn has no conversation")

            now = _utc_now()
            await self._persist_message_once(
                session,
                message_id=f"{turn_id}:assistant",
                conversation_id=row.conversation_id,
                role="assistant",
                content=payload.assistant_text,
                tool_payload=payload.tool_payload,
                now=now,
            )
            row.status = "completed"
            row.assistant_text = payload.assistant_text
            row.receipt_ids_json = json.dumps(normalized_receipts)
            row.tool_payload_json = (
                json.dumps(payload.tool_payload, sort_keys=True)
                if payload.tool_payload is not None
                else None
            )
            row.error = None
            row.commit_version = int(row.commit_version or 0) + 1
            row.updated_at = now
            row.completed_at = now
            conversation_result = await session.execute(
                select(AIConversationDB).where(AIConversationDB.id == row.conversation_id)
            )
            conversation = conversation_result.scalar_one_or_none()
            if conversation is None or conversation.user_id != user_id:
                raise ValueError("Accepted assistant turn conversation is unavailable")
            conversation.updated_at = now
            await session.commit()
            return self.to_schema(row)

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
                    completed_at=now if payload.status in {"completed", "failed_retryable", "failed", "canceled"} else None,
                )
                session.add(row)
                await session.flush()
                await session.commit()
                return self.to_schema(row)

            allowed = LEGAL_TRANSITIONS.get(row.status or "queued", set())
            if payload.status not in allowed:
                raise ValueError(f"Illegal assistant turn transition {row.status} -> {payload.status}")
            if row.accepted_at is not None:
                if payload.epoch != int(row.epoch or 0):
                    raise ValueError("Assistant turn epoch cannot change after acceptance")
                if payload.channel != row.channel:
                    raise ValueError("Assistant turn channel cannot change after acceptance")
                if payload.conversation_id != row.conversation_id:
                    raise ValueError("Assistant turn conversation cannot change after acceptance")
                if payload.status == "completed":
                    raise ValueError("Durably accepted turns must use the atomic commit operation")

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
            if payload.status in {"completed", "failed_retryable", "failed", "canceled"}:
                row.completed_at = now
            elif payload.status in {"queued", "running"}:
                row.completed_at = None
            await session.flush()
            await session.commit()
            return self.to_schema(row)


assistant_turn_service = AssistantTurnService()
