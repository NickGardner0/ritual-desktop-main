"""API router for Tasks and Routines."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from schemas.tasks import (
    RoutineCreate,
    RoutineGenerateResponse,
    RoutineListResponse,
    RoutinePreviewRequest,
    RoutinePreviewResponse,
    RoutineRunRead,
    RoutineUpdate,
    TaskCreate,
    TaskListResponse,
    TaskRead,
    TaskUpdate,
)
from services.tasks_service import (
    RoutineNotFoundError,
    TaskNotFoundError,
    TaskRoutineValidationError,
    tasks_service,
)


def create_tasks_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(tags=["tasks"])

    @router.get("/api/tasks", response_model=TaskListResponse)
    async def get_tasks(
        view: Optional[str] = Query(default=None),
        category: Optional[str] = Query(default=None),
        source: Optional[str] = Query(default=None),
        limit: int = Query(default=200, ge=1, le=500),
        current_user=Depends(get_current_user),
    ):
        return TaskListResponse(
            items=await tasks_service.list_tasks(
                current_user["id"],
                view=view,
                category=category,
                source=source,
                limit=limit,
            )
        )

    @router.post("/api/tasks", response_model=TaskRead)
    async def create_task(payload: TaskCreate, current_user=Depends(get_current_user)):
        try:
            return await tasks_service.create_task(current_user["id"], payload)
        except TaskRoutineValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.patch("/api/tasks/{task_id}", response_model=TaskRead)
    async def update_task(task_id: str, payload: TaskUpdate, current_user=Depends(get_current_user)):
        try:
            return await tasks_service.update_task(current_user["id"], task_id, payload)
        except TaskNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except TaskRoutineValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.get("/api/routines", response_model=RoutineListResponse)
    async def get_routines(current_user=Depends(get_current_user)):
        return RoutineListResponse(items=await tasks_service.list_routines(current_user["id"]))

    @router.post("/api/routines", response_model=RoutineListResponse)
    async def create_routine(payload: RoutineCreate, current_user=Depends(get_current_user)):
        try:
            routine = await tasks_service.create_routine(current_user["id"], payload)
            return RoutineListResponse(items=[routine])
        except TaskRoutineValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.patch("/api/routines/{routine_id}", response_model=RoutineListResponse)
    async def update_routine(
        routine_id: str,
        payload: RoutineUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            routine = await tasks_service.update_routine(current_user["id"], routine_id, payload)
            return RoutineListResponse(items=[routine])
        except RoutineNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except TaskRoutineValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.get("/api/routines/runs", response_model=list[RoutineRunRead])
    async def get_routine_runs(
        routine_id: Optional[str] = Query(default=None),
        limit: int = Query(default=50, ge=1, le=100),
        current_user=Depends(get_current_user),
    ):
        return await tasks_service.list_routine_runs(
            current_user["id"],
            routine_id=routine_id,
            limit=limit,
        )

    @router.post("/api/routines/preview", response_model=RoutinePreviewResponse)
    async def preview_routine(payload: RoutinePreviewRequest, current_user=Depends(get_current_user)):
        _ = current_user
        return await tasks_service.preview_routine(payload)

    @router.post("/api/routines/generate-due", response_model=RoutineGenerateResponse)
    async def generate_due_routines(
        reference_utc: Optional[datetime] = Query(default=None),
        horizon_days: int = Query(default=0, ge=0, le=90),
        current_user=Depends(get_current_user),
    ):
        return await tasks_service.generate_due_routines(
            current_user["id"],
            reference_utc=reference_utc,
            horizon_days=horizon_days,
        )

    return router
