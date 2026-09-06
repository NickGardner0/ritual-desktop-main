"""Canonical product search over Turso/SQL.

Command palette, habit autocomplete, and chat suggestions read the same
tables the rest of the product writes. There is no secondary search index.
"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, or_, select

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


UNIT_ABBREVIATIONS = {
    "Milligrams": "mg",
    "Minutes": "min",
    "Hours": "hr",
    "Miles": "mi",
    "Pages": "pages",
    "Steps": "steps",
    "Count": "",
    "Kilometers": "km",
    "Grams": "g",
    "Kilograms": "kg",
    "Pounds": "lbs",
    "Calories": "cal",
    "Liters": "L",
    "Cups": "cups",
    "BPM": "BPM",
    "Glasses": "glasses",
    "Sets": "sets",
}

QUICK_ACTIONS = [
    {"id": "log-habit", "name": "Log a habit", "keywords": ["log", "track", "add", "record", "capture"], "action": "navigate", "path": "/dashboard?view=overview&compose=log", "icon": "plus"},
    {"id": "search-logs", "name": "Search logs", "keywords": ["find", "search", "history", "logs", "activity"], "action": "navigate", "path": "/activity", "icon": "search"},
    {"id": "open-overview", "name": "Open overview", "keywords": ["home", "dashboard", "overview", "index"], "action": "navigate", "path": "/dashboard?view=overview", "icon": "list"},
    {"id": "view-metrics", "name": "View metrics", "keywords": ["stats", "charts", "graphs", "analytics", "metrics"], "action": "navigate", "path": "/dashboard?view=metrics", "icon": "bar-chart"},
    {"id": "open-calendar", "name": "Open calendar", "keywords": ["calendar", "schedule", "plan", "events"], "action": "navigate", "path": "/calendar", "icon": "calendar"},
    {"id": "open-tasks", "name": "Open tasks", "keywords": ["tasks", "todo", "board"], "action": "navigate", "path": "/tasks", "icon": "list"},
    {"id": "ai-assistant", "name": "Ask AI assistant", "keywords": ["ai", "chat", "ask", "help", "analyze"], "action": "navigate", "path": "/chat", "icon": "bot"},
    {"id": "import-data", "name": "Import data", "keywords": ["import", "upload", "csv", "health", "backfill"], "action": "navigate", "path": "/dashboard?view=overview&openImport=1", "icon": "upload"},
    {"id": "connect-wearables", "name": "Open integrations", "keywords": ["whoop", "oura", "garmin", "apple", "health", "connect", "integrations"], "action": "navigate", "path": "/integrations", "icon": "watch"},
    {"id": "settings", "name": "Settings", "keywords": ["settings", "preferences", "config", "account"], "action": "navigate", "path": "/dashboard?openSettings=account", "icon": "settings"},
    {"id": "computer-settings", "name": "Computer use settings", "keywords": ["computer", "watcher", "screen", "tracking", "activity"], "action": "navigate", "path": "/dashboard?openSettings=computer-tracking", "icon": "monitor"},
    {"id": "apple-health-settings", "name": "Apple Health settings", "keywords": ["apple", "health", "watch", "sync"], "action": "navigate", "path": "/dashboard?openSettings=apple-health", "icon": "watch"},
    {"id": "open-reports", "name": "Open reports", "keywords": ["reports", "artifacts", "notebooks", "plans"], "action": "navigate", "path": "/reports", "icon": "file"},
]


def _empty_bucket() -> Dict[str, Any]:
    return {"hits": [], "found": 0}


def _like(query: str) -> str:
    escaped = (
        (query or "")
        .strip()
        .lower()
        .replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )
    return f"%{escaped}%"


def _score_text(query: str, *parts: Optional[str]) -> int:
    needle = (query or "").strip().lower()
    haystack = " ".join(part for part in parts if part).lower()
    if not needle or not haystack:
        return 0
    score = 0
    if haystack == needle:
        score += 240
    if haystack.startswith(needle):
        score += 180
    elif needle in haystack:
        score += 90
    for token in needle.split():
        if not token:
            continue
        if token in haystack.split():
            score += 30
        elif any(word.startswith(token) for word in haystack.split()):
            score += 20
        elif token in haystack:
            score += 10
    return score


class SearchService:
    """SQL search over canonical Ritual tables."""

    CHAT_TEMPLATES_HABIT = [
        "How has my {habit} been this week?",
        "What's my {habit} trend over the past month?",
        "How does my {habit} this week compare to last week?",
        "Am I improving at {habit}?",
        "What's my average daily {habit}?",
        "When do I usually log {habit}?",
        "Show me my {habit} patterns",
        "What's my {habit} streak?",
        "How consistent have I been with {habit}?",
    ]

    CHAT_TEMPLATES_GENERAL = [
        "Which habits am I most consistent with?",
        "What habits have I been slacking on?",
        "What patterns do you see in my data?",
        "How am I doing overall this week?",
        "What should I focus on improving?",
        "Compare my performance this week vs last week",
        "What are my best days for productivity?",
        "Which habits correlate with each other?",
    ]

    @property
    def is_available(self) -> bool:
        return True

    async def delete_user_indexed_documents(
        self,
        user_id: str,
        collections: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        del user_id, collections
        return {
            "status": "completed",
            "deleted_count": 0,
            "collections": [],
            "note": "Product search reads canonical SQL; there is no secondary index to erase.",
        }

    def _empty_search(self, query: str) -> Dict[str, Any]:
        return {
            "query": query,
            "quick_actions": self._search_quick_actions(query),
            "habits": _empty_bucket(),
            "logs": _empty_bucket(),
            "conversations": _empty_bucket(),
            "activity": _empty_bucket(),
            "artifacts": _empty_bucket(),
            "workflows": _empty_bucket(),
            "facts": _empty_bucket(),
        }

    def _fallback_search(self, query: str) -> Dict[str, Any]:
        payload = self._empty_search(query)
        payload["fallback"] = True
        return payload

    def _search_quick_actions(self, query: str) -> List[Dict]:
        if not query:
            return QUICK_ACTIONS[:5]
        query_lower = query.lower()
        scored_actions = []
        for action in QUICK_ACTIONS:
            score = 0
            if query_lower in action["name"].lower():
                score += 10
            for keyword in action.get("keywords", []):
                if query_lower in keyword or keyword in query_lower:
                    score += 5
            if score > 0:
                scored_actions.append({**action, "score": score})
        scored_actions.sort(key=lambda item: item["score"], reverse=True)
        return scored_actions[:5]

    async def search_global(
        self,
        query: str,
        user_id: str,
        collections: List[str] = None,
        limit: int = 10,
    ) -> Dict[str, Any]:
        requested = collections or [
            "habits",
            "habit_logs",
            "ai_messages",
            "artifacts",
            "workflows",
            "ai_facts",
        ]
        if not (query or "").strip():
            return await self._get_recent_items(user_id, requested, limit)

        payload = self._empty_search(query)
        try:
            from database.connection import get_db_session
            from database.models import (
                AIConversationDB,
                AIMessageDB,
                ActionProfileDB,
                AiFactDB,
                ArtifactDB,
                HabitAliasDB,
                HabitDB,
                HabitLogDB,
                WorkflowDefinitionDB,
            )

            needle = _like(query)
            async with get_db_session() as session:
                if "habits" in requested:
                    aliases = (
                        await session.execute(
                            select(HabitAliasDB.habit_id, HabitAliasDB.alias_text).join(
                                HabitDB, HabitDB.id == HabitAliasDB.habit_id
                            ).where(HabitDB.user_id == user_id)
                        )
                    ).all()
                    alias_by_habit: Dict[str, List[str]] = {}
                    for habit_id, alias_text in aliases:
                        alias_by_habit.setdefault(habit_id, []).append(alias_text or "")
                    rows = (
                        await session.execute(
                            select(HabitDB).where(HabitDB.user_id == user_id)
                        )
                    ).scalars().all()
                    hits = []
                    for row in rows:
                        score = _score_text(
                            query,
                            row.name,
                            row.category,
                            *alias_by_habit.get(row.id, []),
                        )
                        if score <= 0:
                            continue
                        hits.append((
                            score,
                            {
                                "id": row.id,
                                "name": row.name,
                                "category": row.category,
                                "icon": row.icon,
                                "unit_type": row.unit_type,
                                "metric_type": row.metric_type,
                                "score": score,
                            },
                        ))
                    hits.sort(key=lambda item: item[0], reverse=True)
                    payload["habits"] = {
                        "hits": [hit for _, hit in hits[:limit]],
                        "found": len(hits),
                    }

                if "habit_logs" in requested:
                    rows = (
                        await session.execute(
                            select(HabitLogDB, HabitDB)
                            .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
                            .where(
                                HabitDB.user_id == user_id,
                                or_(
                                    func.lower(HabitLogDB.habit_name).like(needle),
                                    func.lower(func.coalesce(HabitLogDB.notes, "")).like(needle),
                                ),
                            )
                            .order_by(HabitLogDB.date.desc())
                            .limit(limit)
                        )
                    ).all()
                    hits = [
                        {
                            "id": log.id,
                            "habit_id": log.habit_id,
                            "habit_name": log.habit_name or habit.name,
                            "category": habit.category,
                            "date": log.date,
                            "amount": log.amount,
                            "duration": log.duration,
                            "notes": log.notes,
                            "status": log.status,
                            "source": log.source,
                        }
                        for log, habit in rows
                    ]
                    payload["logs"] = {"hits": hits, "found": len(hits)}

                if "ai_messages" in requested:
                    rows = (
                        await session.execute(
                            select(AIMessageDB, AIConversationDB)
                            .join(
                                AIConversationDB,
                                AIConversationDB.id == AIMessageDB.conversation_id,
                            )
                            .where(
                                AIConversationDB.user_id == user_id,
                                func.lower(AIMessageDB.content).like(needle),
                            )
                            .order_by(AIMessageDB.created_at.desc())
                            .limit(limit)
                        )
                    ).all()
                    hits = [
                        {
                            "id": message.id,
                            "conversation_id": message.conversation_id,
                            "role": message.role,
                            "content": message.content,
                            "content_preview": (message.content or "")[:200],
                        }
                        for message, _conversation in rows
                    ]
                    payload["conversations"] = {"hits": hits, "found": len(hits)}

                if "artifacts" in requested:
                    rows = (
                        await session.execute(
                            select(ArtifactDB)
                            .where(
                                ArtifactDB.user_id == user_id,
                                or_(
                                    func.lower(ArtifactDB.title).like(needle),
                                    func.lower(func.coalesce(ArtifactDB.summary, "")).like(needle),
                                    func.lower(func.coalesce(ArtifactDB.preview_text, "")).like(needle),
                                    func.lower(func.coalesce(ArtifactDB.slug, "")).like(needle),
                                ),
                            )
                            .order_by(ArtifactDB.is_pinned.desc(), ArtifactDB.updated_at.desc())
                            .limit(limit)
                        )
                    ).scalars().all()
                    hits = [
                        {
                            "id": row.id,
                            "title": row.title,
                            "kind": row.kind,
                            "status": row.status,
                            "summary": row.summary,
                            "preview_text": row.preview_text,
                        }
                        for row in rows
                    ]
                    payload["artifacts"] = {"hits": hits, "found": len(hits)}

                if "workflows" in requested:
                    rows = (
                        await session.execute(
                            select(WorkflowDefinitionDB, ActionProfileDB)
                            .join(
                                ActionProfileDB,
                                ActionProfileDB.id == WorkflowDefinitionDB.action_profile_id,
                            )
                            .where(
                                WorkflowDefinitionDB.user_id == user_id,
                                or_(
                                    func.lower(WorkflowDefinitionDB.name).like(needle),
                                    func.lower(WorkflowDefinitionDB.kind).like(needle),
                                    func.lower(WorkflowDefinitionDB.definition_family).like(needle),
                                    func.lower(func.coalesce(WorkflowDefinitionDB.signal_kind, "")).like(needle),
                                ),
                            )
                            .order_by(WorkflowDefinitionDB.updated_at.desc())
                            .limit(limit)
                        )
                    ).all()
                    hits = [
                        {
                            "id": definition.id,
                            "name": definition.name,
                            "kind": definition.kind,
                            "status": definition.status,
                            "definition_family": definition.definition_family,
                            "trigger_type": definition.trigger_type,
                        }
                        for definition, _profile in rows
                    ]
                    payload["workflows"] = {"hits": hits, "found": len(hits)}

                if "ai_facts" in requested:
                    rows = (
                        await session.execute(
                            select(AiFactDB)
                            .where(
                                AiFactDB.user_id == user_id,
                                AiFactDB.status == "active",
                                or_(
                                    func.lower(AiFactDB.category).like(needle),
                                    func.lower(AiFactDB.subject).like(needle),
                                    func.lower(AiFactDB.predicate).like(needle),
                                    func.lower(AiFactDB.value_json).like(needle),
                                ),
                            )
                            .order_by(AiFactDB.updated_at.desc())
                            .limit(limit)
                        )
                    ).scalars().all()
                    hits = []
                    for fact in rows:
                        try:
                            value = json.loads(fact.value_json or "{}")
                        except Exception:
                            value = {}
                        hits.append({
                            "id": fact.id,
                            "category": fact.category,
                            "subject": fact.subject,
                            "predicate": fact.predicate,
                            "status": fact.status,
                            "value_text": json.dumps(value) if not isinstance(value, str) else value,
                        })
                    payload["facts"] = {"hits": hits, "found": len(hits)}
        except Exception as exc:
            logger.error("SQL search failed: %s", exc)
            payload["fallback"] = True
        return payload

    async def search_habits(
        self,
        query: str,
        user_id: str,
        limit: int = 10,
        include_inactive: bool = False,
    ) -> List[Dict[str, Any]]:
        del include_inactive
        result = await self.search_global(query, user_id, collections=["habits"], limit=limit)
        return [
            {
                "id": hit.get("id"),
                "name": hit.get("name"),
                "category": hit.get("category"),
                "icon": hit.get("icon"),
                "unit_type": hit.get("unit_type"),
                "score": hit.get("score", 0),
            }
            for hit in result.get("habits", {}).get("hits", [])
        ]

    async def search_logs(
        self,
        query: str,
        user_id: str,
        habit_ids: List[str] = None,
        start_date: str = None,
        end_date: str = None,
        limit: int = 50,
    ) -> Dict[str, Any]:
        from database.connection import get_db_session
        from database.models import HabitDB, HabitLogDB

        try:
            async with get_db_session() as session:
                statement = (
                    select(HabitLogDB, HabitDB)
                    .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
                    .where(HabitDB.user_id == user_id)
                )
                if habit_ids:
                    statement = statement.where(HabitLogDB.habit_id.in_(habit_ids))
                if start_date:
                    statement = statement.where(HabitLogDB.date >= start_date)
                if end_date:
                    statement = statement.where(HabitLogDB.date <= end_date)
                if (query or "").strip():
                    needle = _like(query)
                    statement = statement.where(
                        or_(
                            func.lower(HabitLogDB.habit_name).like(needle),
                            func.lower(func.coalesce(HabitLogDB.notes, "")).like(needle),
                        )
                    )
                rows = (
                    await session.execute(
                        statement.order_by(HabitLogDB.date.desc()).limit(limit)
                    )
                ).all()
                hits = [
                    {
                        "id": log.id,
                        "habit_id": log.habit_id,
                        "habit_name": log.habit_name or habit.name,
                        "category": habit.category,
                        "date": log.date,
                        "amount": log.amount,
                        "duration": log.duration,
                        "notes": log.notes,
                        "status": log.status,
                        "source": log.source,
                    }
                    for log, habit in rows
                ]
                return {"hits": hits, "found": len(hits)}
        except Exception as exc:
            logger.error("Log search failed: %s", exc)
            return {"hits": [], "found": 0}

    async def _get_recent_items(
        self,
        user_id: str,
        collections: List[str],
        limit: int = 10,
    ) -> Dict[str, Any]:
        result = self._empty_search("")
        try:
            from database.connection import get_db_session
            from database.models import (
                ActionProfileDB,
                AiFactDB,
                ArtifactDB,
                HabitDB,
                HabitLogDB,
                WorkflowDefinitionDB,
            )

            async with get_db_session() as session:
                if "habits" in collections:
                    rows = (
                        await session.execute(
                            select(HabitDB)
                            .where(HabitDB.user_id == user_id)
                            .order_by(HabitDB.updated_at.desc())
                            .limit(limit)
                        )
                    ).scalars().all()
                    result["habits"] = {
                        "hits": [
                            {
                                "id": row.id,
                                "name": row.name,
                                "category": row.category,
                                "icon": row.icon,
                                "unit_type": row.unit_type,
                            }
                            for row in rows
                        ],
                        "found": len(rows),
                    }
                if "habit_logs" in collections:
                    rows = (
                        await session.execute(
                            select(HabitLogDB, HabitDB)
                            .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
                            .where(HabitDB.user_id == user_id)
                            .order_by(HabitLogDB.date.desc())
                            .limit(limit)
                        )
                    ).all()
                    result["logs"] = {
                        "hits": [
                            {
                                "id": log.id,
                                "habit_id": log.habit_id,
                                "habit_name": log.habit_name or habit.name,
                                "date": log.date,
                                "notes": log.notes,
                            }
                            for log, habit in rows
                        ],
                        "found": len(rows),
                    }
                if "artifacts" in collections:
                    rows = (
                        await session.execute(
                            select(ArtifactDB)
                            .where(ArtifactDB.user_id == user_id)
                            .order_by(ArtifactDB.is_pinned.desc(), ArtifactDB.updated_at.desc())
                            .limit(limit)
                        )
                    ).scalars().all()
                    result["artifacts"] = {
                        "hits": [
                            {
                                "id": row.id,
                                "title": row.title,
                                "kind": row.kind,
                                "status": row.status,
                                "summary": row.summary,
                                "preview_text": row.preview_text,
                            }
                            for row in rows
                        ],
                        "found": len(rows),
                    }
                if "workflows" in collections:
                    rows = (
                        await session.execute(
                            select(WorkflowDefinitionDB, ActionProfileDB)
                            .join(
                                ActionProfileDB,
                                ActionProfileDB.id == WorkflowDefinitionDB.action_profile_id,
                            )
                            .where(WorkflowDefinitionDB.user_id == user_id)
                            .order_by(WorkflowDefinitionDB.updated_at.desc())
                            .limit(limit)
                        )
                    ).all()
                    result["workflows"] = {
                        "hits": [
                            {
                                "id": definition.id,
                                "name": definition.name,
                                "kind": definition.kind,
                                "status": definition.status,
                                "definition_family": definition.definition_family,
                                "trigger_type": definition.trigger_type,
                            }
                            for definition, _profile in rows
                        ],
                        "found": len(rows),
                    }
                if "ai_facts" in collections:
                    rows = (
                        await session.execute(
                            select(AiFactDB)
                            .where(AiFactDB.user_id == user_id, AiFactDB.status == "active")
                            .order_by(AiFactDB.updated_at.desc())
                            .limit(limit)
                        )
                    ).scalars().all()
                    result["facts"] = {
                        "hits": [
                            {
                                "id": fact.id,
                                "category": fact.category,
                                "subject": fact.subject,
                                "predicate": fact.predicate,
                                "status": fact.status,
                            }
                            for fact in rows
                        ],
                        "found": len(rows),
                    }
        except Exception as exc:
            logger.error("Failed DB recents: %s", exc)
        return result

    async def get_suggestions(
        self,
        user_id: str,
        mode: str = "chat",
        query: str = "",
        habits_context: List[Dict] = None,
    ) -> List[Dict[str, Any]]:
        if mode == "log":
            return await self._get_log_suggestions(user_id, query, habits_context)
        return await self._get_chat_suggestions(user_id, query, habits_context)

    def _format_value_suggestion(self, value: float, unit_type: str, habit_name: str) -> str:
        abbrev = UNIT_ABBREVIATIONS.get(unit_type, unit_type or "")
        val_str = str(int(value)) if value == int(value) else f"{value:.1f}"
        name_lower = habit_name.lower()
        if not abbrev:
            return f"{val_str} {name_lower}"
        if abbrev in ("min", "hr"):
            return f"{val_str} {abbrev} {name_lower}"
        attached_units = {"mg", "g", "kg", "lbs", "cal", "L", "km", "mi"}
        if abbrev in attached_units:
            return f"{val_str}{abbrev} of {name_lower}"
        return f"{val_str} {abbrev} of {name_lower}"

    def _normalize_suggestion_text(self, value: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", (value or "").lower())).strip()

    def _score_suggestion_text(self, query: str, candidate: str) -> int:
        return _score_text(query, candidate)

    async def _list_user_habits(self, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        from database.connection import get_db_session
        from database.models import HabitDB

        async with get_db_session() as session:
            rows = (
                await session.execute(
                    select(HabitDB)
                    .where(HabitDB.user_id == user_id)
                    .order_by(HabitDB.updated_at.desc())
                    .limit(limit)
                )
            ).scalars().all()
        return [
            {"id": row.id, "name": row.name, "unit_type": row.unit_type or ""}
            for row in rows
        ]

    async def _get_habit_common_values(
        self, user_id: str, habit_id: str, limit: int = 20
    ) -> List[float]:
        from database.connection import get_db_session
        from database.models import HabitDB, HabitLogDB

        try:
            async with get_db_session() as session:
                rows = (
                    await session.execute(
                        select(HabitLogDB)
                        .join(HabitDB, HabitDB.id == HabitLogDB.habit_id)
                        .where(HabitDB.user_id == user_id, HabitLogDB.habit_id == habit_id)
                        .order_by(HabitLogDB.date.desc())
                        .limit(limit)
                    )
                ).scalars().all()
            values: List[float] = []
            for log in rows:
                if log.amount is not None and log.amount > 0:
                    values.append(float(log.amount))
                elif log.duration is not None and log.duration > 0:
                    minutes = log.duration / 60
                    values.append(minutes / 60 if minutes >= 60 and minutes % 60 == 0 else minutes)
            return [value for value, _ in Counter(values).most_common(6)]
        except Exception as exc:
            logger.warning("Get habit values failed: %s", exc)
            return []

    async def _get_log_suggestions(
        self, user_id: str, query: str, habits_context: List[Dict] = None
    ) -> List[Dict[str, Any]]:
        habits = await self._list_user_habits(user_id)
        if query:
            ranked = sorted(
                (( _score_text(query, habit["name"]), habit) for habit in habits),
                key=lambda item: item[0],
                reverse=True,
            )
            matched = [habit for score, habit in ranked if score > 0][:4]
        else:
            matched = habits[:4]

        if not matched and habits_context:
            matched = [
                {
                    "id": habit.get("id"),
                    "name": habit.get("name", ""),
                    "unit_type": habit.get("unit_type", ""),
                }
                for habit in habits_context[:4]
            ]

        suggestions = []
        for habit in matched:
            common_values = await self._get_habit_common_values(user_id, habit["id"])
            if common_values:
                suggestions.append({
                    "text": self._format_value_suggestion(
                        common_values[0],
                        habit.get("unit_type", ""),
                        habit["name"],
                    ),
                    "type": "log_phrase",
                    "habit_id": habit["id"],
                    "habit_name": habit["name"],
                    "unit_type": habit.get("unit_type", ""),
                    "value": common_values[0],
                })
            else:
                suggestions.append({
                    "text": habit["name"],
                    "type": "habit",
                    "habit_id": habit["id"],
                    "habit_name": habit["name"],
                    "unit_type": habit.get("unit_type", ""),
                })
        return suggestions[:4]

    async def _get_chat_suggestions(
        self, user_id: str, query: str, habits_context: List[Dict] = None
    ) -> List[Dict[str, Any]]:
        habits = await self._list_user_habits(user_id)
        habit_names = [habit["name"] for habit in habits if habit.get("name")]
        if not habit_names and habits_context:
            habit_names = [habit.get("name", "") for habit in habits_context if habit.get("name")]

        all_suggestions: List[Dict[str, Any]] = []
        for habit_name in habit_names[:8]:
            for template in self.CHAT_TEMPLATES_HABIT:
                all_suggestions.append({
                    "text": template.replace("{habit}", habit_name.lower()),
                    "type": "question",
                    "habit_name": habit_name,
                })
        for template in self.CHAT_TEMPLATES_GENERAL:
            all_suggestions.append({"text": template, "type": "question"})

        if query:
            scored = [
                (self._score_suggestion_text(query, " ".join(part for part in [item.get("text", ""), item.get("habit_name", "")] if part)), item)
                for item in all_suggestions
            ]
            scored = [(score, item) for score, item in scored if score > 0]
            scored.sort(key=lambda item: item[0], reverse=True)
            if scored:
                return [item for _, item in scored[:5]]
            query_text = query.strip()
            return [
                {"text": f"What patterns do you see around {query_text}?", "type": "question"},
                {"text": f"How has {query_text} changed over time?", "type": "question"},
                {"text": f"When was {query_text} strongest for me?", "type": "question"},
            ]

        if habit_names:
            day_seed = _utc_now().timetuple().tm_yday
            suggestions = []
            seen_habits = set()
            habit_specific = [item for item in all_suggestions if item.get("habit_name")]
            for index in range(len(habit_specific)):
                item = habit_specific[(day_seed + index * 7) % len(habit_specific)]
                name = item.get("habit_name", "")
                if name in seen_habits:
                    continue
                suggestions.append(item)
                seen_habits.add(name)
                if len(suggestions) >= 3:
                    break
            general = [item for item in all_suggestions if not item.get("habit_name")]
            if general:
                suggestions.append(general[day_seed % len(general)])
            return suggestions[:4]
        return [{"text": text, "type": "question"} for text in self.CHAT_TEMPLATES_GENERAL[:4]]


search_service = SearchService()
