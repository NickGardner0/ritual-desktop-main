"""Authenticated observability diagnostics."""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from services.sentry_observability import capture_smoke_message, capture_structured_log, set_domain_tags


class SentrySmokeRequest(BaseModel):
    surface: Optional[str] = None
    runtime: Optional[str] = None
    provider: Optional[str] = None
    sync_run_id: Optional[str] = None
    habit_id: Optional[str] = None
    desktop_version: Optional[str] = None


async def _parse_sentry_smoke_payload(request: Request) -> SentrySmokeRequest:
    try:
        raw_body = await request.json()
    except Exception:
        raw_body = {}

    if isinstance(raw_body, str):
        try:
            raw_body = json.loads(raw_body or "{}")
        except json.JSONDecodeError:
            raw_body = {}

    if not isinstance(raw_body, dict):
        raw_body = {}

    return SentrySmokeRequest(**raw_body)


def create_observability_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/observability", tags=["observability"])

    @router.post("/sentry-smoke")
    async def sentry_smoke(
        request: Request,
        current_user=Depends(get_current_user),
    ):
        payload = await _parse_sentry_smoke_payload(request)
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
