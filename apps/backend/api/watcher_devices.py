"""Watcher device and state endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from services.watcher_service import watcher_service
from .watcher_common import (
    DeviceRegisterRequest,
    DeviceResponse,
    StateResponse,
    StateUpdateRequest,
    WatcherStatusResponse,
    get_current_user,
)

router = APIRouter()
@router.post("/devices", response_model=DeviceResponse)
async def register_device(
    request: DeviceRegisterRequest,
    current_user = Depends(get_current_user)
):
    """
    Register a new watcher device.
    Returns device_id and initial configuration.
    """
    try:
        device_id, state = await watcher_service.register_device(
            user_id=current_user["id"],
            device_name=request.device_name,
            platform=request.platform,
            os_version=request.os_version
        )
        
        return DeviceResponse(
            device_id=device_id,
            device_name=request.device_name,
            platform=request.platform,
            os_version=request.os_version,
            is_enabled=state.get("is_enabled", False),
            accessibility_status=state.get("accessibility_status", "unknown")
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/devices")
async def list_devices(current_user = Depends(get_current_user)):
    """
    List all watcher devices for the current user.
    """
    try:
        devices = await watcher_service.get_user_devices(current_user["id"])
        return {"devices": devices}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/devices/{device_id}")
async def get_device(device_id: str, current_user = Depends(get_current_user)):
    """
    Get device info and current state.
    """
    try:
        device = await watcher_service.get_device(device_id, current_user["id"])
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        return device
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


# ============================================================
# WATCHER STATE ENDPOINTS
# ============================================================

@router.post("/devices/{device_id}/start")
async def start_watcher(device_id: str, current_user = Depends(get_current_user)):
    """
    Enable the watcher for a device.
    The Tauri app should start the sidecar process.
    """
    try:
        result = await watcher_service.update_device_state(
            device_id=device_id,
            user_id=current_user["id"],
            is_enabled=True
        )
        if not result:
            raise HTTPException(status_code=404, detail="Device not found")
        
        return {
            "status": "started",
            "device_id": device_id,
            "state": result
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.post("/devices/{device_id}/stop")
async def stop_watcher(device_id: str, current_user = Depends(get_current_user)):
    """
    Disable the watcher for a device.
    The Tauri app should stop the sidecar process.
    """
    try:
        result = await watcher_service.update_device_state(
            device_id=device_id,
            user_id=current_user["id"],
            is_enabled=False
        )
        if not result:
            raise HTTPException(status_code=404, detail="Device not found")
        
        return {
            "status": "stopped",
            "device_id": device_id,
            "state": result
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.get("/devices/{device_id}/status")
async def get_watcher_status(device_id: str, current_user = Depends(get_current_user)):
    """
    Get current watcher status including running state.
    """
    try:
        device = await watcher_service.get_device(device_id, current_user["id"])
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        
        state = device.get("state", {})
        last_seen_ts = state.get("last_seen_ts")
        
        # Consider watcher running if heartbeat within last 10 seconds
        import time
        now_ms = int(time.time() * 1000)
        is_running = False
        if last_seen_ts and (now_ms - last_seen_ts) < 10000:
            is_running = True
        
        return WatcherStatusResponse(
            device_id=device_id,
            is_running=is_running,
            last_seen_ts=last_seen_ts,
            accessibility_status=state.get("accessibility_status", "unknown"),
            title_mode=state.get("title_mode", "off"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.put("/devices/{device_id}/settings", response_model=StateResponse)
async def update_watcher_settings(
    device_id: str,
    request: StateUpdateRequest,
    current_user = Depends(get_current_user)
):
    """
    Update watcher settings for a device.
    """
    try:
        updates = request.model_dump(exclude_none=True)
        
        result = await watcher_service.update_device_state(
            device_id=device_id,
            user_id=current_user["id"],
            **updates
        )
        
        if not result:
            raise HTTPException(status_code=404, detail="Device not found")
        
        return StateResponse(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")


@router.post("/devices/{device_id}/heartbeat")
async def device_heartbeat(device_id: str, current_user = Depends(get_current_user)):
    """
    Update device heartbeat. Called by the watcher sidecar.
    """
    try:
        success = await watcher_service.heartbeat(device_id, current_user["id"])
        if not success:
            raise HTTPException(status_code=404, detail="Device not found")
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail="Unable to process watcher request.")
