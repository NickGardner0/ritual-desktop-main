"""
API router for durable Ritual artifacts.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from schemas.artifacts import (
    ArtifactCreate,
    ArtifactDetailRead,
    ArtifactLinkCreate,
    ArtifactLinkListResponse,
    ArtifactListResponse,
    ArtifactRevisionCreate,
    ArtifactRevisionListResponse,
    ArtifactUpdate,
)
from services.artifact_service import ArtifactVersionConflictError, artifact_service


def create_artifacts_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])

    @router.get("", response_model=ArtifactListResponse)
    async def get_artifacts(
        kind: Optional[str] = Query(default=None),
        status: Optional[str] = Query(default=None),
        limit: int = Query(default=20, ge=1, le=100),
        cursor: Optional[str] = Query(default=None),
        linked_to: Optional[str] = Query(default=None),
        current_user=Depends(get_current_user),
    ):
        return await artifact_service.list_artifacts(
            current_user["id"],
            kind=kind,
            status=status,
            limit=limit,
            cursor=cursor,
            linked_to=linked_to,
        )

    @router.post("", response_model=ArtifactDetailRead)
    async def create_artifact(payload: ArtifactCreate, current_user=Depends(get_current_user)):
        return await artifact_service.create_artifact(current_user["id"], payload)

    @router.get("/{artifact_id}", response_model=ArtifactDetailRead)
    async def get_artifact(artifact_id: str, current_user=Depends(get_current_user)):
        artifact = await artifact_service.get_artifact(current_user["id"], artifact_id)
        if artifact is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        return artifact

    @router.get("/{artifact_id}/revisions", response_model=ArtifactRevisionListResponse)
    async def get_artifact_revisions(artifact_id: str, current_user=Depends(get_current_user)):
        artifact = await artifact_service.get_artifact(current_user["id"], artifact_id)
        if artifact is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        return await artifact_service.list_revisions(current_user["id"], artifact_id)

    @router.patch("/{artifact_id}", response_model=ArtifactDetailRead)
    async def patch_artifact(artifact_id: str, payload: ArtifactUpdate, current_user=Depends(get_current_user)):
        try:
            artifact = await artifact_service.update_artifact(current_user["id"], artifact_id, payload)
        except ArtifactVersionConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if artifact is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        return artifact

    @router.post("/{artifact_id}/revisions", response_model=ArtifactDetailRead)
    async def create_artifact_revision(
        artifact_id: str,
        payload: ArtifactRevisionCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            artifact = await artifact_service.create_revision(current_user["id"], artifact_id, payload)
        except ArtifactVersionConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if artifact is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        return artifact

    @router.get("/{artifact_id}/links", response_model=ArtifactLinkListResponse)
    async def get_artifact_links(artifact_id: str, current_user=Depends(get_current_user)):
        artifact = await artifact_service.get_artifact(current_user["id"], artifact_id)
        if artifact is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        return await artifact_service.list_links(current_user["id"], artifact_id)

    @router.post("/{artifact_id}/links", response_model=ArtifactLinkListResponse)
    async def create_artifact_link(
        artifact_id: str,
        payload: ArtifactLinkCreate,
        current_user=Depends(get_current_user),
    ):
        link = await artifact_service.add_link(current_user["id"], artifact_id, payload)
        if link is None:
            raise HTTPException(status_code=404, detail="Artifact not found")
        return await artifact_service.list_links(current_user["id"], artifact_id)

    return router
