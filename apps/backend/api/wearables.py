"""Wearables API router extracted from main.py."""

import logging
import os
import json
import base64
from datetime import datetime, timedelta
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)


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
        wearable_query_service,
        wearable_sync_service,
    )
    from services.wearable_provider_adapters import get_provider_adapter, list_provider_defs
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
        WearableSyncResponse,
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
        expected_internal_key = os.getenv("INTERNAL_API_KEY")
        if not expected_internal_key:
            logger.error("INTERNAL_API_KEY is not configured")
            raise HTTPException(status_code=503, detail="Service temporarily unavailable")
        if internal_key != expected_internal_key:
            raise HTTPException(status_code=403, detail="Invalid internal API key")

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
    
    
    @router.get("/api/wearables/apple/tracked_metrics")
    async def get_apple_tracked_metrics(current_user = Depends(get_current_user)):
        """
        Get the list of Apple Watch metric types the user has selected to track.
        
        This endpoint returns the metric_type values for all habits where:
        - integration_source = 'apple_health'
        - metric_type is not null
        
        The iOS companion app uses this to know which HealthKit metrics to sync.
        
        Example response:
        ```json
        {
            "metric_types": ["steps", "hr", "hrv", "sleep_session"],
            "habits": [
                {"id": "abc", "name": "Steps", "metric_type": "steps", "unit_type": "Steps"},
                {"id": "def", "name": "Heart Rate", "metric_type": "hr", "unit_type": "BPM"}
            ]
        }
        ```
        """
        try:
            from database.connection import get_db_session
            from database.models import HabitDB
            from sqlalchemy import select
            
            async with get_db_session() as session:
                # Query habits where integration_source is apple_health and metric_type is set
                stmt = select(HabitDB).where(
                    HabitDB.user_id == current_user["id"],
                    HabitDB.integration_source == "apple_health",
                    HabitDB.metric_type.isnot(None)
                )
                result = await session.execute(stmt)
                habits = result.scalars().all()
                
                # Build response
                metric_types = list(set(h.metric_type for h in habits if h.metric_type))
                habits_list = [
                    {
                        "id": h.id,
                        "name": h.name,
                        "metric_type": h.metric_type,
                        "unit_type": h.unit_type
                    }
                    for h in habits
                ]
                
                return {
                    "metric_types": metric_types,
                    "habits": habits_list
                }
                
        except Exception as e:
            logger.error(f"❌ Get tracked metrics error: {str(e)}")
            raise HTTPException(status_code=500, detail="Request could not be processed.")
    
    
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
