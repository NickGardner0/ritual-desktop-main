"""Wearables sync runs routes."""

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
from services.privacy_policy import (
    can_send_to_cloud,
    request_cloud_consents,
    request_privacy_mode,
)
from services.wearable_provider_adapters import get_provider_adapter, list_provider_defs
from services.wearable_provider_definitions import UnsupportedProviderCapability, require_async_backfill
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


def _enforce_provider_sync_consent(request: Optional[Request] = None) -> None:
    decision = can_send_to_cloud(
        data_class="health_metric",
        destination="provider_api",
        purpose="provider_sync",
        mode=request_privacy_mode(request.headers) if request else None,
        consents=request_cloud_consents(request.headers) if request else None,
    )
    if not decision.allowed:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Cloud consent required",
                "privacy_blocked": True,
                "reason": decision.reason,
                "required_consent": "provider_sync",
            },
        )


def register_sync_run_routes(router: APIRouter, deps: WearablesRouterDeps) -> None:

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

    @router.post("/api/wearables/connections/{provider}/sync", response_model=WearableSyncResponse)
    async def sync_wearable_provider(
        request: Request,
        provider: str,
        current_user = Depends(get_current_user),
    ):
        _enforce_provider_sync_consent(request)
        connection = await wearable_connection_service.get_connection(current_user["id"], provider)
        if connection is None and provider != "apple_health":
            raise HTTPException(status_code=404, detail="Wearable connection not found")

        run = await wearable_sync_service.start_sync_run(
            provider=provider,
            trigger="manual",
            connection_id=connection.id if connection else None,
            metadata={"requested_by": current_user["id"]},
        )
        try:
            sync_result = await sync_wearable_provider_account(
                provider=provider,
                user_id=current_user["id"],
                services=provider_sync_services,
            )
            await wearable_sync_service.finish_sync_run(
                run.id,
                status=sync_result.status,
                items_seen=sync_result.items_seen,
                items_written=sync_result.items_written,
                error=sync_result.error,
            )
            runs = await wearable_query_service.get_sync_runs(user_id=current_user["id"], provider=provider, limit=1)
            latest_run = runs[0] if runs else run
            return WearableSyncResponse(
                success=latest_run.status in {"success", "partial"},
                provider=provider,
                sync_run=_serialize_sync_run(latest_run),
                message=sync_result.message,
            )
        except HTTPException:
            await wearable_sync_service.finish_sync_run(
                run.id,
                status="failed",
                error={"message": "Sync request failed"},
            )
            raise
        except Exception as exc:
            await wearable_sync_service.finish_sync_run(
                run.id,
                status="failed",
                error={"message": str(exc)},
            )
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/api/wearables/connections/{provider}/sync-all")
    async def sync_wearable_provider_scheduled(
        request: Request,
        provider: str,
        payload: ScheduledWearableSyncRequest,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        _enforce_provider_sync_consent(request)

        if provider == "apple_health":
            return {
                "success": True,
                "provider": provider,
                "total_users": 0,
                "successful_syncs": 0,
                "results": [],
                "message": "Apple Health sync remains device-managed by the iPhone companion app.",
            }

        async with get_db_session() as session:
            result = await session.execute(
                select(WearableConnectionDB).where(
                    WearableConnectionDB.provider == provider,
                    WearableConnectionDB.status == "active",
                )
            )
            connections = result.scalars().all()

        eligible_connections = [
            connection
            for connection in connections
            if _connection_matches_sync_schedule(
                connection,
                provider=provider,
                requested_hour=payload.hour,
            )
        ]
        sync_results = []

        for connection in eligible_connections:
            try:
                sync_result = await sync_wearable_provider_account(
                    provider=provider,
                    user_id=connection.user_id,
                    services=provider_sync_services,
                    days_back=payload.days_back,
                    force_full_sync=payload.force_full_sync,
                    unsupported_as_partial=False,
                )

                sync_results.append(
                    {
                        "user_id": connection.user_id,
                        "success": sync_result.status in {"success", "partial"},
                        "status": sync_result.status,
                        "data": sync_result.data,
                        **({"error": sync_result.error} if sync_result.error else {}),
                    }
                )
            except Exception as exc:
                logger.exception("Scheduled %s sync failed for user %s", provider, connection.user_id)
                sync_results.append(
                    {
                        "user_id": connection.user_id,
                        "success": False,
                        "error": str(exc),
                    }
                )

        successful_syncs = sum(1 for item in sync_results if item["success"])
        return {
            "success": True,
            "provider": provider,
            "total_users": len(sync_results),
            "successful_syncs": successful_syncs,
            "results": sync_results,
        }

    @router.post("/api/wearables/{provider}/backfill", response_model=dict)
    async def enqueue_wearable_backfill(
        provider: str,
        body: dict,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        user_id = body.get("user_id")
        if not isinstance(user_id, str) or not user_id.strip():
            raise HTTPException(status_code=400, detail="user_id is required")
        try:
            definition = require_async_backfill(provider)
        except ValueError as exc:
            if isinstance(exc, UnsupportedProviderCapability):
                raise HTTPException(
                    status_code=422,
                    detail={
                        "code": "unsupported_provider_capability",
                        "provider": exc.definition.provider,
                        "capability": exc.capability,
                        "message": str(exc),
                    },
                ) from exc
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        try:
            job = await wearable_ingest_job_service.enqueue_backfill_job(
                user_id=user_id,
                provider=provider,
                metric_scope=body.get("metric_scope") if isinstance(body.get("metric_scope"), dict) else None,
                start_date=body.get("start_date"),
                end_date=body.get("end_date"),
                trigger=str(body.get("trigger") or "manual_backfill"),
                requested_by_user_id=body.get("requested_by_user_id"),
            )
            return {"success": True, "job_id": job.id, "status": job.status}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/api/wearables/sync-jobs", response_model=WearableIngestJobsResponse)
    async def get_wearable_sync_jobs(
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        jobs = await wearable_ingest_job_service.list_jobs(
            user_id=user_id,
            provider=provider,
            status=status,
            limit=limit,
        )
        return {
            "jobs": [_serialize_ingest_job(job) for job in jobs],
            "count": len(jobs),
        }

    @router.get("/api/wearables/sync-jobs/{job_id}", response_model=dict)
    async def get_wearable_sync_job(
        job_id: str,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        job = await wearable_ingest_job_service.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Wearable ingest job not found")
        return {"job": _serialize_ingest_job(job)}

    @router.get("/api/wearables/sync-runs")
    async def get_wearable_sync_runs(
        provider: Optional[str] = None,
        limit: int = 50,
        current_user = Depends(get_current_user),
    ):
        runs = await wearable_query_service.get_sync_runs(
            user_id=current_user["id"],
            provider=provider,
            limit=limit,
        )
        return {"sync_runs": [_serialize_sync_run(run) for run in runs], "count": len(runs)}
