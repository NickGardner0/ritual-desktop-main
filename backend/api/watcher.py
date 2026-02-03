"""
Ritual Watcher API Endpoints

Handles computer activity tracking for macOS.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from services.watcher_service import watcher_service


router = APIRouter(prefix="/api/watcher", tags=["watcher"])


# ============================================================
# REQUEST/RESPONSE MODELS
# ============================================================

class DeviceRegisterRequest(BaseModel):
    device_name: str = "My Mac"
    platform: str = "macos"
    os_version: Optional[str] = None


class DeviceResponse(BaseModel):
    device_id: str
    device_name: str
    platform: str
    os_version: Optional[str] = None
    is_enabled: bool = False
    last_seen_ts: Optional[int] = None
    accessibility_status: str = "unknown"


class StateUpdateRequest(BaseModel):
    is_enabled: Optional[bool] = None
    poll_interval_ms: Optional[int] = None
    accessibility_status: Optional[str] = None
    title_mode: Optional[str] = None  # off, full, truncate, hash
    truncate_length: Optional[int] = None
    excluded_bundle_ids: Optional[List[str]] = None
    sync_analytics: Optional[bool] = None
    sync_raw_to_cloud: Optional[bool] = None
    afk_timeout_seconds: Optional[int] = None  # Idle timeout (default 900 = 15 min)


class StateResponse(BaseModel):
    device_id: str
    is_enabled: bool
    poll_interval_ms: int
    accessibility_status: str
    title_mode: str
    truncate_length: int
    excluded_bundle_ids: List[str]
    sync_analytics: bool
    sync_raw_to_cloud: bool
    afk_timeout_seconds: int = 900  # Idle timeout (default 900 = 15 min)


class WatcherStatusResponse(BaseModel):
    device_id: str
    is_running: bool
    last_seen_ts: Optional[int] = None
    accessibility_status: str
    title_mode: str
    total_events_today: Optional[int] = None


class ActivityEventCreate(BaseModel):
    app_bundle_id: str
    app_name: str
    window_title: Optional[str] = None
    window_owner_pid: Optional[int] = None
    is_afk: bool = False
    ts_start: Optional[int] = None
    ts_end: Optional[int] = None


class DailyRollupRequest(BaseModel):
    start_date: str  # YYYY-MM-DD
    end_date: str  # YYYY-MM-DD


class TopAppResponse(BaseModel):
    app_bundle_id: str
    app_name: str
    total_active_ms: int
    total_events: int
    hours: float


class AppExclusionRequest(BaseModel):
    bundle_id: str
    app_name: Optional[str] = None
    reason: str = "user_preference"


# ============================================================
# AUTH DEPENDENCY - Supports both JWT and X-User-ID header
# ============================================================

from fastapi import Request, Header

async def get_current_user(
    request: Request,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID")
):
    """
    Get current user from either:
    1. X-User-ID header (for internal Next.js API proxy calls)
    2. JWT Bearer token (for direct API calls)
    
    The X-User-ID header takes precedence when present,
    as it's set by the authenticated Next.js API routes.
    """
    # First check X-User-ID header (from Next.js proxy)
    if x_user_id:
        return {"id": x_user_id, "email": None}
    
    # Fall back to JWT auth from main
    try:
        from main import get_current_user as jwt_auth
        from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
        
        security = HTTPBearer(auto_error=False)
        auth_header = request.headers.get("Authorization")
        
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
            credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
            return await jwt_auth(credentials)
    except Exception as e:
        print(f"⚠️ Watcher auth fallback failed: {e}")
    
    # No auth found
    raise HTTPException(status_code=401, detail="Authentication required")


# ============================================================
# DEVICE MANAGEMENT ENDPOINTS
# ============================================================

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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/devices")
async def list_devices(current_user = Depends(get_current_user)):
    """
    List all watcher devices for the current user.
    """
    try:
        devices = await watcher_service.get_user_devices(current_user["id"])
        return {"devices": devices}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


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
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# ACTIVITY EVENTS ENDPOINTS
# ============================================================

@router.post("/devices/{device_id}/events")
async def record_activity_event(
    device_id: str,
    event: ActivityEventCreate,
    current_user = Depends(get_current_user)
):
    """
    Record an activity event from the watcher sidecar.
    """
    try:
        event_id = await watcher_service.record_activity_event(
            device_id=device_id,
            user_id=current_user["id"],
            app_bundle_id=event.app_bundle_id,
            app_name=event.app_name,
            window_title=event.window_title,
            window_owner_pid=event.window_owner_pid,
            is_afk=event.is_afk,
            ts_start=event.ts_start,
            ts_end=event.ts_end
        )
        
        if event_id is None:
            return {"status": "skipped", "reason": "excluded_app"}
        
        return {"status": "created", "event_id": event_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/events")
async def get_recent_events(
    device_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user = Depends(get_current_user)
):
    """
    Get recent activity events for debugging.
    """
    try:
        events = await watcher_service.get_recent_events(
            user_id=current_user["id"],
            device_id=device_id,
            limit=limit,
            offset=offset
        )
        return {"events": events, "count": len(events)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# DAILY ROLLUPS ENDPOINTS
# ============================================================

@router.post("/rollups/compute")
async def compute_daily_rollups(
    request: DailyRollupRequest,
    device_id: Optional[str] = None,
    force: bool = False,
    current_user = Depends(get_current_user)
):
    """
    Compute daily rollups for a date range.
    """
    try:
        from datetime import datetime, timedelta
        
        start = datetime.strptime(request.start_date, "%Y-%m-%d")
        end = datetime.strptime(request.end_date, "%Y-%m-%d")
        
        results = []
        current = start
        while current <= end:
            day_str = current.strftime("%Y-%m-%d")
            result = await watcher_service.compute_daily_rollup(
                user_id=current_user["id"],
                day=day_str,
                device_id=device_id,
                force_recompute=force
            )
            results.append(result)
            current += timedelta(days=1)
        
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/daily")
async def get_daily_summary(
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get daily activity summaries for a date range.
    Returns aggregated data by day with top apps.
    """
    try:
        summary = await watcher_service.get_daily_summary(
            user_id=current_user["id"],
            start_date=start_date,
            end_date=end_date,
            device_id=device_id
        )
        return {"days": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/top-apps")
async def get_top_apps(
    start_date: str,
    end_date: str,
    limit: int = 10,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get top apps by active time for a date range.
    """
    try:
        apps = await watcher_service.get_top_apps(
            user_id=current_user["id"],
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            device_id=device_id
        )
        return {"apps": apps}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# APP EXCLUSIONS ENDPOINTS
# ============================================================

@router.get("/exclusions")
async def get_app_exclusions(current_user = Depends(get_current_user)):
    """
    Get all app exclusions for the current user.
    """
    try:
        exclusions = await watcher_service.get_app_exclusions(current_user["id"])
        suggested = watcher_service.get_suggested_exclusions()
        return {
            "exclusions": exclusions,
            "suggested": suggested
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/exclusions")
async def add_app_exclusion(
    request: AppExclusionRequest,
    current_user = Depends(get_current_user)
):
    """
    Add an app to the exclusion list.
    """
    try:
        success = await watcher_service.add_app_exclusion(
            user_id=current_user["id"],
            bundle_id=request.bundle_id,
            app_name=request.app_name,
            reason=request.reason
        )
        return {"status": "added" if success else "already_exists"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/exclusions/{bundle_id}")
async def remove_app_exclusion(
    bundle_id: str,
    current_user = Depends(get_current_user)
):
    """
    Remove an app from the exclusion list.
    """
    try:
        success = await watcher_service.remove_app_exclusion(
            user_id=current_user["id"],
            bundle_id=bundle_id
        )
        if not success:
            raise HTTPException(status_code=404, detail="Exclusion not found")
        return {"status": "removed"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# COMPUTER ACTIVITY STATS (for Dashboard/Analytics)
# ============================================================

@router.get("/stats/summary")
async def get_computer_time_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get total computer time summary for a date range.
    Useful for populating a 'Computer Use' habit on the dashboard.
    
    Query params:
    - start_date: YYYY-MM-DD (defaults to today)
    - end_date: YYYY-MM-DD (defaults to today)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        # Default to today if no dates provided
        today = datetime.now().strftime("%Y-%m-%d")
        start = start_date or today
        end = end_date or today
        
        summary = await watcher_service.get_computer_time_summary(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": summary,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats/daily")
async def get_daily_computer_time(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get daily computer time for charting.
    Returns list of {day, active_hours, events_count, apps_count}.
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 30)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        today = datetime.now()
        
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        
        daily_data = await watcher_service.get_daily_computer_time(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": daily_data,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats/top-apps")
async def get_top_apps_stats(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    limit: int = 10,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get top apps by usage time.
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 30)
    - limit: max apps to return (default: 10)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        today = datetime.now()
        
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        
        top_apps = await watcher_service.get_top_apps(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            limit=limit,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": top_apps,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# AUTO-SYNC TO HABIT
# ============================================================

@router.post("/sync-to-habit")
async def sync_to_computer_use_habit(
    day: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Sync today's computer time to the user's "Computer Use" habit.
    Creates or updates a habit log for today with the total computer time.
    
    This endpoint is called hourly by the Tauri app to keep the dashboard updated.
    
    Query params:
    - day: YYYY-MM-DD (defaults to today)
    """
    try:
        result = await watcher_service.sync_to_computer_use_habit(
            user_id=current_user["id"],
            day=day
        )
        
        if result.get("success"):
            print(f"✅ Synced computer time to habit: {result.get('amount', 0)} {result.get('unit', 'Hours')} for {result.get('day')}")
        else:
            print(f"⚠️ Sync failed: {result.get('error')}")
        
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# BROWSER/DOMAIN ANALYTICS ENDPOINTS (V2)
# ============================================================

@router.get("/stats/top-domains")
async def get_top_domains(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    limit: int = 10,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get top domains by usage time (browser tracking).
    
    Returns domains like "github.com", "twitter.com" with time spent.
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 30)
    - limit: max domains to return (default: 10)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        today = datetime.now()
        
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        
        domains = await watcher_service.get_top_domains(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            limit=limit,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": domains,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats/browser-summary")
async def get_browser_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get overall browser usage summary including total time and top domains.
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 30)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        today = datetime.now()
        
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        
        summary = await watcher_service.get_browser_summary(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": summary,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats/domain/{domain}")
async def get_domain_details(
    domain: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 30,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get daily breakdown for a specific domain.
    
    Path params:
    - domain: The domain to get details for (e.g., "github.com")
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 30)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        today = datetime.now()
        
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        
        breakdown = await watcher_service.get_domain_daily_breakdown(
            user_id=current_user["id"],
            domain=domain,
            start_date=start,
            end_date=end,
            device_id=device_id
        )
        
        # Calculate totals
        total_ms = sum(d["active_ms"] for d in breakdown)
        
        return {
            "success": True,
            "domain": domain,
            "data": breakdown,
            "total_ms": total_ms,
            "total_hours": round(total_ms / (1000 * 60 * 60), 2),
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# USAGE BREAKDOWN ENDPOINTS
# ============================================================

@router.get("/breakdown")
async def get_usage_breakdown(
    kind: str,
    key: str,
    start_date: str,
    end_date: str,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get daily usage breakdown for a specific app or website.
    
    Query params:
    - kind: "app" or "website"
    - key: app bundle id or domain
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - device_id: optional device filter (unused for local DB)
    """
    if kind not in ["app", "website"]:
        raise HTTPException(status_code=400, detail="Invalid kind, must be 'app' or 'website'")
    
    if not key:
        raise HTTPException(status_code=400, detail="Missing key")
    
    try:
        breakdown = await watcher_service.get_usage_daily_breakdown(
            user_id=current_user["id"],
            kind=kind,
            key=key,
            start_date=start_date,
            end_date=end_date,
            device_id=device_id
        )
        
        total_ms = sum(d.get("active_ms", 0) for d in breakdown)
        
        return {
            "success": True,
            "kind": kind,
            "key": key,
            "data": breakdown,
            "total_ms": total_ms,
            "total_hours": round(total_ms / (1000 * 60 * 60), 2),
            "start_date": start_date,
            "end_date": end_date
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# AFK ANALYTICS ENDPOINTS (V2)
# ============================================================

@router.get("/stats/afk")
async def get_afk_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    days_back: Optional[int] = 7,
    device_id: Optional[str] = None,
    current_user = Depends(get_current_user)
):
    """
    Get AFK (Away From Keyboard) vs active time summary.
    
    Returns breakdown of active vs idle time.
    
    Query params:
    - start_date: YYYY-MM-DD
    - end_date: YYYY-MM-DD
    - days_back: alternative to start_date (default: 7)
    - device_id: optional device filter
    """
    from datetime import datetime, timedelta
    
    try:
        today = datetime.now()
        
        if start_date and end_date:
            start = start_date
            end = end_date
        else:
            end = today.strftime("%Y-%m-%d")
            start = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
        
        summary = await watcher_service.get_afk_summary(
            user_id=current_user["id"],
            start_date=start,
            end_date=end,
            device_id=device_id
        )
        
        return {
            "success": True,
            "data": summary,
            "start_date": start,
            "end_date": end
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

