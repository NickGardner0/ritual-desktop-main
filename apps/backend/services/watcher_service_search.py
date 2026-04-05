"""Extracted local screen-search logic for WatcherService."""

from __future__ import annotations

import logging
import os
import random
import re
import sqlite3
import time
from datetime import date as dt_date
from datetime import datetime, time as dt_time, timedelta
from datetime import timezone as dt_timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from services.watcher_service_local_db import (
    get_local_activity_db_path_impl,
    get_local_memory_db_path_impl,
    get_local_watcher_db_path_impl,
)
from services import watcher_service_local_db
from services.watcher_service_search_utils import (
    SCREEN_SEARCH_STOP_WORDS,
    build_expanded_fts_query_impl,
    escape_fts_phrase_impl,
    expand_search_tokens_impl,
    extract_search_tokens_impl,
    is_fts_syntax_error_impl,
    score_lexical_match_impl,
    search_screen_via_hybrid_bridge_impl,
    table_exists_impl,
)
from services.memory_cloud_query_service import (
    memory_cloud_enabled,
    memory_fail_closed,
    query_semantic_cloud,
)
from services.memory_query_expansion import expand_memory_query
from services.memory_story_service import (
    build_query_semantic_profile,
    build_story_plan,
    enrich_story_evidence,
)
from services.semantic_work_item_service import (
    load_semantic_work_items_for_range,
    materialize_semantic_work_items,
)
from services.memory_embedding_service import (
    get_memory_index_health,
    process_embedding_jobs_with_guard,
)
from services.session_embedding_service import process_session_embeddings

logger = logging.getLogger(__name__)


