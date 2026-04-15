"""
Proactive SMS Service

Finds users eligible for proactive messages (e.g., end-of-day recap),
generates the content via the TS orchestrator, and sends via SendBlue.

Called by the proactive trigger endpoint, which is invoked by an
external scheduler (Trigger.dev, Railway cron, etc.) — typically once
per hour.
"""

import logging
import os
from datetime import datetime, timezone as tz
from typing import Any, Dict, List, Optional

import httpx
from zoneinfo import ZoneInfo

from database.connection import get_db_session
from database.models import SmsPreferencesDB, UserDB
from services.conversation_service import conversation_service
from services.sendblue_service import send_message
from services.sms_preferences_service import sms_preferences_service
from sqlalchemy import select

logger = logging.getLogger(__name__)

DASHBOARD_BASE_URL = os.getenv("DASHBOARD_BASE_URL", "https://desktop.ritualdb.com")
INTERNAL_SMS_CHAT_SECRET = os.getenv("INTERNAL_SMS_CHAT_SECRET", "")
INTERNAL_BACKEND_TOKEN = os.getenv("INTERNAL_BACKEND_TOKEN", "")
ORCHESTRATOR_TIMEOUT = 25.0


# ---------------------------------------------------------------------------
# Trigger type → system instruction for the orchestrator
# ---------------------------------------------------------------------------

TRIGGER_PROMPTS: Dict[str, str] = {
    "eod_recap": (
        "Generate an end-of-day recap for the user. Call getDailyOverview and "
        "getStreaks to get today's habit data and active streaks. Summarize their "
        "tracked habits for today, highlight wins (streaks, personal bests, notable "
        "completions), and mention anything they might have missed. Keep it warm, "
        "concise, and motivating. Do NOT ask follow-up questions. Start with a "
        "greeting like 'Here's your day in review 📊' or similar."
    ),
    "morning_briefing": (
        "Generate a morning briefing for the user. Call getCalendarEvents to see "
        "what's scheduled today, and getStreaks to find active streaks worth "
        "mentioning. Give a brief overview of their day ahead, mention any habit "
        "streaks they're maintaining, and add one motivating note. Keep it short "
        "and energizing. Do NOT ask follow-up questions."
    ),
    "streak_alert": (
        "The user has an active streak worth celebrating. Call getStreaks to find "
        "their current streaks. For any habit with a current streak at a milestone "
        "(7, 14, 21, 30, 50, 100 days), send a celebratory message. Mention the "
        "specific habit and streak length. Be genuinely excited but brief. If no "
        "streaks are at milestones, respond with just the word SKIP."
    ),
    "missed_habit_nudge": (
        "Check if the user has habits they usually log daily but haven't logged "
        "today. Call getStreaks to see which habits have active streaks. For any "
        "habit with a current streak of 3+ days where last_logged_date is NOT "
        "today, send a gentle, non-pushy nudge — e.g., 'Looks like you haven't "
        "logged [habit] yet today. Your [N]-day streak is still going!' Keep it "
        "supportive, not guilt-tripping. If all streaks are up to date or there "
        "are no active streaks, respond with just the word SKIP."
    ),
    "weekly_milestone": (
        "Generate a brief weekly milestone message. Call getWeeklyOverview to see "
        "this week's performance. Highlight one notable achievement — highest "
        "total, best average, most consistent habit, or a new personal record. "
        "Keep it to 1-2 sentences. If nothing stands out, respond with SKIP."
    ),
}

# Trigger → what hour (in user's local time) to fire
TRIGGER_TARGET_HOURS: Dict[str, int] = {
    "eod_recap": 21,          # 9 PM
    "morning_briefing": 8,    # 8 AM
    "streak_alert": 20,       # 8 PM
    "missed_habit_nudge": 19, # 7 PM
    "weekly_milestone": 10,   # 10 AM (only on Sundays, handled in sweep)
}


# ---------------------------------------------------------------------------
# Find eligible users
# ---------------------------------------------------------------------------

async def find_eligible_users(
    trigger_type: str,
    target_hour: int = 21,
    hour_tolerance: int = 0,
) -> List[Dict[str, Any]]:
    """
    Find users eligible for a proactive message right now.

    For each user with proactive SMS enabled:
    1. Check their local time is within the target hour window
    2. Check can_send_proactive() passes (quiet hours, daily cap, etc.)

    Returns list of dicts with user_id, phone_number, timezone.
    """
    now_utc = datetime.now(tz.utc)
    eligible = []

    async with get_db_session() as session:
        # Join users with sms_preferences where proactive is enabled
        result = await session.execute(
            select(
                UserDB.id,
                UserDB.phone_number,
                UserDB.timezone,
                UserDB.full_name,
                SmsPreferencesDB.enabled,
                SmsPreferencesDB.proactive_enabled,
                SmsPreferencesDB.quiet_hours_start,
                SmsPreferencesDB.quiet_hours_end,
                SmsPreferencesDB.max_proactive_per_day,
                SmsPreferencesDB.allowed_triggers,
                SmsPreferencesDB.last_proactive_sent_at,
            )
            .join(SmsPreferencesDB, UserDB.id == SmsPreferencesDB.user_id)
            .where(
                SmsPreferencesDB.enabled.is_(True),
                SmsPreferencesDB.proactive_enabled.is_(True),
                UserDB.phone_number.isnot(None),
            )
        )

        for row in result.all():
            user_id = row[0]
            phone = row[1]
            user_tz_str = row[2] or "America/New_York"
            full_name = row[3]

            # Build a prefs dict for can_send_proactive()
            prefs = {
                "enabled": row[4],
                "proactive_enabled": row[5],
                "quiet_hours_start": row[6],
                "quiet_hours_end": row[7],
                "max_proactive_per_day": row[8],
                "allowed_triggers": row[9],
                "last_proactive_sent_at": row[10],
            }

            # Resolve user's local time
            try:
                user_tz = ZoneInfo(user_tz_str)
                now_local = now_utc.astimezone(user_tz)
            except Exception:
                logger.warning("Invalid timezone '%s' for user %s, skipping", user_tz_str, user_id)
                continue

            # Check if it's the right hour
            local_hour = now_local.hour
            if abs(local_hour - target_hour) > hour_tolerance:
                continue

            # Weekly milestone only fires on Sundays
            if trigger_type == "weekly_milestone" and now_local.weekday() != 6:
                continue

            # Check all preference gates
            if not sms_preferences_service.can_send_proactive(prefs, trigger_type, now_local):
                continue

            eligible.append({
                "user_id": user_id,
                "phone_number": phone,
                "timezone": user_tz_str,
                "full_name": full_name,
            })

    logger.info(
        "Found %d eligible users for trigger '%s' at target hour %d",
        len(eligible), trigger_type, target_hour,
    )
    return eligible


