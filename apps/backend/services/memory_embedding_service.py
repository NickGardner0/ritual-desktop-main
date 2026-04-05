"""Embedding queue processor for cloud memory chunks."""

from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

from services.memory_cloud_store import (
    get_memory_db,
    refresh_watermarks,
    release_memory_worker_lease,
    try_acquire_memory_worker_lease,
)
from services.memory_turbopuffer_service import TurbopufferService

logger = logging.getLogger(__name__)

MAX_RETRIES = 5
PROCESSING_STALE_MS = 15 * 60 * 1000
EMBEDDING_WORKER_LEASE_NAME = "memory_embedding_jobs"
EMBEDDING_WORKER_LEASE_MS = 10 * 60 * 1000


def _now_ms() -> int:
    return int(time.time() * 1000)


def _retry_delay_ms(retry_count: int) -> int:
    # 15s, 30s, 60s, 120s, 240s
    base = [15_000, 30_000, 60_000, 120_000, 240_000]
    idx = min(max(retry_count, 0), len(base) - 1)
    return base[idx]


def _embedding_worker_owner_id() -> str:
    return f"embedding-worker:{os.getpid()}:{_now_ms()}"


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


def _extract_parent_context(value: str) -> str:
    text = " ".join(str(value or "").split())
    if not text.lower().startswith("context:"):
        return ""
    context_text = text[len("Context:") :].strip()
    if "|" in context_text:
        context_text = context_text.split("|", 1)[0].strip()
    return context_text[:240]


def _contextual_rewrite_enabled() -> bool:
    return (os.getenv("RITUAL_CONTEXTUAL_REWRITE", "1")).strip() == "1"


async def _contextual_rewrite_batch(
    texts: List[str],
    client: AsyncOpenAI,
) -> List[str]:
    """Add a semantic context prefix to each chunk before embedding.

    Uses GPT-4o-mini to generate a 1-sentence context line that explains
    WHAT the user was doing, not just what apps were open. This dramatically
    improves embedding quality for retrieval.

    Example:
      Input:  "Context: Cursor / main.rs — ritual-desktop-main | Title: main.rs ..."
      Output: "[Working on accessibility text extraction in the ritual-desktop Rust watcher] Context: Cursor / main.rs ..."
    """
    if not _contextual_rewrite_enabled() or not texts:
        return texts

    # Build a single batch prompt for efficiency
    # Process up to 20 chunks per LLM call to keep costs low
    rewritten = list(texts)  # start with originals as fallback
    batch_size = 40  # Process more chunks per LLM call for faster throughput

    for batch_start in range(0, len(texts), batch_size):
        batch = texts[batch_start : batch_start + batch_size]
        if not batch:
            continue

        # Skip chunks that are too short to benefit from rewriting
        indices_to_rewrite = []
        for i, text in enumerate(batch):
            if len(text.strip()) >= 40:
                indices_to_rewrite.append(i)

        if not indices_to_rewrite:
            continue

        chunks_for_llm = [batch[i] for i in indices_to_rewrite]
        numbered = "\n---\n".join(
            f"CHUNK {j+1}:\n{text[:600]}" for j, text in enumerate(chunks_for_llm)
        )

        try:
            response = await client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You add semantic context to screen activity chunks to improve search retrieval. "
                            "For each chunk, write ONE short sentence (max 20 words) describing what the user was DOING, "
                            "based on the app name, window title, and visible text. "
                            "Focus on the TASK, not the tool. Examples:\n"
                            '- "Editing accessibility text extraction in the ritual-desktop Rust watcher"\n'
                            '- "Researching contextual retrieval techniques for AI search systems"\n'
                            '- "Configuring Plaid API credentials for financial data integration"\n'
                            '- "Reviewing pull request for kanban board drag-and-drop feature"\n'
                            "Reply with one line per chunk, numbered to match. No other text."
                        ),
                    },
                    {"role": "user", "content": numbered},
                ],
                temperature=0.1,
                max_tokens=800,
                timeout=15,
            )

            result_text = (response.choices[0].message.content or "").strip()
            lines = [l.strip() for l in result_text.split("\n") if l.strip()]

            for line_idx, line in enumerate(lines):
                if line_idx >= len(indices_to_rewrite):
                    break
                # Strip leading "CHUNK N:" or "1." numbering
                clean = line
                for prefix in [f"CHUNK {line_idx+1}:", f"{line_idx+1}.", f"{line_idx+1})"]:
                    if clean.upper().startswith(prefix.upper()):
                        clean = clean[len(prefix):].strip()
                        break

                if clean and len(clean) >= 10:
                    global_idx = batch_start + indices_to_rewrite[line_idx]
                    rewritten[global_idx] = f"[{clean}] {texts[global_idx]}"

        except Exception as exc:
            logger.warning("Contextual rewrite batch failed (non-fatal): %s", exc)
            # Fall through — use original texts

    return rewritten


