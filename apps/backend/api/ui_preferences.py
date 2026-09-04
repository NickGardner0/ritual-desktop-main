"""UI Preferences API endpoints — per-user appearance settings."""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class UIPreferencesUpdateRequest(BaseModel):
    habit_text_color: Optional[str] = None
    overview_view_mode: Optional[str] = None
    calendar_preferences: Optional[Dict[str, Any]] = None


def create_ui_preferences_router(get_current_user):
    """Factory function — accepts the get_current_user dependency."""

    router = APIRouter()

    @router.get("/api/ui-preferences")
    async def get_ui_preferences(current_user=Depends(get_current_user)):
        from services.ui_preferences_service import ui_preferences_service

        prefs = await ui_preferences_service.get_or_create(current_user["id"])
        return {"success": True, **prefs}

    @router.patch("/api/ui-preferences")
    async def update_ui_preferences(
        body: UIPreferencesUpdateRequest,
        current_user=Depends(get_current_user),
    ):
        from services.ui_preferences_service import ui_preferences_service

        fields_set = set(
            getattr(body, "model_fields_set", getattr(body, "__fields_set__", set()))
        )
        fields = {}
        if "habit_text_color" in fields_set:
            fields["habit_text_color"] = body.habit_text_color
        if "overview_view_mode" in fields_set:
            fields["overview_view_mode"] = body.overview_view_mode
        if "calendar_preferences" in fields_set:
            fields["calendar_preferences"] = body.calendar_preferences

        if not fields:
            prefs = await ui_preferences_service.get_or_create(current_user["id"])
            return {"success": True, "message": "No changes", **prefs}

        await ui_preferences_service.get_or_create(current_user["id"])
        try:
            updated = await ui_preferences_service.update(current_user["id"], **fields)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        if not updated:
            return {"success": False, "error": "Failed to update preferences"}

        return {"success": True, "message": "Preferences updated", **updated}

    return router
