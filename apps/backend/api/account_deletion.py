"""Authenticated account deletion and verified Clerk webhook routes."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable, Dict

from fastapi import APIRouter, Depends, HTTPException, Request

from services.account_deletion_service import (
    delete_clerk_identity,
    process_account_deletion,
)


logger = logging.getLogger(__name__)


def verify_clerk_webhook(payload: bytes, headers: Dict[str, str]) -> Dict[str, Any]:
    secret = (os.getenv("CLERK_WEBHOOK_SIGNING_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("CLERK_WEBHOOK_SIGNING_SECRET is not configured")

    try:
        from svix.webhooks import Webhook
    except ImportError as error:
        raise RuntimeError("The svix package is required for Clerk webhooks") from error

    Webhook(secret).verify(payload, headers)
    event = json.loads(payload)
    if not isinstance(event, dict):
        raise ValueError("Clerk webhook payload was not an object")
    return event


def create_account_deletion_router(
    *,
    get_current_user: Callable[..., object],
) -> APIRouter:
    router = APIRouter(tags=["account-deletion"])

    @router.delete("/api/user/account")
    async def delete_current_account(current_user=Depends(get_current_user)):
        user_id = current_user["id"]
        try:
            clerk_receipt = await delete_clerk_identity(user_id)
            deletion_receipt = await process_account_deletion(
                user_id,
                source="authenticated_request",
            )
            return {
                "deleted": True,
                "clerk": clerk_receipt,
                **deletion_receipt,
            }
        except Exception:
            logger.exception("Authenticated account deletion failed for user %s", user_id)
            raise HTTPException(
                status_code=500,
                detail={
                    "code": "account_deletion_failed",
                    "message": "Your account could not be fully deleted. Please try again.",
                },
            )

    @router.post("/api/webhooks/clerk")
    async def clerk_webhook(request: Request):
        payload = await request.body()
        try:
            event = verify_clerk_webhook(payload, dict(request.headers))
        except RuntimeError as error:
            logger.error("Clerk webhook is unavailable: %s", error)
            raise HTTPException(status_code=503, detail=str(error))
        except Exception:
            logger.warning("Rejected invalid Clerk webhook signature", exc_info=True)
            raise HTTPException(status_code=400, detail="Invalid webhook signature.")

        event_type = str(event.get("type") or "")
        if event_type != "user.deleted":
            return {"received": True, "ignored": event_type}

        data = event.get("data") or {}
        user_id = str(data.get("id") or "").strip()
        if not user_id:
            raise HTTPException(status_code=400, detail="Deleted user id is missing.")

        event_id = request.headers.get("svix-id")
        try:
            result = await process_account_deletion(
                user_id,
                source="clerk_webhook",
                event_id=event_id,
            )
        except Exception:
            logger.exception("Clerk user.deleted processing failed for user %s", user_id)
            raise HTTPException(
                status_code=500,
                detail="Account deletion processing failed.",
            )

        if result.get("status") in {"failed", "partial"}:
            raise HTTPException(
                status_code=500,
                detail="Account deletion requires a retry.",
            )

        return {"received": True, **result}

    return router