def _mark_unfinished_jobs_failed(
    *,
    rows: List[Dict[str, Any]],
    error: Exception,
    now_ms: Optional[int] = None,
) -> None:
    if not rows:
        return
    failed_at = int(now_ms or _now_ms())
    error_text = str(error)[:500] or error.__class__.__name__
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
                  AND status = 'processing'
                """,
                (retry_count, error_text, failed_at + delay, failed_at, job_id),
            )
        refresh_watermarks(conn)


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
                COALESCE(NULLIF(c.source_kind, ''), 'legacy_ocr_chunk') AS source_kind,
                COALESCE(NULLIF(c.session_id, ''), '') AS session_id,
                c.app_name,
                c.window_title,
                c.document_title,
                c.browser_domain,
                c.raw_text_compact,
                c.contextual_text_compact,
                c.text_compact,
                COALESCE(c.context_version, 1) AS context_version,
                COALESCE(c.session_key, '') AS session_key,
                COALESCE(c.session_position, 0) AS session_position,
                COALESCE(c.session_chunk_count, 1) AS session_chunk_count,
                c.quality_score,
                COALESCE(c.capture_quality, c.quality_score, 0.0) AS capture_quality,
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
                            OR COALESCE(j.last_error, '') LIKE 'Turbopuffer upsert failed: status=400 body=%inferred schema type for attribute ''quality_score'' as int%'
                            OR COALESCE(j.last_error, '') LIKE 'Turbopuffer upsert failed: status=400 body=%invalid schema update for attribute ''active''%'
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

    try:
        raw_texts = [
            str(r.get("contextual_text_compact") or r.get("text_compact") or "").strip()
            for r in rows
        ]
        texts = await _contextual_rewrite_batch(raw_texts, client)

        try:
            embeddings = await client.embeddings.create(model=_openai_embed_model(), input=texts)
        except Exception as exc:
            _mark_unfinished_jobs_failed(rows=rows, error=exc, now_ms=now_ms)
            raise

        vector_map: Dict[int, List[float]] = {}
        for idx, emb in enumerate(embeddings.data):
            vector_map[idx] = list(emb.embedding)

        with get_memory_db() as conn:
            for idx, row in enumerate(rows):
                job_id = int(row["job_id"])
                chunk_pk = int(row["chunk_pk"])
                contextual_text_compact = str(
                    row.get("contextual_text_compact") or row.get("text_compact") or ""
                ).strip()
                raw_text_compact = str(row.get("raw_text_compact") or "").strip()
                text_compact = contextual_text_compact
                rewritten_text = texts[idx] if idx < len(texts) else text_compact
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
                    qs_raw = row.get("quality_score")
                    qs = float(qs_raw) if qs_raw is not None else 0.0
                    qs = max(0.0, min(1.0, qs))

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
                            "source_kind": str(row.get("source_kind") or "legacy_ocr_chunk"),
                            "session_id": str(row.get("session_id") or ""),
                            "app_name": str(row.get("app_name") or ""),
                            "window_title": str(row.get("window_title") or ""),
                            "document_title": str(row.get("document_title") or ""),
                            "browser_domain": str(row.get("browser_domain") or ""),
                            "text_compact": rewritten_text,
                            "raw_text_compact": raw_text_compact,
                            "contextual_text_compact": rewritten_text,
                            "raw_visible_text": raw_text_compact,
                            "contextual_retrieval_text": rewritten_text,
                            "parent_context": _extract_parent_context(contextual_text_compact),
                            "context_version": int(row.get("context_version") or 1),
                            "session_key": str(row.get("session_key") or row.get("session_id") or ""),
                            "session_position": int(row.get("session_position") or 0),
                            "session_chunk_count": int(row.get("session_chunk_count") or 1),
                            "session_count": int(row.get("session_chunk_count") or 1),
                            "quality_score": qs,
                            "capture_quality": float(row.get("capture_quality") or qs),
                            "content_hash": str(row["content_hash"]),
                            "active": 1,
                        },
                    )
                except Exception as exc:
                    retry_count = int(row.get("retry_count") or 0) + 1
                    delay = _retry_delay_ms(retry_count)
                    if retry_count > MAX_RETRIES:
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

            if processed > 0:
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
    except Exception as exc:
        _mark_unfinished_jobs_failed(rows=rows, error=exc, now_ms=_now_ms())
        raise

    return {
        "processed": processed,
        "failed": failed,
        "skipped": skipped,
        "running": False,
        "error": last_error,
    }


async def process_embedding_jobs_freshness_first(
    *,
    start_ms: int,
    end_ms: int,
    batch_size: int = 8,
) -> Dict[str, Any]:
    """Process embedding jobs restricted to chunks overlapping [start_ms, end_ms].

    Used at query time so the most relevant chunks for the user's query are
    prioritized ahead of the general backlog.
    """
    now_ms = _now_ms()
    tp = TurbopufferService()
    if not tp.configured:
        return {"processed": 0, "failed": 0, "skipped": 0, "error": "turbopuffer_not_configured"}

    client = _openai_client()
    rows: List[Dict[str, Any]] = []
    with get_memory_db() as conn:
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
                j.id AS job_id, j.chunk_pk, j.retry_count,
                c.user_id, c.device_id, c.chunk_id,
                COALESCE(NULLIF(c.logical_chunk_id, ''), c.chunk_id) AS logical_chunk_id,
                c.chunk_start_ts, c.chunk_end_ts,
                COALESCE(NULLIF(c.source_kind, ''), 'legacy_ocr_chunk') AS source_kind,
                COALESCE(NULLIF(c.session_id, ''), '') AS session_id,
                c.app_name, c.window_title, c.document_title,
                c.browser_domain, c.text_compact,
                COALESCE(c.raw_text_compact, '') AS raw_text_compact,
                COALESCE(c.contextual_text_compact, c.text_compact, '') AS contextual_text_compact,
                c.quality_score,
                COALESCE(c.capture_quality, c.quality_score, 0.0) AS capture_quality,
                c.content_hash,
                COALESCE(c.context_version, 1) AS context_version,
                COALESCE(c.session_key, '') AS session_key,
                COALESCE(c.session_position, 0) AS session_position,
                COALESCE(c.session_chunk_count, 1) AS session_chunk_count,
                c.source_frame_ids_json
            FROM memory_embedding_jobs j
            JOIN memory_chunks c ON c.id = j.chunk_pk
            WHERE c.deleted_at IS NULL
              AND (
                    j.status = 'pending'
                    OR (
                        j.status = 'failed'
                        AND (
                            (COALESCE(j.retry_count, 0) < ? AND COALESCE(j.next_retry_at, 0) <= ?)
                            OR COALESCE(j.last_error, '') LIKE 'Turbopuffer upsert failed: status=400 body=%inferred schema type for attribute ''quality_score'' as int%'
                            OR COALESCE(j.last_error, '') LIKE 'Turbopuffer upsert failed: status=400 body=%invalid schema update for attribute ''active''%'
                        )
                    )
                  )
              AND c.chunk_end_ts >= ? AND c.chunk_start_ts <= ?
            ORDER BY c.chunk_end_ts DESC
            LIMIT ?
            """,
            (
                MAX_RETRIES,
                now_ms,
                int(start_ms),
                int(end_ms),
                int(max(1, batch_size)),
            ),
        )
        for row in cursor.fetchall():
            rows.append(dict(row))
        if not rows:
            return {"processed": 0, "failed": 0, "skipped": 0, "error": None}
        job_ids = [int(r["job_id"]) for r in rows]
        conn.executemany(
            "UPDATE memory_embedding_jobs SET status='processing', last_attempt_at=?, updated_at=? WHERE id=?",
            [(now_ms, now_ms, jid) for jid in job_ids],
        )

    raw_texts = [
        str(r.get("contextual_text_compact") or r.get("text_compact") or "").strip()
        for r in rows
    ]
    # Contextual rewriting: add semantic context prefix before embedding
    texts = await _contextual_rewrite_batch(raw_texts, client)
    try:
        embeddings = await client.embeddings.create(model=_openai_embed_model(), input=texts)
    except Exception as exc:
        with get_memory_db() as conn:
            for row in rows:
                jid = int(row["job_id"])
                rc = int(row.get("retry_count") or 0) + 1
                conn.execute(
                    "UPDATE memory_embedding_jobs SET status='failed', retry_count=?, last_error=?, next_retry_at=?, updated_at=? WHERE id=?",
                    (rc, str(exc)[:500], now_ms + _retry_delay_ms(rc), now_ms, jid),
                )
        return {"processed": 0, "failed": len(rows), "skipped": 0, "error": str(exc)}

    vector_map = {idx: list(emb.embedding) for idx, emb in enumerate(embeddings.data)}
    processed = 0
    failed = 0
    with get_memory_db() as conn:
        for idx, row in enumerate(rows):
            jid = int(row["job_id"])
            contextual_text_compact = str(
                row.get("contextual_text_compact") or row.get("text_compact") or ""
            ).strip()
            raw_text_compact = str(row.get("raw_text_compact") or "").strip()
            text_compact = contextual_text_compact
            # Use the contextually-rewritten text (with semantic prefix)
            rewritten_text = texts[idx] if idx < len(texts) else text_compact
            if not text_compact:
                rc = int(row.get("retry_count") or 0) + 1
                failed += 1
                conn.execute(
                    """
                    UPDATE memory_embedding_jobs
                    SET status='failed',
                        retry_count=?,
                        last_error='text_compact_empty',
                        next_retry_at=?,
                        updated_at=?
                    WHERE id=?
                    """,
                    (rc, now_ms + _retry_delay_ms(rc), now_ms, jid),
                )
                continue
            vector = vector_map.get(idx)
            if not vector:
                rc = int(row.get("retry_count") or 0) + 1
                failed += 1
                conn.execute(
                    """
                    UPDATE memory_embedding_jobs
                    SET status='failed',
                        retry_count=?,
                        last_error='embedding_vector_missing',
                        next_retry_at=?,
                        updated_at=?
                    WHERE id=?
                    """,
                    (rc, now_ms + _retry_delay_ms(rc), now_ms, jid),
                )
                continue
            logical_chunk_id = str(row.get("logical_chunk_id") or row["chunk_id"])
            provider_doc_id = _make_provider_doc_id(str(row["user_id"]), logical_chunk_id, str(row["content_hash"]))
            try:
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
                        "source_kind": str(row.get("source_kind") or "legacy_ocr_chunk"),
                        "session_id": str(row.get("session_id") or ""),
                        "app_name": str(row.get("app_name") or ""),
                        "window_title": str(row.get("window_title") or ""),
                        "document_title": str(row.get("document_title") or ""),
                        "browser_domain": str(row.get("browser_domain") or ""),
                        "text_compact": rewritten_text,
                        "raw_text_compact": raw_text_compact,
                        "contextual_text_compact": rewritten_text,
                        "raw_visible_text": raw_text_compact,
                        "contextual_retrieval_text": rewritten_text,
                        "parent_context": _extract_parent_context(contextual_text_compact),
                        "context_version": int(row.get("context_version") or 1),
                        "session_key": str(row.get("session_key") or row.get("session_id") or ""),
                        "session_position": int(row.get("session_position") or 0),
                        "session_chunk_count": int(row.get("session_chunk_count") or 1),
                        "session_count": int(row.get("session_chunk_count") or 1),
                        "quality_score": float(row.get("quality_score") or 0.0),
                        "capture_quality": float(row.get("capture_quality") or row.get("quality_score") or 0.0),
                        "content_hash": str(row["content_hash"]),
                        "active": 1,
                    },
                )
            except Exception as exc:
                rc = int(row.get("retry_count") or 0) + 1
                conn.execute(
                    "UPDATE memory_embedding_jobs SET status='failed', retry_count=?, last_error=?, next_retry_at=?, updated_at=? WHERE id=?",
                    (rc, str(exc)[:500], now_ms + _retry_delay_ms(rc), now_ms, jid),
                )
                failed += 1
                continue
            processed += 1
            conn.execute("UPDATE memory_embedding_jobs SET status='ok', last_error=NULL, next_retry_at=NULL, updated_at=? WHERE id=?", (now_ms, jid))
            conn.execute(
                "UPDATE memory_chunks SET embedding_status='ok', embedded_at=?, provider_doc_id=?, updated_at=? WHERE id=?",
                (now_ms, provider_doc_id, now_ms, int(row["chunk_pk"])),
            )
        if processed > 0:
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
    return {"processed": processed, "failed": failed, "skipped": 0, "error": None}


