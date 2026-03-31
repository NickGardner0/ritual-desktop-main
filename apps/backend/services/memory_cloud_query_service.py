"""Cloud semantic retrieval pipeline (Turbopuffer + rerank + OpenAI embeddings)."""

from __future__ import annotations

import asyncio
import logging
import math
import os
import sqlite3
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from openai import AsyncOpenAI

from services.memory_cloud_store import get_memory_db, record_memory_query_observation
from services.memory_embedding_service import (
    get_memory_index_health,
    process_embedding_jobs_freshness_first,
    process_embedding_jobs_with_guard,
)
from services.memory_query_expansion import ExpandedMemoryQuery, expand_memory_query
from services.memory_rerank_service import rerank_candidates
from services.memory_story_service import build_query_semantic_profile, enrich_story_evidence
from services.memory_turbopuffer_service import TurbopufferService
from services.watcher_service_local_db import open_activity_connection_for_user
from services.watcher_service_search_utils import score_lexical_match_impl

logger = logging.getLogger(__name__)


def _table_has_column(cursor, table_name: str, column_name: str) -> bool:
    try:
        rows = cursor.execute(f"PRAGMA table_info({table_name})").fetchall()
    except Exception:
        return False
    target = str(column_name or "").strip().lower()
    for row in rows:
        if isinstance(row, sqlite3.Row):
            name = row["name"]
        elif isinstance(row, (list, tuple)) and len(row) > 1:
            name = row[1]
        else:
            name = ""
        if str(name or "").strip().lower() == target:
            return True
    return False


def _preferred_semantic_text(
    *,
    semantic_summary: Any = "",
    contextual_text: Any = "",
    raw_text: Any = "",
) -> str:
    summary = " ".join(str(semantic_summary or "").split()).strip()
    contextual = " ".join(str(contextual_text or "").split()).strip()
    raw = " ".join(str(raw_text or "").split()).strip()

    parts: List[str] = []
    if summary:
        if not summary.endswith("."):
            summary = f"{summary}."
        parts.append(summary)
    if contextual:
        parts.append(contextual)
    elif raw:
        parts.append(raw)

    combined = "\n\n".join(part for part in parts if part).strip()
    return combined or summary or contextual or raw


