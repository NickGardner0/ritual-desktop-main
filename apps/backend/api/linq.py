"""Linq iMessage webhook endpoint for habit logging via text message."""

import hashlib
import hmac
import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["linq"])

LINQ_WEBHOOK_SECRET = os.getenv("LINQ_WEBHOOK_SECRET", "")
LINQ_API_KEY = os.getenv("LINQ_API_KEY", "")


class LinqWebhookPayload(BaseModel):
    """Inbound message webhook from Linq."""
    event: str  # e.g. "message.received"
    chat_id: Optional[str] = None
    sender: Optional[str] = None  # phone number e.g. "+15551234567"
    text: Optional[str] = None
    timestamp: Optional[str] = None


def _verify_signature(payload_body: bytes, signature: str, secret: str) -> bool:
    """Verify Linq webhook HMAC signature."""
    if not secret:
        logger.warning("LINQ_WEBHOOK_SECRET not set — skipping signature verification")
        return True
    expected = hmac.new(secret.encode(), payload_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/api/linq/webhook")
async def linq_webhook(request: Request):
    """
    Receive inbound messages from Linq.

    Flow:
    1. Verify webhook signature
    2. Extract sender phone + message text
    3. Look up Ritual user by phone number
    4. Parse message and log habit via existing pipeline
    5. (TODO) Send confirmation reply via Linq API
    """
    body = await request.body()

    # Verify signature
    signature = request.headers.get("X-Linq-Signature", "")
    if LINQ_WEBHOOK_SECRET and not _verify_signature(body, signature, LINQ_WEBHOOK_SECRET):
        logger.warning("Linq webhook signature verification failed")
        raise HTTPException(status_code=401, detail="Invalid signature")

    payload = await request.json()
    event = payload.get("event", "")

    if event != "message.received":
        # Acknowledge non-message events
        return {"status": "ok", "event": event}

    sender_phone = payload.get("sender", "")
    message_text = payload.get("text", "")
    chat_id = payload.get("chat_id", "")

    if not sender_phone or not message_text:
        logger.warning("Linq webhook missing sender or text: %s", payload)
        return {"status": "ok", "error": "missing_fields"}

    logger.info("Linq message from %s: %s", sender_phone, message_text[:100])

    # Look up user by phone number
    # Import here to avoid circular imports with main.py singletons
    from services.user_service import UserService
    user_service = UserService()
    user = await user_service.get_user_by_phone(sender_phone)

    if not user:
        logger.warning("No Ritual user found for phone: %s", sender_phone)
        # TODO: Send reply via Linq API: "This phone number isn't linked to a Ritual account."
        return {"status": "ok", "error": "user_not_found"}

    # TODO: Parse message_text and log habit using habits_service
    # This will reuse the same natural language parsing pipeline as the "Log anything..." input.
    # Example: "30mg caffeine" -> resolve to caffeine habit, log 30mg
    #
    # from services.habits_service import HabitsService
    # habits_service = HabitsService()
    # result = await habits_service.parse_and_log(user.id, message_text)

    logger.info("Linq habit log placeholder for user %s: %s", user.id, message_text)

    # TODO: Send confirmation reply via Linq API
    # await _send_linq_reply(chat_id, f"Logged: {message_text}")

    return {
        "status": "ok",
        "user_id": user.id,
        "message": message_text,
        "logged": False,  # Will be True once habit parsing is wired up
    }
