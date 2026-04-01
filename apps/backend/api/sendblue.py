"""Sendblue iMessage webhook endpoint for habit logging via text and image."""

import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional

import hmac
import httpx

from fastapi import APIRouter, HTTPException, Request

from models.habit_models import HabitLogCreate
from services.habits_service import HabitsService
from services.sendblue_service import send_message
from services.user_service import UserService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sendblue"])

SENDBLUE_WEBHOOK_SECRET = os.getenv("SENDBLUE_WEBHOOK_SECRET", "")


_UNIT_SUFFIXES = re.compile(
    r"(\d[\d,]*(?:\.\d+)?)\s*"
    r"(mg|g|kg|lb|lbs|oz|ml|l|cal|kcal|min|mins|minutes|hr|hrs|hours|h|m|mi|km|miles|steps|reps|sets)\b",
    re.IGNORECASE,
)

# Map common verb forms, abbreviations, and synonyms to their root/habit-name form.
_WORD_STEMS: dict[str, list[str]] = {
    "run": ["ran", "running", "runs", "jog", "jogged", "jogging"],
    "walk": ["walked", "walking", "walks", "hike", "hiked", "hiking"],
    "swim": ["swam", "swimming", "swims"],
    "sleep": ["slept", "sleeping", "sleeps", "nap", "napped", "napping"],
    "meditat": ["meditated", "meditating", "meditation", "meditate"],
    "workout": ["worked out", "working out", "exercise", "exercised", "exercising", "gym"],
    "read": ["reading", "reads"],
    "water": ["hydration", "hydrate", "hydrated", "drank water"],
    "caffein": ["coffee", "espresso", "latte", "cappuccino"],
    "stretch": ["stretched", "stretching", "yoga"],
    "cycl": ["biked", "biking", "cycling", "bike", "cycle", "rode"],
    "weight": ["weights", "lifting", "lifted", "lift"],
    "fast": ["fasted", "fasting"],
    "journal": ["journaled", "journaling"],
    "pray": ["prayed", "praying", "prayer"],
    "cook": ["cooked", "cooking"],
    "clean": ["cleaned", "cleaning"],
    "supplement": ["supplements", "vitamin", "vitamins"],
}

# Build reverse lookup: variant → list of stems
_VARIANT_TO_STEMS: dict[str, list[str]] = {}
for _stem, _variants in _WORD_STEMS.items():
    for _v in _variants:
        _VARIANT_TO_STEMS.setdefault(_v, []).append(_stem)
    # Also map the stem to itself
    _VARIANT_TO_STEMS.setdefault(_stem, []).append(_stem)


def _normalize_words(text: str) -> list[str]:
    """Return the original words plus any stem expansions for matching."""
    words = text.lower().split()
    expanded = []
    for word in words:
        # Strip unit suffixes glued to numbers (e.g. "30mg" → skip, not useful for name matching)
        if re.match(r"^\d", word):
            continue
        expanded.append(word)
        # Add stems so "ran" also matches habits containing "run"
        for stem in _VARIANT_TO_STEMS.get(word, []):
            if stem != word:
                expanded.append(stem)
    return expanded


