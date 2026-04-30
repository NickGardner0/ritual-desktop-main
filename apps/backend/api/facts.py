"""
API router for approved and pending AI facts.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from schemas.facts import AiFactCreate, AiFactEventListResponse, AiFactListResponse, AiFactRead, AiFactUpdate
from services.fact_service import fact_service


def create_facts_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/ai-facts", tags=["ai-facts"])

    @router.get("", response_model=AiFactListResponse)
    async def get_facts(
        status: Optional[str] = Query(default=None),
        category: Optional[str] = Query(default=None),
        current_user=Depends(get_current_user),
    ):
        return await fact_service.list_facts(current_user["id"], status=status, category=category)

    @router.post("", response_model=AiFactRead)
    async def create_fact(payload: AiFactCreate, current_user=Depends(get_current_user)):
        return await fact_service.create_fact(current_user["id"], payload)

    @router.patch("/{fact_id}", response_model=AiFactRead)
    async def patch_fact(fact_id: str, payload: AiFactUpdate, current_user=Depends(get_current_user)):
        fact = await fact_service.update_fact(current_user["id"], fact_id, payload)
        if fact is None:
            raise HTTPException(status_code=404, detail="Fact not found")
        return fact

    @router.post("/{fact_id}/approve", response_model=AiFactRead)
    async def approve_fact(fact_id: str, current_user=Depends(get_current_user)):
        fact = await fact_service.approve_fact(current_user["id"], fact_id)
        if fact is None:
            raise HTTPException(status_code=404, detail="Fact not found")
        return fact

    @router.post("/{fact_id}/dismiss", response_model=AiFactRead)
    async def dismiss_fact(fact_id: str, current_user=Depends(get_current_user)):
        fact = await fact_service.dismiss_fact(current_user["id"], fact_id)
        if fact is None:
            raise HTTPException(status_code=404, detail="Fact not found")
        return fact

    @router.get("/{fact_id}/events", response_model=AiFactEventListResponse)
    async def get_fact_events(fact_id: str, current_user=Depends(get_current_user)):
        return await fact_service.list_events(current_user["id"], fact_id)

    return router
