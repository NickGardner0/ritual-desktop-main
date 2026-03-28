"""Shared Linq outbound messaging helpers."""

import logging
import os
import re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

LINQ_API_KEY = os.getenv("LINQ_API_KEY", "")
LINQ_API_BASE = "https://api.linqapp.com/api/partner"
LINQ_FROM_NUMBER = os.getenv("LINQ_FROM_NUMBER", "")


def _normalize_phone_number(phone_number: Optional[str]) -> Optional[str]:
    if not phone_number:
        return None

    value = phone_number.strip()
    if not value:
        return None

    digits = re.sub(r"\D", "", value)
    if not digits:
        return value

    if value.startswith("+"):
        return f"+{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    if len(digits) == 10:
        return f"+1{digits}"
    return digits


async def send_linq_reply(chat_id: str, text: str) -> bool:
    """Send a reply message into an existing Linq chat."""
    if not LINQ_API_KEY:
        logger.warning("LINQ_API_KEY not set — cannot send Linq reply")
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
        logger.error("Linq reply failed (%s): %s", response.status_code, response.text)
        return False
    except Exception as exc:
        logger.error("Error sending Linq reply: %s", exc)
        return False


async def send_linq_message(phone_number: str, text: str, display_name: Optional[str] = None) -> bool:
    """Start or continue a chat by sending a message to a phone number via Linq."""
    if not LINQ_API_KEY:
        logger.warning("LINQ_API_KEY not set — cannot send outbound Linq message")
        return False
    if not LINQ_FROM_NUMBER:
        logger.warning("LINQ_FROM_NUMBER not set — cannot send outbound Linq message")
        return False

    normalized_to = _normalize_phone_number(phone_number)
    normalized_from = _normalize_phone_number(LINQ_FROM_NUMBER)
    if not normalized_to or not normalized_from:
        logger.warning("Missing normalized Linq phone numbers for outbound message")
        return False

    body = {
        "from": normalized_from,
        "to": [normalized_to],
        "message": {
            "parts": [{"type": "text", "value": text}],
        },
    }
    if display_name:
        body["display_name"] = display_name

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{LINQ_API_BASE}/v3/chats",
                headers={
                    "Authorization": f"Bearer {LINQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
        if response.status_code in (200, 201):
            logger.info("Linq outbound message sent to %s", normalized_to)
            return True
        logger.error("Linq outbound message failed (%s): %s", response.status_code, response.text)
        return False
    except Exception as exc:
        logger.error("Error sending outbound Linq message: %s", exc)
        return False


def build_onboarding_welcome_text(first_name: Optional[str] = None) -> str:
    greeting = f"Welcome to Ritual, {first_name}." if first_name else "Welcome to Ritual."
    return (
        f"{greeting} You can log habits by texting this number things like "
        "\"30mg caffeine\", \"45 min workout\", or \"5 miles walk\". "
        "In the app, use Chat to ask questions about your activity, Overview and Metrics to review trends, "
        "and Integrations to connect sources like Whoop and Oura."
    )


async def send_onboarding_welcome(phone_number: str, full_name: Optional[str] = None) -> bool:
    first_name = (full_name or "").strip().split(" ")[0] or None
    return await send_linq_message(
        phone_number=phone_number,
        text=build_onboarding_welcome_text(first_name),
        display_name="Ritual",
    )
