"""
Scheduled habit-report pipeline for Ritual.

This mirrors the core Midday insights shape:
- recurring schedule definitions
- queued report runs
- stored generated summary
- notification/delivery records
- email delivery via the dashboard's React email template
"""

from __future__ import annotations

import json
import logging
import os
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import and_, desc, select

from database.connection import get_db_session
from database.models import (
    HabitDB,
    HabitLogDB,
    ReportNotificationDB,
    ReportRunDB,
    ReportScheduleDB,
    UserDB,
    WearableConnectionDB,
)
from schemas.reports import (
    HabitReportDispatchResponse,
    HabitReportMetric,
    HabitReportNotificationRead,
    HabitReportPreview,
    HabitReportRecipient,
    HabitReportRunRead,
    HabitReportScheduleCreate,
    HabitReportScheduleRead,
    HabitReportScheduleUpdate,
)
from services.analytics_service import analytics_service
from services.artifact_service import artifact_service

logger = logging.getLogger(__name__)

DASHBOARD_BASE_URL = os.getenv("DASHBOARD_BASE_URL", "https://desktop.ritualdb.com").rstrip("/")
INTERNAL_BACKEND_TOKEN = (os.getenv("INTERNAL_BACKEND_TOKEN") or "").strip()
REPORTS_DELIVERY_TIMEOUT = float(os.getenv("REPORTS_DELIVERY_TIMEOUT", "20"))
DEFAULT_REPORTS_TIMEZONE = "America/New_York"
DEFAULT_REPORTS_ROUTE = f"{DASHBOARD_BASE_URL}/reports"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@dataclass
class _ReportWindow:
    start_date: date
    end_date: date
    label: str
    day_count: int


