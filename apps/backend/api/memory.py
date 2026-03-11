"""Canonical cloud memory API router."""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException

from .watcher_common import (
    MemoryIngestRequest,
    MemoryIngestResponse,
    MemoryQueryRequest,
    MemoryQueryResponse,
    ScreenSearchResponse,
    get_current_user,
)
from services.memory_backfill_service import backfill_cloud_from_local_chunks
from services.memory_cloud_store import (
    get_memory_query_observability,
    is_memory_cloud_enabled,
    memory_cloud_db_path,
)
from services.memory_embedding_service import (
    check_pipeline_slo,
    get_memory_index_health,
    process_embedding_jobs_with_guard,
)
from services.memory_ingest_service import ingest_memory_chunks
from services.memory_retention_service import run_memory_retention_once
from services.memory_retention_service import reconcile_superseded_provider_docs
from services.memory_turbopuffer_service import TurbopufferService
from services.watcher_service import watcher_service
from services.watcher_service_local_db import get_local_watcher_db_path_impl
from services.watcher_service_search import query_memory_impl
from services.watcher_service_search_utils import (
    get_local_bridge_status_impl,
    get_local_hybrid_bridge_token_impl,
    get_local_hybrid_bridge_url_impl,
)

router = APIRouter(prefix="/api/memory", tags=["memory"])
logger = logging.getLogger(__name__)


def _memory_query_fallback_reason(result: dict) -> str:
    tier = str(result.get("retrieval_tier") or "unavailable").strip().lower()
    citations_count = len(result.get("citations") or [])
    freshness = result.get("freshness") or {}
    freshness_status = str(freshness.get("status") or "unknown").strip().lower()
    mode_used = str((result.get("semantic_truth") or {}).get("mode_used") or "").strip().lower()

    if tier == "cloud_hybrid":
        return "none"
    if tier == "cloud_lexical_only":
        return "cloud_lexical_only"
    if "cloud-unavailable" in mode_used:
        return "cloud_unavailable"
    if freshness_status in {"stale", "unavailable"}:
        return f"freshness_{freshness_status}"
    if freshness_status in {"degraded_ocr", "degraded_semantic"}:
        return f"freshness_{freshness_status}"
    if citations_count == 0 and tier in {"activity_only", "unavailable"}:
        return "no_grounded_citations"
    return tier or "unknown"


def _ts_to_iso_utc(ts_ms: Optional[int]) -> Optional[str]:
    if ts_ms is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts_ms) / 1000, tz=timezone.utc).isoformat()
    except Exception:
        return None


