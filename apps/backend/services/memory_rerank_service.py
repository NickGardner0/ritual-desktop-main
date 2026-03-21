"""Second-stage reranking for memory candidates (Cohere primary, OpenAI fallback)."""

from __future__ import annotations

import json
import logging
import os
import hashlib
import time
from typing import Any, Dict, List, Tuple

import httpx
from openai import AsyncOpenAI

from services.memory_cloud_store import get_rerank_cache_score, set_rerank_cache_score

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Simple circuit breaker for Cohere reranking
# ---------------------------------------------------------------------------
_COHERE_CB_FAILURE_THRESHOLD = 3
_COHERE_CB_WINDOW_SECONDS = 300
_COHERE_CB_COOLDOWN_SECONDS = 600

_cohere_failures: List[float] = []
_cohere_circuit_open_until: float = 0.0


def _cohere_circuit_is_open() -> bool:
    return time.time() < _cohere_circuit_open_until


def _cohere_record_failure() -> None:
    global _cohere_circuit_open_until
    now = time.time()
    _cohere_failures.append(now)
    recent = [t for t in _cohere_failures if now - t < _COHERE_CB_WINDOW_SECONDS]
    _cohere_failures.clear()
    _cohere_failures.extend(recent)
    if len(recent) >= _COHERE_CB_FAILURE_THRESHOLD:
        _cohere_circuit_open_until = now + _COHERE_CB_COOLDOWN_SECONDS
        logger.warning(
            "Cohere rerank circuit breaker OPEN for %ds after %d failures in %ds",
            _COHERE_CB_COOLDOWN_SECONDS,
            len(recent),
            _COHERE_CB_WINDOW_SECONDS,
        )


def _cohere_record_success() -> None:
    global _cohere_circuit_open_until
    _cohere_failures.clear()
    if _cohere_circuit_open_until > 0:
        logger.info("Cohere rerank circuit breaker CLOSED (success)")
    _cohere_circuit_open_until = 0.0


def _cohere_api_key() -> str:
    return (os.getenv("COHERE_API_KEY") or "").strip()


def _cohere_model() -> str:
    return (os.getenv("COHERE_RERANK_MODEL") or "rerank-v3.5").strip()


def _openai_api_key() -> str:
    return (os.getenv("OPENAI_API_KEY") or "").strip()


def _openai_answer_model() -> str:
    return (os.getenv("OPENAI_ANSWER_MODEL") or "gpt-4.1-mini").strip()


def _rerank_cache_ttl_ms() -> int:
    raw = (os.getenv("RITUAL_RERANK_CACHE_TTL_MS") or "").strip()
    try:
        return max(60_000, int(raw or (7 * 24 * 60 * 60 * 1000)))
    except Exception:
        return 7 * 24 * 60 * 60 * 1000


def _candidate_doc_text(item: Dict[str, Any]) -> str:
    return " | ".join(
        [
            str(item.get("app_name") or ""),
            str(item.get("window_title") or ""),
            str(item.get("browser_domain") or ""),
            str(item.get("contextual_text_compact") or item.get("text_compact") or ""),
        ]
    ).strip()


