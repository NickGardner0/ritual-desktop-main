"""Conversation API router extracted from main.py."""

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from schemas.artifacts import ArtifactDetailRead
from schemas.conversation_queue import (
    ConversationQueueCreate,
    ConversationQueueListResponse,
    ConversationQueueRunResponse,
    ConversationQueueUpdate,
)
from services.artifact_service import artifact_service
from services.conversation_service import conversation_service
from services.conversation_queue_service import conversation_queue_service

logger = logging.getLogger(__name__)


class MessageCreate(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str
    tool_payload: Optional[dict] = None


class ResponseModeUpdate(BaseModel):
    response_mode: str  # 'text' or 'voice'


class ConversationArtifactCreate(BaseModel):
    title: str
    summary: Optional[str] = None
    body: dict
    kind: str = "conversation_brief"


def create_conversations_router(
    *,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    """Build conversation router with injected auth dependency."""
    router = APIRouter(tags=["conversations"])

    @router.post("/api/conversations")
    async def create_conversation(current_user=Depends(get_current_user)):
        try:
            return await conversation_service.create_conversation(current_user["id"])
        except Exception as e:
            logger.error("Error creating conversation: %s", str(e))
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/conversations/latest")
    async def get_latest_conversation(current_user=Depends(get_current_user)):
        try:
            return await conversation_service.get_latest_conversation(current_user["id"])
        except Exception as e:
            logger.error("Error getting latest conversation: %s", str(e))
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/conversations/{conversation_id}")
    async def get_conversation(
        conversation_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            conversation = await conversation_service.get_conversation(
                conversation_id,
                current_user["id"],
            )
            if not conversation:
                raise HTTPException(status_code=404, detail="Conversation not found")
            return conversation
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error getting conversation: %s", str(e))
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/api/conversations/{conversation_id}/messages")
    async def add_message(
        conversation_id: str,
        message_data: MessageCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            message = await conversation_service.add_message(
                conversation_id=conversation_id,
                user_id=current_user["id"],
                role=message_data.role,
                content=message_data.content,
                tool_payload=message_data.tool_payload,
            )
            if not message:
                raise HTTPException(status_code=404, detail="Conversation not found")
            return message
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error adding message: %s", str(e))
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.delete("/api/conversations/{conversation_id}")
    async def delete_conversation(
        conversation_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            deleted = await conversation_service.delete_conversation(
                conversation_id,
                current_user["id"],
            )
            if not deleted:
                raise HTTPException(status_code=404, detail="Conversation not found")
            return {"success": True}
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error deleting conversation: %s", str(e))
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/conversations")
    async def list_conversations(
        limit: int = 20,
        current_user=Depends(get_current_user),
    ):
        try:
            conversations = await conversation_service.list_conversations(
                current_user["id"],
                limit=limit,
            )
            return {"conversations": conversations}
        except Exception as e:
            logger.error("Error listing conversations: %s", str(e))
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.patch("/api/conversations/{conversation_id}/response-mode")
    async def update_conversation_response_mode(
        conversation_id: str,
        update: ResponseModeUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            if update.response_mode not in ("text", "voice"):
                raise HTTPException(status_code=400, detail="response_mode must be 'text' or 'voice'")

            result = await conversation_service.update_response_mode(
                conversation_id,
                current_user["id"],
                update.response_mode,
            )
            if not result:
                raise HTTPException(status_code=404, detail="Conversation not found")
            return result
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error updating response mode: %s", str(e))
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/api/conversations/{conversation_id}/artifacts", response_model=ArtifactDetailRead)
    async def create_conversation_artifact(
        conversation_id: str,
        payload: ConversationArtifactCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            conversation = await conversation_service.get_conversation(conversation_id, current_user["id"])
            if not conversation:
                raise HTTPException(status_code=404, detail="Conversation not found")
            return await artifact_service.create_conversation_artifact(
                user_id=current_user["id"],
                conversation_id=conversation_id,
                title=payload.title,
                summary=payload.summary,
                body=payload.body,
                kind=payload.kind,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error creating conversation artifact: %s", str(e))
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/conversations/{conversation_id}/queue", response_model=ConversationQueueListResponse)
    async def get_conversation_queue(conversation_id: str, current_user=Depends(get_current_user)):
        return await conversation_queue_service.list_items(current_user["id"], conversation_id)

    @router.post("/api/conversations/{conversation_id}/queue", response_model=ConversationQueueRunResponse)
    async def create_conversation_queue_item(
        conversation_id: str,
        payload: ConversationQueueCreate,
        current_user=Depends(get_current_user),
    ):
        item = await conversation_queue_service.create_item(current_user["id"], conversation_id, payload)
        if item is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return ConversationQueueRunResponse(item=item, stale=False)

    @router.patch("/api/conversations/{conversation_id}/queue/{item_id}", response_model=ConversationQueueRunResponse)
    async def patch_conversation_queue_item(
        conversation_id: str,
        item_id: str,
        payload: ConversationQueueUpdate,
        current_user=Depends(get_current_user),
    ):
        item = await conversation_queue_service.update_item(current_user["id"], conversation_id, item_id, payload)
        if item is None:
            raise HTTPException(status_code=404, detail="Queued prompt not found")
        return ConversationQueueRunResponse(item=item, stale=False)

    @router.post("/api/conversations/{conversation_id}/queue/{item_id}/run", response_model=ConversationQueueRunResponse)
    async def run_conversation_queue_item(
        conversation_id: str,
        item_id: str,
        current_user=Depends(get_current_user),
    ):
        result = await conversation_queue_service.claim_next_item(current_user["id"], conversation_id, item_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Queued prompt not found")
        return result

    return router
