"""API router for durable assistant turns."""

from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from schemas.assistant_turns import (
    AssistantTurnAccept,
    AssistantTurnCommit,
    AssistantTurnRead,
    AssistantTurnSequenceRead,
    AssistantTurnUpsert,
)
from services.assistant_turn_service import assistant_turn_service


def create_assistant_turns_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/assistant-turns", tags=["assistant-turns"])

    @router.get("/next-sequence", response_model=AssistantTurnSequenceRead)
    async def next_assistant_turn_sequence(
        conversation_id: Optional[str] = Query(default=None),
        current_user=Depends(get_current_user),
    ):
        sequence = await assistant_turn_service.next_sequence(current_user["id"], conversation_id)
        return AssistantTurnSequenceRead(sequence=sequence)

    @router.post("/accept", response_model=AssistantTurnRead)
    async def accept_assistant_turn(
        payload: AssistantTurnAccept,
        current_user=Depends(get_current_user),
    ):
        try:
            return await assistant_turn_service.accept_turn(current_user["id"], payload)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.post("/{turn_id}/commit", response_model=AssistantTurnRead)
    async def commit_assistant_turn(
        turn_id: str,
        payload: AssistantTurnCommit,
        current_user=Depends(get_current_user),
    ):
        try:
            return await assistant_turn_service.commit_turn(current_user["id"], turn_id, payload)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.get("/{turn_id}", response_model=AssistantTurnRead)
    async def get_assistant_turn(turn_id: str, current_user=Depends(get_current_user)):
        turn = await assistant_turn_service.get_turn(current_user["id"], turn_id)
        if not turn:
            raise HTTPException(status_code=404, detail="Assistant turn not found")
        return turn

    @router.post("", response_model=AssistantTurnRead)
    async def upsert_assistant_turn(payload: AssistantTurnUpsert, current_user=Depends(get_current_user)):
        try:
            return await assistant_turn_service.upsert_turn(current_user["id"], payload)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    return router