async def process_embedding_jobs_with_guard(batch_size: int = 64) -> Dict[str, Any]:
    if not (os.getenv("RITUAL_MEMORY_CLOUD_ENABLED") or "").strip().lower() in {"1", "true", "yes", "on"}:
        return {"processed": 0, "failed": 0, "skipped": 0, "running": False, "error": "cloud_disabled"}
    owner_id = _embedding_worker_owner_id()
    try:
        acquired = try_acquire_memory_worker_lease(
            name=EMBEDDING_WORKER_LEASE_NAME,
            owner_id=owner_id,
            lease_ms=EMBEDDING_WORKER_LEASE_MS,
        )
    except Exception as exc:
        logger.warning("Cloud embedding lease acquisition failed: %s", exc)
        return {"processed": 0, "failed": 0, "skipped": 0, "running": False, "error": str(exc)}
    if not acquired:
        return {"processed": 0, "failed": 0, "skipped": 0, "running": True, "error": "already_running"}
    try:
        return await process_embedding_jobs(batch_size=batch_size)
    except Exception as exc:
        logger.warning("Cloud embedding job processing failed: %s", exc)
        return {"processed": 0, "failed": 0, "skipped": 0, "running": False, "error": str(exc)}
    finally:
        try:
            release_memory_worker_lease(
                name=EMBEDDING_WORKER_LEASE_NAME,
                owner_id=owner_id,
            )
        except Exception:
            logger.debug("Cloud embedding lease release skipped", exc_info=True)


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


