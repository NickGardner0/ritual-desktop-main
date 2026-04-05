"""Backfill cloud-memory chunks from local session_retrieval_docs."""

from __future__ import annotations

import logging
import sqlite3
from typing import Any, Dict, List, Optional

from services.memory_embedding_service import process_embedding_jobs_with_guard
from services.memory_ingest_service import ingest_memory_chunks
from services.watcher_service_local_db import open_activity_connection_for_user

logger = logging.getLogger(__name__)


def _table_exists(cursor: sqlite3.Cursor, table_name: str) -> bool:
    cursor.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type='table' AND name=?
        LIMIT 1
        """,
        (table_name,),
    )
    return cursor.fetchone() is not None


async def backfill_cloud_from_local_chunks(
    *,
    user_id: str,
    device_id_override: Optional[str] = None,
    limit: int = 5000,
    batch_size: int = 200,
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None,
) -> Dict[str, Any]:
    safe_limit = max(1, min(int(limit or 5000), 20000))
    safe_batch_size = max(1, min(int(batch_size or 200), 500))

    rows: List[sqlite3.Row] = []
    async with open_activity_connection_for_user(user_id=user_id, write=False) as conn:
        if conn is None:
            return {
                "success": False,
                "error": "Unable to open activity database for user",
                "accepted": 0,
                "deduped": 0,
                "failed": 0,
                "processed_batches": 0,
            }
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("PRAGMA query_only = ON")

        has_session_docs = _table_exists(cursor, "session_retrieval_docs")
        if not has_session_docs:
            return {
                "success": False,
                "error": "No session_retrieval_docs table found in activity DB",
                "accepted": 0,
                "deduped": 0,
                "failed": 0,
                "processed_batches": 0,
            }

        where_parts = []
        params: List[Any] = []
        if start_ms is not None:
            where_parts.append("chunk_end_ts >= ?")
            params.append(int(start_ms))
        if end_ms is not None:
            where_parts.append("chunk_start_ts <= ?")
            params.append(int(end_ms))

        context_where = ["TRIM(COALESCE(contextual_retrieval_text, '')) != ''"]
        context_where.extend(where_parts)
        context_query = f"""
            SELECT
                -session_id AS id,
                COALESCE(device_id, '') AS device_id,
                COALESCE(user_id, '') AS chunk_user_id,
                printf('context-session-%d', session_id) AS logical_chunk_id,
                printf('context-session-%d-%d-%d', session_id, chunk_start_ts, chunk_end_ts) AS content_hash,
                chunk_start_ts,
                chunk_end_ts,
                COALESCE(app_name, '') AS app_name,
                COALESCE(window_title, '') AS window_title,
                COALESCE(document_title, '') AS document_title,
                COALESCE(browser_domain, '') AS browser_domain,
                COALESCE(raw_visible_text, '') AS raw_visible_text,
                COALESCE(contextual_retrieval_text, '') AS contextual_retrieval_text,
                COALESCE(capture_quality, 0.0) AS capture_quality,
                COALESCE(context_version, 1) AS context_version,
                COALESCE(session_position, 0) AS session_position,
                COALESCE(session_count, 1) AS session_count,
                'context_session' AS source_kind,
                CAST(session_id AS TEXT) AS session_id
            FROM session_retrieval_docs
            WHERE {" AND ".join(context_where)}
            ORDER BY chunk_end_ts DESC
            LIMIT ?
        """
        cursor.execute(context_query, tuple([*params, safe_limit]))
        rows = cursor.fetchall() or []

    accepted_total = 0
    deduped_total = 0
    failed_total = 0
    processed_batches = 0
    embedding_processed = 0
    embedding_failed = 0

    for offset in range(0, len(rows), safe_batch_size):
        batch_rows = rows[offset : offset + safe_batch_size]
        payload = []
        for row in batch_rows:
            logical_chunk_id = str(row["logical_chunk_id"] or "").strip()
            payload.append(
                {
                    "chunk_id": logical_chunk_id or f"context-session-{int(row['id'])}",
                    "logical_chunk_id": logical_chunk_id or f"context-session-{int(row['id'])}",
                    "chunk_start_ts": int(row["chunk_start_ts"] or 0),
                    "chunk_end_ts": int(row["chunk_end_ts"] or 0),
                    "source_kind": str(row["source_kind"] or "context_session"),
                    "session_id": str(row["session_id"] or ""),
                    "app_name": str(row["app_name"] or ""),
                    "window_title": str(row["window_title"] or ""),
                    "document_title": str(row["document_title"] or ""),
                    "browser_domain": str(row["browser_domain"] or ""),
                    "text_compact": str(row["contextual_retrieval_text"] or ""),
                    "raw_visible_text": str(row["raw_visible_text"] or ""),
                    "contextual_retrieval_text": str(row["contextual_retrieval_text"] or ""),
                    "context_version": int(row["context_version"] or 1),
                    "session_position": int(row["session_position"] or 0),
                    "session_count": int(row["session_count"] or 1),
                    "quality_score": float(row["capture_quality"] or 0.0),
                    "capture_quality": float(row["capture_quality"] or 0.0),
                    "source_frame_ids": [],
                    "content_hash": str(row["content_hash"] or ""),
                }
            )

        batch_device = device_id_override or str(batch_rows[0]["device_id"] or "local-device")
        result = await ingest_memory_chunks(
            user_id=user_id,
            device_id=batch_device,
            chunks=payload,
            process_batch_after_ingest=False,
        )
        accepted_total += int(result.get("accepted") or 0)
        deduped_total += int(result.get("deduped") or 0)
        failed_total += int(result.get("failed") or 0)
        processed_batches += 1

        # Push larger embedding batches during explicit catch-up backfills.
        embed_result = await process_embedding_jobs_with_guard(batch_size=min(512, max(64, len(payload))))
        embedding_processed += int(embed_result.get("processed") or 0)
        embedding_failed += int(embed_result.get("failed") or 0)

    return {
        "success": True,
        "local_chunks_scanned": len(rows),
        "accepted": accepted_total,
        "deduped": deduped_total,
        "failed": failed_total,
        "processed_batches": processed_batches,
        "embedding_processed": embedding_processed,
        "embedding_failed": embedding_failed,
        "error": None,
    }
