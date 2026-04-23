"""
SMS Preferences API endpoints.

Called by the TS orchestrator (via the composite token internal auth)
to read and update per-user SMS chatbot preferences.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class SmsPreferencesUpdateRequest(BaseModel):
    proactive_enabled: Optional[bool] = None
    quiet_hours_start: Optional[str] = None
    quiet_hours_end: Optional[str] = None
    max_proactive_per_day: Optional[int] = None
    allowed_triggers: Optional[str] = None
    daily_narrative_enabled: Optional[bool] = None
    interrupts_enabled: Optional[bool] = None
    allowed_interrupt_kinds: Optional[str] = None
    max_interrupts_per_day: Optional[int] = None
    min_hours_between_interrupts: Optional[int] = None


def create_sms_preferences_router(get_current_user):
    """Factory function — accepts the get_current_user dependency."""

    router = APIRouter()

    @router.get("/api/sms/preferences")
    async def get_sms_preferences(current_user=Depends(get_current_user)):
        from services.sms_preferences_service import sms_preferences_service

        prefs = await sms_preferences_service.get_or_create(current_user["id"])
        return {"success": True, **prefs}

    @router.post("/api/sms/preferences")
    async def update_sms_preferences(
        body: SmsPreferencesUpdateRequest,
        current_user=Depends(get_current_user),
    ):
        from services.sms_preferences_service import sms_preferences_service

        fields_set = set(getattr(body, "model_fields_set", getattr(body, "__fields_set__", set())))
        fields = {}
        if body.proactive_enabled is not None:
            fields["proactive_enabled"] = body.proactive_enabled
        if "quiet_hours_start" in fields_set:
            fields["quiet_hours_start"] = body.quiet_hours_start
        if "quiet_hours_end" in fields_set:
            fields["quiet_hours_end"] = body.quiet_hours_end
        if body.max_proactive_per_day is not None:
            fields["max_proactive_per_day"] = min(max(body.max_proactive_per_day, 0), 3)
        if body.allowed_triggers is not None:
            # Validate trigger types
            valid_triggers = {"eod_recap", "morning_briefing", "streak_alert", "missed_habit_nudge", "weekly_milestone"}
            requested = {t.strip() for t in body.allowed_triggers.split(",") if t.strip()}
            sanitized = requested & valid_triggers
            fields["allowed_triggers"] = ",".join(sorted(sanitized)) if sanitized else ""
        if body.daily_narrative_enabled is not None:
            fields["daily_narrative_enabled"] = body.daily_narrative_enabled
        if body.interrupts_enabled is not None:
            fields["interrupts_enabled"] = body.interrupts_enabled
        if body.allowed_interrupt_kinds is not None:
            valid_interrupt_kinds = {"distraction_spiral"}
            requested = {t.strip() for t in body.allowed_interrupt_kinds.split(",") if t.strip()}
            sanitized = requested & valid_interrupt_kinds
            fields["allowed_interrupt_kinds"] = ",".join(sorted(sanitized)) if sanitized else ""
        if body.max_interrupts_per_day is not None:
            fields["max_interrupts_per_day"] = min(max(body.max_interrupts_per_day, 0), 3)
        if body.min_hours_between_interrupts is not None:
            fields["min_hours_between_interrupts"] = min(max(body.min_hours_between_interrupts, 1), 24)

        if not fields:
            prefs = await sms_preferences_service.get_or_create(current_user["id"])
            return {"success": True, "message": "No changes", **prefs}

        # Ensure prefs exist first
        await sms_preferences_service.get_or_create(current_user["id"])
        updated = await sms_preferences_service.update(current_user["id"], **fields)

        if not updated:
            return {"success": False, "error": "Failed to update preferences"}

        return {"success": True, "message": "Preferences updated", **updated}

    return router
