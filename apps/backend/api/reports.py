"""
API router for Ritual's scheduled report pipeline.
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Query

from schemas.reports import (
    HabitReportBlueprintResponse,
    HabitReportDispatchResponse,
    HabitReportRunListResponse,
    HabitReportScheduleCreate,
    HabitReportScheduleListResponse,
    HabitReportScheduleRead,
    HabitReportScheduleUpdate,
)
from services.reports_service import reports_service


def create_reports_router(
    *,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/reports", tags=["reports"])

    @router.get("/schedules", response_model=HabitReportScheduleListResponse)
    async def get_report_schedules(current_user=Depends(get_current_user)):
        schedules = await reports_service.list_schedules(
            current_user["id"],
            email=current_user.get("email"),
            timezone_name=current_user.get("timezone"),
        )
        return HabitReportScheduleListResponse(schedules=schedules)

    @router.post("/schedules", response_model=HabitReportScheduleRead)
    async def create_report_schedule(
        payload: HabitReportScheduleCreate,
        current_user=Depends(get_current_user),
    ):
        return await reports_service.create_schedule(
            user_id=current_user["id"],
            email=current_user.get("email"),
            timezone_name=current_user.get("timezone"),
            payload=payload,
        )

    @router.patch("/schedules/{schedule_id}", response_model=HabitReportScheduleRead)
    async def update_report_schedule(
        schedule_id: str,
        payload: HabitReportScheduleUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await reports_service.update_schedule(
                user_id=current_user["id"],
                schedule_id=schedule_id,
                payload=payload,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/schedules/{schedule_id}/dispatch", response_model=HabitReportDispatchResponse)
    async def dispatch_report_schedule(
        schedule_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            return await reports_service.dispatch_schedule(
                user_id=current_user["id"],
                schedule_id=schedule_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/runs", response_model=HabitReportRunListResponse)
    async def get_report_runs(
        limit: int = Query(default=12, ge=1, le=50),
        current_user=Depends(get_current_user),
    ):
        runs = await reports_service.list_runs(current_user["id"], limit=limit)
        return HabitReportRunListResponse(runs=runs)

    @router.get("/blueprint", response_model=HabitReportBlueprintResponse)
    async def get_report_blueprint(current_user=Depends(get_current_user)):
        _ = current_user
        return HabitReportBlueprintResponse()

    return router
