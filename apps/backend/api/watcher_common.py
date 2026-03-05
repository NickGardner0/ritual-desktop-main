"""Shared models and auth dependency for Watcher API routers."""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional

from fastapi import Header, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)


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


class ScreenSearchResponse(BaseModel):
    success: bool
    query: str
    days_back: int
    result_count: int
    results: List[Dict]
    mode_used: str
    status: str
    retrieval_tier: Optional[str] = None
    warning: Optional[str] = None
    freshness: Optional[Dict] = None
    confidence: Optional[Dict] = None
    source_db: Optional[str] = None
    error: Optional[str] = None


class MemoryQueryRequest(BaseModel):
    query: str
    intent: Optional[str] = "auto"
    days_back: Optional[int] = 7
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    group_by: Optional[str] = "app"
    limit: Optional[int] = 20


class MemoryQueryResponse(BaseModel):
    success: bool
    query: str
    intent_resolved: str
    answer_mode: str
    retrieval_tier: Optional[str] = None
    days_back: int
    start_date: str
    end_date: str
    group_by: str
    time_truth: Optional[Dict] = None
    semantic_truth: Optional[Dict] = None
    citations: List[Dict]
    freshness: Dict
    confidence: Dict
    provider_path: Optional[Dict] = None
    warning: Optional[str] = None
    source_db: Optional[str] = None
    error: Optional[str] = None


class MemoryChunkIngestItem(BaseModel):
    chunk_id: str
    logical_chunk_id: Optional[str] = None
    chunk_start_ts: int
    chunk_end_ts: int
    app_name: Optional[str] = None
    window_title: Optional[str] = None
    browser_domain: Optional[str] = None
    text_compact: Optional[str] = None
    quality_score: Optional[float] = 0.0
    source_frame_ids: Optional[List[int]] = None
    content_hash: Optional[str] = None


class MemoryIngestRequest(BaseModel):
    device_id: str
    chunks: List[MemoryChunkIngestItem]


class MemoryIngestResponse(BaseModel):
    success: bool
    accepted: int
    deduped: int
    failed: int
    accepted_count: Optional[int] = None
    deduped_count: Optional[int] = None
    failed_count: Optional[int] = None
    superseded_count: Optional[int] = None
    provider_delete_queued: Optional[int] = None
    retry_after_seconds: int
    warning: Optional[str] = None
    error: Optional[str] = None


async def get_current_user(
    request: Request,
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
    internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
):
    """
    Get current user from either:
    1. X-User-ID header (trusted service-to-service only with internal key)
    2. JWT Bearer token (direct API calls)
    """
    if x_user_id:
        expected_internal_key = os.getenv("INTERNAL_API_KEY")
        if not expected_internal_key or internal_key != expected_internal_key:
            raise HTTPException(status_code=401, detail="Authentication required")
        return {"id": x_user_id, "email": None}

    try:
        from main import get_current_user as jwt_auth
        from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

        security = HTTPBearer(auto_error=False)
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header[7:]
            credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
            return await jwt_auth(credentials)
    except Exception:
        logger.exception("Watcher JWT auth fallback failed")

    raise HTTPException(status_code=401, detail="Authentication required")
