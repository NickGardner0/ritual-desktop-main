"""Retention cleanup for cloud memory chunks."""

from __future__ import annotations

import os
import time
from collections import defaultdict
from typing import Any, Dict, List

from services.memory_cloud_store import get_memory_db, refresh_watermarks
from services.memory_turbopuffer_service import TurbopufferService


def _now_ms() -> int:
    return int(time.time() * 1000)


def _retention_days() -> int:
    raw = (os.getenv("RITUAL_MEMORY_RETENTION_DAYS") or "90").strip()
    try:
        return max(1, min(int(raw), 3650))
    except Exception:
        return 90


def _retry_delay_ms(retry_count: int) -> int:
    base = [15_000, 30_000, 60_000, 120_000, 240_000, 600_000]
    idx = min(max(retry_count, 0), len(base) - 1)
    return base[idx]


async def run_memory_retention_once(limit: int = 2000) -> Dict[str, Any]:
    safe_limit = max(1, min(int(limit or 2000), 10000))
    now_ms = _now_ms()
    cutoff_ms = now_ms - (_retention_days() * 24 * 60 * 60 * 1000)

    rows: List[Dict[str, Any]] = []
    with get_memory_db() as conn:
        cursor = conn.execute(
            """
            SELECT id, user_id, provider_doc_id
            FROM memory_chunks
            WHERE deleted_at IS NULL
              AND chunk_end_ts < ?
            ORDER BY chunk_end_ts ASC
            LIMIT ?
            """,
            (cutoff_ms, safe_limit),
        )
        for row in cursor.fetchall() or []:
            rows.append(dict(row))

    if not rows:
        return {
            "deleted_local": 0,
            "deleted_provider": 0,
            "cutoff_ms": cutoff_ms,
            "retention_days": _retention_days(),
        }

    by_user: Dict[str, List[str]] = defaultdict(list)
    chunk_ids: List[int] = []
    for row in rows:
        chunk_ids.append(int(row["id"]))
        provider_doc_id = str(row.get("provider_doc_id") or "").strip()
        if provider_doc_id:
            by_user[str(row.get("user_id") or "")].append(provider_doc_id)

    tp = TurbopufferService()
    deleted_provider = 0
    if tp.configured:
        for user_id, doc_ids in by_user.items():
            if not user_id or not doc_ids:
                continue
            await tp.delete_docs(user_id=user_id, doc_ids=doc_ids)
            deleted_provider += len(doc_ids)

    with get_memory_db() as conn:
        conn.executemany(
            "DELETE FROM memory_embedding_jobs WHERE chunk_pk = ?",
            [(chunk_id,) for chunk_id in chunk_ids],
        )
        conn.executemany(
            "DELETE FROM memory_chunks WHERE id = ?",
            [(chunk_id,) for chunk_id in chunk_ids],
        )
        refresh_watermarks(conn)

    return {
        "deleted_local": len(chunk_ids),
        "deleted_provider": deleted_provider,
        "cutoff_ms": cutoff_ms,
        "retention_days": _retention_days(),
    }


async def reconcile_superseded_provider_docs(limit: int = 500) -> Dict[str, Any]:
    safe_limit = max(1, min(int(limit or 500), 5000))
    now_ms = _now_ms()
    tp = TurbopufferService()

    rows: List[Dict[str, Any]] = []
    with get_memory_db() as conn:
        cursor = conn.execute(
            """
            SELECT id, user_id, provider_doc_id, retry_count
            FROM memory_provider_deletes
            WHERE status IN ('pending', 'failed')
              AND COALESCE(next_retry_at, 0) <= ?
              AND deleted_at IS NULL
            ORDER BY updated_at ASC, id ASC
            LIMIT ?
            """,
            (now_ms, safe_limit),
        )
        for row in cursor.fetchall() or []:
            rows.append(dict(row))

    if not rows:
        return {"selected": 0, "deleted_provider": 0, "failed": 0}

    by_user: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        user_id = str(row.get("user_id") or "").strip()
        if not user_id:
            continue
        by_user[user_id].append(row)

    deleted_provider = 0
    failed = 0
    with get_memory_db() as conn:
        for user_id, user_rows in by_user.items():
            doc_ids = [
                str(row.get("provider_doc_id") or "").strip()
                for row in user_rows
                if str(row.get("provider_doc_id") or "").strip()
            ]
            if not doc_ids:
                continue

            if tp.configured:
                try:
                    await tp.delete_docs(user_id=user_id, doc_ids=doc_ids)
                    deleted_provider += len(doc_ids)
                    conn.executemany(
                        """
                        UPDATE memory_provider_deletes
                        SET status = 'deleted',
                            last_error = NULL,
                            next_retry_at = NULL,
                            deleted_at = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        [(now_ms, now_ms, int(row["id"])) for row in user_rows],
                    )
                except Exception as exc:
                    failed += len(doc_ids)
                    for row in user_rows:
                        retry_count = int(row.get("retry_count") or 0) + 1
                        next_retry_at = now_ms + _retry_delay_ms(retry_count)
                        conn.execute(
                            """
                            UPDATE memory_provider_deletes
                            SET status = 'failed',
                                retry_count = ?,
                                next_retry_at = ?,
                                last_error = ?,
                                updated_at = ?
                            WHERE id = ?
                            """,
                            (
                                retry_count,
                                next_retry_at,
                                str(exc)[:400],
                                now_ms,
                                int(row["id"]),
                            ),
                        )
            else:
                # Keep queue intact while provider is disabled.
                failed += len(doc_ids)

    return {
        "selected": len(rows),
        "deleted_provider": deleted_provider,
        "failed": failed,
    }