def _env_flag_enabled(name: str, *, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _legacy_memory_query_path_enabled() -> bool:
    """Opt back into the old memory.db-first query path if Phase 1 needs rollback."""
    return _env_flag_enabled("RITUAL_ENABLE_LEGACY_MEMORY_DB_QUERY", default=False)


def _legacy_ocr_fallback_enabled() -> bool:
    """Gate legacy OCR fallback behind an explicit env flag. Production default is off."""
    return _env_flag_enabled("RITUAL_ENABLE_LEGACY_OCR_FALLBACK", default=False)


def _cloud_first_chat_enabled() -> bool:
    return not _env_flag_enabled("RITUAL_DISABLE_CLOUD_FIRST_CHAT", default=False)


def _prefer_explicit_local_context_db(path: str) -> bool:
    """Honor explicit local DB overrides in dev/test before shared backend replicas."""
    if not path:
        return False
    try:
        resolved = Path(path).expanduser().resolve()
    except Exception:
        resolved = Path(path)

    ritual_dir = Path.home() / ".ritual"
    try:
        ritual_dir = ritual_dir.resolve()
    except Exception:
        pass

    if str(resolved).startswith(str(ritual_dir)):
        return False
    return resolved.exists()


OVERVIEW_TIME_HINTS = (
    "today",
    "yesterday",
    "this morning",
    "this afternoon",
    "this evening",
    "tonight",
    "this week",
    "last week",
    "past week",
    "this month",
    "last month",
    "past month",
    "recent",
    "lately",
    "last ",
    "past ",
    "this ",
)

OVERVIEW_INTENT_PHRASES = (
    "what did i do",
    "what was i doing",
    "what was i working on",
    "how did i spend my time",
    "where did my time go",
    "activity overview",
    "activity recap",
    "screen recap",
    "screen overview",
    "computer activity recap",
    "computer activity overview",
)

GENERIC_OVERVIEW_TOKENS = {
    "this",
    "that",
    "doing",
    "working",
    "work",
    "activity",
    "activities",
    "computer",
    "screen",
    "time",
    "summary",
    "overview",
    "recap",
    "recent",
    "lately",
}

VALID_MEMORY_INTENTS = {
    "auto",
    "time_spent",
    "semantic_lookup",
    "evidence_timeline",
    "broad_overview",
}

MEMORY_TIME_SPENT_HINTS = (
    "how much time",
    "where did my time go",
    "spend my time",
    "time breakdown",
    "top apps",
    "top websites",
    "computer time",
)

MEMORY_EVIDENCE_HINTS = (
    "show evidence",
    "show timestamps",
    "show timeline",
    "evidence",
    "timeline",
)

MEMORY_SEMANTIC_HINTS = (
    "when did i",
    "when was i",
    "last worked on",
    "last time i",
    "find where",
    "find when",
    "show me when",
    "what was i looking at",
)

MEMORY_BROAD_HINTS = (
    "what did i do today",
    "what did i do this week",
    "what did i do this month",
    "what was i doing",
    "activity recap",
    "activity overview",
    "weekly recap",
    "monthly recap",
)

MEMORY_TOPIC_INTENT_WORDS = {
    "about",
    "activity",
    "activities",
    "ago",
    "all",
    "app",
    "apps",
    "around",
    "computer",
    "day",
    "did",
    "do",
    "doing",
    "evidence",
    "find",
    "go",
    "have",
    "how",
    "i",
    "in",
    "is",
    "last",
    "latest",
    "look",
    "looking",
    "me",
    "month",
    "my",
    "on",
    "past",
    "recent",
    "screen",
    "search",
    "show",
    "spent",
    "spend",
    "that",
    "this",
    "time",
    "timeline",
    "today",
    "week",
    "what",
    "when",
    "where",
    "which",
    "work",
    "worked",
    "working",
    "yesterday",
}

MEMORY_TOPIC_WEAK_TOKENS = {
    "app",
    "apps",
    "bug",
    "code",
    "desktop",
    "file",
    "page",
    "pages",
    "project",
    "screen",
    "site",
    "task",
    "tab",
    "website",
    "window",
}

MEMORY_STATUS_FALLBACK = {
    "healthy": "full_hybrid",
    "degraded_semantic": "fts_only",
    "degraded_ocr": "fts_only",
    "stale": "stale_guard",
    "unavailable": "unavailable",
}

_LAST_AUTO_BACKFILL_MS = 0

LOW_SIGNAL_BROWSER_DOMAINS = {
    "chat.openai.com",
    "chatgpt.com",
    "x.com",
    "pinterest.com",
    "www.pinterest.com",
    "twitter.com",
    "youtube.com",
    "news.ycombinator.com",
}

LOW_SIGNAL_WINDOW_PATTERNS = (
    "chatgpt - google chrome",
    "notifications / x",
    "pin on work",
    "pinterest",
    "search / x",
    "quote, forecast, charts & news",
    "home / x",
)

LOW_SIGNAL_SNIPPET_PATTERNS = (
    "archive thread",
    "ask for follow-up changes",
    "chat history",
    "dashboard | ritual",
    "deep research",
    "dictate",
    "favorites",
    "file explorer",
    "new chat",
    "posted in:",
    "search chats",
    "please try again",
    "recents",
    "refactor preview",
    "skip to content",
    "skip to main content",
    "subscribe",
    "to view keyboard shortcuts",
    "verify",
    "accessibility links skip to main content",
    "window.__",
    "placeholderresourcesuspensessrhandler",
    "jump to position",
    "prediction markets",
    "create watchlist",
    "caffeine consumption",
    "sleep duration",
    "nicotine consumption",
    "morning workout",
    "computer time",
    "screen time",
)

LOW_SIGNAL_OVERVIEW_MARKERS = (
    "accessibility links",
    "add files and more",
    "archive thread",
    "ask for follow-up changes",
    "dashboard ritual",
    "dictate",
    "file explorer",
    "new chat",
    "posted in",
    "prediction markets",
    "recents",
    "screen time",
    "sleep duration",
    "computer time",
    "caffeine consumption",
    "nicotine consumption",
    "morning workout",
    "to view keyboard shortcuts",
)


# Domain-specific token sets for multi-query fan-out on overview queries.
# Each set targets a different activity domain so that candidates from all
# parts of the user's day get competitive lexical scores (instead of only
# matching the generic "work" / "today" tokens from the user's query).
_OVERVIEW_DOMAIN_TOKEN_SETS: List[List[str]] = [
    ["code", "file", "function", "error", "debug", "build", "commit", "edit", "cursor", "codex"],
    ["task", "todo", "plan", "project", "ticket", "things", "reminder"],
    ["browser", "chrome", "safari", "search", "article", "page", "website", "read"],
    ["email", "message", "chat", "slack", "gmail", "meeting", "zoom", "teams"],
    ["terminal", "command", "npm", "python", "cargo", "git", "deploy", "docker"],
    ["design", "figma", "sketch", "layout", "mockup", "v0", "interface"],
]


def _overview_fanout_lexical_score(haystack: str, original_tokens: List[str]) -> float:
    """Score a candidate against the original tokens AND all domain token sets.

    Returns the maximum lexical score achieved across the original query tokens
    and each domain-specific token set.  This ensures that a candidate about
    e.g. "email" in Gmail gets a real score even when the user's query was the
    generic "what did I work on today?".
    """
    best = score_lexical_match_impl(haystack, original_tokens)
    for domain_tokens in _OVERVIEW_DOMAIN_TOKEN_SETS:
        score = score_lexical_match_impl(haystack, domain_tokens)
        if score > best:
            best = score
    return best


def _normalized_semantic_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _query_mentions_daypart(query: str) -> bool:
    normalized = (query or "").strip().lower()
    return any(
        phrase in normalized
        for phrase in (
            "this morning",
            "this afternoon",
            "this evening",
            "yesterday morning",
            "yesterday afternoon",
            "yesterday evening",
            "yesterday night",
            "tonight",
        )
    )


def _looks_like_work_recap_query(query: str) -> bool:
    normalized = _normalized_match_text(query)
    return any(
        phrase in normalized
        for phrase in (
            "what did i work on",
            "what was i working on",
            "what work did i do",
            "what did i do for work",
            "worked on today",
        )
    )


def _is_worklike_browser_candidate(
    *,
    window_title: str,
    document_title: str,
    browser_domain: str,
    snippet: str,
) -> bool:
    focused_snippet = " ".join(str(snippet or "").split())[:280]
    haystack = _normalized_match_text(" ".join([window_title, document_title, browser_domain, focused_snippet]))
    positive_markers = (
        "activity breakdown",
        "calendar page",
        "component",
        "contribution graph",
        "dashboard",
        "design system",
        "docs",
        "github",
        "kanban",
        "kanbn",
        "landing page",
        "paper",
        "repo",
        "ritual",
        "sparkline",
        "trello",
        "v0",
    )
    negative_markers = (
        "ambient",
        "comments",
        "deep work music",
        "home shorts subscriptions",
        "ideas for you",
        "liked videos",
        "pinterest",
        "prediction markets",
        "recent searches",
        "shorts",
        "youtube",
    )
    consumer_domains = {"mail.google.com", "netflix.com", "pinterest.com", "reddit.com", "www.pinterest.com", "youtube.com"}
    if str(browser_domain or "").strip().lower() in consumer_domains:
        explicit_work_artifacts = ("component", "github.com/", "kanban", "kanbn", "paper.design", "repo", "ritual", "tailwind", "v0.app/")
        return any(marker in haystack for marker in explicit_work_artifacts)
    if any(marker in haystack for marker in positive_markers):
        return True
    if any(marker in haystack for marker in negative_markers):
        return False
    return False


def _resolve_query_time_bounds(
    *,
    start_day: dt_date,
    end_day: dt_date,
    query: str,
) -> Tuple[int, int]:
    normalized = (query or "").strip().lower()
    start_dt = datetime.combine(start_day, dt_time.min)
    end_dt = datetime.combine(end_day, dt_time.max)

    if "this morning" in normalized or "yesterday morning" in normalized:
        start_dt = datetime.combine(end_day, dt_time(hour=5))
        end_dt = datetime.combine(end_day, dt_time(hour=11, minute=59, second=59, microsecond=999999))
    elif "this afternoon" in normalized or "yesterday afternoon" in normalized:
        start_dt = datetime.combine(end_day, dt_time(hour=12))
        end_dt = datetime.combine(end_day, dt_time(hour=17, minute=59, second=59, microsecond=999999))
    elif (
        "this evening" in normalized
        or "yesterday evening" in normalized
        or "yesterday night" in normalized
        or "tonight" in normalized
    ):
        start_dt = datetime.combine(end_day, dt_time(hour=18))
        end_dt = datetime.combine(end_day, dt_time.max)

    return int(start_dt.timestamp() * 1000), int(end_dt.timestamp() * 1000)


def _is_low_signal_overview_row(
    *,
    query: str,
    app_name: str,
    window_title: str,
    document_title: str,
    browser_domain: str,
    snippet: str,
    semantic_boost: float,
) -> bool:
    normalized_domain = str(browser_domain or "").strip().lower()
    normalized_title = str(window_title or "").strip().lower()
    normalized_document = str(document_title or "").strip().lower()
    normalized_snippet = str(snippet or "").strip().lower()
    normalized_app = str(app_name or "").strip().lower()
    normalized_query = _normalized_match_text(query)
    haystack = _normalized_match_text(" ".join([normalized_title, normalized_document, normalized_snippet]))
    worklike_markers = (
        "activity breakdown",
        "calendar page",
        "component",
        "contribution graph",
        "design system",
        "docs",
        "github",
        "kanban",
        "landing page",
        "paper",
        "repo",
        "ritual",
        "sparkline",
        "trello",
        "v0",
    )
    has_worklike_marker = any(marker in haystack for marker in worklike_markers)

    if normalized_app in {"loginwindow", "ritual-desktop"} and any(marker in haystack for marker in LOW_SIGNAL_OVERVIEW_MARKERS):
        return True
    if normalized_app == "ritual-desktop" and any(pattern in normalized_snippet for pattern in LOW_SIGNAL_SNIPPET_PATTERNS):
        return True
    if normalized_app in {"codex", "chatgpt", "ritual-desktop"} and any(
        pattern in normalized_snippet for pattern in LOW_SIGNAL_SNIPPET_PATTERNS
    ):
        return True
    if normalized_query and len(normalized_query.split()) >= 4 and normalized_query in haystack:
        return True

    # Semantic boost escape hatch — if the row has strong semantic relevance, keep it
    if semantic_boost >= 0.12:
        return False

    # Non-browser apps (Cursor, VS Code, Terminal, etc.) are generally high-signal work
    # Only filter them if they're known noise sources (loginwindow, ritual-desktop handled above)
    is_browser = normalized_app in {"google chrome", "chrome", "safari", "arc", "firefox"} or bool(normalized_domain)
    if not is_browser:
        return False

    # Browser-specific filtering below
    if any(pattern in normalized_title for pattern in LOW_SIGNAL_WINDOW_PATTERNS):
        return True
    if any(pattern in normalized_snippet for pattern in LOW_SIGNAL_SNIPPET_PATTERNS):
        return True
    if any(marker in haystack for marker in LOW_SIGNAL_OVERVIEW_MARKERS):
        return True
    if normalized_domain in {"pinterest.com", "www.pinterest.com"} and not has_worklike_marker:
        return True
    if "chatgpt - google chrome" in normalized_title and any(
        phrase in normalized_snippet
        for phrase in (
            "can you write me",
            "do you want to allow",
            "ideally i would like you to",
            "what did i work on today",
        )
    ):
        return True

    if normalized_domain in LOW_SIGNAL_BROWSER_DOMAINS and not has_worklike_marker:
        return True
    return False


def _select_diverse_context_results(
    rows: List[Dict[str, Any]],
    *,
    limit: int,
    overview_mode: bool = False,
) -> List[Dict[str, Any]]:
    if len(rows) <= limit:
        return rows

    # Overview mode allows more evidence per app/window/bucket so the
    # story planner gets broader coverage of the full day.
    max_per_app = 5 if overview_mode else 3
    max_per_window = 3 if overview_mode else 2
    max_per_bucket = 4 if overview_mode else 3

    selected: List[Dict[str, Any]] = []
    per_app: Dict[str, int] = {}
    per_window: Dict[str, int] = {}
    per_bucket: Dict[int, int] = {}
    seen_semantic_keys: set[str] = set()

    for row in rows:
        app_key = str(row.get("app_name") or "Unknown")
        window_key = str(row.get("window_title") or row.get("document_title") or app_key)
        bucket_key = int(int(row.get("timestamp") or 0) / (15 * 60 * 1000))
        snippet_key = _normalized_semantic_key(str(row.get("snippet") or ""))[:120]
        semantic_key = "|".join(
            part
            for part in (
                app_key.lower(),
                _normalized_semantic_key(window_key),
                snippet_key,
            )
            if part
        )

        if semantic_key and semantic_key in seen_semantic_keys:
            continue
        if per_app.get(app_key, 0) >= max_per_app:
            continue
        if per_window.get(window_key, 0) >= max_per_window:
            continue
        if per_bucket.get(bucket_key, 0) >= max_per_bucket:
            continue

        selected.append(row)
        if semantic_key:
            seen_semantic_keys.add(semantic_key)
        per_app[app_key] = per_app.get(app_key, 0) + 1
        per_window[window_key] = per_window.get(window_key, 0) + 1
        per_bucket[bucket_key] = per_bucket.get(bucket_key, 0) + 1

        if len(selected) >= limit:
            break

    if len(selected) < limit:
        seen_keys = {
            (int(row.get("timestamp") or 0), str(row.get("app_name") or ""), str(row.get("window_title") or ""))
            for row in selected
        }
        for row in rows:
            key = (int(row.get("timestamp") or 0), str(row.get("app_name") or ""), str(row.get("window_title") or ""))
            if key in seen_keys:
                continue
            selected.append(row)
            seen_keys.add(key)
            if len(selected) >= limit:
                break

    return selected


def _semantic_overlap_score(query_profile: Dict[str, Any], candidate: Dict[str, Any]) -> Tuple[float, Dict[str, float]]:
    candidate_enriched = enrich_story_evidence(candidate)
    query_documents = {_normalized_semantic_key(value) for value in query_profile.get("document_refs") or [] if _normalized_semantic_key(value)}
    query_entities = {_normalized_semantic_key(value) for value in query_profile.get("entity_refs") or [] if _normalized_semantic_key(value)}
    query_tasks = {_normalized_semantic_key(value) for value in query_profile.get("task_phrases") or [] if _normalized_semantic_key(value)}
    query_artifacts = {_normalized_semantic_key(value) for value in query_profile.get("artifact_refs") or [] if _normalized_semantic_key(value)}
    query_tokens = set(query_profile.get("tokens") or [])

    candidate_documents = {_normalized_semantic_key(value) for value in candidate_enriched.get("document_refs") or [] if _normalized_semantic_key(value)}
    candidate_entities = {_normalized_semantic_key(value) for value in candidate_enriched.get("project_refs") or [] if _normalized_semantic_key(value)}
    candidate_tasks = {_normalized_semantic_key(value) for value in candidate_enriched.get("task_phrases") or [] if _normalized_semantic_key(value)}
    candidate_artifacts = {_normalized_semantic_key(value) for value in candidate_enriched.get("artifact_refs") or [] if _normalized_semantic_key(value)}

    document_overlap = 1.0 if (query_documents & candidate_documents or query_artifacts & candidate_artifacts) else 0.0
    entity_overlap = 1.0 if query_entities & candidate_entities else 0.0
    task_overlap = 1.0 if query_tasks & candidate_tasks else 0.0
    app_overlap = 1.0 if str(candidate.get("app_name") or "").lower() in query_tokens else 0.0
    return (
        (0.16 * document_overlap) + (0.08 * entity_overlap) + (0.08 * task_overlap) + (0.04 * app_overlap),
        {
            "document_overlap": document_overlap,
            "entity_overlap": entity_overlap,
            "task_overlap": task_overlap,
            "app_overlap": app_overlap,
        },
    )


def _memory_shadow_enabled() -> bool:
    return (os.getenv("RITUAL_MEMORY_SHADOW_MODE") or "").strip().lower() in {"1", "true", "yes", "on"}


def _memory_shadow_sample_rate() -> float:
    raw = (os.getenv("RITUAL_MEMORY_SHADOW_SAMPLE_RATE") or "0.2").strip()
    try:
        return max(0.0, min(1.0, float(raw)))
    except Exception:
        return 0.2


async def _auto_backfill_cloud_if_needed(
    *,
    user_id: str,
    start_ms: int,
    end_ms: int,
) -> Optional[str]:
    global _LAST_AUTO_BACKFILL_MS
    now_ms = int(time.time() * 1000)
    min_interval_ms = 15 * 60 * 1000
    if (now_ms - _LAST_AUTO_BACKFILL_MS) < min_interval_ms:
        return None

    try:
        health = get_memory_index_health()
    except Exception:
        return None

    total_chunks = int(health.get("total_chunks") or 0)
    coverage = float(health.get("coverage") or 0.0)
    pending_jobs = int(health.get("pending_jobs") or 0)
    embedding_lag_seconds = int(health.get("embedding_lag_seconds") or 0)

    # Keep query-time catch-up light; if backlog is large, only drain small slices.
    if pending_jobs >= 1500 and (coverage < 0.95 or embedding_lag_seconds > 180):
        _LAST_AUTO_BACKFILL_MS = now_ms
        drain_batch = min(256, max(64, pending_jobs // 10))
        drain_result = await process_embedding_jobs_with_guard(batch_size=drain_batch)
        drained = int(drain_result.get("processed") or 0)
        if drained > 0:
            return f"Cloud memory index is catching up ({drained} queued chunks embedded)."
        return None

    should_backfill = (
        pending_jobs > 0
        and (
            total_chunks < 800
            or coverage < 0.75
            or embedding_lag_seconds > 300
        )
        and pending_jobs < 1500
    )
    if not should_backfill:
        return None

    _LAST_AUTO_BACKFILL_MS = now_ms
    result = await process_session_embeddings(
        user_id=user_id,
        batch_size=128,
        start_ms=start_ms,
        end_ms=end_ms,
    )
    processed = int(result.get("processed") or 0)
    failed = int(result.get("failed") or 0)
    if processed <= 0:
        return None
    if failed > 0:
        return f"Cloud memory index is catching up ({processed} session docs indexed, {failed} failed)."
    return f"Cloud memory index is catching up ({processed} session docs indexed)."


def _resolve_answer_mode(status: str, intent: str) -> str:
    normalized_status = (status or "healthy").strip().lower()
    normalized_intent = (intent or "semantic_lookup").strip().lower()

    if normalized_intent == "time_spent":
        return "activity_only"

    base_mode = MEMORY_STATUS_FALLBACK.get(normalized_status, "full_hybrid")
    if normalized_status != "degraded_ocr":
        return base_mode

    if normalized_intent in {"semantic_lookup", "evidence_timeline", "broad_overview"}:
        return "fts_only"
    return base_mode


def _looks_like_activity_overview_query(query: str, tokens: List[str]) -> bool:
    normalized = (query or "").strip().lower()
    if not normalized:
        return False

    has_time_hint = any(hint in normalized for hint in OVERVIEW_TIME_HINTS)
    has_overview_phrase = any(phrase in normalized for phrase in OVERVIEW_INTENT_PHRASES)
    has_summary_word = any(word in normalized for word in ("summary", "summarize", "overview", "recap"))
    has_work_recap_phrase = _looks_like_work_recap_query(normalized)

    specific_tokens = [token for token in tokens if token not in GENERIC_OVERVIEW_TOKENS]

    if has_overview_phrase:
        return True
    if has_work_recap_phrase and has_time_hint:
        return True
    if has_summary_word and has_time_hint:
        return True
    if has_time_hint and len(specific_tokens) == 0:
        return True
    return False


def _attach_activity_view_if_needed(
    cursor: sqlite3.Cursor,
    *,
    memory_db_path: str,
    activity_db_path: str,
) -> None:
    """
    In split-DB mode, map `activity_events` reads to activity.db while keeping
    OCR/chunk reads on memory.db.
    """
    if not activity_db_path or activity_db_path == memory_db_path:
        return
    if not os.path.exists(activity_db_path):
        return
    try:
        cursor.execute(
            """
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table' AND name = 'activity_events'
            LIMIT 1
            """
        )
        if cursor.fetchone() is not None:
            return
    except Exception:
        return
    try:
        cursor.execute("ATTACH DATABASE ? AS activity_db", (activity_db_path,))
        cursor.execute("DROP VIEW IF EXISTS temp.activity_events")
        cursor.execute("CREATE TEMP VIEW activity_events AS SELECT * FROM activity_db.activity_events")
    except Exception as exc:
        logger.warning(
            "Failed to attach activity.db (%s) to memory DB query connection: %s",
            activity_db_path,
            exc,
        )


def _normalized_match_text(value: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9./:_-]+", str(value or "").lower()))


def _exact_context_match_score(query: str, values: List[Any]) -> float:
    normalized_query = _normalized_match_text(query)
    if not normalized_query:
        return 0.0
    haystack = " ".join(_normalized_match_text(value) for value in values if value)
    if not haystack:
        return 0.0
    if normalized_query in haystack:
        return 1.0
    query_tokens = [token for token in normalized_query.split() if token]
    if not query_tokens:
        return 0.0
    hits = sum(1 for token in query_tokens if token in haystack)
    if hits == len(query_tokens) and len(query_tokens) >= 2:
        return 0.9
    return 0.0


def _looks_like_exact_lookup_query(query: str) -> bool:
    normalized = (query or "").strip().lower()
    if not normalized:
        return False
    if "://" in normalized or "/" in normalized:
        return True
    if re.search(r"\b[\w.-]+\.(py|ts|tsx|js|jsx|rs|md|json|toml|yml|yaml|swift|kt|go|rb|java|css|html)\b", normalized):
        return True
    if "." in normalized and len(normalized.split()) <= 4:
        return True
    return False


def _looks_like_app_drilldown_query(query: str) -> bool:
    normalized = (query or "").strip().lower()
    if not normalized:
        return False
    if any(phrase in normalized for phrase in ("what happened in ", "what did i do in ", "what was i doing in ")):
        return True
    return any(token in normalized for token in (" in cursor", " in codex", " in slack", " in chrome", " in terminal"))


APP_DRILLDOWN_SCOPES: Dict[str, Tuple[str, ...]] = {
    "cursor": ("cursor", "cursor.sh", "cursor -", "com.todesktop.230313mzl4w4u92"),
    "codex": ("codex",),
    "slack": ("slack",),
    "terminal": ("terminal", "iterm", "iterm2", "warp", "zsh", "bash", "fish"),
    "chrome": ("chrome", "google chrome"),
}


def _extract_requested_app_scope(query: str) -> Optional[str]:
    normalized = (query or "").strip().lower()
    if not normalized:
        return None
    for app_key, aliases in APP_DRILLDOWN_SCOPES.items():
        if any(
            f" in {alias}" in normalized
            or normalized.endswith(alias)
            or normalized.startswith(alias)
            or f" {alias} " in normalized
            for alias in aliases
        ):
            return app_key
    return None


def _result_matches_app_scope(row: Dict[str, Any], app_scope: Optional[str]) -> bool:
    if not app_scope:
        return False
    aliases = APP_DRILLDOWN_SCOPES.get(app_scope, (app_scope,))
    haystack = " ".join(
        [
            str(row.get("app_name") or ""),
            str(row.get("app_bundle_id") or ""),
            str(row.get("window_title") or ""),
            str(row.get("document_title") or ""),
            str(row.get("document_path") or ""),
            str(row.get("snippet") or row.get("ocr_text") or ""),
        ]
    ).lower()
    return any(alias in haystack for alias in aliases)


def _prioritize_app_scope_results(
    rows: List[Dict[str, Any]],
    app_scope: Optional[str],
    *,
    hard_filter: bool,
) -> List[Dict[str, Any]]:
    if not rows or not app_scope:
        return rows
    matching = [row for row in rows if _result_matches_app_scope(row, app_scope)]
    if not matching:
        return rows
    if hard_filter:
        return matching
    nonmatching = [row for row in rows if not _result_matches_app_scope(row, app_scope)]
    return matching + nonmatching


def _build_local_context_budgets(query: str, intent: str, requested_limit: int) -> Dict[str, Any]:
    if _looks_like_exact_lookup_query(query):
        return {
            "kind": "exact_lookup",
            "allowed_query_types": {"original", "lex"},
            "expanded_query_limit": 2,
            "session_candidate_limit": min(max(requested_limit * 3, 40), 120),
            "snapshot_candidate_limit": min(max(requested_limit * 4, 60), 180),
            "final_limit": min(max(requested_limit, 1), 12),
            "citation_limit": 12,
        }
    if _looks_like_app_drilldown_query(query):
        return {
            "kind": "app_drilldown",
            "allowed_query_types": {"original", "lex", "vec"},
            "expanded_query_limit": 3,
            "session_candidate_limit": min(max(requested_limit * 4, 60), 180),
            "snapshot_candidate_limit": min(max(requested_limit * 6, 90), 240),
            "final_limit": min(max(requested_limit, 1), 20),
            "citation_limit": 20,
        }
    if intent == "broad_overview" or _query_mentions_daypart(query):
        return {
            "kind": "broad_overview",
            "allowed_query_types": {"original", "lex", "vec"},
            "expanded_query_limit": 5,
            "session_candidate_limit": min(max(requested_limit * 8, 200), 800),
            "snapshot_candidate_limit": min(max(requested_limit * 14, 300), 1200),
            "final_limit": min(max(requested_limit, 1), 64),
            "citation_limit": 48,
        }
    return {
        "kind": "topic_lookup",
        "allowed_query_types": {"original", "lex", "vec"},
        "expanded_query_limit": 3,
        "session_candidate_limit": min(max(requested_limit * 4, 60), 180),
        "snapshot_candidate_limit": min(max(requested_limit * 6, 90), 260),
        "final_limit": min(max(requested_limit, 1), 20),
        "citation_limit": 20,
    }


def _derive_parent_context(
    *,
    app_name: str,
    browser_domain: str,
    document_title: Optional[str],
    window_title: Optional[str],
    contextual_retrieval_text: str = "",
) -> Optional[str]:
    contextual = " ".join(str(contextual_retrieval_text or "").split())
    if contextual.lower().startswith("context:"):
        context_text = contextual[len("Context:") :].strip()
        if "|" in context_text:
            context_text = context_text.split("|", 1)[0].strip()
        if context_text:
            return context_text[:240]
    parts = [
        str(app_name or "").strip(),
        str(browser_domain or "").strip(),
        str(document_title or "").strip() or str(window_title or "").strip(),
    ]
    parent_context = " / ".join(part for part in parts if part)
    return parent_context[:240] if parent_context else None


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


def _load_snapshot_semantic_summaries(cursor, session_ids: List[int]) -> Dict[int, str]:
    clean_session_ids = sorted({int(session_id) for session_id in session_ids if int(session_id) > 0})
    if not clean_session_ids:
        return {}
    if not table_exists_impl(cursor, "context_snapshots"):
        return {}
    if not _table_has_column(cursor, "context_snapshots", "semantic_summary"):
        return {}

    placeholders = ",".join("?" for _ in clean_session_ids)
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
        tuple(clean_session_ids),
    ).fetchall()
    return {
        int(row["session_id"]): str(row["semantic_summary"] or "").strip()
        for row in rows
        if int(row["session_id"] or 0) > 0 and str(row["semantic_summary"] or "").strip()
    }


def _attach_snapshot_semantic_summaries(cursor, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    summaries = _load_snapshot_semantic_summaries(
        cursor,
        [int(item.get("session_id") or item.get("session_key") or 0) for item in items],
    )
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


def _context_signal_summary(cursor, *, recent_cutoff_ms: int) -> Dict[str, int]:
    summary = {
        "session_docs_total": 0,
        "session_docs_recent": 0,
        "snapshots_total": 0,
        "snapshots_recent": 0,
        "combined_total": 0,
        "combined_recent": 0,
    }

    try:
        if table_exists_impl(cursor, "session_retrieval_docs"):
            row = cursor.execute("SELECT COUNT(*) FROM session_retrieval_docs").fetchone()
            summary["session_docs_total"] = int(row[0] or 0) if row else 0
            row = cursor.execute(
                """
                SELECT COUNT(*)
                FROM session_retrieval_docs
                WHERE chunk_end_ts >= ?
                """,
                (recent_cutoff_ms,),
            ).fetchone()
            summary["session_docs_recent"] = int(row[0] or 0) if row else 0
    except Exception:
        pass

    try:
        if table_exists_impl(cursor, "context_snapshots"):
            row = cursor.execute("SELECT COUNT(*) FROM context_snapshots").fetchone()
            summary["snapshots_total"] = int(row[0] or 0) if row else 0
            row = cursor.execute(
                """
                SELECT COUNT(*)
                FROM context_snapshots
                WHERE ts >= ?
                """,
                (recent_cutoff_ms,),
            ).fetchone()
            summary["snapshots_recent"] = int(row[0] or 0) if row else 0
    except Exception:
        pass

    summary["combined_total"] = summary["session_docs_total"] + summary["snapshots_total"]
    summary["combined_recent"] = summary["session_docs_recent"] + summary["snapshots_recent"]
    return summary


def _should_prefer_local_activity_context(
    preferred_summary: Dict[str, int],
    local_summary: Dict[str, int],
) -> bool:
    local_total = int(local_summary.get("combined_total") or 0)
    local_recent = int(local_summary.get("combined_recent") or 0)
    preferred_total = int(preferred_summary.get("combined_total") or 0)
    preferred_recent = int(preferred_summary.get("combined_recent") or 0)

    if local_total <= 0:
        return False
    if preferred_total <= 0 and local_total > 0:
        return True
    if preferred_recent <= 0 and local_recent >= 5:
        return True
    if local_recent >= max(preferred_recent * 2, preferred_recent + 20) and local_total >= preferred_total:
        return True
    if local_total >= max(preferred_total * 3, preferred_total + 500):
        return True
    return False


def _maybe_open_richer_local_activity_context(
    *,
    current_cursor,
    activity_db_path: str,
    recent_cutoff_ms: int,
    current_source_label: str,
) -> tuple[Optional[sqlite3.Connection], Optional[sqlite3.Cursor], Optional[str]]:
    if not activity_db_path or not os.path.exists(activity_db_path):
        return None, None, None
    if current_source_label != "activity_per_user_replica":
        return None, None, None

    preferred_summary = _context_signal_summary(current_cursor, recent_cutoff_ms=recent_cutoff_ms)
    local_conn = sqlite3.connect(
        f"file:{activity_db_path}?mode=ro",
        uri=True,
        timeout=2.5,
    )
    local_conn.row_factory = sqlite3.Row
    local_cursor = local_conn.cursor()
    local_cursor.execute("PRAGMA query_only = ON")
    local_summary = _context_signal_summary(local_cursor, recent_cutoff_ms=recent_cutoff_ms)

    if not _should_prefer_local_activity_context(preferred_summary, local_summary):
        local_conn.close()
        return None, None, None

    warning = (
        "Per-user context replica is sparse compared with the local activity DB; "
        "using the richer local context source for recap retrieval."
    )
    logger.info(
        "Promoting local activity DB for context retrieval: preferred=%s local=%s",
        preferred_summary,
        local_summary,
    )
    return local_conn, local_cursor, warning


async def search_context_memory_impl(
    service,
    user_id: str,
    query: str,
    days_back: int = 7,
    limit: int = 20,
    allow_legacy_fallback: bool = True,
) -> Dict[str, Any]:
    normalized_query = (query or "").strip()
    if not normalized_query:
        return {
            "success": False,
            "error": "query is required",
            "results": [],
            "mode_used": "none",
            "status": "unavailable",
        }

    start_day, end_day, safe_days_back = _resolve_query_window(
        days_back=days_back,
        start_date=None,
        end_date=None,
        query=normalized_query,
    )
    safe_limit = max(1, min(int(limit or 20), 50))
    cutoff_ms, query_window_end_ms = _resolve_query_time_bounds(
        start_day=start_day,
        end_day=end_day,
        query=normalized_query,
    )
    window_end_ms = query_window_end_ms
    now_ms = int(time.time() * 1000)
    window_end_ms = min(window_end_ms, now_ms)
    resolved_intent = _detect_memory_intent(normalized_query, "auto")
    local_budgets = _build_local_context_budgets(normalized_query, resolved_intent, safe_limit)
    requested_app_scope = (
        _extract_requested_app_scope(normalized_query)
        if local_budgets["kind"] == "app_drilldown"
        else None
    )
    expanded_queries = [
        item
        for item in expand_memory_query(normalized_query, include_hyde=False)
        if str(item.get("type") or "") in local_budgets["allowed_query_types"]
    ][: int(local_budgets["expanded_query_limit"])]
    if not expanded_queries:
        expanded_queries = [{"type": "original", "text": normalized_query, "weight": 2.0}]
    tokens: List[str] = []
    seen_tokens: set[str] = set()
    for expanded in expanded_queries:
        for token in expand_search_tokens_impl(str(expanded.get("text") or "")):
            if token in seen_tokens:
                continue
            seen_tokens.add(token)
            tokens.append(token)
    query_profile = build_query_semantic_profile(normalized_query)
    is_overview_query = _looks_like_activity_overview_query(normalized_query, tokens) or local_budgets["kind"] in {
        "broad_overview",
        "daypart_overview",
        "time_breakdown",
    }
    is_work_recap_query = _looks_like_work_recap_query(normalized_query)
    prefer_snapshot_evidence = local_budgets["kind"] in {"exact_lookup", "app_drilldown"}
    final_limit = min(safe_limit, int(local_budgets["final_limit"]))
    memory_db_path = get_local_watcher_db_path_impl()
    activity_db_path = get_local_activity_db_path_impl()
    force_local_context_db = _prefer_explicit_local_context_db(memory_db_path)
    legacy_ocr_fallback_allowed = allow_legacy_fallback and _legacy_ocr_fallback_enabled()

    local_override_conn: Optional[sqlite3.Connection] = None
    async with watcher_service_local_db.open_activity_connection_for_user(user_id, write=False) as preferred_conn:
        using_turso = preferred_conn is not None and not force_local_context_db
        if using_turso:
            conn = preferred_conn
        else:
            if not os.path.exists(memory_db_path):
                return {
                    "success": False,
                    "error": f"local memory database not found at {memory_db_path}",
                    "results": [],
                    "mode_used": "none",
                    "status": "unavailable",
                }
            conn = sqlite3.connect(f"file:{memory_db_path}?mode=ro", uri=True, timeout=2.0)
            conn.row_factory = sqlite3.Row

        try:
            cursor = conn.cursor()
            if not using_turso:
                _attach_activity_view_if_needed(
                    cursor,
                    memory_db_path=memory_db_path,
                    activity_db_path=activity_db_path,
                )
            cursor.execute("PRAGMA query_only = ON")

            warning: Optional[str] = None
            if using_turso and os.path.exists(activity_db_path):
                override_conn, override_cursor, override_warning = _maybe_open_richer_local_activity_context(
                    current_cursor=cursor,
                    activity_db_path=activity_db_path,
                    recent_cutoff_ms=max(now_ms - (72 * 60 * 60 * 1000), cutoff_ms),
                    current_source_label="activity_per_user_replica",
                )
                if override_conn is not None and override_cursor is not None:
                    local_override_conn = override_conn
                    conn = override_conn
                    cursor = override_cursor
                    using_turso = False
                    warning = override_warning

            has_session_docs = table_exists_impl(cursor, "session_retrieval_docs")
            has_snapshots = table_exists_impl(cursor, "context_snapshots")

            results: List[Dict[str, Any]] = []
            mode_used = "none"
            status = "unavailable"

            if has_session_docs:
                candidate_limit = int(local_budgets["session_candidate_limit"])
                cursor.execute(
                    """
                    SELECT
                        id AS doc_id,
                        session_id,
                        chunk_start_ts,
                        chunk_end_ts,
                        COALESCE(app_name, 'Unknown') AS app_name,
                        COALESCE(browser_domain, '') AS browser_domain,
                        window_title,
                        document_title,
                        COALESCE(raw_visible_text, '') AS raw_visible_text,
                        COALESCE(contextual_retrieval_text, '') AS contextual_retrieval_text,
                        COALESCE(capture_quality, 0.0) AS capture_quality,
                        COALESCE(source_kind, 'context_session') AS source_kind
                    FROM session_retrieval_docs
                    WHERE chunk_end_ts >= ?
                      AND chunk_start_ts <= ?
                    ORDER BY chunk_end_ts DESC
                    LIMIT ?
                    """,
                    (cutoff_ms, window_end_ms, candidate_limit),
                )
                scored_rows: List[Dict[str, Any]] = []
                for row in cursor.fetchall():
                    haystack = " ".join(
                        [
                            str(row["app_name"] or ""),
                            str(row["window_title"] or ""),
                            str(row["document_title"] or ""),
                            str(row["browser_domain"] or ""),
                            str(row["contextual_retrieval_text"] or ""),
                            str(row["raw_visible_text"] or ""),
                        ]
                    ).lower()
                    if is_overview_query:
                        lexical_score = _overview_fanout_lexical_score(haystack, tokens)
                    else:
                        lexical_score = score_lexical_match_impl(haystack, tokens)
                    exact_match_score = _exact_context_match_score(
                        normalized_query,
                        [
                            row["document_title"],
                            row["window_title"],
                            row["raw_visible_text"],
                            row["contextual_retrieval_text"],
                        ],
                    )
                    if is_overview_query:
                        exact_match_score = 0.0
                    lexical_score = max(lexical_score, exact_match_score)
                    if is_overview_query and lexical_score <= 0:
                        lexical_score = 0.35
                    if lexical_score <= 0:
                        continue
                    age_hours = max(
                        0.0,
                        (now_ms - int(row["chunk_end_ts"] or 0)) / (1000.0 * 60.0 * 60.0),
                    )
                    recency_boost = max(0.0, 0.15 * (1.0 - min(age_hours / 72.0, 1.0)))
                    capture_quality = float(row["capture_quality"] or 0.0)
                    candidate = {
                        "app_name": row["app_name"] or "Unknown",
                        "window_title": row["window_title"] or row["document_title"],
                        "document_title": row["document_title"],
                        "browser_domain": row["browser_domain"],
                        "snippet": row["raw_visible_text"] or row["contextual_retrieval_text"] or "",
                        "contextual_retrieval_text": row["contextual_retrieval_text"] or "",
                        "parent_context": _derive_parent_context(
                            app_name=str(row["app_name"] or "Unknown"),
                            browser_domain=str(row["browser_domain"] or ""),
                            document_title=row["document_title"],
                            window_title=row["window_title"],
                            contextual_retrieval_text=str(row["contextual_retrieval_text"] or ""),
                        ),
                        "timestamp": int(row["chunk_end_ts"] or row["chunk_start_ts"] or 0),
                        "session_key": row["session_id"],
                        "capture_quality": capture_quality,
                    }
                    candidate_activity_class = str(
                        enrich_story_evidence(candidate).get("activity_class") or "work"
                    )
                    semantic_boost, _semantic_debug = _semantic_overlap_score(query_profile, candidate)
                    app_scope_match = _result_matches_app_scope(
                        {
                            "app_name": row["app_name"],
                            "window_title": row["window_title"],
                            "document_title": row["document_title"],
                            "snippet": row["raw_visible_text"] or row["contextual_retrieval_text"] or "",
                        },
                        requested_app_scope,
                    )
                    if is_overview_query and _is_low_signal_overview_row(
                        query=normalized_query,
                        app_name=str(row["app_name"] or ""),
                        window_title=str(row["window_title"] or row["document_title"] or ""),
                        document_title=str(row["document_title"] or ""),
                        browser_domain=str(row["browser_domain"] or ""),
                        snippet=str(row["raw_visible_text"] or row["contextual_retrieval_text"] or ""),
                        semantic_boost=semantic_boost,
                    ):
                        continue
                    if (
                        is_overview_query
                        and is_work_recap_query
                        and (
                            candidate_activity_class in {"personal", "entertainment"}
                            or (
                                str(row["app_name"] or "").strip().lower() in {"google chrome", "chrome", "safari", "arc", "firefox"}
                                and not _is_worklike_browser_candidate(
                                    window_title=str(row["window_title"] or ""),
                                    document_title=str(row["document_title"] or ""),
                                    browser_domain=str(row["browser_domain"] or ""),
                                    snippet=str(row["raw_visible_text"] or row["contextual_retrieval_text"] or ""),
                                )
                            )
                        )
                    ):
                        continue
                    relevance = max(
                        0.05,
                        min(
                            1.0,
                            lexical_score * 0.6
                            + capture_quality * 0.15
                            + recency_boost
                            + semantic_boost
                            + (0.2 if app_scope_match else 0.0)
                            - (0.18 if requested_app_scope and not app_scope_match else 0.0)
                            + (0.08 if candidate_activity_class in {"work", "admin"} else 0.0)
                            - (0.12 if candidate_activity_class in {"personal", "entertainment"} else 0.0),
                        ),
                    )
                    scored_rows.append(
                        {
                            "chunk_id": int(row["doc_id"]),
                            "session_id": int(row["session_id"] or 0),
                            "timestamp": int(row["chunk_end_ts"] or row["chunk_start_ts"] or 0),
                            "app_bundle_id": "",
                            "app_name": row["app_name"] or "Unknown",
                            "window_title": row["window_title"] or row["document_title"],
                            "document_title": row["document_title"],
                            "browser_domain": row["browser_domain"],
                            "ocr_text": row["raw_visible_text"] or row["contextual_retrieval_text"] or "",
                            "snippet": row["raw_visible_text"] or row["contextual_retrieval_text"] or "",
                            "contextual_retrieval_text": row["contextual_retrieval_text"] or "",
                            "parent_context": candidate.get("parent_context"),
                            "relevance_score": relevance,
                            "capture_quality": capture_quality,
                            "semantic_overlap_debug": _semantic_debug,
                            "activity_class": candidate_activity_class,
                            "exact_match_score": exact_match_score,
                            "source_type": row["source_kind"] or "context_session",
                            "source": "hybrid",
                            "fts_matched": False,
                        }
                    )
                if scored_rows:
                    scored_rows.sort(
                        key=lambda item: (item["relevance_score"], item["timestamp"]),
                        reverse=True,
                    )
                    if is_overview_query:
                        selected = _select_diverse_context_results(scored_rows, limit=final_limit, overview_mode=True)
                    else:
                        selected = scored_rows[:final_limit]
                    results = _prioritize_app_scope_results(
                        selected,
                        requested_app_scope,
                        hard_filter=False,
                    )
                    mode_used = "context-session-docs"
                    status = "hybrid"

            session_doc_results = list(results) if (is_overview_query and results) else []

            if (prefer_snapshot_evidence or not results or is_overview_query) and has_snapshots:
                candidate_limit = int(local_budgets["snapshot_candidate_limit"])
                cursor.execute(
                    """
                    SELECT
                        id AS snapshot_id,
                        COALESCE(session_id, 0) AS session_id,
                        ts,
                        source_type,
                        COALESCE(app_bundle_id, '') AS app_bundle_id,
                        COALESCE(app_name, 'Unknown') AS app_name,
                        window_title,
                        browser_url,
                        browser_domain,
                        tab_title,
                        document_title,
                        document_path,
                        COALESCE(visible_text_raw, '') AS visible_text_raw,
                        COALESCE(visible_text_norm, '') AS visible_text_norm,
                        COALESCE(capture_quality, 0.0) AS capture_quality,
                        COALESCE(ax_richness_score, 0.0) AS ax_richness_score,
                        COALESCE(selected_text_present, 0) AS selected_text_present,
                        capture_trigger
                    FROM context_snapshots
                    WHERE ts >= ?
                      AND ts <= ?
                    ORDER BY ts DESC
                    LIMIT ?
                    """,
                    (cutoff_ms, window_end_ms, candidate_limit),
                )
                scored_rows = []
                for row in cursor.fetchall():
                    haystack = " ".join(
                        [
                            str(row["app_name"] or ""),
                            str(row["window_title"] or ""),
                            str(row["document_title"] or ""),
                            str(row["document_path"] or ""),
                            str(row["tab_title"] or ""),
                            str(row["browser_domain"] or ""),
                            str(row["visible_text_norm"] or ""),
                            str(row["visible_text_raw"] or ""),
                        ]
                    ).lower()
                    if is_overview_query:
                        lexical_score = _overview_fanout_lexical_score(haystack, tokens)
                    else:
                        lexical_score = score_lexical_match_impl(haystack, tokens)
                    exact_match_score = _exact_context_match_score(
                        normalized_query,
                        [
                            row["document_title"],
                            row["document_path"],
                            row["window_title"],
                            row["tab_title"],
                            row["browser_url"],
                            row["visible_text_raw"],
                            row["visible_text_norm"],
                        ],
                    )
                    if is_overview_query:
                        exact_match_score = 0.0
                    lexical_score = max(lexical_score, exact_match_score)
                    if is_overview_query and lexical_score <= 0:
                        lexical_score = 0.3
                    if lexical_score <= 0:
                        continue
                    capture_quality = float(row["capture_quality"] or 0.0)
                    candidate = {
                        "app_name": row["app_name"] or "Unknown",
                        "window_title": row["window_title"] or row["document_title"] or row["tab_title"],
                        "document_title": row["document_title"],
                        "document_path": row["document_path"],
                        "browser_domain": row["browser_domain"],
                        "snippet": row["visible_text_raw"] or row["visible_text_norm"] or "",
                        "parent_context": _derive_parent_context(
                            app_name=str(row["app_name"] or "Unknown"),
                            browser_domain=str(row["browser_domain"] or ""),
                            document_title=row["document_title"],
                            window_title=row["window_title"] or row["tab_title"],
                        ),
                        "timestamp": int(row["ts"] or 0),
                        "session_key": row["session_id"],
                        "capture_quality": capture_quality,
                    }
                    candidate_activity_class = str(
                        enrich_story_evidence(candidate).get("activity_class") or "work"
                    )
                    normalized_app = str(row["app_name"] or "").strip().lower()
                    semantic_boost, _semantic_debug = _semantic_overlap_score(query_profile, candidate)
                    app_scope_match = _result_matches_app_scope(
                        {
                            "app_name": row["app_name"],
                            "app_bundle_id": row["app_bundle_id"],
                            "window_title": row["window_title"] or row["tab_title"],
                            "document_title": row["document_title"],
                            "document_path": row["document_path"],
                            "snippet": row["visible_text_raw"] or row["visible_text_norm"] or "",
                        },
                        requested_app_scope,
                    )
                    if is_overview_query and _is_low_signal_overview_row(
                        query=normalized_query,
                        app_name=str(row["app_name"] or ""),
                        window_title=str(row["window_title"] or row["document_title"] or row["tab_title"] or ""),
                        document_title=str(row["document_title"] or row["tab_title"] or ""),
                        browser_domain=str(row["browser_domain"] or ""),
                        snippet=str(row["visible_text_raw"] or row["visible_text_norm"] or ""),
                        semantic_boost=semantic_boost,
                    ):
                        continue
                    if (
                        is_overview_query
                        and is_work_recap_query
                        and (
                            candidate_activity_class in {"personal", "entertainment"}
                            or (
                                normalized_app in {"google chrome", "chrome", "safari", "arc", "firefox"}
                                and not _is_worklike_browser_candidate(
                                    window_title=str(row["window_title"] or row["tab_title"] or ""),
                                    document_title=str(row["document_title"] or row["tab_title"] or ""),
                                    browser_domain=str(row["browser_domain"] or ""),
                                    snippet=str(row["visible_text_raw"] or row["visible_text_norm"] or ""),
                                )
                            )
                        )
                    ):
                        continue

                    metadata_penalty = 0.08 if str(row["source_type"] or "") == "window_metadata_fallback" and semantic_boost < 0.08 else 0.0
                    recency_hours = max(0.0, (now_ms - int(row["ts"] or 0)) / (1000.0 * 60.0 * 60.0))
                    recency_boost = 0.06 * (1.0 - min(recency_hours / 24.0, 1.0))
                    ax_richness = float(row["ax_richness_score"] or 0.0)
                    text_length = len(str(row["visible_text_raw"] or row["visible_text_norm"] or ""))
                    richness_boost = max(ax_richness * 0.18, min(0.14, text_length / 2400.0))
                    app_bonus = 0.0
                    selected_text_bonus = 0.06 if int(row["selected_text_present"] or 0) else 0.0
                    trigger_bonus = 0.04 if str(row["capture_trigger"] or "") == "ax_event" else 0.0
                    if normalized_app in {"cursor", "codex", "paper", "things 3", "things", "finder"}:
                        app_bonus = 0.08
                    elif normalized_app == "google chrome" and str(row["browser_domain"] or "").strip().lower() not in LOW_SIGNAL_BROWSER_DOMAINS:
                        app_bonus = 0.03

                    lexical_weight = 0.28 if prefer_snapshot_evidence else 0.62
                    relevance = max(
                        0.05,
                        min(
                            1.0,
                            lexical_score * lexical_weight
                            + capture_quality * 0.2
                            + semantic_boost
                            + recency_boost
                            + richness_boost
                            + app_bonus
                            + selected_text_bonus
                            + trigger_bonus
                            + (0.22 if app_scope_match else 0.0)
                            - (0.2 if requested_app_scope and not app_scope_match else 0.0)
                            + (0.08 if candidate_activity_class in {"work", "admin"} else 0.0)
                            - (0.12 if candidate_activity_class in {"personal", "entertainment"} else 0.0)
                            - metadata_penalty,
                        ),
                    )
                    scored_rows.append(
                        {
                            "frame_id": int(row["snapshot_id"]),
                            "session_id": int(row["session_id"] or 0),
                            "timestamp": int(row["ts"] or 0),
                            "app_bundle_id": row["app_bundle_id"] or "",
                            "app_name": row["app_name"] or "Unknown",
                            "window_title": row["window_title"] or row["document_title"] or row["tab_title"],
                            "document_title": row["document_title"],
                            "document_path": row["document_path"],
                            "browser_domain": row["browser_domain"],
                            "browser_url": row["browser_url"],
                            "ocr_text": row["visible_text_raw"] or row["visible_text_norm"] or "",
                            "snippet": row["visible_text_raw"] or row["visible_text_norm"] or "",
                            "parent_context": candidate.get("parent_context"),
                            "relevance_score": relevance,
                            "capture_quality": capture_quality,
                            "semantic_overlap_debug": _semantic_debug,
                            "activity_class": candidate_activity_class,
                            "exact_match_score": exact_match_score,
                            "source_type": row["source_type"] or "context_snapshot",
                            "source": "text",
                            "fts_matched": False,
                        }
                    )
                if scored_rows:
                    scored_rows.sort(
                        key=lambda item: (item["relevance_score"], item["timestamp"]),
                        reverse=True,
                    )
                    selected_rows = _select_diverse_context_results(scored_rows, limit=final_limit, overview_mode=is_overview_query) if (prefer_snapshot_evidence or is_overview_query) else scored_rows[:final_limit]
                    results = _prioritize_app_scope_results(
                        selected_rows,
                        requested_app_scope,
                        hard_filter=False,
                    )
                    mode_used = "context-snapshots"
                    status = "text-only"

            if is_overview_query and session_doc_results and results:
                existing_timestamps = {int(r.get("timestamp") or 0) for r in results}
                for sdr in session_doc_results:
                    sdr_ts = int(sdr.get("timestamp") or 0)
                    if any(abs(sdr_ts - ts) < 30_000 for ts in existing_timestamps):
                        continue
                    results.append(sdr)
                    existing_timestamps.add(sdr_ts)
                results.sort(
                    key=lambda item: (float(item.get("relevance_score") or 0.0), int(item.get("timestamp") or 0)),
                    reverse=True,
                )
                results = list(_select_diverse_context_results(results, limit=final_limit, overview_mode=True))
                mode_used = "context-merged"
                status = "hybrid"

            if not results and legacy_ocr_fallback_allowed:
                legacy = await search_screen_recordings_impl(
                    service=service,
                    user_id=user_id,
                    query=normalized_query,
                    days_back=safe_days_back,
                    limit=final_limit,
                    allow_activity_fallback=True,
                )
                legacy["warning"] = (
                    "Context snapshots were unavailable or empty; falling back to legacy OCR/activity search."
                    if legacy.get("success")
                    else legacy.get("warning")
                )
                return legacy

            if results and legacy_ocr_fallback_allowed:
                avg_quality = sum(float(r.get("capture_quality") or 0.0) for r in results) / max(len(results), 1)
                if avg_quality < 0.5:
                    try:
                        ocr_supplement = await search_screen_recordings_impl(
                            service=service,
                            user_id=user_id,
                            query=normalized_query,
                            days_back=safe_days_back,
                            limit=max(5, final_limit // 3),
                            allow_activity_fallback=False,
                        )
                        ocr_results = ocr_supplement.get("results") or [] if ocr_supplement.get("success") else []
                        if ocr_results:
                            existing_timestamps = {int(r.get("timestamp") or 0) for r in results}
                            for ocr_row in ocr_results:
                                ocr_ts = int(ocr_row.get("timestamp") or 0)
                                if any(abs(ocr_ts - ts) < 30_000 for ts in existing_timestamps):
                                    continue
                                ocr_row["source"] = "ocr_fallback"
                                ocr_row["source_type"] = "ocr_fusion"
                                results.append(ocr_row)
                            results.sort(key=lambda r: (float(r.get("relevance_score") or 0.0), int(r.get("timestamp") or 0)), reverse=True)
                    except Exception:
                        pass

            story_plan = None
            renderer = None
            debug = None
            citations = []
            rerank_info = {"provider": "none", "rerank_attempted": False, "rerank_latency_ms": 0}
            if results:
                results = _attach_snapshot_semantic_summaries(cursor, results)
                if local_budgets["kind"] == "app_drilldown" and requested_app_scope:
                    primary_results = [r for r in results if _result_matches_app_scope(r, requested_app_scope)]
                    corroborating_results = [r for r in results if not _result_matches_app_scope(r, requested_app_scope)]
                    primary_budget = max(1, int(final_limit * 0.7))
                    corroboration_budget = max(1, final_limit - primary_budget)
                    results = primary_results[:primary_budget] + corroborating_results[:corroboration_budget]

                citations = _build_citations(
                    results,
                    start_ms=cutoff_ms,
                    end_ms=window_end_ms,
                    limit=max(final_limit * 2, int(local_budgets["citation_limit"])),
                )
                if local_budgets["kind"] == "app_drilldown" and requested_app_scope:
                    scoped_citations = [c for c in citations if _result_matches_app_scope(c, requested_app_scope)]
                    other_citations = [c for c in citations if not _result_matches_app_scope(c, requested_app_scope)]
                    citation_primary_budget = max(1, int(len(citations) * 0.7))
                    citation_corr_budget = max(1, len(citations) - citation_primary_budget)
                    citations = scoped_citations[:citation_primary_budget] + other_citations[:citation_corr_budget]
                top_score = float(results[0].get("relevance_score") or 0.0)
                runner_up_score = float(results[1].get("relevance_score") or 0.0) if len(results) > 1 else 0.0
                strong_signal = None
                if local_budgets["kind"] not in {"broad_overview", "daypart_overview", "time_breakdown"} and (
                    float(results[0].get("exact_match_score") or 0.0) >= 0.95 or (
                        top_score >= 0.85 and (top_score - runner_up_score) >= 0.15
                    )
                ):
                    strong_signal = {
                        "exact_match": float(results[0].get("exact_match_score") or 0.0) >= 0.95,
                        "top_score": round(top_score, 3),
                        "runner_up_score": round(runner_up_score, 3),
                        "source_type": results[0].get("source_type"),
                    }
                story_plan = _build_story_semantics(
                    query=normalized_query,
                    intent=resolved_intent,
                    citations=citations,
                )
                if story_plan:
                    renderer = story_plan.get("renderer")
                    metrics = story_plan.get("metrics") or {}
                    debug = {
                        "main_event_work_item_id": ((story_plan.get("main_event") or {}).get("id")),
                        "work_items_considered": int(metrics.get("work_items_considered") or 0),
                        "cross_app_stitches": int(metrics.get("cross_app_stitches") or 0),
                        "claim_count": int(metrics.get("claim_count") or 0),
                        "claim_grounding_rate": float(metrics.get("claim_grounding_rate") or 0.0),
                        "generic_fallback_used": bool(metrics.get("generic_fallback_used")),
                        "planning_only_ratio": float(metrics.get("planning_only_ratio") or 0.0),
                        "expanded_queries": expanded_queries,
                        "strong_signal_short_circuit": strong_signal,
                        "rerank": rerank_info,
                        "candidate_limit_applied": {
                            "kind": local_budgets["kind"],
                            "session_candidate_limit": int(local_budgets["session_candidate_limit"]),
                            "snapshot_candidate_limit": int(local_budgets["snapshot_candidate_limit"]),
                            "final_limit": int(final_limit),
                        },
                        "retrieval_lists": [
                            {
                                "source": "context-session-docs",
                                "query_types": [str(item.get("type") or "original") for item in expanded_queries],
                                "candidate_limit": int(local_budgets["session_candidate_limit"]),
                            },
                            {
                                "source": "context-snapshots",
                                "query_types": [str(item.get("type") or "original") for item in expanded_queries],
                                "candidate_limit": int(local_budgets["snapshot_candidate_limit"]),
                            },
                        ],
                        "rerank_cache_hit": bool(rerank_info.get("cache_hits")),
                    }

            return {
                "success": True,
                "query": normalized_query,
                "days_back": safe_days_back,
                "result_count": len(results),
                "results": results,
                "mode_used": mode_used,
                "status": status,
                "warning": warning,
                "citations": citations,
                "story_plan": story_plan,
                "renderer": renderer,
                "debug": debug,
                "source_db": "turso_replica" if using_turso else os.path.basename(activity_db_path if local_override_conn is not None else memory_db_path),
            }
        finally:
            if local_override_conn is not None:
                local_override_conn.close()
            elif conn is not None and not using_turso:
                conn.close()


async def search_screen_recordings_impl(
    service,
    user_id: str,
    query: str,
    days_back: int = 7,
    limit: int = 20,
    allow_activity_fallback: bool = True,
) -> Dict[str, Any]:
    """
    Search local screen history directly from ritual.db.

    Primary path:
    - OCR FTS search via ocr_frames_fts (fast and precise)

    Fallbacks:
    - OCR lexical scan over recent frames (when FTS missing/empty)
    - activity_events lexical scan (when OCR unavailable)
    """
    import sqlite3

    normalized_query = (query or "").strip()
    if not normalized_query:
        return {
            "success": False,
            "error": "query is required",
            "results": [],
            "mode_used": "none",
            "status": "unavailable",
        }

    start_day, end_day, safe_days_back = _resolve_query_window(
        days_back=days_back,
        start_date=None,
        end_date=None,
        query=normalized_query,
    )
    safe_limit = max(1, min(int(limit or 20), 50))
    now_ms = int(time.time() * 1000)
    cutoff_ms = int(datetime.combine(start_day, dt_time.min).timestamp() * 1000)
    query_end_ms = int(datetime.combine(end_day, dt_time.max).timestamp() * 1000)
    window_end_ms = min(now_ms, query_end_ms)
    tokens = expand_search_tokens_impl(normalized_query)
    is_overview_query = _looks_like_activity_overview_query(normalized_query, tokens)

    # First try true on-demand hybrid retrieval through the local Tauri bridge.
    hybrid_result = await search_screen_via_hybrid_bridge_impl(
        query=normalized_query,
        days_back=safe_days_back,
        limit=safe_limit,
    )
    bridge_warning: Optional[str] = None
    if hybrid_result is not None:
        hybrid_results = hybrid_result.get("results") if isinstance(hybrid_result, dict) else None
        if isinstance(hybrid_results, list) and len(hybrid_results) > 0:
            return hybrid_result

        base_warning = hybrid_result.get("warning") if isinstance(hybrid_result, dict) else None
        bridge_warning = (
            f"{base_warning} Hybrid search returned no direct matches; trying local fallback."
            if base_warning
            else "Hybrid search returned no direct matches; trying local fallback."
        )
    else:
        bridge_warning = "Hybrid bridge unavailable; using local lexical fallback."

    memory_db_path = get_local_watcher_db_path_impl()
    activity_db_path = get_local_activity_db_path_impl()
    if not os.path.exists(memory_db_path):
        return {
            "success": False,
            "error": f"local memory database not found at {memory_db_path}",
            "results": [],
            "mode_used": "none",
            "status": "unavailable",
        }

    conn = None
    try:
        conn = sqlite3.connect(
            f"file:{memory_db_path}?mode=ro",
            uri=True,
            timeout=2.0,
        )
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        _attach_activity_view_if_needed(
            cursor,
            memory_db_path=memory_db_path,
            activity_db_path=activity_db_path,
        )
        cursor.execute("PRAGMA query_only = ON")

        has_ocr_frames = table_exists_impl(cursor, "ocr_frames")
        has_ocr_fts = table_exists_impl(cursor, "ocr_frames_fts")
        has_activity_events = table_exists_impl(cursor, "activity_events")

        results: List[Dict[str, Any]] = []
        mode_used = "none"
        status = "unavailable"
        warning: Optional[str] = bridge_warning

        # 1) OCR FTS path
        if has_ocr_frames and has_ocr_fts:
            candidate_limit = min(max(safe_limit * 4, 80), 400)
            query_to_run = build_expanded_fts_query_impl(normalized_query) or normalized_query
            try:
                cursor.execute(
                    """
                    SELECT
                        f.id AS frame_id,
                        f.timestamp AS timestamp,
                        COALESCE(f.app_bundle_id, '') AS app_bundle_id,
                        COALESCE(f.app_name, 'Unknown') AS app_name,
                        f.window_title AS window_title,
                        COALESCE(f.ocr_text, '') AS ocr_text,
                        bm25(ocr_frames_fts) AS rank
                    FROM ocr_frames f
                    JOIN ocr_frames_fts ON ocr_frames_fts.rowid = f.id
                    WHERE f.timestamp >= ?
                      AND f.timestamp <= ?
                      AND ocr_frames_fts MATCH ?
                    ORDER BY bm25(ocr_frames_fts) ASC, f.timestamp DESC
                    LIMIT ?
                    """,
                    (cutoff_ms, window_end_ms, query_to_run, candidate_limit),
                )
            except Exception as exc:
                if is_fts_syntax_error_impl(exc):
                    escaped = escape_fts_phrase_impl(normalized_query)
                    if escaped:
                        query_to_run = escaped
                        cursor.execute(
                            """
                            SELECT
                                f.id AS frame_id,
                                f.timestamp AS timestamp,
                                COALESCE(f.app_bundle_id, '') AS app_bundle_id,
                                COALESCE(f.app_name, 'Unknown') AS app_name,
                                f.window_title AS window_title,
                                COALESCE(f.ocr_text, '') AS ocr_text,
                                bm25(ocr_frames_fts) AS rank
                            FROM ocr_frames f
                            JOIN ocr_frames_fts ON ocr_frames_fts.rowid = f.id
                            WHERE f.timestamp >= ?
                              AND f.timestamp <= ?
                              AND ocr_frames_fts MATCH ?
                            ORDER BY bm25(ocr_frames_fts) ASC, f.timestamp DESC
                            LIMIT ?
                            """,
                            (cutoff_ms, window_end_ms, query_to_run, candidate_limit),
                        )
                        warning = (
                            "Search query syntax was normalized for FTS compatibility."
                        )
                    else:
                        raise
                else:
                    raise

            for row in cursor.fetchall():
                haystack = (
                    f"{row['app_name']} {row['window_title'] or ''} {row['ocr_text'] or ''}"
                ).lower()
                lexical_score = score_lexical_match_impl(haystack, tokens)
                raw_rank = row["rank"] if row["rank"] is not None else 0.0
                rank = abs(float(raw_rank))
                rank_score = 1.0 / (1.0 + rank)
                relevance = max(0.05, min(1.0, rank_score * 0.7 + lexical_score * 0.3))
                results.append(
                    {
                        "frame_id": int(row["frame_id"]),
                        "timestamp": int(row["timestamp"]),
                        "app_bundle_id": row["app_bundle_id"] or "",
                        "app_name": row["app_name"] or "Unknown",
                        "window_title": row["window_title"],
                        "ocr_text": row["ocr_text"] or "",
                        "relevance_score": relevance,
                        "source": "text",
                        "fts_matched": True,
                    }
                )

            if results:
                results.sort(
                    key=lambda item: (item["relevance_score"], item["timestamp"]),
                    reverse=True,
                )
                results = results[:safe_limit]
                mode_used = "fts"
                status = "text-only"

        # 2) OCR lexical fallback (if FTS empty/unavailable)
        if not results and has_ocr_frames:
            candidate_limit = min(max(safe_limit * 25, 300), 3000)
            cursor.execute(
                """
                SELECT
                    id AS frame_id,
                    timestamp,
                    COALESCE(app_bundle_id, '') AS app_bundle_id,
                    COALESCE(app_name, 'Unknown') AS app_name,
                    window_title,
                    COALESCE(ocr_text, '') AS ocr_text
                FROM ocr_frames
                WHERE timestamp >= ?
                  AND timestamp <= ?
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (cutoff_ms, window_end_ms, candidate_limit),
            )

            normalized_contains = normalized_query.lower()
            scored_rows: List[Dict[str, Any]] = []
            for row in cursor.fetchall():
                haystack = (
                    f"{row['app_name']} {row['window_title'] or ''} {row['ocr_text'] or ''}"
                ).lower()
                lexical_score = score_lexical_match_impl(haystack, tokens)
                if normalized_contains and normalized_contains in haystack:
                    lexical_score = max(lexical_score, 0.8)
                if lexical_score <= 0:
                    continue
                relevance = max(0.05, min(0.9, 0.2 + lexical_score * 0.7))
                scored_rows.append(
                    {
                        "frame_id": int(row["frame_id"]),
                        "timestamp": int(row["timestamp"]),
                        "app_bundle_id": row["app_bundle_id"] or "",
                        "app_name": row["app_name"] or "Unknown",
                        "window_title": row["window_title"],
                        "ocr_text": row["ocr_text"] or "",
                        "relevance_score": relevance,
                        "source": "text",
                        "fts_matched": False,
                    }
                )

            if scored_rows:
                scored_rows.sort(
                    key=lambda item: (item["relevance_score"], item["timestamp"]),
                    reverse=True,
                )
                results = scored_rows[:safe_limit]
                mode_used = "like-fallback"
                status = "text-only"
                warning = warning or (
                    "Using lexical fallback because FTS did not return matches."
                )

        # 3) Activity fallback (if OCR unavailable or no OCR matches)
        if allow_activity_fallback and not results and has_activity_events:
            candidate_limit = min(max(safe_limit * 20, 200), 2000)
            cursor.execute(
                """
                SELECT
                    id,
                    ts_start,
                    COALESCE(app_bundle_id, '') AS app_bundle_id,
                    COALESCE(app_name, 'Unknown') AS app_name,
                    COALESCE(window_title, '') AS window_title,
                    COALESCE(browser_url, '') AS browser_url,
                    COALESCE(browser_domain, '') AS browser_domain
                FROM activity_events
                WHERE ts_start >= ?
                  AND ts_start <= ?
                  AND COALESCE(is_afk, 0) = 0
                ORDER BY ts_start DESC
                LIMIT ?
                """,
                (cutoff_ms, window_end_ms, candidate_limit),
            )

            normalized_contains = normalized_query.lower()
            scored_events: List[Dict[str, Any]] = []
            for row in cursor.fetchall():
                activity_text = " ".join(
                    part for part in [row["window_title"], row["browser_url"], row["browser_domain"]] if part
                )
                haystack = (
                    f"{row['app_name']} {activity_text}"
                ).lower()
                lexical_score = score_lexical_match_impl(haystack, tokens)
                if is_overview_query and lexical_score <= 0:
                    lexical_score = 0.35
                if normalized_contains and normalized_contains in haystack:
                    lexical_score = max(lexical_score, 0.75)
                if lexical_score <= 0:
                    continue

                preview_parts = []
                if row["window_title"]:
                    preview_parts.append(f"Window: {row['window_title']}")
                if row["browser_url"]:
                    preview_parts.append(f"URL: {row['browser_url']}")
                elif row["browser_domain"]:
                    preview_parts.append(f"Domain: {row['browser_domain']}")

                scored_events.append(
                    {
                        "frame_id": -int(row["id"]),  # synthetic ID for non-frame events
                        "timestamp": int(row["ts_start"]),
                        "app_bundle_id": row["app_bundle_id"] or "",
                        "app_name": row["app_name"] or "Unknown",
                        "window_title": row["window_title"] or None,
                        "ocr_text": " | ".join(preview_parts) if preview_parts else row["app_name"],
                        "relevance_score": max(0.05, min(0.85, 0.15 + lexical_score * 0.7)),
                        "source": "activity",
                        "fts_matched": False,
                    }
                )

            if scored_events:
                scored_events.sort(
                    key=lambda item: (item["relevance_score"], item["timestamp"]),
                    reverse=True,
                )
                results = scored_events[:safe_limit]
                mode_used = "activity-fallback"
                status = "activity-only"
                if is_overview_query:
                    overview_warning = (
                        "Showing recent activity overview for a broad query. "
                        "Add app names or keywords to narrow results."
                    )
                    warning = (
                        f"{warning} {overview_warning}".strip()
                        if warning
                        else overview_warning
                    )
                else:
                    warning = warning or (
                        "No OCR frame matches found; using activity-event fallback."
                    )

        # 4) Broad activity overview fallback (for queries like "What did I do this week?")
        if allow_activity_fallback and not results and has_activity_events and is_overview_query:
            candidate_limit = min(max(safe_limit * 40, 400), 4000)
            cursor.execute(
                """
                SELECT
                    id,
                    ts_start,
                    COALESCE(app_bundle_id, '') AS app_bundle_id,
                    COALESCE(app_name, 'Unknown') AS app_name,
                    COALESCE(window_title, '') AS window_title,
                    COALESCE(browser_url, '') AS browser_url,
                    COALESCE(browser_domain, '') AS browser_domain
                FROM activity_events
                WHERE ts_start >= ?
                  AND ts_start <= ?
                  AND COALESCE(is_afk, 0) = 0
                ORDER BY ts_start DESC
                LIMIT ?
                """,
                (cutoff_ms, window_end_ms, candidate_limit),
            )

            overview_results: List[Dict[str, Any]] = []
            seen_keys = set()
            for row in cursor.fetchall():
                preview_parts = []
                if row["window_title"]:
                    preview_parts.append(f"Window: {row['window_title']}")
                if row["browser_url"]:
                    preview_parts.append(f"URL: {row['browser_url']}")
                elif row["browser_domain"]:
                    preview_parts.append(f"Domain: {row['browser_domain']}")

                key = (
                    row["app_name"] or "Unknown",
                    row["window_title"] or "",
                    row["browser_domain"] or "",
                )
                if key in seen_keys:
                    continue
                seen_keys.add(key)

                rank_index = len(overview_results)
                relevance = max(0.35, 0.9 - rank_index * 0.03)
                overview_results.append(
                    {
                        "frame_id": -int(row["id"]),  # synthetic ID for non-frame events
                        "timestamp": int(row["ts_start"]),
                        "app_bundle_id": row["app_bundle_id"] or "",
                        "app_name": row["app_name"] or "Unknown",
                        "window_title": row["window_title"] or None,
                        "ocr_text": " | ".join(preview_parts) if preview_parts else (row["app_name"] or "Unknown"),
                        "relevance_score": relevance,
                        "source": "activity",
                        "fts_matched": False,
                    }
                )
                if len(overview_results) >= safe_limit:
                    break

            if overview_results:
                results = overview_results
                mode_used = "activity-fallback"
                status = "activity-only"
                overview_warning = (
                    "Showing recent activity overview for a broad query. "
                    "Add app names or keywords to narrow results."
                )
                warning = f"{warning} {overview_warning}".strip() if warning else overview_warning

        if not allow_activity_fallback and not results:
            strict_warning = (
                "Insufficient grounded OCR evidence for a topic-specific answer in the selected time range."
            )
            warning = f"{warning} {strict_warning}".strip() if warning else strict_warning

        if not results and status == "unavailable":
            if has_ocr_frames:
                status = "text-only"
            elif has_activity_events:
                status = "activity-only"

        return {
            "success": True,
            "query": normalized_query,
            "days_back": safe_days_back,
            "result_count": len(results),
            "results": results,
            "mode_used": mode_used,
            "status": status,
            "warning": warning,
            "start_date": start_day.isoformat(),
            "end_date": end_day.isoformat(),
            "source_db": os.path.basename(memory_db_path),
        }
    except Exception as e:
        logger.error(f"❌ Error searching local screen history: {e}")
        return {
            "success": False,
            "error": str(e),
            "query": normalized_query,
            "days_back": safe_days_back,
            "result_count": 0,
            "results": [],
            "mode_used": "none",
            "status": "unavailable",
            "source_db": os.path.basename(memory_db_path),
        }
    finally:
        if conn is not None:
            conn.close()


def _parse_ymd(value: Optional[str]) -> Optional[dt_date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except Exception:
        return None


def _resolve_query_window(
    days_back: Optional[int],
    start_date: Optional[str],
    end_date: Optional[str],
    timezone_name: Optional[str] = None,
    query: Optional[str] = None,
) -> Tuple[dt_date, dt_date, int]:
    safe_days_back = max(1, min(int(days_back or 7), 90))
    today = _resolve_today(timezone_name)

    parsed_start = _parse_ymd(start_date)
    parsed_end = _parse_ymd(end_date)

    if parsed_start and parsed_end:
        if parsed_start > parsed_end:
            parsed_start, parsed_end = parsed_end, parsed_start
        return parsed_start, parsed_end, max(1, (parsed_end - parsed_start).days + 1)

    if parsed_start and not parsed_end:
        parsed_end = today
        if parsed_start > parsed_end:
            parsed_start, parsed_end = parsed_end, parsed_start
        return parsed_start, parsed_end, max(1, (parsed_end - parsed_start).days + 1)

    if parsed_end and not parsed_start:
        parsed_start = parsed_end - timedelta(days=safe_days_back - 1)
        if parsed_start > parsed_end:
            parsed_start, parsed_end = parsed_end, parsed_start
        return parsed_start, parsed_end, max(1, (parsed_end - parsed_start).days + 1)

    relative = _resolve_relative_window_from_query(query, today)
    if relative is not None:
        return relative

    end = today
    start = end - timedelta(days=safe_days_back - 1)
    return start, end, safe_days_back


def _resolve_relative_window_from_query(
    query: Optional[str],
    today: dt_date,
) -> Optional[Tuple[dt_date, dt_date, int]]:
    normalized = (query or "").strip().lower()
    if not normalized:
        return None

    def _days(start: dt_date, end: dt_date) -> int:
        return max(1, (end - start).days + 1)

    if "today" in normalized:
        return today, today, 1

    if any(phrase in normalized for phrase in ("this morning", "this afternoon", "this evening", "tonight")):
        return today, today, 1

    if "yesterday" in normalized:
        day = today - timedelta(days=1)
        return day, day, 1

    if "last week" in normalized:
        current_week_start = today - timedelta(days=today.weekday())
        last_week_end = current_week_start - timedelta(days=1)
        last_week_start = last_week_end - timedelta(days=6)
        return last_week_start, last_week_end, _days(last_week_start, last_week_end)

    if "this week" in normalized:
        current_week_start = today - timedelta(days=today.weekday())
        return current_week_start, today, _days(current_week_start, today)

    if "last month" in normalized:
        first_this_month = today.replace(day=1)
        last_prev_month = first_this_month - timedelta(days=1)
        first_prev_month = last_prev_month.replace(day=1)
        return first_prev_month, last_prev_month, _days(first_prev_month, last_prev_month)

    if "this month" in normalized:
        first_this_month = today.replace(day=1)
        return first_this_month, today, _days(first_this_month, today)

    return None


def _resolve_query_timezone(timezone_name: Optional[str]) -> dt_timezone | ZoneInfo:
    normalized = (timezone_name or "").strip()
    if normalized:
        try:
            return ZoneInfo(normalized)
        except ZoneInfoNotFoundError:
            logger.warning(
                "Unknown memory query timezone '%s'; falling back to local timezone.",
                normalized,
            )

    local_tz = datetime.now().astimezone().tzinfo
    return local_tz or dt_timezone.utc


def _resolve_today(timezone_name: Optional[str]) -> dt_date:
    return datetime.now(_resolve_query_timezone(timezone_name)).date()


def _detect_memory_intent(query: str, explicit_intent: Optional[str]) -> str:
    normalized_explicit = (explicit_intent or "auto").strip().lower()
    if normalized_explicit in VALID_MEMORY_INTENTS and normalized_explicit != "auto":
        return normalized_explicit

    normalized = (query or "").strip().lower()
    if not normalized:
        return "semantic_lookup"

    if any(phrase in normalized for phrase in MEMORY_EVIDENCE_HINTS):
        return "evidence_timeline"

    if any(phrase in normalized for phrase in MEMORY_BROAD_HINTS):
        return "broad_overview"

    if any(phrase in normalized for phrase in MEMORY_TIME_SPENT_HINTS):
        return "time_spent"

    if any(phrase in normalized for phrase in MEMORY_SEMANTIC_HINTS):
        return "semantic_lookup"

    if _looks_like_activity_overview_query(normalized, extract_search_tokens_impl(normalized)):
        return "broad_overview"

    return "semantic_lookup"


def _table_exists(cursor, table_name: str) -> bool:
    cursor.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type='table' AND name=?
        LIMIT 1
        """,
        (table_name,),
    )
    return cursor.fetchone() is not None


def _max_value(cursor, sql: str, params: Tuple[Any, ...] = ()) -> Optional[int]:
    try:
        cursor.execute(sql, params)
        row = cursor.fetchone()
        if not row:
            return None
        value = row[0]
        if value is None:
            return None
        return int(value)
    except Exception:
        return None


def _safe_hours(total_ms: float) -> float:
    return round(max(0.0, float(total_ms)) / (1000.0 * 60.0 * 60.0), 2)


def _extract_topic_profile(query: str) -> Dict[str, Any]:
    words = re.findall(r"[a-z0-9]+", (query or "").lower())
    filtered_words: List[str] = []
    for word in words:
        if len(word) < 3:
            continue
        if word in SCREEN_SEARCH_STOP_WORDS:
            continue
        if word in MEMORY_TOPIC_INTENT_WORDS:
            continue
        filtered_words.append(word)

    tokens: List[str] = []
    seen = set()
    for word in filtered_words:
        if word in seen:
            continue
        seen.add(word)
        tokens.append(word)

    strong_tokens = [token for token in tokens if len(token) >= 4 and token not in MEMORY_TOPIC_WEAK_TOKENS]

    phrases: List[str] = []
    for idx in range(len(filtered_words) - 1):
        phrase = f"{filtered_words[idx]} {filtered_words[idx + 1]}"
        if phrase in phrases:
            continue
        phrases.append(phrase)
        if len(phrases) >= 8:
            break

    return {
        "all_tokens": tokens,
        "strong_tokens": strong_tokens,
        "phrases": phrases,
    }


def _has_substantive_snippet(snippet: str) -> bool:
    text = (snippet or "").strip().lower()
    if not text:
        return False
    if text in {"unknown", "n/a"}:
        return False
    return not text.startswith(("window:", "url:", "domain:", "app:"))


def _annotate_citation_topic(citation: Dict[str, Any], topic_profile: Dict[str, Any]) -> Dict[str, Any]:
    all_tokens = topic_profile.get("all_tokens") or []
    strong_tokens = topic_profile.get("strong_tokens") or []
    phrases = topic_profile.get("phrases") or []

    snippet = str(citation.get("snippet") or "")
    haystack = " ".join(
        [
            str(citation.get("app_name") or ""),
            str(citation.get("window_title") or ""),
            snippet,
        ]
    ).lower()

    matched_tokens = [token for token in all_tokens if token in haystack]
    matched_strong_tokens = [token for token in strong_tokens if token in haystack]
    phrase_hits = [phrase for phrase in phrases if phrase and phrase in haystack]

    annotated = dict(citation)
    annotated["topic_match_tokens"] = matched_tokens[:8]
    annotated["topic_match_count"] = len(matched_tokens)
    annotated["topic_strong_match_count"] = len(matched_strong_tokens)
    annotated["topic_phrase_hits"] = phrase_hits[:6]
    annotated["topic_coverage"] = (
        round(len(matched_tokens) / len(all_tokens), 3) if all_tokens else 0.0
    )
    annotated["topic_strong_coverage"] = (
        round(len(matched_strong_tokens) / len(strong_tokens), 3) if strong_tokens else 0.0
    )
    annotated["has_substantive_snippet"] = _has_substantive_snippet(snippet)
    return annotated


def _summarize_topic_metrics(
    citations: List[Dict[str, Any]],
    topic_profile: Dict[str, Any],
    filtered_count: int,
) -> Dict[str, Any]:
    if not citations:
        return {
            "query_tokens": topic_profile.get("all_tokens") or [],
            "strong_tokens": topic_profile.get("strong_tokens") or [],
            "top_match_count": 0,
            "top_strong_match_count": 0,
            "phrase_hit_count": 0,
            "corroborating_topic_chunks": 0,
            "average_topic_coverage": 0.0,
            "filtered_out": 0,
        }

    top_match_count = max(int(item.get("topic_match_count") or 0) for item in citations)
    top_strong_match_count = max(int(item.get("topic_strong_match_count") or 0) for item in citations)
    phrase_hit_count = sum(1 for item in citations if item.get("topic_phrase_hits"))
    avg_coverage = sum(float(item.get("topic_coverage") or 0.0) for item in citations) / max(len(citations), 1)

    required_strong = 2 if len(topic_profile.get("strong_tokens") or []) >= 2 else 1
    corroborating_topic_chunks = len(
        {
            item.get("chunk_id")
            for item in citations
            if item.get("chunk_id") is not None
            and (
                int(item.get("topic_strong_match_count") or 0) >= required_strong
                or bool(item.get("topic_phrase_hits"))
            )
        }
    )

    return {
        "query_tokens": topic_profile.get("all_tokens") or [],
        "strong_tokens": topic_profile.get("strong_tokens") or [],
        "top_match_count": top_match_count,
        "top_strong_match_count": top_strong_match_count,
        "phrase_hit_count": phrase_hit_count,
        "corroborating_topic_chunks": corroborating_topic_chunks,
        "average_topic_coverage": round(avg_coverage, 3),
        "filtered_out": max(0, len(citations) - filtered_count),
    }


def _apply_topic_specificity_filter(
    citations: List[Dict[str, Any]],
    query: str,
    intent: str,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any], Optional[str]]:
    topic_profile = _extract_topic_profile(query)
    annotated = [_annotate_citation_topic(citation, topic_profile) for citation in citations]

    strict_intent = intent in {"semantic_lookup", "evidence_timeline"}
    if not strict_intent or not annotated or not topic_profile.get("all_tokens"):
        metrics = _summarize_topic_metrics(annotated, topic_profile, len(annotated))
        return annotated, metrics, None

    strong_tokens = topic_profile.get("strong_tokens") or []
    required_strong = 2 if len(strong_tokens) >= 2 else (1 if len(strong_tokens) == 1 else 0)

    filtered: List[Dict[str, Any]] = []
    for item in annotated:
        score = float(item.get("score") or 0.0)
        strong_matches = int(item.get("topic_strong_match_count") or 0)
        topic_matches = int(item.get("topic_match_count") or 0)
        has_phrase = bool(item.get("topic_phrase_hits"))
        has_substantive = bool(item.get("has_substantive_snippet"))

        if required_strong >= 2:
            topical_match = strong_matches >= 2 or has_phrase
        elif required_strong == 1:
            topical_match = strong_matches >= 1 or has_phrase
        else:
            topical_match = topic_matches >= 1 or has_phrase

        if not topical_match:
            continue
        if score < 0.45 and not has_phrase:
            continue
        if not has_substantive and not has_phrase:
            continue
        filtered.append(item)

    metrics = _summarize_topic_metrics(annotated, topic_profile, len(filtered))
    if filtered:
        return filtered, metrics, None

    warning = (
        "No strongly grounded topic evidence matched your query terms in this time range."
    )
    return [], metrics, warning


def _compute_freshness(
    cursor,
    db_path: str,
    now_ms: int,
    intent: str = "auto",
    query_end_ms: Optional[int] = None,
) -> Dict[str, Any]:
    has_activity = _table_exists(cursor, "activity_events")
    has_session_docs = _table_exists(cursor, "session_retrieval_docs")
    has_snapshots = _table_exists(cursor, "context_snapshots")
    has_frames = _table_exists(cursor, "ocr_frames")
    has_pipeline = _table_exists(cursor, "pipeline_watermarks")
    has_video_chunks = _table_exists(cursor, "video_chunks")

    last_activity_ts = (
        _max_value(cursor, "SELECT MAX(ts_end) FROM activity_events")
        if has_activity
        else None
    )
    last_session_doc_ts = (
        _max_value(cursor, "SELECT MAX(chunk_end_ts) FROM session_retrieval_docs")
        if has_session_docs
        else None
    )
    last_snapshot_ts = (
        _max_value(cursor, "SELECT MAX(ts) FROM context_snapshots")
        if has_snapshots
        else None
    )
    last_ocr_frame_ts = (
        _max_value(cursor, "SELECT MAX(timestamp) FROM ocr_frames")
        if has_frames
        else None
    )
    last_capture_ts = None
    if has_video_chunks:
        last_capture_ts = _max_value(
            cursor,
            "SELECT MAX(COALESCE(end_time, start_time)) FROM video_chunks",
        )
    if not last_capture_ts:
        last_capture_ts = last_ocr_frame_ts

    last_chunk_built_ts = last_session_doc_ts
    last_context_ts = max(
        [ts for ts in [last_session_doc_ts, last_snapshot_ts] if ts is not None],
        default=None,
    )

    last_chunk_embedded_ts: Optional[int] = None
    pending_chunks = 0
    oldest_pending_chunk_ts = None

    source_mismatch = False
    source_mismatch_note = None

    if has_pipeline:
        try:
            cursor.execute(
                """
                SELECT source_mismatch, source_mismatch_note
                FROM pipeline_watermarks
                WHERE id = 1
                """
            )
            row = cursor.fetchone()
            if row:
                source_mismatch = bool(row[0] or 0)
                source_mismatch_note = row[1]
        except Exception:
            source_mismatch = False

    if not source_mismatch and has_frames:
        try:
            ritual_dir = os.path.dirname(db_path)
            legacy_frames_path = os.path.join(ritual_dir, "frames.db")
            if os.path.exists(legacy_frames_path):
                legacy_conn = sqlite3.connect(
                    f"file:{legacy_frames_path}?mode=ro",
                    uri=True,
                    timeout=1.0,
                )
                legacy_cursor = legacy_conn.cursor()
                legacy_cursor.execute(
                    """
                    SELECT 1 FROM sqlite_master
                    WHERE type='table' AND name='ocr_frames'
                    LIMIT 1
                    """
                )
                if legacy_cursor.fetchone() is not None:
                    legacy_cursor.execute("SELECT MAX(timestamp) FROM ocr_frames")
                    legacy_latest = legacy_cursor.fetchone()
                    legacy_ts = int(legacy_latest[0]) if legacy_latest and legacy_latest[0] is not None else None
                    if legacy_ts and (last_ocr_frame_ts is None or legacy_ts > last_ocr_frame_ts + 60_000):
                        source_mismatch = True
                        source_mismatch_note = (
                            "Legacy frames.db has newer OCR rows than canonical ritual.db."
                        )
                legacy_conn.close()
        except Exception:
            pass

    reference_ms = min(now_ms, int(query_end_ms)) if query_end_ms is not None else now_ms

    def _lag_seconds(ts_value: Optional[int]) -> Optional[int]:
        if ts_value is None:
            return None
        return max(0, int((reference_ms - ts_value) / 1000))

    capture_lag = _lag_seconds(last_capture_ts)
    activity_lag = _lag_seconds(last_activity_ts)
    ocr_lag = _lag_seconds(last_ocr_frame_ts)
    chunk_lag = _lag_seconds(last_chunk_built_ts)
    embedding_lag = _lag_seconds(last_chunk_embedded_ts)

    intent_normalized = (intent or "auto").strip().lower()
    semantic_intent = intent_normalized in {"semantic_lookup", "evidence_timeline", "broad_overview"}
    time_intent = intent_normalized in {"time_spent", "broad_overview"}

    semantic_anchor_ts = max(
        [ts for ts in [last_context_ts, last_ocr_frame_ts] if ts is not None],
        default=None,
    )
    time_anchor_ts = max(
        [ts for ts in [last_activity_ts, last_ocr_frame_ts] if ts is not None],
        default=None,
    )
    overall_anchor_ts = max(
        [
            ts for ts in [last_capture_ts, last_activity_ts, last_context_ts, last_ocr_frame_ts] if ts is not None
        ],
        default=None,
    )
    semantic_anchor_lag = _lag_seconds(semantic_anchor_ts)
    time_anchor_lag = _lag_seconds(time_anchor_ts)

    anchor_source = "overall_pipeline"
    anchor_ts = overall_anchor_ts
    anchor_lag = _lag_seconds(anchor_ts)
    if semantic_intent and semantic_anchor_ts is not None:
        anchor_source = "semantic_pipeline"
        anchor_ts = semantic_anchor_ts
        anchor_lag = semantic_anchor_lag
    elif time_intent and time_anchor_ts is not None:
        anchor_source = "activity_pipeline"
        anchor_ts = time_anchor_ts
        anchor_lag = time_anchor_lag

    status = "healthy"
    reasons: List[str] = []
    if (
        last_capture_ts is None
        and last_activity_ts is None
        and last_context_ts is None
        and last_ocr_frame_ts is None
    ):
        status = "unavailable"
        reasons.append("no_recent_capture_data")
    elif source_mismatch:
        status = "degraded_semantic"
        reasons.append("source_mismatch")
    elif semantic_intent and semantic_anchor_lag is not None and semantic_anchor_lag > 3600:
        status = "degraded_semantic"
        reasons.append("semantic_anchor_lag_gt_1h")
    elif semantic_intent and semantic_anchor_lag is not None and semantic_anchor_lag > 300:
        status = "degraded_semantic"
        reasons.append("semantic_anchor_lag_gt_5m")
    elif time_intent and activity_lag is not None and activity_lag > 3600:
        status = "degraded_ocr"
        reasons.append("activity_lag_gt_1h")
    elif time_intent and activity_lag is not None and activity_lag > 600:
        status = "degraded_ocr"
        reasons.append("activity_lag_gt_10m")

    return {
        "status": status,
        "lag_reference_ts": reference_ms,
        "capture_lag_seconds": capture_lag,
        "activity_lag_seconds": activity_lag,
        "ocr_lag_seconds": ocr_lag,
        "chunk_lag_seconds": chunk_lag,
        "embedding_lag_seconds": embedding_lag,
        "last_capture_ts": last_capture_ts,
        "last_activity_ts": last_activity_ts,
        "last_session_doc_ts": last_session_doc_ts,
        "last_snapshot_ts": last_snapshot_ts,
        "last_context_ts": last_context_ts,
        "last_ocr_frame_ts": last_ocr_frame_ts,
        "last_chunk_built_ts": last_chunk_built_ts,
        "last_chunk_embedded_ts": last_chunk_embedded_ts,
        "pending_chunks": pending_chunks,
        "oldest_pending_chunk_ts": oldest_pending_chunk_ts,
        "source_mismatch": source_mismatch,
        "source_mismatch_note": source_mismatch_note,
        "anchor_source": anchor_source,
        "anchor_ts": anchor_ts,
        "anchor_lag_seconds": anchor_lag,
        "intent": intent_normalized,
        "reasons": reasons,
    }


def _compute_semantic_readiness(cursor, now_ms: int) -> Dict[str, Any]:
    has_session_docs = _table_exists(cursor, "session_retrieval_docs")
    if has_session_docs:
        try:
            cursor.execute("SELECT COUNT(*) FROM session_retrieval_docs")
            row_total = cursor.fetchone()
            total_docs = int(row_total[0] or 0) if row_total else 0
            if total_docs > 0:
                recent_cutoff = now_ms - (60 * 60 * 1000)
                cursor.execute(
                    """
                    SELECT COUNT(*)
                    FROM session_retrieval_docs
                    WHERE chunk_end_ts >= ?
                    """,
                    (recent_cutoff,),
                )
                row_recent = cursor.fetchone()
                recent_docs = int(row_recent[0] or 0) if row_recent else 0
                ready = recent_docs > 0 or total_docs >= 25
                return {
                    "ready": bool(ready),
                    "coverage": 1.0,
                    "total_chunks": total_docs,
                    "embedded_chunks": total_docs,
                    "recent_unembedded": 0,
                    "reason": "session_retrieval_docs_available",
                    "tier": "semantic_full" if ready else "semantic_frame",
                }
        except Exception:
            pass

    has_snapshots = _table_exists(cursor, "context_snapshots")
    if has_snapshots:
        try:
            cursor.execute("SELECT COUNT(*) FROM context_snapshots")
            row_total = cursor.fetchone()
            total_snapshots = int(row_total[0] or 0) if row_total else 0
            if total_snapshots > 0:
                recent_cutoff = now_ms - (60 * 60 * 1000)
                cursor.execute(
                    """
                    SELECT COUNT(*)
                    FROM context_snapshots
                    WHERE ts >= ?
                    """,
                    (recent_cutoff,),
                )
                row_recent = cursor.fetchone()
                recent_snapshots = int(row_recent[0] or 0) if row_recent else 0
                ready = recent_snapshots >= 5 or total_snapshots >= 100
                return {
                    "ready": bool(ready),
                    "coverage": 1.0,
                    "total_chunks": total_snapshots,
                    "embedded_chunks": total_snapshots,
                    "recent_unembedded": 0,
                    "reason": "context_snapshots_available",
                    "tier": "semantic_frame",
                }
        except Exception:
            pass

    return {
        "ready": False,
        "coverage": 0.0,
        "total_chunks": 0,
        "embedded_chunks": 0,
        "recent_unembedded": 0,
        "reason": "session_context_unavailable",
        "tier": "lexical_fts",
    }


def _determine_retrieval_tier(
    intent: str,
    freshness: Dict[str, Any],
    semantic_readiness: Optional[Dict[str, Any]],
    semantic_truth: Optional[Dict[str, Any]],
    time_truth: Optional[Dict[str, Any]],
) -> str:
    intent_normalized = (intent or "auto").strip().lower()
    freshness_status = (freshness or {}).get("status") or "unavailable"

    if freshness_status == "unavailable":
        return "unavailable"

    semantic_intent = intent_normalized in {"semantic_lookup", "evidence_timeline", "broad_overview"}
    time_intent = intent_normalized in {"time_spent", "broad_overview"}

    if semantic_intent:
        if freshness_status == "stale":
            return "activity_only" if (time_truth is not None or time_intent) else "unavailable"

        mode_used = ((semantic_truth or {}).get("mode_used") or "").strip().lower()
        status_used = ((semantic_truth or {}).get("status") or "").strip().lower()
        # Runtime retrieval mode is more trustworthy than optimistic readiness tiering.
        if "fts" in mode_used or "text" in mode_used or status_used in {"text-only", "fts-only"}:
            return "lexical_fts"
        if "activity" in mode_used:
            return "activity_only"
        if mode_used in {"context-session-docs", "context-merged"}:
            return "semantic_full"
        if mode_used == "context-snapshots":
            return "semantic_frame"

        readiness_tier = (semantic_readiness or {}).get("tier")
        if isinstance(readiness_tier, str) and readiness_tier in {"semantic_full", "semantic_frame", "lexical_fts"}:
            if readiness_tier == "semantic_full":
                return "semantic_full"
            if readiness_tier == "semantic_frame":
                return "semantic_frame"
            return "lexical_fts"

        if "hybrid" in mode_used:
            return "semantic_frame"
        if "like" in mode_used:
            return "lexical_fts"

        if freshness_status == "degraded_ocr":
            return "lexical_fts"
        return "lexical_fts"

    if time_intent:
        return "activity_only"

    return "activity_only" if time_truth is not None else "unavailable"


def _load_time_truth(
    cursor,
    start_ms: int,
    end_ms: int,
    group_by: str,
    limit: int,
    start_date: str,
    end_date: str,
) -> Dict[str, Any]:
    bucket_expr = "COALESCE(NULLIF(app_name, ''), NULLIF(app_bundle_id, ''), 'Unknown')"
    if group_by == "domain":
        bucket_expr = "COALESCE(NULLIF(browser_domain, ''), 'Unknown domain')"
    elif group_by == "window":
        bucket_expr = "COALESCE(NULLIF(window_title, ''), COALESCE(NULLIF(app_name, ''), 'Unknown'))"

    overlap_expr = "MAX(0, MIN(ts_end, ?) - MAX(ts_start, ?))"

    cursor.execute(
        f"""
        SELECT
            COALESCE(SUM({overlap_expr}), 0) AS total_active_ms,
            COUNT(*) AS total_events,
            COUNT(DISTINCT DATE(ts_start / 1000, 'unixepoch', 'localtime')) AS days_with_activity,
            COUNT(DISTINCT {bucket_expr}) AS unique_buckets
        FROM activity_events
        WHERE ts_start <= ?
          AND ts_end >= ?
          AND COALESCE(is_afk, 0) = 0
        """,
        (end_ms, start_ms, end_ms, start_ms),
    )
    summary_row = cursor.fetchone() or (0, 0, 0, 0)
    total_active_ms = int(summary_row[0] or 0)

    cursor.execute(
        f"""
        SELECT
            {bucket_expr} AS bucket,
            COALESCE(SUM({overlap_expr}), 0) AS total_active_ms,
            COUNT(*) AS hits,
            MAX(ts_end) AS last_seen_ts
        FROM activity_events
        WHERE ts_start <= ?
          AND ts_end >= ?
          AND COALESCE(is_afk, 0) = 0
        GROUP BY bucket
        ORDER BY total_active_ms DESC
        LIMIT ?
        """,
        (end_ms, start_ms, end_ms, start_ms, limit),
    )
    top_rows = cursor.fetchall() or []
    top_buckets: List[Dict[str, Any]] = []
    for row in top_rows:
        row_total_ms = int(row[1] or 0)
        share_percent = round((row_total_ms / total_active_ms) * 100.0, 1) if total_active_ms > 0 else 0.0
        top_buckets.append(
            {
                "bucket": row[0] or "Unknown",
                "total_active_ms": row_total_ms,
                "total_active_hours": _safe_hours(row_total_ms),
                "share_percent": share_percent,
                "hits": int(row[2] or 0),
                "last_seen_ts": int(row[3]) if row[3] is not None else None,
            }
        )

    cursor.execute(
        f"""
        SELECT
            DATE(ts_start / 1000, 'unixepoch', 'localtime') AS day,
            COALESCE(SUM({overlap_expr}), 0) AS total_active_ms,
            COUNT(*) AS hits
        FROM activity_events
        WHERE ts_start <= ?
          AND ts_end >= ?
          AND COALESCE(is_afk, 0) = 0
        GROUP BY day
        ORDER BY day ASC
        """,
        (end_ms, start_ms, end_ms, start_ms),
    )
    daily_rows = cursor.fetchall() or []
    daily_breakdown = [
        {
            "date": row[0],
            "total_active_ms": int(row[1] or 0),
            "total_active_hours": _safe_hours(row[1] or 0),
            "hits": int(row[2] or 0),
        }
        for row in daily_rows
        if row[0]
    ]

    return {
        "metric_source": "activity_events",
        "group_by": group_by,
        "range_start": start_date,
        "range_end": end_date,
        "total_active_ms": total_active_ms,
        "total_active_hours": _safe_hours(total_active_ms),
        "total_events": int(summary_row[1] or 0),
        "days_with_activity": int(summary_row[2] or 0),
        "unique_buckets": int(summary_row[3] or 0),
        "top_buckets": top_buckets,
        "daily_breakdown": daily_breakdown,
    }


def _build_citations(results: List[Dict[str, Any]], start_ms: int, end_ms: int, limit: int) -> List[Dict[str, Any]]:
    citations: List[Dict[str, Any]] = []
    for item in results:
        try:
            timestamp = int(item.get("timestamp") or 0)
        except Exception:
            continue
        if timestamp < start_ms or timestamp > end_ms:
            continue
        frame_id = int(item.get("frame_id") or 0)
        score = float(item.get("relevance_score") or 0.0)
        app_name = str(item.get("app_name") or "Unknown")
        window_title = item.get("window_title")
        ocr_text = str(item.get("ocr_text") or "")
        snippet = _preferred_semantic_text(
            semantic_summary=item.get("semantic_summary"),
            contextual_text=item.get("contextual_retrieval_text"),
            raw_text=ocr_text,
        )
        if len(snippet) > 240:
            snippet = f"{snippet[:240].rstrip()}..."

        chunk_id = int(timestamp // 90_000) if timestamp > 0 else None
        citations.append(
            {
                "evidence_id": item.get("evidence_id")
                or f"e:{item.get('session_key') or item.get('session_id') or app_name}:{timestamp}",
                "chunk_id": chunk_id,
                "frame_id": frame_id if frame_id > 0 else None,
                "timestamp": timestamp,
                "app_name": app_name,
                "window_title": window_title,
                "document_title": item.get("document_title"),
                "document_path": item.get("document_path"),
                "browser_domain": item.get("browser_domain"),
                "session_id": item.get("session_id"),
                "session_key": item.get("session_key") or (f"session:{item.get('session_id')}" if item.get("session_id") else None),
                "snippet": snippet,
                "parent_context": item.get("parent_context"),
                "contextual_retrieval_text": item.get("contextual_retrieval_text"),
                "semantic_summary": item.get("semantic_summary"),
                "score": round(max(0.0, min(1.0, score)), 3),
                "source": item.get("source") or "unknown",
                "source_type": item.get("source_type"),
                "capture_quality": item.get("capture_quality"),
            }
        )
        if len(citations) >= limit:
            break
    return citations


def _build_story_semantics(
    *,
    query: str,
    intent: str,
    citations: List[Dict[str, Any]],
    time_truth: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    if not citations:
        return None
    try:
        return build_story_plan(
            citations,
            query=query,
            intent=intent,
            time_truth=time_truth,
        )
    except Exception as exc:
        logger.debug("story planning failed: %s", exc)
        return None


async def _materialize_recap_work_items(
    *,
    user_id: str,
    range_start_ts: int,
    range_end_ts: int,
    source_scope: str,
    story_plan: Dict[str, Any],
    citations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    if not story_plan or not citations:
        return {"items": [], "stored": 0, "evidence": 0}
    try:
        async with watcher_service_local_db.open_activity_connection_for_user(user_id, write=True) as conn:
            if conn is None:
                return {"items": [], "stored": 0, "evidence": 0}
            conn.row_factory = sqlite3.Row
            result = materialize_semantic_work_items(
                conn,
                user_id=user_id,
                range_start_ts=range_start_ts,
                range_end_ts=range_end_ts,
                source_scope=source_scope,
                story_plan=story_plan,
                citations=citations,
            )
            items = load_semantic_work_items_for_range(
                conn,
                user_id=user_id,
                range_start_ts=range_start_ts,
                range_end_ts=range_end_ts,
                source_scope=source_scope,
                limit=12,
            )
            return {
                "items": items,
                "stored": int(result.get("stored") or 0),
                "evidence": int(result.get("evidence") or 0),
            }
    except Exception as exc:
        logger.debug("semantic work item materialization failed: %s", exc)
        return {"items": [], "stored": 0, "evidence": 0}


def _clip_recap_text(value: str, max_len: int = 180) -> str:
    compact = " ".join(str(value or "").split())
    if len(compact) <= max_len:
        return compact
    return f"{compact[: max_len - 3].rstrip()}..."


def _tokenize_recap_text(value: str) -> List[str]:
    tokens = re.findall(r"[a-z0-9./:_-]{3,}", str(value or "").lower())
    return [token for token in tokens if token not in SCREEN_SEARCH_STOP_WORDS]


def _infer_recap_workstream(app_name: str, window_title: str, snippets: List[str]) -> str:
    haystack = f"{app_name} {window_title} {' '.join(snippets)}".lower()
    if any(token in haystack for token in ("cursor", "vscode", "terminal", "github", "pull request", "typescript", "rust")):
        return "Implementation and code changes"
    if any(token in haystack for token in ("things", "todo", "calendar", "notion", "planning", "schedule", "inbox")):
        return "Planning and task management"
    if any(token in haystack for token in ("docs", "guide", "reference", "anthropic", "readme", "documentation", "article")):
        return "Research and documentation review"
    if any(token in haystack for token in ("figma", "css", "design", "ui", "ux")):
        return "Design and interface work"
    if any(token in haystack for token in ("slack", "mail", "message", "meeting", "zoom")):
        return "Communication and coordination"
    return f"{(app_name or 'General').strip() or 'General'} work session"


def _extract_specific_task_phrases(values: List[str], limit: int) -> List[str]:
    counts: Dict[str, int] = {}

    def _score_phrase(phrase: str) -> int:
        score = 0
        if re.search(r"[./][a-z0-9_-]{2,8}\b", phrase, re.IGNORECASE):
            score += 3
        if re.search(r"(src/|app/|api/|target/|crates/|components/)", phrase, re.IGNORECASE):
            score += 3
        if re.search(r"[A-Z][a-z]+[A-Z][A-Za-z]+", phrase):
            score += 2
        if re.search(r"\b(clerk|vector|embedding|chunk|rerank|hybrid|backfill|dashboard|sidebar|auth|oauth|sqlite|ocr|upload|ingest|query|prompt|cursor|things 3)\b", phrase, re.IGNORECASE):
            score += 2
        if len(phrase.split()) >= 3:
            score += 1
        return score

    for value in values:
        normalized = " ".join(str(value or "").split()).strip()
        if not normalized:
            continue
        for raw_part in re.split(r"\s*[|;:\-]\s*|\.\s+|,\s+", normalized):
            phrase = raw_part.strip()
            if len(phrase) < 12 or len(phrase) > 140:
                continue
            tokens = _tokenize_recap_text(phrase)
            if len(tokens) < 2:
                continue
            if all(
                token in {"planning", "management", "session", "work", "tasks", "project", "projects", "used", "app", "unknown"}
                for token in tokens
            ):
                continue
            clipped = _clip_recap_text(phrase, 140)
            counts[clipped] = counts.get(clipped, 0) + _score_phrase(clipped)

    return [
        phrase
        for phrase, _score in sorted(counts.items(), key=lambda row: (-int(row[1]), row[0]))[:limit]
    ]


def _build_recap_outline(
    citations: List[Dict[str, Any]],
    highlights: List[Dict[str, Any]],
) -> Dict[str, Any]:
    del highlights
    return _build_story_semantics(
        query="What did I do?",
        intent="broad_overview",
        citations=citations,
    ) or {
        "main_workstreams": [],
        "apps_and_tools_used": [],
        "specific_tasks": [],
        "timeline_segments": [],
        "strongest_evidence": [],
        "uncertainty_or_conflicts": [],
    }


def _normalize_fallback_citations(citations: List[Dict[str, Any]], source: str) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for item in citations:
        if not isinstance(item, dict):
            continue
        timestamp = int(item.get("timestamp") or 0)
        if timestamp <= 0:
            continue
        frame_id = item.get("frame_id")
        try:
            frame_id = int(frame_id) if frame_id is not None else None
        except Exception:
            frame_id = None
        chunk_id = item.get("chunk_id")
        if chunk_id is None:
            chunk_id = int(timestamp // 90_000)
        snippet = _preferred_semantic_text(
            semantic_summary=item.get("semantic_summary"),
            contextual_text=item.get("contextual_retrieval_text"),
            raw_text=(item.get("snippet") or item.get("ocr_text") or ""),
        ).strip()
        if len(snippet) > 280:
            snippet = f"{snippet[:280].rstrip()}..."
        normalized.append(
            {
                "chunk_id": chunk_id,
                "frame_id": frame_id if frame_id and frame_id > 0 else None,
                "timestamp": timestamp,
                "app_name": item.get("app_name"),
                "window_title": item.get("window_title"),
                "snippet": snippet,
                "contextual_retrieval_text": item.get("contextual_retrieval_text"),
                "semantic_summary": item.get("semantic_summary"),
                "score": round(float(item.get("score") or item.get("relevance_score") or 0.0), 3),
                "source": str(item.get("source") or source),
            }
        )
    return normalized


def _fuse_citations_rrf(
    primary: List[Dict[str, Any]],
    secondary: List[Dict[str, Any]],
    limit: int,
) -> List[Dict[str, Any]]:
    rrf_k = 60.0
    merged: Dict[str, Dict[str, Any]] = {}

    def _key(item: Dict[str, Any]) -> str:
        frame_id = item.get("frame_id")
        if frame_id is not None:
            return f"f:{frame_id}"
        chunk_id = item.get("chunk_id")
        ts = item.get("timestamp")
        app = str(item.get("app_name") or "")
        return f"c:{chunk_id}|t:{ts}|a:{app}"

    def _accumulate(items: List[Dict[str, Any]], lane_weight: float) -> None:
        for rank, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            citation = dict(item)
            citation_key = _key(citation)
            raw_score = float(citation.get("score") or 0.0)
            rrf_score = (lane_weight / (rrf_k + rank + 1.0)) + (0.15 * max(0.0, raw_score))
            existing = merged.get(citation_key)
            if existing is None:
                citation["_fused_score"] = rrf_score
                merged[citation_key] = citation
                continue
            existing["_fused_score"] = float(existing.get("_fused_score") or 0.0) + rrf_score
            if raw_score > float(existing.get("score") or 0.0):
                existing["score"] = round(raw_score, 3)
            if len(str(citation.get("snippet") or "")) > len(str(existing.get("snippet") or "")):
                existing["snippet"] = citation.get("snippet")
            if citation.get("semantic_summary") and not existing.get("semantic_summary"):
                existing["semantic_summary"] = citation.get("semantic_summary")
            if citation.get("contextual_retrieval_text") and not existing.get("contextual_retrieval_text"):
                existing["contextual_retrieval_text"] = citation.get("contextual_retrieval_text")

    _accumulate(primary, lane_weight=1.0)
    _accumulate(secondary, lane_weight=1.0)

    fused = list(merged.values())
    fused.sort(key=lambda row: float(row.get("_fused_score") or 0.0), reverse=True)
    for row in fused:
        row.pop("_fused_score", None)
    return fused[: max(1, limit)]


def _derive_confidence(
    citations: List[Dict[str, Any]],
    topic_metrics: Optional[Dict[str, Any]] = None,
    intent: str = "semantic_lookup",
) -> Dict[str, Any]:
    if not citations:
        return {
            "level": "low",
            "score": 0.0,
            "corroborating_chunks": 0,
            "reason": "No semantic evidence found in selected range.",
        }

    sorted_by_score = sorted(citations, key=lambda item: float(item.get("score") or 0.0), reverse=True)
    top_score = float(sorted_by_score[0].get("score") or 0.0)
    threshold = max(0.6, top_score - 0.12)
    corroborating_chunks = len({
        item.get("chunk_id")
        for item in sorted_by_score
        if float(item.get("score") or 0.0) >= threshold and item.get("chunk_id") is not None
    })

    has_textual_evidence = any(
        _has_substantive_snippet(str(item.get("snippet") or ""))
        for item in sorted_by_score
    )

    if not has_textual_evidence:
        return {
            "level": "low",
            "score": round(top_score, 3),
            "corroborating_chunks": corroborating_chunks,
            "reason": "Only app/window presence signals available; topic-level evidence is weak.",
        }

    topic_tokens = (topic_metrics or {}).get("query_tokens") or []
    topic_strong_tokens = (topic_metrics or {}).get("strong_tokens") or []
    topic_phrase_hits = int((topic_metrics or {}).get("phrase_hit_count") or 0)
    topic_top_matches = int((topic_metrics or {}).get("top_match_count") or 0)
    topic_top_strong = int((topic_metrics or {}).get("top_strong_match_count") or 0)
    corroborating_topic_chunks = int((topic_metrics or {}).get("corroborating_topic_chunks") or 0)

    strict_intent = intent in {"semantic_lookup", "evidence_timeline"}
    if strict_intent and topic_tokens:
        if topic_top_matches == 0 and topic_phrase_hits == 0:
            return {
                "level": "low",
                "score": round(top_score, 3),
                "corroborating_chunks": corroborating_chunks,
                "reason": "No direct topic-token evidence found in citations.",
            }

        if len(topic_strong_tokens) >= 2 and topic_top_strong < 2 and topic_phrase_hits == 0:
            return {
                "level": "low",
                "score": round(top_score, 3),
                "corroborating_chunks": corroborating_chunks,
                "reason": "Evidence only matches part of the requested topic; needs stronger grounding.",
            }

        if corroborating_topic_chunks < 1 and topic_phrase_hits == 0:
            return {
                "level": "low",
                "score": round(top_score, 3),
                "corroborating_chunks": corroborating_chunks,
                "reason": "Topic evidence is not corroborated across distinct moments.",
            }

    if top_score >= 0.78 and corroborating_chunks >= 2:
        level = "high"
    elif top_score >= 0.60 and corroborating_chunks >= 1:
        level = "medium"
    else:
        level = "low"

    reason = (
        "Evidence meets grounding threshold."
        if level in {"high", "medium"}
        else "Evidence is limited; answer should remain cautious."
    )
    return {
        "level": level,
        "score": round(top_score, 3),
        "corroborating_chunks": corroborating_chunks,
        "reason": reason,
    }


async def _load_semantic_truth(
    service,
    user_id: str,
    query: str,
    intent: str,
    days_back: int,
    limit: int,
    start_ms: int,
    end_ms: int,
    allow_activity_fallback: bool,
    allow_legacy_ocr_fallback: bool = True,
) -> Dict[str, Any]:
    legacy_ocr_fallback_allowed = allow_legacy_ocr_fallback and _legacy_ocr_fallback_enabled()
    semantic_result = await search_context_memory_impl(
        service=service,
        user_id=user_id,
        query=query,
        days_back=days_back,
        limit=max(limit * 4, 50),
        allow_legacy_fallback=allow_activity_fallback,
    )
    if legacy_ocr_fallback_allowed and not semantic_result.get("results"):
        semantic_result = await search_screen_recordings_impl(
            service=service,
            user_id=user_id,
            query=query,
            days_back=days_back,
            limit=max(limit * 4, 50),
            allow_activity_fallback=allow_activity_fallback,
        )

    raw_results = semantic_result.get("results") if isinstance(semantic_result, dict) else []
    if not isinstance(raw_results, list):
        raw_results = []

    citations = _build_citations(raw_results, start_ms=start_ms, end_ms=end_ms, limit=max(limit * 2, 20))
    filtered_citations, topic_metrics, specificity_warning = _apply_topic_specificity_filter(
        citations=citations,
        query=query,
        intent=intent,
    )
    highlight_limit = min(limit, 16) if intent == "broad_overview" else min(limit, 8)
    highlights = filtered_citations[:highlight_limit]
    if highlights:
        highlights = sorted(highlights, key=lambda item: item.get("timestamp") or 0, reverse=True)

    warning_parts: List[str] = []
    semantic_warning = semantic_result.get("warning") if isinstance(semantic_result, dict) else None
    if semantic_warning:
        warning_parts.append(str(semantic_warning))
    if specificity_warning:
        warning_parts.append(specificity_warning)

    return {
        "query": query,
        "result_count": len(filtered_citations),
        "mode_used": semantic_result.get("mode_used") if isinstance(semantic_result, dict) else "none",
        "status": semantic_result.get("status") if isinstance(semantic_result, dict) else "unavailable",
        "highlights": highlights,
        "warning": " ".join(part for part in warning_parts if part).strip() or None,
        "topic_specificity": topic_metrics,
        "citations": filtered_citations,
    }


async def query_memory_impl(
    service,
    user_id: str,
    query: str,
    intent: str = "auto",
    days_back: int = 7,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    timezone: Optional[str] = None,
    group_by: str = "app",
    limit: int = 20,
) -> Dict[str, Any]:
    normalized_query = (query or "").strip()
    safe_limit = max(1, min(int(limit or 20), 100))
    safe_group_by = group_by if group_by in {"app", "domain", "window"} else "app"
    start_day, end_day, resolved_days = _resolve_query_window(
        days_back,
        start_date,
        end_date,
        timezone_name=timezone,
        query=normalized_query,
    )

    def _error_response(message: str, *, resolved_intent: str = "semantic_lookup") -> Dict[str, Any]:
        return {
            "success": False,
            "query": normalized_query,
            "intent_resolved": resolved_intent,
            "answer_mode": "unavailable",
            "retrieval_tier": "unavailable",
            "days_back": resolved_days,
            "start_date": start_day.isoformat(),
            "end_date": end_day.isoformat(),
            "group_by": safe_group_by,
            "time_truth": None,
            "semantic_truth": None,
            "citations": [],
            "freshness": {"status": "unavailable"},
            "confidence": {"level": "low", "score": 0.0, "corroborating_chunks": 0},
            "provider_path": None,
            "warning": None,
            "source_db": None,
            "error": message,
        }

    if not normalized_query:
        return _error_response("query is required")

    query_tz = _resolve_query_timezone(timezone)
    start_ms = int(datetime.combine(start_day, dt_time.min, tzinfo=query_tz).timestamp() * 1000)
    end_ms = int(datetime.combine(end_day, dt_time.max, tzinfo=query_tz).timestamp() * 1000)
    resolved_intent = _detect_memory_intent(normalized_query, intent)

    activity_db_path = get_local_activity_db_path_impl()
    cloud_mode = memory_cloud_enabled()
    memory_db_path = get_local_memory_db_path_impl()
    local_activity_available = os.path.exists(activity_db_path)
    local_memory_available = os.path.exists(memory_db_path)
    use_legacy_memory_query_path = _legacy_memory_query_path_enabled() and local_memory_available
    if not local_activity_available and not cloud_mode and not use_legacy_memory_query_path:
        response = _error_response(
            f"local activity database not found at {activity_db_path}",
            resolved_intent=resolved_intent,
        )
        response["source_db"] = os.path.basename(activity_db_path)
        return response

    conn = None
    source_db_label: Optional[str] = None
    local_override_conn: Optional[sqlite3.Connection] = None
    should_include_time = resolved_intent in {"time_spent", "broad_overview"}
    should_include_semantic = resolved_intent in {"semantic_lookup", "evidence_timeline", "broad_overview"}
    now_ms = int(time.time() * 1000)
    override_warning: Optional[str] = None
    try:
        cursor = None
        async with watcher_service_local_db.open_activity_connection_for_user(user_id, write=False) as preferred_conn:
            if use_legacy_memory_query_path:
                conn = sqlite3.connect(
                    f"file:{memory_db_path}?mode=ro",
                    uri=True,
                    timeout=2.5,
                )
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                _attach_activity_view_if_needed(
                    cursor,
                    memory_db_path=memory_db_path,
                    activity_db_path=activity_db_path,
                )
                cursor.execute("PRAGMA query_only = ON")
                source_db_label = os.path.basename(memory_db_path)
            elif preferred_conn is not None:
                replica_row = preferred_conn.execute("PRAGMA database_list").fetchone()
                replica_path = None
                if replica_row and len(replica_row) >= 3:
                    replica_path = replica_row[2]
                if replica_path:
                    conn = sqlite3.connect(
                        f"file:{replica_path}?mode=ro",
                        uri=True,
                        timeout=2.5,
                    )
                    conn.row_factory = sqlite3.Row
                    cursor = conn.cursor()
                    cursor.execute("PRAGMA query_only = ON")
                    source_db_label = "activity_per_user_replica"
                elif local_activity_available:
                    conn = sqlite3.connect(
                        f"file:{activity_db_path}?mode=ro",
                        uri=True,
                        timeout=2.5,
                    )
                    conn.row_factory = sqlite3.Row
                    cursor = conn.cursor()
                    cursor.execute("PRAGMA query_only = ON")
                    source_db_label = os.path.basename(activity_db_path)
                else:
                    cursor = None
            elif local_activity_available:
                conn = sqlite3.connect(
                    f"file:{activity_db_path}?mode=ro",
                    uri=True,
                    timeout=2.5,
                )
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("PRAGMA query_only = ON")
                source_db_label = os.path.basename(activity_db_path)
            else:
                cursor = None

        if should_include_semantic and cursor is not None and source_db_label == "activity_per_user_replica" and local_activity_available:
            override_conn, override_cursor, override_warning = _maybe_open_richer_local_activity_context(
                current_cursor=cursor,
                activity_db_path=activity_db_path,
                recent_cutoff_ms=max(now_ms - (72 * 60 * 60 * 1000), start_ms),
                current_source_label=source_db_label,
            )
            if override_conn is not None and override_cursor is not None:
                if conn is not None:
                    conn.close()
                local_override_conn = override_conn
                conn = override_conn
                cursor = override_cursor
                source_db_label = os.path.basename(activity_db_path)
            else:
                override_warning = None
        if cursor is not None:
            freshness = _compute_freshness(
                cursor,
                db_path=memory_db_path if use_legacy_memory_query_path else activity_db_path,
                now_ms=now_ms,
                intent=resolved_intent,
                query_end_ms=end_ms,
            )
        else:
            freshness = {
                "status": "unavailable",
                "reasons": ["local_activity_db_missing"],
                "source_db": source_db_label or os.path.basename(activity_db_path),
                "local_db_available": False,
            }
        semantic_readiness: Optional[Dict[str, Any]] = None
        if should_include_semantic and not cloud_mode and cursor is not None:
            semantic_readiness = _compute_semantic_readiness(cursor, now_ms=now_ms)
            freshness["semantic_readiness"] = semantic_readiness
            if not semantic_readiness.get("ready", False):
                if freshness.get("status") == "healthy":
                    freshness["status"] = "degraded_semantic"
                reasons = freshness.get("reasons") or []
                if "semantic_coverage_low" not in reasons:
                    reasons.append("semantic_coverage_low")
                freshness["reasons"] = reasons

        answer_mode = _resolve_answer_mode(
            status=str(freshness.get("status") or "healthy"),
            intent=resolved_intent,
        )
        warning_parts: List[str] = []
        if freshness.get("status") == "degraded_semantic":
            if resolved_intent == "time_spent":
                warning_parts.append("Semantic indexing is degraded, but time totals are still computed from activity events.")
            else:
                warning_parts.append("Semantic retrieval is degraded; using lexical-first fallback where needed.")
        elif freshness.get("status") == "degraded_ocr":
            if resolved_intent == "time_spent":
                warning_parts.append("OCR evidence is stale; time totals still come from activity events.")
            else:
                warning_parts.append("OCR ingestion is stale; semantic answers are limited until OCR catches up.")
        elif freshness.get("status") == "stale":
            if resolved_intent == "time_spent":
                warning_parts.append("Data source mismatch detected. Time totals remain activity-based, but evidence quality may be reduced.")
            else:
                warning_parts.append("Data source mismatch or stale OCR detected; semantic claims are restricted.")
        elif freshness.get("status") == "unavailable":
            if cloud_mode and not local_activity_available:
                warning_parts.append("Local activity/context data is unavailable on this backend instance; relying on cloud memory only.")
            else:
                warning_parts.append("No recent activity/context data is available.")
        if should_include_semantic and override_warning:
            warning_parts.append(override_warning)
        if freshness.get("source_mismatch"):
            warning_parts.append(
                str(freshness.get("source_mismatch_note") or "Data source mismatch detected between canonical and legacy local DBs.")
            )
        if should_include_semantic and (not cloud_mode) and semantic_readiness and not semantic_readiness.get("ready", False):
            warning_parts.append(
                "Cloud semantic context is unavailable; results may fall back to lexical matching until session docs sync."
            )

        time_truth: Optional[Dict[str, Any]] = None
        semantic_truth: Optional[Dict[str, Any]] = None
        citations: List[Dict[str, Any]] = []
        provider_path: Optional[Dict[str, Any]] = None
        cloud_retrieval_debug: Optional[Dict[str, Any]] = None
        confidence = {
            "level": "low",
            "score": 0.0,
            "corroborating_chunks": 0,
            "reason": "No semantic evidence evaluated.",
        }

        if should_include_time and cursor is not None and _table_exists(cursor, "activity_events"):
            time_truth = _load_time_truth(
                cursor=cursor,
                start_ms=start_ms,
                end_ms=end_ms,
                group_by=safe_group_by,
                limit=safe_limit,
                start_date=start_day.isoformat(),
                end_date=end_day.isoformat(),
            )

        semantic_allowed = cloud_mode or freshness.get("status") not in {"stale", "unavailable"}
        if should_include_semantic and semantic_allowed:
            if cloud_mode:
                try:
                    cloud_result = await query_semantic_cloud(
                        user_id=user_id,
                        query=normalized_query,
                        intent=resolved_intent,
                        start_ms=start_ms,
                        end_ms=end_ms,
                        limit=safe_limit,
                    )
                    auto_backfill_warning = await _auto_backfill_cloud_if_needed(
                        user_id=user_id,
                        start_ms=start_ms,
                        end_ms=end_ms,
                    )
                    if auto_backfill_warning:
                        warning_parts.append(auto_backfill_warning)
                    if cloud_result.get("enabled"):
                        cloud_semantic_truth = cloud_result.get("semantic_truth")
                        if isinstance(cloud_semantic_truth, dict) and isinstance(
                            cloud_semantic_truth.get("debug"), dict
                        ):
                            cloud_retrieval_debug = dict(cloud_semantic_truth.get("debug") or {})
                        cloud_citations = cloud_result.get("citations") or []
                        if cloud_citations:
                            semantic_truth = cloud_semantic_truth
                            citations = cloud_citations
                            confidence = cloud_result.get("confidence") or confidence
                            provider_path = cloud_result.get("provider_path")
                        elif semantic_truth is None:
                            semantic_truth = cloud_semantic_truth
                            citations = []
                            provider_path = cloud_result.get("provider_path")
                        if not isinstance(provider_path, dict):
                            provider_path = {}
                        provider_path["retrieval"] = "turbopuffer"
                        provider_path["retrieval_mode"] = "cloud_primary" if citations else "cloud_degraded"
                        provider_path.setdefault("answer", "openai")
                        if citations:
                            warning_parts = [
                                part
                                for part in warning_parts
                                if part != "Semantic retrieval is degraded; using lexical-first fallback where needed."
                            ]
                        if semantic_truth and semantic_truth.get("warning"):
                            warning_parts.append(str(semantic_truth["warning"]))

                        cloud_index_health = cloud_result.get("index_health") or {}
                        allow_local_fallback = (
                            not _cloud_first_chat_enabled()
                            or freshness.get("status") in {"stale", "unavailable", "degraded_ocr"}
                            or int(cloud_index_health.get("pending_jobs") or 0) > 1000
                            or int(cloud_index_health.get("embedding_lag_seconds") or 0) > 15 * 60
                        )

                        if not citations and allow_local_fallback and not memory_fail_closed():
                            try:
                                local_fallback = await _load_semantic_truth(
                                    service=service,
                                    user_id=user_id,
                                    query=normalized_query,
                                    intent=resolved_intent,
                                    days_back=resolved_days,
                                    limit=safe_limit,
                                    start_ms=start_ms,
                                    end_ms=end_ms,
                                    allow_activity_fallback=resolved_intent not in {"semantic_lookup", "evidence_timeline"},
                                )
                                local_citations_raw = local_fallback.get("citations") or local_fallback.get("highlights") or []
                                local_citations = _normalize_fallback_citations(
                                    local_citations_raw,
                                    source="local_bridge_fallback",
                                )
                                if local_citations:
                                    citations = _fuse_citations_rrf(
                                        primary=citations,
                                        secondary=local_citations,
                                        limit=safe_limit,
                                    )
                                    if not isinstance(semantic_truth, dict):
                                        semantic_truth = {}
                                    semantic_truth["highlights"] = citations[: min(safe_limit, 8)]
                                    semantic_truth["result_count"] = len(citations)
                                    semantic_truth["mode_used"] = "cloud-degraded+local-fallback"
                                    semantic_truth["status"] = "hybrid"

                                    confidence = _derive_confidence(
                                        citations,
                                        topic_metrics=local_fallback.get("topic_specificity"),
                                        intent=resolved_intent,
                                    )
                                    if provider_path is None:
                                        provider_path = {}
                                    provider_path["retrieval"] = "local_fallback"
                                    provider_path["retrieval_mode"] = "local_fallback"
                                    warning_parts.append(
                                        "Cloud retrieval was degraded; using explicit local fallback evidence."
                                    )
                            except Exception as local_exc:
                                logger.debug("Local bridge fallback failed: %s", local_exc)

                        if not citations and memory_fail_closed():
                            warning_parts.append(
                                "Cloud semantic retrieval returned no grounded evidence; semantic intent is fail-closed."
                            )

                        if _memory_shadow_enabled() and random.random() <= _memory_shadow_sample_rate():
                            try:
                                strict_semantic_intent = resolved_intent in {"semantic_lookup", "evidence_timeline"}
                                local_shadow = await _load_semantic_truth(
                                    service=service,
                                    user_id=user_id,
                                    query=normalized_query,
                                    intent=resolved_intent,
                                    days_back=resolved_days,
                                    limit=safe_limit,
                                    start_ms=start_ms,
                                    end_ms=end_ms,
                                    allow_activity_fallback=not strict_semantic_intent,
                                )
                                logger.info(
                                    "[memory-shadow] query=%s cloud_count=%s local_count=%s cloud_mode=%s local_mode=%s",
                                    normalized_query,
                                    len(citations),
                                    int(local_shadow.get("result_count") or 0),
                                    (semantic_truth or {}).get("mode_used"),
                                    local_shadow.get("mode_used"),
                                )
                            except Exception as shadow_exc:
                                logger.debug("memory shadow comparison failed: %s", shadow_exc)
                except Exception as cloud_exc:
                    if citations:
                        warning_parts.append(
                            f"Cloud semantic retrieval error; continuing with cloud-grounded evidence already assembled: {cloud_exc}"
                        )
                        if provider_path is None:
                            provider_path = {
                                "retrieval": "turbopuffer",
                                "retrieval_mode": "cloud_primary",
                                "rerank": "none",
                                "answer": "openai",
                            }
                    elif memory_fail_closed():
                        semantic_truth = {
                            "query": normalized_query,
                            "result_count": 0,
                            "mode_used": "cloud-unavailable",
                            "status": "unavailable",
                            "highlights": [],
                            "warning": "Cloud semantic retrieval is unavailable; semantic responses are blocked by fail-closed policy.",
                        }
                        citations = []
                        confidence = {
                            "level": "low",
                            "score": 0.0,
                            "corroborating_chunks": 0,
                            "reason": "Cloud semantic retrieval unavailable.",
                        }
                        provider_path = {
                            "retrieval": "turbopuffer",
                            "retrieval_mode": "cloud_degraded",
                            "rerank": "cohere|openai",
                            "answer": "openai",
                        }
                        warning_parts.append(f"Cloud semantic retrieval error: {cloud_exc}")
                    else:
                        allow_local_fallback = (
                            not _cloud_first_chat_enabled()
                            or freshness.get("status") in {"stale", "unavailable", "degraded_ocr"}
                        )
                        if allow_local_fallback:
                            warning_parts.append(f"Cloud semantic retrieval error; using explicit local fallback: {cloud_exc}")
                            strict_semantic_intent = resolved_intent in {"semantic_lookup", "evidence_timeline"}
                            semantic_truth = await _load_semantic_truth(
                                service=service,
                                user_id=user_id,
                                query=normalized_query,
                                intent=resolved_intent,
                                days_back=resolved_days,
                                limit=safe_limit,
                                start_ms=start_ms,
                                end_ms=end_ms,
                                allow_activity_fallback=not strict_semantic_intent,
                            )
                            citations = semantic_truth.pop("citations", [])
                            confidence = _derive_confidence(
                                citations,
                                topic_metrics=semantic_truth.get("topic_specificity"),
                                intent=resolved_intent,
                            )
                            provider_path = {
                                "retrieval": "local_fallback",
                                "retrieval_mode": "local_fallback",
                                "rerank": "none",
                                "answer": "openai",
                            }
                        else:
                            warning_parts.append(f"Cloud semantic retrieval error: {cloud_exc}")
                            semantic_truth = {
                                "query": normalized_query,
                                "result_count": 0,
                                "mode_used": "cloud-unavailable",
                                "status": "unavailable",
                                "highlights": [],
                                "warning": "Cloud semantic retrieval is unavailable and local fallback is disabled in cloud-first mode.",
                            }
                            provider_path = {
                                "retrieval": "turbopuffer",
                                "retrieval_mode": "cloud_degraded",
                                "rerank": "cohere|openai",
                                "answer": "openai",
                            }
            else:
                strict_semantic_intent = resolved_intent in {"semantic_lookup", "evidence_timeline"}
                semantic_truth = await _load_semantic_truth(
                    service=service,
                    user_id=user_id,
                    query=normalized_query,
                    intent=resolved_intent,
                    days_back=resolved_days,
                    limit=safe_limit,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    allow_activity_fallback=not strict_semantic_intent,
                )
                citations = semantic_truth.pop("citations", [])
                confidence = _derive_confidence(
                    citations,
                    topic_metrics=semantic_truth.get("topic_specificity"),
                    intent=resolved_intent,
                )
                if semantic_truth.get("warning"):
                    warning_parts.append(str(semantic_truth["warning"]))
                provider_path = {
                    "retrieval": "local_fallback",
                    "retrieval_mode": "local_fallback",
                    "rerank": "none",
                    "answer": "openai",
                }
        elif should_include_semantic:
            warning_parts.append(
                "Semantic lookup blocked by freshness guard; returning activity-only context."
            )

        if citations and isinstance(semantic_truth, dict):
            if cloud_retrieval_debug:
                existing_debug = semantic_truth.get("debug")
                semantic_truth["debug"] = {
                    **cloud_retrieval_debug,
                    **(existing_debug if isinstance(existing_debug, dict) else {}),
                }
            story_plan = _build_story_semantics(
                query=normalized_query,
                intent=resolved_intent,
                citations=citations,
                time_truth=time_truth,
            )
            if story_plan:
                persisted_work_item_result = {"items": [], "stored": 0, "evidence": 0}
                renderer_kind = str((story_plan.get("renderer") or {}).get("kind") or "")
                if resolved_intent == "broad_overview" or renderer_kind == "daypart_overview":
                    persisted_work_item_result = await _materialize_recap_work_items(
                        user_id=user_id,
                        range_start_ts=start_ms,
                        range_end_ts=end_ms,
                        source_scope=renderer_kind or resolved_intent,
                        story_plan=story_plan,
                        citations=citations,
                    )
                semantic_truth["story_plan"] = story_plan
                semantic_truth["renderer"] = story_plan.get("renderer")
                semantic_truth["recap_outline"] = story_plan
                semantic_truth["semantic_work_items"] = persisted_work_item_result.get("items") or []
                semantic_truth["generation_mode"] = (
                    (story_plan.get("renderer") or {}).get("generation_mode") or "default"
                )
                debug_payload = semantic_truth.get("debug")
                if not isinstance(debug_payload, dict):
                    debug_payload = {}
                metrics = story_plan.get("metrics") or {}
                debug_payload.update(
                    {
                        "main_event_work_item_id": ((story_plan.get("main_event") or {}).get("id")),
                        "work_items_considered": int(metrics.get("work_items_considered") or 0),
                        "cross_app_stitches": int(metrics.get("cross_app_stitches") or 0),
                        "claim_count": int(metrics.get("claim_count") or 0),
                        "claim_grounding_rate": float(metrics.get("claim_grounding_rate") or 0.0),
                        "generic_fallback_used": bool(metrics.get("generic_fallback_used")),
                        "planning_only_ratio": float(metrics.get("planning_only_ratio") or 0.0),
                        "semantic_work_items_stored": int(
                            persisted_work_item_result.get("stored") or 0
                        ),
                        "semantic_work_item_evidence_rows": int(
                            persisted_work_item_result.get("evidence") or 0
                        ),
                        "semantic_work_items_loaded": len(
                            persisted_work_item_result.get("items") or []
                        ),
                    }
                )
                semantic_truth["debug"] = debug_payload

        if (
            resolved_intent == "time_spent"
            and time_truth is None
            and cursor is not None
            and _table_exists(cursor, "activity_events")
        ):
            time_truth = _load_time_truth(
                cursor=cursor,
                start_ms=start_ms,
                end_ms=end_ms,
                group_by=safe_group_by,
                limit=safe_limit,
                start_date=start_day.isoformat(),
                end_date=end_day.isoformat(),
            )

        cloud_mode = memory_cloud_enabled()
        if cloud_mode and should_include_semantic:
            mode_used = str((semantic_truth or {}).get("mode_used") or "").strip().lower()
            if mode_used.startswith("cloud-lexical"):
                retrieval_tier = "cloud_lexical_only"
            elif citations:
                retrieval_tier = "cloud_hybrid"
            elif time_truth is not None and resolved_intent in {"time_spent", "broad_overview"}:
                retrieval_tier = "activity_only"
            else:
                retrieval_tier = "unavailable"
        else:
            retrieval_tier = _determine_retrieval_tier(
                intent=resolved_intent,
                freshness=freshness,
                semantic_readiness=semantic_readiness,
                semantic_truth=semantic_truth,
                time_truth=time_truth,
            )

        if citations and retrieval_tier == "cloud_hybrid":
            answer_mode = "full_hybrid"
        elif citations and retrieval_tier not in {"unavailable", "activity_only"}:
            answer_mode = "full_hybrid"

        retrieval_debug = (semantic_truth or {}).get("debug") if isinstance(semantic_truth, dict) else None
        recap_debug = None
        if resolved_intent == "broad_overview" and isinstance(retrieval_debug, dict):
            recap_debug = {
                "final_evidence_count": int(retrieval_debug.get("final_evidence_count") or 0),
                "distinct_sessions": int(retrieval_debug.get("distinct_sessions") or 0),
                "distinct_apps": int(retrieval_debug.get("distinct_apps") or 0),
                "distinct_domains": int(retrieval_debug.get("distinct_domains") or 0),
                "distinct_time_buckets": int(retrieval_debug.get("distinct_time_buckets") or 0),
                "context_version_mix": retrieval_debug.get("context_version_mix") or {},
                "raw_vs_contextual_source": retrieval_debug.get("raw_vs_contextual_source"),
                "rerank_input_count": int(retrieval_debug.get("rerank_input_count") or 0),
                "rerank_items_count": int(retrieval_debug.get("rerank_items_count") or 0),
                "rerank_provider": retrieval_debug.get("rerank_provider"),
                "rerank_attempted": bool(retrieval_debug.get("rerank_attempted")),
                "rerank_fallback_reason": retrieval_debug.get("rerank_fallback_reason"),
                "rerank_latency_ms": int(retrieval_debug.get("rerank_latency_ms") or 0),
                "candidate_count_raw": int(retrieval_debug.get("candidate_count_raw") or 0),
                "candidate_count_active": int(retrieval_debug.get("candidate_count_active") or 0),
                "vector_rank_mode": retrieval_debug.get("vector_rank_mode"),
                "lexical_rank_strategy": retrieval_debug.get("lexical_rank_strategy"),
                "main_event_work_item_id": retrieval_debug.get("main_event_work_item_id"),
                "work_items_considered": int(retrieval_debug.get("work_items_considered") or 0),
                "cross_app_stitches": int(retrieval_debug.get("cross_app_stitches") or 0),
                "claim_count": int(retrieval_debug.get("claim_count") or 0),
                "claim_grounding_rate": float(retrieval_debug.get("claim_grounding_rate") or 0.0),
                "generic_fallback_used": bool(retrieval_debug.get("generic_fallback_used")),
                "planning_only_ratio": float(retrieval_debug.get("planning_only_ratio") or 0.0),
                "semantic_work_items_stored": int(
                    retrieval_debug.get("semantic_work_items_stored") or 0
                ),
                "semantic_work_item_evidence_rows": int(
                    retrieval_debug.get("semantic_work_item_evidence_rows") or 0
                ),
                "semantic_work_items_loaded": int(
                    retrieval_debug.get("semantic_work_items_loaded") or 0
                ),
            }

        return {
            "success": True,
            "query": normalized_query,
            "intent_resolved": resolved_intent,
            "answer_mode": answer_mode,
            "retrieval_tier": retrieval_tier,
            "days_back": resolved_days,
            "start_date": start_day.isoformat(),
            "end_date": end_day.isoformat(),
            "group_by": safe_group_by,
            "time_truth": time_truth,
            "semantic_truth": semantic_truth,
            "citations": citations,
            "freshness": freshness,
            "confidence": confidence,
            "provider_path": provider_path,
            "retrieval_debug": retrieval_debug,
            "recap_debug": recap_debug,
            "warning": " ".join(part for part in warning_parts if part).strip() or None,
            "error": None,
            "source_db": source_db_label or os.path.basename(activity_db_path),
        }
    except Exception as exc:
        logger.error("❌ query_memory_impl error: %s", exc)
        return {
            "success": False,
            "query": normalized_query,
            "intent_resolved": resolved_intent,
            "answer_mode": "unavailable",
            "retrieval_tier": "unavailable",
            "days_back": resolved_days,
            "start_date": start_day.isoformat(),
            "end_date": end_day.isoformat(),
            "group_by": safe_group_by,
            "time_truth": None,
            "semantic_truth": None,
            "citations": [],
            "freshness": {"status": "unavailable"},
            "confidence": {"level": "low", "score": 0.0, "corroborating_chunks": 0},
            "provider_path": None,
            "warning": None,
            "error": str(exc),
            "source_db": source_db_label or os.path.basename(activity_db_path),
        }
    finally:
        if conn is not None:
            conn.close()
