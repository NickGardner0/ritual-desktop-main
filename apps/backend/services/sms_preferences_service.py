"""
SMS Preferences Service

Manages per-user SMS/iMessage chatbot preferences: opt-in/out,
quiet hours, proactive message frequency, and allowed trigger types.
"""

from datetime import datetime, time
from typing import Any, Dict, Optional

from sqlalchemy import select

from database.connection import get_db_session
from database.models import SmsPreferencesDB


class SmsPreferencesService:
    """Service for managing SMS chatbot preferences."""

    async def get_or_create(self, user_id: str) -> Dict[str, Any]:
        """Get preferences for a user, creating defaults if none exist."""
        async with get_db_session() as session:
            result = await session.execute(
                select(SmsPreferencesDB).where(
                    SmsPreferencesDB.user_id == user_id
                )
            )
            prefs = result.scalars().first()

            if prefs:
                return self._serialize(prefs)

            prefs = SmsPreferencesDB(
                user_id=user_id,
                enabled=True,
                proactive_enabled=True,
                max_proactive_per_day=3,
                allowed_triggers="eod_recap,streak_alert,missed_habit_nudge,weekly_milestone",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(prefs)
            await session.commit()

            return self._serialize(prefs)

    async def update(self, user_id: str, **fields: Any) -> Optional[Dict[str, Any]]:
        """Update specific preference fields."""
        async with get_db_session() as session:
            result = await session.execute(
                select(SmsPreferencesDB).where(
                    SmsPreferencesDB.user_id == user_id
                )
            )
            prefs = result.scalars().first()

            if not prefs:
                return None

            allowed_fields = {
                "enabled",
                "proactive_enabled",
                "quiet_hours_start",
                "quiet_hours_end",
                "max_proactive_per_day",
                "allowed_triggers",
            }

            for key, value in fields.items():
                if key in allowed_fields:
                    setattr(prefs, key, value)

            prefs.updated_at = datetime.utcnow()
            await session.commit()

            return self._serialize(prefs)

    def is_in_quiet_hours(
        self, prefs: Dict[str, Any], now_local: datetime
    ) -> bool:
        """Check if the current local time falls within quiet hours."""
        start_str = prefs.get("quiet_hours_start")
        end_str = prefs.get("quiet_hours_end")

        if not start_str or not end_str:
            return False

        try:
            start = time.fromisoformat(start_str)
            end = time.fromisoformat(end_str)
        except ValueError:
            return False

        now_time = now_local.time()

        if start <= end:
            # Same-day range (e.g. 09:00 - 17:00)
            return start <= now_time <= end
        else:
            # Overnight range (e.g. 22:00 - 08:00)
            return now_time >= start or now_time <= end

    def can_send_proactive(
        self,
        prefs: Dict[str, Any],
        trigger_type: str,
        now_local: datetime,
    ) -> bool:
        """Check all conditions for sending a proactive message."""
        if not prefs.get("enabled"):
            return False

        if not prefs.get("proactive_enabled"):
            return False

        if self.is_in_quiet_hours(prefs, now_local):
            return False

        # Check trigger type is allowed
        allowed = {
            t.strip()
            for t in (prefs.get("allowed_triggers") or "").split(",")
            if t.strip()
        }
        if trigger_type not in allowed:
            return False

        # Check daily cap
        last_sent = prefs.get("last_proactive_sent_at")
        if last_sent:
            if isinstance(last_sent, str):
                try:
                    last_sent = datetime.fromisoformat(last_sent)
                except ValueError:
                    last_sent = None

            if last_sent and last_sent.date() == now_local.date():
                # Already sent today — respect the daily cap
                # For simplicity we treat any send today as "at cap" when max=1
                max_per_day = prefs.get("max_proactive_per_day", 1)
                if max_per_day <= 1:
                    return False

        return True

    async def record_proactive_sent(self, user_id: str, now: datetime) -> None:
        """Record that a proactive message was sent."""
        async with get_db_session() as session:
            result = await session.execute(
                select(SmsPreferencesDB).where(
                    SmsPreferencesDB.user_id == user_id
                )
            )
            prefs = result.scalars().first()

            if prefs:
                prefs.last_proactive_sent_at = now
                prefs.updated_at = now
                await session.commit()

    def _serialize(self, prefs: SmsPreferencesDB) -> Dict[str, Any]:
        return {
            "user_id": prefs.user_id,
            "enabled": prefs.enabled,
            "proactive_enabled": prefs.proactive_enabled,
            "quiet_hours_start": prefs.quiet_hours_start,
            "quiet_hours_end": prefs.quiet_hours_end,
            "max_proactive_per_day": prefs.max_proactive_per_day,
            "allowed_triggers": prefs.allowed_triggers,
            "last_proactive_sent_at": (
                prefs.last_proactive_sent_at.isoformat()
                if prefs.last_proactive_sent_at
                else None
            ),
            "created_at": prefs.created_at.isoformat(),
            "updated_at": prefs.updated_at.isoformat(),
        }


# Singleton instance
sms_preferences_service = SmsPreferencesService()
