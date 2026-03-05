"""Analytics API router extracted from main.py."""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select

from database.connection import get_db_session
from database.models import HabitDB, HabitLogDB
from services.analytics_service import analytics_service

logger = logging.getLogger(__name__)


def create_analytics_router(
    *,
    limiter: Any,
    get_current_user: Callable[..., Any],
    require_tinybird: Callable[..., Any],
    habits_service: Any,
) -> APIRouter:
    """Build analytics router with injected app dependencies."""
    router = APIRouter(prefix="/api/analytics", tags=["analytics"])

    @router.get("/habits/summary")
    @limiter.limit("20/minute")  # Max 20 analytics queries per minute
    async def get_habits_summary(
        request: Request,
        days_back: int = Query(30, ge=1, le=36500),  # Allow "All time" queries (~100 years)
        current_user=Depends(get_current_user),
    ):
        try:
            tb = require_tinybird()
            return await tb.get_user_habits_summary(current_user["id"], days_back)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/habits/trends")
    @limiter.limit("20/minute")  # Max 20 trend queries per minute
    async def get_habit_trends(
        request: Request,
        period: str = "day",
        days_back: int = Query(30, ge=1, le=36500),  # Allow "All time" queries (~100 years)
        habit_id: Optional[str] = None,
        current_user=Depends(get_current_user),
    ):
        try:
            tb = require_tinybird()
            return await tb.get_habit_trends(current_user["id"], period, days_back, habit_id)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/habits/breakdown")
    async def get_habits_breakdown(
        start_date: str,
        end_date: str,
        current_user=Depends(get_current_user),
    ):
        try:
            breakdown = await habits_service.get_category_breakdown(
                current_user["id"], start_date, end_date
            )
            return {"breakdown": breakdown}
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/stats")
    @limiter.limit("30/minute")
    async def get_habit_stats(
        request: Request,
        habit_id: Optional[str] = None,
        habit_name: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = Query(30, ge=1, le=36500),
        current_user=Depends(get_current_user),
    ):
        try:
            return await analytics_service.get_habit_stats(
                user_id=current_user["id"],
                habit_id=habit_id,
                habit_name=habit_name,
                start_date=start_date,
                end_date=end_date,
                days_back=days_back,
            )
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/daily-breakdown")
    @limiter.limit("30/minute")
    async def get_daily_breakdown(
        request: Request,
        habit_id: Optional[str] = None,
        habit_name: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = Query(30, ge=1, le=36500),
        timezone: Optional[str] = None,
        current_user=Depends(get_current_user),
    ):
        try:
            return await analytics_service.get_daily_breakdown(
                user_id=current_user["id"],
                habit_id=habit_id,
                habit_name=habit_name,
                start_date=start_date,
                end_date=end_date,
                days_back=days_back,
                timezone=timezone,
            )
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.post("/tinybird-backfill")
    @limiter.limit("5/minute")
    async def tinybird_backfill(
        request: Request,
        current_user=Depends(get_current_user),
    ):
        tb = require_tinybird()
        try:
            user_id = current_user["id"]
            async with get_db_session() as session:
                habits_result = await session.execute(
                    select(HabitDB).where(HabitDB.user_id == user_id)
                )
                habits = habits_result.scalars().all()
                habit_map = {h.id: h for h in habits}

                if not habits:
                    return {"success": True, "message": "No habits found", "total_synced": 0}

                logs_result = await session.execute(
                    select(HabitLogDB).join(HabitDB).where(HabitDB.user_id == user_id)
                )
                logs_db = logs_result.scalars().all()

            all_logs = []
            for log in logs_db:
                habit = habit_map.get(log.habit_id)
                all_logs.append(
                    {
                        "id": log.id,
                        "habit_id": log.habit_id,
                        "habit_name": log.habit_name or (habit.name if habit else "Unknown"),
                        "user_id": user_id,
                        "date": log.date,
                        "completed_at": log.completed_at,
                        "status": log.status,
                        "duration": log.duration,
                        "amount": log.amount,
                        "unit": habit.unit_type if habit else "none",
                        "notes": log.notes,
                        "source": log.source or "manual",
                        "metadata": log.log_metadata,
                        "integration_source": habit.integration_source if habit else None,
                        "metric_type": habit.metric_type if habit else None,
                    }
                )

            if not all_logs:
                return {"success": True, "message": "No logs to backfill", "total_synced": 0}

            logger.info(
                "Starting Tinybird backfill: %s logs for %s habits",
                len(all_logs),
                len(habits),
            )
            result = await tb.ingest_habit_logs_batch(all_logs)
            logger.info("Tinybird backfill complete: %s", result)

            return {
                "success": result.get("success", False),
                "total_logs": result.get("total_logs", 0),
                "total_synced": result.get("total_ingested", 0),
                "errors": result.get("errors", []),
            }
        except Exception:
            logger.exception("Tinybird backfill failed")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/correlation")
    @limiter.limit("20/minute")
    async def get_correlation(
        request: Request,
        habit1_id: Optional[str] = None,
        habit1_name: Optional[str] = None,
        habit2_id: Optional[str] = None,
        habit2_name: Optional[str] = None,
        days_back: int = Query(30, ge=7, le=36500),
        current_user=Depends(get_current_user),
    ):
        try:
            return await analytics_service.get_correlation(
                user_id=current_user["id"],
                habit1_id=habit1_id,
                habit1_name=habit1_name,
                habit2_id=habit2_id,
                habit2_name=habit2_name,
                days_back=days_back,
            )
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/list-habits")
    async def list_habits_for_analytics(
        current_user=Depends(get_current_user),
    ):
        try:
            return await analytics_service.list_habits(current_user["id"])
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/trends")
    @limiter.limit("20/minute")
    async def get_analytics_trends(
        request: Request,
        habit_id: Optional[str] = None,
        habit_name: Optional[str] = None,
        window_days: int = Query(30, ge=7, le=36500),
        current_user=Depends(get_current_user),
    ):
        try:
            return await analytics_service.get_habit_trends(
                user_id=current_user["id"],
                habit_id=habit_id,
                habit_name=habit_name,
                window_days=window_days,
            )
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    @router.get("/anomalies")
    @limiter.limit("20/minute")
    async def get_analytics_anomalies(
        request: Request,
        habit_id: Optional[str] = None,
        habit_name: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = Query(30, ge=1, le=36500),
        z_threshold: float = 2.0,
        max_results: int = Query(5, ge=1, le=50),
        current_user=Depends(get_current_user),
    ):
        try:
            return await analytics_service.get_habit_anomalies(
                user_id=current_user["id"],
                habit_id=habit_id,
                habit_name=habit_name,
                start_date=start_date,
                end_date=end_date,
                days_back=days_back,
                z_threshold=z_threshold,
                max_results=max_results,
            )
        except Exception:
            raise HTTPException(status_code=400, detail="Request could not be processed.")

    return router
