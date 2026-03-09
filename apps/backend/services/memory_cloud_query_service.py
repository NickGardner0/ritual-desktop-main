"""Cloud semantic retrieval pipeline (Turbopuffer + rerank + OpenAI embeddings)."""

from __future__ import annotations

import asyncio
import logging
import math
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from openai import AsyncOpenAI

from services.memory_cloud_store import get_memory_db, record_memory_query_observation
from services.memory_embedding_service import (
    get_memory_index_health,
    process_embedding_jobs_freshness_first,
    process_embedding_jobs_with_guard,
)
from services.memory_query_expansion import expand_memory_query_text
from services.memory_rerank_service import rerank_candidates
from services.memory_turbopuffer_service import TurbopufferService

logger = logging.getLogger(__name__)


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


def _citation_source_text(item: Dict[str, Any]) -> str:
    return str(
        item.get("raw_text_compact")
        or item.get("text_compact")
        or item.get("contextual_text_compact")
        or ""
    ).strip()


def _time_bucket_key(ts_ms: int) -> str:
    if ts_ms <= 0:
        return "unknown"
    bucket_ms = 2 * 60 * 60 * 1000
    return str(ts_ms // bucket_ms)


def _build_recap_diversity_metrics(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    sessions = {
        str(item.get("session_key") or "").strip()
        for item in items
        if str(item.get("session_key") or "").strip()
    }
    apps = {
        str(item.get("app_name") or "").strip()
        for item in items
        if str(item.get("app_name") or "").strip()
    }
    buckets = {
        _time_bucket_key(int(item.get("chunk_end_ts") or item.get("chunk_start_ts") or 0))
        for item in items
    }
    context_versions: Dict[str, int] = {}
    for item in items:
        version = str(int(item.get("context_version") or 1))
        context_versions[version] = context_versions.get(version, 0) + 1
    return {
        "distinct_sessions": len(sessions),
        "distinct_apps": len(apps),
        "distinct_time_buckets": len([bucket for bucket in buckets if bucket != "unknown"]),
        "context_version_mix": context_versions,
    }


def _select_diverse_recap_evidence(items: List[Dict[str, Any]], target: int = 20) -> List[Dict[str, Any]]:
    if not items:
        return []

    available_buckets = [
        bucket
        for bucket in {
            _time_bucket_key(int(item.get("chunk_end_ts") or item.get("chunk_start_ts") or 0))
            for item in items
        }
        if bucket != "unknown"
    ]
    bucket_goal = min(4, len(available_buckets))
    session_counts: Dict[str, int] = {}
    app_counts: Dict[str, int] = {}
    bucket_counts: Dict[str, int] = {}
    selected: List[Dict[str, Any]] = []
    selected_ids: set[str] = set()

    def try_add(item: Dict[str, Any], require_new_bucket: bool) -> bool:
        item_id = str(item.get("doc_id") or item.get("chunk_id") or "")
        if item_id and item_id in selected_ids:
            return False
        session_key = str(item.get("session_key") or "").strip() or f"chunk:{item.get('chunk_id')}"
        app_name = str(item.get("app_name") or "").strip() or "Unknown"
        bucket = _time_bucket_key(int(item.get("chunk_end_ts") or item.get("chunk_start_ts") or 0))
        if session_counts.get(session_key, 0) >= 4:
            return False
        if app_counts.get(app_name, 0) >= 5:
            return False
        if require_new_bucket and bucket_goal > 0 and bucket != "unknown" and bucket_counts.get(bucket, 0) > 0:
            return False
        selected.append(item)
        if item_id:
            selected_ids.add(item_id)
        session_counts[session_key] = session_counts.get(session_key, 0) + 1
        app_counts[app_name] = app_counts.get(app_name, 0) + 1
        bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1
        return True

    if bucket_goal > 0:
        for item in items:
            if len(selected) >= target or len([b for b in bucket_counts if b != "unknown"]) >= bucket_goal:
                break
            try_add(item, require_new_bucket=True)

    for item in items:
        if len(selected) >= target:
            break
        try_add(item, require_new_bucket=False)

    if len(selected) < target:
        for item in items:
            if len(selected) >= target:
                break
            item_id = str(item.get("doc_id") or item.get("chunk_id") or "")
            if item_id and item_id in selected_ids:
                continue
            selected.append(item)
            if item_id:
                selected_ids.add(item_id)

    return selected[:target]


def _build_citations(items: List[Dict[str, Any]], limit: int = 8) -> List[Dict[str, Any]]:
    citations: List[Dict[str, Any]] = []
    for item in items[: max(1, limit)]:
        snippet = _citation_source_text(item)
        if len(snippet) > 420:
            snippet = f"{snippet[:420].rstrip()}..."
        citations.append(
            {
                "chunk_id": item.get("chunk_id"),
                "frame_id": None,
                "timestamp": int(item.get("chunk_end_ts") or 0) or int(item.get("chunk_start_ts") or 0),
                "app_name": item.get("app_name"),
                "window_title": item.get("window_title"),
                "session_key": item.get("session_key"),
                "context_version": int(item.get("context_version") or 1),
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
    intent: str = "auto",
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

    embed_attempted = False
    embed_succeeded = False
    embed_error: Optional[str] = None
    candidate_count_raw = 0
    candidate_count_active = 0
    rerank_input_count = 0
    rerank_items_count = 0
    final_evidence_count = 0
    distinct_sessions = 0
    distinct_apps = 0
    distinct_time_buckets = 0
    context_version_mix: Dict[str, int] = {}

    try:
        # Prioritize embedding chunks that overlap the user's query window so
        # they are available in Turbopuffer *before* we query.
        try:
            await asyncio.wait_for(
                process_embedding_jobs_freshness_first(
                    start_ms=start_ms, end_ms=end_ms, batch_size=8,
                ),
                timeout=5.0,
            )
        except Exception:
            pass

        # Then do a general small drain to keep the broader queue moving.
        try:
            await asyncio.wait_for(process_embedding_jobs_with_guard(batch_size=16), timeout=2.0)
        except Exception:
            pass

        expanded_query_text = expand_memory_query_text(query)
        query_vector: Optional[List[float]] = None
        lexical_only = False
        embed_attempted = True
        try:
            query_vector = await _embed_query(query)
            embed_succeeded = True
        except Exception:
            lexical_only = True
            embed_error = "query_embedding_failed"

        tp = TurbopufferService()
        broad_overview = intent == "broad_overview"
        raw_candidates = await tp.hybrid_candidates(
            user_id=user_id,
            query_text=expanded_query_text,
            query_vector=query_vector,
            start_ms=start_ms,
            end_ms=end_ms,
            top_k=200 if broad_overview else 120,
        )
        candidate_count_raw = len(raw_candidates)
        candidates = _filter_active_candidates(user_id=user_id, candidates=raw_candidates)
        candidate_count_active = len(candidates)

        fused = _rrf_fuse(candidates, k=60)
        rerank_input = fused[:80] if broad_overview else fused[:50]
        rerank_input_count = len(rerank_input)
        rerank_result = await rerank_candidates(
            query=query,
            candidates=rerank_input[:60] if broad_overview else rerank_input,
            top_n=min(60 if broad_overview else 50, len(rerank_input)),
        )
        rerank_items = rerank_result.get("items") if isinstance(rerank_result, dict) else []
        rerank_provider = rerank_result.get("provider") if isinstance(rerank_result, dict) else "none"
        rerank_items_count = len(rerank_items) if isinstance(rerank_items, list) else 0
        rerank_attempted = rerank_result.get("rerank_attempted", False) if isinstance(rerank_result, dict) else False
        rerank_latency_ms = rerank_result.get("rerank_latency_ms", 0) if isinstance(rerank_result, dict) else 0

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

        final_rows = (
            _select_diverse_recap_evidence(ranked_rows, target=20)
            if broad_overview
            else ranked_rows[: max(8, limit)]
        )
        diversity_metrics = _build_recap_diversity_metrics(final_rows)
        final_evidence_count = len(final_rows)
        distinct_sessions = int(diversity_metrics["distinct_sessions"])
        distinct_apps = int(diversity_metrics["distinct_apps"])
        distinct_time_buckets = int(diversity_metrics["distinct_time_buckets"])
        context_version_mix = dict(diversity_metrics["context_version_mix"])

        citations = _build_citations(final_rows, limit=20 if broad_overview else min(max(limit, 12), 20))
        confidence = _confidence_from_ranked(final_rows[: max(8, limit)])
        index_health = get_memory_index_health()

        cloud_max_embedded_ts = None
        cloud_pending_in_window = 0
        try:
            with get_memory_db() as conn:
                row = conn.execute(
                    "SELECT MAX(chunk_end_ts) FROM memory_chunks WHERE user_id = ? AND embedding_status = 'ok' AND deleted_at IS NULL",
                    (user_id,),
                ).fetchone()
                cloud_max_embedded_ts = int(row[0]) if row and row[0] is not None else None

                row2 = conn.execute(
                    """
                    SELECT COUNT(*) FROM memory_embedding_jobs j
                    JOIN memory_chunks c ON c.id = j.chunk_pk
                    WHERE c.user_id = ? AND j.status IN ('pending','processing','failed')
                      AND c.chunk_end_ts >= ? AND c.chunk_start_ts <= ?
                    """,
                    (user_id, int(start_ms), int(end_ms)),
                ).fetchone()
                cloud_pending_in_window = int(row2[0]) if row2 else 0
        except Exception:
            pass

        mode_used = "cloud-lexical" if lexical_only else "cloud-hybrid"
        if lexical_only:
            retrieval_tier = "cloud_lexical_only" if citations else "unavailable"
        else:
            retrieval_tier = "cloud_hybrid" if citations else "unavailable"
        observed_retrieval_tier = retrieval_tier
        observed_rerank_provider = str(rerank_provider or "none")
        observed_citations = len(citations)
        observed_grounded = observed_citations > 0
        debug_payload = {
            "embed_attempted": embed_attempted,
            "embed_succeeded": embed_succeeded,
            "embed_error": embed_error,
            "candidate_count_raw": candidate_count_raw,
            "candidate_count_active": candidate_count_active,
            "rerank_input_count": rerank_input_count,
            "rerank_items_count": rerank_items_count,
            "final_evidence_count": final_evidence_count,
            "distinct_sessions": distinct_sessions,
            "distinct_apps": distinct_apps,
            "distinct_time_buckets": distinct_time_buckets,
            "context_version_mix": context_version_mix,
            "raw_vs_contextual_source": "rerank=contextual_text_compact,citations=raw_text_compact",
            "rerank_provider": rerank_provider or "none",
            "query_vector_present": bool(query_vector),
            "query_window_start": start_ms,
            "query_window_end": end_ms,
            "cloud_max_embedded_ts": cloud_max_embedded_ts,
            "cloud_pending_in_window": cloud_pending_in_window,
            "rerank_attempted": rerank_attempted,
            "rerank_latency_ms": rerank_latency_ms,
        }

        semantic_truth = {
            "query": query,
            "result_count": len(citations),
            "mode_used": mode_used,
            "status": "hybrid" if citations else "unavailable",
            "highlights": citations[: min(limit if not broad_overview else 12, 12)],
            "warning": None if citations else "No cloud semantic evidence matched query in selected range.",
            "debug": debug_payload,
        }
        logger.info(
            "memory.cloud query lexical_only=%s embed_ok=%s candidates_raw=%s candidates_active=%s "
            "rerank_provider=%s rerank_items=%s rerank_attempted=%s rerank_latency_ms=%s "
            "final_evidence=%s distinct_sessions=%s distinct_apps=%s distinct_buckets=%s "
            "citations=%s tier=%s cloud_max_embedded_ts=%s cloud_pending_in_window=%s",
            lexical_only,
            embed_succeeded,
            candidate_count_raw,
            candidate_count_active,
            rerank_provider or "none",
            rerank_items_count,
            rerank_attempted,
            rerank_latency_ms,
            final_evidence_count,
            distinct_sessions,
            distinct_apps,
            distinct_time_buckets,
            len(citations),
            retrieval_tier,
            cloud_max_embedded_ts,
            cloud_pending_in_window,
        )
        return {
            "enabled": True,
            "retrieval_tier": retrieval_tier,
            "semantic_truth": semantic_truth,
            "citations": citations,
            "confidence": confidence,
            "debug": debug_payload,
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
