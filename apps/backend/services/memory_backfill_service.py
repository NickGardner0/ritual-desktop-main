"""Backfill cloud-memory chunks from local ritual.db search_chunks."""

from __future__ import annotations

import logging
import sqlite3
from typing import Any, Dict, List, Optional

from services.memory_embedding_service import process_embedding_jobs_with_guard
from services.memory_ingest_service import ingest_memory_chunks
from services.watcher_service_local_db import get_local_watcher_db_path_impl

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


def _table_columns(cursor: sqlite3.Cursor, table_name: str) -> set[str]:
    cursor.execute(f"PRAGMA table_info({table_name})")
    rows = cursor.fetchall() or []
    return {str(row[1]) for row in rows if len(row) >= 2}


async def backfill_cloud_from_local_chunks(
    *,
    user_id: str,
    device_id_override: Optional[str] = None,
    limit: int = 5000,
    batch_size: int = 200,
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None,
) -> Dict[str, Any]:
    db_path = get_local_watcher_db_path_impl()
    safe_limit = max(1, min(int(limit or 5000), 20000))
    safe_batch_size = max(1, min(int(batch_size or 200), 500))

    conn: Optional[sqlite3.Connection] = None
    rows: List[sqlite3.Row] = []
    try:
        conn = sqlite3.connect(
            f"file:{db_path}?mode=ro",
            uri=True,
            timeout=3.0,
        )
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("PRAGMA query_only = ON")

        if not _table_exists(cursor, "search_chunks"):
            return {
                "success": False,
                "error": "search_chunks table not found in local ritual.db",
                "accepted": 0,
                "deduped": 0,
                "failed": 0,
                "processed_batches": 0,
            }

        columns = _table_columns(cursor, "search_chunks")
        has_logical_chunk_id = "logical_chunk_id" in columns
        has_content_hash = "content_hash" in columns

        where_parts = ["text_compact IS NOT NULL", "TRIM(text_compact) != ''"]
        params: List[Any] = []
        if start_ms is not None:
            where_parts.append("chunk_end_ts >= ?")
            params.append(int(start_ms))
        if end_ms is not None:
            where_parts.append("chunk_start_ts <= ?")
            params.append(int(end_ms))

        where_sql = " AND ".join(where_parts)
        logical_expr = (
            "COALESCE(NULLIF(logical_chunk_id, ''), printf('local-search-chunk-%d', id)) AS logical_chunk_id"
            if has_logical_chunk_id
            else "printf('local-search-chunk-%d', id) AS logical_chunk_id"
        )
        content_hash_expr = (
            "COALESCE(NULLIF(content_hash, ''), printf('legacy-%d-%d-%d', id, chunk_start_ts, chunk_end_ts)) AS content_hash"
            if has_content_hash
            else "printf('legacy-%d-%d-%d', id, chunk_start_ts, chunk_end_ts) AS content_hash"
        )
        query = f"""
            SELECT
                id,
                COALESCE(device_id, '') AS device_id,
                COALESCE(user_id, '') AS chunk_user_id,
                {logical_expr},
                {content_hash_expr},
                chunk_start_ts,
                chunk_end_ts,
                COALESCE(app_name, '') AS app_name,
                COALESCE(window_title_norm, '') AS window_title,
                COALESCE(browser_domain, '') AS browser_domain,
                COALESCE(text_compact, '') AS text_compact,
                COALESCE(quality_score, 0.0) AS quality_score
            FROM search_chunks
            WHERE {where_sql}
            ORDER BY chunk_end_ts DESC
            LIMIT ?
        """
        params.append(safe_limit)
        cursor.execute(query, tuple(params))
        rows = cursor.fetchall() or []
    finally:
        if conn is not None:
            conn.close()

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
                    "chunk_id": logical_chunk_id or f"local-search-chunk-{int(row['id'])}",
                    "logical_chunk_id": logical_chunk_id or f"local-search-chunk-{int(row['id'])}",
                    "chunk_start_ts": int(row["chunk_start_ts"] or 0),
                    "chunk_end_ts": int(row["chunk_end_ts"] or 0),
                    "app_name": str(row["app_name"] or ""),
                    "window_title": str(row["window_title"] or ""),
                    "browser_domain": str(row["browser_domain"] or ""),
                    "text_compact": str(row["text_compact"] or ""),
                    "quality_score": float(row["quality_score"] or 0.0),
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
