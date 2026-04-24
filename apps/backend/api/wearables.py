"""Wearables API router extracted from main.py."""

import logging
import os
import json
import base64
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

VALID_METRIC_SYNC_MODES = {"off", "daily_only", "granular"}


def _parse_csv_list(raw_value: Optional[str]) -> list[str]:
    if not raw_value:
        return []
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def _parse_iso_datetime(raw_value: Optional[str], *, field_name: str) -> Optional[datetime]:
    if not raw_value:
        return None
    try:
        return datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{field_name} must be a valid ISO8601 timestamp") from exc


def _coerce_settings_payload(settings_json: Any) -> dict[str, Any]:
    if isinstance(settings_json, dict):
        return settings_json
    if isinstance(settings_json, str):
        try:
            parsed = json.loads(settings_json)
        except Exception:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _require_internal_key(internal_key: Optional[str]) -> None:
    expected_internal_key = os.getenv("INTERNAL_API_KEY")
    if not expected_internal_key:
        logger.error("INTERNAL_API_KEY is not configured")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable")
    if internal_key != expected_internal_key:
        raise HTTPException(status_code=403, detail="Invalid internal API key")


def _normalize_metric_preferences_v2(
    settings: Optional[dict[str, Any]],
    allowed_metric_types: set[str],
) -> dict[str, dict[str, str]]:
    normalized_preferences: dict[str, dict[str, str]] = {}
    settings = settings or {}

    raw_v2 = settings.get("metric_preferences_v2")
    if isinstance(raw_v2, dict):
        for metric_type, raw_preference in raw_v2.items():
            if metric_type not in allowed_metric_types:
                continue
            sync_mode = ""
            if isinstance(raw_preference, dict):
                sync_mode = str(raw_preference.get("sync_mode", "")).strip().lower()
            elif isinstance(raw_preference, str):
                sync_mode = raw_preference.strip().lower()
            if sync_mode in VALID_METRIC_SYNC_MODES:
                normalized_preferences[metric_type] = {"sync_mode": sync_mode}

    if normalized_preferences:
        return normalized_preferences

    raw_selected = settings.get("metric_preferences", [])
    if isinstance(raw_selected, list):
        for metric_type in raw_selected:
            if isinstance(metric_type, str) and metric_type in allowed_metric_types:
                normalized_preferences[metric_type] = {"sync_mode": "daily_only"}

    return normalized_preferences


def _selected_metrics_from_preferences(
    preferences: dict[str, dict[str, str]]
) -> list[str]:
    return sorted(
        metric_type
        for metric_type, preference in preferences.items()
        if preference.get("sync_mode") in {"daily_only", "granular"}
    )


def _build_tracked_metrics_contract(
    preferences: dict[str, dict[str, str]],
    habit_metric_types: set[str],
) -> dict[str, dict[str, Any]]:
    from services.unified_wearables_service import build_wearable_sync_plan

    metrics: dict[str, dict[str, Any]] = {
        metric_type: {
            "sync_mode": preference.get("sync_mode", "daily_only"),
            "sync_plan": build_wearable_sync_plan(
                provider="apple_health",
                metric_type=metric_type,
                sync_mode=preference.get("sync_mode", "daily_only"),
                projects_to_habit_logs=False,
            ),
        }
        for metric_type, preference in preferences.items()
        if preference.get("sync_mode") in {"daily_only", "granular"}
    }

    for metric_type in sorted(habit_metric_types):
        metrics.setdefault(
            metric_type,
            {
                "sync_mode": "daily_only",
                "sync_plan": build_wearable_sync_plan(
                    provider="apple_health",
                    metric_type=metric_type,
                    sync_mode="daily_only",
                    projects_to_habit_logs=True,
                ),
            },
        )
        if "sync_plan" in metrics[metric_type]:
            metrics[metric_type]["sync_plan"]["projects_to_habit_logs"] = True

    return metrics


def _parse_metric_preferences_payload(
    body: dict[str, Any],
    allowed_metric_types: set[str],
) -> dict[str, dict[str, str]]:
    if not isinstance(body, dict):
        raise ValueError("request body must be an object")

    if "preferences" in body:
        raw_preferences = body.get("preferences")
        if not isinstance(raw_preferences, dict):
            raise ValueError("preferences must be an object")

        normalized_preferences: dict[str, dict[str, str]] = {}
        invalid_metric_types = [
            metric_type for metric_type in raw_preferences.keys() if metric_type not in allowed_metric_types
        ]
        if invalid_metric_types:
            raise ValueError(f"Unknown metric types: {sorted(invalid_metric_types)}")

        for metric_type, raw_preference in raw_preferences.items():
            if not isinstance(raw_preference, dict):
                raise ValueError(f"Preference for '{metric_type}' must be an object")
            sync_mode = str(raw_preference.get("sync_mode", "")).strip().lower()
            if sync_mode not in VALID_METRIC_SYNC_MODES:
                raise ValueError(
                    f"Preference for '{metric_type}' must include sync_mode in {sorted(VALID_METRIC_SYNC_MODES)}"
                )
            normalized_preferences[metric_type] = {"sync_mode": sync_mode}
        return normalized_preferences

    raw_selected = body.get("selected_metrics", [])
    if not isinstance(raw_selected, list):
        raise ValueError("selected_metrics must be an array")

    invalid_metric_types = [
        metric_type
        for metric_type in raw_selected
        if not isinstance(metric_type, str) or metric_type not in allowed_metric_types
    ]
    if invalid_metric_types:
        raise ValueError(f"Unknown metric types: {sorted(str(metric_type) for metric_type in invalid_metric_types)}")

    return {
        metric_type: {"sync_mode": "daily_only"}
        for metric_type in dict.fromkeys(raw_selected)
    }


class WearableSyncSettingsUpdateRequest(BaseModel):
    auto_sync_enabled: bool
    sync_hour: Optional[int] = None


class ScheduledWearableSyncRequest(BaseModel):
    hour: Optional[int] = None
    days_back: Optional[int] = None
    force_full_sync: bool = False