def _lag_seconds(now_ms: int, ts_ms: Optional[int]) -> Optional[int]:
    if ts_ms is None:
        return None
    try:
        return max(0, int((now_ms - int(ts_ms)) / 1000))
    except Exception:
        return None


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    cursor = conn.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type='table' AND name=?
        LIMIT 1
        """,
        (table_name,),
    )
    return cursor.fetchone() is not None


def _scalar(conn: sqlite3.Connection, query: str) -> Optional[int]:
    try:
        row = conn.execute(query).fetchone()
        if not row:
            return None
        value = row[0]
        if value is None:
            return None
        return int(value)
    except Exception:
        return None


def _local_pipeline_snapshot(now_ms: int) -> dict:
    db_path = get_local_watcher_db_path_impl()
    snapshot = {
        "path": db_path,
        "exists": os.path.exists(db_path),
        "ocr_max_ts": None,
        "chunk_max_ts": None,
        "chunk_embedding_pending": None,
        "outbox_pending": None,
        "outbox_uploading": None,
        "outbox_failed": None,
    }
    if not snapshot["exists"]:
        return snapshot

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2.0)
    try:
        conn.execute("PRAGMA query_only = ON")
        if _table_exists(conn, "ocr_frames"):
            snapshot["ocr_max_ts"] = _scalar(conn, "SELECT MAX(timestamp) FROM ocr_frames")
        if _table_exists(conn, "search_chunks"):
            snapshot["chunk_max_ts"] = _scalar(conn, "SELECT MAX(chunk_end_ts) FROM search_chunks")

        if _table_exists(conn, "search_chunks") and _table_exists(conn, "chunk_embeddings"):
            snapshot["chunk_embedding_pending"] = _scalar(
                conn,
                """
                SELECT COUNT(*)
                FROM search_chunks s
                LEFT JOIN chunk_embeddings e ON e.chunk_id = s.id
                WHERE e.chunk_id IS NULL OR COALESCE(e.status, 'pending') != 'ok'
                """,
            )

        if _table_exists(conn, "memory_upload_outbox"):
            snapshot["outbox_pending"] = _scalar(
                conn,
                "SELECT COUNT(*) FROM memory_upload_outbox WHERE status = 'pending'",
            )
            snapshot["outbox_uploading"] = _scalar(
                conn,
                "SELECT COUNT(*) FROM memory_upload_outbox WHERE status = 'uploading'",
            )
            snapshot["outbox_failed"] = _scalar(
                conn,
                "SELECT COUNT(*) FROM memory_upload_outbox WHERE status = 'failed'",
            )
    finally:
        conn.close()

    snapshot["ocr_lag_seconds"] = _lag_seconds(now_ms, snapshot["ocr_max_ts"])
    snapshot["chunk_lag_seconds"] = _lag_seconds(now_ms, snapshot["chunk_max_ts"])
    snapshot["ocr_max_ts_iso_utc"] = _ts_to_iso_utc(snapshot["ocr_max_ts"])
    snapshot["chunk_max_ts_iso_utc"] = _ts_to_iso_utc(snapshot["chunk_max_ts"])
    return snapshot


def _cloud_pipeline_snapshot(now_ms: int) -> dict:
    db_path = memory_cloud_db_path()
    snapshot = {
        "path": db_path,
        "exists": os.path.exists(db_path),
        "cloud_max_ts": None,
        "embedded_ok_count": 0,
        "pending_jobs": None,
        "failed_jobs": None,
        "last_upsert_ts": None,
    }
    if not snapshot["exists"]:
        return snapshot

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=2.0)
    try:
        conn.execute("PRAGMA query_only = ON")
        if _table_exists(conn, "memory_chunks"):
            snapshot["cloud_max_ts"] = _scalar(
                conn,
                """
                SELECT MAX(chunk_end_ts)
                FROM memory_chunks
                WHERE deleted_at IS NULL
                  AND embedding_status = 'ok'
                """,
            )
            count_ok = _scalar(
                conn,
                """
                SELECT COUNT(*)
                FROM memory_chunks
                WHERE deleted_at IS NULL
                  AND embedding_status = 'ok'
                """,
            )
            snapshot["embedded_ok_count"] = int(count_ok or 0)

        if _table_exists(conn, "memory_pipeline_watermarks"):
            row = conn.execute(
                """
                SELECT last_upsert_ts, pending_jobs, failed_jobs
                FROM memory_pipeline_watermarks
                WHERE id = 1
                """
            ).fetchone()
            if row:
                snapshot["last_upsert_ts"] = int(row[0]) if row[0] is not None else None
                snapshot["pending_jobs"] = int(row[1]) if row[1] is not None else 0
                snapshot["failed_jobs"] = int(row[2]) if row[2] is not None else 0
    finally:
        conn.close()

    snapshot["cloud_lag_seconds"] = _lag_seconds(now_ms, snapshot["cloud_max_ts"])
    snapshot["upsert_lag_seconds"] = _lag_seconds(now_ms, snapshot["last_upsert_ts"])
    snapshot["cloud_max_ts_iso_utc"] = _ts_to_iso_utc(snapshot["cloud_max_ts"])
    snapshot["last_upsert_ts_iso_utc"] = _ts_to_iso_utc(snapshot["last_upsert_ts"])
    return snapshot


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
        freshness = result.get("freshness") or {}
        semantic_truth = result.get("semantic_truth") or {}
        semantic_debug = semantic_truth.get("debug") if isinstance(semantic_truth, dict) else {}
        if not isinstance(semantic_debug, dict):
            semantic_debug = {}
        fallback_reason = _memory_query_fallback_reason(result)
        logger.info(
            "memory.query resolved intent=%s tier=%s mode=%s citations=%s provider=%s "
            "fallback_reason=%s freshness_status=%s pending_chunks=%s embedding_lag_seconds=%s "
            "cloud_candidates=%s rerank_provider=%s embed_ok=%s",
            result.get("intent_resolved"),
            result.get("retrieval_tier"),
            result.get("answer_mode"),
            len(result.get("citations") or []),
            (result.get("provider_path") or {}).get("retrieval"),
            fallback_reason,
            freshness.get("status"),
            freshness.get("pending_chunks"),
            freshness.get("embedding_lag_seconds"),
            semantic_debug.get("candidate_count_active"),
            semantic_debug.get("rerank_provider"),
            semantic_debug.get("embed_succeeded"),
        )
        return result
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to process memory query.")


@router.post("/search-context", response_model=ScreenSearchResponse)
async def search_context_memory(
    request: MemoryQueryRequest,
    current_user=Depends(get_current_user),
):
    if not request.query or not request.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    try:
        return await watcher_service.search_context_memory(
            user_id=current_user["id"],
            query=request.query,
            days_back=request.days_back or 7,
            limit=request.limit or 20,
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to process context memory search.")


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


@router.get("/debug/pipeline")
async def get_memory_pipeline_debug(
    current_user=Depends(get_current_user),
):
    now_ms = int(time.time() * 1000)
    local = _local_pipeline_snapshot(now_ms)
    cloud = _cloud_pipeline_snapshot(now_ms)
    index_health = get_memory_index_health() if is_memory_cloud_enabled() else None

    return {
        "success": True,
        "user_id": current_user.get("id"),
        "now_ts": now_ms,
        "now_iso_utc": _ts_to_iso_utc(now_ms),
        "local": local,
        "cloud": cloud,
        "memory_index_health": index_health,
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


@router.get("/diagnostics")
async def memory_diagnostics(current_user=Depends(get_current_user)):
    """Unified pipeline health diagnostics across local, cloud, and bridge."""
    now_ms = int(time.time() * 1000)
    local_snapshot = _local_pipeline_snapshot(now_ms)
    cloud_snapshot = _cloud_pipeline_snapshot(now_ms)
    slo = check_pipeline_slo()
    index_health = get_memory_index_health()
    query_obs = get_memory_query_observability()

    bridge_status = "unknown"
    bridge_last_known = get_local_bridge_status_impl()
    bridge_health_http_status: Optional[int] = None
    bridge_url = get_local_hybrid_bridge_url_impl()
    parsed_bridge = urlparse(bridge_url)
    bridge_health_url = urlunparse(
        (
            parsed_bridge.scheme or "http",
            parsed_bridge.netloc or "127.0.0.1:3031",
            "/health",
            "",
            "",
            "",
        )
    )
    try:
        import httpx as _httpx

        bridge_token = get_local_hybrid_bridge_token_impl()

        headers = {}
        if bridge_token:
            headers["X-Ritual-Bridge-Token"] = bridge_token
        async with _httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(bridge_health_url, headers=headers)
        bridge_health_http_status = int(resp.status_code)
        bridge_status = "up" if resp.status_code == 200 else "down"
    except Exception:
        bridge_status = "down"

    return {
        "local": local_snapshot,
        "cloud": cloud_snapshot,
        "index_health": index_health,
        "bridge": {
            "status": bridge_status,
            "health_url": bridge_health_url,
            "health_http_status": bridge_health_http_status,
            "down_since_ms": bridge_last_known.get("down_since_ms"),
            "down_for_seconds": bridge_last_known.get("down_for_seconds"),
            "status_last_known_by_query_path": bridge_last_known.get("status"),
        },
        "slo": slo,
        "query_observability": query_obs,
        "timestamp_ms": now_ms,
    }