def _parse_habit_log_from_text(text: str, habits: list) -> Optional[dict]:
    """
    Parse a freeform text message into a habit match + amount.

    Matching strategy (in priority order):
    1. Exact habit name match (case-insensitive)
    2. Full habit name appears in the message
    3. Message words (with stem expansion) appear in habit name or unit_type
    4. Extract numeric amount if present

    Returns dict with 'habit_id', 'habit_name', 'amount', 'unit_type' or None.
    """
    text_lower = text.strip().lower()

    # Extract number and optional unit from text (e.g. "30mg caffeine" -> 30, "3,000 steps" -> 3000)
    number_match = re.search(r"(\d[\d,]*(?:\.\d+)?)", text)
    amount = float(number_match.group(1).replace(",", "")) if number_match else None

    # Extract unit if attached to the number (e.g. "30mg", "45min")
    unit_match = _UNIT_SUFFIXES.search(text)
    parsed_unit = unit_match.group(2).lower() if unit_match else None

    # Expand message words with stems for fuzzy matching
    match_words = _normalize_words(text_lower)

    best_match = None
    best_score = 0

    for habit in habits:
        name_lower = habit.name.lower()
        unit_lower = (habit.unit_type or "").lower()
        score = 0

        # Priority 1: exact match on full text
        if text_lower == name_lower:
            return {
                "habit_id": habit.id,
                "habit_name": habit.name,
                "amount": amount,
                "unit_type": habit.unit_type,
            }

        # Priority 2: full habit name appears in the message
        if name_lower in text_lower:
            score = len(name_lower) * 3  # strong signal

        # Priority 3: individual words match habit name or unit
        name_words = set(name_lower.split())
        for word in match_words:
            if len(word) >= 3 and word in name_lower:
                score += len(word) * 2
            # Also check if a message word matches the unit_type (e.g. "miles" matches unit "Miles")
            if len(word) >= 2 and unit_lower and word in unit_lower:
                score += len(word)

        # Bonus: parsed unit matches the habit's unit_type (e.g. "mg" from "30mg" matches unit "mg" or "Milligrams")
        if parsed_unit and unit_lower:
            unit_aliases = {
                "min": "minutes", "mins": "minutes", "m": "minutes", "hr": "hours",
                "hrs": "hours", "h": "hours", "mi": "miles", "km": "kilometers",
                "mg": "milligrams", "g": "grams", "kg": "kilograms", "ml": "milliliters",
                "l": "liters", "lb": "pounds", "lbs": "pounds", "oz": "ounces",
                "cal": "calories", "kcal": "calories",
            }
            expanded_unit = unit_aliases.get(parsed_unit, parsed_unit)
            if parsed_unit in unit_lower or expanded_unit in unit_lower or unit_lower in (parsed_unit, expanded_unit):
                score += 5

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


@router.post("/api/sendblue/webhook")
async def sendblue_webhook(request: Request):
    """
    Receive inbound messages from Sendblue.

    Sendblue webhook payload (receive type):
    {
        "accountEmail": "...",
        "content": "30mg caffeine",
        "is_outbound": false,
        "status": "RECEIVED",
        "from_number": "+1...",
        "to_number": "+1...",
        "number": "+1...",
        "was_downgraded": false,
        "media_url": "...",
        "message_type": "message",
        "group_id": null,
        ...
    }
    """
    # Verify webhook secret
    if SENDBLUE_WEBHOOK_SECRET:
        incoming_secret = request.headers.get("x-webhook-secret", "")
        if not hmac.compare_digest(incoming_secret, SENDBLUE_WEBHOOK_SECRET):
            logger.warning("Sendblue webhook secret verification failed")
            raise HTTPException(status_code=401, detail="Invalid webhook secret")

    payload = await request.json()

    # Skip outbound messages (messages we sent)
    if payload.get("is_outbound", False):
        return {"status": "ok", "skipped": "outbound"}

    # Skip group messages — habit logging is 1:1 only
    if payload.get("message_type") == "group":
        return {"status": "ok", "skipped": "group_message"}

    # Skip opted-out contacts
    if payload.get("opted_out", False):
        return {"status": "ok", "skipped": "opted_out"}

    sender_phone = payload.get("from_number", "")
    message_text = payload.get("content", "")
    media_url = payload.get("media_url", "")

    if not sender_phone:
        logger.warning("Sendblue webhook missing sender phone")
        return {"status": "ok", "error": "missing_fields"}

    # Need at least text or media to process
    if not message_text and not media_url:
        logger.warning("Sendblue webhook missing both text and media")
        return {"status": "ok", "error": "missing_fields"}

    logger.info(
        "Sendblue message from %s: text=%s media=%s",
        sender_phone,
        message_text[:100] if message_text else "(none)",
        bool(media_url),
    )

    # Look up user by phone number
    user_service = UserService()
    user = await user_service.get_user_by_phone(sender_phone)

    if not user:
        logger.warning("No Ritual user found for phone: %s", sender_phone)
        await send_message(
            sender_phone,
            "This phone number isn't linked to a Ritual account. "
            "Add your phone number in Ritual to start logging habits via text."
        )
        return {"status": "ok", "error": "user_not_found"}

    # Get user's habits
    habits_service = HabitsService()
    habits = await habits_service.get_habits(user.id)

    # --- Try image analysis first if media is attached ---
    match = None
    source_label = message_text or ""

    if media_url:
        match = await _analyze_media_for_habit(media_url, habits)
        if match:
            source_label = match.get("description", source_label or "image")

    # --- Fall back to text parsing if no image match ---
    if not match and message_text:
        match = _parse_habit_log_from_text(message_text, habits)
        source_label = message_text

    if not match:
        habit_names = ", ".join(h.name for h in habits[:10])
        tip = (
            "I couldn't extract a habit from that image."
            if media_url
            else "I couldn't match that to a habit."
        )
        await send_message(
            sender_phone,
            f"{tip} Try something like:\n"
            f"- \"30mg caffeine\"\n"
            f"- \"5 miles daily walk\"\n"
            f"- \"45 min morning workout\"\n"
            f"- Or send a screenshot of your workout/health app\n\n"
            f"Your habits: {habit_names}"
        )
        return {"status": "ok", "error": "no_habit_match", "user_id": user.id}

    # --- Log the matched habit ---
    return await _log_and_confirm(
        habits_service=habits_service,
        user=user,
        match=match,
        sender_phone=sender_phone,
        source_label=source_label,
    )


