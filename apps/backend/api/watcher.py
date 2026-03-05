"""Watcher API aggregate router."""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter

from .watcher_activity import router as activity_router
from .watcher_devices import router as devices_router
from .watcher_stats import router as stats_router

logger = logging.getLogger(__name__)


def _watcher_memory_aliases_enabled() -> bool:
    raw = (os.getenv("RITUAL_MEMORY_WATCHER_ALIASES_ENABLED") or "").strip().lower()
    if not raw:
        return False
    return raw in {"1", "true", "yes", "on"}


router = APIRouter(prefix="/api/watcher", tags=["watcher"])
router.include_router(devices_router)
router.include_router(activity_router)
router.include_router(stats_router)

if _watcher_memory_aliases_enabled():
    from .watcher_memory_aliases import router as watcher_memory_aliases_router

    router.include_router(watcher_memory_aliases_router)
    logger.warning(
        "Watcher memory aliases are ENABLED via RITUAL_MEMORY_WATCHER_ALIASES_ENABLED=true. "
        "Canonical memory API is /api/memory/*."
    )
