"""
Canonical embedding pipeline: activity.db session_retrieval_docs → OpenAI → Turbopuffer.

This service reads session docs directly from activity.db, embeds them with OpenAI,
and upserts to Turbopuffer in one pass. Local OCR chunking and local vector indexing
are no longer part of the primary chat/search architecture.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
import time
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

from services.memory_turbopuffer_service import TurbopufferService
from services.watcher_service_local_db import open_activity_connection_for_user

logger = logging.getLogger(__name__)

BATCH_SIZE = 32
EMBED_MODEL = "text-embedding-3-small"
# Minimum text length to embed — skip near-empty session docs
MIN_TEXT_LENGTH = 40


def _now_ms() -> int:
    return int(time.time() * 1000)


def _openai_client() -> AsyncOpenAI:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return AsyncOpenAI(api_key=api_key)


def _embed_model() -> str:
    return (os.getenv("OPENAI_EMBED_MODEL") or EMBED_MODEL).strip()


def _make_doc_id(user_id: str, session_id: int, content_hash: str) -> str:
    raw = f"{user_id}:session:{session_id}:{content_hash}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _ensure_tracking_column(conn: sqlite3.Connection) -> None:
    """Add embedded_at column to session_retrieval_docs if it doesn't exist."""
    try:
        conn.execute("SELECT embedded_at FROM session_retrieval_docs LIMIT 0")
    except sqlite3.OperationalError:
        conn.execute(
            "ALTER TABLE session_retrieval_docs ADD COLUMN embedded_at INTEGER DEFAULT NULL"
        )
        conn.commit()


def _fetch_unembedded(conn: sqlite3.Connection, batch_size: int) -> List[Dict[str, Any]]:
    """Fetch session docs that haven't been embedded yet.

    JOINs to context_snapshots to pick up the best document_path and
    ax_richness_score for each session (highest richness snapshot wins).
    """
    # Check if context_snapshots table exists for the JOIN
    has_snapshots = False
    try:
        conn.execute("SELECT 1 FROM context_snapshots LIMIT 0")
        has_snapshots = True
    except Exception:
        pass

    if has_snapshots:
        cursor = conn.execute(
            """
            SELECT
                s.id,
                s.session_id,
                s.device_id,
                s.user_id,
                s.source_kind,
                s.chunk_start_ts,
                s.chunk_end_ts,
                s.app_name,
                s.browser_domain,
                s.window_title,
                s.document_title,
                s.raw_visible_text,
                s.contextual_retrieval_text,
                s.capture_quality,
                s.context_version,
                s.session_position,
                s.session_count,
                cs.document_path,
                cs.ax_richness_score,
                cs.semantic_summary
            FROM session_retrieval_docs s
            LEFT JOIN (
                SELECT session_id,
                       document_path,
                       ax_richness_score,
                       semantic_summary,
                       ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ax_richness_score DESC) as rn
                FROM context_snapshots
                WHERE (document_path IS NOT NULL AND document_path != '')
                   OR (semantic_summary IS NOT NULL AND semantic_summary != '')
            ) cs ON cs.session_id = s.session_id AND cs.rn = 1
            WHERE s.embedded_at IS NULL
              AND length(COALESCE(s.contextual_retrieval_text, s.raw_visible_text, '')) > ?
              AND COALESCE(s.app_name, '') NOT IN ('loginwindow', 'ScreenSaverEngine', '')
            ORDER BY s.chunk_end_ts DESC
            LIMIT ?
            """,
            (MIN_TEXT_LENGTH, batch_size),
        )
    else:
        cursor = conn.execute(
            """
            SELECT
                id, session_id, device_id, user_id, source_kind,
                chunk_start_ts, chunk_end_ts, app_name, browser_domain,
                window_title, document_title, raw_visible_text,
                contextual_retrieval_text, capture_quality, context_version,
                session_position, session_count,
                NULL as document_path, 0.0 as ax_richness_score, NULL as semantic_summary
            FROM session_retrieval_docs
            WHERE embedded_at IS NULL
              AND length(COALESCE(contextual_retrieval_text, raw_visible_text, '')) > ?
              AND COALESCE(app_name, '') NOT IN ('loginwindow', 'ScreenSaverEngine', '')
            ORDER BY chunk_end_ts DESC
            LIMIT ?
            """,
            (MIN_TEXT_LENGTH, batch_size),
        )
    return [dict(row) for row in cursor.fetchall()]


