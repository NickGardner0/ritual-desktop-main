"""Wearables admin replay routes."""

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


def register_admin_replay_routes(router: APIRouter, deps: WearablesRouterDeps) -> None:

    limiter = deps.limiter
    get_current_user = deps.get_current_user
    wearables_service = deps.wearables_service
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

    @router.get("/api/wearables/raw-payloads", response_model=WearableRawPayloadsResponse)
    async def get_wearable_raw_payloads(
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 100,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        try:
            parsed_start = _parse_iso_datetime(start_time, field_name="start_time")
            parsed_end = _parse_iso_datetime(end_time, field_name="end_time")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        payloads = await wearable_sync_service.list_raw_payloads(
            user_id=user_id,
            provider=provider,
            start_time=parsed_start,
            end_time=parsed_end,
            limit=limit,
        )
        return {
            "payloads": [_serialize_raw_payload(payload) for payload in payloads],
            "count": len(payloads),
        }

    @router.get("/api/wearables/raw-payloads/errors", response_model=WearableRawPayloadsResponse)
    async def get_wearable_raw_payload_errors(
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        limit: int = 100,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        payloads = await wearable_sync_service.list_raw_payloads(
            user_id=user_id,
            provider=provider,
            has_error=True,
            limit=limit,
        )
        return {
            "payloads": [_serialize_raw_payload(payload) for payload in payloads],
            "count": len(payloads),
        }

    @router.post("/api/wearables/raw-payloads/{payload_id}/replay", response_model=dict)
    async def replay_wearable_raw_payload(
        payload_id: str,
        body: dict,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        try:
            job = await wearable_ingest_job_service.enqueue_raw_payload_replay(
                payload_id=payload_id,
                requested_by_user_id=body.get("requested_by_user_id"),
            )
            return {"success": True, "job_id": job.id, "status": job.status}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/api/wearables/outbox-events", response_model=WearableOutboxEventsResponse)
    async def get_wearable_outbox_events(
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        status: Optional[str] = None,
        event_type: Optional[str] = None,
        limit: int = 100,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        events = await wearable_event_outbox_service.list_events(
            user_id=user_id,
            provider=provider,
            status=status,
            event_type=event_type,
            limit=limit,
        )
        return {
            "events": [_serialize_outbox_event(item) for item in events],
            "count": len(events),
        }

    @router.get("/api/wearables/outbox-events/{event_id}", response_model=dict)
    async def get_wearable_outbox_event(
        event_id: str,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        event = await wearable_event_outbox_service.get_event(event_id)
        if event is None:
            raise HTTPException(status_code=404, detail="Wearable outbox event not found")
        return {"event": _serialize_outbox_event(event)}

    @router.post("/api/wearables/internal/maintenance/run", response_model=dict)
    async def run_wearable_maintenance(
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        result = await wearable_maintenance_service.run_once()
        return {"success": True, "result": result}
