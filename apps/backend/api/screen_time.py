"""Screen Time aggregate analytics and ingest endpoints."""

from datetime import datetime, timedelta
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException


def create_screen_time_router(
    *,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    from schemas.screen_time import (
        ScreenTimeDeviceRegisterRequest,
        ScreenTimeDeviceRegisterResponse,
        ScreenTimeIngestRequest,
        ScreenTimeIngestResponse,
        ScreenTimeSummaryResponse,
    )
    from services.screen_time_service import screen_time_service

    router = APIRouter(tags=["screen-time"])

    @router.post(
        "/api/screen-time/register_device",
        response_model=ScreenTimeDeviceRegisterResponse,
    )
    async def register_screen_time_device(
        request: ScreenTimeDeviceRegisterRequest,
        current_user=Depends(get_current_user),
    ):
        device_id, device_secret = await screen_time_service.register_device(
            current_user["id"],
            request.device_name,
            request.platform,
        )
        return ScreenTimeDeviceRegisterResponse(
            device_id=device_id,
            device_secret=device_secret,
            registered_at=datetime.utcnow().isoformat(),
        )

    @router.post(
        "/api/screen-time/ingest",
        response_model=ScreenTimeIngestResponse,
    )
    async def ingest_screen_time_rollups(
        request: ScreenTimeIngestRequest,
        current_user=Depends(get_current_user),
    ):
        success, results, error = await screen_time_service.ingest_rollups(current_user["id"], request)
        if error and not success:
            raise HTTPException(status_code=400, detail=error)
        return ScreenTimeIngestResponse(
            success=success,
            results=results,
            server_time=datetime.utcnow().isoformat(),
        )

    @router.get(
        "/api/screen-time/stats/summary",
        response_model=ScreenTimeSummaryResponse,
    )
    async def get_screen_time_summary(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        current_user=Depends(get_current_user),
    ):
        today = datetime.now().strftime("%Y-%m-%d")
        start = start_date or today
        end = end_date or today
        data = await screen_time_service.get_summary(current_user["id"], start, end)
        return ScreenTimeSummaryResponse(success=True, data=data)

    @router.get("/api/screen-time/stats/top-apps")
    async def get_screen_time_top_apps(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: Optional[int] = 30,
        limit: int = 10,
        current_user=Depends(get_current_user),
    ):
        today = datetime.now()
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        data = await screen_time_service.get_top_items(
            current_user["id"],
            start,
            end,
            kind="app",
            limit=limit,
        )
        return {"success": True, "data": data, "start_date": start, "end_date": end}

    @router.get("/api/screen-time/stats/top-domains")
    async def get_screen_time_top_domains(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: Optional[int] = 30,
        limit: int = 10,
        current_user=Depends(get_current_user),
    ):
        today = datetime.now()
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        data = await screen_time_service.get_top_items(
            current_user["id"],
            start,
            end,
            kind="website",
            limit=limit,
        )
        return {"success": True, "data": data, "start_date": start, "end_date": end}

    @router.get("/api/screen-time/breakdown")
    async def get_screen_time_breakdown(
        kind: str,
        key: str,
        start_date: str,
        end_date: str,
        current_user=Depends(get_current_user),
    ):
        if kind not in {"app", "website"}:
            raise HTTPException(status_code=400, detail="Invalid kind, must be 'app' or 'website'")
        rows = await screen_time_service.get_daily_breakdown(
            current_user["id"],
            kind,
            key,
            start_date,
            end_date,
        )
        return {"success": True, "data": rows, "start_date": start_date, "end_date": end_date}

    return router