def _build_embed_text(doc: Dict[str, Any]) -> str:
    """Build the text string to embed for a session doc."""
    parts = []
    app = str(doc.get("app_name") or "").strip()
    window = str(doc.get("window_title") or "").strip()
    domain = str(doc.get("browser_domain") or "").strip()
    doc_title = str(doc.get("document_title") or "").strip()

    if app:
        parts.append(f"App: {app}")
    if window:
        parts.append(f"Window: {window}")
    if domain:
        parts.append(f"Domain: {domain}")
    if doc_title and doc_title != window:
        parts.append(f"Document: {doc_title}")

    header = " | ".join(parts) if parts else ""

    semantic_summary = str(doc.get("semantic_summary") or "").strip()
    contextual_text = str(doc.get("contextual_retrieval_text") or "").strip()
    raw_text = str(doc.get("raw_visible_text") or "").strip()

    body_parts: List[str] = []
    if semantic_summary:
        body_parts.append(
            semantic_summary if semantic_summary.endswith(".") else f"{semantic_summary}."
        )
    if contextual_text:
        body_parts.append(contextual_text)
    elif raw_text:
        body_parts.append(raw_text)
    body = "\n\n".join(part for part in body_parts if part).strip()

    # Truncate to ~2000 chars for embedding (model handles up to 8191 tokens)
    if header and body:
        return f"{header}\n{body[:2000]}"
    return (header or body)[:2000]


def _extract_parent_context(doc: Dict[str, Any]) -> str:
    """Extract a parent context string from the contextual_retrieval_text."""
    text = str(doc.get("contextual_retrieval_text") or "").strip()
    if not text.lower().startswith("context:"):
        return ""
    context_text = text[len("Context:"):].strip()
    if "|" in context_text:
        context_text = context_text.split("|", 1)[0].strip()
    return context_text[:240]


async def process_session_embeddings(user_id: str, batch_size: int = BATCH_SIZE) -> Dict[str, Any]:
    """
    Main entry point: fetch unembedded session docs from activity.db,
    embed with OpenAI, upsert to Turbopuffer.

    Returns stats about what was processed.
    """
    start_time = time.time()
    now_ms = _now_ms()

    tp = TurbopufferService()
    if not tp.configured:
        return {
            "processed": 0,
            "failed": 0,
            "remaining": 0,
            "error": "Turbopuffer is not configured (TURBOPUFFER_API_KEY)",
        }

    async with open_activity_connection_for_user(user_id, write=True) as conn:
        if conn is None:
            return {
                "processed": 0,
                "failed": 0,
                "remaining": 0,
                "error": "No activity database is available for this user",
            }
        conn.row_factory = sqlite3.Row
        _ensure_tracking_column(conn)
        docs = _fetch_unembedded(conn, batch_size)

        if not docs:
            remaining = conn.execute(
                """SELECT COUNT(*) FROM session_retrieval_docs
                   WHERE embedded_at IS NULL
                     AND length(COALESCE(contextual_retrieval_text, raw_visible_text, '')) > ?""",
                (MIN_TEXT_LENGTH,),
            ).fetchone()[0]
            return {
                "processed": 0,
                "failed": 0,
                "remaining": remaining,
                "elapsed_ms": int((time.time() - start_time) * 1000),
            }

        # Build texts for embedding
        texts = [_build_embed_text(doc) for doc in docs]

        # Embed in one batch call
        client = _openai_client()
        try:
            response = await client.embeddings.create(
                model=_embed_model(),
                input=texts,
            )
        except Exception as exc:
            return {
                "processed": 0,
                "failed": len(docs),
                "remaining": -1,
                "error": f"OpenAI embedding failed: {exc}",
                "elapsed_ms": int((time.time() - start_time) * 1000),
            }

        vectors = {idx: list(emb.embedding) for idx, emb in enumerate(response.data)}

        # Upsert each to Turbopuffer
        processed = 0
        failed = 0
        for idx, doc in enumerate(docs):
            vector = vectors.get(idx)
            if not vector:
                failed += 1
                continue

            user_id = str(doc.get("user_id") or "unknown")
            session_id = int(doc.get("session_id") or doc.get("id") or 0)
            text = texts[idx]
            c_hash = _content_hash(text)
            doc_id = _make_doc_id(user_id, session_id, c_hash)

            # Turbopuffer has a 4096-byte limit on filterable string attributes.
            # Truncate to 1200 chars (~3600 bytes worst case for UTF-8).
            TP_ATTR_LIMIT = 1200
            raw_text = str(doc.get("raw_visible_text") or "").strip()[:TP_ATTR_LIMIT]
            ctx_text = str(doc.get("contextual_retrieval_text") or "").strip()[:TP_ATTR_LIMIT]
            quality = float(doc.get("capture_quality") or 0.0)
            quality = max(0.0, min(1.0, quality))

            doc_path = str(doc.get("document_path") or "").strip()
            ax_richness = float(doc.get("ax_richness_score") or 0.0)

            try:
                await tp.upsert_chunk(
                    user_id=user_id,
                    doc_id=doc_id,
                    vector=vector,
                    attributes={
                        "user_id": user_id,
                        "device_id": str(doc.get("device_id") or ""),
                        "chunk_id": f"session-{session_id}",
                        "logical_chunk_id": f"session-{session_id}",
                        "chunk_start_ts": int(doc.get("chunk_start_ts") or 0),
                        "chunk_end_ts": int(doc.get("chunk_end_ts") or 0),
                        "source_kind": str(doc.get("source_kind") or "context_session"),
                        "session_id": str(session_id),
                        "app_name": str(doc.get("app_name") or ""),
                        "window_title": str(doc.get("window_title") or ""),
                        "document_title": str(doc.get("document_title") or ""),
                        "document_path": doc_path[:500] if doc_path else "",
                        "browser_domain": str(doc.get("browser_domain") or ""),
                        "ax_richness_score": ax_richness,
                        "text_compact": (ctx_text or raw_text)[:TP_ATTR_LIMIT],
                        "raw_text_compact": raw_text[:TP_ATTR_LIMIT],
                        "contextual_text_compact": (ctx_text or raw_text)[:TP_ATTR_LIMIT],
                        "raw_visible_text": raw_text[:TP_ATTR_LIMIT],
                        "contextual_retrieval_text": ctx_text[:TP_ATTR_LIMIT],
                        "parent_context": _extract_parent_context(doc)[:240],
                        "context_version": int(doc.get("context_version") or 1),
                        "session_key": str(session_id),
                        "session_position": int(doc.get("session_position") or 0),
                        "session_chunk_count": int(doc.get("session_count") or 1),
                        "session_count": int(doc.get("session_count") or 1),
                        "quality_score": quality,
                        "capture_quality": quality,
                        "content_hash": c_hash,
                        "active": 1,
                    },
                )
                # Mark as embedded
                conn.execute(
                    "UPDATE session_retrieval_docs SET embedded_at = ? WHERE id = ?",
                    (now_ms, doc["id"]),
                )
                processed += 1
            except Exception as exc:
                logger.warning(
                    "Failed to upsert session doc %s to Turbopuffer: %s",
                    session_id,
                    exc,
                )
                failed += 1
                # Mark as embedded with negative value so it's skipped but trackable
                conn.execute(
                    "UPDATE session_retrieval_docs SET embedded_at = -1 WHERE id = ?",
                    (doc["id"],),
                )

        conn.commit()

        remaining = conn.execute(
            """SELECT COUNT(*) FROM session_retrieval_docs
               WHERE embedded_at IS NULL
                 AND length(COALESCE(contextual_retrieval_text, raw_visible_text, '')) > ?""",
            (MIN_TEXT_LENGTH,),
        ).fetchone()[0]

        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.info(
            "Session embedding: processed=%d failed=%d remaining=%d elapsed=%dms",
            processed, failed, remaining, elapsed_ms,
        )

        return {
            "processed": processed,
            "failed": failed,
            "remaining": remaining,
            "elapsed_ms": elapsed_ms,
        }


