"""Wearables connections routes."""

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


def register_connection_routes(router: APIRouter, deps: WearablesRouterDeps) -> None:

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

    @router.get("/api/wearables/providers")
    async def get_wearable_providers(current_user = Depends(get_current_user)):
        del current_user
        return {"providers": list_provider_defs()}

    @router.get("/api/wearables/connections", response_model=WearableConnectionsResponse)
    async def get_wearable_connections(current_user = Depends(get_current_user)):
        connections = await wearable_connection_service.list_connections(current_user["id"])
        return WearableConnectionsResponse(
            providers=list_provider_defs(),
            connections=[_serialize_connection(item) for item in connections],
        )

    @router.post("/api/wearables/connections/{provider}/authorize", response_model=WearableConnectionActionResponse)
    async def authorize_wearable_provider(
        provider: str,
        current_user = Depends(get_current_user),
    ):
        try:
            adapter = get_provider_adapter(provider)
            if not adapter.supports_oauth():
                connections = await wearable_connection_service.list_connections(current_user["id"])
                connection = next((item for item in connections if item["provider"] == provider), None)
                return WearableConnectionActionResponse(
                    success=True,
                    provider=provider,
                    connection=_serialize_connection(connection) if connection else None,
                    message="This provider uses the Ritual companion app or manual import instead of OAuth.",
                )
            authorization = adapter.begin_auth(current_user["id"])
            await wearable_connection_service.get_or_create_connection(
                user_id=current_user["id"],
                provider=provider,
                auth_method="oauth",
                status="paused",
                settings=authorization.transient_settings or {"oauth_state": authorization.state},
            )
            return WearableConnectionActionResponse(
                success=True,
                provider=provider,
                authorization_url=authorization.authorization_url,
                message="Open the authorization URL to finish connecting the provider.",
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            logger.error("❌ Provider authorization bootstrap failed: %s", exc)
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.post("/api/wearables/connections/{provider}/disconnect", response_model=WearableConnectionActionResponse)
    async def disconnect_wearable_provider(
        provider: str,
        current_user = Depends(get_current_user),
    ):
        connection = await wearable_connection_service.disconnect(current_user["id"], provider)
        if connection is None:
            raise HTTPException(status_code=404, detail="Wearable connection not found")
        if provider == "whoop":
            await whoop_service.disconnect_integration(current_user["id"])
        connections = await wearable_connection_service.list_connections(current_user["id"])
        current = next((item for item in connections if item["provider"] == provider), None)
        return WearableConnectionActionResponse(
            success=True,
            provider=provider,
            connection=_serialize_connection(current) if current else None,
            message=f"{provider} disconnected successfully.",
        )

    @router.put("/api/wearables/connections/{provider}/sync-settings", response_model=WearableConnectionActionResponse)
    async def update_wearable_sync_settings(
        provider: str,
        payload: WearableSyncSettingsUpdateRequest,
        current_user = Depends(get_current_user),
    ):
        if payload.sync_hour is not None and not 0 <= payload.sync_hour <= 23:
            raise HTTPException(status_code=400, detail="Sync hour must be between 0 and 23")

        try:
            connection = await wearable_connection_service.get_connection(current_user["id"], provider)
            provider_def = next((item for item in list_provider_defs() if item["provider"] == provider), None)
            if provider_def is None:
                raise HTTPException(status_code=404, detail="Unsupported wearable provider")

            sync_hour = payload.sync_hour if payload.sync_hour is not None else 9
            status = connection.status if connection else "active"
            provider_user_id = connection.provider_user_id if connection else None
            token_expires_at = connection.token_expires_at if connection else None

            updated = await wearable_connection_service.get_or_create_connection(
                user_id=current_user["id"],
                provider=provider,
                auth_method=connection.auth_method if connection else provider_def["auth_method"],
                provider_user_id=provider_user_id,
                token_expires_at=token_expires_at,
                settings={
                    "auto_sync_enabled": payload.auto_sync_enabled,
                    "sync_hour": sync_hour,
                    **({"whoop_sync_hour": sync_hour} if provider == "whoop" else {}),
                },
                status=status,
            )

            if provider == "whoop":
                async with get_db_session() as session:
                    result = await session.execute(
                        select(WhoopIntegrationDB).where(WhoopIntegrationDB.user_id == current_user["id"])
                    )
                    whoop_integration = result.scalar_one_or_none()
                    if whoop_integration:
                        whoop_integration.whoop_sync_hour = sync_hour
                        await session.commit()

            connections = await wearable_connection_service.list_connections(current_user["id"])
            current = next((item for item in connections if item["id"] == updated.id), None)
            return WearableConnectionActionResponse(
                success=True,
                provider=provider,
                connection=_serialize_connection(current) if current else None,
                message="Sync settings updated.",
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("❌ Updating %s sync settings failed: %s", provider, exc)
            raise HTTPException(status_code=500, detail="Request could not be processed.")
