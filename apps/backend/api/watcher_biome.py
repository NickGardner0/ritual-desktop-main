"""Apple Biome iPhone activity ingestion endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from schemas.biome import BiomeIngestBatch, BiomeIngestResponse
from services.biome_ingest import MAX_BIOME_EVENTS_PER_BATCH, ingest_biome_events
from .watcher_common import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/biome-ingest", response_model=BiomeIngestResponse, status_code=202)
async def ingest_biome_activity(
    batch: BiomeIngestBatch,
    current_user=Depends(get_current_user),
):
    """Accept normalized iPhone App.InFocus intervals from the desktop watcher."""
    if len(batch.events) > MAX_BIOME_EVENTS_PER_BATCH:
        raise HTTPException(
            status_code=400,
            detail=f"Batch too large; max {MAX_BIOME_EVENTS_PER_BATCH} events",
        )

    try:
        result = await ingest_biome_events(current_user["id"], batch.events)
        return BiomeIngestResponse(
            accepted=result.accepted,
            rejected=result.rejected,
            duplicates=result.duplicates,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unable to process Biome activity batch")
        raise HTTPException(status_code=500, detail="Unable to process watcher request.") from exc
