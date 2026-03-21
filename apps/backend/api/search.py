"""Search API router extracted from main.py."""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException

from services.search_service import search_service

logger = logging.getLogger(__name__)


def create_search_router(
    *,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    """Build search router with injected auth dependency."""
    router = APIRouter(tags=["search"])

    @router.get("/api/search")
    async def global_search(
        q: str = "",
        collections: Optional[str] = None,
        limit: int = 10,
        current_user=Depends(get_current_user),
    ):
        try:
            collection_list = collections.split(",") if collections else None
            return await search_service.search_global(
                query=q,
                user_id=current_user["id"],
                collections=collection_list,
                limit=limit,
            )
        except Exception as e:
            logger.error("Search error: %s", str(e))
            return search_service._fallback_search(q)

    @router.get("/api/search/habits")
    async def search_habits_endpoint(
        q: str = "",
        limit: int = 10,
        include_inactive: bool = False,
        current_user=Depends(get_current_user),
    ):
        try:
            results = await search_service.search_habits(
                query=q,
                user_id=current_user["id"],
                limit=limit,
                include_inactive=include_inactive,
            )
            return {"hits": results, "found": len(results)}
        except Exception as e:
            logger.error("Habit search error: %s", str(e))
            return {"hits": [], "found": 0}

    @router.get("/api/search/logs")
    async def search_logs_endpoint(
        q: str = "",
        habit_ids: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        limit: int = 50,
        current_user=Depends(get_current_user),
    ):
        try:
            habit_id_list = habit_ids.split(",") if habit_ids else None
            return await search_service.search_logs(
                query=q,
                user_id=current_user["id"],
                habit_ids=habit_id_list,
                start_date=start_date,
                end_date=end_date,
                limit=limit,
            )
        except Exception as e:
            logger.error("Log search error: %s", str(e))
            return {"hits": [], "found": 0}

    @router.post("/api/search/reindex")
    async def reindex_user_data(current_user=Depends(get_current_user)):
        try:
            from datetime import datetime, timedelta

            from sqlalchemy import select

            from database.connection import get_db_session
            from database.models import AIConversationDB, AIMessageDB, HabitDB, HabitLogDB

            user_id = current_user["id"]
            indexed_counts = {"habits": 0, "logs": 0, "messages": 0}

            async with get_db_session() as session:
                habits_result = await session.execute(
                    select(HabitDB).where(HabitDB.user_id == user_id)
                )
                habits = habits_result.scalars().all()

                habit_docs = []
                for h in habits:
                    habit_docs.append(
                        {
                            "id": h.id,
                            "name": h.name,
                            "category": h.category,
                            "icon": h.icon,
                            "unit_type": h.unit_type,
                            "metric_type": h.metric_type,
                            "is_active": h.is_active,
                            "goal": h.goal,
                            "created_at": h.created_at,
                            "updated_at": h.updated_at,
                            "aliases": [],
                        }
                    )

                await search_service.bulk_index_habits(habit_docs, user_id)
                indexed_counts["habits"] = len(habit_docs)

                ninety_days_ago = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")
                logs_result = await session.execute(
                    select(HabitLogDB, HabitDB.name, HabitDB.category)
                    .join(HabitDB, HabitLogDB.habit_id == HabitDB.id)
                    .where(HabitDB.user_id == user_id)
                    .where(HabitLogDB.date >= ninety_days_ago)
                )
                logs = logs_result.all()

                log_docs = []
                for log, habit_name, category in logs:
                    log_docs.append(
                        {
                            "id": log.id,
                            "habit_id": log.habit_id,
                            "habit_name": habit_name,
                            "category": category,
                            "date": log.date,
                            "amount": log.amount,
                            "duration": log.duration,
                            "unit_type": log.unit_type,
                            "status": log.status,
                            "notes": log.notes,
                            "source": log.source,
                            "created_at": log.completed_at,
                        }
                    )

                await search_service.bulk_index_logs(log_docs, user_id)
                indexed_counts["logs"] = len(log_docs)

                messages_result = await session.execute(
                    select(AIMessageDB, AIConversationDB.user_id)
                    .join(AIConversationDB, AIMessageDB.conversation_id == AIConversationDB.id)
                    .where(AIConversationDB.user_id == user_id)
                )
                messages = messages_result.all()

                for message, _ in messages:
                    await search_service.index_ai_message(
                        {
                            "id": message.id,
                            "conversation_id": message.conversation_id,
                            "role": message.role,
                            "content": message.content,
                            "created_at": message.created_at,
                        },
                        user_id,
                    )
                indexed_counts["messages"] = len(messages)

            return {
                "success": True,
                "indexed": indexed_counts,
                "message": (
                    f"Indexed {indexed_counts['habits']} habits, "
                    f"{indexed_counts['logs']} logs, and {indexed_counts['messages']} messages"
                ),
            }

        except Exception as e:
            logger.error("Reindex error: %s", str(e))
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/suggestions")
    async def get_suggestions(
        mode: str = "chat",
        q: str = "",
        current_user=Depends(get_current_user),
    ):
        try:
            suggestions = await search_service.get_suggestions(
                user_id=current_user["id"],
                mode=mode,
                query=q,
            )
            return {"suggestions": suggestions, "mode": mode, "query": q}
        except Exception as e:
            logger.error("Suggestions error: %s", str(e))
            return {"suggestions": [], "mode": mode, "query": q}

    @router.post("/api/search/index-phrase")
    async def index_log_phrase(
        data: dict,
        current_user=Depends(get_current_user),
    ):
        try:
            input_text = data.get("input_text", "")
            habit_id = data.get("habit_id", "")
            habit_name = data.get("habit_name", "")
            value = data.get("value")
            unit = data.get("unit")

            if not input_text or not habit_id:
                return {"success": False, "message": "input_text and habit_id required"}

            await search_service.index_log_phrase(
                user_id=current_user["id"],
                input_text=input_text,
                habit_id=habit_id,
                habit_name=habit_name,
                value=value,
                unit=unit,
            )
            return {"success": True}
        except Exception as e:
            logger.error("Index phrase error: %s", str(e))
            return {"success": False, "message": str(e)}

    @router.get("/api/search/status")
    async def search_status():
        return {
            "available": search_service.is_available,
            "message": "Search service is ready" if search_service.is_available else "Typesense not configured",
        }

    return router
