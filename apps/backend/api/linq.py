"""Linq iMessage webhook endpoint for habit logging via text message."""

import hashlib
import hmac
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request

from models.habit_models import HabitLogCreate
from services.habits_service import HabitsService
from services.user_service import UserService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["linq"])

LINQ_WEBHOOK_SECRET = os.getenv("LINQ_WEBHOOK_SECRET", "")
LINQ_API_KEY = os.getenv("LINQ_API_KEY", "")
LINQ_API_BASE = "https://api.linqapp.com/api/partner"
LINQ_FROM_NUMBER = os.getenv("LINQ_FROM_NUMBER", "")  # Your Linq virtual number


def _verify_signature(payload_body: bytes, timestamp: str, signature: str, secret: str) -> bool:
    """
    Verify Linq webhook HMAC-SHA256 signature.
    Signature is computed over: "{timestamp}.{payload}"
    """
    if not secret:
        logger.warning("LINQ_WEBHOOK_SECRET not set — skipping signature verification")
        return True
    message = f"{timestamp}.{payload_body.decode('utf-8')}"
    expected = hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


async def _send_linq_reply(chat_id: str, text: str) -> bool:
    """Send a reply message to an existing Linq chat."""
    if not LINQ_API_KEY:
        logger.warning("LINQ_API_KEY not set — cannot send reply")
        return False
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{LINQ_API_BASE}/v3/chats/{chat_id}/messages",
                headers={
                    "Authorization": f"Bearer {LINQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "message": {
                        "parts": [{"type": "text", "value": text}],
                    }
                },
            )
            if response.status_code in (200, 201):
                logger.info("Linq reply sent to chat %s", chat_id)
                return True
            else:
                logger.error("Linq reply failed (%s): %s", response.status_code, response.text)
                return False
    except Exception as e:
        logger.error("Error sending Linq reply: %s", e)
        return False


def _parse_habit_log_from_text(text: str, habits: list) -> Optional[dict]:
    """
    Parse a freeform text message into a habit match + amount.

    Matching strategy:
    1. Try exact habit name match (case-insensitive)
    2. Try partial match (habit name appears in the message)
    3. Extract numeric amount if present

    Returns dict with 'habit_id', 'habit_name', 'amount', 'duration' or None.
    """
    text_lower = text.strip().lower()

    # Extract number from the text (e.g. "30mg caffeine" -> 30, "ran 5 miles" -> 5)
    number_match = re.search(r"(\d+(?:\.\d+)?)", text)
    amount = float(number_match.group(1)) if number_match else None

    # Try to match against habit names
    best_match = None
    best_score = 0

    for habit in habits:
        name_lower = habit.name.lower()

        # Exact match
        if text_lower == name_lower:
            return {
                "habit_id": habit.id,
                "habit_name": habit.name,
                "amount": amount,
                "unit_type": habit.unit_type,
            }

        # Habit name appears in the message
        if name_lower in text_lower:
            score = len(name_lower)
            if score > best_score:
                best_score = score
                best_match = habit

        # Message text appears in habit name (e.g. "coffee" matches "Coffee Consumption")
        words = text_lower.split()
        for word in words:
            if len(word) >= 3 and word in name_lower:
                score = len(word)
                if score > best_score:
                    best_score = score
                    best_match = habit

    if best_match:
        return {
            "habit_id": best_match.id,
            "habit_name": best_match.name,
            "amount": amount,
            "unit_type": best_match.unit_type,
        }

    return None


@router.post("/api/linq/webhook")
async def linq_webhook(request: Request):
    """
    Receive inbound messages from Linq (webhook version 2026-02-03).

    Payload structure:
    {
        "event_type": "message.received",
        "data": {
            "chat": {"id": "...", "owner_handle": {"handle": "+1..."} },
            "sender_handle": {"handle": "+1...", "is_me": false},
            "parts": [{"type": "text", "value": "30mg caffeine"}],
            ...
        }
    }
    """
    body = await request.body()

    # Verify HMAC signature per Linq docs
    timestamp = request.headers.get("X-Webhook-Timestamp", "")
    signature = request.headers.get("X-Webhook-Signature", "")
    if LINQ_WEBHOOK_SECRET and not _verify_signature(body, timestamp, signature, LINQ_WEBHOOK_SECRET):
        logger.warning("Linq webhook signature verification failed")
        raise HTTPException(status_code=401, detail="Invalid signature")

    payload = await request.json()
    event_type = payload.get("event_type", "")

    if event_type != "message.received":
        return {"status": "ok", "event": event_type}

    data = payload.get("data", {})
    chat_id = data.get("chat", {}).get("id", "")
    sender_handle = data.get("sender_handle", {})
    sender_phone = sender_handle.get("handle", "")

    # Skip messages sent by us (outbound)
    if sender_handle.get("is_me", False):
        return {"status": "ok", "skipped": "outbound"}

    # Extract text from message parts
    parts = data.get("parts", [])
    message_text = ""
    for part in parts:
        if part.get("type") == "text":
            message_text = part.get("value", "")
            break

    if not sender_phone or not message_text:
        logger.warning("Linq webhook missing sender or text")
        return {"status": "ok", "error": "missing_fields"}

    logger.info("Linq message from %s: %s", sender_phone, message_text[:100])

    # Look up user by phone number
    user_service = UserService()
    user = await user_service.get_user_by_phone(sender_phone)

    if not user:
        logger.warning("No Ritual user found for phone: %s", sender_phone)
        await _send_linq_reply(
            chat_id,
            "This phone number isn't linked to a Ritual account. "
            "Add your phone number in Ritual to start logging habits via text."
        )
        return {"status": "ok", "error": "user_not_found"}

    # Get user's habits and try to match the message
    habits_service = HabitsService()
    habits = await habits_service.get_habits(user.id)

    match = _parse_habit_log_from_text(message_text, habits)

    if not match:
        habit_names = ", ".join(h.name for h in habits[:10])
        await _send_linq_reply(
            chat_id,
            f"I couldn't match that to a habit. Try something like:\n"
            f"- \"30mg caffeine\"\n"
            f"- \"5 miles daily walk\"\n"
            f"- \"45 min morning workout\"\n\n"
            f"Your habits: {habit_names}"
        )
        return {"status": "ok", "error": "no_habit_match", "user_id": user.id}

    # Log the habit
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    log_data = HabitLogCreate(
        amount=match["amount"],
        date=today,
        completed_at=now.isoformat(),
        status="completed",
        notes=f"Logged via iMessage: {message_text}",
    )

    try:
        habit_log = await habits_service.log_habit(match["habit_id"], log_data, user.id)
        logger.info("Linq habit logged: %s for user %s", match["habit_name"], user.id)

        # Build confirmation message
        amount_str = ""
        if match["amount"] is not None:
            unit = match.get("unit_type") or ""
            amount_str = f" ({match['amount']}{' ' + unit if unit else ''})"

        await _send_linq_reply(
            chat_id,
            f"Logged {match['habit_name']}{amount_str}"
        )

        return {
            "status": "ok",
            "user_id": user.id,
            "habit_name": match["habit_name"],
            "amount": match["amount"],
            "logged": True,
        }
    except Exception as e:
        logger.error("Failed to log habit via Linq: %s", e)
        await _send_linq_reply(chat_id, "Something went wrong logging that. Try again?")
        return {"status": "ok", "error": str(e), "logged": False}
