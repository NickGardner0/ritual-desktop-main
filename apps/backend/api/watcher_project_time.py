"""Project/task time attribution API routes."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from database.connection import force_local_replica_sync
from services.project_time_service import (
    get_project_time_rollups,
    get_project_time_sessions,
    recompute_project_time,
    update_project_time_session_classification,
)
from .watcher_common import get_current_user

router = APIRouter(prefix="/project-time")


class ProjectTimeClassificationPatch(BaseModel):
    project_name: str
    task_name: str = "General"
    status: str = "active"
    apply_forward: bool = False


class ProjectTimeRecomputeRequest(BaseModel):
    start_date: str
    end_date: str


def _resolve_date_range(
    *,
    start_date: Optional[str],
    end_date: Optional[str],
    days_back: Optional[int],
) -> tuple[str, str]:
    if start_date and end_date:
        return start_date, end_date
    today = datetime.now()
    return (
        (today - timedelta(days=max(0, min(days_back or 30, 365)))).strftime("%Y-%m-%d"),
        today.strftime("%Y-%m-%d"),
    )


async def _maybe_force_fresh_read(request: Request) -> None:
    if request.headers.get("x-ritual-force-fresh") == "1":
        await force_local_replica_sync()


@router.get("/rollups")
async def get_rollups(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    group_by: str = "project",
    limit: int = 50,
    current_user=Depends(get_current_user),
):
    try:
        await _maybe_force_fresh_read(request)
        start, end = _resolve_date_range(
            start_date=start_date,
            end_date=end_date,
            days_back=days_back,
        )
        return await get_project_time_rollups(
            current_user["id"],
            start_date=start,
            end_date=end,
            group_by=group_by,
            limit=limit,
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to read project-time rollups.")


@router.get("/sessions")
async def get_sessions(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 7,
    project_key: Optional[str] = None,
    task_key: Optional[str] = None,
    limit: int = 100,
    current_user=Depends(get_current_user),
):
    try:
        await _maybe_force_fresh_read(request)
        start, end = _resolve_date_range(
            start_date=start_date,
            end_date=end_date,
            days_back=days_back,
        )
        return await get_project_time_sessions(
            current_user["id"],
            start_date=start,
            end_date=end,
            project_key=project_key,
            task_key=task_key,
            limit=limit,
        )
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to read project-time sessions.")


@router.patch("/sessions/{session_uid}/classification")
async def patch_session_classification(
    session_uid: str,
    body: ProjectTimeClassificationPatch,
    current_user=Depends(get_current_user),
):
    try:
        result = await update_project_time_session_classification(
            current_user["id"],
            session_uid=session_uid,
            project_name=body.project_name,
            task_name=body.task_name,
            status=body.status,
            apply_forward=body.apply_forward,
        )
        if not result.get("success"):
            raise HTTPException(status_code=404, detail=result.get("error") or "Session not found.")
        return result
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to update project-time classification.")


@router.post("/recompute")
async def recompute(
    body: ProjectTimeRecomputeRequest,
    current_user=Depends(get_current_user),
):
    try:
        result = await recompute_project_time(
            current_user["id"],
            start_date=body.start_date,
            end_date=body.end_date,
        )
        if not result.get("success"):
            raise HTTPException(status_code=503, detail=result.get("error") or "Recompute failed.")
        return result
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to recompute project-time data.")
