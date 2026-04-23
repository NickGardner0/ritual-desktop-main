"""Deterministic post-log confirmations for SMS habit logging."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import and_, or_, select

from database.connection import get_db_session
from database.models import HabitDB, HabitLogDB
from services.analytics_service import analytics_service
from services.watcher_service import watcher_service


def _format_number(value: float) -> str:
    if abs(value - round(value)) < 0.001:
        return f"{int(round(value)):,}"
    return f"{value:,.1f}".rstrip("0").rstrip(".")


def _ordinal(value: int) -> str:
    if 10 <= value % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(value % 10, "th")
    return f"{value}{suffix}"


def _parse_log_day(logged_at: Optional[datetime]) -> date:
    return (logged_at or datetime.utcnow()).date()


class SmsLogEnrichmentService:
    """Build short, grounded post-log confirmations."""

    async def build_confirmation(
        self,
        *,
        user_id: str,
        habit_id: str,
        amount: Optional[float] = None,
        note: Optional[str] = None,
        logged_at: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        log_day = _parse_log_day(logged_at)

        async with get_db_session() as session:
            habit_result = await session.execute(
                select(HabitDB).where(
                    and_(HabitDB.id == habit_id, HabitDB.user_id == user_id)
                )
            )
            habit = habit_result.scalars().first()
            if habit is None:
                raise ValueError(f"Habit not found: {habit_id}")

            recent_logs_result = await session.execute(
                select(HabitLogDB).where(
                    and_(
                        HabitLogDB.habit_id == habit_id,
                        or_(HabitLogDB.status == "completed", HabitLogDB.status.is_(None)),
                        HabitLogDB.date >= (log_day - timedelta(days=90)).isoformat(),
                        HabitLogDB.date <= log_day.isoformat(),
                    )
                )
            )
            recent_logs = recent_logs_result.scalars().all()

        insight_type, insight, metrics = await self._build_insight(
            user_id=user_id,
            habit=habit,
            logs=recent_logs,
            amount=amount,
            log_day=log_day,
        )

        amount_part = ""
        if amount is not None:
            unit = (habit.unit_type or "").strip()
            amount_part = f": {_format_number(amount)}{f' {unit}' if unit else ''}"

        message = f"Logged {habit.name}{amount_part}."
        if insight:
            message = f"{message} {insight}"

        return {
            "message": message,
            "insight_type": insight_type,
            "metrics": {
                **metrics,
                "habit_id": habit.id,
                "habit_name": habit.name,
                "amount": amount,
                "note": note,
                "logged_date": log_day.isoformat(),
            },
        }

    async def _build_insight(
        self,
        *,
        user_id: str,
        habit: HabitDB,
        logs: list[HabitLogDB],
        amount: Optional[float],
        log_day: date,
    ) -> Tuple[str, Optional[str], Dict[str, Any]]:
        weekly = self._weekly_delta(habit, logs, amount, log_day)
        if weekly:
            return "weekly_delta", weekly[0], weekly[1]

        streak = self._streak(logs, log_day)
        if streak:
            streak_text = "That keeps your 1-day streak alive." if streak == 1 else f"That keeps your {streak}-day streak alive."
            return "streak", streak_text, {"streak_days": streak}

        today_count = self._today_count(logs, log_day)
        if today_count:
            return "today_count", f"That's your {_ordinal(today_count)} {habit.name.lower()} log today.", {"today_count": today_count}

        corroboration = await self._corroboration(user_id=user_id, habit=habit, log_day=log_day)
        if corroboration:
            return "corroboration", corroboration[0], corroboration[1]

        return "none", None, {}

    def _weekly_delta(
        self,
        habit: HabitDB,
        logs: list[HabitLogDB],
        amount: Optional[float],
        log_day: date,
    ) -> Optional[Tuple[str, Dict[str, Any]]]:
        if amount is None:
            return None

        start = (log_day - timedelta(days=7)).isoformat()
        end = (log_day - timedelta(days=1)).isoformat()
        prior_logs = [log for log in logs if start <= str(log.date) <= end]
        if len(prior_logs) < 2:
            return None

        daily = analytics_service._aggregate_by_date(habit, prior_logs)
        if not daily:
            return None

        baseline_avg = sum(float(item["value"]) for item in daily.values()) / len(daily)
        if baseline_avg <= 0:
            return None

        percent_delta = round(((amount - baseline_avg) / baseline_avg) * 100)
        if abs(percent_delta) < 5:
            return None

        direction = "above" if percent_delta > 0 else "below"
        return (
            f"That is {abs(percent_delta)}% {direction} your 7-day average.",
            {
                "baseline_avg": round(baseline_avg, 2),
                "percent_delta": percent_delta,
            },
        )

    def _streak(self, logs: list[HabitLogDB], log_day: date) -> int:
        logged_days = {
            date.fromisoformat(str(log.date)[:10])
            for log in logs
            if getattr(log, "date", None)
        }
        if log_day not in logged_days:
            return 0

        streak = 0
        cursor = log_day
        while cursor in logged_days:
            streak += 1
            cursor -= timedelta(days=1)
        return streak

    def _today_count(self, logs: list[HabitLogDB], log_day: date) -> int:
        counts = Counter(str(log.date)[:10] for log in logs if getattr(log, "date", None))
        return int(counts.get(log_day.isoformat(), 0))

    async def _corroboration(
        self,
        *,
        user_id: str,
        habit: HabitDB,
        log_day: date,
    ) -> Optional[Tuple[str, Dict[str, Any]]]:
        habit_name = (habit.name or "").strip().lower()
        if not any(keyword in habit_name for keyword in ("computer", "deep work", "focus", "coding")):
            return None

        snapshot = await watcher_service.get_computer_activity_snapshot(
            user_id=user_id,
            start_date=log_day.isoformat(),
            end_date=log_day.isoformat(),
            limit=5,
        )
        total_active_ms = int((((snapshot or {}).get("summary") or {}).get("total_active_ms") or 0))
        if total_active_ms <= 0:
            return None

        hours = round(total_active_ms / (1000 * 60 * 60), 2)
        return (
            f"I also saw about {_format_number(hours)} hours of computer activity today.",
            {"computer_activity_hours": hours},
        )


sms_log_enrichment_service = SmsLogEnrichmentService()