# ---------------------------------------------------------------------------
# Generate proactive content via TS orchestrator
# ---------------------------------------------------------------------------

async def _call_proactive_orchestrator(
    user_id: str,
    trigger_type: str,
    timezone: str,
) -> Optional[str]:
    """
    Call the Vercel SMS proactive endpoint to generate a proactive message.
    Returns the generated text, or None on failure.
    """
    url = f"{DASHBOARD_BASE_URL}/api/chat/sms/proactive"

    prompt = TRIGGER_PROMPTS.get(trigger_type)
    if not prompt:
        logger.error("Unknown trigger type: %s", trigger_type)
        return None

    payload = {
        "user_id": user_id,
        "trigger_type": trigger_type,
        "trigger_prompt": prompt,
        "timezone": timezone,
    }

    headers = {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SMS_CHAT_SECRET,
        "x-backend-token": INTERNAL_BACKEND_TOKEN,
    }

    try:
        async with httpx.AsyncClient(timeout=ORCHESTRATOR_TIMEOUT) as client:
            response = await client.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            logger.error(
                "Proactive orchestrator returned %d for user %s: %s",
                response.status_code, user_id, response.text[:200],
            )
            return None

        data = response.json()
        text = data.get("text", "")

        # Some triggers instruct the LLM to respond "SKIP" when there's
        # nothing noteworthy to send. Respect that.
        if text.strip().upper() == "SKIP":
            logger.info(
                "Proactive '%s' for user %s returned SKIP — nothing to send",
                trigger_type, user_id,
            )
            return None

        return text

    except Exception as exc:
        logger.exception("Proactive orchestrator call failed for user %s: %s", user_id, exc)
        return None


# ---------------------------------------------------------------------------
# Send proactive message
# ---------------------------------------------------------------------------

async def send_proactive_message(
    user_id: str,
    phone_number: str,
    trigger_type: str,
    timezone: str,
) -> bool:
    """
    Generate and send a proactive message to a single user.
    Returns True if the message was sent successfully.
    """
    # Generate content
    text = await _call_proactive_orchestrator(user_id, trigger_type, timezone)
    if not text:
        logger.warning("No proactive content generated for user %s", user_id)
        return False

    # Persist to conversation thread
    conversation = await conversation_service.find_or_create_sms_conversation(user_id)
    await conversation_service.add_internal_message(
        conversation_id=conversation["id"],
        role="assistant",
        content=text,
        tool_payload={"proactive_trigger": trigger_type},
    )

    # Send via SendBlue
    sent = await send_message(phone_number, text)
    if not sent:
        logger.error("Failed to send proactive message to user %s", user_id)
        return False

    # Record that we sent a proactive message today
    await sms_preferences_service.record_proactive_sent(
        user_id, datetime.now(tz.utc)
    )

    logger.info(
        "Proactive '%s' message sent to user %s",
        trigger_type, user_id,
    )
    return True


# ---------------------------------------------------------------------------
# Run a full proactive sweep
# ---------------------------------------------------------------------------

async def run_proactive_sweep(
    trigger_type: str = "eod_recap",
    target_hour: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Full sweep: find eligible users and send proactive messages.
    Returns a summary of results.

    If target_hour is not specified, uses the default for the trigger type.
    """
    if target_hour is None:
        target_hour = TRIGGER_TARGET_HOURS.get(trigger_type, 21)

    eligible = await find_eligible_users(trigger_type, target_hour)

    sent = 0
    failed = 0
    skipped = 0

    for user in eligible:
        try:
            ok = await send_proactive_message(
                user_id=user["user_id"],
                phone_number=user["phone_number"],
                trigger_type=trigger_type,
                timezone=user["timezone"],
            )
            if ok:
                sent += 1
            else:
                skipped += 1  # SKIP or no content generated
        except Exception as exc:
            logger.exception(
                "Proactive send failed for user %s: %s",
                user["user_id"], exc,
            )
            failed += 1

    return {
        "trigger_type": trigger_type,
        "target_hour": target_hour,
        "eligible_count": len(eligible),
        "sent": sent,
        "skipped": skipped,
        "failed": failed,
    }


async def run_hourly_proactive_sweep() -> List[Dict[str, Any]]:
    """
    Run all trigger types that should fire this hour.
    Called by the trigger endpoint when trigger_type="all".

    Returns a list of sweep results.
    """
    results = []
    for trigger_type, target_hour in TRIGGER_TARGET_HOURS.items():
        try:
            result = await run_proactive_sweep(trigger_type, target_hour)
            results.append(result)
        except Exception as exc:
            logger.exception("Sweep failed for trigger '%s': %s", trigger_type, exc)
            results.append({
                "trigger_type": trigger_type,
                "error": str(exc),
            })
    return results