_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/gif", "image/heic", "image/webp"}
_MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB


async def _analyze_media_for_habit(media_url: str, habits: list) -> Optional[dict]:
    """Download an image from Sendblue CDN and run vision analysis to extract habit data."""
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            # HEAD first to check content type and size
            head = await client.head(media_url)
            content_type = (head.headers.get("content-type") or "").split(";")[0].strip().lower()
            content_length = int(head.headers.get("content-length") or 0)

            if content_type not in _IMAGE_CONTENT_TYPES:
                logger.info("Sendblue media is not an image (%s), skipping vision analysis", content_type)
                return None

            if content_length > _MAX_IMAGE_SIZE:
                logger.warning("Sendblue media too large (%d bytes), skipping", content_length)
                return None

            # Download the image
            response = await client.get(media_url)
            response.raise_for_status()
            image_bytes = response.content

        if not image_bytes:
            return None

        # Build habits list in the format the analyzer expects
        available_habits = [
            {"id": h.id, "name": h.name, "unit_type": h.unit_type}
            for h in habits
        ]

        from services.screenshot_analyzer import analyze_screenshot_for_habits

        result = analyze_screenshot_for_habits(image_bytes, available_habits)

        if not result:
            logger.info("Vision analysis returned no result for Sendblue media")
            return None

        # Skip low-confidence results
        if result.get("low_confidence", False):
            logger.info(
                "Vision analysis low confidence (%.2f) for Sendblue media",
                result.get("confidence", 0),
            )
            return None

        return {
            "habit_id": result.get("habit_id"),
            "habit_name": result.get("habit_name", "Unknown"),
            "amount": result.get("value"),
            "unit_type": result.get("unit"),
            "description": result.get("description", ""),
        }

    except Exception as exc:
        logger.error("Failed to analyze Sendblue media: %s", exc)
        return None


async def _log_and_confirm(
    habits_service: HabitsService,
    user,
    match: dict,
    sender_phone: str,
    source_label: str,
) -> dict:
    """Log a matched habit and send a confirmation reply."""
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    log_data = HabitLogCreate(
        amount=match["amount"],
        date=today,
        completed_at=now.isoformat(),
        status="completed",
        notes=f"Logged via iMessage: {source_label[:200]}",
    )

    try:
        await habits_service.log_habit(match["habit_id"], log_data, user.id)
        logger.info("Sendblue habit logged: %s for user %s", match["habit_name"], user.id)

        # Notify the desktop app via WebSocket
        try:
            from services.websocket_manager import manager
            await manager.broadcast_to_user(
                {
                    "type": "habit_logged",
                    "source": "sendblue",
                    "habit_name": match["habit_name"],
                    "habit_id": match["habit_id"],
                    "amount": match["amount"],
                    "unit_type": match.get("unit_type"),
                    "playSound": True,
                },
                user.id,
            )
        except Exception as ws_err:
            logger.debug("WebSocket notify failed (non-critical): %s", ws_err)

        # Build confirmation message
        amount_str = ""
        if match["amount"] is not None:
            unit = match.get("unit_type") or ""
            amount_str = f" ({match['amount']}{' ' + unit if unit else ''})"

        await send_message(
            sender_phone,
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
        logger.error("Failed to log habit via Sendblue: %s", e)
        await send_message(sender_phone, "Something went wrong logging that. Try again?")
        return {"status": "ok", "error": str(e), "logged": False}
