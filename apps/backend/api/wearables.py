"""Wearables API router composition."""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from fastapi import APIRouter

from api.wearables_routes.admin_replay import register_admin_replay_routes
from api.wearables_routes.apple import register_apple_routes
from api.wearables_routes.callbacks import register_callback_routes
from api.wearables_routes.connections import register_connection_routes
from api.wearables_routes.deps import WearablesRouterDeps
from api.wearables_routes.samples import register_sample_routes
from api.wearables_routes.sync_runs import register_sync_run_routes
from api.wearables_helpers import (
    apple_owned_habit_metric_types as _apple_owned_habit_metric_types,
    build_tracked_metrics_contract as _build_tracked_metrics_contract,
    normalize_metric_preferences_v2 as _normalize_metric_preferences_v2,
    parse_metric_preferences_payload as _parse_metric_preferences_payload,
    selected_metrics_from_preferences as _selected_metrics_from_preferences,
)

logger = logging.getLogger(__name__)


def create_wearables_router(
    *,
    limiter: Any,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    router = APIRouter(tags=["wearables"])

    from services.activation_service import activation_service
    from services.garmin_service import garmin_service
    from services.oura_service import oura_service
    from services.unified_wearables_service import (
        wearable_apple_ingest_service,
        wearable_connection_service,
        wearable_device_security_service,
        wearable_projection_service,
        wearable_query_service,
        wearable_sync_service,
    )
    from services.wearable_event_outbox_service import wearable_event_outbox_service
    from services.wearable_ingest_job_service import wearable_ingest_job_service
    from services.wearable_maintenance_service import wearable_maintenance_service
    from services.wearable_provider_sync_registry import WearableProviderSyncServices
    from services.whoop_service import whoop_service

    provider_sync_services = WearableProviderSyncServices(
        whoop_service=whoop_service,
        oura_service=oura_service,
        garmin_service=garmin_service,
    )

    async def mark_activation_completed(
        user_id: str,
        key: str,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        try:
            await activation_service.mark_checklist_completed(
                user_id=user_id,
                key=key,
                metadata=metadata,
            )
        except Exception as exc:
            logger.warning(
                "Activation checklist update failed for user=%s key=%s: %s",
                user_id,
                key,
                exc,
            )

    deps = WearablesRouterDeps(
        limiter=limiter,
        get_current_user=get_current_user,
        wearable_apple_ingest_service=wearable_apple_ingest_service,
        wearable_device_security_service=wearable_device_security_service,
        whoop_service=whoop_service,
        oura_service=oura_service,
        garmin_service=garmin_service,
        wearable_connection_service=wearable_connection_service,
        wearable_projection_service=wearable_projection_service,
        wearable_query_service=wearable_query_service,
        wearable_sync_service=wearable_sync_service,
        wearable_event_outbox_service=wearable_event_outbox_service,
        wearable_ingest_job_service=wearable_ingest_job_service,
        wearable_maintenance_service=wearable_maintenance_service,
        provider_sync_services=provider_sync_services,
        mark_activation_completed=mark_activation_completed,
    )

    register_connection_routes(router, deps)
    register_sync_run_routes(router, deps)
    register_sample_routes(router, deps)
    register_admin_replay_routes(router, deps)
    register_callback_routes(router, deps)
    register_apple_routes(router, deps)
    return router
