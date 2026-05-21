"""Authenticated observability diagnostics."""

from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from services.sentry_observability import capture_smoke_message, capture_structured_log, set_domain_tags


class SentrySmokeRequest(BaseModel):
    surface: Optional[str] = None
    runtime: Optional[str] = None
    provider: Optional[str] = None
    sync_run_id: Optional[str] = None
    habit_id: Optional[str] = None
    desktop_version: Optional[str] = None


def create_observability_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/observability", tags=["observability"])

    @router.post("/sentry-smoke")
    async def sentry_smoke(
        payload: SentrySmokeRequest,
        current_user=Depends(get_current_user),
    ):
        set_domain_tags(
            runtime=payload.runtime or "backend",
            surface=payload.surface or "fastapi",
            provider=payload.provider,
            sync_run_id=payload.sync_run_id,
            habit_id=payload.habit_id,
            desktop_version=payload.desktop_version,
        )
        capture_smoke_message(
            "Sentry smoke test: backend",
            runtime=payload.runtime or "backend",
            surface=payload.surface or "fastapi",
            provider=payload.provider,
            sync_run_id=payload.sync_run_id,
            habit_id=payload.habit_id,
            desktop_version=payload.desktop_version,
        )
        capture_structured_log(
            "info",
            "Sentry smoke structured log: backend",
            smoke_test=True,
            runtime=payload.runtime or "backend",
            surface=payload.surface or "fastapi",
            provider=payload.provider,
            sync_run_id=payload.sync_run_id,
            habit_id=payload.habit_id,
            desktop_version=payload.desktop_version,
            user_id=current_user["id"],
        )
        return {
            "success": True,
            "message": "Backend Sentry smoke event queued",
            "user_id": current_user["id"],
        }

    return router
