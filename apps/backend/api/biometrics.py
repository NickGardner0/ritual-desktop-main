"""Heart-rate biometrics API router."""

from datetime import date, datetime
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException


def create_biometrics_router(
    *,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    from schemas.biometrics import (
        HeartRateBatchIngestResponse,
        HeartRateDaySummaryOut,
        HeartRateDeleteResponse,
        HeartRateRangeQueryOut,
        HeartRateResolution,
        HeartRateSampleBatchIn,
        HeartRateSessionCreate,
        HeartRateSessionEndRequest,
        HeartRateSessionOut,
        LiveBiometricsOut,
    )
    from services.biometrics_service import biometrics_service

    router = APIRouter(tags=["biometrics"])

    @router.post(
        "/api/v1/biometrics/heart-rate/sessions",
        response_model=HeartRateSessionOut,
    )
    @router.post(
        "/api/v1/biometrics/heart-rate/device-session",
        response_model=HeartRateSessionOut,
    )
    async def create_heart_rate_session(
        payload: HeartRateSessionCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            session_row = await biometrics_service.create_session(current_user["id"], payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return HeartRateSessionOut.model_validate(session_row, from_attributes=True)

    @router.patch(
        "/api/v1/biometrics/heart-rate/sessions/{session_id}/end",
        response_model=HeartRateSessionOut,
    )
    async def end_heart_rate_session(
        session_id: str,
        payload: HeartRateSessionEndRequest,
        current_user=Depends(get_current_user),
    ):
        session_row = await biometrics_service.end_session(current_user["id"], session_id, payload)
        if session_row is None:
            raise HTTPException(status_code=404, detail="Heart-rate session not found")
        return HeartRateSessionOut.model_validate(session_row, from_attributes=True)

    @router.post(
        "/api/v1/biometrics/heart-rate/device-session/end",
        response_model=HeartRateSessionOut,
    )
    async def end_heart_rate_session_alias(
        session_id: str,
        payload: HeartRateSessionEndRequest,
        current_user=Depends(get_current_user),
    ):
        session_row = await biometrics_service.end_session(current_user["id"], session_id, payload)
        if session_row is None:
            raise HTTPException(status_code=404, detail="Heart-rate session not found")
        return HeartRateSessionOut.model_validate(session_row, from_attributes=True)

    @router.post(
        "/api/v1/biometrics/heart-rate/samples:batch",
        response_model=HeartRateBatchIngestResponse,
    )
    async def ingest_heart_rate_samples(
        payload: HeartRateSampleBatchIn,
        current_user=Depends(get_current_user),
    ):
        try:
            result = await biometrics_service.ingest_samples(current_user["id"], payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return HeartRateBatchIngestResponse(
            success=True,
            inserted_count=result.inserted_count,
            duplicate_count=result.duplicate_count,
            rollup_buckets_updated=result.rollup_buckets_updated,
            live=result.live,
        )

    @router.get(
        "/api/v1/biometrics/live",
        response_model=LiveBiometricsOut,
    )
    @router.get(
        "/api/v1/biometrics/heart-rate/live",
        response_model=LiveBiometricsOut,
    )
    async def get_live_biometrics(current_user=Depends(get_current_user)):
        return await biometrics_service.get_live(current_user["id"])

    @router.get(
        "/api/v1/biometrics/heart-rate/range",
        response_model=HeartRateRangeQueryOut,
    )
    async def get_heart_rate_range(
        start: datetime,
        end: datetime,
        resolution: HeartRateResolution = HeartRateResolution.ONE_MINUTE,
        source_type: Optional[str] = None,
        current_user=Depends(get_current_user),
    ):
        try:
            points = await biometrics_service.get_range(
                current_user["id"],
                start=start,
                end=end,
                resolution=resolution.value,
                source_type=source_type,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return HeartRateRangeQueryOut(
            resolution=resolution,
            points=points,
        )

    @router.get(
        "/api/v1/biometrics/heart-rate/day-summary",
        response_model=HeartRateDaySummaryOut,
    )
    async def get_heart_rate_day_summary(
        day: Optional[date] = None,
        current_user=Depends(get_current_user),
    ):
        target_day = day or datetime.utcnow().date()
        return await biometrics_service.get_day_summary(current_user["id"], target_day)

    @router.delete(
        "/api/v1/biometrics/heart-rate/user-data",
        response_model=HeartRateDeleteResponse,
    )
    async def delete_heart_rate_user_data(current_user=Depends(get_current_user)):
        counts = await biometrics_service.delete_user_data(current_user["id"])
        return HeartRateDeleteResponse(success=True, **counts)

    return router
