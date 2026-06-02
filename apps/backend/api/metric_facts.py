"""Canonical metric fact APIs."""

from __future__ import annotations

from typing import Any, Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from services.metric_facts_service import metric_fact_service


def _csv(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


class MetricFactRebuildRequest(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    days_back: int = 3650
    habit_ids: Optional[List[str]] = None
    source_families: Optional[List[str]] = None
    include_legacy_fallback: bool = True
    apply: bool = False


class MetricFactReconcileRequest(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    days_back: int = 3650
    habit_ids: Optional[List[str]] = None


def create_metric_facts_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/metrics", tags=["metric-facts"])

    @router.get("/facts/daily")
    async def get_metric_daily_facts(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = Query(30, ge=1, le=3650),
        habit_id: Optional[str] = None,
        habit_ids: Optional[str] = None,
        current_user=Depends(get_current_user),
    ):
        resolved_ids = [habit_id] if habit_id else _csv(habit_ids)
        return await metric_fact_service.get_daily_facts(
            user_id=current_user["id"],
            start_date=start_date,
            end_date=end_date,
            days_back=days_back,
            habit_ids=resolved_ids or None,
        )

    @router.get("/facts/summary")
    async def get_metric_summary_facts(
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        days_back: int = Query(30, ge=1, le=3650),
        habit_id: Optional[str] = None,
        habit_ids: Optional[str] = None,
        current_user=Depends(get_current_user),
    ):
        resolved_ids = [habit_id] if habit_id else _csv(habit_ids)
        return await metric_fact_service.get_summary_facts(
            user_id=current_user["id"],
            start_date=start_date,
            end_date=end_date,
            days_back=days_back,
            habit_ids=resolved_ids or None,
        )

    @router.post("/facts/rebuild")
    async def rebuild_metric_facts(
        payload: MetricFactRebuildRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await metric_fact_service.rebuild_facts(
                user_id=current_user["id"],
                start_date=payload.start_date,
                end_date=payload.end_date,
                days_back=payload.days_back,
                habit_ids=payload.habit_ids,
                source_families=payload.source_families,
                include_legacy_fallback=payload.include_legacy_fallback,
                apply=payload.apply,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/facts/rebuild-runs/{run_id}")
    async def get_metric_fact_rebuild_run(
        run_id: str,
        current_user=Depends(get_current_user),
    ):
        run = await metric_fact_service.get_rebuild_run(user_id=current_user["id"], run_id=run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Metric fact rebuild run not found")
        return {"success": True, "run": run}

    @router.post("/reconcile")
    async def reconcile_metric_facts(
        payload: MetricFactReconcileRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await metric_fact_service.reconcile(
                user_id=current_user["id"],
                start_date=payload.start_date,
                end_date=payload.end_date,
                days_back=payload.days_back,
                habit_ids=payload.habit_ids,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return router
