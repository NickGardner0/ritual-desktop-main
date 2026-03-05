"""Reusable search and local bridge helpers for watcher screen search."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

SCREEN_SEARCH_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "did",
    "do",
    "for",
    "from",
    "had",
    "have",
    "how",
    "i",
    "in",
    "is",
    "it",
    "my",
    "of",
    "on",
    "show",
    "that",
    "this",
    "the",
    "to",
    "was",
    "were",
    "what",
    "when",
    "where",
    "which",
    "with",
    "yesterday",
    "today",
    "week",
    "month",
    "ago",
    "last",
    "past",
}

# Lightweight alias expansion improves recall for common topic wording mismatches.
TOKEN_ALIAS_MAP = {
    "auth": ["authentication", "login", "signin", "sign-in", "token", "oauth"],
    "authentication": ["auth", "login", "signin", "sign-in", "token", "oauth"],
    "login": ["signin", "sign-in", "auth", "authentication"],
    "signin": ["login", "sign-in", "auth", "authentication"],
    "sign-in": ["signin", "login", "auth", "authentication"],
    "bug": ["issue", "error", "fix"],
    "issue": ["bug", "error", "fix"],
    "landing": ["homepage", "home", "marketing"],
    "homepage": ["landing", "home", "marketing"],
    "repo": ["repository", "github", "git"],
    "repository": ["repo", "github", "git"],
}


def _split_compound_token(token: str) -> List[str]:
    # Split camelCase and alpha/number boundaries to match OCR tokenization variance.
    spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", token)
    spaced = re.sub(r"([0-9])([a-zA-Z])", r"\1 \2", spaced)
    spaced = re.sub(r"([a-zA-Z])([0-9])", r"\1 \2", spaced)
    return [part.lower() for part in spaced.split() if part]


def table_exists_impl(cursor, table_name: str) -> bool:
    cursor.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1
        """,
        (table_name,),
    )
    return cursor.fetchone() is not None


def extract_search_tokens_impl(query: str) -> List[str]:
    normalized = re.sub(r"[^a-z0-9.]+", " ", (query or "").lower())
    tokens: List[str] = []
    seen = set()
    for token in normalized.split():
        if len(token) < 3 or token in SCREEN_SEARCH_STOP_WORDS:
            continue
        if token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens


def expand_search_tokens_impl(query: str) -> List[str]:
    base_tokens = extract_search_tokens_impl(query)
    expanded: List[str] = []
    seen = set()

    for token in base_tokens:
        for part in _split_compound_token(token):
            if len(part) < 3 or part in SCREEN_SEARCH_STOP_WORDS or part in seen:
                continue
            seen.add(part)
            expanded.append(part)

        aliases = TOKEN_ALIAS_MAP.get(token, [])
        for alias in aliases:
            alias_clean = re.sub(r"[^a-z0-9.]+", "", alias.lower())
            if len(alias_clean) < 3 or alias_clean in SCREEN_SEARCH_STOP_WORDS or alias_clean in seen:
                continue
            seen.add(alias_clean)
            expanded.append(alias_clean)

    return expanded


def is_fts_syntax_error_impl(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "fts5" in message
        or "match" in message
        or "syntax error" in message
        or "malformed" in message
        or "unterminated" in message
    )


def escape_fts_phrase_impl(query: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\s]+", " ", query or "").strip()
    if not cleaned:
        return ""
    phrase = " ".join(cleaned.split())
    if not phrase:
        return ""
    escaped_phrase = phrase.replace('"', '""')
    return f"\"{escaped_phrase}\""


def build_expanded_fts_query_impl(query: str) -> str:
    raw = (query or "").strip()
    if not raw:
        return ""

    expanded_tokens = expand_search_tokens_impl(raw)
    if not expanded_tokens:
        return escape_fts_phrase_impl(raw)

    # Prefix matching allows recall when OCR captures partial/morphed terms.
    terms = [f"\"{token.replace('\"', '\"\"')}\"*" for token in expanded_tokens]
    if len(terms) == 1:
        return terms[0]
    return f"({' OR '.join(terms)})"


