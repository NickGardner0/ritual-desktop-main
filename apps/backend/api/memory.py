"""Canonical cloud memory API router."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from .watcher_common import (
    MemoryIngestRequest,
    MemoryIngestResponse,
    MemoryQueryRequest,
    MemoryQueryResponse,
    get_current_user,
)
from services.memory_backfill_service import backfill_cloud_from_local_chunks
from services.memory_cloud_store import get_memory_query_observability, is_memory_cloud_enabled
from services.memory_embedding_service import (
    get_memory_index_health,
    process_embedding_jobs_with_guard,
)
from services.memory_ingest_service import ingest_memory_chunks
from services.memory_retention_service import run_memory_retention_once
from services.memory_retention_service import reconcile_superseded_provider_docs
from services.memory_turbopuffer_service import TurbopufferService
from services.watcher_service import watcher_service
from services.watcher_service_search import query_memory_impl

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.post("/query", response_model=MemoryQueryResponse)
async def query_memory(
    request: MemoryQueryRequest,
    current_user=Depends(get_current_user),
):
    if not request.query or not request.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    try:
        result = await query_memory_impl(
            service=watcher_service,
            user_id=current_user["id"],
            query=request.query,
            intent=request.intent or "auto",
            days_back=request.days_back or 7,
            start_date=request.start_date,
            end_date=request.end_date,
            group_by=request.group_by or "app",
            limit=request.limit or 20,
        )
        return result
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to process memory query.")


@router.post("/ingest-chunks", response_model=MemoryIngestResponse)
async def ingest_memory_chunk_batch(
    request: MemoryIngestRequest,
    current_user=Depends(get_current_user),
):
    if not is_memory_cloud_enabled():
        raise HTTPException(status_code=503, detail="Cloud memory indexing is disabled.")
    if not request.device_id:
        raise HTTPException(status_code=400, detail="device_id is required")
    if not request.chunks:
        raise HTTPException(status_code=400, detail="chunks[] is required")

    try:
        payload_chunks = [chunk.model_dump() for chunk in request.chunks]
        result = await ingest_memory_chunks(
            user_id=current_user["id"],
            device_id=request.device_id,
            chunks=payload_chunks,
            process_batch_after_ingest=True,
        )
        warning = None
        if result.get("failed", 0) > 0:
            warning = "Some chunks failed validation or ingest and should be retried."
        return {
            "success": True,
            "accepted": int(result.get("accepted") or 0),
            "deduped": int(result.get("deduped") or 0),
            "failed": int(result.get("failed") or 0),
            "accepted_count": int(result.get("accepted") or 0),
            "deduped_count": int(result.get("deduped") or 0),
            "failed_count": int(result.get("failed") or 0),
            "superseded_count": int(result.get("superseded") or 0),
            "provider_delete_queued": int(result.get("provider_delete_queued") or 0),
            "retry_after_seconds": int(result.get("retry_after_seconds") or 0),
            "warning": warning,
            "error": None,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to ingest cloud memory chunks: {exc}")


@router.post("/process-embeddings")
async def process_memory_embeddings(
    batch_size: int = 64,
    current_user=Depends(get_current_user),
):
    if not is_memory_cloud_enabled():
        raise HTTPException(status_code=503, detail="Cloud memory indexing is disabled.")
    result = await process_embedding_jobs_with_guard(batch_size=max(1, min(batch_size, 256)))
    return {"success": True, "result": result}


@router.get("/health")
async def get_memory_cloud_health(
    current_user=Depends(get_current_user),
):
    if not is_memory_cloud_enabled():
        return {"success": True, "enabled": False, "status": "disabled"}

    health = get_memory_index_health()
    provider = await TurbopufferService().health_check()
    status = "healthy"
    if provider.get("status") != "ok":
        status = "degraded"
    if (health.get("pending_jobs") or 0) > 5000:
        status = "catching_up"
    return {
        "success": True,
        "enabled": True,
        "status": status,
        "index": health,
        "provider": provider,
    }


@router.get("/ops")
async def get_memory_cloud_ops(
    window_minutes: int = 60,
    current_user=Depends(get_current_user),
):
    if not is_memory_cloud_enabled():
        return {"success": True, "enabled": False, "status": "disabled"}

    health = get_memory_index_health()
    provider = await TurbopufferService().health_check()
    observability = get_memory_query_observability(window_minutes=window_minutes)
    slo = {
        "targets": {
            "grounded_query_rate_gte": 0.60,
            "error_rate_lte": 0.10,
            "p95_latency_ms_lte": 3500,
            "lock_error_rate_lte": 0.01,
            "embedding_lag_seconds_lte": 300,
        },
        "current": {
            "grounded_query_rate": observability.get("grounded_query_rate"),
            "error_rate": observability.get("error_rate"),
            "p95_latency_ms": (observability.get("latency_ms") or {}).get("p95"),
            "lock_error_rate": observability.get("lock_error_rate"),
            "embedding_lag_seconds": health.get("embedding_lag_seconds"),
        },
    }
    return {
        "success": True,
        "enabled": True,
        "status": "ok" if provider.get("status") == "ok" else "degraded",
        "index": health,
        "provider": provider,
        "query_observability": observability,
        "slo": slo,
    }


@router.post("/backfill-local")
async def backfill_memory_cloud_from_local(
    limit: int = 5000,
    batch_size: int = 200,
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None,
    device_id: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    if not is_memory_cloud_enabled():
        raise HTTPException(status_code=503, detail="Cloud memory indexing is disabled.")

    try:
        result = await backfill_cloud_from_local_chunks(
            user_id=current_user["id"],
            device_id_override=device_id,
            limit=limit,
            batch_size=batch_size,
            start_ms=start_ms,
            end_ms=end_ms,
        )
        return {"success": bool(result.get("success")), "result": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Unable to backfill local chunks: {exc}")


@router.post("/run-retention")
async def run_memory_retention(
    limit: int = 2000,
    current_user=Depends(get_current_user),
):
    if not is_memory_cloud_enabled():
        raise HTTPException(status_code=503, detail="Cloud memory indexing is disabled.")
    result = await run_memory_retention_once(limit=limit)
    return {"success": True, "result": result}


@router.post("/reconcile-superseded")
async def reconcile_memory_superseded(
    limit: int = 500,
    current_user=Depends(get_current_user),
):
    if not is_memory_cloud_enabled():
        raise HTTPException(status_code=503, detail="Cloud memory indexing is disabled.")
    result = await reconcile_superseded_provider_docs(limit=limit)
    return {"success": True, "result": result}
