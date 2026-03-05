"""Chunk ingestion service for cloud memory pipeline."""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any, Dict, List

from services.memory_cloud_store import get_memory_db, refresh_watermarks
from services.memory_embedding_service import process_embedding_jobs_with_guard

logger = logging.getLogger(__name__)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _compute_content_hash(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _coerce_source_frame_ids(value: Any) -> List[int]:
    if not isinstance(value, list):
        return []
    ids: List[int] = []
    for item in value:
        try:
            frame_id = int(item)
            if frame_id > 0:
                ids.append(frame_id)
        except Exception:
            continue
    return ids[:400]


async def ingest_memory_chunks(
    *,
    user_id: str,
    device_id: str,
    chunks: List[Dict[str, Any]],
    process_batch_after_ingest: bool = True,
) -> Dict[str, Any]:
    accepted = 0
    deduped = 0
    failed = 0
    superseded = 0
    provider_delete_queued = 0
    now_ms = _now_ms()

    with get_memory_db() as conn:
        for chunk in chunks:
            try:
                chunk_id = _safe_text(chunk.get("chunk_id"))
                if not chunk_id:
                    failed += 1
                    continue
                logical_chunk_id = _safe_text(chunk.get("logical_chunk_id")) or chunk_id

                start_ts = int(chunk.get("chunk_start_ts") or 0)
                end_ts = int(chunk.get("chunk_end_ts") or 0)
                if start_ts <= 0 or end_ts <= 0:
                    failed += 1
                    continue
                if end_ts < start_ts:
                    start_ts, end_ts = end_ts, start_ts

                app_name = _safe_text(chunk.get("app_name"))
                window_title = _safe_text(chunk.get("window_title"))
                browser_domain = _safe_text(chunk.get("browser_domain"))
                text_compact = _safe_text(chunk.get("text_compact"))

                if not text_compact:
                    # No hard drops: fallback to contextual text.
                    text_compact = " | ".join(
                        [v for v in [app_name, window_title, browser_domain] if v]
                    ).strip()
                    if not text_compact:
                        failed += 1
                        continue

                quality_score = float(chunk.get("quality_score") or 0.0)
                quality_score = max(0.0, min(1.0, quality_score))
                source_frame_ids = _coerce_source_frame_ids(chunk.get("source_frame_ids"))

                hash_payload = {
                    "user_id": user_id,
                    "device_id": device_id,
                    "chunk_id": chunk_id,
                    "logical_chunk_id": logical_chunk_id,
                    "chunk_start_ts": start_ts,
                    "chunk_end_ts": end_ts,
                    "app_name": app_name,
                    "window_title": window_title,
                    "browser_domain": browser_domain,
                    "text_compact": text_compact,
                    "quality_score": quality_score,
                    "source_frame_ids": source_frame_ids,
                }
                content_hash = _safe_text(chunk.get("content_hash")) or _compute_content_hash(hash_payload)

                existing_rows = conn.execute(
                    """
                    SELECT id, content_hash, provider_doc_id
                    FROM memory_chunks
                    WHERE user_id = ?
                      AND device_id = ?
                      AND logical_chunk_id = ?
                      AND deleted_at IS NULL
                    ORDER BY id DESC
                    """,
                    (user_id, device_id, logical_chunk_id),
                ).fetchall()
                if existing_rows:
                    if any(_safe_text(row["content_hash"]) == content_hash for row in existing_rows):
                        deduped += 1
                        continue

                    for existing_row in existing_rows:
                        previous_chunk_pk = int(existing_row["id"] or 0)
                        conn.execute(
                            """
                            UPDATE memory_chunks
                            SET deleted_at = ?,
                                embedding_status = 'superseded',
                                updated_at = ?
                            WHERE id = ?
                            """,
                            (now_ms, now_ms, previous_chunk_pk),
                        )
                        conn.execute(
                            "DELETE FROM memory_embedding_jobs WHERE chunk_pk = ?",
                            (previous_chunk_pk,),
                        )
                        superseded += 1

                        provider_doc_id = _safe_text(existing_row["provider_doc_id"])
                        if provider_doc_id:
                            provider_cursor = conn.execute(
                                """
                                INSERT OR IGNORE INTO memory_provider_deletes (
                                    user_id,
                                    provider_doc_id,
                                    status,
                                    retry_count,
                                    next_retry_at,
                                    last_error,
                                    created_at,
                                    updated_at,
                                    deleted_at
                                ) VALUES (?, ?, 'pending', 0, NULL, NULL, ?, ?, NULL)
                                """,
                                (user_id, provider_doc_id, now_ms, now_ms),
                            )
                            if provider_cursor.rowcount > 0:
                                provider_delete_queued += 1

                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO memory_chunks (
                        user_id,
                        device_id,
                        chunk_id,
                        logical_chunk_id,
                        chunk_start_ts,
                        chunk_end_ts,
                        app_name,
                        window_title,
                        browser_domain,
                        text_compact,
                        quality_score,
                        source_frame_ids_json,
                        content_hash,
                        embedding_status,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
                    """,
                    (
                        user_id,
                        device_id,
                        chunk_id,
                        logical_chunk_id,
                        start_ts,
                        end_ts,
                        app_name,
                        window_title,
                        browser_domain,
                        text_compact,
                        quality_score,
                        json.dumps(source_frame_ids),
                        content_hash,
                        now_ms,
                        now_ms,
                    ),
                )

                if cursor.rowcount == 0:
                    deduped += 1
                    continue

                chunk_pk = int(cursor.lastrowid)
                conn.execute(
                    """
                    INSERT OR IGNORE INTO memory_embedding_jobs (
                        chunk_pk,
                        status,
                        retry_count,
                        created_at,
                        updated_at
                    ) VALUES (?, 'pending', 0, ?, ?)
                    """,
                    (chunk_pk, now_ms, now_ms),
                )
                accepted += 1
            except Exception as exc:
                logger.warning("Failed to ingest chunk: %s", exc)
                failed += 1

        conn.execute(
            """
            UPDATE memory_pipeline_watermarks
            SET last_ingest_ts = ?,
                updated_at = ?
            WHERE id = 1
            """,
            (now_ms, now_ms),
        )
        refresh_watermarks(conn)

    embedding_result = None
    if process_batch_after_ingest and accepted > 0:
        batch_size = min(max(accepted, 8), 128)
        embedding_result = await process_embedding_jobs_with_guard(batch_size=batch_size)

    return {
        "accepted": accepted,
        "deduped": deduped,
        "failed": failed,
        "superseded": superseded,
        "provider_delete_queued": provider_delete_queued,
        "retry_after_seconds": 15 if failed > 0 else 0,
        "embedding_batch": embedding_result,
    }
