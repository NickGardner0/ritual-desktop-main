"""Canonical backend read models for dashboard screens.

These responses are intentionally screen-shaped. React may still format and
filter them, but aggregation and source precedence live here.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_, select

from database.connection import get_db_session
from database.helpers import habit_db_to_pydantic, habit_log_db_to_pydantic
from database.models import HabitDB, HabitLogDB, MetricDailyFactDB, ScheduledBlockDB


def _utc_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _default_range(days_back: int = 30) -> tuple[str, str]:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=max(1, days_back) - 1)
    return start.isoformat(), end.isoformat()


def _resolve_range(
    start_date: Optional[str],
    end_date: Optional[str],
    *,
    days_back: int,
) -> tuple[str, str]:
    if start_date and end_date:
        return start_date[:10], end_date[:10]
    return _default_range(days_back)


def _range_key(start: str, end: str, *, explicit: bool) -> str:
    return f"{start}:{end}" if explicit else "default"


def _split_csv(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def _read_model_meta(
    *,
    user_id: str,
    start: str,
    end: str,
    source: str,
    explicit: bool,
    warnings: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return {
        "userId": user_id,
        "generatedAt": _utc_ms(),
        "rangeKey": _range_key(start, end, explicit=explicit),
        "startDate": start,
        "endDate": end,
        "source": source,
        "partial": False,
        "warnings": warnings or [],
    }


class ScreenReadModelsService:
    async def get_logs_read_model(
        self,
        *,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
        habit_id: Optional[str] = None,
        q: Optional[str] = None,
        categories: Optional[str] = None,
        habits: Optional[str] = None,
        statuses: Optional[str] = None,
        sources: Optional[str] = None,
        sort: Optional[str] = None,
        order: Optional[str] = None,
    ) -> Dict[str, Any]:
        start, end = _resolve_range(start_date, end_date, days_back=30)
        explicit = bool(start_date and end_date)
        limit = max(1, min(int(limit or 200), 500))
        offset = max(0, int(offset or 0))

        async with get_db_session() as session:
            habit_rows = list(
                (
                    await session.execute(
                        select(HabitDB)
                        .where(HabitDB.user_id == user_id)
                        .order_by(HabitDB.created_at.asc())
                    )
                )
                .scalars()
                .all()
            )
            requested_habits = _split_csv(habits)
            requested_categories = _split_csv(categories)
            requested_statuses = _split_csv(statuses)
            requested_sources = _split_csv(sources)

            conditions = [
                HabitDB.user_id == user_id,
                HabitLogDB.date >= start,
                HabitLogDB.date <= end,
            ]
            if habit_id:
                conditions.append(HabitLogDB.habit_id == habit_id)
            if requested_habits:
                conditions.append(
                    or_(
                        HabitLogDB.habit_id.in_(requested_habits),
                        HabitDB.name.in_(requested_habits),
                    )
                )
            if requested_categories:
                conditions.append(HabitDB.category.in_(requested_categories))
            if requested_statuses:
                conditions.append(HabitLogDB.status.in_(requested_statuses))
            if requested_sources:
                conditions.append(HabitLogDB.source.in_(requested_sources))
            if q:
                needle = f"%{q.strip()}%"
                conditions.append(
                    or_(
                        HabitLogDB.habit_name.ilike(needle),
                        HabitLogDB.notes.ilike(needle),
                        HabitLogDB.source.ilike(needle),
                        HabitDB.name.ilike(needle),
                    )
                )

            order_desc = (order or "desc").lower() != "asc"
            if sort == "habit":
                ordering = [HabitDB.name.desc() if order_desc else HabitDB.name.asc()]
            elif sort == "value":
                ordering = [
                    func.coalesce(HabitLogDB.amount, HabitLogDB.duration, 0).desc()
                    if order_desc
                    else func.coalesce(HabitLogDB.amount, HabitLogDB.duration, 0).asc()
                ]
            elif sort == "source":
                ordering = [HabitLogDB.source.desc() if order_desc else HabitLogDB.source.asc()]
            else:
                ordering = [
                    HabitLogDB.date.desc() if order_desc else HabitLogDB.date.asc(),
                    HabitLogDB.completed_at.desc() if order_desc else HabitLogDB.completed_at.asc(),
                    HabitLogDB.id.desc() if order_desc else HabitLogDB.id.asc(),
                ]

            logs_query = (
                select(HabitLogDB)
                .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
                .where(*conditions)
                .order_by(*ordering)
            )

            total_query = (
                select(func.count(HabitLogDB.id))
                .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
                .where(*conditions)
            )

            total = int((await session.execute(total_query)).scalar() or 0)
            logs = list((await session.execute(logs_query.offset(offset).limit(limit))).scalars().all())

            iphone_facts = list(
                (
                    await session.execute(
                        select(MetricDailyFactDB)
                        .where(
                            MetricDailyFactDB.user_id == user_id,
                            MetricDailyFactDB.metric_key == "iphone_time",
                            MetricDailyFactDB.date >= start,
                            MetricDailyFactDB.date <= end,
                            MetricDailyFactDB.value > 0,
                        )
                        .order_by(MetricDailyFactDB.date.desc())
                    )
                )
                .scalars()
                .all()
            )

        rows = [habit_log_db_to_pydantic(log).model_dump(mode="json") for log in logs]
        rollup_rows = [
            {
                "id": f"rollup:iphone_time:{fact.date}",
                "habit_id": fact.habit_id,
                "habit_name": fact.habit_name or "iPhone Time",
                "date": fact.date,
                "completed_at": f"{fact.date}T23:59:59",
                "duration": int(float(fact.value or 0.0) * 3600),
                "amount": float(fact.value or 0.0),
                "status": "completed",
                "source": "biome_iphone_rollup",
                "unit": fact.unit,
                "editable": False,
                "readOnly": True,
            }
            for fact in iphone_facts
        ]
        source_counts = Counter(str(row.get("source") or "manual") for row in rows)
        for row in rollup_rows:
            source_counts[str(row["source"])] += 1

        return {
            "rows": rows + rollup_rows,
            "rollups": {"iphoneTime": rollup_rows},
            "pagination": {
                "limit": limit,
                "offset": offset,
                "total": total,
                "hasMore": offset + len(rows) < total,
            },
            "filters": {
                "startDate": start,
                "endDate": end,
                "habitId": habit_id,
                "q": q,
                "categories": requested_categories,
                "habits": requested_habits,
                "statuses": requested_statuses,
                "sources": requested_sources,
                "sort": sort,
                "order": order,
            },
            "sourceCounts": dict(source_counts),
            "availableHabits": [habit_db_to_pydantic(habit).model_dump(mode="json") for habit in habit_rows],
            "categories": sorted({habit.category for habit in habit_rows if habit.category}),
            "meta": _read_model_meta(
                user_id=user_id,
                start=start,
                end=end,
                source="habit_logs_with_metric_fact_rollups",
                explicit=explicit,
            ),
        }

    async def get_calendar_read_model(
        self,
        *,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> Dict[str, Any]:
        start, end = _resolve_range(start_date, end_date, days_back=42)
        explicit = bool(start_date and end_date)

        async with get_db_session() as session:
            habits = list(
                (
                    await session.execute(
                        select(HabitDB)
                        .where(HabitDB.user_id == user_id)
                        .order_by(HabitDB.created_at.asc())
                    )
                )
                .scalars()
                .all()
            )
            habit_ids = [habit.id for habit in habits if habit.id]
            logs = list(
                (
                    await session.execute(
                        select(HabitLogDB)
                        .where(
                            HabitLogDB.habit_id.in_(habit_ids or ["__none__"]),
                            HabitLogDB.date >= start,
                            HabitLogDB.date <= end,
                        )
                        .order_by(HabitLogDB.date.asc(), HabitLogDB.completed_at.asc())
                    )
                )
                .scalars()
                .all()
            )
            scheduled_blocks = list(
                (
                    await session.execute(
                        select(ScheduledBlockDB)
                        .where(
                            ScheduledBlockDB.user_id == user_id,
                            ScheduledBlockDB.day >= start,
                            ScheduledBlockDB.day <= end,
                        )
                        .order_by(ScheduledBlockDB.day.asc(), ScheduledBlockDB.start_minutes.asc())
                    )
                )
                .scalars()
                .all()
            )
            facts = list(
                (
                    await session.execute(
                        select(MetricDailyFactDB)
                        .where(
                            MetricDailyFactDB.user_id == user_id,
                            MetricDailyFactDB.date >= start,
                            MetricDailyFactDB.date <= end,
                        )
                        .order_by(MetricDailyFactDB.date.asc(), MetricDailyFactDB.habit_name.asc())
                    )
                )
                .scalars()
                .all()
            )

        logs_by_day: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for log in logs:
            logs_by_day[(log.date or "")[:10]].append(habit_log_db_to_pydantic(log).model_dump(mode="json"))

        facts_by_day: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for fact in facts:
            facts_by_day[fact.date].append(
                {
                    "habit_id": fact.habit_id,
                    "habit_name": fact.habit_name,
                    "metric_key": fact.metric_key,
                    "value": float(fact.value or 0.0),
                    "unit": fact.unit,
                    "source": fact.provider or fact.source_family,
                    "source_family": fact.source_family,
                }
            )

        blocks_by_day: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for block in scheduled_blocks:
            blocks_by_day[block.day].append(
                {
                    "id": block.id,
                    "user_id": block.user_id,
                    "title": block.title,
                    "notes": block.notes,
                    "day": block.day,
                    "start_minutes": int(block.start_minutes),
                    "end_minutes": int(block.end_minutes),
                    "created_at": block.created_at.isoformat() if block.created_at else None,
                    "updated_at": block.updated_at.isoformat() if block.updated_at else None,
                }
            )

        days: List[Dict[str, Any]] = []
        current = datetime.strptime(start, "%Y-%m-%d").date()
        final = datetime.strptime(end, "%Y-%m-%d").date()
        while current <= final:
            day = current.isoformat()
            day_facts = facts_by_day.get(day, [])
            days.append(
                {
                    "date": day,
                    "habitLogs": logs_by_day.get(day, []),
                    "scheduledBlocks": blocks_by_day.get(day, []),
                    "metricFacts": day_facts,
                    "summary": {
                        "logCount": len(logs_by_day.get(day, [])),
                        "scheduledBlockCount": len(blocks_by_day.get(day, [])),
                        "metricFactCount": len(day_facts),
                        "totalFactValue": sum(float(fact.get("value") or 0.0) for fact in day_facts),
                    },
                }
            )
            current += timedelta(days=1)

        return {
            "days": days,
            "habitLogs": [habit_log_db_to_pydantic(log).model_dump(mode="json") for log in logs],
            "scheduledBlocks": [block for day in blocks_by_day.values() for block in day],
            "habits": [habit_db_to_pydantic(habit).model_dump(mode="json") for habit in habits],
            "meta": _read_model_meta(
                user_id=user_id,
                start=start,
                end=end,
                source="calendar_read_model",
                explicit=explicit,
            ),
        }


screen_read_models_service = ScreenReadModelsService()
