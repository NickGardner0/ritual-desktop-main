"""Deprecated watcher memory aliases (temporary compatibility router)."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response

from .watcher_common import (
    MemoryIngestRequest,
    MemoryIngestResponse,
    MemoryQueryRequest,
    MemoryQueryResponse,
    get_current_user,
)
from services.memory_backfill_service import backfill_cloud_from_local_chunks
from services.memory_cloud_store import is_memory_cloud_enabled
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

router = APIRouter(tags=["watcher-memory-aliases"])
logger = logging.getLogger(__name__)

_DEPRECATION_LOGGED: set[str] = set()
_ALIAS_SUNSET = os.getenv("RITUAL_MEMORY_WATCHER_ALIASES_SUNSET") or "Wed, 01 Jul 2026 00:00:00 GMT"
_SUNSET_PARSE_LOGGED = False


def _is_past_alias_sunset() -> bool:
    global _SUNSET_PARSE_LOGGED
    try:
        parsed = parsedate_to_datetime(_ALIAS_SUNSET)
    except Exception:
        if not _SUNSET_PARSE_LOGGED:
            _SUNSET_PARSE_LOGGED = True
            logger.warning(
                "Invalid RITUAL_MEMORY_WATCHER_ALIASES_SUNSET format: %s. "
                "Expected RFC 1123 date, e.g. 'Wed, 01 Jul 2026 00:00:00 GMT'.",
                _ALIAS_SUNSET,
            )
        return False

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    now_utc = datetime.now(timezone.utc)
    return now_utc >= parsed.astimezone(timezone.utc)


def _enforce_alias_not_sunset(*, old_path: str, new_path: str) -> None:
    if not _is_past_alias_sunset():
        return
    raise HTTPException(
        status_code=410,
        detail=f"{old_path} is no longer available. Use {new_path}.",
        headers={
            "Deprecation": "true",
            "Sunset": _ALIAS_SUNSET,
            "Link": f'<{new_path}>; rel="successor-version"',
            "X-Ritual-Deprecated-Endpoint": old_path,
            "X-Ritual-Replacement-Endpoint": new_path,
        },
    )


def _set_alias_deprecation_headers(
    *,
    response: Response,
    old_path: str,
    new_path: str,
    user_id: Optional[str],
) -> None:
    response.headers["Deprecation"] = "true"
    response.headers["Sunset"] = _ALIAS_SUNSET
    response.headers["Link"] = f'<{new_path}>; rel="successor-version"'
    response.headers["Warning"] = f'299 - "{old_path} is deprecated; use {new_path}"'
    response.headers["X-Ritual-Deprecated-Endpoint"] = old_path
    response.headers["X-Ritual-Replacement-Endpoint"] = new_path

    key = f"{old_path}->{new_path}"
    if key not in _DEPRECATION_LOGGED:
        _DEPRECATION_LOGGED.add(key)
        logger.warning(
            "Deprecated watcher memory alias called. old_path=%s new_path=%s user_id=%s",
            old_path,
            new_path,
            user_id or "unknown",
        )


@router.post("/query-memory", response_model=MemoryQueryResponse)
async def query_memory_alias(
    request: MemoryQueryRequest,
    response: Response,
    current_user=Depends(get_current_user),
):
    _enforce_alias_not_sunset(
        old_path="/api/watcher/query-memory",
        new_path="/api/memory/query",
    )
    if not request.query or not request.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    _set_alias_deprecation_headers(
        response=response,
        old_path="/api/watcher/query-memory",
        new_path="/api/memory/query",
        user_id=current_user.get("id") if isinstance(current_user, dict) else None,
    )

    try:
        return await query_memory_impl(
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
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to process watcher memory query.")


@router.post("/memory/ingest-chunks", response_model=MemoryIngestResponse)
async def ingest_memory_chunks_alias(
    request: MemoryIngestRequest,
    response: Response,
    current_user=Depends(get_current_user),
):
    _enforce_alias_not_sunset(
        old_path="/api/watcher/memory/ingest-chunks",
        new_path="/api/memory/ingest-chunks",
    )
    _set_alias_deprecation_headers(
        response=response,
        old_path="/api/watcher/memory/ingest-chunks",
        new_path="/api/memory/ingest-chunks",
        user_id=current_user.get("id") if isinstance(current_user, dict) else None,
    )

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


@router.post("/memory/process-embeddings")
async def process_memory_embeddings_alias(
    batch_size: int = 64,
    response: Response = None,
    current_user=Depends(get_current_user),
):
    _enforce_alias_not_sunset(
        old_path="/api/watcher/memory/process-embeddings",
        new_path="/api/memory/process-embeddings",
    )
    if response is not None:
        _set_alias_deprecation_headers(
            response=response,
            old_path="/api/watcher/memory/process-embeddings",
            new_path="/api/memory/process-embeddings",
            user_id=current_user.get("id") if isinstance(current_user, dict) else None,
        )

    if not is_memory_cloud_enabled():
        raise HTTPException(status_code=503, detail="Cloud memory indexing is disabled.")
    result = await process_embedding_jobs_with_guard(batch_size=max(1, min(batch_size, 256)))
    return {"success": True, "result": result}


@router.get("/memory/health")
async def get_memory_health_alias(
    response: Response,
    current_user=Depends(get_current_user),
):
    _enforce_alias_not_sunset(
        old_path="/api/watcher/memory/health",
        new_path="/api/memory/health",
    )
    _set_alias_deprecation_headers(
        response=response,
        old_path="/api/watcher/memory/health",
        new_path="/api/memory/health",
        user_id=current_user.get("id") if isinstance(current_user, dict) else None,
    )

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


@router.post("/memory/backfill-local")
async def backfill_memory_local_alias(
    limit: int = 5000,
    batch_size: int = 200,
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None,
    device_id: Optional[str] = None,
    response: Response = None,
    current_user=Depends(get_current_user),
):
    _enforce_alias_not_sunset(
        old_path="/api/watcher/memory/backfill-local",
        new_path="/api/memory/backfill-local",
    )
    if response is not None:
        _set_alias_deprecation_headers(
            response=response,
            old_path="/api/watcher/memory/backfill-local",
            new_path="/api/memory/backfill-local",
            user_id=current_user.get("id") if isinstance(current_user, dict) else None,
        )

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


@router.post("/memory/run-retention")
async def run_memory_retention_alias(
    limit: int = 2000,
    response: Response = None,
    current_user=Depends(get_current_user),
):
    _enforce_alias_not_sunset(
        old_path="/api/watcher/memory/run-retention",
        new_path="/api/memory/run-retention",
    )
    if response is not None:
        _set_alias_deprecation_headers(
            response=response,
            old_path="/api/watcher/memory/run-retention",
            new_path="/api/memory/run-retention",
            user_id=current_user.get("id") if isinstance(current_user, dict) else None,
        )

    if not is_memory_cloud_enabled():
        raise HTTPException(status_code=503, detail="Cloud memory indexing is disabled.")
    result = await run_memory_retention_once(limit=limit)
    return {"success": True, "result": result}


@router.post("/memory/reconcile-superseded")
async def reconcile_memory_superseded_alias(
    limit: int = 500,
    response: Response = None,
    current_user=Depends(get_current_user),
):
    _enforce_alias_not_sunset(
        old_path="/api/watcher/memory/reconcile-superseded",
        new_path="/api/memory/reconcile-superseded",
    )
    if response is not None:
        _set_alias_deprecation_headers(
            response=response,
            old_path="/api/watcher/memory/reconcile-superseded",
            new_path="/api/memory/reconcile-superseded",
            user_id=current_user.get("id") if isinstance(current_user, dict) else None,
        )

    if not is_memory_cloud_enabled():
        raise HTTPException(status_code=503, detail="Cloud memory indexing is disabled.")
    result = await reconcile_superseded_provider_docs(limit=limit)
    return {"success": True, "result": result}
