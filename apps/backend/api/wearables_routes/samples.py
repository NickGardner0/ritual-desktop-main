"""Wearables samples routes."""

from __future__ import annotations

import base64
import json
import logging
import os
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse
from sqlalchemy import select

from database.connection import get_db_session
from database.models import (
    HabitDB,
    HabitProjectionPolicyDB,
    WearableConnectionDB,
    WearableDeviceDB,
    WhoopIntegrationDB,
)
from schemas.wearables_apple import (
    AppleIngestRequest,
    AppleIngestRequestV2,
    AppleIngestResponse,
    AppleIngestResponseV2,
    AppleSyncTelemetryRequest,
    DeviceRegisterRequest,
    DeviceRegisterResponse,
    DeviceStatusResponse,
    SyncStatusResponse,
)
from schemas.wearables_unified import (
    WearableConnectionActionResponse,
    WearableConnectionsResponse,
    WearableDailyTotalsResponse,
    WearableIngestJobsResponse,
    WearableOutboxEventsResponse,
    WearableRawPayloadsResponse,
    WearableSeriesResponse,
    WearableSyncResponse,
    WearableTimelineResponse,
)
from services.wearable_provider_adapters import get_provider_adapter, list_provider_defs
from services.wearable_provider_sync_registry import sync_wearable_provider_account

from api.wearables_routes.deps import WearablesRouterDeps
from api.wearables_routes.models import ScheduledWearableSyncRequest, WearableSyncSettingsUpdateRequest
from api.wearables_helpers import (
    ALL_METRIC_TYPES as _ALL_METRIC_TYPES,
    METRIC_CATALOG as _METRIC_CATALOG,
    apple_owned_habit_metric_types as _apple_owned_habit_metric_types,
    build_tracked_metrics_contract as _build_tracked_metrics_contract,
    coerce_settings_payload as _coerce_settings_payload,
    connection_matches_sync_schedule as _connection_matches_sync_schedule,
    metric_category as _metric_category,
    metric_display_name as _metric_display_name,
    normalize_metric_preferences_v2 as _normalize_metric_preferences_v2,
    parse_csv_list as _parse_csv_list,
    parse_iso_datetime as _parse_iso_datetime,
    parse_metric_preferences_payload as _parse_metric_preferences_payload,
    require_internal_key as _require_internal_key,
    selected_metrics_from_preferences as _selected_metrics_from_preferences,
    serialize_connection as _serialize_connection,
    serialize_event as _serialize_event,
    serialize_ingest_job as _serialize_ingest_job,
    serialize_outbox_event as _serialize_outbox_event,
    serialize_raw_payload as _serialize_raw_payload,
    serialize_sample as _serialize_sample,
    serialize_sync_run as _serialize_sync_run,
)

logger = logging.getLogger(__name__)


