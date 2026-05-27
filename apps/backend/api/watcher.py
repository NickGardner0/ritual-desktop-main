"""Watcher API aggregate router."""

from __future__ import annotations

from fastapi import APIRouter

from .watcher_activity import router as activity_router
from .watcher_biome import router as biome_router
from .watcher_devices import router as devices_router
from .watcher_project_time import router as project_time_router
from .watcher_stats import router as stats_router

router = APIRouter(prefix="/api/watcher", tags=["watcher"])
router.include_router(devices_router)
router.include_router(activity_router)
router.include_router(biome_router)
router.include_router(stats_router)
router.include_router(project_time_router)
