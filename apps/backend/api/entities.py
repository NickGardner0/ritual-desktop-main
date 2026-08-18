"""Entity Protocol HTTP API."""

from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from schemas.entities import (
    ENTITY_TYPES,
    EntityReferenceCreate,
    EntityReferenceListResponse,
    EntityReferenceSyncRequest,
    EntityRelatedResponse,
    EntityResolveRequest,
    EntityResolveResponse,
    EntitySearchResponse,
    EntitySummary,
    canonical_entity_type,
)
from services.entity_service import entity_service
from services.privacy_policy import (
    can_send_to_cloud,
    data_class_for_entity_type,
    request_cloud_consents,
    request_privacy_mode,
)


def create_entities_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/entities", tags=["entities"])

    def _privacy_blocks_search(request: Request, entity_type: str) -> bool:
        decision = can_send_to_cloud(
            data_class=data_class_for_entity_type(entity_type),
            destination="typesense",
            purpose="search",
            mode=request_privacy_mode(request.headers),
            consents=request_cloud_consents(request.headers),
        )
        return not decision.allowed

    @router.get("/search", response_model=EntitySearchResponse)
    async def search_entities(
        request: Request,
        q: str = "",
        types: Optional[str] = Query(default=None),
        limit: int = Query(default=20, ge=1, le=40),
        current_user=Depends(get_current_user),
    ):
        raw_types = [item.strip() for item in (types or "").split(",") if item.strip()] or list(ENTITY_TYPES)
        wanted: list[str] = []
        invalid: list[str] = []
        for item in raw_types:
            canonical = canonical_entity_type(item)
            if canonical is None:
                invalid.append(item)
            elif canonical not in wanted:
                wanted.append(canonical)
        if invalid:
            raise HTTPException(status_code=422, detail=f"Unknown entity types: {', '.join(invalid)}")
        sql_types = [
            item
            for item in wanted
            if item in {"task", "routine", "experiment", "calendar_block", "day", "time_window"}
        ]
        indexed_types = [item for item in wanted if item not in sql_types]
        blocked = any(_privacy_blocks_search(request, item) for item in indexed_types)
        # User-scoped SQL search is the Entity Protocol index. Typesense remains
        # optional; blocked cloud search still returns SQL hits for the owner.
        items = await entity_service.search(current_user["id"], q, types=wanted, limit=limit)
        return EntitySearchResponse(query=q, items=items, privacy_blocked=blocked)

    @router.post("/resolve", response_model=EntityResolveResponse)
    async def resolve_entities(payload: EntityResolveRequest, current_user=Depends(get_current_user)):
        items = await entity_service.resolve_many(current_user["id"], payload.refs)
        return EntityResolveResponse(items=items)

    @router.post("/references", response_model=EntityReferenceListResponse)
    async def create_entity_reference(payload: EntityReferenceCreate, current_user=Depends(get_current_user)):
        try:
            created = await entity_service.create_reference(
                current_user["id"],
                source=payload.source,
                target=payload.target,
                relationship=payload.relationship,
                provenance=payload.provenance,
                anchor_json=payload.anchor_json,
                client_event_id=payload.client_event_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return EntityReferenceListResponse(items=[created])

    @router.post("/references/sync", response_model=EntityReferenceListResponse)
    async def sync_entity_mentions(payload: EntityReferenceSyncRequest, current_user=Depends(get_current_user)):
        try:
            items = await entity_service.sync_mentions(
                current_user["id"],
                source=payload.source,
                targets=payload.targets,
                provenance=payload.provenance,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return EntityReferenceListResponse(items=items)

    def _require_entity_type(entity_type: str) -> str:
        canonical = canonical_entity_type(entity_type)
        if canonical is None:
            raise HTTPException(status_code=422, detail="Unknown entity type")
        return canonical

    @router.get("/summary", response_model=EntitySummary)
    async def get_entity_summary_query(
        entity_type: str,
        entity_id: str,
        current_user=Depends(get_current_user),
    ):
        canonical = _require_entity_type(entity_type)
        return await entity_service.get_summary(current_user["id"], canonical, entity_id)

    @router.get("/related", response_model=EntityRelatedResponse)
    async def get_entity_related_query(
        entity_type: str,
        entity_id: str,
        current_user=Depends(get_current_user),
    ):
        canonical = _require_entity_type(entity_type)
        items = await entity_service.related(current_user["id"], canonical, entity_id)
        return EntityRelatedResponse(items=items)

    @router.get("/{entity_type}/{entity_id}", response_model=EntitySummary)
    async def get_entity_summary(entity_type: str, entity_id: str, current_user=Depends(get_current_user)):
        canonical = _require_entity_type(entity_type)
        return await entity_service.get_summary(current_user["id"], canonical, entity_id)

    @router.get("/{entity_type}/{entity_id}/related", response_model=EntityRelatedResponse)
    async def get_entity_related(entity_type: str, entity_id: str, current_user=Depends(get_current_user)):
        canonical = _require_entity_type(entity_type)
        items = await entity_service.related(current_user["id"], canonical, entity_id)
        return EntityRelatedResponse(items=items)

    @router.get("/{entity_type}/{entity_id}/references", response_model=EntityReferenceListResponse)
    async def get_entity_references(
        entity_type: str,
        entity_id: str,
        direction: str = Query(default="both"),
        current_user=Depends(get_current_user),
    ):
        canonical = _require_entity_type(entity_type)
        items = await entity_service.list_references(
            current_user["id"],
            entity_type=canonical,
            entity_id=entity_id,
            direction=direction,
        )
        return EntityReferenceListResponse(items=items)

    @router.delete("/references/{reference_id}")
    async def delete_entity_reference(reference_id: str, current_user=Depends(get_current_user)):
        deleted = await entity_service.delete_reference(current_user["id"], reference_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Reference not found")
        return {"ok": True}

    return router
