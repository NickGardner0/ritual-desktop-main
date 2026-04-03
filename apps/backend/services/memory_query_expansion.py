"""Shared query expansion helpers for cloud memory search."""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, TypedDict


ExpandedQueryType = Literal["original", "lex", "vec", "hyde"]


class ExpandedMemoryQuery(TypedDict):
    type: ExpandedQueryType
    text: str
    weight: float


@lru_cache(maxsize=128)
def _load_config() -> Dict[str, Dict[str, List[str]]]:
    config_path = Path(__file__).resolve().parents[1] / "config" / "memory_query_expansion.json"
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception:
        raw = {}
    aliases = raw.get("aliases") if isinstance(raw, dict) else {}
    expansions = raw.get("expansions") if isinstance(raw, dict) else {}
    if not isinstance(aliases, dict):
        aliases = {}
    if not isinstance(expansions, dict):
        expansions = {}
    return {"aliases": aliases, "expansions": expansions}


def _tokenize(query: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", (query or "").lower())


def _dedupe_expansions(items: List[ExpandedMemoryQuery]) -> List[ExpandedMemoryQuery]:
    seen: set[tuple[str, str]] = set()
    ordered: List[ExpandedMemoryQuery] = []
    for item in items:
        query_type = str(item.get("type") or "").strip().lower()
        text = " ".join(str(item.get("text") or "").split()).strip()
        if not query_type or not text:
            continue
        key = (query_type, text.lower())
        if key in seen:
            continue
        seen.add(key)
        ordered.append(
            ExpandedMemoryQuery(
                type=query_type,  # type: ignore[arg-type]
                text=text,
                weight=float(item.get("weight") or 1.0),
            )
        )
    return ordered


def _semantic_variant_for_token(token: str, expansions: Dict[str, List[str]]) -> List[str]:
    results: List[str] = []
    for candidate in expansions.get(token, []) or []:
        normalized = " ".join(str(candidate).strip().lower().split())
        if normalized and normalized != token:
            results.append(normalized)
    return results


def _looks_semantic_or_broad(query: str, tokens: List[str]) -> bool:
    lower = (query or "").lower()
    if len(tokens) >= 5:
        return True
    semantic_phrases = (
        "what did i",
        "what was i",
        "worked on",
        "this morning",
        "this afternoon",
        "why",
        "how do",
        "how did",
        "where did",
    )
    return any(phrase in lower for phrase in semantic_phrases)


def _hyde_eval_gate_enabled() -> bool:
    raw = (os.getenv("RITUAL_MEMORY_HYDE_EVAL_ENABLED") or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _profile_values(query_profile: Optional[Dict[str, Any]], key: str, limit: int) -> List[str]:
    if not isinstance(query_profile, dict):
        return []
    values = query_profile.get(key)
    if not isinstance(values, list):
        return []
    normalized: List[str] = []
    seen: set[str] = set()
    for value in values:
        text = " ".join(str(value or "").split()).strip()
        lowered = text.lower()
        if not text or lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(text)
        if len(normalized) >= limit:
            break
    return normalized


def _route_specific_variants(
    *,
    normalized_query: str,
    intent: str,
    query_profile: Optional[Dict[str, Any]],
) -> tuple[List[str], List[str]]:
    intent_key = (intent or "auto").strip().lower()
    document_refs = _profile_values(query_profile, "document_refs", 3)
    artifact_refs = _profile_values(query_profile, "artifact_refs", 3)
    entity_refs = _profile_values(query_profile, "entity_refs", 4)
    task_phrases = _profile_values(query_profile, "task_phrases", 3)

    lexical_variants: List[str] = []
    semantic_variants: List[str] = []

    if intent_key in {"semantic_lookup", "evidence_timeline", "broad_overview"}:
        if document_refs:
            lexical_variants.append(" ".join(document_refs[:3]))
        if artifact_refs:
            lexical_variants.append(" ".join(artifact_refs[:3]))
        if task_phrases:
            semantic_variants.extend(task_phrases[:2])
        if entity_refs:
            semantic_variants.append(" ".join(entity_refs[:3]))

    if intent_key == "time_spent" and entity_refs:
        lexical_variants.append(" ".join(entity_refs[:3]))

    if intent_key == "broad_overview" and not semantic_variants:
        broad_hint = " ".join(
            value
            for value in [*entity_refs[:2], *task_phrases[:2]]
            if value
        ).strip()
        if broad_hint and broad_hint.lower() != normalized_query.lower():
            semantic_variants.append(broad_hint)

    return lexical_variants[:2], semantic_variants[:2]


def expand_memory_query(
    query: str,
    *,
    include_hyde: bool = False,
    intent: str = "auto",
    query_profile: Optional[Dict[str, Any]] = None,
) -> List[ExpandedMemoryQuery]:
    normalized_query = " ".join((query or "").split()).strip()
    tokens = _tokenize(normalized_query)
    if not normalized_query or not tokens:
        return []

    cfg = _load_config()
    aliases = cfg.get("aliases", {})
    expansions = cfg.get("expansions", {})

    lexical_variants: List[str] = []
    semantic_variants: List[str] = []
    seen_lexical = set(tokens)
    seen_semantic = {" ".join(tokens)}

    for token in tokens:
        for candidate in aliases.get(token, []) or []:
            normalized = " ".join(str(candidate).strip().lower().split())
            if normalized and normalized not in seen_lexical:
                lexical_variants.append(normalized)
                seen_lexical.add(normalized)
            if len(lexical_variants) >= 2:
                break
        if len(lexical_variants) >= 2:
            break

    for token in tokens:
        for candidate in _semantic_variant_for_token(token, expansions):
            if candidate not in seen_semantic:
                semantic_variants.append(candidate)
                seen_semantic.add(candidate)
            if len(semantic_variants) >= 2:
                break
        if len(semantic_variants) >= 2:
            break

    if _looks_semantic_or_broad(normalized_query, tokens) and len(semantic_variants) < 2:
        semantic_variants.append(normalized_query)

    route_lexical, route_semantic = _route_specific_variants(
        normalized_query=normalized_query,
        intent=intent,
        query_profile=query_profile,
    )
    for candidate in route_lexical:
        normalized = " ".join(str(candidate).strip().split())
        if normalized and normalized.lower() not in seen_lexical:
            lexical_variants.append(normalized)
            seen_lexical.add(normalized.lower())
    for candidate in route_semantic:
        normalized = " ".join(str(candidate).strip().split())
        if normalized and normalized.lower() not in seen_semantic:
            semantic_variants.append(normalized)
            seen_semantic.add(normalized.lower())

    expanded: List[ExpandedMemoryQuery] = [
        ExpandedMemoryQuery(type="original", text=normalized_query, weight=2.0),
    ]

    expanded.extend(
        ExpandedMemoryQuery(type="lex", text=text, weight=1.0)
        for text in lexical_variants[:2]
    )
    expanded.extend(
        ExpandedMemoryQuery(type="vec", text=text, weight=1.0)
        for text in semantic_variants[:2]
    )

    if include_hyde and _hyde_eval_gate_enabled() and _looks_semantic_or_broad(normalized_query, tokens):
        hyde = f"This context is about {normalized_query}."
        expanded.append(ExpandedMemoryQuery(type="hyde", text=hyde, weight=0.9))

    if len(expanded) == 1:
        expanded.append(ExpandedMemoryQuery(type="vec", text=normalized_query, weight=1.0))

    return _dedupe_expansions(expanded)


def expand_memory_query_text(query: str) -> str:
    expanded = expand_memory_query(query)
    if not expanded:
        return query
    ordered = [item["text"] for item in expanded if str(item.get("text") or "").strip()]
    return " ".join(ordered)
