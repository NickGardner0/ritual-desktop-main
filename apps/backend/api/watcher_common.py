"""Shared models and auth dependency for Watcher API routers."""

from __future__ import annotations

import os
from typing import List, Optional

from fastapi import Header, HTTPException, Request
from pydantic import BaseModel

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


async def get_current_user(
    request: Request,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
    internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
):
    """
    Get current user from either:
    1. X-User-ID header (trusted service-to-service only with internal key)
    2. The canonical JWT dependency installed by api.watcher.include_watcher_router
    """
    if x_user_id:
        expected_internal_key = os.getenv("INTERNAL_API_KEY")
        if not expected_internal_key or internal_key != expected_internal_key:
            raise HTTPException(status_code=401, detail="Authentication required")
        return {"id": x_user_id, "email": None}

    raise HTTPException(status_code=401, detail="Authentication required")