async def _attach_snapshot_semantic_summaries(
    *,
    user_id: str,
    items: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    session_ids = sorted(
        {
            int(item.get("session_id") or item.get("session_key") or 0)
            for item in items
            if int(item.get("session_id") or item.get("session_key") or 0) > 0
        }
    )
    if not session_ids:
        return items

    try:
        async with open_activity_connection_for_user(user_id=user_id, write=False) as conn:
            if conn is None:
                return items
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            try:
                cursor.execute("SELECT 1 FROM context_snapshots LIMIT 0")
            except Exception:
                return items
            if not _table_has_column(cursor, "context_snapshots", "semantic_summary"):
                return items

            placeholders = ",".join("?" for _ in session_ids)
            rows = cursor.execute(
                f"""
                SELECT session_id, semantic_summary
                FROM (
                    SELECT
                        session_id,
                        COALESCE(NULLIF(TRIM(semantic_summary), ''), '') AS semantic_summary,
                        ROW_NUMBER() OVER (
                            PARTITION BY session_id
                            ORDER BY
                                CASE WHEN TRIM(COALESCE(semantic_summary, '')) != '' THEN 0 ELSE 1 END,
                                COALESCE(ax_richness_score, 0.0) DESC,
                                ts DESC
                        ) AS rn
                    FROM context_snapshots
                    WHERE session_id IN ({placeholders})
                ) ranked
                WHERE rn = 1
                  AND semantic_summary != ''
                """,
                tuple(session_ids),
            ).fetchall()
    except Exception:
        return items

    summaries = {
        int(row["session_id"]): str(row["semantic_summary"] or "").strip()
        for row in rows
        if int(row["session_id"] or 0) > 0 and str(row["semantic_summary"] or "").strip()
    }
    if not summaries:
        return items

    enriched: List[Dict[str, Any]] = []
    for item in items:
        session_id = int(item.get("session_id") or item.get("session_key") or 0)
        summary = summaries.get(session_id)
        if not summary:
            enriched.append(item)
            continue
        next_item = dict(item)
        next_item["semantic_summary"] = summary
        enriched.append(next_item)
    return enriched


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


def _active_doc_ids(user_id: str, doc_ids: List[str]) -> set[str]:
    if not doc_ids:
        return set()
    unique_doc_ids = [doc_id for doc_id in doc_ids if doc_id]
    if not unique_doc_ids:
        return set()

    placeholders = ",".join(["?"] * len(unique_doc_ids))
    sql = f"""
        SELECT id, provider_doc_id, COALESCE(NULLIF(logical_chunk_id, ''), chunk_id) AS logical_chunk_id
        FROM memory_chunks
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND provider_doc_id IN ({placeholders})
        ORDER BY id DESC
    """
    with get_memory_db() as conn:
        rows = conn.execute(sql, [user_id, *unique_doc_ids]).fetchall()

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
    return active_doc_ids


def _filter_active_candidates(user_id: str, candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not candidates:
        return []
    doc_ids = [str(item.get("doc_id") or "").strip() for item in candidates]
    doc_ids = [doc_id for doc_id in doc_ids if doc_id]
    if not doc_ids:
        return []
    active_doc_ids = _active_doc_ids(user_id=user_id, doc_ids=doc_ids)
    if not active_doc_ids:
        return []
    return [item for item in candidates if str(item.get("doc_id") or "") in active_doc_ids]


def _filter_active_ranked_lists(user_id: str, ranked_lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    doc_ids: List[str] = []
    for ranked_list in ranked_lists:
        for item in ranked_list.get("items") or []:
            doc_id = str(item.get("doc_id") or "").strip()
            if doc_id:
                doc_ids.append(doc_id)
    active_doc_ids = _active_doc_ids(user_id=user_id, doc_ids=doc_ids)
    if not active_doc_ids:
        return []

    filtered_lists: List[Dict[str, Any]] = []
    for ranked_list in ranked_lists:
        filtered_items = [
            item
            for item in ranked_list.get("items") or []
            if str(item.get("doc_id") or "").strip() in active_doc_ids
        ]
        if filtered_items:
            filtered_lists.append({**ranked_list, "items": filtered_items})
    return filtered_lists


def _normalized_key(value: Any) -> str:
    text = "".join(ch if ch.isalnum() else " " for ch in str(value or "").lower())
    return " ".join(text.split())


def _candidate_semantic_bonus(query_profile: Dict[str, Any], candidate: Dict[str, Any]) -> float:
    enriched = enrich_story_evidence(
        {
            "app_name": candidate.get("app_name"),
            "window_title": candidate.get("window_title"),
            "document_title": candidate.get("document_title"),
            "browser_domain": candidate.get("browser_domain"),
            "parent_context": candidate.get("parent_context"),
            "contextual_retrieval_text": candidate.get("contextual_retrieval_text"),
            "snippet": _citation_source_text(candidate),
            "timestamp": int(candidate.get("chunk_end_ts") or candidate.get("chunk_start_ts") or 0),
            "session_key": candidate.get("session_id") or candidate.get("session_key"),
            "capture_quality": candidate.get("capture_quality"),
        }
    )
    query_documents = {_normalized_key(value) for value in query_profile.get("document_refs") or [] if _normalized_key(value)}
    query_entities = {_normalized_key(value) for value in query_profile.get("entity_refs") or [] if _normalized_key(value)}
    query_tasks = {_normalized_key(value) for value in query_profile.get("task_phrases") or [] if _normalized_key(value)}
    query_artifacts = {_normalized_key(value) for value in query_profile.get("artifact_refs") or [] if _normalized_key(value)}

    candidate_documents = {_normalized_key(value) for value in enriched.get("document_refs") or [] if _normalized_key(value)}
    candidate_entities = {_normalized_key(value) for value in enriched.get("project_refs") or [] if _normalized_key(value)}
    candidate_tasks = {_normalized_key(value) for value in enriched.get("task_phrases") or [] if _normalized_key(value)}
    candidate_artifacts = {_normalized_key(value) for value in enriched.get("artifact_refs") or [] if _normalized_key(value)}

    bonus = 0.0
    if query_documents & candidate_documents or query_artifacts & candidate_artifacts:
        bonus += 0.14
    if query_entities & candidate_entities:
        bonus += 0.08
    if query_tasks & candidate_tasks:
        bonus += 0.08
    return bonus


def _candidate_haystack(candidate: Dict[str, Any]) -> str:
    return " ".join(
        [
            str(candidate.get("app_name") or ""),
            str(candidate.get("window_title") or ""),
            str(candidate.get("document_title") or ""),
            str(candidate.get("browser_domain") or ""),
            str(candidate.get("parent_context") or ""),
            _citation_source_text(candidate),
        ]
    ).lower()


def _rrf_fuse(
    ranked_lists: List[Dict[str, Any]],
    *,
    query: str,
    query_profile: Dict[str, Any],
    k: int = 60,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    now_ms = int(time.time() * 1000)
    traces: Dict[str, Dict[str, Any]] = {}
    by_doc_id: Dict[str, Dict[str, Any]] = {}
    lexical_tokens = [token for token in _normalized_key(query).split() if token]
    context_overlap_keys = {
        (
            str(item.get("app_name") or "").strip().lower(),
            str(item.get("browser_domain") or "").strip().lower(),
            _time_bucket_key(int(item.get("chunk_end_ts") or item.get("chunk_start_ts") or 0)),
        )
        for ranked_list in ranked_lists
        for item in ranked_list.get("items") or []
        if str(item.get("source_kind") or "").strip().lower() != "legacy_ocr_chunk"
    }

    for list_index, ranked_list in enumerate(ranked_lists):
        source = str(ranked_list.get("source") or "fts")
        query_type = str(ranked_list.get("query_type") or "original")
        query_text = str(ranked_list.get("query_text") or "")
        weight = float(ranked_list.get("weight") or 1.0)
        for rank_zero, item in enumerate(ranked_list.get("items") or []):
            doc_id = str(item.get("doc_id") or "").strip()
            if not doc_id:
                continue
            by_doc_id.setdefault(doc_id, dict(item))
            contribution = weight / (k + rank_zero + 1)
            trace = traces.setdefault(
                doc_id,
                {
                    "doc_id": doc_id,
                    "base_score": 0.0,
                    "top_rank": rank_zero + 1,
                    "top_rank_bonus": 0.0,
                    "contributions": [],
                },
            )
            trace["base_score"] += contribution
            trace["top_rank"] = min(int(trace["top_rank"]), rank_zero + 1)
            trace["contributions"].append(
                {
                    "list_index": list_index,
                    "source": source,
                    "query_type": query_type,
                    "query": query_text,
                    "rank": rank_zero + 1,
                    "weight": weight,
                    "backend_score": float(item.get("score") or 0.0),
                    "rrf_contribution": contribution,
                }
            )

    fused: List[Dict[str, Any]] = []
    for doc_id, trace in traces.items():
        item = dict(by_doc_id.get(doc_id) or {})
        if not item:
            continue
        top_rank = int(trace.get("top_rank") or 999)
        if top_rank == 1:
            trace["top_rank_bonus"] = 0.05
        elif top_rank <= 3:
            trace["top_rank_bonus"] = 0.02
        lexical_score = score_lexical_match_impl(_candidate_haystack(item), lexical_tokens)
        semantic_bonus = _candidate_semantic_bonus(query_profile, item)
        quality = float(item.get("capture_quality") or item.get("quality_score") or 0.0)
        quality_bonus = min(0.08, max(0.0, quality) * 0.08)
        end_ts = int(item.get("chunk_end_ts") or item.get("chunk_start_ts") or 0)
        age_hours = max(0.0, (now_ms - end_ts) / (1000.0 * 60.0 * 60.0)) if end_ts > 0 else 9999.0
        recency_bonus = max(0.0, 0.05 * (1.0 - min(age_hours / 72.0, 1.0)))
        lexical_bonus = min(0.08, lexical_score * 0.08)
        fused_score = float(trace["base_score"]) + float(trace["top_rank_bonus"]) + semantic_bonus + quality_bonus + recency_bonus + lexical_bonus
        if str(item.get("source_kind") or "").strip().lower() == "legacy_ocr_chunk":
            overlap_key = (
                str(item.get("app_name") or "").strip().lower(),
                str(item.get("browser_domain") or "").strip().lower(),
                _time_bucket_key(int(item.get("chunk_end_ts") or item.get("chunk_start_ts") or 0)),
            )
            if overlap_key in context_overlap_keys:
                fused_score *= 0.72
        trace["total_score"] = round(float(fused_score), 6)
        item["rrf_trace"] = trace
        item["lexical_match_score"] = float(lexical_score)
        item["fused_score"] = float(fused_score)
        fused.append(item)

    fused.sort(key=lambda row: float(row.get("fused_score") or 0.0), reverse=True)
    trace_list = [item.get("rrf_trace") for item in fused if isinstance(item.get("rrf_trace"), dict)]
    return fused, trace_list


def _build_query_budgets(intent: str) -> Dict[str, int]:
    if intent == "broad_overview":
        return {"lane_top_k": 144, "candidate_limit": 96, "final_limit": 48}
    if intent == "semantic_lookup":
        return {"lane_top_k": 40, "candidate_limit": 20, "final_limit": 12}
    return {"lane_top_k": 50, "candidate_limit": 30, "final_limit": 16}


def _query_memory_chunk_lexical_lists(
    *,
    user_id: str,
    expanded_queries: List[ExpandedMemoryQuery],
    query_profile: Dict[str, Any],
    start_ms: int,
    end_ms: int,
    top_k: int,
) -> List[Dict[str, Any]]:
    sample_limit = max(300, min(max(top_k, 1) * 20, 2000))
    with get_memory_db() as conn:
        rows = conn.execute(
            """
            SELECT
                id,
                provider_doc_id,
                chunk_id,
                logical_chunk_id,
                chunk_start_ts,
                chunk_end_ts,
                source_kind,
                session_id,
                app_name,
                window_title,
                document_title,
                browser_domain,
                text_compact,
                raw_text_compact,
                contextual_text_compact,
                context_version,
                session_key,
                session_position,
                session_chunk_count,
                quality_score,
                capture_quality
            FROM memory_chunks
            WHERE user_id = ?
              AND deleted_at IS NULL
              AND chunk_end_ts >= ?
              AND chunk_start_ts <= ?
            ORDER BY chunk_end_ts DESC
            LIMIT ?
            """,
            (user_id, int(start_ms), int(end_ms), int(sample_limit)),
        ).fetchall()

    candidates: List[Dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["doc_id"] = (
            str(item.get("provider_doc_id") or "").strip()
            or str(item.get("logical_chunk_id") or "").strip()
            or f"memory-chunk:{item.get('id')}"
        )
        item["raw_visible_text"] = item.get("raw_text_compact") or item.get("text_compact") or ""
        item["contextual_retrieval_text"] = item.get("contextual_text_compact") or item.get("text_compact") or ""
        item["parent_context"] = item.get("window_title") or item.get("document_title") or ""
        candidates.append(item)

    ranked_lists: List[Dict[str, Any]] = []
    for expanded in expanded_queries:
        query_text = str(expanded.get("text") or "").strip()
        tokens = [token for token in _normalized_key(query_text).split() if token]
        if not query_text or not tokens:
            continue

        scored: List[Dict[str, Any]] = []
        for candidate in candidates:
            lexical_score = score_lexical_match_impl(_candidate_haystack(candidate), tokens)
            if lexical_score <= 0:
                continue
            semantic_bonus = _candidate_semantic_bonus(query_profile, candidate)
            quality_signal = max(
                float(candidate.get("capture_quality") or 0.0),
                float(candidate.get("quality_score") or 0.0),
            )
            combined_score = lexical_score + semantic_bonus + min(quality_signal, 1.0) * 0.05
            row = dict(candidate)
            row["lexical_match_score"] = round(lexical_score, 4)
            row["combined_score"] = round(combined_score, 4)
            row["retrieval_score"] = round(combined_score, 4)
            scored.append(row)

        scored.sort(
            key=lambda row: (
                float(row.get("combined_score") or 0.0),
                int(row.get("chunk_end_ts") or row.get("chunk_start_ts") or 0),
            ),
            reverse=True,
        )
        if not scored:
            continue

        ranked_lists.append(
            {
                "source": "fts",
                "query_type": str(expanded.get("type") or "original"),
                "query_text": query_text,
                "weight": float(expanded.get("weight") or 1.0),
                "items": scored[: max(1, int(top_k))],
            }
        )

    return ranked_lists


def _strong_signal_short_circuit(
    *,
    query: str,
    ranked_lists: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    lexical_lists = [item for item in ranked_lists if str(item.get("source") or "") == "fts"]
    if not lexical_lists:
        return None
    lexical_tokens = [token for token in _normalized_key(query).split() if token]
    top_rows: List[Dict[str, Any]] = []
    for lexical_list in lexical_lists:
        items = lexical_list.get("items") or []
        if items:
            top_rows.append(dict(items[0]))
    if not top_rows:
        return None
    scored_rows = []
    for row in top_rows:
        lexical_score = score_lexical_match_impl(_candidate_haystack(row), lexical_tokens)
        row["lexical_match_score"] = lexical_score
        scored_rows.append(row)
    scored_rows.sort(key=lambda row: float(row.get("lexical_match_score") or 0.0), reverse=True)
    top_row = scored_rows[0]
    second_score = float(scored_rows[1].get("lexical_match_score") or 0.0) if len(scored_rows) > 1 else 0.0
    top_score = float(top_row.get("lexical_match_score") or 0.0)
    normalized_query = _normalized_key(query)
    exact_match = normalized_query and normalized_query in _normalized_key(
        " ".join(
            [
                str(top_row.get("document_title") or ""),
                str(top_row.get("window_title") or ""),
                str(top_row.get("raw_visible_text") or ""),
                str(top_row.get("contextual_retrieval_text") or ""),
            ]
        )
    )
    if exact_match or (top_score >= 0.85 and (top_score - second_score) >= 0.15):
        return {
            "exact_match": bool(exact_match),
            "top_score": round(top_score, 3),
            "runner_up_score": round(second_score, 3),
            "provider_doc_id": top_row.get("doc_id"),
        }
    return None


def _citation_source_text(item: Dict[str, Any]) -> str:
    return _preferred_semantic_text(
        semantic_summary=item.get("semantic_summary"),
        contextual_text=(
            item.get("contextual_retrieval_text")
            or item.get("contextual_text_compact")
            or ""
        ),
        raw_text=(
            item.get("raw_visible_text")
            or item.get("raw_text_compact")
            or item.get("text_compact")
            or ""
        ),
    )


def _time_bucket_key(ts_ms: int) -> str:
    if ts_ms <= 0:
        return "unknown"
    bucket_ms = 2 * 60 * 60 * 1000
    return str(ts_ms // bucket_ms)


def _build_rerank_intent(query_profile: Dict[str, Any]) -> str:
    parts: List[str] = []
    if query_profile.get("document_refs"):
        parts.append(f"documents: {', '.join(list(query_profile.get('document_refs') or [])[:2])}")
    if query_profile.get("entity_refs"):
        parts.append(f"entities: {', '.join(list(query_profile.get('entity_refs') or [])[:2])}")
    if query_profile.get("task_phrases"):
        parts.append(f"tasks: {', '.join(list(query_profile.get('task_phrases') or [])[:2])}")
    return " | ".join(parts)[:240]


def _build_recap_diversity_metrics(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    sessions = {
        str(item.get("session_id") or item.get("session_key") or "").strip()
        for item in items
        if str(item.get("session_id") or item.get("session_key") or "").strip()
    }
    apps = {
        str(item.get("app_name") or "").strip()
        for item in items
        if str(item.get("app_name") or "").strip()
    }
    domains = {
        str(item.get("browser_domain") or "").strip()
        for item in items
        if str(item.get("browser_domain") or "").strip()
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
        "distinct_domains": len(domains),
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
    bucket_goal = min(6, len(available_buckets))
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
        if len(snippet) > 800:
            snippet = f"{snippet[:800].rstrip()}..."
        citations.append(
            {
                "chunk_id": item.get("chunk_id"),
                "frame_id": None,
                "timestamp": int(item.get("chunk_end_ts") or 0) or int(item.get("chunk_start_ts") or 0),
                "app_name": item.get("app_name"),
                "window_title": item.get("window_title"),
                "document_title": item.get("document_title"),
                "browser_domain": item.get("browser_domain"),
                "session_key": item.get("session_id") or item.get("session_key"),
                "context_version": int(item.get("context_version") or 1),
                "snippet": snippet,
                "parent_context": item.get("parent_context"),
                "contextual_retrieval_text": item.get("contextual_retrieval_text"),
                "semantic_summary": item.get("semantic_summary"),
                "score": round(float(item.get("rerank_score") or item.get("fused_score") or 0.0), 3),
                "source": "cloud_hybrid",
                "source_type": item.get("source_kind"),
                "capture_quality": item.get("capture_quality"),
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
    distinct_domains = 0
    distinct_time_buckets = 0
    context_version_mix: Dict[str, int] = {}

    try:
        # NOTE: Embedding drain at query time removed for performance.
        # The background embedding worker handles this asynchronously.
        # A slight delay (1-5 min) for very recent captures to be searchable
        # is acceptable — most queries are for past days.

        query_profile = build_query_semantic_profile(query)
        broad_overview = intent == "broad_overview"
        budgets = _build_query_budgets(intent)
        expanded_queries = expand_memory_query(
            query,
            include_hyde=False,
        )
        vector_texts = sorted(
            {
                str(item.get("text") or "").strip()
                for item in expanded_queries
                if str(item.get("type") or "") in {"original", "vec", "hyde"}
                and str(item.get("text") or "").strip()
            }
        )
        query_vectors: Dict[str, List[float]] = {}
        lexical_only = False
        if vector_texts:
            embed_attempted = True
            try:
                embedded_vectors = await asyncio.gather(*[_embed_query(text) for text in vector_texts])
                query_vectors = {
                    text: vector
                    for text, vector in zip(vector_texts, embedded_vectors)
                    if isinstance(vector, list) and vector
                }
                embed_succeeded = bool(query_vectors)
            except Exception:
                lexical_only = True
                embed_error = "query_embedding_failed"

        retrieval_queries: List[Dict[str, Any]] = []
        for item in expanded_queries:
            query_type = str(item.get("type") or "original")
            query_text = str(item.get("text") or "").strip()
            if not query_text:
                continue
            retrieval_query: Dict[str, Any] = {
                "type": query_type,
                "text": query_text,
                "weight": float(item.get("weight") or 1.0),
            }
            if query_type in {"original", "vec", "hyde"} and query_text in query_vectors:
                retrieval_query["vector"] = query_vectors[query_text]
            retrieval_queries.append(retrieval_query)

        tp = TurbopufferService()
        tp_error: Optional[str] = None
        try:
            tp_result = await tp.hybrid_candidates(
                user_id=user_id,
                queries=retrieval_queries,
                start_ms=start_ms,
                end_ms=end_ms,
                top_k=budgets["lane_top_k"],
            )
            candidate_count_raw = int(tp_result.get("candidate_count_raw") or 0)
            ranked_lists = tp_result.get("lists") or []
            ranked_lists = _filter_active_ranked_lists(user_id=user_id, ranked_lists=ranked_lists)
            candidate_count_active = sum(len(item.get("items") or []) for item in ranked_lists)
        except Exception as exc:
            tp_error = str(exc)[:300]
            lexical_only = True
            ranked_lists = []
            candidate_count_raw = 0
            candidate_count_active = 0
        used_db_lexical_fallback = False
        if candidate_count_active <= 0:
            db_ranked_lists = _query_memory_chunk_lexical_lists(
                user_id=user_id,
                expanded_queries=expanded_queries,
                query_profile=query_profile,
                start_ms=start_ms,
                end_ms=end_ms,
                top_k=budgets["lane_top_k"],
            )
            if db_ranked_lists:
                ranked_lists = db_ranked_lists
                candidate_count_raw = sum(len(item.get("items") or []) for item in ranked_lists)
                candidate_count_active = candidate_count_raw
                lexical_only = True
                used_db_lexical_fallback = True

        strong_signal = _strong_signal_short_circuit(query=query, ranked_lists=ranked_lists)
        fused, rrf_trace = _rrf_fuse(ranked_lists, query=query, query_profile=query_profile, k=60)
        rerank_input = fused[: budgets["candidate_limit"]]
        rerank_input_count = len(rerank_input)
        rerank_provider = "none"
        rerank_attempted = False
        rerank_latency_ms = 0
        rerank_cache_hits = 0
        rerank_cache_misses = 0
        rerank_deduped_candidates = 0
        ranked_rows: List[Dict[str, Any]] = []
        if strong_signal:
            ranked_rows = rerank_input
        else:
            rerank_result = await rerank_candidates(
                query=query,
                rerank_intent=_build_rerank_intent(query_profile),
                candidates=rerank_input,
                top_n=min(budgets["candidate_limit"], len(rerank_input)),
            )
            rerank_items = rerank_result.get("items") if isinstance(rerank_result, dict) else []
            rerank_provider = rerank_result.get("provider") if isinstance(rerank_result, dict) else "none"
            rerank_items_count = len(rerank_items) if isinstance(rerank_items, list) else 0
            rerank_attempted = rerank_result.get("rerank_attempted", False) if isinstance(rerank_result, dict) else False
            rerank_latency_ms = rerank_result.get("rerank_latency_ms", 0) if isinstance(rerank_result, dict) else 0
            rerank_cache_hits = int(rerank_result.get("cache_hits") or 0) if isinstance(rerank_result, dict) else 0
            rerank_cache_misses = int(rerank_result.get("cache_misses") or 0) if isinstance(rerank_result, dict) else 0
            rerank_deduped_candidates = int(rerank_result.get("deduped_candidates") or 0) if isinstance(rerank_result, dict) else 0
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
        if strong_signal:
            rerank_items_count = 0

        final_rows = (
            _select_diverse_recap_evidence(ranked_rows, target=budgets["final_limit"])
            if broad_overview
            else ranked_rows[: max(8, min(limit, budgets["final_limit"]))]
        )
        final_rows = await _attach_snapshot_semantic_summaries(user_id=user_id, items=final_rows)
        diversity_metrics = _build_recap_diversity_metrics(final_rows)
        final_evidence_count = len(final_rows)
        distinct_sessions = int(diversity_metrics["distinct_sessions"])
        distinct_apps = int(diversity_metrics["distinct_apps"])
        distinct_domains = int(diversity_metrics.get("distinct_domains") or 0)
        distinct_time_buckets = int(diversity_metrics["distinct_time_buckets"])
        context_version_mix = dict(diversity_metrics["context_version_mix"])

        citations = _build_citations(final_rows, limit=40 if broad_overview else min(max(limit, 12), 20))
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

        mode_used = "cloud-db-lexical" if used_db_lexical_fallback else ("cloud-lexical" if lexical_only else "cloud-hybrid")
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
            "turbopuffer_error": tp_error,
            "candidate_count_raw": candidate_count_raw,
            "candidate_count_active": candidate_count_active,
            "rerank_input_count": rerank_input_count,
            "rerank_items_count": rerank_items_count,
            "final_evidence_count": final_evidence_count,
            "distinct_sessions": distinct_sessions,
            "distinct_apps": distinct_apps,
            "distinct_domains": distinct_domains,
            "distinct_time_buckets": distinct_time_buckets,
            "context_version_mix": context_version_mix,
            "raw_vs_contextual_source": "rerank=contextual_text_compact,citations=semantic_summary+contextual_retrieval_text",
            "rerank_provider": rerank_provider or "none",
            "query_vector_present": bool(query_vectors),
            "db_lexical_fallback": used_db_lexical_fallback,
            "query_window_start": start_ms,
            "query_window_end": end_ms,
            "cloud_max_embedded_ts": cloud_max_embedded_ts,
            "cloud_pending_in_window": cloud_pending_in_window,
            "rerank_attempted": rerank_attempted,
            "rerank_latency_ms": rerank_latency_ms,
            "retrieval_lists": [
                {
                    "source": item.get("source"),
                    "query_type": item.get("query_type"),
                    "query_text": item.get("query_text"),
                    "weight": item.get("weight"),
                    "result_count": len(item.get("items") or []),
                }
                for item in ranked_lists
            ],
            "rrf_trace": rrf_trace[:20],
            "strong_signal_short_circuit": strong_signal,
            "rerank_cache_hit": rerank_cache_hits > 0,
            "rerank_cache_hits": rerank_cache_hits,
            "rerank_cache_misses": rerank_cache_misses,
            "rerank_deduped_candidates": rerank_deduped_candidates,
            "rerank_candidates_considered": len(rerank_input),
            "candidate_limit_applied": budgets["candidate_limit"],
            "expanded_queries": expanded_queries,
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
            "db_lexical_fallback=%s rerank_provider=%s rerank_items=%s rerank_attempted=%s rerank_latency_ms=%s "
            "final_evidence=%s distinct_sessions=%s distinct_apps=%s distinct_domains=%s distinct_buckets=%s "
            "citations=%s tier=%s cloud_max_embedded_ts=%s cloud_pending_in_window=%s",
            lexical_only,
            embed_succeeded,
            candidate_count_raw,
            candidate_count_active,
            used_db_lexical_fallback,
            rerank_provider or "none",
            rerank_items_count,
            rerank_attempted,
            rerank_latency_ms,
            final_evidence_count,
            distinct_sessions,
            distinct_apps,
            distinct_domains,
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
                "retrieval": "memory_cloud_db" if used_db_lexical_fallback else "turbopuffer",
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
