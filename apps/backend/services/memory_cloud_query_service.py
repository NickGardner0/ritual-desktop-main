"""Cloud semantic retrieval pipeline (Turbopuffer + rerank + OpenAI embeddings)."""

from __future__ import annotations

import asyncio
import math
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from openai import AsyncOpenAI

from services.memory_cloud_store import get_memory_db, record_memory_query_observation
from services.memory_embedding_service import get_memory_index_health, process_embedding_jobs_with_guard
from services.memory_query_expansion import expand_memory_query_text
from services.memory_rerank_service import rerank_candidates
from services.memory_turbopuffer_service import TurbopufferService


def memory_cloud_enabled() -> bool:
    raw = (os.getenv("RITUAL_MEMORY_CLOUD_ENABLED") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def memory_fail_closed() -> bool:
    raw = (os.getenv("RITUAL_MEMORY_FAIL_CLOSED") or "true").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _embed_model() -> str:
    return (os.getenv("OPENAI_EMBED_MODEL") or "text-embedding-3-small").strip()


def _openai_client() -> AsyncOpenAI:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return AsyncOpenAI(api_key=api_key)


async def _embed_query(query: str) -> List[float]:
    client = _openai_client()
    emb = await client.embeddings.create(model=_embed_model(), input=[query])
    return list(emb.data[0].embedding)


def _filter_active_candidates(user_id: str, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not candidates:
        return []
    doc_ids = [str(item.get("doc_id") or "").strip() for item in candidates]
    doc_ids = [doc_id for doc_id in doc_ids if doc_id]
    if not doc_ids:
        return []

    # Keep cloud retrieval grounded to currently active local versions only.
    placeholders = ",".join(["?"] * len(doc_ids))
    sql = f"""
        SELECT id, provider_doc_id, COALESCE(NULLIF(logical_chunk_id, ''), chunk_id) AS logical_chunk_id
        FROM memory_chunks
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND provider_doc_id IN ({placeholders})
        ORDER BY id DESC
    """
    with get_memory_db() as conn:
        rows = conn.execute(sql, [user_id, *doc_ids]).fetchall()
    active_doc_ids: set[str] = set()
    seen_logical: set[str] = set()
    for row in rows:
        logical_id = str(row["logical_chunk_id"] or "").strip()
        doc_id = str(row["provider_doc_id"] or "").strip()
        if not doc_id:
            continue
        dedupe_key = logical_id or doc_id
        if dedupe_key in seen_logical:
            continue
        seen_logical.add(dedupe_key)
        active_doc_ids.add(doc_id)
    if not active_doc_ids:
        return []
    return [item for item in candidates if str(item.get("doc_id") or "") in active_doc_ids]


def _rrf_fuse(items: List[Dict[str, Any]], k: int = 60) -> List[Dict[str, Any]]:
    scored: List[Dict[str, Any]] = []
    # Since Turbopuffer may already fuse internally depending on query mode,
    # we still run deterministic normalization + recency/quality boost.
    now_ms = int(time.time() * 1000)
    for idx, item in enumerate(items):
        base = float(item.get("score") or 0.0)
        quality = float(item.get("quality_score") or 0.0)
        quality_weight = max(0.2, min(1.0, quality if quality > 0 else 0.5))
        end_ts = int(item.get("chunk_end_ts") or 0)
        age_hours = max(0.0, (now_ms - end_ts) / (1000.0 * 60.0 * 60.0)) if end_ts > 0 else 9999.0
        recency_boost = max(0.0, 0.1 * (1.0 - min(age_hours / 72.0, 1.0)))
        rank_term = 1.0 / (k + idx + 1.0)
        final = (0.7 * base + 0.2 * rank_term + 0.1 * recency_boost) * quality_weight
        enriched = dict(item)
        enriched["fused_score"] = float(final)
        scored.append(enriched)
    scored.sort(key=lambda row: float(row.get("fused_score") or 0.0), reverse=True)
    return scored


def _build_citations(items: List[Dict[str, Any]], limit: int = 8) -> List[Dict[str, Any]]:
    citations: List[Dict[str, Any]] = []
    for item in items[: max(1, limit)]:
        snippet = str(item.get("text_compact") or "").strip()
        if len(snippet) > 280:
            snippet = f"{snippet[:280].rstrip()}..."
        citations.append(
            {
                "chunk_id": item.get("chunk_id"),
                "frame_id": None,
                "timestamp": int(item.get("chunk_end_ts") or 0) or int(item.get("chunk_start_ts") or 0),
                "app_name": item.get("app_name"),
                "window_title": item.get("window_title"),
                "snippet": snippet,
                "score": round(float(item.get("rerank_score") or item.get("fused_score") or 0.0), 3),
                "source": "cloud_hybrid",
                "provider_trace_id": item.get("doc_id"),
            }
        )
    return citations


def _confidence_from_ranked(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not items:
        return {
            "level": "low",
            "score": 0.0,
            "corroborating_chunks": 0,
            "reason": "No semantic evidence found in cloud index.",
        }
    top_score = float(items[0].get("rerank_score") or items[0].get("fused_score") or 0.0)
    threshold = max(0.6, top_score - 0.12)
    corroborating = len([row for row in items if float(row.get("rerank_score") or row.get("fused_score") or 0.0) >= threshold])
    if top_score >= 0.78 and corroborating >= 2:
        level = "high"
    elif top_score >= 0.60 and corroborating >= 1:
        level = "medium"
    else:
        level = "low"
    return {
        "level": level,
        "score": round(top_score, 3),
        "corroborating_chunks": int(corroborating),
        "reason": "Cloud reranked evidence score banding.",
    }


async def query_semantic_cloud(
    *,
    user_id: str,
    query: str,
    start_ms: int,
    end_ms: int,
    limit: int,
) -> Dict[str, Any]:
    """
    Cloud semantic path:
    1) embed query (OpenAI)
    2) retrieve candidates (Turbopuffer)
    3) rank fusion + rerank (Cohere primary, OpenAI fallback)
    """
    if not memory_cloud_enabled():
        return {"enabled": False}
    start_ms_wall = int(time.time() * 1000)
    observed_retrieval_tier = "unavailable"
    observed_grounded = False
    observed_citations = 0
    observed_rerank_provider = "none"
    observed_error: Optional[str] = None

    try:
        # Opportunistically process a small batch so queue keeps moving,
        # but never block query latency on backlog drain.
        try:
            # Keep query-time catch-up bounded; heavy drain belongs to explicit backfill/reconcile.
            await asyncio.wait_for(process_embedding_jobs_with_guard(batch_size=16), timeout=2.0)
        except Exception:
            pass

        expanded_query_text = expand_memory_query_text(query)
        query_vector: Optional[List[float]] = None
        lexical_only = False
        try:
            query_vector = await _embed_query(query)
        except Exception:
            lexical_only = True

        tp = TurbopufferService()
        candidates = await tp.hybrid_candidates(
            user_id=user_id,
            query_text=expanded_query_text,
            query_vector=query_vector,
            start_ms=start_ms,
            end_ms=end_ms,
            top_k=120,
        )
        candidates = _filter_active_candidates(user_id=user_id, candidates=candidates)

        fused = _rrf_fuse(candidates, k=60)
        rerank_input = fused[:50]
        rerank_result = await rerank_candidates(query=query, candidates=rerank_input, top_n=min(50, len(rerank_input)))
        rerank_items = rerank_result.get("items") if isinstance(rerank_result, dict) else []
        rerank_provider = rerank_result.get("provider") if isinstance(rerank_result, dict) else "none"

        ranked_rows: List[Dict[str, Any]] = []
        if isinstance(rerank_items, list) and rerank_items:
            for item in rerank_items:
                if not isinstance(item, (list, tuple)) or len(item) != 2:
                    continue
                idx = int(item[0])
                score = float(item[1])
                if idx < 0 or idx >= len(rerank_input):
                    continue
                row = dict(rerank_input[idx])
                row["rerank_score"] = score
                ranked_rows.append(row)
        else:
            ranked_rows = rerank_input

        citations = _build_citations(ranked_rows, limit=min(max(limit, 8), 12))
        confidence = _confidence_from_ranked(ranked_rows[: max(8, limit)])
        index_health = get_memory_index_health()

        mode_used = "cloud-lexical" if lexical_only else "cloud-hybrid"
        if lexical_only:
            retrieval_tier = "cloud_lexical_only" if citations else "unavailable"
        else:
            retrieval_tier = "cloud_hybrid" if citations else "unavailable"
        observed_retrieval_tier = retrieval_tier
        observed_rerank_provider = str(rerank_provider or "none")
        observed_citations = len(citations)
        observed_grounded = observed_citations > 0

        semantic_truth = {
            "query": query,
            "result_count": len(citations),
            "mode_used": mode_used,
            "status": "hybrid" if citations else "unavailable",
            "highlights": citations[: min(limit, 8)],
            "warning": None if citations else "No cloud semantic evidence matched query in selected range.",
        }
        return {
            "enabled": True,
            "retrieval_tier": retrieval_tier,
            "semantic_truth": semantic_truth,
            "citations": citations,
            "confidence": confidence,
            "provider_path": {
                "retrieval": "turbopuffer",
                "rerank": rerank_provider or "none",
                "answer": "openai",
            },
            "index_health": index_health,
        }
    except Exception as exc:
        observed_error = str(exc)[:300]
        raise
    finally:
        latency_ms = max(0, int(time.time() * 1000) - start_ms_wall)
        try:
            record_memory_query_observation(
                retrieval_tier=observed_retrieval_tier,
                grounded=observed_grounded,
                citations_count=observed_citations,
                rerank_provider=observed_rerank_provider,
                latency_ms=latency_ms,
                error=observed_error,
            )
        except Exception:
            pass