def create_wearables_router(
    *,
    limiter: Any,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    router = APIRouter(tags=["wearables"])

    # WEARABLES API - Apple Health + Multi-source support
    # ================================
    
    from services.wearables_service import wearables_service
    from services.whoop_service import whoop_service
    from services.oura_service import oura_service
    from services.garmin_service import garmin_service
    from database.models import WearableConnectionDB, WhoopIntegrationDB
    from services.unified_wearables_service import (
        wearable_connection_service,
        wearable_projection_service,
        wearable_query_service,
        wearable_sync_service,
    )
    from services.wearable_ingest_job_service import wearable_ingest_job_service
    from services.wearable_provider_adapters import get_provider_adapter, list_provider_defs
    from services.wearable_maintenance_service import wearable_maintenance_service
    from schemas.wearables_apple import (
        DeviceRegisterRequest,
        DeviceRegisterResponse,
        DeviceStatusResponse,
        AppleIngestRequest,
        AppleIngestResponse,
        AppleIngestResult,
    )
    from schemas.wearables_unified import (
        WearableConnectionActionResponse,
        WearableConnectionsResponse,
        WearableDailyTotalsResponse,
        WearableIngestJobsResponse,
        WearableRawPayloadsResponse,
        WearableSeriesResponse,
        WearableSyncResponse,
        WearableTimelineResponse,
    )

    def _serialize_connection(item: dict[str, Any]) -> dict[str, Any]:
        return {
            **item,
            "provider": item["provider"],
            "auth_method": item["auth_method"],
            "status": item["status"],
        }

    def _serialize_sample(sample: Any) -> dict[str, Any]:
        attributes = None
        if sample.attributes_json:
            try:
                attributes = json.loads(sample.attributes_json)
            except Exception:
                attributes = {"raw": sample.attributes_json}
        return {
            "id": sample.id,
            "provider": sample.provider,
            "metric_type": sample.metric_type,
            "provider_metric_type": sample.provider_metric_type,
            "external_id": sample.external_id,
            "recorded_at": sample.recorded_at.isoformat() if sample.recorded_at else None,
            "start_time": sample.start_time.isoformat() if sample.start_time else None,
            "end_time": sample.end_time.isoformat() if sample.end_time else None,
            "attributed_date": sample.attributed_date,
            "value": sample.value,
            "unit": sample.unit,
            "aggregation_kind": sample.aggregation_kind,
            "rollup_level": getattr(sample, "rollup_level", None),
            "rollup_window_minutes": getattr(sample, "rollup_window_minutes", None),
            "sample_count": getattr(sample, "sample_count", None),
            "should_project_to_habit_logs": getattr(sample, "should_project_to_habit_logs", None),
            "confidence": sample.confidence,
            "timezone": sample.timezone,
            "source_id": sample.source_id,
            "attributes_json": attributes,
            "deleted_at": sample.deleted_at.isoformat() if sample.deleted_at else None,
        }

    def _serialize_event(event: Any) -> dict[str, Any]:
        details = None
        if event.details_json:
            try:
                details = json.loads(event.details_json)
            except Exception:
                details = {"raw": event.details_json}
        return {
            "id": event.id,
            "provider": event.provider,
            "event_type": event.event_type,
            "provider_event_type": event.provider_event_type,
            "external_id": event.external_id,
            "start_time": event.start_time.isoformat(),
            "end_time": event.end_time.isoformat(),
            "attributed_date": event.attributed_date,
            "timezone": event.timezone,
            "title": event.title,
            "summary_value": event.summary_value,
            "summary_unit": event.summary_unit,
            "source_id": event.source_id,
            "details_json": details,
            "deleted_at": event.deleted_at.isoformat() if event.deleted_at else None,
        }

    def _serialize_sync_run(run: Any) -> dict[str, Any]:
        error_json = None
        metadata_json = None
        if run.error_json:
            try:
                error_json = json.loads(run.error_json)
            except Exception:
                error_json = {"raw": run.error_json}
        if run.metadata_json:
            try:
                metadata_json = json.loads(run.metadata_json)
            except Exception:
                metadata_json = {"raw": run.metadata_json}
        return {
            "id": run.id,
            "provider": run.provider,
            "trigger": run.trigger,
            "status": run.status,
            "started_at": run.started_at.isoformat(),
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "items_seen": run.items_seen or 0,
            "items_written": run.items_written or 0,
            "items_updated": run.items_updated or 0,
            "items_deleted": run.items_deleted or 0,
            "error_json": error_json,
            "metadata_json": metadata_json,
        }

    def _integrations_redirect_base(request: Request) -> str:
        return (os.getenv("NEXT_PUBLIC_APP_URL") or os.getenv("APP_URL") or "http://127.0.0.1:3000").rstrip("/")

    def _decode_state_payload(state: Optional[str]) -> Optional[dict[str, Any]]:
        if not state:
            return None
        try:
            return json.loads(base64.urlsafe_b64decode(state + "=" * (-len(state) % 4)).decode("utf-8"))
        except Exception:
            return None

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

    @router.post("/api/wearables/connections/{provider}/sync", response_model=WearableSyncResponse)
    async def sync_wearable_provider(
        provider: str,
        current_user = Depends(get_current_user),
    ):
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
            message = None
            items_written = 0
            items_seen = 0
            if provider == "whoop":
                result = await whoop_service.sync_whoop_data(current_user["id"])
                sync_data = result.get("data", {})
                items_seen = sum(int(v or 0) for v in sync_data.values())
                items_written = items_seen
                message = "Whoop sync completed."
                await wearable_sync_service.finish_sync_run(
                    run.id,
                    status="success",
                    items_seen=items_seen,
                    items_written=items_written,
                )
            elif provider == "apple_health":
                await wearable_sync_service.finish_sync_run(
                    run.id,
                    status="success",
                    items_seen=0,
                    items_written=0,
                )
                message = "Apple Health sync uses the iOS companion background ingest pipeline."
            elif provider == "oura":
                result = await oura_service.sync_oura_data(current_user["id"])
                sync_data = result.get("data", {})
                items_seen = int(sync_data.get("samples", 0)) + int(sync_data.get("events", 0))
                items_written = items_seen
                message = "Oura sync completed."
                await wearable_sync_service.finish_sync_run(
                    run.id,
                    status="success",
                    items_seen=items_seen,
                    items_written=items_written,
                )
            elif provider == "garmin":
                result = await garmin_service.sync_garmin_account(current_user["id"])
                sync_data = result.get("data", {})
                items_seen = 1 if sync_data.get("permissions_loaded") else 0
                items_written = items_seen
                message = "Garmin account refreshed. Data ingestion is webhook-driven."
                await wearable_sync_service.finish_sync_run(
                    run.id,
                    status="success",
                    items_seen=items_seen,
                    items_written=items_written,
                )
            else:
                await wearable_sync_service.finish_sync_run(
                    run.id,
                    status="partial",
                    items_seen=0,
                    items_written=0,
                    error={"message": f"{provider} cloud sync is scaffolded but not configured in this environment."},
                )
                message = f"{provider.title()} connection exists, but cloud sync is not configured in this environment yet."
            runs = await wearable_query_service.get_sync_runs(user_id=current_user["id"], provider=provider, limit=1)
            latest_run = runs[0] if runs else run
            return WearableSyncResponse(
                success=latest_run.status in {"success", "partial"},
                provider=provider,
                sync_run=_serialize_sync_run(latest_run),
                message=message,
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

    @router.post("/api/wearables/connections/{provider}/sync-all")
    async def sync_wearable_provider_scheduled(
        provider: str,
        payload: ScheduledWearableSyncRequest,
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)

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

        def matches_schedule(connection: Any) -> bool:
            settings: dict[str, Any] = {}
            if connection.settings_json:
                try:
                    settings = json.loads(connection.settings_json)
                except Exception:
                    settings = {}
            enabled = bool(settings.get("auto_sync_enabled", provider != "apple_health"))
            if not enabled:
                return False
            configured_hour = settings.get("sync_hour")
            if configured_hour is None and provider == "whoop":
                configured_hour = settings.get("whoop_sync_hour", 9)
            if payload.hour is None:
                return True
            return int(configured_hour if configured_hour is not None else 9) == int(payload.hour)

        eligible_connections = [connection for connection in connections if matches_schedule(connection)]
        sync_results = []

        for connection in eligible_connections:
            try:
                if provider == "whoop":
                    result = await whoop_service.sync_whoop_data(
                        connection.user_id,
                        days_back=payload.days_back,
                        force_full_sync=payload.force_full_sync,
                    )
                elif provider == "oura":
                    result = await oura_service.sync_oura_data(
                        connection.user_id,
                        days_back=payload.days_back,
                        force_full_sync=payload.force_full_sync,
                    )
                elif provider == "garmin":
                    result = await garmin_service.sync_garmin_account(connection.user_id)
                else:
                    raise ValueError(f"Unsupported scheduled sync provider: {provider}")

                sync_results.append(
                    {
                        "user_id": connection.user_id,
                        "success": True,
                        "data": result,
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
            "jobs": [
                {
                    "id": job.id,
                    "batch_id": job.batch_id,
                    "user_id": job.user_id,
                    "provider": job.provider,
                    "job_type": job.job_type,
                    "trigger": job.trigger,
                    "status": job.status,
                    "metric_scope": json.loads(job.metric_scope_json) if job.metric_scope_json else None,
                    "start_date": job.start_date,
                    "end_date": job.end_date,
                    "attempts": int(job.attempts or 0),
                    "max_attempts": int(job.max_attempts or 0),
                    "payload": json.loads(job.payload_json) if job.payload_json else None,
                    "result": json.loads(job.result_json) if job.result_json else None,
                    "error": json.loads(job.error_json) if job.error_json else None,
                    "idempotency_key": job.idempotency_key,
                    "sync_run_id": job.sync_run_id,
                    "created_at": job.created_at.isoformat(),
                    "started_at": job.started_at.isoformat() if job.started_at else None,
                    "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                }
                for job in jobs
            ],
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
        return {
            "job": {
                "id": job.id,
                "batch_id": job.batch_id,
                "user_id": job.user_id,
                "provider": job.provider,
                "job_type": job.job_type,
                "trigger": job.trigger,
                "status": job.status,
                "metric_scope": json.loads(job.metric_scope_json) if job.metric_scope_json else None,
                "start_date": job.start_date,
                "end_date": job.end_date,
                "attempts": int(job.attempts or 0),
                "max_attempts": int(job.max_attempts or 0),
                "payload": json.loads(job.payload_json) if job.payload_json else None,
                "result": json.loads(job.result_json) if job.result_json else None,
                "error": json.loads(job.error_json) if job.error_json else None,
                "idempotency_key": job.idempotency_key,
                "sync_run_id": job.sync_run_id,
                "created_at": job.created_at.isoformat(),
                "started_at": job.started_at.isoformat() if job.started_at else None,
                "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            }
        }

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
        resolved_resolution = points[0].get("rollup_level") if points else resolution
        if resolved_resolution in {None, ""}:
            resolved_resolution = resolution
        selected_source = points[0].get("selected_source") if points else None
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

    # ── Health data export (Markdown / JSON / CSV) ─────────────────────
    @router.get("/api/wearables/apple/export")
    async def export_apple_health(
        start_date: str,  # YYYY-MM-DD
        end_date: str,    # YYYY-MM-DD
        format: str = "markdown",  # markdown | json | csv
        metric_types: Optional[str] = None,  # comma-separated, or all if omitted
        current_user=Depends(get_current_user),
    ):
        """Export Apple Health data in Markdown, JSON, or CSV format."""
        from datetime import timedelta
        from fastapi.responses import PlainTextResponse, JSONResponse

        # Parse dates
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)  # inclusive end
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")

        if (end_dt - start_dt).days > 366:
            raise HTTPException(status_code=400, detail="Date range cannot exceed 1 year")

        type_filter = [t.strip() for t in metric_types.split(",")] if metric_types else None

        # Fetch all samples in range
        samples = await wearable_query_service.get_samples(
            user_id=current_user["id"],
            provider="apple_health",
            start_time=start_dt,
            end_time=end_dt,
            include_deleted=False,
            limit=50000,
        )

        # Optional metric type filter
        if type_filter:
            samples = [s for s in samples if s.metric_type in type_filter]

        # Group by attributed_date (YYYY-MM-DD)
        from collections import defaultdict
        by_date: dict[str, list] = defaultdict(list)
        for s in samples:
            day = s.attributed_date or (s.start_time.strftime("%Y-%m-%d") if s.start_time else start_date)
            by_date[day].append(s)

        if format == "json":
            export_data = {}
            for day in sorted(by_date.keys()):
                export_data[day] = [_serialize_sample(s) for s in by_date[day]]
            return JSONResponse(content={"dates": export_data, "total_samples": len(samples)})

        elif format == "csv":
            import csv, io
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["Date", "Category", "Metric", "Value", "Unit", "Start", "End"])
            for day in sorted(by_date.keys()):
                for s in by_date[day]:
                    writer.writerow([
                        day,
                        _metric_category(s.metric_type),
                        s.metric_type,
                        s.value,
                        s.unit,
                        s.start_time.isoformat() if s.start_time else "",
                        s.end_time.isoformat() if s.end_time else "",
                    ])
            return PlainTextResponse(
                content=output.getvalue(),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename=ritual-health-{start_date}-to-{end_date}.csv"},
            )

        else:  # markdown (default)
            lines: list[str] = []
            for day in sorted(by_date.keys()):
                day_samples = by_date[day]
                lines.append(f"# Health {day}")
                lines.append("")

                # Group by category
                categorized: dict[str, list] = defaultdict(list)
                for s in day_samples:
                    categorized[_metric_category(s.metric_type)].append(s)

                for category in ["Activity", "Heart", "Sleep", "Respiratory",
                                 "Body Measurements", "Nutrition", "Vitals",
                                 "Mobility", "Workouts", "Mindfulness", "Other"]:
                    items = categorized.get(category, [])
                    if not items:
                        continue
                    lines.append(f"## {category}")
                    lines.append("")
                    for s in items:
                        display = _metric_display_name(s.metric_type)
                        val = int(s.value) if s.value == int(s.value) else f"{s.value:.2f}"
                        lines.append(f"- **{display}**: {val} {s.unit}")
                    lines.append("")

                lines.append("---")
                lines.append("")

            content = "\n".join(lines).rstrip()
            return PlainTextResponse(
                content=content,
                media_type="text/markdown",
                headers={"Content-Disposition": f"attachment; filename=ritual-health-{start_date}-to-{end_date}.md"},
            )

    def _metric_category(metric_type: str) -> str:
        """Map metric type string to a human-readable category."""
        _map = {
            "steps": "Activity", "active_energy": "Activity", "basal_energy": "Activity",
            "distance": "Activity", "flights_climbed": "Activity", "exercise_time": "Activity",
            "stand_time": "Activity",
            "hr": "Heart", "hrv": "Heart", "resting_hr": "Heart", "walking_hr": "Heart",
            "sleep_session": "Sleep", "sleep_asleep": "Sleep", "sleep_awake": "Sleep",
            "sleep_rem": "Sleep", "sleep_deep": "Sleep", "sleep_core": "Sleep",
            "respiratory_rate": "Respiratory", "oxygen_saturation": "Respiratory",
            "body_mass": "Body Measurements", "body_mass_index": "Body Measurements",
            "body_fat_percentage": "Body Measurements", "lean_body_mass": "Body Measurements",
            "height": "Body Measurements", "waist_circumference": "Body Measurements",
            "dietary_energy": "Nutrition", "dietary_protein": "Nutrition",
            "dietary_carbs": "Nutrition", "dietary_fat": "Nutrition",
            "dietary_fiber": "Nutrition", "dietary_sugar": "Nutrition",
            "dietary_water": "Nutrition", "dietary_caffeine": "Nutrition",
            "blood_pressure_systolic": "Vitals", "blood_pressure_diastolic": "Vitals",
            "blood_glucose": "Vitals", "body_temperature": "Vitals",
            "walking_speed": "Mobility", "walking_step_length": "Mobility",
            "walking_asymmetry": "Mobility",
            "workout": "Workouts", "mindful_minutes": "Mindfulness",
        }
        return _map.get(metric_type, "Other")

    def _metric_display_name(metric_type: str) -> str:
        """Map metric type string to a human-readable display name."""
        _map = {
            "steps": "Steps", "active_energy": "Active energy", "basal_energy": "Basal energy",
            "distance": "Distance", "flights_climbed": "Flights climbed",
            "exercise_time": "Exercise time", "stand_time": "Stand time",
            "hr": "Heart rate", "hrv": "HRV", "resting_hr": "Resting heart rate",
            "walking_hr": "Walking heart rate",
            "respiratory_rate": "Respiratory rate", "oxygen_saturation": "Oxygen saturation",
            "sleep_session": "Sleep session", "sleep_asleep": "Asleep", "sleep_awake": "Awake",
            "sleep_rem": "REM", "sleep_deep": "Deep sleep", "sleep_core": "Core sleep",
            "body_mass": "Weight", "body_mass_index": "BMI",
            "body_fat_percentage": "Body fat", "lean_body_mass": "Lean body mass",
            "height": "Height", "waist_circumference": "Waist circumference",
            "dietary_energy": "Calories consumed", "dietary_protein": "Protein",
            "dietary_carbs": "Carbohydrates", "dietary_fat": "Fat",
            "dietary_fiber": "Fiber", "dietary_sugar": "Sugar",
            "dietary_water": "Water", "dietary_caffeine": "Caffeine",
            "blood_pressure_systolic": "Blood pressure (systolic)",
            "blood_pressure_diastolic": "Blood pressure (diastolic)",
            "blood_glucose": "Blood glucose", "body_temperature": "Body temperature",
            "walking_speed": "Walking speed", "walking_step_length": "Step length",
            "walking_asymmetry": "Walking asymmetry",
            "workout": "Workout", "mindful_minutes": "Mindful minutes",
        }
        return _map.get(metric_type, metric_type.replace("_", " ").title())

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
            "payloads": [
                {
                    "id": payload.id,
                    "user_id": payload.user_id,
                    "provider": payload.provider,
                    "direction": payload.direction,
                    "external_id": payload.external_id,
                    "payload_sha256": payload.payload_sha256,
                    "received_at": payload.received_at.isoformat(),
                    "expires_at": payload.expires_at.isoformat() if payload.expires_at else None,
                    "normalization_error": json.loads(payload.normalization_error_json)
                    if payload.normalization_error_json
                    else None,
                }
                for payload in payloads
            ],
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
            "payloads": [
                {
                    "id": payload.id,
                    "user_id": payload.user_id,
                    "provider": payload.provider,
                    "direction": payload.direction,
                    "external_id": payload.external_id,
                    "payload_sha256": payload.payload_sha256,
                    "received_at": payload.received_at.isoformat(),
                    "expires_at": payload.expires_at.isoformat() if payload.expires_at else None,
                    "normalization_error": json.loads(payload.normalization_error_json)
                    if payload.normalization_error_json
                    else None,
                }
                for payload in payloads
            ],
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

    @router.post("/api/wearables/internal/maintenance/run", response_model=dict)
    async def run_wearable_maintenance(
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
    ):
        _require_internal_key(internal_key)
        result = await wearable_maintenance_service.run_once()
        return {"success": True, "result": result}

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
    
    @router.post("/api/wearables/apple/register_device", response_model=DeviceRegisterResponse)
    async def register_apple_device(
        request: DeviceRegisterRequest,
        current_user = Depends(get_current_user)
    ):
        """
        Register a new iOS device for Apple Health sync.
        
        Returns a device_id and device_secret that should be:
        - device_id: Stored for future API calls
        - device_secret: Stored securely in iOS Keychain for request signing
        
        The device_secret is used to sign all ingest requests to prevent tampering.
        """
        try:
            logger.info(f"📱 Registering device '{request.device_name}' for user {current_user['id']}")
            
            device_id, device_secret = await wearables_service.register_device(
                user_id=current_user["id"],
                device_name=request.device_name,
                platform=request.platform
            )
            
            return DeviceRegisterResponse(
                device_id=device_id,
                device_secret=device_secret,
                registered_at=datetime.utcnow().isoformat() + "Z"
            )
            
        except Exception as e:
            logger.error(f"❌ Device registration error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/wearables/apple/devices")
    async def list_apple_devices(current_user = Depends(get_current_user)):
        """
        List all registered devices for the current user.
        """
        try:
            devices = await wearables_service.get_user_devices(current_user["id"])
            
            return {
                "devices": [
                    DeviceStatusResponse(
                        device_id=d.id,
                        device_name=d.device_name,
                        platform=d.platform,
                        registered_at=d.registered_at.isoformat() + "Z",
                        last_sync_at=d.last_sync_at.isoformat() + "Z" if d.last_sync_at else None,
                        is_active=d.is_active
                    )
                    for d in devices
                ]
            }
            
        except Exception as e:
            logger.error(f"❌ List devices error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.delete("/api/wearables/apple/devices/{device_id}")
    async def deactivate_apple_device(
        device_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        Deactivate a device (soft delete).
        The device will no longer be able to sync data.
        """
        try:
            success = await wearables_service.deactivate_device(device_id, current_user["id"])
            
            if not success:
                raise HTTPException(status_code=404, detail="Device not found")
            
            return {"success": True, "message": "Device deactivated"}
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Deactivate device error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    # ── Metric catalog & preferences ─────────────────────────────────
    _METRIC_CATALOG = [
        {"category": "Activity", "metrics": [
            {"type": "steps", "name": "Steps", "unit": "count"},
            {"type": "active_energy", "name": "Active Energy", "unit": "kcal"},
            {"type": "basal_energy", "name": "Basal Energy", "unit": "kcal"},
            {"type": "distance", "name": "Distance", "unit": "meters"},
            {"type": "flights_climbed", "name": "Flights Climbed", "unit": "count"},
            {"type": "exercise_time", "name": "Exercise Time", "unit": "minutes"},
            {"type": "stand_time", "name": "Stand Time", "unit": "minutes"},
        ]},
        {"category": "Heart", "metrics": [
            {"type": "hr", "name": "Heart Rate", "unit": "bpm"},
            {"type": "hrv", "name": "HRV", "unit": "ms"},
            {"type": "resting_hr", "name": "Resting Heart Rate", "unit": "bpm"},
            {"type": "walking_hr", "name": "Walking Heart Rate", "unit": "bpm"},
        ]},
        {"category": "Sleep", "metrics": [
            {"type": "sleep_session", "name": "Sleep Session", "unit": "hours"},
            {"type": "sleep_asleep", "name": "Asleep", "unit": "hours"},
            {"type": "sleep_awake", "name": "Awake", "unit": "hours"},
            {"type": "sleep_rem", "name": "REM Sleep", "unit": "hours"},
            {"type": "sleep_deep", "name": "Deep Sleep", "unit": "hours"},
            {"type": "sleep_core", "name": "Core Sleep", "unit": "hours"},
        ]},
        {"category": "Respiratory", "metrics": [
            {"type": "respiratory_rate", "name": "Respiratory Rate", "unit": "breaths/min"},
            {"type": "oxygen_saturation", "name": "Oxygen Saturation", "unit": "%"},
        ]},
        {"category": "Body Measurements", "metrics": [
            {"type": "body_mass", "name": "Weight", "unit": "kg"},
            {"type": "body_mass_index", "name": "BMI", "unit": ""},
            {"type": "body_fat_percentage", "name": "Body Fat", "unit": "%"},
            {"type": "lean_body_mass", "name": "Lean Body Mass", "unit": "kg"},
            {"type": "height", "name": "Height", "unit": "cm"},
            {"type": "waist_circumference", "name": "Waist Circumference", "unit": "cm"},
        ]},
        {"category": "Nutrition", "metrics": [
            {"type": "dietary_energy", "name": "Calories Consumed", "unit": "kcal"},
            {"type": "dietary_protein", "name": "Protein", "unit": "g"},
            {"type": "dietary_carbs", "name": "Carbohydrates", "unit": "g"},
            {"type": "dietary_fat", "name": "Fat", "unit": "g"},
            {"type": "dietary_fiber", "name": "Fiber", "unit": "g"},
            {"type": "dietary_sugar", "name": "Sugar", "unit": "g"},
            {"type": "dietary_water", "name": "Water", "unit": "ml"},
            {"type": "dietary_caffeine", "name": "Caffeine", "unit": "mg"},
        ]},
        {"category": "Vitals", "metrics": [
            {"type": "blood_pressure_systolic", "name": "Blood Pressure (Systolic)", "unit": "mmHg"},
            {"type": "blood_pressure_diastolic", "name": "Blood Pressure (Diastolic)", "unit": "mmHg"},
            {"type": "blood_glucose", "name": "Blood Glucose", "unit": "mmol/L"},
            {"type": "body_temperature", "name": "Body Temperature", "unit": "°C"},
        ]},
        {"category": "Mobility", "metrics": [
            {"type": "walking_speed", "name": "Walking Speed", "unit": "m/s"},
            {"type": "walking_step_length", "name": "Step Length", "unit": "cm"},
            {"type": "walking_asymmetry", "name": "Walking Asymmetry", "unit": "%"},
        ]},
        {"category": "Workouts", "metrics": [
            {"type": "workout", "name": "Workouts", "unit": "minutes"},
        ]},
        {"category": "Mindfulness", "metrics": [
            {"type": "mindful_minutes", "name": "Mindful Minutes", "unit": "minutes"},
        ]},
    ]

    @router.get("/api/wearables/apple/metric_catalog")
    async def get_metric_catalog(current_user=Depends(get_current_user)):
        """Return the full catalog of available Apple Health metric types."""
        return {"categories": _METRIC_CATALOG}

    @router.get("/api/wearables/apple/metric_preferences")
    async def get_metric_preferences(current_user=Depends(get_current_user)):
        """Get the user's explicitly selected metric types for syncing."""
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            settings = _coerce_settings_payload(conn.settings_json if conn else None)
            preferences = _normalize_metric_preferences_v2(settings, _ALL_METRIC_TYPES)
            return {
                "preferences": preferences,
                "selected_metrics": _selected_metrics_from_preferences(preferences),
            }

    # Build a fast lookup from metric type → catalog info
    _METRIC_INFO: dict[str, dict[str, str]] = {}
    for _cat in _METRIC_CATALOG:
        for _m in _cat["metrics"]:
            _METRIC_INFO[_m["type"]] = {"name": _m["name"], "unit": _m["unit"], "category": _cat["category"]}
    _ALL_METRIC_TYPES = set(_METRIC_INFO.keys())

    @router.put("/api/wearables/apple/metric_preferences")
    async def put_metric_preferences(
        body: dict,
        current_user=Depends(get_current_user),
    ):
        """Update Apple Health metric sync preferences."""
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        try:
            preferences = _parse_metric_preferences_payload(body, _ALL_METRIC_TYPES)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        selected_metrics = _selected_metrics_from_preferences(preferences)

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn:
                raise HTTPException(status_code=404, detail="No Apple Health connection found")

            settings = _coerce_settings_payload(conn.settings_json)
            settings["metric_preferences_v2"] = preferences
            settings["metric_preferences"] = selected_metrics
            conn.settings_json = json.dumps(settings)
            await session.commit()

        return {
            "preferences": preferences,
            "selected_metrics": selected_metrics,
            "created_habits": [],
        }

    # ── Export Schedule ──────────────────────────────────────────────────
    @router.get("/api/wearables/apple/export_schedule")
    async def get_export_schedule(current_user=Depends(get_current_user)):
        """Get the user's scheduled export configuration."""
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn or not conn.settings_json:
                return {"schedule": None}

            settings = json.loads(conn.settings_json) if isinstance(conn.settings_json, str) else conn.settings_json
            return {"schedule": settings.get("export_schedule", None)}

    @router.put("/api/wearables/apple/export_schedule")
    async def put_export_schedule(
        body: dict,
        current_user=Depends(get_current_user),
    ):
        """
        Update export schedule. Body:
        {
          "schedule": {
            "enabled": bool,
            "frequency": "daily" | "weekly",
            "format": "markdown" | "json" | "csv",
            "time": "HH:MM",           // 24h local time
            "day_of_week": 0-6 | null,  // 0=Mon, only for weekly
            "folder_path": str | null,  // last used save path (desktop only)
            "include_all_metrics": bool,
            "metric_types": string[] | null
          }
        }
        """
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        schedule = body.get("schedule")
        if schedule is not None:
            if not isinstance(schedule, dict):
                raise HTTPException(status_code=400, detail="schedule must be an object")
            # Validate required fields
            if "enabled" not in schedule:
                schedule["enabled"] = False
            if schedule.get("frequency") not in (None, "daily", "weekly"):
                raise HTTPException(status_code=400, detail="frequency must be 'daily' or 'weekly'")
            if schedule.get("format") not in (None, "markdown", "json", "csv"):
                raise HTTPException(status_code=400, detail="format must be 'markdown', 'json', or 'csv'")

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn:
                raise HTTPException(status_code=404, detail="No Apple Health connection found")

            settings = {}
            if conn.settings_json:
                try:
                    settings = json.loads(conn.settings_json)
                except Exception:
                    settings = {}

            settings["export_schedule"] = schedule
            conn.settings_json = json.dumps(settings)
            await session.commit()

        return {"schedule": schedule}

    # ── Export History ────────────────────────────────────────────────────
    @router.get("/api/wearables/apple/export_history")
    async def get_export_history(
        limit: int = 50,
        current_user=Depends(get_current_user),
    ):
        """Get recent export history entries."""
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn or not conn.settings_json:
                return {"history": []}

            settings = json.loads(conn.settings_json) if isinstance(conn.settings_json, str) else conn.settings_json
            history = settings.get("export_history", [])
            # Return most recent first, capped
            return {"history": history[-limit:][::-1]}

    @router.post("/api/wearables/apple/export_history")
    async def add_export_history(
        body: dict,
        current_user=Depends(get_current_user),
    ):
        """
        Record an export history entry. Body:
        {
          "entry": {
            "id": str,             // UUID
            "timestamp": str,      // ISO datetime
            "start_date": str,     // YYYY-MM-DD
            "end_date": str,       // YYYY-MM-DD
            "format": str,
            "status": "success" | "failed",
            "sample_count": int,
            "file_size_bytes": int | null,
            "file_path": str | null,
            "error": str | null,
            "triggered_by": "manual" | "scheduled"
          }
        }
        """
        from database.connection import get_db_session
        from database.models import WearableConnectionDB
        from sqlalchemy import select

        entry = body.get("entry")
        if not entry or not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="entry must be an object")

        async with get_db_session() as session:
            stmt = select(WearableConnectionDB).where(
                WearableConnectionDB.user_id == current_user["id"],
                WearableConnectionDB.provider == "apple_health",
            )
            result = await session.execute(stmt)
            conn = result.scalar_one_or_none()

            if not conn:
                raise HTTPException(status_code=404, detail="No Apple Health connection found")

            settings = {}
            if conn.settings_json:
                try:
                    settings = json.loads(conn.settings_json)
                except Exception:
                    settings = {}

            history = settings.get("export_history", [])
            history.append(entry)
            # Cap at 100 entries
            if len(history) > 100:
                history = history[-100:]
            settings["export_history"] = history
            conn.settings_json = json.dumps(settings)
            await session.commit()

        return {"entry": entry}

    @router.get("/api/wearables/apple/tracked_metrics")
    async def get_apple_tracked_metrics(current_user=Depends(get_current_user)):
        """
        Get the list of metric types to sync = union of habit-derived + explicit preferences.
        The iOS companion app uses this to know which HealthKit metrics to sync.
        """
        try:
            from database.connection import get_db_session
            from database.models import HabitDB, WearableConnectionDB
            from sqlalchemy import select

            async with get_db_session() as session:
                # 1) Habit-derived metric types
                stmt = select(HabitDB).where(
                    HabitDB.user_id == current_user["id"],
                    HabitDB.integration_source == "apple_health",
                    HabitDB.metric_type.isnot(None)
                )
                result = await session.execute(stmt)
                habits = result.scalars().all()

                habit_types = set(h.metric_type for h in habits if h.metric_type)
                habits_list = [
                    {
                        "id": h.id,
                        "name": h.name,
                        "metric_type": h.metric_type,
                        "unit_type": h.unit_type
                    }
                    for h in habits
                ]

                # 2) Explicit metric preferences from connection settings
                conn_stmt = select(WearableConnectionDB).where(
                    WearableConnectionDB.user_id == current_user["id"],
                    WearableConnectionDB.provider == "apple_health",
                )
                conn_result = await session.execute(conn_stmt)
                conn = conn_result.scalar_one_or_none()

                settings = _coerce_settings_payload(conn.settings_json if conn else None)
                preferences = _normalize_metric_preferences_v2(settings, _ALL_METRIC_TYPES)
                pref_types = set(_selected_metrics_from_preferences(preferences))

                metrics = _build_tracked_metrics_contract(preferences, habit_types)
                all_types = sorted(metrics.keys())
                capability = next(
                    (item for item in list_provider_defs() if item["provider"] == "apple_health"),
                    None,
                )

                return {
                    "metric_types": all_types,
                    "metrics": metrics,
                    "habits": habits_list,
                    "preferences": preferences,
                    "provider_capability": capability,
                }

        except Exception as e:
            logger.error(f"❌ Get tracked metrics error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")

    @router.get("/api/habits/{habit_id}/projection-policy")
    async def get_habit_projection_policy(
        habit_id: str,
        current_user=Depends(get_current_user),
    ):
        policy = await wearable_projection_service.get_projection_policy(
            user_id=current_user["id"],
            habit_id=habit_id,
        )
        if policy is None:
            raise HTTPException(status_code=404, detail="Habit not found")
        return policy

    @router.put("/api/habits/{habit_id}/projection-policy")
    async def put_habit_projection_policy(
        habit_id: str,
        body: dict,
        current_user=Depends(get_current_user),
    ):
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="request body must be an object")

        projection_source_priority = body.get("projection_source_priority", [])
        if not isinstance(projection_source_priority, list):
            raise HTTPException(status_code=400, detail="projection_source_priority must be an array")

        policy = await wearable_projection_service.update_projection_policy(
            user_id=current_user["id"],
            habit_id=habit_id,
            projection_source_priority=projection_source_priority,
            canonical_metric_type=body.get("canonical_metric_type"),
        )
        if policy is None:
            raise HTTPException(status_code=404, detail="Habit not found")
        return policy
    
    
    @router.post("/api/wearables/apple/ingest", response_model=AppleIngestResponse)
    @limiter.limit("30/minute")  # Rate limit ingest requests
    async def ingest_apple_health_metrics(
        request: Request,
        ingest_request: AppleIngestRequest,
        current_user = Depends(get_current_user)
    ):
        """
        Ingest normalized metrics from Apple Health.
        
        This endpoint:
        1. Validates the request signature (HMAC-SHA256)
        2. Checks for duplicate client_event_id (idempotency)
        3. Stores each metric individually
        4. Returns per-item results (partial success allowed)
        
        Request signing:
        - Signature = base64(HMAC-SHA256(device_secret, canonical_string))
        - Canonical string = device_id + "\\n" + client_event_id + "\\n" + captured_at + "\\n" + sha256(metrics_json)
        
        Example request:
        ```json
        {
            "device_id": "abc-123",
            "client_event_id": "uuid-here",
            "captured_at": "2024-01-15T10:30:00Z",
            "metrics": [
                {
                    "source": "apple_health",
                    "metric_type": "steps",
                    "start_time": "2024-01-15T00:00:00Z",
                    "end_time": "2024-01-15T23:59:59Z",
                    "value": 8500,
                    "unit": "count"
                }
            ],
            "schema_version": 1,
            "signature": "base64-hmac-signature"
        }
        ```
        """
        try:
            logger.info(f"📊 Ingesting {len(ingest_request.metrics)} metrics from device {ingest_request.device_id}")
            
            success, results, error = await wearables_service.process_ingest_request(
                user_id=current_user["id"],
                request=ingest_request
            )
            
            if error and not success:
                # If there's an error and no success, return appropriate status
                if error == "Device not found":
                    raise HTTPException(status_code=404, detail=error)
                elif error == "Device does not belong to this user":
                    raise HTTPException(status_code=403, detail=error)
                elif error == "Invalid signature":
                    raise HTTPException(status_code=401, detail=error)
                elif error == "Already processed (idempotency)":
                    # Return success for idempotent requests
                    return AppleIngestResponse(
                        success=True,
                        results=[],
                        server_time=datetime.utcnow().isoformat() + "Z",
                        next_poll_seconds=60
                    )
                else:
                    raise HTTPException(status_code=400, detail=error)
            
            return AppleIngestResponse(
                success=success,
                results=results,
                server_time=datetime.utcnow().isoformat() + "Z",
                next_poll_seconds=60 if success else 300  # Back off on failure
            )
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Ingest error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    # Import V2 schemas
    from schemas.wearables_apple import (
        AppleIngestRequestV2,
        AppleIngestResponseV2,
        DeleteResult,
        SyncStatusResponse,
    )
    
    
    @router.post("/api/wearables/apple/ingest/v2", response_model=AppleIngestResponseV2)
    @limiter.limit("60/minute")  # Higher rate limit for incremental sync
    async def ingest_apple_health_metrics_v2(
        request: Request,
        ingest_request: AppleIngestRequestV2,
        current_user = Depends(get_current_user)
    ):
        """
        V2 Ingest endpoint with incremental sync support.
        
        Supports:
        - added: New metrics since last sync
        - deleted: HealthKit UUIDs of deleted samples
        - modified: Updated metrics (same external_id, new values)
        
        Returns confirmation of operations and anchor state.
        """
        try:
            total_ops = len(ingest_request.added) + len(ingest_request.deleted) + len(ingest_request.modified)
            logger.info(f"📊 V2 Ingest: {len(ingest_request.added)} added, {len(ingest_request.deleted)} deleted, {len(ingest_request.modified)} modified")
            
            success, added_results, deleted_results, modified_results, error = await wearables_service.process_ingest_request_v2(
                user_id=current_user["id"],
                request=ingest_request
            )
            
            # Force flush Tinybird batch to ensure data is synced immediately
            flushed_count = await wearables_service.force_flush_tinybird_batch()
            if flushed_count > 0:
                logger.info(f"📊 Flushed {flushed_count} habit logs to Tinybird")
            
            if error and not success:
                if error == "Device not found":
                    raise HTTPException(status_code=404, detail=error)
                elif error == "Device does not belong to this user":
                    raise HTTPException(status_code=403, detail=error)
                elif error == "Invalid signature":
                    raise HTTPException(status_code=401, detail=error)
                elif error == "Already processed (idempotency)":
                    return AppleIngestResponseV2(
                        success=True,
                        added_results=[],
                        deleted_results=[],
                        modified_results=[],
                        server_time=datetime.utcnow().isoformat() + "Z",
                        next_poll_seconds=60,
                        confirmed_anchors=ingest_request.anchors
                    )
                else:
                    raise HTTPException(status_code=400, detail=error)
            
            return AppleIngestResponseV2(
                success=success,
                added_results=added_results,
                deleted_results=deleted_results,
                modified_results=modified_results,
                server_time=datetime.utcnow().isoformat() + "Z",
                next_poll_seconds=60 if success else 300,
                confirmed_anchors=ingest_request.anchors if success else None
            )
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ V2 Ingest error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/wearables/apple/devices/{device_id}/status", response_model=SyncStatusResponse)
    async def get_device_sync_status(
        device_id: str,
        current_user = Depends(get_current_user)
    ):
        """
        Get sync status for a specific device.
        Used by desktop app to display sync health.
        """
        try:
            status = await wearables_service.get_device_sync_status(
                device_id=device_id,
                user_id=current_user["id"]
            )
            
            if not status:
                raise HTTPException(status_code=404, detail="Device not found")
            
            return SyncStatusResponse(**status)
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"❌ Get sync status error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
    @router.get("/api/wearables/apple/sync-status")
    async def get_all_devices_sync_status(current_user = Depends(get_current_user)):
        """
        Get sync status for all user's Apple Health devices.
        Used by desktop app settings to show connection health.
        """
        try:
            devices = await wearables_service.get_user_devices(current_user["id"])
            
            statuses = []
            for device in devices:
                status = await wearables_service.get_device_sync_status(
                    device_id=device.id,
                    user_id=current_user["id"]
                )
                if status:
                    statuses.append(status)
            
            return {
                "devices": statuses,
                "count": len(statuses)
            }
            
        except Exception as e:
            logger.error(f"❌ Get all sync status error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
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
    
    # ================================

    return router
