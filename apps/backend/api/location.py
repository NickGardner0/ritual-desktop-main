"""Location tracking ingest endpoint.

Clients (iOS LocationManager, Mac watcher) POST pings here. Pings are
deduplicated by client_event_id, persisted to user_location_pings, and
materialized into user_location_state for fast resolver lookups.
"""

from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException


def create_location_router(
    *,
    get_current_user: Callable[..., Any],
) -> APIRouter:
    from services.location.ingest import ingest_location_pings
    from services.location.models import IngestResponse, LocationPingBatch

    router = APIRouter(tags=["location"])

    @router.post(
        "/api/user/location-pings",
        response_model=IngestResponse,
        status_code=202,
    )
    async def post_location_pings(
        batch: LocationPingBatch,
        current_user=Depends(get_current_user),
    ) -> IngestResponse:
        """Accept a batch of location pings from a client."""
        if not batch.pings:
            return IngestResponse(accepted=0, rejected=0, duplicates=0)

        if len(batch.pings) > 500:
            raise HTTPException(
                status_code=400,
                detail="Maximum 500 pings per batch",
            )

        result = await ingest_location_pings(current_user["id"], batch.pings)
        return IngestResponse(
            accepted=result.accepted,
            rejected=result.rejected,
            duplicates=result.duplicates,
        )

    return router