class ReportsService:
    def _completed_log_filter(self):
        return analytics_service._completed_log_filter()

    def _parse_json(self, raw: Optional[str], fallback: Any) -> Any:
        if not raw:
            return fallback
        try:
            return json.loads(raw)
        except Exception:
            return fallback

    def _normalize_timezone(self, timezone_name: Optional[str]) -> str:
        candidate = (timezone_name or "").strip() or DEFAULT_REPORTS_TIMEZONE
        try:
            ZoneInfo(candidate)
            return candidate
        except Exception:
            logger.warning("Invalid report timezone '%s'; falling back to %s", candidate, DEFAULT_REPORTS_TIMEZONE)
            return DEFAULT_REPORTS_TIMEZONE

    def _localize_reference(self, timezone_name: str, reference_utc: Optional[datetime] = None) -> datetime:
        utc_now = reference_utc or datetime.now(timezone.utc)
        if utc_now.tzinfo is None:
            utc_now = utc_now.replace(tzinfo=timezone.utc)
        return utc_now.astimezone(ZoneInfo(self._normalize_timezone(timezone_name)))

    def _compute_next_run(
        self,
        *,
        cadence: str,
        timezone_name: str,
        send_hour_local: int,
        send_minute_local: int,
        send_weekday: Optional[int],
        send_day_of_month: Optional[int],
        reference_utc: Optional[datetime] = None,
    ) -> datetime:
        local_reference = self._localize_reference(timezone_name, reference_utc)
        tzinfo = local_reference.tzinfo

        def build_local_candidate(candidate_date: date) -> datetime:
            return datetime.combine(
                candidate_date,
                time(hour=send_hour_local, minute=send_minute_local),
                tzinfo=tzinfo,
            )

        if cadence == "daily":
            candidate = build_local_candidate(local_reference.date())
            if candidate <= local_reference:
                candidate = build_local_candidate(local_reference.date() + timedelta(days=1))
        elif cadence == "weekly":
            target_weekday = 0 if send_weekday is None else int(send_weekday)
            days_ahead = (target_weekday - local_reference.weekday()) % 7
            candidate_date = local_reference.date() + timedelta(days=days_ahead)
            candidate = build_local_candidate(candidate_date)
            if candidate <= local_reference:
                candidate = build_local_candidate(candidate_date + timedelta(days=7))
        else:
            target_day = max(1, min(int(send_day_of_month or 1), 31))
            year = local_reference.year
            month = local_reference.month
            capped_day = min(target_day, monthrange(year, month)[1])
            candidate = build_local_candidate(date(year, month, capped_day))
            if candidate <= local_reference:
                if month == 12:
                    year += 1
                    month = 1
                else:
                    month += 1
                capped_day = min(target_day, monthrange(year, month)[1])
                candidate = build_local_candidate(date(year, month, capped_day))

        return candidate.astimezone(timezone.utc).replace(tzinfo=None)

    def _resolve_window(
        self,
        cadence: str,
        timezone_name: str,
        reference_utc: Optional[datetime] = None,
    ) -> _ReportWindow:
        local_reference = self._localize_reference(timezone_name, reference_utc)
        end_date = local_reference.date()

        if cadence == "daily":
            start_date = end_date
        elif cadence == "weekly":
            start_date = end_date - timedelta(days=6)
        else:
            start_date = end_date - timedelta(days=29)

        label = (
            end_date.strftime("%b %d, %Y")
            if start_date == end_date
            else f"{start_date.strftime('%b %d')} - {end_date.strftime('%b %d')}"
        )
        return _ReportWindow(
            start_date=start_date,
            end_date=end_date,
            label=label,
            day_count=(end_date - start_date).days + 1,
        )

    def _build_delivery_label(
        self,
        *,
        cadence: str,
        send_hour_local: int,
        send_minute_local: int,
        send_weekday: Optional[int],
        send_day_of_month: Optional[int],
    ) -> str:
        time_label = datetime.combine(date.today(), time(send_hour_local, send_minute_local)).strftime("%-I:%M %p")
        if cadence == "daily":
            return f"Every day at {time_label}"
        if cadence == "weekly":
            weekday_names = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]
            weekday_label = weekday_names[int(send_weekday or 0)]
            return f"{weekday_label} at {time_label}"
        day_label = int(send_day_of_month or 1)
        suffix = "th"
        if day_label % 10 == 1 and day_label % 100 != 11:
            suffix = "st"
        elif day_label % 10 == 2 and day_label % 100 != 12:
            suffix = "nd"
        elif day_label % 10 == 3 and day_label % 100 != 13:
            suffix = "rd"
        return f"{day_label}{suffix} day of each month at {time_label}"

    def _default_schedule_definitions(self, user_id: str, recipient_email: Optional[str], timezone_name: str) -> List[Dict[str, Any]]:
        recipient = []
        if recipient_email:
            recipient = [{"email": recipient_email, "label": "Primary inbox"}]

        return [
            {
                "id": f"{user_id}-report-weekly",
                "name": "Weekly Habit Summary",
                "cadence": "weekly",
                "status": "scheduled",
                "timezone": timezone_name,
                "send_hour_local": 7,
                "send_minute_local": 0,
                "send_weekday": 0,
                "send_day_of_month": None,
                "sections": [
                    "highlights",
                    "consistency",
                    "streaks",
                    "top-habits",
                    "computer-activity",
                    "wearables",
                ],
                "recipients": recipient,
            },
            {
                "id": f"{user_id}-report-monthly",
                "name": "Monthly Reflection",
                "cadence": "monthly",
                "status": "draft",
                "timezone": timezone_name,
                "send_hour_local": 8,
                "send_minute_local": 30,
                "send_weekday": None,
                "send_day_of_month": 1,
                "sections": [
                    "highlights",
                    "consistency",
                    "streaks",
                    "top-habits",
                    "missed-habits",
                    "computer-activity",
                    "wearables",
                ],
                "recipients": recipient,
            },
            {
                "id": f"{user_id}-report-daily",
                "name": "Daily Recap",
                "cadence": "daily",
                "status": "paused",
                "timezone": timezone_name,
                "send_hour_local": 20,
                "send_minute_local": 0,
                "send_weekday": None,
                "send_day_of_month": None,
                "sections": [
                    "highlights",
                    "consistency",
                    "missed-habits",
                    "computer-activity",
                ],
                "recipients": recipient,
            },
        ]

    async def _ensure_default_schedules(
        self,
        *,
        session,
        user_id: str,
        email: Optional[str],
        timezone_name: Optional[str],
    ) -> None:
        existing = await session.execute(
            select(ReportScheduleDB.id).where(ReportScheduleDB.user_id == user_id)
        )
        if existing.first():
            return

        tz_name = self._normalize_timezone(timezone_name)
        for definition in self._default_schedule_definitions(user_id, email, tz_name):
            next_run_at = None
            if definition["status"] == "scheduled":
                next_run_at = self._compute_next_run(
                    cadence=definition["cadence"],
                    timezone_name=tz_name,
                    send_hour_local=definition["send_hour_local"],
                    send_minute_local=definition["send_minute_local"],
                    send_weekday=definition["send_weekday"],
                    send_day_of_month=definition["send_day_of_month"],
                )
            session.add(
                ReportScheduleDB(
                    id=definition["id"],
                    user_id=user_id,
                    name=definition["name"],
                    cadence=definition["cadence"],
                    status=definition["status"],
                    timezone=tz_name,
                    delivery_channel="email",
                    delivery_label=self._build_delivery_label(
                        cadence=definition["cadence"],
                        send_hour_local=definition["send_hour_local"],
                        send_minute_local=definition["send_minute_local"],
                        send_weekday=definition["send_weekday"],
                        send_day_of_month=definition["send_day_of_month"],
                    ),
                    send_hour_local=definition["send_hour_local"],
                    send_minute_local=definition["send_minute_local"],
                    send_weekday=definition["send_weekday"],
                    send_day_of_month=definition["send_day_of_month"],
                    recipients_json=json.dumps(definition["recipients"]),
                    sections_json=json.dumps(definition["sections"]),
                    next_run_at=next_run_at,
                )
            )
        await session.commit()

    def _schedule_to_schema(self, schedule: ReportScheduleDB) -> HabitReportScheduleRead:
        return HabitReportScheduleRead(
            id=schedule.id,
            name=schedule.name,
            cadence=schedule.cadence,  # type: ignore[arg-type]
            status=schedule.status,  # type: ignore[arg-type]
            timezone=self._normalize_timezone(schedule.timezone),
            delivery_channel=schedule.delivery_channel,  # type: ignore[arg-type]
            delivery_label=schedule.delivery_label,
            send_hour_local=int(schedule.send_hour_local or 0),
            send_minute_local=int(schedule.send_minute_local or 0),
            send_weekday=schedule.send_weekday,
            send_day_of_month=schedule.send_day_of_month,
            recipients=[HabitReportRecipient.model_validate(item) for item in self._parse_json(schedule.recipients_json, [])],
            sections=self._parse_json(schedule.sections_json, []),
            last_sent_at=schedule.last_sent_at,
            next_run_at=schedule.next_run_at,
            last_error=schedule.last_error,
        )

    def _preview_from_json(self, raw: Optional[str]) -> Optional[HabitReportPreview]:
        data = self._parse_json(raw, None)
        if not data:
            return None
        try:
            return HabitReportPreview.model_validate(data)
        except Exception:
            return None

    def _run_to_schema(self, run: ReportRunDB) -> HabitReportRunRead:
        return HabitReportRunRead(
            id=run.id,
            schedule_id=run.schedule_id,
            cadence=run.cadence,  # type: ignore[arg-type]
            status=run.status,  # type: ignore[arg-type]
            period_start=run.period_start,
            period_end=run.period_end,
            subject=run.subject,
            artifact_id=run.artifact_id,
            preview=self._preview_from_json(run.summary_json),
            generated_at=run.generated_at,
            sent_at=run.sent_at,
            created_at=run.created_at,
            error_json=run.error_json,
        )

    def _notification_to_schema(self, notification: ReportNotificationDB) -> HabitReportNotificationRead:
        return HabitReportNotificationRead(
            id=notification.id,
            report_run_id=notification.report_run_id,
            channel=notification.channel,  # type: ignore[arg-type]
            recipient_email=notification.recipient_email,
            status=notification.status,  # type: ignore[arg-type]
            provider_message_id=notification.provider_message_id,
            sent_at=notification.sent_at,
        )

    async def list_schedules(self, user_id: str, *, email: Optional[str], timezone_name: Optional[str]) -> List[HabitReportScheduleRead]:
        async with get_db_session() as session:
            user = await session.get(UserDB, user_id)
            await self._ensure_default_schedules(
                session=session,
                user_id=user_id,
                email=email or getattr(user, "email", None),
                timezone_name=timezone_name or getattr(user, "timezone", None),
            )
            result = await session.execute(
                select(ReportScheduleDB)
                .where(ReportScheduleDB.user_id == user_id)
                .order_by(ReportScheduleDB.cadence.asc(), ReportScheduleDB.created_at.asc())
            )
            return [self._schedule_to_schema(item) for item in result.scalars().all()]

    async def list_runs(self, user_id: str, limit: int = 12) -> List[HabitReportRunRead]:
        async with get_db_session() as session:
            result = await session.execute(
                select(ReportRunDB)
                .where(ReportRunDB.user_id == user_id)
                .order_by(desc(ReportRunDB.created_at))
                .limit(limit)
            )
            return [self._run_to_schema(item) for item in result.scalars().all()]

    async def create_schedule(
        self,
        *,
        user_id: str,
        email: Optional[str],
        timezone_name: Optional[str],
        payload: HabitReportScheduleCreate,
    ) -> HabitReportScheduleRead:
        async with get_db_session() as session:
            user = await session.get(UserDB, user_id)
            await self._ensure_default_schedules(
                session=session,
                user_id=user_id,
                email=email or getattr(user, "email", None),
                timezone_name=timezone_name or getattr(user, "timezone", None),
            )
            normalized_timezone = self._normalize_timezone(payload.timezone)
            next_run_at = None
            if payload.status == "scheduled":
                next_run_at = self._compute_next_run(
                    cadence=payload.cadence,
                    timezone_name=normalized_timezone,
                    send_hour_local=payload.send_hour_local,
                    send_minute_local=payload.send_minute_local,
                    send_weekday=payload.send_weekday,
                    send_day_of_month=payload.send_day_of_month,
                )
            schedule = ReportScheduleDB(
                id=str(uuid4()),
                user_id=user_id,
                name=payload.name,
                cadence=payload.cadence,
                status=payload.status,
                timezone=normalized_timezone,
                delivery_channel=payload.delivery_channel,
                delivery_label=payload.delivery_label
                or self._build_delivery_label(
                    cadence=payload.cadence,
                    send_hour_local=payload.send_hour_local,
                    send_minute_local=payload.send_minute_local,
                    send_weekday=payload.send_weekday,
                    send_day_of_month=payload.send_day_of_month,
                ),
                send_hour_local=payload.send_hour_local,
                send_minute_local=payload.send_minute_local,
                send_weekday=payload.send_weekday,
                send_day_of_month=payload.send_day_of_month,
                recipients_json=json.dumps([item.model_dump() for item in payload.recipients]),
                sections_json=json.dumps(payload.sections),
                next_run_at=next_run_at,
            )
            session.add(schedule)
            await session.commit()
            await session.refresh(schedule)
            return self._schedule_to_schema(schedule)

    async def update_schedule(
        self,
        *,
        user_id: str,
        schedule_id: str,
        payload: HabitReportScheduleUpdate,
    ) -> HabitReportScheduleRead:
        async with get_db_session() as session:
            result = await session.execute(
                select(ReportScheduleDB).where(
                    ReportScheduleDB.id == schedule_id,
                    ReportScheduleDB.user_id == user_id,
                )
            )
            schedule = result.scalar_one_or_none()
            if schedule is None:
                raise ValueError("Report schedule not found")

            updates = payload.model_dump(exclude_unset=True)
            for field in ("name", "cadence", "status", "send_hour_local", "send_minute_local", "send_weekday", "send_day_of_month"):
                if field in updates:
                    setattr(schedule, field, updates[field])

            if "timezone" in updates:
                schedule.timezone = self._normalize_timezone(updates["timezone"])
            if "delivery_label" in updates and updates["delivery_label"]:
                schedule.delivery_label = updates["delivery_label"]
            if "recipients" in updates and updates["recipients"] is not None:
                schedule.recipients_json = json.dumps([item.model_dump() for item in payload.recipients or []])
            if "sections" in updates and updates["sections"] is not None:
                schedule.sections_json = json.dumps(payload.sections or [])

            if "delivery_label" not in updates:
                schedule.delivery_label = self._build_delivery_label(
                    cadence=schedule.cadence,
                    send_hour_local=int(schedule.send_hour_local or 0),
                    send_minute_local=int(schedule.send_minute_local or 0),
                    send_weekday=schedule.send_weekday,
                    send_day_of_month=schedule.send_day_of_month,
                )

            if schedule.status == "scheduled":
                schedule.next_run_at = self._compute_next_run(
                    cadence=schedule.cadence,
                    timezone_name=schedule.timezone,
                    send_hour_local=int(schedule.send_hour_local or 0),
                    send_minute_local=int(schedule.send_minute_local or 0),
                    send_weekday=schedule.send_weekday,
                    send_day_of_month=schedule.send_day_of_month,
                )
            else:
                schedule.next_run_at = None

            schedule.updated_at = _utc_now()
            await session.commit()
            await session.refresh(schedule)
            return self._schedule_to_schema(schedule)

    async def _get_schedule(self, session, *, user_id: str, schedule_id: str) -> Optional[ReportScheduleDB]:
        result = await session.execute(
            select(ReportScheduleDB).where(
                ReportScheduleDB.id == schedule_id,
                ReportScheduleDB.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    def _format_metric_value(self, value: float, unit: str) -> str:
        unit_lower = (unit or "").lower()
        if unit_lower in {"steps", "pages", "sessions", "count", "bpm"}:
            return f"{round(value):,}"
        if unit_lower in {"miles", "kilometers", "dollars", "mg"}:
            return f"{value:,.1f}".rstrip("0").rstrip(".")
        if unit_lower in {"hours", "minutes"}:
            return f"{value:,.2f}".rstrip("0").rstrip(".")
        if abs(value - round(value)) < 0.0001:
            return f"{round(value):,}"
        return f"{value:,.1f}".rstrip("0").rstrip(".")

    def _build_streaks(self, daily_values: Dict[str, Dict[str, Any]], end_date: date) -> int:
        active_dates = {date.fromisoformat(day) for day in daily_values.keys()}
        streak = 0
        cursor = end_date
        while cursor in active_dates:
            streak += 1
            cursor -= timedelta(days=1)
        return streak

    async def _generate_preview(
        self,
        *,
        session,
        user: UserDB,
        schedule: ReportScheduleDB,
        run: ReportRunDB,
    ) -> HabitReportPreview:
        window = self._resolve_window(schedule.cadence, schedule.timezone, datetime.now(timezone.utc))

        habits_result = await session.execute(
            select(HabitDB).where(HabitDB.user_id == user.id).order_by(HabitDB.name.asc())
        )
        habits = habits_result.scalars().all()
        habit_ids = [habit.id for habit in habits]

        logs_result = await session.execute(
            select(HabitLogDB).where(
                and_(
                    HabitLogDB.habit_id.in_(habit_ids or [""]),
                    self._completed_log_filter(),
                    HabitLogDB.date >= window.start_date.isoformat(),
                    HabitLogDB.date <= window.end_date.isoformat(),
                )
            )
        )
        logs = logs_result.scalars().all()

        streak_window_start = max(window.start_date - timedelta(days=90), date(2020, 1, 1))
        streak_logs_result = await session.execute(
            select(HabitLogDB).where(
                and_(
                    HabitLogDB.habit_id.in_(habit_ids or [""]),
                    self._completed_log_filter(),
                    HabitLogDB.date >= streak_window_start.isoformat(),
                    HabitLogDB.date <= window.end_date.isoformat(),
                )
            )
        )
        streak_logs = streak_logs_result.scalars().all()

        by_habit_logs: Dict[str, List[HabitLogDB]] = {}
        for log in logs:
            by_habit_logs.setdefault(log.habit_id, []).append(log)

        by_habit_streak_logs: Dict[str, List[HabitLogDB]] = {}
        for log in streak_logs:
            by_habit_streak_logs.setdefault(log.habit_id, []).append(log)

        habit_metrics: List[Dict[str, Any]] = []
        for habit in habits:
            daily_values = analytics_service._aggregate_by_date(habit, by_habit_logs.get(habit.id, []))
            streak_values = analytics_service._aggregate_by_date(habit, by_habit_streak_logs.get(habit.id, []))
            total = float(sum(item["value"] for item in daily_values.values()))
            days_with_data = len(daily_values)
            if days_with_data == 0:
                streak = 0
            else:
                streak = self._build_streaks(streak_values, window.end_date)
            habit_metrics.append(
                {
                    "id": habit.id,
                    "name": habit.name,
                    "unit": habit.unit_type or "sessions",
                    "total": total,
                    "days_with_data": days_with_data,
                    "streak": streak,
                }
            )

        habit_metrics.sort(key=lambda item: (item["total"], item["days_with_data"]), reverse=True)
        top_with_data = [item for item in habit_metrics if item["days_with_data"] > 0]
        most_consistent = max(habit_metrics, key=lambda item: item["days_with_data"], default=None)
        strongest_streak = max(habit_metrics, key=lambda item: item["streak"], default=None)

        active_wearables_result = await session.execute(
            select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == user.id,
                WearableConnectionDB.status == "active",
            )
        )
        active_wearables = active_wearables_result.scalars().all()

        metrics: List[HabitReportMetric] = []
        for item in top_with_data[:4]:
            metrics.append(
                HabitReportMetric(
                    label=item["name"],
                    value=self._format_metric_value(item["total"], item["unit"]),
                    unit=item["unit"],
                )
            )

        if not metrics:
            metrics.append(
                HabitReportMetric(
                    label="No logged habits",
                    value="0",
                    unit="entries",
                )
            )

        highlights: List[str] = []
        if top_with_data and ("highlights" in self._parse_json(schedule.sections_json, [])):
            leader = top_with_data[0]
            highlights.append(
                f"{leader['name']} led this {schedule.cadence} window with {self._format_metric_value(leader['total'], leader['unit'])} {leader['unit'].lower()} logged."
            )
        if most_consistent and most_consistent["days_with_data"] > 0 and ("consistency" in self._parse_json(schedule.sections_json, [])):
            highlights.append(
                f"{most_consistent['name']} was the most consistent habit, showing up on {most_consistent['days_with_data']} of {window.day_count} days."
            )
        if strongest_streak and strongest_streak["streak"] > 1 and ("streaks" in self._parse_json(schedule.sections_json, [])):
            highlights.append(
                f"{strongest_streak['name']} is carrying a {strongest_streak['streak']}-day streak into the next window."
            )
        if "missed-habits" in self._parse_json(schedule.sections_json, []) and habit_metrics:
            missed = [item["name"] for item in habit_metrics if item["days_with_data"] == 0][:3]
            if missed:
                highlights.append(
                    f"No logs landed for {', '.join(missed)} during this window."
                )
        if "computer-activity" in self._parse_json(schedule.sections_json, []):
            computer_habit = next((item for item in habit_metrics if item["name"].strip().lower() == "computer time"), None)
            if computer_habit and computer_habit["total"] > 0:
                highlights.append(
                    f"Computer Time totaled {self._format_metric_value(computer_habit['total'], computer_habit['unit'])} {computer_habit['unit'].lower()}."
                )
        if "wearables" in self._parse_json(schedule.sections_json, []) and active_wearables:
            highlights.append(
                f"{len(active_wearables)} wearable integration{'s are' if len(active_wearables) != 1 else ' is'} active and contributing data."
            )

        if not highlights:
            highlights.append(
                f"This {schedule.cadence} window is ready. Ritual will keep generating cleaner summaries as more report data flows in."
            )

        first_name = ((user.full_name or "").strip().split(" ")[0] or "there").strip()
        summary = highlights[0]
        if len(highlights) > 1:
            summary = f"{highlights[0]} {highlights[1]}"

        return HabitReportPreview(
            subject=f"Your {schedule.cadence} Ritual report is ready",
            preheader=f"Highlights and consistency notes for {window.label}.",
            title=f"Your {schedule.cadence.capitalize()} Ritual report",
            period_label=window.label,
            intro_line=f"Hi {first_name}, here's what your habits looked like across {window.label}.",
            summary=summary,
            metrics=metrics,
            highlights=highlights[:4],
            cta_label="Open Ritual",
            cta_url=DEFAULT_REPORTS_ROUTE,
        )

    async def _send_email(
        self,
        *,
        recipient_email: str,
        preview: HabitReportPreview,
    ) -> Dict[str, Any]:
        if not INTERNAL_BACKEND_TOKEN:
            raise RuntimeError("INTERNAL_BACKEND_TOKEN is required for report email delivery")

        url = f"{DASHBOARD_BASE_URL}/api/reports/send"
        async with httpx.AsyncClient(timeout=REPORTS_DELIVERY_TIMEOUT) as client:
            response = await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "x-backend-token": INTERNAL_BACKEND_TOKEN,
                },
                json={
                    "recipientEmail": recipient_email,
                    "preview": preview.model_dump(mode="json"),
                },
            )

        if response.status_code != 200:
            raise RuntimeError(f"Dashboard email delivery route returned {response.status_code}: {response.text[:300]}")

        return response.json()

    async def _process_run(self, *, session, run: ReportRunDB, schedule: ReportScheduleDB, user: UserDB) -> HabitReportDispatchResponse:
        run.status = "processing"
        run.updated_at = _utc_now()
        await session.commit()

        preview = await self._generate_preview(session=session, user=user, schedule=schedule, run=run)
        run.subject = preview.subject
        run.summary_json = json.dumps(preview.model_dump(mode="json"))
        run.generated_at = _utc_now()
        run.email_html = None
        await artifact_service.ensure_report_run_artifact(session, run=run, schedule=schedule)

        recipients = [HabitReportRecipient.model_validate(item) for item in self._parse_json(schedule.recipients_json, [])]
        notifications: List[ReportNotificationDB] = []

        for recipient in recipients:
            notification = ReportNotificationDB(
                id=str(uuid4()),
                report_run_id=run.id,
                user_id=user.id,
                channel="email",
                recipient_email=recipient.email,
                status="queued",
                payload_json=json.dumps({"subject": preview.subject, "preview": preview.model_dump(mode="json")}),
            )
            session.add(notification)
            notifications.append(notification)

        await session.commit()

        try:
            for notification in notifications:
                delivery = await self._send_email(
                    recipient_email=notification.recipient_email,
                    preview=preview,
                )
                notification.status = "sent"
                notification.provider_message_id = delivery.get("messageId")
                notification.sent_at = _utc_now()
                notification.updated_at = _utc_now()

            run.status = "sent"
            run.sent_at = _utc_now()
            run.updated_at = _utc_now()
            schedule.last_sent_at = run.sent_at
            schedule.last_error = None
            await session.commit()
        except Exception as exc:
            run.status = "failed"
            run.error_json = json.dumps({"error": str(exc)})
            run.updated_at = _utc_now()
            schedule.last_error = str(exc)
            for notification in notifications:
                if notification.status == "queued":
                    notification.status = "failed"
                    notification.updated_at = _utc_now()
            await session.commit()
            logger.exception("Report delivery failed for run %s: %s", run.id, exc)

        await session.refresh(run)
        await session.refresh(schedule)
        for notification in notifications:
            await session.refresh(notification)

        return HabitReportDispatchResponse(
            schedule=self._schedule_to_schema(schedule),
            run=self._run_to_schema(run),
            notifications=[self._notification_to_schema(item) for item in notifications],
        )

    async def dispatch_schedule(
        self,
        *,
        user_id: str,
        schedule_id: str,
    ) -> HabitReportDispatchResponse:
        async with get_db_session() as session:
            schedule = await self._get_schedule(session, user_id=user_id, schedule_id=schedule_id)
            if schedule is None:
                raise ValueError("Report schedule not found")

            user = await session.get(UserDB, user_id)
            if user is None:
                raise ValueError("User not found")

            window = self._resolve_window(schedule.cadence, schedule.timezone)
            run = ReportRunDB(
                id=str(uuid4()),
                schedule_id=schedule.id,
                user_id=user_id,
                cadence=schedule.cadence,
                status="queued",
                period_start=window.start_date.isoformat(),
                period_end=window.end_date.isoformat(),
            )
            session.add(run)
            schedule.next_run_at = (
                self._compute_next_run(
                    cadence=schedule.cadence,
                    timezone_name=schedule.timezone,
                    send_hour_local=int(schedule.send_hour_local or 0),
                    send_minute_local=int(schedule.send_minute_local or 0),
                    send_weekday=schedule.send_weekday,
                    send_day_of_month=schedule.send_day_of_month,
                )
                if schedule.status == "scheduled"
                else None
            )
            await session.commit()
            await session.refresh(run)
            await session.refresh(schedule)
            return await self._process_run(session=session, run=run, schedule=schedule, user=user)

    async def dispatch_due_schedules(self) -> Dict[str, int]:
        now_utc = _utc_now()
        queued = 0

        async with get_db_session() as session:
            result = await session.execute(
                select(ReportScheduleDB).where(
                    ReportScheduleDB.status == "scheduled",
                    ReportScheduleDB.next_run_at.is_not(None),
                    ReportScheduleDB.next_run_at <= now_utc,
                )
            )
            schedules = result.scalars().all()
            if not schedules:
                return {"queued": 0}

            for schedule in schedules:
                window = self._resolve_window(schedule.cadence, schedule.timezone, now_utc.replace(tzinfo=timezone.utc))
                existing_result = await session.execute(
                    select(ReportRunDB.id).where(
                        ReportRunDB.schedule_id == schedule.id,
                        ReportRunDB.period_start == window.start_date.isoformat(),
                        ReportRunDB.period_end == window.end_date.isoformat(),
                    )
                )
                if existing_result.first():
                    schedule.next_run_at = self._compute_next_run(
                        cadence=schedule.cadence,
                        timezone_name=schedule.timezone,
                        send_hour_local=int(schedule.send_hour_local or 0),
                        send_minute_local=int(schedule.send_minute_local or 0),
                        send_weekday=schedule.send_weekday,
                        send_day_of_month=schedule.send_day_of_month,
                        reference_utc=(now_utc + timedelta(minutes=1)).replace(tzinfo=timezone.utc),
                    )
                    continue

                run = ReportRunDB(
                    id=str(uuid4()),
                    schedule_id=schedule.id,
                    user_id=schedule.user_id,
                    cadence=schedule.cadence,
                    status="queued",
                    period_start=window.start_date.isoformat(),
                    period_end=window.end_date.isoformat(),
                )
                session.add(run)
                schedule.next_run_at = self._compute_next_run(
                    cadence=schedule.cadence,
                    timezone_name=schedule.timezone,
                    send_hour_local=int(schedule.send_hour_local or 0),
                    send_minute_local=int(schedule.send_minute_local or 0),
                    send_weekday=schedule.send_weekday,
                    send_day_of_month=schedule.send_day_of_month,
                    reference_utc=(now_utc + timedelta(minutes=1)).replace(tzinfo=timezone.utc),
                )
                queued += 1

            await session.commit()

        return {"queued": queued}

    async def process_queued_runs(self, limit: int = 10) -> Dict[str, int]:
        processed = 0
        failed = 0

        async with get_db_session() as session:
            result = await session.execute(
                select(ReportRunDB)
                .where(ReportRunDB.status == "queued")
                .order_by(ReportRunDB.created_at.asc())
                .limit(limit)
            )
            runs = result.scalars().all()

            for run in runs:
                schedule = await session.get(ReportScheduleDB, run.schedule_id)
                user = await session.get(UserDB, run.user_id)
                if schedule is None or user is None:
                    run.status = "failed"
                    run.error_json = json.dumps({"error": "Missing schedule or user"})
                    failed += 1
                    continue
                dispatch = await self._process_run(session=session, run=run, schedule=schedule, user=user)
                if dispatch.run.status == "failed":
                    failed += 1
                else:
                    processed += 1

            await session.commit()

        return {"processed": processed, "failed": failed}

    async def scheduler_tick(self) -> Dict[str, int]:
        dispatch = await self.dispatch_due_schedules()
        processed = await self.process_queued_runs()
        return {
            "queued": int(dispatch.get("queued", 0)),
            "processed": int(processed.get("processed", 0)),
            "failed": int(processed.get("failed", 0)),
        }


reports_service = ReportsService()