async def get_embedding_status(user_id: str) -> Dict[str, Any]:
    """Get current status of the session embedding pipeline."""
    try:
        async with open_activity_connection_for_user(user_id, write=True) as conn:
            if conn is None:
                return {"error": "No activity database is available for this user"}
            conn.row_factory = sqlite3.Row
            _ensure_tracking_column(conn)

            total = conn.execute("SELECT COUNT(*) FROM session_retrieval_docs").fetchone()[0]
            embedded = conn.execute(
                "SELECT COUNT(*) FROM session_retrieval_docs WHERE embedded_at IS NOT NULL"
            ).fetchone()[0]
            pending = conn.execute(
                """SELECT COUNT(*) FROM session_retrieval_docs
                   WHERE embedded_at IS NULL
                     AND length(COALESCE(contextual_retrieval_text, raw_visible_text, '')) > ?""",
                (MIN_TEXT_LENGTH,),
            ).fetchone()[0]
            skippable = total - embedded - pending

            latest_embedded = conn.execute(
                "SELECT datetime(MAX(embedded_at)/1000, 'unixepoch', 'localtime') FROM session_retrieval_docs"
            ).fetchone()[0]
            latest_session = conn.execute(
                "SELECT datetime(MAX(chunk_end_ts)/1000, 'unixepoch', 'localtime') FROM session_retrieval_docs"
            ).fetchone()[0]

        tp = TurbopufferService()
        return {
            "total_session_docs": total,
            "embedded": embedded,
            "pending": pending,
            "skippable_short_text": skippable,
            "latest_embedded_at": latest_embedded,
            "latest_session_at": latest_session,
            "turbopuffer_configured": tp.configured,
        }
    except Exception as exc:
        return {"error": str(exc)}
