"""Embedding queue processor for cloud memory chunks."""

from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

from services.memory_cloud_store import get_memory_db, refresh_watermarks
from services.memory_turbopuffer_service import TurbopufferService

logger = logging.getLogger(__name__)

MAX_RETRIES = 5
PROCESSING_STALE_MS = 15 * 60 * 1000


def _now_ms() -> int:
    return int(time.time() * 1000)


def _retry_delay_ms(retry_count: int) -> int:
    # 15s, 30s, 60s, 120s, 240s
    base = [15_000, 30_000, 60_000, 120_000, 240_000]
    idx = min(max(retry_count, 0), len(base) - 1)
    return base[idx]


def _openai_embed_model() -> str:
    return (os.getenv("OPENAI_EMBED_MODEL") or "text-embedding-3-small").strip()

def _openai_client() -> AsyncOpenAI:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return AsyncOpenAI(api_key=api_key)


def _make_provider_doc_id(user_id: str, logical_chunk_id: str, content_hash: str) -> str:
    raw = f"{user_id}:{logical_chunk_id}:{content_hash}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


async def process_embedding_jobs(batch_size: int = 64) -> Dict[str, Any]:
    """
    Process pending chunk embeddings and upsert into Turbopuffer.
    """
    now_ms = _now_ms()
    processed = 0
    failed = 0
    skipped = 0
    last_error: Optional[str] = None
    tp = TurbopufferService()

    if not tp.configured:
        return {
            "processed": 0,
            "failed": 0,
            "skipped": 0,
            "running": False,
            "error": "Turbopuffer is not configured",
        }

    client = _openai_client()

    rows: List[Dict[str, Any]] = []
    with get_memory_db() as conn:
        # Recover jobs left in "processing" after crashes/restarts so queue can continue draining.
        stale_cutoff = now_ms - PROCESSING_STALE_MS
        conn.execute(
            """
            UPDATE memory_embedding_jobs
            SET status = 'pending',
                last_error = CASE
                    WHEN COALESCE(last_error, '') = '' THEN 'stale_processing_reclaimed'
                    ELSE last_error
                END,
                updated_at = ?
            WHERE status = 'processing'
              AND (
                    COALESCE(last_attempt_at, 0) <= ?
                    OR COALESCE(updated_at, 0) <= ?
                  )
            """,
            (now_ms, stale_cutoff, stale_cutoff),
        )

        cursor = conn.execute(
            """
            SELECT
                j.id AS job_id,
                j.chunk_pk,
                j.retry_count,
                c.user_id,
                c.device_id,
                c.chunk_id,
                COALESCE(NULLIF(c.logical_chunk_id, ''), c.chunk_id) AS logical_chunk_id,
                c.chunk_start_ts,
                c.chunk_end_ts,
                c.app_name,
                c.window_title,
                c.browser_domain,
                c.text_compact,
                c.quality_score,
                c.content_hash,
                c.source_frame_ids_json
            FROM memory_embedding_jobs j
            JOIN memory_chunks c ON c.id = j.chunk_pk
            WHERE c.deleted_at IS NULL
              AND (
                    j.status = 'pending'
                    OR (
                        j.status = 'failed'
                        AND (
                            COALESCE(j.next_retry_at, 0) <= ?
                            OR COALESCE(j.last_error, '') LIKE 'Turbopuffer upsert failed: status=400 body=Invalid URL:%Namespace contains invalid characters%'
                            OR COALESCE(j.last_error, '') LIKE 'Turbopuffer upsert failed: status=400 body=%attribute error on key ''quality_score''%'
                        )
                    )
              )
            ORDER BY c.chunk_end_ts DESC, j.updated_at ASC
            LIMIT ?
            """,
            (now_ms, int(max(1, batch_size))),
        )
        fetched = cursor.fetchall()
        for row in fetched:
            rows.append(dict(row))

        if not rows:
            refresh_watermarks(conn)
            return {"processed": 0, "failed": 0, "skipped": 0, "running": False, "error": None}

        job_ids = [int(r["job_id"]) for r in rows]
        conn.executemany(
            """
            UPDATE memory_embedding_jobs
            SET status = 'processing',
                last_attempt_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            [(now_ms, now_ms, job_id) for job_id in job_ids],
        )

    # Embed in one batch call.
    texts = [str(r.get("text_compact") or "").strip() for r in rows]
    try:
        embeddings = await client.embeddings.create(model=_openai_embed_model(), input=texts)
    except Exception as exc:
        # Avoid leaving jobs stranded in "processing" when provider calls fail at batch level.
        with get_memory_db() as conn:
            for row in rows:
                job_id = int(row["job_id"])
                retry_count = int(row.get("retry_count") or 0) + 1
                delay = _retry_delay_ms(retry_count)
                if retry_count > MAX_RETRIES:
                    delay = 30 * 60 * 1000
                conn.execute(
                    """
                    UPDATE memory_embedding_jobs
                    SET status = 'failed',
                        retry_count = ?,
                        last_error = ?,
                        next_retry_at = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (retry_count, str(exc)[:500], now_ms + delay, now_ms, job_id),
                )
        raise

    vector_map: Dict[int, List[float]] = {}
    for idx, emb in enumerate(embeddings.data):
        vector_map[idx] = list(emb.embedding)

    with get_memory_db() as conn:
        for idx, row in enumerate(rows):
            job_id = int(row["job_id"])
            chunk_pk = int(row["chunk_pk"])
            text_compact = str(row.get("text_compact") or "").strip()
            if not text_compact:
                skipped += 1
                conn.execute(
                    """
                    UPDATE memory_embedding_jobs
                    SET status = 'failed',
                        retry_count = retry_count + 1,
                        last_error = ?,
                        next_retry_at = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        "text_compact_empty",
                        now_ms + _retry_delay_ms(1),
                        now_ms,
                        job_id,
                    ),
                )
                continue

            try:
                vector = vector_map.get(idx)
                if not vector:
                    raise RuntimeError("embedding_vector_missing")
                logical_chunk_id = str(row.get("logical_chunk_id") or row["chunk_id"])
                provider_doc_id = _make_provider_doc_id(
                    str(row["user_id"]),
                    logical_chunk_id,
                    str(row["content_hash"]),
                )
                await tp.upsert_chunk(
                    user_id=str(row["user_id"]),
                    doc_id=provider_doc_id,
                    vector=vector,
                    attributes={
                        "user_id": str(row["user_id"]),
                        "device_id": str(row.get("device_id") or ""),
                        "chunk_id": str(row["chunk_id"]),
                        "logical_chunk_id": logical_chunk_id,
                        "chunk_start_ts": int(row.get("chunk_start_ts") or 0),
                        "chunk_end_ts": int(row.get("chunk_end_ts") or 0),
                        "app_name": str(row.get("app_name") or ""),
                        "window_title": str(row.get("window_title") or ""),
                        "browser_domain": str(row.get("browser_domain") or ""),
                        "text_compact": str(row.get("text_compact") or ""),
                        "quality_score": float(row.get("quality_score") or 0.0),
                        "content_hash": str(row["content_hash"]),
                        "active": 1,
                    },
                )
            except Exception as exc:
                retry_count = int(row.get("retry_count") or 0) + 1
                delay = _retry_delay_ms(retry_count)
                if retry_count > MAX_RETRIES:
                    # Keep long-tail failures in rotation so index coverage can recover quickly
                    # after transient provider/config issues.
                    delay = 30 * 60 * 1000
                failed += 1
                last_error = str(exc)
                conn.execute(
                    """
                    UPDATE memory_embedding_jobs
                    SET status = 'failed',
                        retry_count = ?,
                        last_error = ?,
                        next_retry_at = ?,
                        updated_at = ?
                    WHERE id = ?
                    """,
                    (retry_count, str(exc)[:500], now_ms + delay, now_ms, job_id),
                )
                continue

            processed += 1
            conn.execute(
                """
                UPDATE memory_embedding_jobs
                SET status = 'ok',
                    last_error = NULL,
                    next_retry_at = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (now_ms, job_id),
            )
            conn.execute(
                """
                UPDATE memory_chunks
                SET embedding_status = 'ok',
                    embedded_at = ?,
                    provider_doc_id = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    now_ms,
                    _make_provider_doc_id(
                        str(row["user_id"]),
                        str(row.get("logical_chunk_id") or row["chunk_id"]),
                        str(row["content_hash"]),
                    ),
                    now_ms,
                    chunk_pk,
                ),
            )

        conn.execute(
            """
            UPDATE memory_pipeline_watermarks
            SET last_embed_ts = ?,
                last_upsert_ts = ?,
                updated_at = ?
            WHERE id = 1
            """,
            (now_ms, now_ms, now_ms),
        )
        refresh_watermarks(conn)

    return {
        "processed": processed,
        "failed": failed,
        "skipped": skipped,
        "running": False,
        "error": last_error,
    }


async def process_embedding_jobs_with_guard(batch_size: int = 64) -> Dict[str, Any]:
    if not (os.getenv("RITUAL_MEMORY_CLOUD_ENABLED") or "").strip().lower() in {"1", "true", "yes", "on"}:
        return {"processed": 0, "failed": 0, "skipped": 0, "running": False, "error": "cloud_disabled"}
    try:
        return await process_embedding_jobs(batch_size=batch_size)
    except Exception as exc:
        logger.warning("Cloud embedding job processing failed: %s", exc)
        return {"processed": 0, "failed": 0, "skipped": 0, "running": False, "error": str(exc)}


def get_memory_index_health() -> Dict[str, Any]:
    now_ms = _now_ms()
    with get_memory_db() as conn:
        total_chunks = int(conn.execute("SELECT COUNT(*) FROM memory_chunks WHERE deleted_at IS NULL").fetchone()[0] or 0)
        embedded_chunks = int(conn.execute("SELECT COUNT(*) FROM memory_chunks WHERE deleted_at IS NULL AND embedding_status = 'ok'").fetchone()[0] or 0)
        pending_jobs = int(conn.execute("SELECT COUNT(*) FROM memory_embedding_jobs WHERE status IN ('pending', 'processing')").fetchone()[0] or 0)
        failed_jobs = int(conn.execute("SELECT COUNT(*) FROM memory_embedding_jobs WHERE status = 'failed'").fetchone()[0] or 0)
        row = conn.execute(
            "SELECT last_ingest_ts, last_embed_ts, last_upsert_ts, updated_at FROM memory_pipeline_watermarks WHERE id = 1"
        ).fetchone()
        last_ingest_ts = int(row[0]) if row and row[0] is not None else None
        last_embed_ts = int(row[1]) if row and row[1] is not None else None
        last_upsert_ts = int(row[2]) if row and row[2] is not None else None
    coverage = (embedded_chunks / total_chunks) if total_chunks > 0 else 1.0
    lag_seconds = None if last_embed_ts is None else max(0, int((now_ms - last_embed_ts) / 1000))
    return {
        "total_chunks": total_chunks,
        "embedded_chunks": embedded_chunks,
        "pending_jobs": pending_jobs,
        "failed_jobs": failed_jobs,
        "coverage": round(coverage, 4),
        "last_ingest_ts": last_ingest_ts,
        "last_embed_ts": last_embed_ts,
        "last_upsert_ts": last_upsert_ts,
        "embedding_lag_seconds": lag_seconds,
    }
