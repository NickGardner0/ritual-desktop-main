"""Search API router extracted from main.py."""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends

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

    @router.get("/api/search/status")
    async def search_status():
        return {
            "available": True,
            "backend": "sql",
            "message": "Search reads canonical Turso/SQL.",
        }

    return router
