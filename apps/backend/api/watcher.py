"""Watcher API aggregate router."""

from __future__ import annotations

from collections.abc import Callable
from typing import Optional

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .watcher_activity import router as activity_router
from .watcher_biome import router as biome_router
from .watcher_common import get_current_user as watcher_auth_dependency
from .watcher_devices import router as devices_router
from .watcher_project_time import router as project_time_router
from .watcher_stats import router as stats_router

router = APIRouter(prefix="/api/watcher", tags=["watcher"])
router.include_router(devices_router)
router.include_router(activity_router)
router.include_router(biome_router)
router.include_router(stats_router)
router.include_router(project_time_router)

watcher_security = HTTPBearer(auto_error=False)


def include_watcher_router(
    app: FastAPI,
    *,
    get_current_user: Callable,
) -> None:
    """Register watcher routes with the application's canonical auth dependency."""
    async def resolve_watcher_user(
        request: Request,
        x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
        internal_key: Optional[str] = Header(None, alias="X-Internal-Key"),
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(watcher_security),
    ):
        if x_user_id:
            return await watcher_auth_dependency(request, x_user_id, internal_key)
        if credentials is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        return await get_current_user(request, credentials)

    app.dependency_overrides[watcher_auth_dependency] = resolve_watcher_user
    app.include_router(router)
