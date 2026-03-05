"""Wearables API router extracted from main.py."""

import logging
from datetime import datetime
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

logger = logging.getLogger(__name__)


def create_wearables_router(
    *,
    limiter: Any,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    router = APIRouter(tags=["wearables"])

    # WEARABLES API - Apple Health + Multi-source support
    # ================================
    
    from services.wearables_service import wearables_service
    from schemas.wearables_apple import (
        DeviceRegisterRequest,
        DeviceRegisterResponse,
        DeviceStatusResponse,
        AppleIngestRequest,
        AppleIngestResponse,
        AppleIngestResult,
    )
    
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
            
            metrics = await wearables_service.get_user_metrics(
                user_id=current_user["id"],
                source=source,
                metric_type=metric_type,
                start_date=start_date,
                limit=limit
            )
            
            return {
                "metrics": [
                    {
                        "id": m.id,
                        "source": m.source,
                        "metric_type": m.metric_type,
                        "start_time": m.start_time.isoformat() + "Z",
                        "end_time": m.end_time.isoformat() + "Z",
                        "value": m.value,
                        "unit": m.unit,
                        "timezone": m.timezone,
                        "device_id": m.device_id,
                        "external_id": m.external_id,
                        "created_at": m.created_at.isoformat() + "Z"
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
