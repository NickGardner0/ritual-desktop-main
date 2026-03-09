"""Second-stage reranking for memory candidates (Cohere primary, OpenAI fallback)."""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict, List, Tuple

import httpx
from openai import AsyncOpenAI

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
    candidates: List[Dict[str, Any]],
    top_n: int = 50,
) -> Dict[str, Any]:
    if not candidates:
        return {"provider": "none", "items": [], "rerank_attempted": False, "rerank_latency_ms": 0}

    clipped_top_n = max(1, min(top_n, len(candidates)))
    rerank_attempted = True
    rerank_start = time.time()
    rerank_provider_tried = "cohere"

    if not _cohere_circuit_is_open():
        try:
            ranked = await _cohere_rerank(query=query, candidates=candidates, top_n=clipped_top_n)
            if ranked:
                _cohere_record_success()
                latency = int((time.time() - rerank_start) * 1000)
                return {
                    "provider": "cohere",
                    "items": ranked,
                    "rerank_attempted": True,
                    "rerank_latency_ms": latency,
                }
        except Exception as exc:
            _cohere_record_failure()
            logger.warning("Cohere rerank failed, falling back to OpenAI: %s", exc)
    else:
        logger.info("Cohere circuit breaker open, skipping to OpenAI rerank")

    rerank_provider_tried = "openai"
    try:
        ranked = await _openai_rerank(
            query=query,
            candidates=candidates,
            top_n=min(30, clipped_top_n),
        )
        if ranked:
            latency = int((time.time() - rerank_start) * 1000)
            return {
                "provider": "openai",
                "items": ranked,
                "rerank_attempted": True,
                "rerank_latency_ms": latency,
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
    }
