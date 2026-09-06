"""Normalized habit + wearable timeline used by metrics expanded views."""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select

from api.wearables_helpers import metric_category, metric_display_name
from database.connection import get_db_session
from database.models import HabitDB
from services.metric_facts_service import metric_fact_service
from services.wearables_unified.singletons import wearable_query_service


def _csv(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def shift_date_key(date_value: str, delta_days: int) -> str:
    anchor = datetime.fromisoformat(f"{date_value}T12:00:00+00:00")
    return (anchor + timedelta(days=delta_days)).date().isoformat()


def parse_completed_at(value: Optional[str]) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    try:
        if "T" in raw:
            has_timezone = raw.endswith("Z") or (
                len(raw) >= 6 and raw[-6] in {"+", "-"} and raw[-3] == ":"
            )
            normalized = raw if has_timezone else f"{raw}Z"
            return datetime.fromisoformat(normalized.replace("Z", "+00:00"))
        if " " in raw:
            return datetime.fromisoformat(raw.replace(" ", "T") + "+00:00")
    except ValueError:
        return None
    return None


def format_date_in_timezone(value: datetime, time_zone: str) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    try:
        return value.astimezone(ZoneInfo(time_zone)).date().isoformat()
    except Exception:
        return value.astimezone(timezone.utc).date().isoformat()


def is_daily_wearable_item(item: Dict[str, Any]) -> bool:
    rollup_level = str(item.get("rollup_level") or "").strip().lower()
    aggregation_kind = str(item.get("aggregation_kind") or "").strip().lower()
    return rollup_level == "daily" or aggregation_kind in {"daily", "daily_aggregate"}


def parse_metadata_object(value: Any) -> Dict[str, Any]:
    if not value:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def build_habit_lookup(habits: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    by_id: Dict[str, Dict[str, Any]] = {}
    by_provider_metric: Dict[str, Dict[str, Any]] = {}
    by_metric: Dict[str, Dict[str, Any]] = {}
    for habit in habits:
        habit_id = str(habit.get("id") or "")
        if habit_id:
            by_id[habit_id] = habit
        metric_type = str(habit.get("metric_type") or "").strip().lower()
        provider = str(habit.get("integration_source") or "").strip().lower()
        if metric_type:
            by_provider_metric.setdefault(f"{provider}:{metric_type}", habit)
            by_metric.setdefault(metric_type, habit)
    return {
        "by_id": by_id,
        "by_provider_metric": by_provider_metric,
        "by_metric": by_metric,
    }


def get_matched_habit(item: Dict[str, Any], lookup: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if item.get("kind") == "habit_log" and item.get("habit_id"):
        return lookup["by_id"].get(str(item["habit_id"]))
    metric_type = str(item.get("metric_type") or item.get("event_type") or "").strip().lower()
    if not metric_type:
        return None
    provider = str(item.get("provider") or "").strip().lower()
    return lookup["by_provider_metric"].get(f"{provider}:{metric_type}") or lookup["by_metric"].get(metric_type)


def timeline_date(item: Dict[str, Any], time_zone: str) -> tuple[str, str]:
    raw_date = str(item.get("attributed_date") or "")[:10]
    if is_daily_wearable_item(item):
        return raw_date, raw_date
    parsed = parse_completed_at(item.get("start_time") or item.get("timestamp"))
    if parsed:
        return format_date_in_timezone(parsed, time_zone), raw_date
    return raw_date, raw_date


def normalize_timeline_item(
    item: Dict[str, Any],
    lookup: Dict[str, Dict[str, Any]],
    time_zone: str,
) -> Optional[Dict[str, Any]]:
    matched = get_matched_habit(item, lookup)
    metric_type = str(
        item.get("metric_type") or item.get("event_type") or (matched or {}).get("metric_type") or ""
    ).strip().lower() or None
    source = str(item.get("provider") or (matched or {}).get("integration_source") or "manual").strip().lower()
    title = (
        (matched or {}).get("name")
        or item.get("habit_name")
        or item.get("title")
        or metric_display_name(metric_type or "metric")
    )
    date_value, raw_date = timeline_date(item, time_zone)
    if not date_value:
        return None

    start = item.get("start_time") or item.get("timestamp")
    end = item.get("end_time") or item.get("start_time") or item.get("timestamp")
    start_date = parse_completed_at(start)
    end_date = parse_completed_at(end)
    duration_seconds = None
    if start_date and end_date:
        duration_seconds = max(0, int(round((end_date - start_date).total_seconds())))

    amount = item.get("value")
    try:
        amount_number = float(amount) if amount is not None else None
        if amount_number is not None and not math.isfinite(amount_number):
            amount_number = None
    except (TypeError, ValueError):
        amount_number = None

    kind = item.get("kind")
    record_kind = (
        "wearable_sample"
        if kind == "wearable_sample"
        else "wearable_event"
        if kind == "wearable_event"
        else "habit_log"
    )
    metadata = {
        **parse_metadata_object(item.get("metadata")),
        "provider": item.get("provider"),
        "record_kind": kind,
        "metric_type": metric_type,
        "aggregation_kind": item.get("aggregation_kind"),
        "rollup_level": item.get("rollup_level"),
        "rollup_window_minutes": item.get("rollup_window_minutes"),
        "source_device_name": item.get("source_device_name"),
        "start_time": start,
        "end_time": end,
    }
    category = (matched or {}).get("category") or metric_category(metric_type or "")
    if category == "Other":
        category = "Health"

    return {
        "id": item.get("id"),
        "habit_id": (matched or {}).get("id") or item.get("habit_id") or None,
        "habit_name": title,
        "category": category,
        "icon": (matched or {}).get("icon"),
        "date": date_value,
        "raw_date": raw_date,
        "completed_at": start or None,
        "duration": duration_seconds if kind == "wearable_event" and duration_seconds else None,
        "amount": amount_number,
        "unit_type": (matched or {}).get("unit_type") or item.get("unit"),
        "status": item.get("status") or "completed",
        "notes": item.get("notes") or None,
        "integration_source": source,
        "metric_type": metric_type,
        "time_precision": "day" if is_daily_wearable_item(item) else "exact",
        "metadata": metadata,
        "editable": kind == "habit_log" and bool(item.get("habit_id") or (matched or {}).get("id")),
        "record_kind": record_kind,
        "start_time": start or None,
        "end_time": end or None,
        "rollup_level": item.get("rollup_level"),
        "aggregation_kind": item.get("aggregation_kind"),
        "source_device_name": item.get("source_device_name"),
    }


def dedupe_daily_rows_when_granular_exists(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    granular_keys = {
        f"{item.get('provider') or ''}|{item.get('metric_type') or ''}|{item.get('attributed_date') or ''}"
        for item in items
        if item.get("kind") == "wearable_sample" and not is_daily_wearable_item(item)
    }
    kept: List[Dict[str, Any]] = []
    for item in items:
        if item.get("kind") != "wearable_sample" or not is_daily_wearable_item(item) or not item.get("attributed_date"):
            kept.append(item)
            continue
        duplicate_key = f"{item.get('provider') or ''}|{item.get('metric_type') or ''}|{item.get('attributed_date') or ''}"
        if duplicate_key not in granular_keys:
            kept.append(item)
    return kept


def is_iphone_time_habit(habit: Dict[str, Any]) -> bool:
    name = str(habit.get("name") or "").strip().lower()
    metric_type = str(habit.get("metric_type") or "").strip().lower()
    source = str(habit.get("integration_source") or "").strip().lower()
    return (
        name == "iphone time"
        or metric_type in {"iphone_time", "iphone_screen_time"}
        or source == "biome_iphone"
    )


def should_include_iphone_time_logs(sources: List[str]) -> bool:
    if not sources:
        return True
    normalized = [source.strip().lower() for source in sources]
    return any(
        source in {"biome_iphone", "iphone", "iphone_time", "apple_screen_time", "screen_time"}
        for source in normalized
    )


def sort_logs(logs: List[Dict[str, Any]], sort: str, order: str) -> List[Dict[str, Any]]:
    descending = (order or "desc").lower() != "asc"

    def sort_key(log: Dict[str, Any]) -> Any:
        if sort == "date":
            return log.get("date") or ""
        if sort == "habit":
            return str(log.get("habit_name") or "").lower()
        if sort == "value":
            return float(log.get("amount") or log.get("duration") or 0)
        if sort == "category":
            return str(log.get("category") or "").lower()
        if sort == "status":
            return str(log.get("status") or "")
        completed = parse_completed_at(log.get("completed_at"))
        if completed:
            return completed.timestamp()
        try:
            return datetime.fromisoformat(str(log.get("date"))).timestamp()
        except ValueError:
            return 0.0

    return sorted(logs, key=sort_key, reverse=descending)


def _item_dict(item: Any) -> Dict[str, Any]:
    if isinstance(item, dict):
        return item
    if hasattr(item, "model_dump"):
        return item.model_dump()
    return dict(item)


class HabitLogsAllService:
    async def get_habit_logs_all(
        self,
        user_id: str,
        *,
        q: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        categories: Optional[str] = None,
        habits: Optional[str] = None,
        statuses: Optional[str] = None,
        sources: Optional[str] = None,
        sort: str = "time",
        order: str = "desc",
        timezone_name: str = "UTC",
        limit: int = 200,
        offset: int = 0,
    ) -> Dict[str, Any]:
        today = datetime.now(timezone.utc).date()
        resolved_start = start_date or (today - timedelta(days=90)).isoformat()
        resolved_end = end_date or today.isoformat()
        resolved_limit = min(max(int(limit or 200), 1), 1000)
        resolved_offset = max(int(offset or 0), 0)
        category_filters = _csv(categories)
        habit_filters = _csv(habits)
        status_filters = _csv(statuses)
        source_filters = _csv(sources)
        include_manual_logs = (not source_filters) or any(
            source.lower() == "manual" for source in source_filters
        )

        query_start = datetime.fromisoformat(f"{shift_date_key(resolved_start, -1)}T00:00:00+00:00")
        query_end = datetime.fromisoformat(f"{shift_date_key(resolved_end, 1)}T23:59:59+00:00")

        async with get_db_session() as session:
            habit_rows = list(
                (await session.execute(select(HabitDB).where(HabitDB.user_id == user_id))).scalars().all()
            )
        habits_list = [
            {
                "id": habit.id,
                "name": habit.name,
                "category": habit.category or "uncategorized",
                "icon": habit.icon,
                "unit_type": habit.unit_type,
                "integration_source": habit.integration_source,
                "metric_type": habit.metric_type,
            }
            for habit in habit_rows
        ]
        lookup = build_habit_lookup(habits_list)

        items, _cursor = await wearable_query_service.get_timeline(
            user_id=user_id,
            start_time=query_start,
            end_time=query_end,
            include_manual_logs=include_manual_logs,
            limit=5000,
        )
        logs = [
            normalized
            for normalized in (
                normalize_timeline_item(_item_dict(item), lookup, timezone_name or "UTC")
                for item in dedupe_daily_rows_when_granular_exists([_item_dict(item) for item in items])
            )
            if normalized
        ]

        iphone_habit = next((habit for habit in habits_list if is_iphone_time_habit(habit)), None)
        if iphone_habit and should_include_iphone_time_logs(source_filters):
            facts = await metric_fact_service.get_daily_facts(
                user_id=user_id,
                start_date=resolved_start,
                end_date=resolved_end,
                habit_ids=[iphone_habit["id"]],
            )
            for row in facts.get("data") or []:
                fact_date = str(row.get("date") or "")[:10]
                if not fact_date:
                    continue
                value = float(row.get("daily_value") or row.get("value") or row.get("total_amount") or 0)
                if not (value > 0):
                    continue
                record_count = int(row.get("record_count") or 0)
                logs.append(
                    {
                        "id": f"metric-fact:iphone-time:{iphone_habit['id']}:{fact_date}",
                        "habit_id": iphone_habit["id"],
                        "habit_name": iphone_habit.get("name") or row.get("habit_name") or "iPhone Time",
                        "category": iphone_habit.get("category") or "Device Usage",
                        "icon": iphone_habit.get("icon"),
                        "date": fact_date,
                        "raw_date": fact_date,
                        "completed_at": f"{fact_date}T12:00:00Z",
                        "amount": value,
                        "unit_type": iphone_habit.get("unit_type") or row.get("unit") or "Hours",
                        "status": "completed",
                        "notes": (
                            f"Daily iPhone Time rollup from {record_count:,} app interval"
                            f"{'' if record_count == 1 else 's'}."
                        ),
                        "integration_source": "biome_iphone",
                        "metric_type": row.get("metric_key") or iphone_habit.get("metric_type") or "iphone_time",
                        "time_precision": "day",
                        "metadata": {
                            "record_kind": "metric_daily_fact",
                            "source_family": row.get("source_family") or "watcher",
                            "provider": row.get("provider") or "biome_iphone",
                            "record_count": record_count,
                            "read_only": True,
                        },
                        "editable": False,
                        "record_kind": "habit_log",
                        "rollup_level": "day",
                        "aggregation_kind": "daily_total",
                        "source_device_name": "iPhone",
                    }
                )

        logs = [log for log in logs if resolved_start <= str(log.get("date") or "") <= resolved_end]
        if q:
            needle = q.lower()
            logs = [
                log
                for log in logs
                if needle in str(log.get("habit_name") or "").lower()
                or needle in str(log.get("notes") or "").lower()
            ]
        if category_filters:
            wanted = {item.lower() for item in category_filters}
            logs = [log for log in logs if str(log.get("category") or "").lower() in wanted]
        if habit_filters:
            logs = [log for log in logs if log.get("habit_id") in habit_filters]
        if status_filters:
            logs = [log for log in logs if log.get("status") in status_filters]
        if source_filters:
            wanted = {item.lower() for item in source_filters}
            logs = [
                log
                for log in logs
                if str(log.get("integration_source") or "manual").lower() in wanted
            ]

        logs = sort_logs(logs, sort or "time", order or "desc")
        total_filtered = len(logs)
        paged = logs[resolved_offset : resolved_offset + resolved_limit]
        completed_count = sum(1 for log in logs if log.get("status") == "completed")
        total_duration = sum(float(log.get("duration") or 0) for log in logs)
        total_amount = sum(float(log.get("amount") or 0) for log in logs)
        return {
            "success": True,
            "data": paged,
            "meta": {
                "total": len(paged),
                "totalFiltered": total_filtered,
                "offset": resolved_offset,
                "limit": resolved_limit,
                "hasMore": resolved_offset + len(paged) < total_filtered,
                "filters": {
                    "q": q,
                    "startDate": resolved_start,
                    "endDate": resolved_end,
                    "categories": category_filters,
                    "habits": habit_filters,
                    "statuses": status_filters,
                    "sources": source_filters,
                },
                "sort": {"column": sort or "time", "order": order or "desc"},
                "totals": {
                    "count": total_filtered,
                    "totalDuration": total_duration,
                    "totalAmount": total_amount,
                    "completedCount": completed_count,
                    "completionRate": (completed_count / total_filtered) * 100 if total_filtered else 0,
                },
            },
        }


habit_logs_all_service = HabitLogsAllService()
