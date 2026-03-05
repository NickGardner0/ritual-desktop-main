"""Second-stage reranking for memory candidates (Cohere primary, OpenAI fallback)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Tuple

import httpx
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)


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
            str(item.get("text_compact") or ""),
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
    async with httpx.AsyncClient(timeout=10.0) as client:
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
        return {"provider": "none", "items": []}

    clipped_top_n = max(1, min(top_n, len(candidates)))
    try:
        ranked = await _cohere_rerank(query=query, candidates=candidates, top_n=clipped_top_n)
        if ranked:
            return {"provider": "cohere", "items": ranked}
    except Exception as exc:
        logger.warning("Cohere rerank failed, falling back to OpenAI: %s", exc)

    try:
        ranked = await _openai_rerank(
            query=query,
            candidates=candidates,
            top_n=min(30, clipped_top_n),
        )
        if ranked:
            return {"provider": "openai", "items": ranked}
    except Exception as exc:
        logger.warning("OpenAI rerank failed, using first-stage ranking: %s", exc)

    # Final fallback: preserve first-stage ordering using fused/score if available.
    fallback = []
    for idx, item in enumerate(candidates):
        score = float(item.get("fused_score") or item.get("score") or 0.0)
        fallback.append((idx, score))
    fallback.sort(key=lambda pair: pair[1], reverse=True)
    return {"provider": "none", "items": fallback[:clipped_top_n]}
