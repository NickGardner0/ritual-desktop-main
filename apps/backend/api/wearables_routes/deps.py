"""Dependency bundle for split wearable route modules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional


@dataclass(frozen=True)
class WearablesRouterDeps:
    limiter: Any
    get_current_user: Callable[..., Any]
    wearables_service: Any
    whoop_service: Any
    oura_service: Any
    garmin_service: Any
    wearable_connection_service: Any
    wearable_projection_service: Any
    wearable_query_service: Any
    wearable_sync_service: Any
    wearable_event_outbox_service: Any
    wearable_ingest_job_service: Any
    wearable_maintenance_service: Any
    provider_sync_services: Any
    mark_activation_completed: Callable[[str, str, Optional[dict[str, Any]]], Awaitable[None]]
