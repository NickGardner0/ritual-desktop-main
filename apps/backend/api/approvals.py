"""
API router for approval queue visibility.
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends

from schemas.workflows import ApprovalListResponse
from services.workflow_service import workflow_service


def create_approvals_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/approvals", tags=["approvals"])

    @router.get("", response_model=ApprovalListResponse)
    async def get_approvals(current_user=Depends(get_current_user)):
        return await workflow_service.list_approvals(current_user["id"])

    return router
