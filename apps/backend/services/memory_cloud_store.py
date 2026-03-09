"""Local persistence for cloud-memory ingestion/index queue state."""

from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List


def is_memory_cloud_enabled() -> bool:
    raw = (os.getenv("RITUAL_MEMORY_CLOUD_ENABLED") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def memory_cloud_db_path() -> str:
    configured = (os.getenv("RITUAL_MEMORY_DB_PATH") or "").strip()
    if configured:
        return configured
    backend_root = Path(__file__).resolve().parents[1]
    return str(backend_root / ".memory_cloud.db")


def _now_ms() -> int:
    return int(time.time() * 1000)


@contextmanager
def get_memory_db() -> sqlite3.Connection:
    path = memory_cloud_db_path()
    conn = sqlite3.connect(path, timeout=10.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    ensure_memory_cloud_schema(conn)
    try:
        yield conn
    finally:
        conn.close()


def ensure_memory_cloud_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS memory_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            chunk_id TEXT NOT NULL,
            logical_chunk_id TEXT,
            chunk_start_ts INTEGER NOT NULL,
            chunk_end_ts INTEGER NOT NULL,
            app_name TEXT,
            window_title TEXT,
            browser_domain TEXT,
            text_compact TEXT NOT NULL,
            raw_text_compact TEXT NOT NULL DEFAULT '',
            contextual_text_compact TEXT NOT NULL DEFAULT '',
            context_version INTEGER NOT NULL DEFAULT 1,
            session_key TEXT,
            session_position INTEGER NOT NULL DEFAULT 0,
            session_chunk_count INTEGER NOT NULL DEFAULT 1,
            quality_score REAL NOT NULL DEFAULT 0.0,
            source_frame_ids_json TEXT,
            content_hash TEXT NOT NULL,
            provider_doc_id TEXT,
            embedding_status TEXT NOT NULL DEFAULT 'pending',
            embedded_at INTEGER,
            deleted_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_chunks_dedupe
        ON memory_chunks(user_id, device_id, chunk_id, content_hash);

        CREATE INDEX IF NOT EXISTS idx_memory_chunks_user_time
        ON memory_chunks(user_id, chunk_start_ts, chunk_end_ts);

        CREATE INDEX IF NOT EXISTS idx_memory_chunks_provider_doc_id
        ON memory_chunks(provider_doc_id);

        CREATE TABLE IF NOT EXISTS memory_embedding_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chunk_pk INTEGER NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            next_retry_at INTEGER,
            last_error TEXT,
            last_attempt_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (chunk_pk) REFERENCES memory_chunks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_memory_embedding_jobs_status_next
        ON memory_embedding_jobs(status, next_retry_at, updated_at);

        CREATE TABLE IF NOT EXISTS memory_pipeline_watermarks (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_ingest_ts INTEGER,
            last_embed_ts INTEGER,
            last_upsert_ts INTEGER,
            pending_jobs INTEGER NOT NULL DEFAULT 0,
            failed_jobs INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_query_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL,
            retrieval_tier TEXT NOT NULL,
            grounded INTEGER NOT NULL DEFAULT 0,
            citations_count INTEGER NOT NULL DEFAULT 0,
            rerank_provider TEXT NOT NULL DEFAULT 'none',
            latency_ms INTEGER NOT NULL DEFAULT 0,
            error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_memory_query_observations_ts
        ON memory_query_observations(ts_ms);

        CREATE TABLE IF NOT EXISTS memory_provider_deletes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            provider_doc_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            next_retry_at INTEGER,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER,
            UNIQUE(user_id, provider_doc_id)
        );

        CREATE INDEX IF NOT EXISTS idx_memory_provider_deletes_status_next
        ON memory_provider_deletes(status, next_retry_at, updated_at);
        """
    )

    # Forward-compatible migrations for existing local metadata DBs.
    _add_column_if_missing(conn, "memory_chunks", "logical_chunk_id", "TEXT")
    _add_column_if_missing(conn, "memory_chunks", "raw_text_compact", "TEXT NOT NULL DEFAULT ''")
    _add_column_if_missing(conn, "memory_chunks", "contextual_text_compact", "TEXT NOT NULL DEFAULT ''")
    _add_column_if_missing(conn, "memory_chunks", "context_version", "INTEGER NOT NULL DEFAULT 1")
    _add_column_if_missing(conn, "memory_chunks", "session_key", "TEXT")
    _add_column_if_missing(conn, "memory_chunks", "session_position", "INTEGER NOT NULL DEFAULT 0")
    _add_column_if_missing(conn, "memory_chunks", "session_chunk_count", "INTEGER NOT NULL DEFAULT 1")

    # These indexes depend on logical_chunk_id and must be created after the
    # column migration for pre-existing local DBs.
    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_memory_chunks_active_logical
        ON memory_chunks(user_id, device_id, logical_chunk_id, deleted_at, updated_at);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_chunks_dedupe_logical
        ON memory_chunks(user_id, device_id, logical_chunk_id, content_hash);
        """
    )

    # Backfill logical identity for older rows that only had chunk_id.
    conn.execute(
        """
        UPDATE memory_chunks
        SET logical_chunk_id = chunk_id
        WHERE logical_chunk_id IS NULL OR TRIM(logical_chunk_id) = ''
        """
    )
    conn.execute(
        """
        UPDATE memory_chunks
        SET raw_text_compact = text_compact
        WHERE COALESCE(TRIM(raw_text_compact), '') = ''
        """
    )
    conn.execute(
        """
        UPDATE memory_chunks
        SET contextual_text_compact = text_compact
        WHERE COALESCE(TRIM(contextual_text_compact), '') = ''
        """
    )

    now_ms = _now_ms()
    conn.execute(
        """
        INSERT OR IGNORE INTO memory_pipeline_watermarks
            (id, pending_jobs, failed_jobs, updated_at)
        VALUES
            (1, 0, 0, ?)
        """,
        (now_ms,),
    )


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    for row in rows:
        # row shape: (cid, name, type, notnull, dflt_value, pk)
        if len(row) >= 2 and str(row[1]) == column:
            return True
    return False


def _add_column_if_missing(
    conn: sqlite3.Connection, table: str, column: str, definition: str
) -> None:
    if _column_exists(conn, table, column):
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def refresh_watermarks(conn: sqlite3.Connection) -> None:
    now_ms = _now_ms()
    pending = conn.execute(
        "SELECT COUNT(*) FROM memory_embedding_jobs WHERE status IN ('pending', 'processing')"
    ).fetchone()[0]
    failed = conn.execute(
        "SELECT COUNT(*) FROM memory_embedding_jobs WHERE status = 'failed'"
    ).fetchone()[0]
    conn.execute(
        """
        UPDATE memory_pipeline_watermarks
        SET pending_jobs = ?,
            failed_jobs = ?,
            updated_at = ?
        WHERE id = 1
        """,
        (int(pending or 0), int(failed or 0), now_ms),
    )


def record_memory_query_observation(
    *,
    retrieval_tier: str,
    grounded: bool,
    citations_count: int,
    rerank_provider: str,
    latency_ms: int,
    error: str | None,
) -> None:
    now_ms = _now_ms()
    with get_memory_db() as conn:
        conn.execute(
            """
            INSERT INTO memory_query_observations (
                ts_ms,
                retrieval_tier,
                grounded,
                citations_count,
                rerank_provider,
                latency_ms,
                error
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                now_ms,
                str(retrieval_tier or "unavailable"),
                1 if grounded else 0,
                max(0, int(citations_count or 0)),
                str(rerank_provider or "none"),
                max(0, int(latency_ms or 0)),
                (str(error)[:300] if error else None),
            ),
        )


def _percentile(sorted_values: List[int], percentile: float) -> int:
    if not sorted_values:
        return 0
    if percentile <= 0:
        return int(sorted_values[0])
    if percentile >= 100:
        return int(sorted_values[-1])
    rank = int(round((percentile / 100.0) * (len(sorted_values) - 1)))
    rank = max(0, min(rank, len(sorted_values) - 1))
    return int(sorted_values[rank])


def get_memory_query_observability(window_minutes: int = 60) -> Dict[str, Any]:
    safe_window_minutes = max(1, min(int(window_minutes or 60), 24 * 60))
    since_ms = _now_ms() - (safe_window_minutes * 60 * 1000)
    with get_memory_db() as conn:
        rows = conn.execute(
            """
            SELECT retrieval_tier, grounded, citations_count, rerank_provider, latency_ms, error
            FROM memory_query_observations
            WHERE ts_ms >= ?
            ORDER BY ts_ms DESC
            """,
            (since_ms,),
        ).fetchall()

    total = len(rows)
    tier_counts: Dict[str, int] = {}
    rerank_provider_counts: Dict[str, int] = {}
    grounded_count = 0
    error_count = 0
    lock_error_count = 0
    total_citations = 0
    latencies: List[int] = []

    for row in rows:
        retrieval_tier = str(row["retrieval_tier"] or "unavailable")
        tier_counts[retrieval_tier] = tier_counts.get(retrieval_tier, 0) + 1

        rerank_provider = str(row["rerank_provider"] or "none")
        rerank_provider_counts[rerank_provider] = rerank_provider_counts.get(rerank_provider, 0) + 1

        grounded = int(row["grounded"] or 0) > 0
        if grounded:
            grounded_count += 1

        citations = max(0, int(row["citations_count"] or 0))
        total_citations += citations

        latency = max(0, int(row["latency_ms"] or 0))
        latencies.append(latency)

        error_text = str(row["error"] or "").strip().lower()
        if error_text:
            error_count += 1
            if "database is locked" in error_text or "database busy" in error_text:
                lock_error_count += 1

    latencies.sort()
    return {
        "window_minutes": safe_window_minutes,
        "total_queries": total,
        "grounded_query_rate": round((grounded_count / total), 4) if total else 0.0,
        "error_rate": round((error_count / total), 4) if total else 0.0,
        "lock_error_rate": round((lock_error_count / total), 4) if total else 0.0,
        "avg_citations_per_query": round((total_citations / total), 3) if total else 0.0,
        "retrieval_tier_counts": tier_counts,
        "rerank_provider_counts": rerank_provider_counts,
        "latency_ms": {
            "p50": _percentile(latencies, 50),
            "p95": _percentile(latencies, 95),
            "max": int(latencies[-1]) if latencies else 0,
        },
    }
