"""Sendblue-specific low-level outbound helpers."""

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


async def send_message(
    phone_number: str,
    text: str,
    media_url: Optional[str] = None,
) -> bool:
    """Send a message to a phone number via Sendblue."""
    if not SENDBLUE_API_KEY or not SENDBLUE_API_SECRET:
        logger.warning("SENDBLUE_API_KEY/SECRET not set — cannot send message")
        return False

    normalized = _normalize_phone_number(phone_number)
    if not normalized:
        logger.warning("Missing normalized phone number for Sendblue message")
        return False

    payload: dict = {
        "number": normalized,
        "content": text,
        "from_number": _normalize_phone_number(SENDBLUE_FROM_NUMBER),
    }
    if media_url:
        payload["media_url"] = media_url

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{SENDBLUE_API_BASE}/api/send-message",
                headers=_sendblue_headers(),
                json=payload,
            )
        if response.status_code in (200, 201, 202):
            logger.info("Sendblue message sent to %s", normalized)
            return True
        logger.error("Sendblue message failed (%s): %s", response.status_code, response.text)
        return False
    except Exception as exc:
        logger.error("Error sending Sendblue message: %s", exc)
        return False


BACKEND_PUBLIC_URL = os.getenv("BACKEND_PUBLIC_URL", "")


def get_ritual_vcard_url() -> Optional[str]:
    """Return the public vCard URL when the backend is publicly reachable."""
    if not BACKEND_PUBLIC_URL:
        return None
    return f"{BACKEND_PUBLIC_URL.rstrip('/')}/api/contact/ritual.vcf"
