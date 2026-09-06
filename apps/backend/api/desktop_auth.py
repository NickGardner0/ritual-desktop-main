"""Channel-bound desktop authentication handoff API."""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException

from schemas.desktop_auth import (
    DesktopAuthHandoffAcknowledge,
    DesktopAuthHandoffClaimFailure,
    DesktopAuthHandoffConsume,
    DesktopAuthHandoffConsumeRead,
    DesktopAuthHandoffCreate,
    DesktopAuthHandoffRead,
)
from services.desktop_auth_handoff_service import desktop_auth_handoff_service


def create_desktop_auth_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/desktop-auth/handoffs", tags=["desktop-auth"])

    @router.post("", response_model=DesktopAuthHandoffRead)
    async def create_desktop_auth_handoff(
        payload: DesktopAuthHandoffCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await desktop_auth_handoff_service.create(current_user["id"], payload)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.get("/{handoff_id}", response_model=DesktopAuthHandoffRead)
    async def get_desktop_auth_handoff(
        handoff_id: str,
        current_user=Depends(get_current_user),
    ):
        handoff = await desktop_auth_handoff_service.get(current_user["id"], handoff_id)
        if handoff is None:
            raise HTTPException(status_code=404, detail="Desktop authentication handoff not found")
        return handoff

    @router.post("/{handoff_id}/consume", response_model=DesktopAuthHandoffConsumeRead)
    async def consume_desktop_auth_handoff(
        handoff_id: str,
        payload: DesktopAuthHandoffConsume,
    ):
        try:
            return await desktop_auth_handoff_service.consume(handoff_id, payload)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.post("/{handoff_id}/acknowledge", response_model=DesktopAuthHandoffRead)
    async def acknowledge_desktop_auth_handoff(
        handoff_id: str,
        payload: DesktopAuthHandoffAcknowledge,
        current_user=Depends(get_current_user),
    ):
        try:
            return await desktop_auth_handoff_service.acknowledge(
                current_user["id"], handoff_id, payload
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.post("/{handoff_id}/claim-failed", response_model=DesktopAuthHandoffRead)
    async def fail_desktop_auth_handoff_claim(
        handoff_id: str,
        payload: DesktopAuthHandoffClaimFailure,
    ):
        try:
            return await desktop_auth_handoff_service.fail_claim(handoff_id, payload)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    return router
