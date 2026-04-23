"""UI Preferences Service — per-user appearance preferences (text colors, etc.)."""

import re
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import select

from database.connection import get_db_session
from database.models import UserUIPreferencesDB


HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

VALID_OVERVIEW_VIEW_MODES = {"list", "card"}


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

            prefs.updated_at = datetime.utcnow()
            await session.commit()

            return self._serialize(prefs)

    def _serialize(self, prefs: UserUIPreferencesDB) -> Dict[str, Any]:
        return {
            "user_id": prefs.user_id,
            "habit_text_color": prefs.habit_text_color,
            "overview_view_mode": prefs.overview_view_mode,
            "created_at": prefs.created_at.isoformat() if prefs.created_at else None,
            "updated_at": prefs.updated_at.isoformat() if prefs.updated_at else None,
        }


ui_preferences_service = UIPreferencesService()
