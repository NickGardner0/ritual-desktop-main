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

        # Build update fields from non-None values
        fields = {}
        if body.proactive_enabled is not None:
            fields["proactive_enabled"] = body.proactive_enabled
        if body.quiet_hours_start is not None:
            fields["quiet_hours_start"] = body.quiet_hours_start
        if body.quiet_hours_end is not None:
            fields["quiet_hours_end"] = body.quiet_hours_end
        if body.max_proactive_per_day is not None:
            fields["max_proactive_per_day"] = min(max(body.max_proactive_per_day, 0), 3)
        if body.allowed_triggers is not None:
            # Validate trigger types
            valid_triggers = {"eod_recap", "morning_briefing", "streak_alert", "missed_habit_nudge", "weekly_milestone"}
            requested = {t.strip() for t in body.allowed_triggers.split(",") if t.strip()}
            sanitized = requested & valid_triggers
            fields["allowed_triggers"] = ",".join(sorted(sanitized)) if sanitized else ""

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