# ---------------------------------------------------------------------------
# Pipeline SLO enforcement
# ---------------------------------------------------------------------------

SLO_EMBED_LAG_P95_SECONDS = 300
SLO_PENDING_CHUNKS_MAX = 200
SLO_OUTBOX_DRAIN_SECONDS = 600


def check_pipeline_slo() -> Dict[str, Any]:
    """Return current pipeline metrics and whether they meet SLO targets."""
    health = get_memory_index_health()
    embed_lag = health.get("embedding_lag_seconds")
    pending = int(health.get("pending_jobs") or 0)

    embed_lag_ok = embed_lag is not None and embed_lag <= SLO_EMBED_LAG_P95_SECONDS
    pending_ok = pending <= SLO_PENDING_CHUNKS_MAX
    meets_slo = embed_lag_ok and pending_ok

    violations: List[str] = []
    if not embed_lag_ok:
        violations.append(f"embed_lag={embed_lag}s exceeds {SLO_EMBED_LAG_P95_SECONDS}s")
    if not pending_ok:
        violations.append(f"pending_jobs={pending} exceeds {SLO_PENDING_CHUNKS_MAX}")

    return {
        "embed_lag_p95_seconds": embed_lag,
        "pending_chunks": pending,
        "embed_lag_within_slo": embed_lag_ok,
        "pending_within_slo": pending_ok,
        "meets_slo": meets_slo,
        "violations": violations,
        "slo_targets": {
            "embed_lag_p95_seconds": SLO_EMBED_LAG_P95_SECONDS,
            "pending_chunks_max": SLO_PENDING_CHUNKS_MAX,
        },
    }
