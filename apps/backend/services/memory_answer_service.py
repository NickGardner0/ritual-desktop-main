"""Answer synthesis for cloud memory responses."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from openai import AsyncOpenAI


def _openai_client() -> AsyncOpenAI:
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    return AsyncOpenAI(api_key=api_key)


def _answer_model() -> str:
    return (os.getenv("OPENAI_ANSWER_MODEL") or "gpt-4.1-mini").strip()


async def synthesize_memory_answer(
    *,
    query: str,
    intent: str,
    citations: List[Dict[str, Any]],
    time_truth: Dict[str, Any] | None,
    max_citations: int = 8,
) -> Dict[str, Any]:
    """
    Produce concise grounded narrative. If no citations, returns cautious fallback text.
    """
    if not citations:
        return {
            "answer_text": "I don’t have enough grounded OCR evidence in this time range to answer that confidently.",
            "grounded": False,
        }

    clipped = citations[: max(1, min(max_citations, len(citations)))]
    prompt_payload = {
        "query": query,
        "intent": intent,
        "time_truth": time_truth,
        "citations": clipped,
        "rules": [
            "Only use provided evidence.",
            "Do not infer topic work from app presence alone.",
            "If uncertain, say so explicitly.",
            "Keep under 120 words.",
        ],
    }

    client = _openai_client()
    resp = await client.chat.completions.create(
        model=_answer_model(),
        temperature=0.1,
        messages=[
            {"role": "system", "content": "Return strict JSON: {\"answer_text\": string, \"grounded\": boolean}"},
            {"role": "user", "content": json.dumps(prompt_payload)},
        ],
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content or "{}"
    parsed = json.loads(raw)
    answer_text = str(parsed.get("answer_text") or "").strip()
    grounded = bool(parsed.get("grounded"))
    if not answer_text:
        answer_text = "I found evidence, but I could not synthesize a reliable summary."
        grounded = False
    return {"answer_text": answer_text, "grounded": grounded}
