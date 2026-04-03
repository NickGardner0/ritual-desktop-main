"""Canonical cloud memory API router."""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from .watcher_common import (
    DayRecapRequest,
    DayRecapResponse,
    MemoryIngestRequest,
    MemoryIngestResponse,
    MemoryQueryRequest,
    MemoryQueryResponse,
    ScreenSearchResponse,
    get_current_user,
)
from services.day_recap_service import build_day_recap, build_range_recap
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
from services.watcher_service_local_db import (
    get_local_activity_db_path_impl,
    get_local_memory_db_path_impl,
)
from services.watcher_service_local_db import open_activity_connection_for_user
from services.watcher_service_search import query_memory_impl

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
    activity_db_path = get_local_activity_db_path_impl()
    memory_db_path = get_local_memory_db_path_impl()
    snapshot = {
        "path": activity_db_path,
        "exists": os.path.exists(activity_db_path),
        "session_doc_max_ts": None,
        "snapshot_max_ts": None,
        "outbox_pending": None,
        "outbox_uploading": None,
        "outbox_failed": None,
    }
    if not snapshot["exists"]:
        return snapshot

    conn = sqlite3.connect(f"file:{activity_db_path}?mode=ro", uri=True, timeout=2.0)
    try:
        conn.execute("PRAGMA query_only = ON")
        if _table_exists(conn, "session_retrieval_docs"):
            snapshot["session_doc_max_ts"] = _scalar(
                conn, "SELECT MAX(chunk_end_ts) FROM session_retrieval_docs"
            )
        if _table_exists(conn, "context_snapshots"):
            snapshot["snapshot_max_ts"] = _scalar(conn, "SELECT MAX(ts) FROM context_snapshots")
    finally:
        conn.close()

    if os.path.exists(memory_db_path):
        outbox_conn = sqlite3.connect(f"file:{memory_db_path}?mode=ro", uri=True, timeout=2.0)
        try:
            outbox_conn.execute("PRAGMA query_only = ON")
            if _table_exists(outbox_conn, "memory_upload_outbox"):
                snapshot["outbox_pending"] = _scalar(
                    outbox_conn,
                    "SELECT COUNT(*) FROM memory_upload_outbox WHERE status = 'pending'",
                )
                snapshot["outbox_uploading"] = _scalar(
                    outbox_conn,
                    "SELECT COUNT(*) FROM memory_upload_outbox WHERE status = 'uploading'",
                )
                snapshot["outbox_failed"] = _scalar(
                    outbox_conn,
                    "SELECT COUNT(*) FROM memory_upload_outbox WHERE status = 'failed'",
                )
        finally:
            outbox_conn.close()

    snapshot["session_doc_lag_seconds"] = _lag_seconds(now_ms, snapshot["session_doc_max_ts"])
    snapshot["snapshot_lag_seconds"] = _lag_seconds(now_ms, snapshot["snapshot_max_ts"])
    snapshot["session_doc_max_ts_iso_utc"] = _ts_to_iso_utc(snapshot["session_doc_max_ts"])
    snapshot["snapshot_max_ts_iso_utc"] = _ts_to_iso_utc(snapshot["snapshot_max_ts"])
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


