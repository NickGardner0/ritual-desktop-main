"""Shared query expansion helpers for cloud memory search."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, List


@lru_cache(maxsize=1)
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


def expand_memory_query_text(query: str) -> str:
    tokens = _tokenize(query)
    if not tokens:
        return query

    cfg = _load_config()
    aliases = cfg.get("aliases", {})
    expansions = cfg.get("expansions", {})

    seen = set(tokens)
    additions: List[str] = []

    for token in tokens:
        for candidate in aliases.get(token, []) or []:
            normalized = str(candidate).strip().lower()
            if normalized and normalized not in seen:
                additions.append(normalized)
                seen.add(normalized)

        for candidate in expansions.get(token, []) or []:
            normalized = str(candidate).strip().lower()
            if normalized and normalized not in seen:
                additions.append(normalized)
                seen.add(normalized)

    if not additions:
        return query
    return f"{query} {' '.join(additions)}"

