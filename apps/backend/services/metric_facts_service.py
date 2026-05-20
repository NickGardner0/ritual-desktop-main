"""Derived daily metric facts for product-facing analytics.

Metric facts are recomputable projections. They never replace or delete raw
source records such as wearable events, financial transactions, watcher events,
or manual habit logs.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import parse_qs, urlparse

from sqlalchemy import func, select

from database.connection import get_db_session
from database.models import (
    DailyActivityRollupDB,
    FinancialTransactionDB,
    HabitDB,
    HabitLogDB,
    HabitProjectionPolicyDB,
    MetricDailyFactDB,
    MetricFactRebuildRunDB,
    WearableEventDB,
    WearableSampleDB,
)
from services.financial_rollup_service import financial_rollup_service

logger = logging.getLogger(__name__)


WEARABLE_PROVIDERS = {"apple_health", "whoop", "oura", "fitbit", "garmin"}
SLEEP_ALIASES = {"sleep", "sleep_session", "sleep_duration", "sleep_total", "in_bed"}
CUMULATIVE_METRICS = {
    "steps",
    "active_energy",
    "calories",
    "distance",
    "distance_walking_running",
    "sleep_total",
}
MIN_METRICS = {"resting_heart_rate"}


@dataclass
class FactDraft:
    user_id: str
    habit_id: str
    habit_name: str
    metric_key: str
    date: str
    value: float
    unit: str
    source_family: str
    provider: Optional[str] = None
    record_count: int = 0
    provenance: Dict[str, Any] = field(default_factory=dict)
    status: str = "complete"

    @property
    def stable_key(self) -> Tuple[str, str, str, str]:
        return (self.user_id, self.habit_id, self.metric_key, self.date)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


def _loads(raw: Optional[str], fallback: Any = None) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _normalize_metric_key(value: Optional[str], *, habit_name: Optional[str] = None) -> str:
    raw = (value or "").strip().lower()
    name = (habit_name or "").strip().lower()
    if raw in SLEEP_ALIASES or ("sleep" in name and raw in {"", "none"}):
        return "sleep_total"
    if raw in {"daily_spending", "spending"}:
        return "daily_spending"
    if raw in {"computer_use", "computer_time"}:
        return "computer_time"
    if not raw:
        return name.replace(" ", "_") or "manual"
    return raw


def _is_sleep_like(habit: HabitDB) -> bool:
    metric = _normalize_metric_key(habit.metric_type, habit_name=habit.name)
    return metric == "sleep_total" or "sleep" in (habit.name or "").lower()


def _is_completed_status(status: Optional[str]) -> bool:
    normalized = (status or "").strip().lower()
    return normalized in {"", "completed", "success"}


def _target_unit(habit: HabitDB, fallback: str = "count") -> str:
    return str(habit.unit_type or fallback or "count")


def _unit_kind(unit: Optional[str]) -> str:
    normalized = (unit or "").strip().lower()
    if "hour" in normalized or normalized in {"hr", "hrs", "h"}:
        return "hours"
    if "minute" in normalized or normalized in {"min", "mins", "m"}:
        return "minutes"
    if normalized in {"ms", "millisecond", "milliseconds"}:
        return "milliseconds"
    if "second" in normalized or normalized in {"sec", "secs", "s"}:
        return "seconds"
    if "dollar" in normalized or normalized in {"usd", "$"}:
        return "dollars"
    return normalized or "count"


def _convert_value(value: float, from_unit: Optional[str], to_unit: Optional[str], metric_key: str) -> float:
    source = _unit_kind(from_unit)
    target = _unit_kind(to_unit)
    if not math.isfinite(value):
        return 0.0
    if source == target or target in {"", "count"}:
        return float(value)

    seconds: Optional[float] = None
    if source == "hours":
        seconds = value * 3600
    elif source == "minutes":
        seconds = value * 60
    elif source == "seconds":
        seconds = value
    elif source == "milliseconds":
        seconds = value / 1000

    if seconds is not None:
        if target == "hours":
            return seconds / 3600
        if target == "minutes":
            return seconds / 60
        if target == "seconds":
            return seconds

    if metric_key == "sleep_total" and source == "minutes" and target == "hours":
        return value / 60
    return float(value)


def _log_value_for_habit(habit: HabitDB, log: HabitLogDB) -> float:
    unit = _target_unit(habit).lower()
    if log.duration and log.duration > 0:
        if "hour" in unit:
            return float(log.duration) / 3600
        if "minute" in unit:
            return float(log.duration) / 60
        return float(log.duration)
    if log.amount is not None:
        return float(log.amount)
    return 1.0


def _classify_habit(habit: HabitDB) -> str:
    integration = (habit.integration_source or "").strip().lower()
    metric = _normalize_metric_key(habit.metric_type, habit_name=habit.name)
    name = (habit.name or "").strip().lower()
    if integration == "plaid" or metric == "daily_spending":
        return "plaid"
    if metric == "computer_time" or name == "computer time":
        return "watcher"
    if integration in WEARABLE_PROVIDERS:
        return "wearable"
    return "manual"


def _default_range(days_back: int = 3650) -> Tuple[str, str]:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=max(1, int(days_back)) - 1)
    return start.isoformat(), end.isoformat()


class MetricFactService:
    async def rebuild_facts(
        self,
        *,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 3650,
        habit_ids: Optional[Sequence[str]] = None,
        source_families: Optional[Sequence[str]] = None,
        include_legacy_fallback: bool = True,
        apply: bool = False,
    ) -> Dict[str, Any]:
        start, end = self._resolve_range(start_date, end_date, days_back)
        run = await self._create_run(
            user_id=user_id,
            mode="apply" if apply else "dry_run",
            start_date=start,
            end_date=end,
            habit_ids=habit_ids,
            source_families=source_families,
        )
        try:
            drafts = await self.build_fact_drafts(
                user_id=user_id,
                start_date=start,
                end_date=end,
                habit_ids=habit_ids,
                source_families=source_families,
                include_legacy_fallback=include_legacy_fallback,
            )
            legacy_count = sum(1 for draft in drafts if draft.source_family == "legacy_habit_log")
            write_result = {"facts_written": 0, "facts_unchanged": len(drafts)}
            if apply:
                write_result = await self._upsert_fact_drafts(drafts, run_id=run.id)
            summary = self._summarize_drafts(drafts)
            await self._finish_run(
                run.id,
                status="success",
                facts_seen=len(drafts),
                facts_written=int(write_result["facts_written"]),
                facts_unchanged=int(write_result["facts_unchanged"]),
                legacy_fallback_count=legacy_count,
                summary=summary,
            )
            return {
                "success": True,
                "run": await self.get_rebuild_run(user_id=user_id, run_id=run.id),
                "dry_run": not apply,
                "facts": {
                    "seen": len(drafts),
                    "written": write_result["facts_written"],
                    "unchanged": write_result["facts_unchanged"],
                    "legacy_fallback": legacy_count,
                },
                "summary": summary,
            }
        except Exception as exc:
            await self._finish_run(run.id, status="failed", error={"message": str(exc)})
            raise

    async def build_fact_drafts(
        self,
        *,
        user_id: str,
        start_date: str,
        end_date: str,
        habit_ids: Optional[Sequence[str]] = None,
        source_families: Optional[Sequence[str]] = None,
        include_legacy_fallback: bool = True,
    ) -> List[FactDraft]:
        selected_families = {family.strip().lower() for family in source_families or [] if family}
        async with get_db_session() as session:
            habits = await self._load_habits(session, user_id=user_id, habit_ids=habit_ids)
            if not habits:
                return []
            habits_by_id = {habit.id: habit for habit in habits}
            legacy_by_habit = await self._build_habit_log_aggregates(
                session,
                user_id=user_id,
                habits=habits,
                start_date=start_date,
                end_date=end_date,
            )

            drafts: Dict[Tuple[str, str, str, str], FactDraft] = {}
            for habit in habits:
                family = _classify_habit(habit)
                if selected_families and family not in selected_families:
                    continue
                canonical: List[FactDraft] = []
                if family == "wearable":
                    canonical = await self._build_wearable_facts(session, habit, start_date, end_date)
                elif family == "plaid":
                    canonical = await self._build_plaid_facts(session, habit, start_date, end_date)
                elif family == "watcher":
                    canonical = await self._build_watcher_facts(habit, start_date, end_date)
                else:
                    canonical = self._manual_facts_for_habit(habit, legacy_by_habit.get(habit.id, {}))

                for draft in canonical:
                    drafts[draft.stable_key] = draft

                if include_legacy_fallback and family != "manual":
                    for date_value, aggregate in legacy_by_habit.get(habit.id, {}).items():
                        metric_key = _normalize_metric_key(habit.metric_type, habit_name=habit.name)
                        key = (user_id, habit.id, metric_key, date_value)
                        if key in drafts:
                            continue
                        drafts[key] = FactDraft(
                            user_id=user_id,
                            habit_id=habit.id,
                            habit_name=habit.name,
                            metric_key=metric_key,
                            date=date_value,
                            value=aggregate["value"],
                            unit=_target_unit(habit),
                            source_family="legacy_habit_log",
                            provider=(habit.integration_source or None),
                            record_count=aggregate["record_count"],
                            provenance={
                                "reason": "canonical_source_missing_for_day",
                                "source_log_ids": aggregate["ids"][:20],
                                "classification": family,
                            },
                            status="legacy_fallback",
                        )

            return sorted(drafts.values(), key=lambda item: (item.habit_name, item.date, item.metric_key))

    async def get_daily_facts(
        self,
        *,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 30,
        habit_ids: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        start, end = self._resolve_range(start_date, end_date, days_back)
        async with get_db_session() as session:
            query = (
                select(MetricDailyFactDB)
                .where(
                    MetricDailyFactDB.user_id == user_id,
                    MetricDailyFactDB.date >= start,
                    MetricDailyFactDB.date <= end,
                )
                .order_by(MetricDailyFactDB.date.asc(), MetricDailyFactDB.habit_name.asc())
            )
            if habit_ids:
                query = query.where(MetricDailyFactDB.habit_id.in_(list(habit_ids)))
            rows = list((await session.execute(query)).scalars().all())
        return {
            "success": True,
            "data": [self._serialize_daily(row) for row in rows],
            "meta": {"user_id": user_id, "start_date": start, "end_date": end, "rows": len(rows)},
        }

    async def get_summary_facts(
        self,
        *,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 30,
        habit_ids: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        start, end = self._resolve_range(start_date, end_date, days_back)
        async with get_db_session() as session:
            query = (
                select(MetricDailyFactDB)
                .where(
                    MetricDailyFactDB.user_id == user_id,
                    MetricDailyFactDB.date >= start,
                    MetricDailyFactDB.date <= end,
                )
                .order_by(MetricDailyFactDB.habit_name.asc(), MetricDailyFactDB.date.asc())
            )
            if habit_ids:
                query = query.where(MetricDailyFactDB.habit_id.in_(list(habit_ids)))
            rows = list((await session.execute(query)).scalars().all())
        summary = self._summarize_fact_rows(rows)
        return {
            "success": True,
            "data": summary,
            "meta": {"user_id": user_id, "start_date": start, "end_date": end, "rows": len(summary)},
        }

    async def get_overview_snapshot(
        self,
        *,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 3650,
    ) -> Dict[str, Any]:
        start, end = self._resolve_range(start_date, end_date, days_back)
        async with get_db_session() as session:
            habits = await self._load_habits(session, user_id=user_id, habit_ids=None)
            facts_query = select(MetricDailyFactDB).where(
                MetricDailyFactDB.user_id == user_id,
                MetricDailyFactDB.date >= start,
                MetricDailyFactDB.date <= end,
            )
            facts = list((await session.execute(facts_query)).scalars().all())

        facts_by_habit: Dict[str, List[MetricDailyFactDB]] = {}
        for fact in facts:
            facts_by_habit.setdefault(fact.habit_id, []).append(fact)

        overview_stats = {
            habit.id: self._build_habit_stat(habit, facts_by_habit.get(habit.id, []))
            for habit in habits
            if habit.id
        }
        from database.helpers import habit_db_to_pydantic

        return {
            "habits": [habit_db_to_pydantic(habit).model_dump(mode="json") for habit in habits],
            "overviewStats": overview_stats,
            "meta": {
                "userId": user_id,
                "generatedAt": int(datetime.now(timezone.utc).timestamp() * 1000),
                "startDate": start_date,
                "endDate": end_date,
                "source": "metric_daily_facts",
            },
        }

    async def reconcile(
        self,
        *,
        user_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = 3650,
        habit_ids: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        start, end = self._resolve_range(start_date, end_date, days_back)
        run = await self._create_run(
            user_id=user_id,
            mode="reconcile",
            start_date=start,
            end_date=end,
            habit_ids=habit_ids,
            source_families=None,
        )
        try:
            drafts = await self.build_fact_drafts(
                user_id=user_id,
                start_date=start,
                end_date=end,
                habit_ids=habit_ids,
                include_legacy_fallback=True,
            )
            async with get_db_session() as session:
                facts_query = select(MetricDailyFactDB).where(
                    MetricDailyFactDB.user_id == user_id,
                    MetricDailyFactDB.date >= start,
                    MetricDailyFactDB.date <= end,
                )
                if habit_ids:
                    facts_query = facts_query.where(MetricDailyFactDB.habit_id.in_(list(habit_ids)))
                facts = list((await session.execute(facts_query)).scalars().all())

            dashboard_totals: Dict[str, float] = {}
            try:
                from services.habits_service import HabitsService

                dashboard_snapshot = await HabitsService().get_overview_snapshot(
                    user_id,
                    start_date=start,
                    end_date=end,
                )
                dashboard_totals = self._dashboard_totals_by_habit(dashboard_snapshot)
            except Exception as exc:
                logger.warning("Metric fact reconciliation could not load dashboard snapshot: %s", exc)

            report = self._build_reconciliation_report(drafts, facts, dashboard_totals=dashboard_totals)
            status = "success" if report["ok"] else "failed"
            await self._finish_run(
                run.id,
                status=status,
                facts_seen=len(drafts),
                facts_written=0,
                facts_unchanged=len(facts),
                legacy_fallback_count=sum(1 for draft in drafts if draft.source_family == "legacy_habit_log"),
                summary=report,
            )
            return {"success": report["ok"], "run_id": run.id, "report": report}
        except Exception as exc:
            await self._finish_run(run.id, status="failed", error={"message": str(exc)})
            raise

    async def get_rebuild_run(self, *, user_id: str, run_id: str) -> Optional[Dict[str, Any]]:
        async with get_db_session() as session:
            run = await session.get(MetricFactRebuildRunDB, run_id)
            if run is None or run.user_id != user_id:
                return None
            return {
                "id": run.id,
                "user_id": run.user_id,
                "mode": run.mode,
                "status": run.status,
                "start_date": run.start_date,
                "end_date": run.end_date,
                "source_families": _loads(run.source_families_json, []),
                "habit_ids": _loads(run.habit_ids_json, []),
                "facts_seen": int(run.facts_seen or 0),
                "facts_written": int(run.facts_written or 0),
                "facts_unchanged": int(run.facts_unchanged or 0),
                "legacy_fallback_count": int(run.legacy_fallback_count or 0),
                "summary": _loads(run.summary_json, {}),
                "error": _loads(run.error_json, None),
                "created_at": run.created_at.isoformat() if run.created_at else None,
                "started_at": run.started_at.isoformat() if run.started_at else None,
                "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            }

    def _resolve_range(
        self,
        start_date: Optional[str],
        end_date: Optional[str],
        days_back: int,
    ) -> Tuple[str, str]:
        if start_date and end_date:
            return start_date[:10], end_date[:10]
        return _default_range(days_back)

    async def _load_habits(self, session: Any, *, user_id: str, habit_ids: Optional[Sequence[str]]) -> List[HabitDB]:
        query = select(HabitDB).where(HabitDB.user_id == user_id).order_by(HabitDB.created_at.asc())
        if habit_ids:
            query = query.where(HabitDB.id.in_(list(habit_ids)))
        return list((await session.execute(query)).scalars().all())

    async def _build_habit_log_aggregates(
        self,
        session: Any,
        *,
        user_id: str,
        habits: Sequence[HabitDB],
        start_date: str,
        end_date: str,
    ) -> Dict[str, Dict[str, Dict[str, Any]]]:
        habit_ids = [habit.id for habit in habits if habit.id]
        habits_by_id = {habit.id: habit for habit in habits}
        if not habit_ids:
            return {}
        result = await session.execute(
            select(HabitLogDB)
            .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
            .where(
                HabitDB.user_id == user_id,
                HabitLogDB.habit_id.in_(habit_ids),
                HabitLogDB.date >= start_date,
                HabitLogDB.date <= end_date,
            )
        )
        by_habit: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for log in result.scalars().all():
            if not _is_completed_status(log.status):
                continue
            habit = habits_by_id.get(log.habit_id)
            if habit is None:
                continue
            value = _log_value_for_habit(habit, log)
            date_value = (log.date or "")[:10]
            if not date_value:
                continue
            bucket = by_habit.setdefault(log.habit_id, {}).setdefault(
                date_value,
                {"value": 0.0, "record_count": 0, "ids": []},
            )
            if _is_sleep_like(habit):
                bucket["value"] = max(float(bucket["value"]), value)
            else:
                bucket["value"] = float(bucket["value"]) + value
            bucket["record_count"] = int(bucket["record_count"]) + 1
            bucket["ids"].append(log.id)
        return by_habit

    def _manual_facts_for_habit(self, habit: HabitDB, aggregate_by_date: Dict[str, Dict[str, Any]]) -> List[FactDraft]:
        metric_key = _normalize_metric_key(habit.metric_type, habit_name=habit.name)
        return [
            FactDraft(
                user_id=habit.user_id,
                habit_id=habit.id,
                habit_name=habit.name,
                metric_key=metric_key,
                date=date_value,
                value=aggregate["value"],
                unit=_target_unit(habit),
                source_family="manual",
                provider=None,
                record_count=aggregate["record_count"],
                provenance={"source_log_ids": aggregate["ids"][:20]},
            )
            for date_value, aggregate in sorted(aggregate_by_date.items())
        ]

    async def _build_wearable_facts(
        self,
        session: Any,
        habit: HabitDB,
        start_date: str,
        end_date: str,
    ) -> List[FactDraft]:
        metric_key = await self._resolve_habit_metric_key(session, habit)
        preferred_provider = await self._preferred_provider(session, habit)
        values: Dict[str, Dict[str, Dict[str, List[Dict[str, Any]]]]] = {}

        event_rows = await session.execute(
            select(WearableEventDB).where(
                WearableEventDB.user_id == habit.user_id,
                WearableEventDB.event_type == metric_key,
                WearableEventDB.attributed_date >= start_date,
                WearableEventDB.attributed_date <= end_date,
                WearableEventDB.deleted_at.is_(None),
            )
        )
        for event in event_rows.scalars().all():
            date_value = event.attributed_date
            if not date_value:
                continue
            raw_value = event.summary_value
            raw_unit = event.summary_unit
            if raw_value is None and event.start_time and event.end_time:
                raw_value = (event.end_time - event.start_time).total_seconds()
                raw_unit = "seconds"
            if raw_value is None:
                continue
            value = _convert_value(float(raw_value), raw_unit, _target_unit(habit, raw_unit or "count"), metric_key)
            provider = event.provider or "wearable"
            values.setdefault(date_value, {}).setdefault(provider, {"event": [], "sample": []})["event"].append(
                {
                    "value": value,
                    "id": event.id,
                    "kind": "event",
                    "rollup_level": None,
                    "aggregation_kind": None,
                }
            )

        sample_rows = await session.execute(
            select(WearableSampleDB).where(
                WearableSampleDB.user_id == habit.user_id,
                WearableSampleDB.metric_type == metric_key,
                WearableSampleDB.attributed_date >= start_date,
                WearableSampleDB.attributed_date <= end_date,
                WearableSampleDB.deleted_at.is_(None),
            )
        )
        for sample in sample_rows.scalars().all():
            date_value = sample.attributed_date
            if not date_value:
                continue
            value = _convert_value(float(sample.value), sample.unit, _target_unit(habit, sample.unit), metric_key)
            provider = sample.provider or "wearable"
            values.setdefault(date_value, {}).setdefault(provider, {"event": [], "sample": []})["sample"].append(
                {
                    "value": value,
                    "id": sample.id,
                    "kind": "sample",
                    "rollup_level": sample.rollup_level,
                    "aggregation_kind": sample.aggregation_kind,
                }
            )

        drafts: List[FactDraft] = []
        for date_value, by_provider in sorted(values.items()):
            provider = self._choose_provider(by_provider, preferred_provider)
            provider_rows = by_provider[provider]
            sample_rows = self._select_wearable_sample_rows(metric_key, provider_rows.get("sample", []))
            rows = sample_rows or provider_rows.get("event", [])
            numeric_values = [float(item["value"]) for item in rows]
            if not numeric_values:
                continue
            if metric_key in MIN_METRICS:
                value = min(numeric_values)
            elif metric_key in CUMULATIVE_METRICS:
                value = sum(numeric_values)
            else:
                value = sum(numeric_values) / len(numeric_values)
            drafts.append(
                FactDraft(
                    user_id=habit.user_id,
                    habit_id=habit.id,
                    habit_name=habit.name,
                    metric_key=metric_key,
                    date=date_value,
                    value=value,
                    unit=_target_unit(habit),
                    source_family="wearable",
                    provider=provider,
                    record_count=len(rows),
                    provenance={
                        "record_ids": [item["id"] for item in rows[:20]],
                        "record_kinds": sorted({item["kind"] for item in rows}),
                        "preferred_provider": preferred_provider,
                        "selection": "sample_rows" if sample_rows else "event_rows",
                    },
                )
            )
        return drafts

    def _select_wearable_sample_rows(self, metric_key: str, rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not rows:
            return []
        daily_rows = [
            row for row in rows
            if str(row.get("rollup_level") or "").strip().lower() == "daily"
            or str(row.get("aggregation_kind") or "").strip().lower() in {"daily", "daily_aggregate"}
        ]
        non_daily_rows = [row for row in rows if row not in daily_rows]
        if metric_key in CUMULATIVE_METRICS:
            return non_daily_rows or daily_rows
        return daily_rows or non_daily_rows

    async def _resolve_habit_metric_key(self, session: Any, habit: HabitDB) -> str:
        result = await session.execute(
            select(HabitProjectionPolicyDB).where(HabitProjectionPolicyDB.habit_id == habit.id)
        )
        policy = result.scalar_one_or_none()
        return _normalize_metric_key(
            policy.canonical_metric_type if policy and policy.canonical_metric_type else habit.metric_type,
            habit_name=habit.name,
        )

    async def _preferred_provider(self, session: Any, habit: HabitDB) -> Optional[str]:
        result = await session.execute(
            select(HabitProjectionPolicyDB).where(HabitProjectionPolicyDB.habit_id == habit.id)
        )
        policy = result.scalar_one_or_none()
        priority = _loads(policy.projection_source_priority_json if policy else None, [])
        if isinstance(priority, list) and priority:
            return str(priority[0]).strip().lower() or None
        integration = (habit.integration_source or "").strip().lower()
        return integration if integration in WEARABLE_PROVIDERS else None

    def _choose_provider(self, by_provider: Dict[str, List[Any]], preferred_provider: Optional[str]) -> str:
        if preferred_provider and preferred_provider in by_provider:
            return preferred_provider
        return sorted(by_provider.keys())[0]

    async def _build_plaid_facts(
        self,
        session: Any,
        habit: HabitDB,
        start_date: str,
        end_date: str,
    ) -> List[FactDraft]:
        included_account_ids = await financial_rollup_service._included_account_ids(habit.user_id)
        if not included_account_ids:
            return []
        rows = await session.execute(
            select(
                FinancialTransactionDB.transaction_date,
                func.sum(FinancialTransactionDB.amount),
                func.count(FinancialTransactionDB.id),
            )
            .where(
                FinancialTransactionDB.user_id == habit.user_id,
                FinancialTransactionDB.account_id.in_(included_account_ids),
                FinancialTransactionDB.counts_toward_spending.is_(True),
                FinancialTransactionDB.transaction_date >= start_date,
                FinancialTransactionDB.transaction_date <= end_date,
            )
            .group_by(FinancialTransactionDB.transaction_date)
        )
        return [
            FactDraft(
                user_id=habit.user_id,
                habit_id=habit.id,
                habit_name=habit.name,
                metric_key="daily_spending",
                date=row[0],
                value=round(float(row[1] or 0.0), 2),
                unit=_target_unit(habit, "Dollars"),
                source_family="plaid",
                provider="plaid",
                record_count=int(row[2] or 0),
                provenance={"aggregation": "financial_transactions"},
            )
            for row in rows.fetchall()
            if float(row[1] or 0.0) > 0
        ]

    async def _build_watcher_facts(self, habit: HabitDB, start_date: str, end_date: str) -> List[FactDraft]:
        daily_rows = await self._build_watcher_remote_daily_rows(
            user_id=habit.user_id,
            start_date=start_date,
            end_date=end_date,
        )

        if not daily_rows:
            async with get_db_session() as session:
                result = await session.execute(
                    select(
                        DailyActivityRollupDB.day,
                        func.sum(DailyActivityRollupDB.active_ms),
                        func.sum(DailyActivityRollupDB.events_count),
                    )
                    .where(
                        DailyActivityRollupDB.user_id == habit.user_id,
                        DailyActivityRollupDB.day >= start_date,
                        DailyActivityRollupDB.day <= end_date,
                    )
                    .group_by(DailyActivityRollupDB.day)
                )
                daily_rows = [
                    {
                        "day": row[0],
                        "active_ms": int(row[1] or 0),
                        "events_count": int(row[2] or 0),
                        "source": "daily_activity_rollups",
                    }
                    for row in result.fetchall()
                ]

        if not daily_rows:
            preserved = await self._existing_watcher_fact_drafts(habit, start_date, end_date)
            if preserved:
                logger.warning(
                    "Preserving %s existing watcher metric facts for habit %s because watcher source rows were unavailable",
                    len(preserved),
                    habit.id,
                )
                return preserved

        drafts: List[FactDraft] = []
        for row in daily_rows:
            date_value = str(row.get("day") or row.get("date") or "")[:10]
            active_ms = int(row.get("active_ms") or row.get("total_active_ms") or 0)
            if not date_value or active_ms <= 0:
                continue
            value = _convert_value(active_ms, "milliseconds", _target_unit(habit, "Hours"), "computer_time")
            drafts.append(
                FactDraft(
                    user_id=habit.user_id,
                    habit_id=habit.id,
                    habit_name=habit.name,
                    metric_key="computer_time",
                    date=date_value,
                    value=value,
                    unit=_target_unit(habit, "Hours"),
                    source_family="watcher",
                    provider="ritual_watcher",
                    record_count=int(row.get("events_count") or row.get("total_events") or 0),
                    provenance={"aggregation": row.get("source") or "computer_activity_daily_totals"},
                )
            )
        return drafts

    async def _existing_watcher_fact_drafts(
        self,
        habit: HabitDB,
        start_date: str,
        end_date: str,
    ) -> List[FactDraft]:
        async with get_db_session() as session:
            rows = list(
                (
                    await session.execute(
                        select(MetricDailyFactDB)
                        .where(
                            MetricDailyFactDB.user_id == habit.user_id,
                            MetricDailyFactDB.habit_id == habit.id,
                            MetricDailyFactDB.metric_key == "computer_time",
                            MetricDailyFactDB.source_family == "watcher",
                            MetricDailyFactDB.status == "complete",
                            MetricDailyFactDB.date >= start_date,
                            MetricDailyFactDB.date <= end_date,
                        )
                        .order_by(MetricDailyFactDB.date.asc())
                    )
                )
                .scalars()
                .all()
            )
        return [
            FactDraft(
                user_id=row.user_id,
                habit_id=row.habit_id,
                habit_name=row.habit_name,
                metric_key=row.metric_key,
                date=row.date,
                value=float(row.value or 0.0),
                unit=row.unit,
                source_family=row.source_family,
                provider=row.provider,
                record_count=int(row.record_count or 0),
                provenance=_loads(row.provenance_json, {}),
                status=row.status,
            )
            for row in rows
        ]

    async def _build_watcher_remote_daily_rows(
        self,
        *,
        user_id: str,
        start_date: str,
        end_date: str,
    ) -> List[Dict[str, Any]]:
        try:
            from services.turso_activity_remote import fetch_remote_activity_rows
            from services.watcher_service_computer_activity import (
                MAX_SINGLE_EVENT_MS,
                _aggregate_computer_activity_daily_totals_from_events_impl,
                _resolve_activity_user_ids,
            )
        except Exception as exc:
            logger.info("Metric facts watcher remote daily helper unavailable: %s", exc)
            return []

        try:
            start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
            end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")
            start_ms = int(start_date_obj.timestamp() * 1000)
            end_ms = int((end_date_obj + timedelta(days=1)).timestamp() * 1000)
            activity_user_ids = _resolve_activity_user_ids(user_id)
            user_placeholders = ", ".join(["?"] * len(activity_user_ids))
            minmax = await asyncio.wait_for(
                fetch_remote_activity_rows(
                    user_id,
                    f"""
                    SELECT MIN(ts_start), MAX(ts_end)
                    FROM activity_events
                    WHERE user_id IN ({user_placeholders})
                      AND ts_end > ts_start
                    """,
                    activity_user_ids,
                ),
                timeout=15,
            )
            if minmax.error or not minmax.rows or minmax.rows[0][0] is None or minmax.rows[0][1] is None:
                if minmax.error:
                    logger.info("Metric facts remote watcher min/max unavailable: %s", minmax.error)
                return []
            start_ms = max(start_ms, int(minmax.rows[0][0]))
            end_ms = min(end_ms, int(minmax.rows[0][1]))
            if end_ms <= start_ms:
                return []
            start_date_obj = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).replace(tzinfo=None)
            end_date_obj = datetime.fromtimestamp((end_ms - 1) / 1000, tz=timezone.utc).replace(tzinfo=None)
            chunk_days = max(3, int(os.getenv("METRIC_FACTS_WATCHER_REMOTE_CHUNK_DAYS", "14") or "14"))
            range_days = max(1, (end_date_obj.date() - start_date_obj.date()).days + 1)
            if range_days > chunk_days:
                daily_rows: List[Dict[str, Any]] = []
                chunk_start = start_date_obj.date()
                final_day = end_date_obj.date()
                while chunk_start <= final_day:
                    chunk_end = min(chunk_start + timedelta(days=chunk_days - 1), final_day)
                    daily_rows.extend(
                        await self._build_watcher_remote_daily_rows(
                            user_id=user_id,
                            start_date=chunk_start.isoformat(),
                            end_date=chunk_end.isoformat(),
                        )
                    )
                    chunk_start = chunk_end + timedelta(days=1)
                deduped = {str(row.get("day")): row for row in daily_rows if row.get("day")}
                return [deduped[day] for day in sorted(deduped.keys())]
            query_start_ms = max(0, start_ms - MAX_SINGLE_EVENT_MS)
            raw_result = await asyncio.wait_for(
                fetch_remote_activity_rows(
                    user_id,
                    f"""
                    SELECT
                        ts_start,
                        ts_end,
                        COALESCE(is_afk, 0) AS is_afk,
                        COALESCE(app_bundle_id, '') AS app_bundle_id,
                        COALESCE(browser_domain, '') AS browser_domain
                    FROM activity_events
                    WHERE user_id IN ({user_placeholders})
                      AND ts_start >= ?
                      AND ts_start < ?
                      AND ts_end > ?
                      AND ts_end > ts_start
                    ORDER BY ts_start ASC
                    """,
                    [*activity_user_ids, query_start_ms, end_ms, start_ms],
                ),
                timeout=30,
            )
            if raw_result.error or not raw_result.rows:
                if raw_result.error:
                    logger.info("Metric facts remote watcher raw rows unavailable: %s", raw_result.error)
                return []
            daily_rows = _aggregate_computer_activity_daily_totals_from_events_impl(
                list(raw_result.rows),
                start_ms,
                end_ms,
            )
            for row in daily_rows:
                row["source"] = raw_result.source or "turso_remote_raw_deoverlap"
            return daily_rows
            params: List[Any] = [
                start_ms,
                MAX_SINGLE_EVENT_MS,
                MAX_SINGLE_EVENT_MS,
                end_ms,
                end_ms,
                start_ms,
                *activity_user_ids,
            ]
            sql = f"""
                WITH base AS (
                    SELECT
                        strftime('%Y-%m-%d', ts_start / 1000, 'unixepoch') AS day,
                        MAX(ts_start, ?) AS start_ms,
                        MIN(
                            CASE
                                WHEN (ts_end - ts_start) > ? THEN ts_start + ?
                                ELSE ts_end
                            END,
                            ?
                        ) AS end_ms,
                        COALESCE(is_afk, 0) AS is_afk,
                        COALESCE(app_bundle_id, '') AS app_bundle_id,
                        COALESCE(browser_domain, '') AS browser_domain
                    FROM activity_events
                    WHERE ts_start < ?
                      AND ts_end > ?
                      AND user_id IN ({user_placeholders})
                      AND ts_end > ts_start
                ),
                clipped AS (
                    SELECT *
                    FROM base
                    WHERE end_ms > start_ms
                ),
                active_intervals AS (
                    SELECT day, start_ms, end_ms, app_bundle_id, browser_domain
                    FROM clipped
                    WHERE is_afk = 0
                ),
                afk_intervals AS (
                    SELECT day, start_ms, end_ms
                    FROM clipped
                    WHERE is_afk = 1
                ),
                active_ordered AS (
                    SELECT *, MAX(end_ms) OVER (
                        PARTITION BY day
                        ORDER BY start_ms, end_ms
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ) AS prev_max_end
                    FROM active_intervals
                ),
                active_grouped AS (
                    SELECT *, SUM(
                        CASE WHEN prev_max_end IS NULL OR start_ms > prev_max_end THEN 1 ELSE 0 END
                    ) OVER (
                        PARTITION BY day
                        ORDER BY start_ms, end_ms
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS island_id
                    FROM active_ordered
                ),
                active_islands AS (
                    SELECT day, island_id, MIN(start_ms) AS island_start, MAX(end_ms) AS island_end
                    FROM active_grouped
                    GROUP BY day, island_id
                ),
                active_by_day AS (
                    SELECT day, SUM(island_end - island_start) AS active_ms
                    FROM active_islands
                    GROUP BY day
                ),
                afk_ordered AS (
                    SELECT *, MAX(end_ms) OVER (
                        PARTITION BY day
                        ORDER BY start_ms, end_ms
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ) AS prev_max_end
                    FROM afk_intervals
                ),
                afk_grouped AS (
                    SELECT *, SUM(
                        CASE WHEN prev_max_end IS NULL OR start_ms > prev_max_end THEN 1 ELSE 0 END
                    ) OVER (
                        PARTITION BY day
                        ORDER BY start_ms, end_ms
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS island_id
                    FROM afk_ordered
                ),
                afk_islands AS (
                    SELECT day, island_id, MIN(start_ms) AS island_start, MAX(end_ms) AS island_end
                    FROM afk_grouped
                    GROUP BY day, island_id
                ),
                afk_by_day AS (
                    SELECT day, SUM(island_end - island_start) AS afk_ms
                    FROM afk_islands
                    GROUP BY day
                ),
                day_keys AS (
                    SELECT day FROM active_by_day
                    UNION
                    SELECT day FROM afk_by_day
                ),
                event_counts AS (
                    SELECT
                        day,
                        COUNT(*) AS events_count,
                        COUNT(DISTINCT CASE WHEN app_bundle_id != '' THEN app_bundle_id ELSE NULL END) AS apps_count,
                        COUNT(DISTINCT CASE WHEN browser_domain != '' THEN browser_domain ELSE NULL END) AS domains_count
                    FROM active_intervals
                    GROUP BY day
                )
                SELECT
                    day_keys.day,
                    COALESCE(active_by_day.active_ms, 0) AS active_ms,
                    COALESCE(afk_by_day.afk_ms, 0) AS afk_ms,
                    COALESCE(event_counts.events_count, 0) AS events_count,
                    COALESCE(event_counts.apps_count, 0) AS apps_count,
                    COALESCE(event_counts.domains_count, 0) AS domains_count
                FROM day_keys
                LEFT JOIN active_by_day ON active_by_day.day = day_keys.day
                LEFT JOIN afk_by_day ON afk_by_day.day = day_keys.day
                LEFT JOIN event_counts ON event_counts.day = day_keys.day
                ORDER BY day_keys.day ASC
            """
            result = await asyncio.wait_for(
                fetch_remote_activity_rows(user_id, sql, params),
                timeout=30,
            )
            if result.error or not result.rows:
                if result.error:
                    logger.info("Metric facts remote watcher daily read unavailable: %s", result.error)
                return []
            return [
                {
                    "day": row[0],
                    "active_ms": int(row[1] or 0),
                    "afk_ms": int(row[2] or 0),
                    "events_count": int(row[3] or 0),
                    "apps_count": int(row[4] or 0),
                    "domains_count": int(row[5] or 0),
                    "source": result.source or "turso_remote_sql_deoverlap_daily",
                }
                for row in result.rows
            ]
        except asyncio.TimeoutError:
            logger.warning("Metric facts remote watcher daily read timed out; falling back to rollups")
            return []
        except Exception as exc:
            logger.info("Metric facts remote watcher daily read failed; falling back to rollups: %s", exc)
            return []

    async def _upsert_fact_drafts(self, drafts: Sequence[FactDraft], *, run_id: str) -> Dict[str, int]:
        written = 0
        unchanged = 0
        if not drafts:
            return {"facts_written": 0, "facts_unchanged": 0}
        user_ids = sorted({draft.user_id for draft in drafts})
        habit_ids = sorted({draft.habit_id for draft in drafts})
        metric_keys = sorted({draft.metric_key for draft in drafts})
        dates = sorted({draft.date for draft in drafts})
        upsert_rows: List[Dict[str, Any]] = []
        async with get_db_session() as session:
            existing_rows = await session.execute(
                select(MetricDailyFactDB).where(
                    MetricDailyFactDB.user_id.in_(user_ids),
                    MetricDailyFactDB.habit_id.in_(habit_ids),
                    MetricDailyFactDB.metric_key.in_(metric_keys),
                    MetricDailyFactDB.date >= dates[0],
                    MetricDailyFactDB.date <= dates[-1],
                )
            )
            existing_by_key = {
                (row.user_id, row.habit_id, row.metric_key, row.date): row
                for row in existing_rows.scalars().all()
            }

        for draft in drafts:
            existing = existing_by_key.get(draft.stable_key)
            provenance_json = _json_dumps(draft.provenance)
            if existing is None:
                fact_id = str(uuid.uuid4())
            else:
                same = (
                    abs(float(existing.value or 0.0) - draft.value) < 1e-9
                    and existing.unit == draft.unit
                    and existing.source_family == draft.source_family
                    and existing.provider == draft.provider
                    and int(existing.record_count or 0) == int(draft.record_count or 0)
                    and (existing.provenance_json or "") == provenance_json
                    and existing.status == draft.status
                )
                if same:
                    unchanged += 1
                    continue
                fact_id = existing.id
            upsert_rows.append(
                {
                    "id": fact_id,
                    "user_id": draft.user_id,
                    "habit_id": draft.habit_id,
                    "habit_name": draft.habit_name,
                    "metric_key": draft.metric_key,
                    "date": draft.date,
                    "value": draft.value,
                    "unit": draft.unit,
                    "source_family": draft.source_family,
                    "provider": draft.provider,
                    "record_count": draft.record_count,
                    "provenance_json": provenance_json,
                    "rebuild_run_id": run_id,
                    "status": draft.status,
                    "updated_at": _utcnow().isoformat(sep=" "),
                }
            )
            written += 1
        if upsert_rows:
            await self._execute_fact_upserts(upsert_rows)
        return {"facts_written": written, "facts_unchanged": unchanged}

    async def _execute_fact_upserts(self, rows: Sequence[Dict[str, Any]]) -> None:
        import libsql_client
        from libsql_client import Statement

        database_url = os.getenv("DATABASE_URL") or ""
        parsed = urlparse(database_url)
        auth_token = parse_qs(parsed.query).get("authToken", [None])[0]
        if not parsed.netloc or not auth_token:
            raise RuntimeError("DATABASE_URL must be a libsql Turso URL with authToken for metric fact writes")
        client = libsql_client.create_client(f"https://{parsed.netloc}", auth_token=auth_token)
        sql = """
            INSERT INTO metric_daily_facts (
                id, user_id, habit_id, habit_name, metric_key, date, value, unit,
                source_family, provider, record_count, provenance_json, rebuild_run_id,
                status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, habit_id, metric_key, date) DO UPDATE SET
                habit_name = excluded.habit_name,
                value = excluded.value,
                unit = excluded.unit,
                source_family = excluded.source_family,
                provider = excluded.provider,
                record_count = excluded.record_count,
                provenance_json = excluded.provenance_json,
                rebuild_run_id = excluded.rebuild_run_id,
                status = excluded.status,
                updated_at = excluded.updated_at
        """
        try:
            for index in range(0, len(rows), 100):
                statements = [
                    Statement(
                        sql,
                        [
                            row["id"],
                            row["user_id"],
                            row["habit_id"],
                            row["habit_name"],
                            row["metric_key"],
                            row["date"],
                            row["value"],
                            row["unit"],
                            row["source_family"],
                            row["provider"],
                            row["record_count"],
                            row["provenance_json"],
                            row["rebuild_run_id"],
                            row["status"],
                            row["updated_at"],
                        ],
                    )
                    for row in rows[index:index + 100]
                ]
                await client.batch(statements)
        finally:
            await client.close()

    async def _create_run(
        self,
        *,
        user_id: str,
        mode: str,
        start_date: str,
        end_date: str,
        habit_ids: Optional[Sequence[str]],
        source_families: Optional[Sequence[str]],
    ) -> MetricFactRebuildRunDB:
        async with get_db_session() as session:
            run = MetricFactRebuildRunDB(
                id=str(uuid.uuid4()),
                user_id=user_id,
                mode=mode,
                status="running",
                start_date=start_date,
                end_date=end_date,
                habit_ids_json=_json_dumps(list(habit_ids or [])),
                source_families_json=_json_dumps(list(source_families or [])),
                created_at=_utcnow(),
                started_at=_utcnow(),
            )
            session.add(run)
            await session.commit()
            await session.refresh(run)
            return run

    async def _finish_run(
        self,
        run_id: str,
        *,
        status: str,
        facts_seen: int = 0,
        facts_written: int = 0,
        facts_unchanged: int = 0,
        legacy_fallback_count: int = 0,
        summary: Optional[Dict[str, Any]] = None,
        error: Optional[Dict[str, Any]] = None,
    ) -> None:
        async with get_db_session() as session:
            run = await session.get(MetricFactRebuildRunDB, run_id)
            if run is None:
                return
            run.status = status
            run.facts_seen = facts_seen
            run.facts_written = facts_written
            run.facts_unchanged = facts_unchanged
            run.legacy_fallback_count = legacy_fallback_count
            run.summary_json = _json_dumps(summary or {})
            run.error_json = _json_dumps(error) if error else None
            run.completed_at = _utcnow()
            await session.commit()

    def _summarize_drafts(self, drafts: Sequence[FactDraft]) -> Dict[str, Any]:
        by_family: Dict[str, int] = {}
        by_habit: Dict[str, Dict[str, Any]] = {}
        for draft in drafts:
            by_family[draft.source_family] = by_family.get(draft.source_family, 0) + 1
            habit_summary = by_habit.setdefault(
                draft.habit_id,
                {"habit_name": draft.habit_name, "unit": draft.unit, "total": 0.0, "days": 0},
            )
            habit_summary["total"] += draft.value
            habit_summary["days"] += 1
        return {"by_source_family": by_family, "by_habit": by_habit}

    def _serialize_daily(self, row: MetricDailyFactDB) -> Dict[str, Any]:
        return {
            "habit_id": row.habit_id,
            "habit_name": row.habit_name,
            "metric_key": row.metric_key,
            "date": row.date,
            "value": float(row.value or 0.0),
            "daily_value": float(row.value or 0.0),
            "total_amount": float(row.value or 0.0),
            "unit": row.unit,
            "source_family": row.source_family,
            "provider": row.provider,
            "record_count": int(row.record_count or 0),
            "status": row.status,
        }

    def _summarize_fact_rows(self, rows: Sequence[MetricDailyFactDB]) -> List[Dict[str, Any]]:
        buckets: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            bucket = buckets.setdefault(
                row.habit_id,
                {
                    "habit_id": row.habit_id,
                    "habit_name": row.habit_name,
                    "unit": row.unit,
                    "values": [],
                },
            )
            bucket["values"].append(float(row.value or 0.0))
        summary = []
        for bucket in buckets.values():
            values = [value for value in bucket.pop("values") if math.isfinite(value)]
            total = sum(values)
            days = len([value for value in values if value > 0])
            average = total / len(values) if values else 0.0
            summary.append(
                {
                    **bucket,
                    "total_value": total,
                    "current_value": average,
                    "days_with_data": days,
                }
            )
        return sorted(summary, key=lambda row: str(row.get("habit_name") or ""))

    def _build_habit_stat(self, habit: HabitDB, rows: Sequence[MetricDailyFactDB]) -> Dict[str, Any]:
        values = [float(row.value or 0.0) for row in rows if math.isfinite(float(row.value or 0.0))]
        total = sum(values)
        average = total / len(values) if values else 0.0
        minimum = min(values) if values else 0.0
        maximum = max(values) if values else 0.0
        variance = sum((value - average) ** 2 for value in values) / len(values) if values else 0.0
        unit = _target_unit(habit)
        return {
            "id": habit.id,
            "name": habit.name,
            "category": habit.category,
            "unit": unit,
            "total": total,
            "average": average,
            "min": minimum,
            "max": maximum,
            "variance": variance,
            "std_dev": variance ** 0.5,
            "days_with_data": len([value for value in values if value > 0]),
            "total_entries": len(values),
            "summary": f"{habit.name}: {total:.2f} total across {len(values)} days" if values else f"{habit.name}: no recent data",
        }

    def _build_reconciliation_report(
        self,
        drafts: Sequence[FactDraft],
        facts: Sequence[MetricDailyFactDB],
        *,
        dashboard_totals: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        expected = {draft.stable_key: draft for draft in drafts}
        actual = {
            (fact.user_id, fact.habit_id, fact.metric_key, fact.date): fact
            for fact in facts
        }
        mismatches = []
        missing = []
        extra = []
        for key, draft in expected.items():
            fact = actual.get(key)
            if fact is None:
                missing.append({"habit_id": draft.habit_id, "metric_key": draft.metric_key, "date": draft.date})
                continue
            tolerance = self._tolerance(draft.unit)
            if abs(float(fact.value or 0.0) - draft.value) > tolerance:
                mismatches.append(
                    {
                        "habit_id": draft.habit_id,
                        "habit_name": draft.habit_name,
                        "metric_key": draft.metric_key,
                        "date": draft.date,
                        "expected": draft.value,
                        "actual": float(fact.value or 0.0),
                        "unit": draft.unit,
                        "tolerance": tolerance,
                    }
                )
        for key, fact in actual.items():
            if key not in expected:
                extra.append({"habit_id": fact.habit_id, "metric_key": fact.metric_key, "date": fact.date})
        habit_totals = self._reconciliation_habit_totals(drafts, facts, dashboard_totals or {})
        return {
            "ok": not missing and not mismatches,
            "expected_fact_count": len(expected),
            "actual_fact_count": len(actual),
            "habit_totals": habit_totals,
            "missing": missing[:200],
            "extra": extra[:200],
            "mismatches": mismatches[:200],
            "warnings": ["Tinybird comparison is not checked in this local reconciliation pass."],
        }

    def _reconciliation_habit_totals(
        self,
        drafts: Sequence[FactDraft],
        facts: Sequence[MetricDailyFactDB],
        dashboard_totals: Dict[str, float],
    ) -> List[Dict[str, Any]]:
        buckets: Dict[str, Dict[str, Any]] = {}
        for draft in drafts:
            bucket = buckets.setdefault(
                draft.habit_id,
                {
                    "habit_id": draft.habit_id,
                    "habit_name": draft.habit_name,
                    "metric_key": draft.metric_key,
                    "unit": draft.unit,
                    "canonical_source_total": 0.0,
                    "legacy_fallback_total": 0.0,
                    "legacy_fallback_days": 0,
                    "expected_fact_total": 0.0,
                    "actual_fact_total": 0.0,
                    "dashboard_snapshot_total": dashboard_totals.get(draft.habit_id),
                },
            )
            if draft.source_family == "legacy_habit_log":
                bucket["legacy_fallback_total"] += draft.value
                bucket["legacy_fallback_days"] += 1
            else:
                bucket["canonical_source_total"] += draft.value
            bucket["expected_fact_total"] += draft.value

        for fact in facts:
            bucket = buckets.setdefault(
                fact.habit_id,
                {
                    "habit_id": fact.habit_id,
                    "habit_name": getattr(fact, "habit_name", None),
                    "metric_key": fact.metric_key,
                    "unit": getattr(fact, "unit", None),
                    "canonical_source_total": 0.0,
                    "legacy_fallback_total": 0.0,
                    "legacy_fallback_days": 0,
                    "expected_fact_total": 0.0,
                    "actual_fact_total": 0.0,
                    "dashboard_snapshot_total": dashboard_totals.get(fact.habit_id),
                },
            )
            bucket["actual_fact_total"] += float(fact.value or 0.0)

        for habit_id, total in dashboard_totals.items():
            bucket = buckets.setdefault(
                habit_id,
                {
                    "habit_id": habit_id,
                    "habit_name": None,
                    "metric_key": None,
                    "unit": None,
                    "canonical_source_total": 0.0,
                    "legacy_fallback_total": 0.0,
                    "legacy_fallback_days": 0,
                    "expected_fact_total": 0.0,
                    "actual_fact_total": 0.0,
                    "dashboard_snapshot_total": total,
                },
            )
            bucket["dashboard_snapshot_total"] = total

        return sorted(buckets.values(), key=lambda row: str(row.get("habit_name") or row.get("habit_id") or ""))

    def _dashboard_totals_by_habit(self, snapshot: Dict[str, Any]) -> Dict[str, float]:
        stats = snapshot.get("overviewStats") if isinstance(snapshot, dict) else None
        if not isinstance(stats, dict):
            return {}
        totals: Dict[str, float] = {}
        for habit_id, value in stats.items():
            if not isinstance(value, dict):
                continue
            try:
                totals[str(habit_id)] = float(value.get("total") or 0.0)
            except (TypeError, ValueError):
                continue
        return totals

    def _tolerance(self, unit: str) -> float:
        normalized = _unit_kind(unit)
        if normalized == "hours":
            return 0.05
        if normalized == "dollars":
            return 0.01
        return 1.0


metric_fact_service = MetricFactService()
