"""
Queue follow-up prompts against persisted conversations.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

from sqlalchemy import desc, func, select, update

from database.connection import get_db_session
from database.models import AIConversationDB, AIMessageDB, ConversationQueueItemDB
from schemas.conversation_queue import (
    ConversationQueueCreate,
    ConversationQueueItemRead,
    ConversationQueueListResponse,
    ConversationQueueRunResponse,
    ConversationQueueUpdate,
)

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ConversationQueueTransitionConflict(RuntimeError):
    def __init__(self, item: ConversationQueueItemRead):
        self.item = item
        super().__init__(f"Queued prompt is already {item.status}")


class ConversationQueueService:
    def _parse_json(self, raw: Optional[str], fallback: Any) -> Any:
        if not raw:
            return fallback
        try:
            return json.loads(raw)
        except Exception:
            return fallback

    def _item_to_schema(self, item: ConversationQueueItemDB) -> ConversationQueueItemRead:
        return ConversationQueueItemRead(
            id=item.id,
            conversation_id=item.conversation_id,
            user_id=item.user_id,
            prompt_text=item.prompt_text,
            status=item.status,  # type: ignore[arg-type]
            source=item.source,  # type: ignore[arg-type]
            after_message_id=item.after_message_id,
            position=int(item.position or 0),
            auto_run=bool(item.auto_run),
            error=self._parse_json(item.error_json, None),
            started_at=item.started_at,
            completed_at=item.completed_at,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )

    async def _get_conversation(self, session, *, conversation_id: str, user_id: str) -> Optional[AIConversationDB]:
        conversation = await session.get(AIConversationDB, conversation_id)
        if conversation is None or conversation.user_id != user_id:
            return None
        return conversation

    async def _get_latest_message_id(self, session, *, conversation_id: str) -> Optional[str]:
        result = await session.execute(
            select(AIMessageDB.id)
            .where(AIMessageDB.conversation_id == conversation_id)
            .order_by(desc(AIMessageDB.created_at))
            .limit(1)
        )
        return result.scalar()

    async def list_items(self, user_id: str, conversation_id: str) -> ConversationQueueListResponse:
        async with get_db_session() as session:
            conversation = await self._get_conversation(session, conversation_id=conversation_id, user_id=user_id)
            if conversation is None:
                return ConversationQueueListResponse(items=[], auto_run_queued=False)
            result = await session.execute(
                select(ConversationQueueItemDB)
                .where(
                    ConversationQueueItemDB.user_id == user_id,
                    ConversationQueueItemDB.conversation_id == conversation_id,
                )
                .order_by(ConversationQueueItemDB.position.asc(), ConversationQueueItemDB.created_at.asc())
            )
            return ConversationQueueListResponse(
                items=[self._item_to_schema(item) for item in result.scalars().all()],
                auto_run_queued=bool(conversation.auto_run_queued),
            )

    async def create_item(self, user_id: str, conversation_id: str, payload: ConversationQueueCreate) -> Optional[ConversationQueueItemRead]:
        async with get_db_session() as session:
            conversation = await self._get_conversation(session, conversation_id=conversation_id, user_id=user_id)
            if conversation is None:
                return None
            latest_position_result = await session.execute(
                select(func.max(ConversationQueueItemDB.position)).where(
                    ConversationQueueItemDB.user_id == user_id,
                    ConversationQueueItemDB.conversation_id == conversation_id,
                )
            )
            next_position = int(latest_position_result.scalar() or 0) + 1
            item = ConversationQueueItemDB(
                id=str(uuid4()),
                conversation_id=conversation_id,
                user_id=user_id,
                prompt_text=payload.prompt_text,
                status="pending",
                source=payload.source,
                after_message_id=payload.after_message_id,
                position=next_position,
                auto_run=payload.auto_run,
                created_at=_utc_now(),
                updated_at=_utc_now(),
            )
            session.add(item)
            await session.flush()
            if payload.auto_run != conversation.auto_run_queued:
                conversation.auto_run_queued = payload.auto_run
                conversation.updated_at = _utc_now()
            await session.commit()
            return self._item_to_schema(item)

    async def update_item(self, user_id: str, conversation_id: str, item_id: str, payload: ConversationQueueUpdate) -> Optional[ConversationQueueItemRead]:
        if payload.status is not None:
            if payload.status == "running":
                claimed = await self.claim_next_item(user_id, conversation_id, item_id)
                return claimed.item if claimed else None
            expected = {
                "completed": {"running"},
                "failed": {"running"},
                "canceled": {"pending", "running"},
                "stale": {"pending", "running"},
                "pending": set(),
            }[payload.status]
            if not expected:
                current = await self.get_item(user_id, conversation_id, item_id)
                if current is None:
                    return None
                raise ConversationQueueTransitionConflict(current)
            return await self.transition_item(
                user_id,
                conversation_id,
                item_id,
                expected_statuses=expected,
                status=payload.status,
                error=payload.error,
            )
        async with get_db_session() as session:
            conversation = await self._get_conversation(session, conversation_id=conversation_id, user_id=user_id)
            if conversation is None:
                return None
            item = await session.get(ConversationQueueItemDB, item_id)
            if item is None or item.user_id != user_id or item.conversation_id != conversation_id:
                return None
            if payload.position is not None:
                item.position = payload.position
            if payload.auto_run is not None:
                item.auto_run = payload.auto_run
                conversation.auto_run_queued = payload.auto_run
            if payload.error is not None:
                item.error_json = json.dumps(payload.error)
            item.updated_at = _utc_now()
            conversation.updated_at = _utc_now()
            await session.commit()
            return self._item_to_schema(item)

    async def get_item(self, user_id: str, conversation_id: str, item_id: str) -> Optional[ConversationQueueItemRead]:
        async with get_db_session() as session:
            item = await session.get(ConversationQueueItemDB, item_id)
            if item is None or item.user_id != user_id or item.conversation_id != conversation_id:
                return None
            return self._item_to_schema(item)

    async def transition_item(
        self,
        user_id: str,
        conversation_id: str,
        item_id: str,
        *,
        expected_statuses: set[str],
        status: str,
        error: Optional[Dict[str, Any]] = None,
    ) -> Optional[ConversationQueueItemRead]:
        now = _utc_now()
        values: Dict[str, Any] = {
            "status": status,
            "updated_at": now,
            "error_json": json.dumps(error) if error is not None else None,
        }
        if status == "running":
            values.update(started_at=now, completed_at=None)
        elif status in {"completed", "canceled", "stale", "failed"}:
            values["completed_at"] = now

        async with get_db_session() as session:
            result = await session.execute(
                update(ConversationQueueItemDB)
                .where(
                    ConversationQueueItemDB.id == item_id,
                    ConversationQueueItemDB.user_id == user_id,
                    ConversationQueueItemDB.conversation_id == conversation_id,
                    ConversationQueueItemDB.status.in_(expected_statuses),
                )
                .values(**values)
                .returning(ConversationQueueItemDB)
            )
            item = result.scalar_one_or_none()
            if item is not None:
                conversation = await self._get_conversation(session, conversation_id=conversation_id, user_id=user_id)
                if conversation is not None:
                    conversation.updated_at = now
                await session.commit()
                return self._item_to_schema(item)

            current = await session.get(ConversationQueueItemDB, item_id)
            if current is None or current.user_id != user_id or current.conversation_id != conversation_id:
                return None
            raise ConversationQueueTransitionConflict(self._item_to_schema(current))

    async def claim_next_item(self, user_id: str, conversation_id: str, item_id: str) -> Optional[ConversationQueueRunResponse]:
        async with get_db_session() as session:
            conversation = await self._get_conversation(session, conversation_id=conversation_id, user_id=user_id)
            if conversation is None:
                return None
            item = await session.get(ConversationQueueItemDB, item_id)
            if item is None or item.user_id != user_id or item.conversation_id != conversation_id:
                return None
            latest_message_id = await self._get_latest_message_id(session, conversation_id=conversation_id)
            stale = bool(item.after_message_id and latest_message_id and item.after_message_id != latest_message_id)
        target = "stale" if stale else "running"
        transitioned = await self.transition_item(
            user_id,
            conversation_id,
            item_id,
            expected_statuses={"pending"},
            status=target,
            error={"message": "Conversation advanced beyond this queued prompt."} if stale else None,
        )
        if transitioned is None:
            return None
        return ConversationQueueRunResponse(item=transitioned, stale=stale)


conversation_queue_service = ConversationQueueService()
