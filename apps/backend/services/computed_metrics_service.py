"""Read-only providers for system-derived habit metrics.

Computer Time is backed by acknowledged watcher rollups, not habit_logs.  This
module is the single backend adapter used by analytics, reports, chat-facing
summaries, and workflow consumers so historical projection rows cannot become
authoritative again by accident.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

COMPUTER_TIME_METRIC_TYPE = "computer_time"
COMPUTER_TIME_LEGACY_NAMES = {
    "computer activity",
    "computer time",
    "computer use",
}


def is_computed_computer_time_habit(habit: Any) -> bool:
    metric_type = str(getattr(habit, "metric_type", "") or "").strip().lower()
    if metric_type:
        return metric_type == COMPUTER_TIME_METRIC_TYPE

    # One-release compatibility path for canonical, non-custom legacy habits.
    # An arbitrary custom habit with a similar name must remain user-writable.
    if getattr(habit, "is_custom", None) is not False:
        return False
    name = " ".join(str(getattr(habit, "name", "") or "").strip().lower().split())
    integration_source = str(
        getattr(habit, "integration_source", "") or ""
    ).strip().lower()
    sensor_type = str(getattr(habit, "sensor_type", "") or "").strip().lower()
    return (
        name in COMPUTER_TIME_LEGACY_NAMES
        and integration_source in {"", "ritual_watcher"}
        and sensor_type in {"", "automatic"}
    )


class ComputedMetricsService:
    async def read_computer_time_range(
        self,
        *,
        user_id: str,
        start_date: str,
        end_date: str,
    ) -> Dict[str, Any]:
        from services.watcher_service import watcher_service

        try:
            snapshot = await watcher_service.get_computer_activity_snapshot(
                user_id=user_id,
                start_date=start_date,
                end_date=end_date,
                limit=10,
            )
        except Exception as exc:
            logger.warning("Computed Computer Time provider unavailable: %s", exc)
            return {
                "state": "unavailable",
                "available": False,
                "empty_reason": "aggregation_unavailable",
                "last_synced_at": None,
                "summary": {},
                "daily": [],
            }

        summary = dict(snapshot.get("summary") or {})
        daily = list(snapshot.get("daily") or [])
        total_active_ms = int(summary.get("total_active_ms") or 0)
        state = str(snapshot.get("state") or "unavailable")
        # A nonzero rollup remains valid while newer replication is pending.
        available = total_active_ms > 0 or state == "empty"
        return {
            "state": state,
            "available": available,
            "empty_reason": snapshot.get("empty_reason"),
            "last_synced_at": snapshot.get("last_synced_at"),
            "summary": summary,
            "daily": daily,
        }

    async def build_habit_stats(
        self,
        *,
        user_id: str,
        habit: Any,
        start_date: str,
        end_date: str,
    ) -> Dict[str, Any]:
        result = await self.read_computer_time_range(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )
        if not result["available"]:
            return {
                "id": habit.id,
                "name": habit.name,
                "category": habit.category,
                "unit": "Hours",
                "total": None,
                "average": None,
                "min": None,
                "max": None,
                "variance": None,
                "std_dev": None,
                "days_with_data": 0,
                "total_entries": 0,
                "state": result["state"],
                "empty_reason": result["empty_reason"],
                "summary": "Computer Time is unavailable for this period",
            }

        values = [
            float(row.get("active_ms") or 0) / 3_600_000
            for row in result["daily"]
            if float(row.get("active_ms") or 0) > 0
        ]
        total = float(result["summary"].get("total_active_ms") or 0) / 3_600_000
        average = total / len(values) if values else 0.0
        variance = (
            sum((value - average) ** 2 for value in values) / len(values)
            if values
            else 0.0
        )
        return {
            "id": habit.id,
            "name": habit.name,
            "category": habit.category,
            "unit": "Hours",
            "total": round(total, 2),
            "average": round(average, 2),
            "min": round(min(values), 2) if values else 0,
            "max": round(max(values), 2) if values else 0,
            "variance": round(variance, 2),
            "std_dev": round(variance ** 0.5, 2),
            "days_with_data": len(values),
            "total_entries": int(result["summary"].get("total_events") or 0),
            "state": result["state"],
            "empty_reason": result["empty_reason"],
            "last_synced_at": result["last_synced_at"],
            "summary": (
                "No data for this period"
                if not values
                else f"{round(total, 1)} Hours total, {round(average, 1)} Hours/day avg over {len(values)} days"
            ),
        }

    async def build_daily_breakdown(
        self,
        *,
        user_id: str,
        habit: Any,
        start_date: str,
        end_date: str,
    ) -> Dict[str, Any]:
        result = await self.read_computer_time_range(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )
        rows = []
        if result["available"]:
            rows = [
                {
                    "date": str(row.get("day") or row.get("date") or ""),
                    "total_hours": round(float(row.get("active_ms") or 0) / 3_600_000, 2),
                    "total_duration_seconds": round(float(row.get("active_ms") or 0) / 1_000),
                    "total_amount": None,
                    "value": round(float(row.get("active_ms") or 0) / 3_600_000, 2),
                    "unit": "Hours",
                    "entries": [],
                }
                for row in result["daily"]
                if str(row.get("day") or row.get("date") or "")
                and float(row.get("active_ms") or 0) > 0
            ]
        total = (
            round(float(result["summary"].get("total_active_ms") or 0) / 3_600_000, 2)
            if result["available"]
            else None
        )
        return {
            "success": True,
            "habit": {
                "id": habit.id,
                "name": habit.name,
                "unit": "Hours",
                "category": habit.category,
            },
            "date_range": {"start": start_date, "end": end_date},
            "days_with_data": len(rows),
            "total": total,
            "average_per_day": round(total / len(rows), 2) if total is not None and rows else (0 if result["available"] else None),
            "sync_context": None,
            "state": result["state"],
            "empty_reason": result["empty_reason"],
            "last_synced_at": result["last_synced_at"],
            "data": rows,
        }

    async def build_summary_row(
        self,
        *,
        user_id: str,
        habit: Any,
        start_date: Optional[str],
        end_date: Optional[str],
        days_back: int,
        custom_range: bool,
    ) -> Dict[str, Any]:
        resolved_end = date.fromisoformat(end_date) if end_date else date.today()
        resolved_start = (
            date.fromisoformat(start_date)
            if start_date
            else resolved_end - timedelta(days=max(1, days_back) - 1)
        )
        result = await self.read_computer_time_range(
            user_id=user_id,
            start_date=resolved_start.isoformat(),
            end_date=resolved_end.isoformat(),
        )
        total = (
            round(float(result["summary"].get("total_active_ms") or 0) / 3_600_000, 2)
            if result["available"]
            else None
        )
        days = sum(
            1 for row in result["daily"] if float(row.get("active_ms") or 0) > 0
        )
        base = {
            "habit_id": habit.id,
            "habit_name": habit.name,
            "unit": "Hours",
            "days_with_data": days,
            "total_amount": total,
            "avg_amount": round(total / days, 2) if total is not None and days else (0 if result["available"] else None),
            "state": result["state"],
            "empty_reason": result["empty_reason"],
            "last_synced_at": result["last_synced_at"],
            "computed_metric": True,
        }
        if custom_range:
            base.update(
                {
                    "first_date": resolved_start.isoformat(),
                    "last_date": resolved_end.isoformat(),
                    "total_duration": round((total or 0) * 3_600) if result["available"] else None,
                    "avg_duration": round((total or 0) * 3_600 / days) if result["available"] and days else (0 if result["available"] else None),
                    "period_start": resolved_start.isoformat(),
                    "period_end": resolved_end.isoformat(),
                    "period_days": (resolved_end - resolved_start).days + 1,
                }
            )
        else:
            base.update(
                {
                    "total_logs": int(result["summary"].get("total_events") or 0),
                    "completed_count": int(result["summary"].get("total_events") or 0),
                    "last_completed_date": max(
                        (
                            str(row.get("day") or row.get("date") or "")
                            for row in result["daily"]
                            if float(row.get("active_ms") or 0) > 0
                        ),
                        default=None,
                    ),
                    "first_log_date": min(
                        (
                            str(row.get("day") or row.get("date") or "")
                            for row in result["daily"]
                            if float(row.get("active_ms") or 0) > 0
                        ),
                        default=None,
                    ),
                }
            )
        return base


computed_metrics_service = ComputedMetricsService()
