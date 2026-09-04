"""UI Preferences Service — per-user appearance preferences (text colors, etc.)."""

import json
import re
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import select

from database.connection import get_db_session
from database.models import UserUIPreferencesDB


HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

VALID_OVERVIEW_VIEW_MODES = {"list", "summary"}
VALID_CALENDAR_VIEWS = {"day", "week", "month"}
VALID_CALENDAR_MODES = {"plan", "review"}


def _normalize_hex(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    candidate = value.strip()
    if not HEX_COLOR_RE.match(candidate):
        raise ValueError(f"Invalid hex color: {value!r}")
    return candidate.lower()


def _normalize_overview_view_mode(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    candidate = value.strip().lower()
    if candidate not in VALID_OVERVIEW_VIEW_MODES:
        raise ValueError(f"Invalid overview_view_mode: {value!r}")
    return candidate


def _normalize_calendar_preferences(value: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    source = dict(value or {})
    view = source.get("view", "day")
    mode = source.get("mode", "plan")
    if view not in VALID_CALENDAR_VIEWS:
        raise ValueError("Invalid calendar view")
    if mode not in VALID_CALENDAR_MODES:
        raise ValueError("Invalid calendar mode")
    snap_minutes = int(source.get("snap_minutes", 15))
    if snap_minutes not in {5, 10, 15, 30, 60}:
        raise ValueError("Invalid calendar snap interval")
    pane_widths = source.get("pane_widths") if isinstance(source.get("pane_widths"), dict) else {}
    return {
        "version": 2,
        "view": view,
        "mode": mode,
        "tasks_open": bool(source.get("tasks_open", True)),
        "agents_open": bool(source.get("agents_open", True)),
        "pane_widths": {
            "tasks": max(248, min(360, int(pane_widths.get("tasks", 288)))),
            "agents": max(280, min(420, int(pane_widths.get("agents", 336)))),
        },
        "visible_source_ids": [str(item) for item in source.get("visible_source_ids", []) if item],
        "default_write_source_id": source.get("default_write_source_id"),
        "timezone": str(source.get("timezone") or "UTC"),
        "week_starts_on": 1 if int(source.get("week_starts_on", 0)) == 1 else 0,
        "workday_start_minutes": max(0, min(1439, int(source.get("workday_start_minutes", 480)))),
        "workday_end_minutes": max(1, min(1440, int(source.get("workday_end_minutes", 1080)))),
        "snap_minutes": snap_minutes,
        "default_duration_minutes": max(5, min(720, int(source.get("default_duration_minutes", 30)))),
    }


class UIPreferencesService:
    """Service for managing per-user UI appearance preferences."""

    async def get_or_create(self, user_id: str) -> Dict[str, Any]:
        async with get_db_session() as session:
            result = await session.execute(
                select(UserUIPreferencesDB).where(
                    UserUIPreferencesDB.user_id == user_id
                )
            )
            prefs = result.scalars().first()

            if prefs:
                return self._serialize(prefs)

            prefs = UserUIPreferencesDB(
                user_id=user_id,
                habit_text_color=None,
                overview_view_mode=None,
                calendar_preferences_json="{}",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(prefs)
            await session.commit()

            return self._serialize(prefs)

    async def update(self, user_id: str, **fields: Any) -> Optional[Dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                select(UserUIPreferencesDB).where(
                    UserUIPreferencesDB.user_id == user_id
                )
            )
            prefs = result.scalars().first()

            if not prefs:
                return None

            if "habit_text_color" in fields:
                prefs.habit_text_color = _normalize_hex(fields["habit_text_color"])
            if "overview_view_mode" in fields:
                prefs.overview_view_mode = _normalize_overview_view_mode(
                    fields["overview_view_mode"]
                )
            if "calendar_preferences" in fields:
                prefs.calendar_preferences_json = json.dumps(
                    _normalize_calendar_preferences(fields["calendar_preferences"]),
                    separators=(",", ":"),
                )

            prefs.updated_at = datetime.utcnow()
            await session.commit()

            return self._serialize(prefs)

    def _serialize(self, prefs: UserUIPreferencesDB) -> Dict[str, Any]:
        return {
            "user_id": prefs.user_id,
            "habit_text_color": prefs.habit_text_color,
            "overview_view_mode": prefs.overview_view_mode,
            "calendar_preferences": _normalize_calendar_preferences(
                json.loads(prefs.calendar_preferences_json or "{}")
            ),
            "created_at": prefs.created_at.isoformat() if prefs.created_at else None,
            "updated_at": prefs.updated_at.isoformat() if prefs.updated_at else None,
        }


ui_preferences_service = UIPreferencesService()
