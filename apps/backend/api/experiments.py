"""Authenticated API router for experiment workspaces."""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from schemas.experiments import (
    ExperimentCreate,
    ExperimentDetailRead,
    ExperimentEntryCreate,
    ExperimentEntryRead,
    ExperimentListResponse,
    ExperimentRead,
    ExperimentThreadCreate,
    ExperimentThreadRead,
    ExperimentUpdate,
)
from services.experiment_service import ExperimentNotFoundError, experiment_service


def create_experiments_router(*, get_current_user: Callable[..., Any]) -> APIRouter:
    router = APIRouter(tags=["experiments"])

    @router.get("/api/experiments", response_model=ExperimentListResponse)
    async def list_experiments(
        limit: int = Query(default=20, ge=1, le=100),
        current_user=Depends(get_current_user),
    ):
        return ExperimentListResponse(
            items=await experiment_service.list_experiments(current_user["id"], limit=limit)
        )

    @router.post("/api/experiments", response_model=ExperimentRead)
    async def create_experiment(payload: ExperimentCreate, current_user=Depends(get_current_user)):
        try:
            return await experiment_service.create_experiment(current_user["id"], payload)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.get("/api/experiments/{experiment_id}", response_model=ExperimentDetailRead)
    async def get_experiment(experiment_id: str, current_user=Depends(get_current_user)):
        try:
            return await experiment_service.get_experiment(current_user["id"], experiment_id)
        except ExperimentNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.patch("/api/experiments/{experiment_id}", response_model=ExperimentDetailRead)
    async def update_experiment(
        experiment_id: str,
        payload: ExperimentUpdate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await experiment_service.update_experiment(current_user["id"], experiment_id, payload)
        except ExperimentNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.delete("/api/experiments/{experiment_id}", status_code=204)
    async def delete_experiment(experiment_id: str, current_user=Depends(get_current_user)):
        try:
            await experiment_service.delete_experiment(current_user["id"], experiment_id)
            return Response(status_code=204)
        except ExperimentNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/api/experiments/{experiment_id}/threads", response_model=ExperimentThreadRead)
    async def create_experiment_thread(
        experiment_id: str,
        payload: ExperimentThreadCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await experiment_service.create_thread(current_user["id"], experiment_id, payload)
        except ExperimentNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/api/experiments/{experiment_id}/entries", response_model=ExperimentEntryRead)
    async def create_experiment_entry(
        experiment_id: str,
        payload: ExperimentEntryCreate,
        current_user=Depends(get_current_user),
    ):
        try:
            return await experiment_service.create_entry(current_user["id"], experiment_id, payload)
        except ExperimentNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.delete("/api/experiments/{experiment_id}/entries/{entry_id}", status_code=204)
    async def delete_experiment_entry(
        experiment_id: str,
        entry_id: str,
        current_user=Depends(get_current_user),
    ):
        try:
            await experiment_service.delete_entry(current_user["id"], experiment_id, entry_id)
            return Response(status_code=204)
        except ExperimentNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return router