def register_sample_routes(router: APIRouter, deps: WearablesRouterDeps) -> None:

    limiter = deps.limiter
    get_current_user = deps.get_current_user
    whoop_service = deps.whoop_service
    oura_service = deps.oura_service
    garmin_service = deps.garmin_service
    wearable_connection_service = deps.wearable_connection_service
    wearable_projection_service = deps.wearable_projection_service
    wearable_query_service = deps.wearable_query_service
    wearable_sync_service = deps.wearable_sync_service
    wearable_event_outbox_service = deps.wearable_event_outbox_service
    wearable_ingest_job_service = deps.wearable_ingest_job_service
    wearable_maintenance_service = deps.wearable_maintenance_service
    provider_sync_services = deps.provider_sync_services
    _mark_activation_completed = deps.mark_activation_completed

    @router.get("/api/wearables/samples")
    async def get_wearable_samples(
        provider: Optional[str] = None,
        metric_type: Optional[str] = None,
        include_deleted: bool = False,
        days_back: int = 7,
        limit: int = 100,
        current_user = Depends(get_current_user),
    ):
        from datetime import timedelta

        start_time = datetime.utcnow() - timedelta(days=days_back)
        samples = await wearable_query_service.get_samples(
            user_id=current_user["id"],
            provider=provider,
            metric_type=metric_type,
            start_time=start_time,
            include_deleted=include_deleted,
            limit=limit,
        )
        return {"samples": [_serialize_sample(sample) for sample in samples], "count": len(samples)}

    @router.get("/api/wearables/timeline", response_model=WearableTimelineResponse)
    async def get_wearable_timeline(
        providers: Optional[str] = None,
        metric_types: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 200,
        cursor: Optional[str] = None,
        include_manual_logs: bool = True,
        include_deleted: bool = False,
        current_user = Depends(get_current_user),
    ):
        del cursor  # Cursor wiring can be added once the dashboard consumes it.
        if not 1 <= limit <= 5000:
            raise HTTPException(status_code=400, detail="limit must be between 1 and 5000")
        try:
            parsed_start = _parse_iso_datetime(start_time, field_name="start_time")
            parsed_end = _parse_iso_datetime(end_time, field_name="end_time")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        items, next_cursor = await wearable_query_service.get_timeline(
            user_id=current_user["id"],
            providers=_parse_csv_list(providers),
            metric_types=_parse_csv_list(metric_types),
            start_time=parsed_start,
            end_time=parsed_end,
            include_manual_logs=include_manual_logs,
            include_deleted=include_deleted,
            limit=limit,
        )
        return {"items": items, "next_cursor": next_cursor}

    @router.get("/api/wearables/series", response_model=WearableSeriesResponse)
    async def get_wearable_series(
        metric_type: str,
        provider: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        resolution: str = "raw",
        limit: int = 2000,
        current_user = Depends(get_current_user),
    ):
        if resolution not in {"raw", "15m", "1h", "daily"}:
            raise HTTPException(status_code=400, detail="resolution must be one of raw, 15m, 1h, daily")
        if not 1 <= limit <= 5000:
            raise HTTPException(status_code=400, detail="limit must be between 1 and 5000")
        try:
            parsed_start = _parse_iso_datetime(start_time, field_name="start_time")
            parsed_end = _parse_iso_datetime(end_time, field_name="end_time")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        points = await wearable_query_service.get_series(
            user_id=current_user["id"],
            metric_type=metric_type,
            provider=provider,
            start_time=parsed_start,
            end_time=parsed_end,
            resolution=resolution,
            limit=limit,
        )
        resolved_resolution = points[0].rollup_level if points else resolution
        if resolved_resolution in {None, ""}:
            resolved_resolution = resolution
        selected_source = points[0].selected_source if points else None
        return {
            "metric_type": metric_type,
            "resolution": resolution,
            "resolved_resolution": resolved_resolution,
            "selected_source": selected_source,
            "points": points,
        }

    @router.get("/api/wearables/daily-totals", response_model=WearableDailyTotalsResponse)
    async def get_wearable_daily_totals(
        start_date: str,
        end_date: str,
        metric_types: Optional[str] = None,
        providers: Optional[str] = None,
        current_user = Depends(get_current_user),
    ):
        try:
            datetime.strptime(start_date, "%Y-%m-%d")
            datetime.strptime(end_date, "%Y-%m-%d")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="start_date and end_date must be YYYY-MM-DD") from exc

        days = await wearable_query_service.get_daily_totals(
            user_id=current_user["id"],
            metric_types=_parse_csv_list(metric_types),
            providers=_parse_csv_list(providers),
            start_date=start_date,
            end_date=end_date,
        )
        return {"days": days}

    @router.get("/api/wearables/events")
    async def get_wearable_events(
        provider: Optional[str] = None,
        event_type: Optional[str] = None,
        include_deleted: bool = False,
        days_back: int = 30,
        limit: int = 100,
        current_user = Depends(get_current_user),
    ):
        from datetime import timedelta

        start_time = datetime.utcnow() - timedelta(days=days_back)
        events = await wearable_query_service.get_events(
            user_id=current_user["id"],
            provider=provider,
            event_type=event_type,
            start_time=start_time,
            include_deleted=include_deleted,
            limit=limit,
        )
        return {"events": [_serialize_event(event) for event in events], "count": len(events)}

    @router.get("/api/wearables/metrics")
    async def get_wearable_metrics(
        source: Optional[str] = None,
        metric_type: Optional[str] = None,
        include_deleted: bool = False,
        days_back: int = 7,
        limit: int = 100,
        current_user = Depends(get_current_user)
    ):
        """
        Query stored wearable metrics for the current user.
        
        Query params:
        - source: Filter by source (apple_health, whoop, etc.)
        - metric_type: Filter by type (steps, active_energy, hr, etc.)
        - days_back: Days to look back (default 7)
        - limit: Max results (default 100)
        """
        try:
            from datetime import timedelta
            
            start_date = datetime.utcnow() - timedelta(days=days_back)
            
            metrics = await wearable_query_service.get_samples(
                user_id=current_user["id"],
                provider=source,
                metric_type=metric_type,
                start_time=start_date,
                include_deleted=include_deleted,
                limit=limit
            )
            
            return {
                "metrics": [
                    {
                        "id": m.id,
                        "source": m.provider,
                        "metric_type": m.metric_type,
                        "start_time": m.start_time.isoformat() if m.start_time else None,
                        "end_time": m.end_time.isoformat() if m.end_time else None,
                        "value": m.value,
                        "unit": m.unit,
                        "timezone": m.timezone,
                        "device_id": m.source_id,
                        "external_id": m.external_id,
                        "created_at": m.created_at.isoformat()
                    }
                    for m in metrics
                ],
                "count": len(metrics)
            }
            
        except Exception as e:
            logger.error(f"❌ Get metrics error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
