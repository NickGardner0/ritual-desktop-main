"""
API router for action profiles.
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException

from schemas.workflows import ActionProfileListResponse, ActionProfileRead, ActionProfileUpdate
from services.workflow_service import workflow_service


def create_action_profiles_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/action-profiles", tags=["action-profiles"])

    @router.get("", response_model=ActionProfileListResponse)
    async def get_action_profiles(current_user=Depends(get_current_user)):
        return await workflow_service.list_action_profiles(current_user["id"])

    @router.patch("/{profile_id}", response_model=ActionProfileRead)
    async def patch_action_profile(profile_id: str, payload: ActionProfileUpdate, current_user=Depends(get_current_user)):
        profile = await workflow_service.update_action_profile(
            user_id=current_user["id"],
            profile_id=profile_id,
            payload=payload,
        )
        if profile is None:
            raise HTTPException(status_code=404, detail="Action profile not found")
        return profile

    return router
