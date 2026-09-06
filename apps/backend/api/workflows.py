"""
API router for workflow definitions and runs.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from schemas.workflows import (
    WorkflowDefinitionCreate,
    WorkflowDefinitionListResponse,
    WorkflowDefinitionRead,
    WorkflowDefinitionUpdate,
    WorkflowRunDetailRead,
    WorkflowRunListResponse,
    WorkflowRunQueueResponse,
)
from services.workflow_service import (
    WorkflowNotFoundError,
    WorkflowValidationError,
    workflow_service,
)


def create_workflows_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/workflows", tags=["workflows"])

    @router.get("/definitions", response_model=WorkflowDefinitionListResponse)
    async def get_workflow_definitions(current_user=Depends(get_current_user)):
        return await workflow_service.list_definitions(
            current_user["id"],
            timezone_name=current_user.get("timezone"),
        )

    @router.post("/definitions", response_model=WorkflowDefinitionRead)
    async def create_workflow_definition(
        payload: WorkflowDefinitionCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await workflow_service.create_definition(
                user_id=current_user["id"],
                timezone_name=current_user.get("timezone"),
                payload=payload,
            )
        except WorkflowValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.patch("/definitions/{definition_id}", response_model=WorkflowDefinitionRead)
    async def patch_workflow_definition(
        definition_id: str,
        payload: WorkflowDefinitionUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await workflow_service.update_definition(
                user_id=current_user["id"],
                definition_id=definition_id,
                timezone_name=current_user.get("timezone"),
                payload=payload,
            )
        except WorkflowNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except WorkflowValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.post("/definitions/{definition_id}/run", response_model=WorkflowRunQueueResponse)
    async def run_workflow_definition(definition_id: str, current_user=Depends(get_current_user)):
        try:
            return await workflow_service.queue_manual_run(
                user_id=current_user["id"],
                definition_id=definition_id,
                timezone_name=current_user.get("timezone"),
            )
        except WorkflowNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/runs", response_model=WorkflowRunListResponse)
    async def get_workflow_runs(
        definition_id: Optional[str] = Query(default=None),
        limit: int = Query(default=20, ge=1, le=100),
        current_user=Depends(get_current_user),
    ):
        return await workflow_service.list_runs(
            user_id=current_user["id"],
            definition_id=definition_id,
            limit=limit,
        )

    @router.get("/runs/{run_id}", response_model=WorkflowRunDetailRead)
    async def get_workflow_run(run_id: str, current_user=Depends(get_current_user)):
        run = await workflow_service.get_run(user_id=current_user["id"], run_id=run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Workflow run not found")
        return run

    return router
