"""Shared Sendblue outbound messaging helpers."""

import logging
import os
import re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

SENDBLUE_API_KEY = os.getenv("SENDBLUE_API_KEY", "")
SENDBLUE_API_SECRET = os.getenv("SENDBLUE_API_SECRET", "")
SENDBLUE_API_BASE = "https://api.sendblue.co"
SENDBLUE_FROM_NUMBER = os.getenv("SENDBLUE_FROM_NUMBER", "")


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


def _sendblue_headers() -> dict:
    return {
        "sb-api-key-id": SENDBLUE_API_KEY,
        "sb-api-secret-key": SENDBLUE_API_SECRET,
        "Content-Type": "application/json",
    }


async def send_message(phone_number: str, text: str) -> bool:
    """Send a message to a phone number via Sendblue."""
    if not SENDBLUE_API_KEY or not SENDBLUE_API_SECRET:
        logger.warning("SENDBLUE_API_KEY/SECRET not set — cannot send message")
        return False

    normalized = _normalize_phone_number(phone_number)
    if not normalized:
        logger.warning("Missing normalized phone number for Sendblue message")
        return False

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{SENDBLUE_API_BASE}/api/send-message",
                headers=_sendblue_headers(),
                json={
                    "number": normalized,
                    "content": text,
                    "from_number": _normalize_phone_number(SENDBLUE_FROM_NUMBER),
                },
            )
        if response.status_code in (200, 201):
            logger.info("Sendblue message sent to %s", normalized)
            return True
        logger.error("Sendblue message failed (%s): %s", response.status_code, response.text)
        return False
    except Exception as exc:
        logger.error("Error sending Sendblue message: %s", exc)
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
    return await send_message(
        phone_number=phone_number,
        text=build_onboarding_welcome_text(first_name),
    )
