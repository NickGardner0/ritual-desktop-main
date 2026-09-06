"""Calendar V2 API router."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from fastapi.responses import RedirectResponse

from schemas.calendar import (
    AvailabilityRequest,
    AvailabilityResponse,
    CalendarAccountStatus,
    CalendarConnectResponse,
    CalendarEventCreate,
    CalendarEventRead,
    CalendarEventUpdate,
    CalendarPublishRequest,
    CalendarProposalApply,
    CalendarProposalApplyResponse,
    CalendarProposalCreate,
    CalendarMutationProposal,
    CalendarRangeReadModel,
    CalendarRsvpRequest,
    CalendarSearchResponse,
    CalendarSourceRead,
    CalendarSourceUpdate,
)
from services.calendar_service import (
    CalendarConflictError,
    CalendarNotFoundError,
    CalendarValidationError,
    calendar_service,
)
from services.google_calendar_service import (
    GoogleCalendarConfigurationError,
    GoogleCalendarProviderError,
    google_calendar_service,
)
from services.calendar_proposal_service import calendar_proposal_service


def _calendar_error(exc: Exception) -> HTTPException:
    if isinstance(exc, CalendarNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, CalendarConflictError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, GoogleCalendarConfigurationError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, GoogleCalendarProviderError):
        status = 409 if exc.code in {"etag_conflict", "account_already_connected"} else 502
        return HTTPException(status_code=status, detail={"code": exc.code, "message": str(exc)})
    return HTTPException(status_code=422, detail=str(exc))


def create_calendar_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(tags=["calendar"])

    @router.get("/api/calendar/range", response_model=CalendarRangeReadModel)
    async def get_calendar_range(
        start: datetime,
        end: datetime,
        timezone: str = Query(default="UTC"),
        mode: str = Query(default="plan", pattern="^(plan|review)$"),
        sources: Optional[str] = Query(default=None),
        current_user=Depends(get_current_user),
    ):
        try:
            return await calendar_service.list_range(
                current_user["id"],
                start=start,
                end=end,
                timezone_name=timezone,
                mode=mode,
                source_ids=[item for item in (sources or "").split(",") if item] or None,
            )
        except (CalendarValidationError, ValueError) as exc:
            raise _calendar_error(exc) from exc

    @router.get("/api/calendar/search", response_model=CalendarSearchResponse)
    async def search_calendar(
        q: str = Query(min_length=1, max_length=200),
        limit: int = Query(default=30, ge=1, le=100),
        current_user=Depends(get_current_user),
    ):
        return await calendar_service.search(current_user["id"], q, limit)

    @router.get("/api/calendar/events/{event_id}", response_model=CalendarEventRead)
    async def get_calendar_event(event_id: str, current_user=Depends(get_current_user)):
        try:
            return await calendar_service.get_event(current_user["id"], event_id)
        except CalendarNotFoundError as exc:
            raise _calendar_error(exc) from exc

    @router.post("/api/calendar/events", response_model=CalendarEventRead)
    async def create_calendar_event(
        payload: CalendarEventCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await calendar_service.create_event(current_user["id"], payload)
        except (CalendarValidationError, GoogleCalendarProviderError) as exc:
            raise _calendar_error(exc) from exc

    @router.patch("/api/calendar/events/{event_id}", response_model=CalendarEventRead)
    async def patch_calendar_event(
        event_id: str,
        payload: CalendarEventUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await calendar_service.update_event(current_user["id"], event_id, payload)
        except (CalendarNotFoundError, CalendarConflictError, CalendarValidationError, GoogleCalendarProviderError) as exc:
            raise _calendar_error(exc) from exc

    @router.delete("/api/calendar/events/{event_id}")
    async def delete_calendar_event(
        event_id: str,
        scope: str = Query(default="series", pattern="^(occurrence|following|series)$"),
        occurrence_id: Optional[str] = Query(default=None),
        current_user=Depends(get_current_user),
    ):
        try:
            await calendar_service.delete_event(
                current_user["id"], event_id, scope=scope, occurrence_id=occurrence_id
            )
            return {"success": True}
        except (CalendarNotFoundError, GoogleCalendarProviderError) as exc:
            raise _calendar_error(exc) from exc

    @router.post("/api/calendar/events/{event_id}/publish", response_model=CalendarEventRead)
    async def publish_calendar_event(
        event_id: str,
        payload: CalendarPublishRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await calendar_service.publish_event(current_user["id"], event_id, payload.source_id)
        except (CalendarNotFoundError, CalendarValidationError, GoogleCalendarProviderError) as exc:
            raise _calendar_error(exc) from exc

    @router.post("/api/calendar/events/{event_id}/rsvp", response_model=CalendarEventRead)
    async def rsvp_calendar_event(
        event_id: str,
        payload: CalendarRsvpRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await calendar_service.rsvp(current_user["id"], event_id, payload.response)
        except (CalendarNotFoundError, CalendarValidationError, GoogleCalendarProviderError) as exc:
            raise _calendar_error(exc) from exc

    @router.post("/api/calendar/availability", response_model=AvailabilityResponse)
    async def get_calendar_availability(
        payload: AvailabilityRequest,
        current_user=Depends(get_current_user),
    ):
        try:
            return await calendar_service.availability(
                current_user["id"],
                start=payload.start,
                end=payload.end,
                timezone_name=payload.timezone,
                workday_start_minutes=payload.workday_start_minutes,
                workday_end_minutes=payload.workday_end_minutes,
                minimum_minutes=payload.minimum_minutes,
                source_ids=payload.source_ids or None,
            )
        except (CalendarValidationError, ValueError) as exc:
            raise _calendar_error(exc) from exc

    @router.get("/api/calendar/sources", response_model=list[CalendarSourceRead])
    async def get_calendar_sources(current_user=Depends(get_current_user)):
        return await calendar_service.list_sources(current_user["id"])

    @router.patch("/api/calendar/sources/{source_id}", response_model=CalendarSourceRead)
    async def patch_calendar_source(
        source_id: str,
        payload: CalendarSourceUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await calendar_service.update_source(
                current_user["id"], source_id, payload.model_dump(exclude_unset=True)
            )
        except (CalendarNotFoundError, CalendarValidationError) as exc:
            raise _calendar_error(exc) from exc

    @router.get("/api/calendar/proposals", response_model=list[CalendarMutationProposal])
    async def list_calendar_proposals(current_user=Depends(get_current_user)):
        return await calendar_proposal_service.list_pending(current_user["id"])

    @router.post("/api/calendar/proposals", response_model=list[CalendarMutationProposal])
    async def create_calendar_proposals(
        payload: CalendarProposalCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await calendar_proposal_service.create(current_user["id"], payload)
        except ValueError as exc:
            raise _calendar_error(exc) from exc

    @router.post("/api/calendar/proposals/apply", response_model=CalendarProposalApplyResponse)
    async def apply_calendar_proposals(
        payload: CalendarProposalApply,
        current_user=Depends(get_current_user),
    ):
        return await calendar_proposal_service.apply(current_user["id"], payload.proposal_ids)

    @router.post("/api/calendar/proposals/{proposal_id}/reject")
    async def reject_calendar_proposal(proposal_id: str, current_user=Depends(get_current_user)):
        await calendar_proposal_service.reject(current_user["id"], proposal_id)
        return {"success": True}

    @router.get("/api/integrations/google-calendar/status", response_model=CalendarAccountStatus)
    async def google_calendar_status(current_user=Depends(get_current_user)):
        return await google_calendar_service.account_status(current_user["id"])

    @router.post("/api/integrations/google-calendar/connect", response_model=CalendarConnectResponse)
    async def connect_google_calendar(
        return_url: str = Query(default="/calendar"),
        current_user=Depends(get_current_user),
    ):
        try:
            return {"authorization_url": await google_calendar_service.authorization_url(current_user["id"], return_url)}
        except (GoogleCalendarConfigurationError, GoogleCalendarProviderError) as exc:
            raise _calendar_error(exc) from exc

    @router.get("/api/integrations/google-calendar/callback", include_in_schema=False)
    async def google_calendar_callback(code: str, state: str):
        try:
            return_url = await google_calendar_service.complete_oauth(code, state)
            return RedirectResponse(f"{return_url}{'&' if '?' in return_url else '?'}google=connected")
        except (GoogleCalendarConfigurationError, GoogleCalendarProviderError) as exc:
            return RedirectResponse(f"/calendar?google=error&code={getattr(exc, 'code', 'configuration')}")

    @router.post("/api/integrations/google-calendar/sync")
    async def sync_google_calendar(current_user=Depends(get_current_user)):
        try:
            return {"success": True, **(await google_calendar_service.sync_account(current_user["id"]))}
        except (GoogleCalendarConfigurationError, GoogleCalendarProviderError) as exc:
            raise _calendar_error(exc) from exc

    @router.delete("/api/integrations/google-calendar")
    async def disconnect_google_calendar(current_user=Depends(get_current_user)):
        await google_calendar_service.disconnect(current_user["id"])
        return {"success": True}

    @router.post("/api/integrations/google-calendar/webhook", include_in_schema=False)
    async def google_calendar_webhook(
        background_tasks: BackgroundTasks,
        x_goog_channel_id: str = Header(alias="X-Goog-Channel-ID"),
        x_goog_channel_token: str = Header(alias="X-Goog-Channel-Token"),
    ):
        background_tasks.add_task(
            google_calendar_service.process_notification,
            x_goog_channel_id,
            x_goog_channel_token,
        )
        return {"received": True}

    return router