def score_lexical_match_impl(haystack: str, tokens: List[str]) -> float:
    if not tokens:
        return 0.0
    hits = sum(1 for token in tokens if token in haystack)
    return hits / max(len(tokens), 1)


def get_local_hybrid_bridge_url_impl() -> str:
    return os.environ.get(
        "RITUAL_LOCAL_SEARCH_BRIDGE_URL",
        "http://127.0.0.1:3031/v1/hybrid-search",
    )


def get_local_hybrid_bridge_token_path_impl() -> str:
    configured_path = os.environ.get("RITUAL_LOCAL_SEARCH_BRIDGE_TOKEN_PATH")
    if configured_path and configured_path.strip():
        return configured_path.strip()

    home = os.environ.get("HOME") or str(Path.home())
    return os.path.join(home, ".ritual", "local_search_bridge.token")


def get_local_hybrid_bridge_token_impl() -> Optional[str]:
    token_from_env = os.environ.get("RITUAL_LOCAL_SEARCH_BRIDGE_TOKEN")
    if token_from_env and token_from_env.strip():
        return token_from_env.strip()

    token_path = get_local_hybrid_bridge_token_path_impl()
    try:
        with open(token_path, "r", encoding="utf-8") as token_file:
            token_from_file = token_file.read().strip()
    except Exception:
        return None
    return token_from_file or None


async def search_screen_via_hybrid_bridge_impl(
    query: str,
    days_back: int,
    limit: int,
) -> Optional[Dict[str, Any]]:
    bridge_url = get_local_hybrid_bridge_url_impl()
    bridge_token = get_local_hybrid_bridge_token_impl()
    if not bridge_token:
        logger.info("Hybrid bridge token unavailable; skipping bridge call.")
        return None

    payload = {
        "query": query,
        "days_back": days_back,
        "limit": limit,
        "min_relevance": 0.3,
        "fts_weight": 0.3,
        "vector_weight": 0.7,
    }
    headers = {"X-Ritual-Bridge-Token": bridge_token}

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.post(bridge_url, json=payload, headers=headers)
    except Exception as exc:
        logger.info("Hybrid bridge unavailable (%s): %s", bridge_url, exc)
        return None

    if response.status_code == 401:
        logger.warning("Hybrid bridge authentication failed (token mismatch).")
        return None

    if response.status_code != 200:
        logger.warning(
            "Hybrid bridge returned %s: %s",
            response.status_code,
            response.text[:200],
        )
        return None

    try:
        data = response.json()
    except Exception as exc:
        logger.warning("Hybrid bridge invalid JSON: %s", exc)
        return None

    if not isinstance(data, dict):
        return None
    if not data.get("success"):
        logger.warning("Hybrid bridge reported failure: %s", data.get("error"))
        return None

    raw_results = data.get("results")
    if not isinstance(raw_results, list):
        return None

    normalized_results: List[Dict[str, Any]] = []
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        frame_id = item.get("frame_id")
        timestamp = item.get("timestamp")
        app_name = item.get("app_name")
        if frame_id is None or timestamp is None or app_name is None:
            continue
        try:
            normalized_results.append(
                {
                    "frame_id": int(frame_id),
                    "timestamp": int(timestamp),
                    "app_bundle_id": str(item.get("app_bundle_id") or ""),
                    "app_name": str(app_name),
                    "window_title": item.get("window_title"),
                    "ocr_text": str(item.get("ocr_text") or ""),
                    "relevance_score": float(item.get("relevance_score") or 0.0),
                    "source": "hybrid",
                    "fts_matched": bool(item.get("fts_matched")),
                }
            )
        except Exception:
            continue

    return {
        "success": True,
        "query": query,
        "days_back": int(data.get("days_back") or days_back),
        "result_count": len(normalized_results),
        "results": normalized_results,
        "mode_used": "hybrid",
        "status": "hybrid",
        "warning": data.get("warning"),
        "source_db": data.get("source_db"),
    }