async def _activity_context_snapshot(now_ms: int, user_id: str) -> dict:
    snapshot = {
        "latest_context_snapshots_ts": None,
        "latest_session_retrieval_docs_ts": None,
        "context_snapshot_count": 0,
        "session_retrieval_doc_count": 0,
    }
    async with open_activity_connection_for_user(user_id, write=False) as conn:
        if conn is None:
            return snapshot
        if _table_exists(conn, "context_snapshots"):
            snapshot["latest_context_snapshots_ts"] = _scalar(conn, "SELECT MAX(ts) FROM context_snapshots")
            snapshot["context_snapshot_count"] = _scalar(conn, "SELECT COUNT(*) FROM context_snapshots") or 0
        if _table_exists(conn, "session_retrieval_docs"):
            snapshot["latest_session_retrieval_docs_ts"] = _scalar(conn, "SELECT MAX(chunk_end_ts) FROM session_retrieval_docs")
            snapshot["session_retrieval_doc_count"] = _scalar(conn, "SELECT COUNT(*) FROM session_retrieval_docs") or 0
    snapshot["context_snapshots_lag_seconds"] = _lag_seconds(now_ms, snapshot["latest_context_snapshots_ts"])
    snapshot["session_retrieval_docs_lag_seconds"] = _lag_seconds(now_ms, snapshot["latest_session_retrieval_docs_ts"])
    snapshot["latest_context_snapshots_iso_utc"] = _ts_to_iso_utc(snapshot["latest_context_snapshots_ts"])
    snapshot["latest_session_retrieval_docs_iso_utc"] = _ts_to_iso_utc(snapshot["latest_session_retrieval_docs_ts"])
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
            timezone=request.timezone,
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
            "cloud_candidates=%s rerank_provider=%s rerank_attempted=%s rerank_reason=%s vector_mode=%s embed_ok=%s",
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
            semantic_debug.get("rerank_attempted"),
            semantic_debug.get("rerank_fallback_reason"),
            semantic_debug.get("vector_rank_mode"),
            semantic_debug.get("embed_succeeded"),
        )
        return result
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Unable to process memory query.")


