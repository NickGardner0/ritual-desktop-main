"""Authenticated operational scheduler health."""

import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from schemas.scheduler import SchedulerHealthResponse
from services.scheduler_service import scheduler_runtime


INTERNAL_BACKEND_TOKEN = os.getenv("INTERNAL_BACKEND_TOKEN", "")


def create_scheduler_router() -> APIRouter:
    router = APIRouter()

    @router.get(
        "/api/internal/scheduler/health",
        response_model=SchedulerHealthResponse,
        responses={503: {"model": SchedulerHealthResponse}},
    )
    async def scheduler_health(request: Request):
        authorization = request.headers.get("authorization", "")
        bearer = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
        supplied = request.headers.get("x-backend-token", "") or bearer
        if not INTERNAL_BACKEND_TOKEN or supplied != INTERNAL_BACKEND_TOKEN:
            raise HTTPException(status_code=401, detail="Unauthorized")

        snapshot = await scheduler_runtime.health_snapshot(
            getattr(request.app.state, "scheduler_tasks", {})
        )
        return JSONResponse(
            snapshot,
            status_code=200 if snapshot["status"] == "healthy" else 503,
        )

    return router