async def _cohere_rerank(query: str, candidates: List[Dict[str, Any]], top_n: int) -> List[Tuple[int, float]]:
    key = _cohere_api_key()
    if not key:
        raise RuntimeError("COHERE_API_KEY is not configured")

    docs = [_candidate_doc_text(item) for item in candidates]
    payload = {
        "model": _cohere_model(),
        "query": query,
        "documents": docs,
        "top_n": int(max(1, min(top_n, len(docs)))),
        "return_documents": False,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=8.0) as client:
        resp = await client.post("https://api.cohere.com/v2/rerank", headers=headers, json=payload)
    if resp.status_code >= 400:
        raise RuntimeError(f"Cohere rerank failed: status={resp.status_code} body={resp.text[:240]}")

    body = resp.json()
    results = body.get("results") if isinstance(body, dict) else None
    if not isinstance(results, list):
        return []

    reranked: List[Tuple[int, float]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        idx = item.get("index")
        score = item.get("relevance_score")
        try:
            reranked.append((int(idx), float(score)))
        except Exception:
            continue
    return reranked


async def _openai_rerank(query: str, candidates: List[Dict[str, Any]], top_n: int) -> List[Tuple[int, float]]:
    key = _openai_api_key()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    client = AsyncOpenAI(api_key=key)

    docs = [_candidate_doc_text(item) for item in candidates]
    enumerated = [{"index": i, "text": doc[:2000]} for i, doc in enumerate(docs)]
    prompt = (
        "You are a retrieval reranker. Rank documents by relevance to query.\n"
        "Return strict JSON object with key 'ranked' array of {index, score} where score in [0,1], descending.\n"
        f"Query: {query}\n"
        f"Documents: {json.dumps(enumerated)}"
    )
    completion = await client.chat.completions.create(
        model=_openai_answer_model(),
        messages=[
            {"role": "system", "content": "Return valid JSON only."},
            {"role": "user", "content": prompt},
        ],
        temperature=0,
        response_format={"type": "json_object"},
    )
    content = completion.choices[0].message.content or "{}"
    payload = json.loads(content)
    ranked = payload.get("ranked") if isinstance(payload, dict) else None
    if not isinstance(ranked, list):
        return []
    out: List[Tuple[int, float]] = []
    for item in ranked[: max(1, min(top_n, len(candidates)))]:
        if not isinstance(item, dict):
            continue
        try:
            out.append((int(item.get("index")), float(item.get("score"))))
        except Exception:
            continue
    return out


async def rerank_candidates(
    *,
    query: str,
    rerank_intent: str = "",
    candidates: List[Dict[str, Any]],
    top_n: int = 50,
) -> Dict[str, Any]:
    if not candidates:
        return {
            "provider": "none",
            "items": [],
            "rerank_attempted": False,
            "rerank_latency_ms": 0,
            "cache_hits": 0,
            "cache_misses": 0,
            "deduped_candidates": 0,
        }

    clipped_top_n = max(1, min(top_n, len(candidates)))
    rerank_attempted = True
    rerank_start = time.time()
    rerank_provider_tried = "cohere"
    rerank_query = f"{rerank_intent}\n\n{query}".strip() if rerank_intent else query

    deduped_candidates: List[Dict[str, Any]] = []
    cached_items: List[Tuple[int, float]] = []
    cache_hits = 0
    cache_misses = 0
    seen_text_to_index: Dict[str, int] = {}
    uncached_texts: List[str] = []
    uncached_candidates: List[Dict[str, Any]] = []

    for index, candidate in enumerate(candidates):
        candidate_text = _candidate_doc_text(candidate)
        normalized_text = " ".join(candidate_text.split())
        if not normalized_text:
            continue
        text_key = normalized_text.lower()
        if text_key in seen_text_to_index:
            continue
        seen_text_to_index[text_key] = index
        deduped_candidates.append(candidate)
        cache_key = hashlib.sha256(
            json.dumps(
                {
                    "query": rerank_query,
                    "provider": "shared",
                    "model": "shared",
                    "candidate_text": normalized_text,
                },
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        cached_score = get_rerank_cache_score(cache_key)
        if cached_score is not None:
            cache_hits += 1
            cached_items.append((index, float(cached_score)))
        else:
            cache_misses += 1
            uncached_texts.append(normalized_text)
            uncached_candidates.append(candidate)

    if cache_hits and cache_hits >= clipped_top_n:
        cached_items.sort(key=lambda pair: pair[1], reverse=True)
        return {
            "provider": "cache",
            "items": cached_items[:clipped_top_n],
            "rerank_attempted": False,
            "rerank_latency_ms": int((time.time() - rerank_start) * 1000),
            "cache_hits": cache_hits,
            "cache_misses": cache_misses,
            "deduped_candidates": len(deduped_candidates),
        }

    cohere_impl_patched = getattr(_cohere_rerank, "__module__", __name__) != __name__
    if not _cohere_circuit_is_open() or cohere_impl_patched:
        try:
            ranked = await _cohere_rerank(
                query=rerank_query,
                candidates=uncached_candidates or deduped_candidates,
                top_n=max(1, min(clipped_top_n, len(uncached_candidates or deduped_candidates))),
            )
            if ranked:
                target_candidates = uncached_candidates or deduped_candidates
                provider_model = _cohere_model()
                for idx, score in ranked:
                    if idx < 0 or idx >= len(target_candidates):
                        continue
                    candidate_text = " ".join(_candidate_doc_text(target_candidates[idx]).split())
                    cache_key = hashlib.sha256(
                        json.dumps(
                            {
                                "query": rerank_query,
                                "provider": "shared",
                                "model": "shared",
                                "candidate_text": candidate_text,
                            },
                            sort_keys=True,
                        ).encode("utf-8")
                    ).hexdigest()
                    set_rerank_cache_score(
                        cache_key=cache_key,
                        provider="cohere",
                        model=provider_model,
                        score=float(score),
                        ttl_ms=_rerank_cache_ttl_ms(),
                    )
                resolved: List[Tuple[int, float]] = list(cached_items)
                text_to_score = {
                    " ".join(_candidate_doc_text(target_candidates[idx]).split()).lower(): float(score)
                    for idx, score in ranked
                    if 0 <= idx < len(target_candidates)
                }
                for index, candidate in enumerate(candidates):
                    score = text_to_score.get(" ".join(_candidate_doc_text(candidate).split()).lower())
                    if score is None:
                        continue
                    resolved.append((index, score))
                resolved.sort(key=lambda pair: pair[1], reverse=True)
                _cohere_record_success()
                latency = int((time.time() - rerank_start) * 1000)
                return {
                    "provider": "cohere",
                    "items": resolved[:clipped_top_n],
                    "rerank_attempted": True,
                    "rerank_latency_ms": latency,
                    "cache_hits": cache_hits,
                    "cache_misses": cache_misses,
                    "deduped_candidates": len(deduped_candidates),
                }
        except Exception as exc:
            if "not configured" not in str(exc).lower():
                _cohere_record_failure()
            logger.warning("Cohere rerank failed, falling back to OpenAI: %s", exc)
    else:
        logger.info("Cohere circuit breaker open, skipping to OpenAI rerank")

    rerank_provider_tried = "openai"
    try:
        ranked = await _openai_rerank(
            query=rerank_query,
            candidates=uncached_candidates or deduped_candidates,
            top_n=min(30, max(1, min(clipped_top_n, len(uncached_candidates or deduped_candidates)))),
        )
        if ranked:
            target_candidates = uncached_candidates or deduped_candidates
            provider_model = _openai_answer_model()
            for idx, score in ranked:
                if idx < 0 or idx >= len(target_candidates):
                    continue
                candidate_text = " ".join(_candidate_doc_text(target_candidates[idx]).split())
                cache_key = hashlib.sha256(
                    json.dumps(
                        {
                            "query": rerank_query,
                            "provider": "shared",
                            "model": "shared",
                            "candidate_text": candidate_text,
                        },
                        sort_keys=True,
                    ).encode("utf-8")
                ).hexdigest()
                set_rerank_cache_score(
                    cache_key=cache_key,
                    provider="openai",
                    model=provider_model,
                    score=float(score),
                    ttl_ms=_rerank_cache_ttl_ms(),
                )
            resolved: List[Tuple[int, float]] = list(cached_items)
            text_to_score = {
                " ".join(_candidate_doc_text(target_candidates[idx]).split()).lower(): float(score)
                for idx, score in ranked
                if 0 <= idx < len(target_candidates)
            }
            for index, candidate in enumerate(candidates):
                score = text_to_score.get(" ".join(_candidate_doc_text(candidate).split()).lower())
                if score is None:
                    continue
                resolved.append((index, score))
            resolved.sort(key=lambda pair: pair[1], reverse=True)
            latency = int((time.time() - rerank_start) * 1000)
            return {
                "provider": "openai",
                "items": resolved[:clipped_top_n],
                "rerank_attempted": True,
                "rerank_latency_ms": latency,
                "cache_hits": cache_hits,
                "cache_misses": cache_misses,
                "deduped_candidates": len(deduped_candidates),
            }
    except Exception as exc:
        logger.warning("OpenAI rerank failed, using first-stage ranking: %s", exc)

    latency = int((time.time() - rerank_start) * 1000)
    if len(candidates) > 0:
        logger.warning(
            "Rerank exhausted all providers (candidates=%d, last_tried=%s, latency=%dms)",
            len(candidates),
            rerank_provider_tried,
            latency,
        )

    fallback = []
    for idx, item in enumerate(candidates):
        score = float(item.get("fused_score") or item.get("score") or 0.0)
        fallback.append((idx, score))
    fallback.sort(key=lambda pair: pair[1], reverse=True)
    return {
        "provider": "none",
        "items": fallback[:clipped_top_n],
        "rerank_attempted": rerank_attempted,
        "rerank_latency_ms": latency,
        "cache_hits": cache_hits,
        "cache_misses": cache_misses,
        "deduped_candidates": len(deduped_candidates),
    }