@router.post("/recap/day", response_model=DayRecapResponse)
async def recap_day_memory(
    request: DayRecapRequest,
    current_user=Depends(get_current_user),
):
    query = (request.query or "").strip()
    anchor_date = (request.anchor_date or "").strip()
    start_date = (request.start_date or "").strip()
    end_date = (request.end_date or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")
    try:
        if start_date and end_date:
            return await build_range_recap(
                user_id=current_user["id"],
                query=query,
                start_date=start_date,
                end_date=end_date,
                timezone_name=request.timezone,
                days_back=request.days_back or 1,
            )
        if not anchor_date:
            raise HTTPException(status_code=400, detail="anchor_date is required")
        return await build_day_recap(
            user_id=current_user["id"],
            query=query,
            anchor_date=anchor_date,
            timezone_name=request.timezone,
            days_back=request.days_back or 1,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception:
        logger.exception("memory.recap.day failed")
        raise HTTPException(status_code=500, detail="Unable to build day recap.")


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


# ---------------------------------------------------------------------------
# Simplified embedding pipeline: session_retrieval_docs → OpenAI → Turbopuffer
# ---------------------------------------------------------------------------

@router.post("/process-session-embeddings")
async def process_session_embedding_batch(
    batch_size: int = 32,
    current_user=Depends(get_current_user),
):
    """
    Embed session_retrieval_docs from activity.db directly to Turbopuffer.
    This is the simplified pipeline that replaces the old multi-hop path.
    """
    from services.session_embedding_service import process_session_embeddings

    try:
        result = await process_session_embeddings(
            current_user["id"],
            batch_size=max(1, min(batch_size, 64)),
        )
        return {"success": True, **result}
    except Exception as exc:
        logger.error(f"Session embedding error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/session-embedding-status")
async def session_embedding_status(
    current_user=Depends(get_current_user),
):
    """Get the current status of the session embedding pipeline."""
    from services.session_embedding_service import get_embedding_status

    try:
        status = await get_embedding_status(current_user["id"])
        return {"success": True, **status}
    except Exception as exc:
        logger.error(f"Session embedding status error: {exc}")
        return {"success": False, "error": str(exc)}


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
    activity_snapshot = await _activity_context_snapshot(now_ms, current_user["id"])
    slo = check_pipeline_slo()
    index_health = get_memory_index_health()
    query_obs = get_memory_query_observability()

    latest_context_ts = activity_snapshot.get("latest_context_snapshots_ts")
    latest_session_doc_ts = activity_snapshot.get("latest_session_retrieval_docs_ts")
    pending_outbox = int(local_snapshot.get("outbox_pending") or 0)
    cloud_freshness_lag = cloud_snapshot.get("cloud_lag_seconds")
    session_doc_lag = _lag_seconds(now_ms, latest_session_doc_ts)
    current_user_cloud_chunks = 0
    current_user_embedded_chunks = 0
    current_user_cloud_max_ts = None
    if cloud_snapshot.get("exists"):
        try:
            conn = sqlite3.connect(f"file:{memory_cloud_db_path()}?mode=ro", uri=True, timeout=2.0)
            row = conn.execute(
                """
                SELECT
                    COUNT(*),
                    SUM(CASE WHEN embedding_status = 'ok' THEN 1 ELSE 0 END),
                    MAX(chunk_end_ts)
                FROM memory_chunks
                WHERE user_id = ?
                  AND deleted_at IS NULL
                """,
                (current_user["id"],),
            ).fetchone()
            if row:
                current_user_cloud_chunks = int(row[0] or 0)
                current_user_embedded_chunks = int(row[1] or 0)
                current_user_cloud_max_ts = int(row[2]) if row[2] is not None else None
            conn.close()
        except Exception:
            pass
    context_ready = bool(activity_snapshot.get("context_snapshot_count") or activity_snapshot.get("session_retrieval_doc_count"))
    semantic_ready = bool(
        current_user_embedded_chunks > 0
        and latest_session_doc_ts
        and current_user_cloud_max_ts
        and abs(int(current_user_cloud_max_ts) - int(latest_session_doc_ts)) <= 15 * 60 * 1000
        and pending_outbox <= 1000
    )
    watcher_ready = bool(activity_snapshot.get("context_snapshot_count"))
    calendar_ready = True
    degradation_reasons: list[str] = []
    if not context_ready:
        degradation_reasons.append("local_context_empty")
    if current_user_cloud_max_ts and latest_session_doc_ts and abs(int(current_user_cloud_max_ts) - int(latest_session_doc_ts)) > 15 * 60 * 1000:
        degradation_reasons.append("cloud_semantic_lag")
    if pending_outbox > 1000:
        degradation_reasons.append("outbox_backlog")
    if cloud_freshness_lag is not None and int(cloud_freshness_lag) > 15 * 60:
        degradation_reasons.append("cloud_freshness_lag")
    can_answer_anchored_day_recap = context_ready or watcher_ready
    catching_up = bool(
        (cloud_freshness_lag is not None and cloud_freshness_lag > 5 * 60)
        or (session_doc_lag is not None and session_doc_lag > 5 * 60)
    )
    overall_status = "Healthy"
    if not can_answer_anchored_day_recap:
        overall_status = "Insufficient for recap"
    elif catching_up and not degradation_reasons:
        overall_status = "Catching up"
    elif degradation_reasons:
        overall_status = "Degraded but usable"

    return {
        "local": local_snapshot,
        "activity": activity_snapshot,
        "cloud": cloud_snapshot,
        "index_health": index_health,
        "slo": slo,
        "query_observability": query_obs,
        "retrieval_health": {
            "latest_context_snapshots_ts": latest_context_ts,
            "latest_session_retrieval_docs_ts": latest_session_doc_ts,
            "memory_upload_outbox": {
                "pending": pending_outbox,
                "uploading": int(local_snapshot.get("outbox_uploading") or 0),
                "failed": int(local_snapshot.get("outbox_failed") or 0),
            },
            "cloud_embedding_freshness": {
                "cloud_lag_seconds": cloud_freshness_lag,
                "last_upsert_ts": cloud_snapshot.get("last_upsert_ts"),
                "latest_cloud_chunk_ts": current_user_cloud_max_ts,
            },
            "cloud_index": {
                "current_user_chunk_count": current_user_cloud_chunks,
                "current_user_embedded_chunk_count": current_user_embedded_chunks,
            },
            "lane_readiness": {
                "context_ready": context_ready,
                "semantic_ready": semantic_ready,
                "calendar_ready": calendar_ready,
                "watcher_ready": watcher_ready,
            },
            "summary": {
                "overall_status": overall_status,
                "can_answer_anchored_day_recap": can_answer_anchored_day_recap,
                "primary_source_selected": "cloud_primary" if semantic_ready else "cloud_degraded",
                "degradation_reasons": degradation_reasons,
            },
        },
        "timestamp_ms": now_ms,
    }
