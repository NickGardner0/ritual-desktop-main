"""Wearables callbacks routes."""

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


def register_callback_routes(router: APIRouter, deps: WearablesRouterDeps) -> None:

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

    @router.get("/api/wearables/oauth/{provider}/callback")
    async def wearable_oauth_callback(
        provider: str,
        request: Request,
        code: Optional[str] = None,
        state: Optional[str] = None,
        error: Optional[str] = None,
    ):
        redirect_base = _integrations_redirect_base(request)
        if error:
            return RedirectResponse(
                url=f"{redirect_base}/integrations?wearable_provider={provider}&wearable_error={error}"
            )

        if not code:
            return RedirectResponse(
                url=f"{redirect_base}/integrations?wearable_provider={provider}&wearable_error=no_code"
            )

        try:
            if provider == "whoop":
                state_payload = _decode_state_payload(state)
                state_user_id = state_payload.get("user_id") if state_payload else None
                if state_user_id:
                    token_data = await whoop_service.exchange_code_for_token(code)
                    user_info = await whoop_service.get_whoop_user_info(token_data["access_token"])
                    await whoop_service.save_integration(
                        user_id=state_user_id,
                        access_token=token_data["access_token"],
                        refresh_token=token_data.get("refresh_token"),
                        expires_in=token_data.get("expires_in", 3600),
                        whoop_user_id=str(user_info["user_id"]),
                        scope=token_data.get("scope"),
                    )
                    await _mark_activation_completed(
                        state_user_id,
                        "whoop",
                        {"source": "wearable_oauth_callback"},
                    )
                return RedirectResponse(
                    url=f"{redirect_base}/integrations?wearable_provider=whoop&wearable_connected=1"
                )

            state_payload = _decode_state_payload(state)
            state_user_id = state_payload.get("user_id") if state_payload else None
            if not state_user_id:
                return RedirectResponse(
                    url=f"{redirect_base}/integrations?wearable_provider={provider}&wearable_error=missing_state"
                )

            if provider == "oura":
                token_data = await oura_service.exchange_code_for_token(code)
                personal_info = await oura_service.get_personal_info(token_data["access_token"])
                await wearable_connection_service.get_or_create_connection(
                    user_id=state_user_id,
                    provider="oura",
                    auth_method="oauth",
                    provider_user_id=str(personal_info.get("email") or personal_info.get("id") or state_user_id),
                    access_token=token_data["access_token"],
                    refresh_token=token_data.get("refresh_token"),
                    token_expires_at=datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600)),
                    status="active",
                    settings={
                        "personal_info": personal_info,
                        "oauth_state": state,
                        "sync_hour": 9,
                        "auto_sync_enabled": True,
                    },
                )
                await _mark_activation_completed(
                    state_user_id,
                    "oura",
                    {"source": "wearable_oauth_callback"},
                )
            elif provider == "garmin":
                connection = await wearable_connection_service.get_connection(state_user_id, "garmin")
                settings = {}
                if connection and connection.settings_json:
                    try:
                        settings = json.loads(connection.settings_json)
                    except Exception:
                        settings = {}
                if settings.get("oauth_state") and settings["oauth_state"] != state:
                    return RedirectResponse(
                        url=f"{redirect_base}/integrations?wearable_provider={provider}&wearable_error=state_mismatch"
                    )
                code_verifier = settings.get("pkce_verifier")
                if not code_verifier:
                    return RedirectResponse(
                        url=f"{redirect_base}/integrations?wearable_provider={provider}&wearable_error=missing_verifier"
                    )
                token_data = await garmin_service.exchange_code_for_token(code, code_verifier)
                expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))
                provider_user_id = await garmin_service.get_user_id(token_data["access_token"])
                permissions = await garmin_service.get_permissions(token_data["access_token"])
                await wearable_connection_service.get_or_create_connection(
                    user_id=state_user_id,
                    provider="garmin",
                    auth_method="oauth",
                    provider_user_id=provider_user_id,
                    access_token=token_data["access_token"],
                    refresh_token=token_data.get("refresh_token"),
                    token_expires_at=expires_at,
                    status="active",
                    settings={
                        "permissions": permissions,
                        "oauth_state": state,
                        "sync_hour": 9,
                        "auto_sync_enabled": True,
                    },
                )
                await _mark_activation_completed(
                    state_user_id,
                    "garmin",
                    {"source": "wearable_oauth_callback"},
                )
            else:
                return RedirectResponse(
                    url=f"{redirect_base}/integrations?wearable_provider={provider}&wearable_error=unsupported_provider"
                )
            return RedirectResponse(
                url=f"{redirect_base}/integrations?wearable_provider={provider}&wearable_connected=1"
            )
        except Exception as exc:
            logger.error("❌ OAuth callback failed for %s: %s", provider, exc)
            return RedirectResponse(
                url=f"{redirect_base}/integrations?wearable_provider={provider}&wearable_error=callback_failed"
            )

    @router.post("/api/wearables/webhooks/garmin")
    async def garmin_webhook(request: Request):
        expected_secret = os.getenv("GARMIN_WEBHOOK_SECRET")
        provided_secret = request.headers.get("x-garmin-webhook-secret")
        if expected_secret and provided_secret != expected_secret:
            raise HTTPException(status_code=401, detail="Invalid Garmin webhook secret")
        payload = await request.json()
        run = await wearable_sync_service.start_sync_run(
            provider="garmin",
            trigger="webhook",
            metadata={"payload_preview": payload},
        )
        try:
            result = await garmin_service.ingest_webhook_payload(payload)
            items_seen = int(result.get("samples", 0)) + int(result.get("events", 0))
            await wearable_sync_service.finish_sync_run(
                run.id,
                status="success",
                items_seen=items_seen,
                items_written=items_seen,
            )
            return {"success": True, "received": True, "sync_run_id": run.id, "result": result}
        except Exception as exc:
            await wearable_sync_service.finish_sync_run(
                run.id,
                status="failed",
                items_seen=0,
                items_written=0,
                error={"message": str(exc)},
            )
            raise HTTPException(status_code=400, detail=str(exc))
