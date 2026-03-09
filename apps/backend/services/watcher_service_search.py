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
from typing import Any, Dict, List, Optional, Tuple

from services.watcher_service_local_db import (
    get_local_activity_db_path_impl,
    get_local_memory_db_path_impl,
)
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
from services.memory_embedding_service import (
    get_memory_index_health,
    process_embedding_jobs_with_guard,
)
from services.memory_backfill_service import backfill_cloud_from_local_chunks

logger = logging.getLogger(__name__)


OVERVIEW_TIME_HINTS = (
    "today",
    "yesterday",
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
    result = await backfill_cloud_from_local_chunks(
        user_id=user_id,
        device_id_override=None,
        limit=1500,
        batch_size=150,
        start_ms=start_ms,
        end_ms=end_ms,
    )
    if not result.get("success", False):
        return "Cloud memory backfill attempt failed; semantic quality may be limited until ingestion succeeds."
    accepted = int(result.get("accepted") or 0)
    deduped = int(result.get("deduped") or 0)
    if accepted <= 0:
        return None
    if deduped > 0:
        return f"Cloud memory index is catching up ({accepted} new chunks, {deduped} already indexed)."
    return f"Cloud memory index is catching up ({accepted} new chunks indexed)."


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

    specific_tokens = [token for token in tokens if token not in GENERIC_OVERVIEW_TOKENS]

    if has_overview_phrase:
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
        cursor.execute("ATTACH DATABASE ? AS activity_db", (activity_db_path,))
        cursor.execute("DROP VIEW IF EXISTS temp.activity_events")
        cursor.execute("CREATE TEMP VIEW activity_events AS SELECT * FROM activity_db.activity_events")
    except Exception as exc:
        logger.warning(
            "Failed to attach activity.db (%s) to memory DB query connection: %s",
            activity_db_path,
            exc,
        )


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

    memory_db_path = get_local_memory_db_path_impl()
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
    query: Optional[str] = None,
) -> Tuple[dt_date, dt_date, int]:
    safe_days_back = max(1, min(int(days_back or 7), 90))
    today = datetime.now().date()

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
    has_frames = _table_exists(cursor, "ocr_frames")
    has_chunks = _table_exists(cursor, "search_chunks")
    has_chunk_embeddings = _table_exists(cursor, "chunk_embeddings")
    has_ocr_embeddings = _table_exists(cursor, "ocr_embeddings")
    has_pipeline = _table_exists(cursor, "pipeline_watermarks")
    has_video_chunks = _table_exists(cursor, "video_chunks")

    last_activity_ts = (
        _max_value(cursor, "SELECT MAX(ts_end) FROM activity_events")
        if has_activity
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

    last_chunk_built_ts = (
        _max_value(cursor, "SELECT MAX(chunk_end_ts) FROM search_chunks")
        if has_chunks
        else None
    )

    last_chunk_embedded_ts: Optional[int] = None
    pending_chunks = 0
    oldest_pending_chunk_ts = None

    if has_chunks and has_chunk_embeddings:
        last_chunk_embedded_ts = _max_value(
            cursor,
            "SELECT MAX(updated_at) FROM chunk_embeddings WHERE status = 'ok'",
        )
        try:
            cursor.execute(
                """
                SELECT COUNT(*), MIN(s.chunk_start_ts)
                FROM search_chunks s
                LEFT JOIN chunk_embeddings e ON e.chunk_id = s.id
                WHERE e.chunk_id IS NULL OR COALESCE(e.status, 'pending') != 'ok'
                """
            )
            row = cursor.fetchone()
            if row:
                pending_chunks = int(row[0] or 0)
                oldest_pending_chunk_ts = int(row[1]) if row[1] is not None else None
        except Exception:
            pending_chunks = 0
    elif has_frames and has_ocr_embeddings:
        last_chunk_embedded_ts = _max_value(
            cursor,
            """
            SELECT MAX(f.timestamp)
            FROM ocr_embeddings e
            JOIN ocr_frames f ON f.id = e.frame_id
            WHERE COALESCE(e.status, 'ok') = 'ok'
            """,
        )
        try:
            cursor.execute(
                """
                SELECT COUNT(*), MIN(f.timestamp)
                FROM ocr_frames f
                LEFT JOIN ocr_embeddings e ON e.frame_id = f.id
                WHERE (e.id IS NULL OR COALESCE(e.status, 'pending') != 'ok')
                  AND (
                    COALESCE(NULLIF(TRIM(f.ocr_text), ''), '') != ''
                    OR COALESCE(NULLIF(TRIM(f.app_name), ''), '') != ''
                    OR COALESCE(NULLIF(TRIM(f.window_title), ''), '') != ''
                  )
                """
            )
            row = cursor.fetchone()
            if row:
                pending_chunks = int(row[0] or 0)
                oldest_pending_chunk_ts = int(row[1]) if row[1] is not None else None
        except Exception:
            pending_chunks = 0

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

    if not source_mismatch:
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
        [ts for ts in [last_ocr_frame_ts, last_chunk_built_ts] if ts is not None],
        default=None,
    )
    time_anchor_ts = max(
        [ts for ts in [last_activity_ts, last_ocr_frame_ts] if ts is not None],
        default=None,
    )
    overall_anchor_ts = max(
        [ts for ts in [last_capture_ts, last_activity_ts, last_ocr_frame_ts, last_chunk_built_ts] if ts is not None],
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
    if last_capture_ts is None and last_activity_ts is None and last_ocr_frame_ts is None:
        status = "unavailable"
        reasons.append("no_recent_capture_data")
    elif source_mismatch:
        status = "degraded_semantic"
        reasons.append("source_mismatch")
    elif semantic_intent and ocr_lag is not None and ocr_lag > 3600 and (chunk_lag is None or chunk_lag > 3600):
        status = "degraded_ocr"
        reasons.append("ocr_and_chunk_lag_gt_1h")
    elif semantic_intent and ocr_lag is not None and ocr_lag > 600 and (chunk_lag is None or chunk_lag > 600):
        status = "degraded_ocr"
        reasons.append("ocr_and_chunk_lag_gt_10m")
    elif semantic_intent and (
        (embedding_lag is not None and embedding_lag > 900)
        or pending_chunks > 2000
        or (semantic_anchor_lag is not None and semantic_anchor_lag > 300)
    ):
        status = "degraded_semantic"
        if embedding_lag is not None and embedding_lag > 900:
            reasons.append("embedding_lag_gt_15m")
        if pending_chunks > 2000:
            reasons.append("pending_chunks_gt_2000")
        if semantic_anchor_lag is not None and semantic_anchor_lag > 300:
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
    has_chunks = _table_exists(cursor, "search_chunks")
    has_chunk_embeddings = _table_exists(cursor, "chunk_embeddings")
    if not has_chunks or not has_chunk_embeddings:
        return {
            "ready": False,
            "coverage": 0.0,
            "total_chunks": 0,
            "embedded_chunks": 0,
            "recent_unembedded": 0,
            "reason": "semantic_chunk_tables_unavailable",
            "tier": "lexical_fts",
        }

    total_chunks = 0
    embedded_chunks = 0
    recent_unembedded = 0
    try:
        cursor.execute("SELECT COUNT(*) FROM search_chunks")
        row_total = cursor.fetchone()
        total_chunks = int(row_total[0] or 0) if row_total else 0

        cursor.execute("SELECT COUNT(*) FROM chunk_embeddings WHERE COALESCE(status, 'pending') = 'ok'")
        row_embedded = cursor.fetchone()
        embedded_chunks = int(row_embedded[0] or 0) if row_embedded else 0

        recent_cutoff = now_ms - (60 * 60 * 1000)
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM search_chunks s
            LEFT JOIN chunk_embeddings e ON e.chunk_id = s.id
            WHERE s.chunk_end_ts >= ?
              AND (e.chunk_id IS NULL OR COALESCE(e.status, 'pending') != 'ok')
            """,
            (recent_cutoff,),
        )
        row_recent = cursor.fetchone()
        recent_unembedded = int(row_recent[0] or 0) if row_recent else 0
    except Exception:
        return {
            "ready": False,
            "coverage": 0.0,
            "total_chunks": total_chunks,
            "embedded_chunks": embedded_chunks,
            "recent_unembedded": recent_unembedded,
            "reason": "semantic_readiness_query_failed",
            "tier": "lexical_fts",
        }

    coverage = float(embedded_chunks) / float(total_chunks) if total_chunks > 0 else 1.0
    ready = coverage >= 0.90 and recent_unembedded < 5
    # Avoid reporting semantic_frame when only a tiny fraction of chunks are embedded.
    min_semantic_frame_coverage = 0.05
    min_semantic_frame_chunks = 25
    has_semantic_frame_coverage = (
        embedded_chunks >= min_semantic_frame_chunks
        and coverage >= min_semantic_frame_coverage
    )
    if ready:
        tier = "semantic_full"
        reason = "semantic_ready"
    elif has_semantic_frame_coverage:
        tier = "semantic_frame"
        reason = "semantic_index_building"
    else:
        tier = "lexical_fts"
        reason = "semantic_embeddings_unavailable"

    return {
        "ready": bool(ready),
        "coverage": round(coverage, 4),
        "total_chunks": total_chunks,
        "embedded_chunks": embedded_chunks,
        "recent_unembedded": recent_unembedded,
        "reason": reason,
        "tier": tier,
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
        snippet = ocr_text.strip()
        if len(snippet) > 240:
            snippet = f"{snippet[:240].rstrip()}..."

        chunk_id = int(timestamp // 90_000) if timestamp > 0 else None
        citations.append(
            {
                "chunk_id": chunk_id,
                "frame_id": frame_id if frame_id > 0 else None,
                "timestamp": timestamp,
                "app_name": app_name,
                "window_title": window_title,
                "snippet": snippet,
                "score": round(max(0.0, min(1.0, score)), 3),
                "source": item.get("source") or "unknown",
            }
        )
        if len(citations) >= limit:
            break
    return citations


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
    workstreams: Dict[str, Dict[str, Any]] = {}
    app_counts: Dict[str, Dict[str, Any]] = {}
    time_buckets: Dict[str, int] = {}

    for item in citations:
        app = str(item.get("app_name") or "Unknown").strip() or "Unknown"
        window = str(item.get("window_title") or "Unknown").strip() or "Unknown"
        snippet = _clip_recap_text(str(item.get("snippet") or ""))
        session_key = item.get("session_key") or f"{app}::{window}"
        label = _infer_recap_workstream(app, window, [snippet])

        workstream = workstreams.setdefault(
            label,
            {
                "label": label,
                "evidence_count": 0,
                "apps": set(),
                "windows": {},
                "supporting_snippets": [],
                "session_keys": set(),
                "topic_counts": {},
            },
        )
        workstream["evidence_count"] += 1
        workstream["apps"].add(app)
        workstream["windows"][window] = int(workstream["windows"].get(window, 0)) + 1
        workstream["session_keys"].add(session_key)
        if snippet and len(workstream["supporting_snippets"]) < 3:
            workstream["supporting_snippets"].append(snippet)
        for token in _tokenize_recap_text(f"{window} {snippet}"):
            workstream["topic_counts"][token] = int(workstream["topic_counts"].get(token, 0)) + 1

        app_entry = app_counts.setdefault(app, {"app": app, "evidence_count": 0, "top_windows": {}})
        app_entry["evidence_count"] += 1
        app_entry["top_windows"][window] = int(app_entry["top_windows"].get(window, 0)) + 1

        try:
            timestamp = int(item.get("timestamp") or 0)
        except Exception:
            timestamp = 0
        if timestamp > 0:
            bucket_dt = datetime.fromtimestamp(timestamp / 1000)
            bucket_key = f"{bucket_dt:%Y-%m-%d} {((bucket_dt.hour // 2) * 2):02d}:00"
            time_buckets[bucket_key] = time_buckets.get(bucket_key, 0) + 1

    strongest_evidence = []
    for item in sorted(highlights, key=lambda row: float(row.get("score") or 0.0), reverse=True)[:8]:
        app = str(item.get("app_name") or "Unknown").strip() or "Unknown"
        window = str(item.get("window_title") or "Unknown").strip() or "Unknown"
        snippet = _clip_recap_text(str(item.get("snippet") or ""))
        strongest_evidence.append(
            {
                "timestamp": item.get("timestamp"),
                "app": app,
                "window": window,
                "session_key": item.get("session_key"),
                "snippet": snippet,
                "score": item.get("score"),
                "reason": _infer_recap_workstream(app, window, [snippet]),
            }
        )

    uncertainty: List[str] = []
    if len(workstreams) <= 1:
        uncertainty.append("Evidence clusters into one dominant workstream, so secondary tasks may be underrepresented.")
    if len(time_buckets) < 4:
        uncertainty.append("Coverage spans relatively few time buckets, so parts of the day may be missing.")
    if len([item for item in citations if len(str(item.get('snippet') or '').strip()) >= 40]) < 5:
        uncertainty.append("Several chunks have short OCR snippets, so exact task names may still be incomplete.")
    if any(app.lower() in {"things 3", "calendar", "notion"} for app in app_counts):
        uncertainty.append("Planning tools are prominent in the evidence, so some items may reflect planning rather than completed execution.")

    main_workstreams = []
    for workstream in sorted(workstreams.values(), key=lambda row: int(row["evidence_count"]), reverse=True)[:6]:
        topic_counts = workstream.pop("topic_counts")
        main_workstreams.append(
            {
                "label": workstream["label"],
                "evidence_count": workstream["evidence_count"],
                "apps": sorted(workstream["apps"]),
                "representative_windows": [
                    window
                    for window, _count in sorted(
                        workstream["windows"].items(), key=lambda row: (-int(row[1]), row[0])
                    )[:3]
                ],
                "supporting_snippets": workstream["supporting_snippets"],
                "session_keys": list(workstream["session_keys"])[:4],
                "topic_tokens": [
                    token
                    for token, _count in sorted(
                        topic_counts.items(), key=lambda row: (-int(row[1]), row[0])
                    )[:6]
                ],
                "specific_tasks": _extract_specific_task_phrases(
                    workstream["supporting_snippets"] + list(workstream["windows"].keys()), 5
                ),
            }
        )

    apps_and_tools_used = [
        {
            "app": app_entry["app"],
            "evidence_count": app_entry["evidence_count"],
            "top_windows": [
                {"window": window, "count": count}
                for window, count in sorted(
                    app_entry["top_windows"].items(), key=lambda row: (-int(row[1]), row[0])
                )[:3]
            ],
        }
        for app_entry in sorted(app_counts.values(), key=lambda row: int(row["evidence_count"]), reverse=True)[:6]
    ]

    specific_tasks = _extract_specific_task_phrases(
        [
            str(item.get("snippet") or "")
            for item in citations
        ]
        + [
            str(item.get("window_title") or "")
            for item in citations
        ],
        12,
    )

    return {
        "main_workstreams": main_workstreams,
        "apps_and_tools_used": apps_and_tools_used,
        "specific_tasks": specific_tasks,
        "strongest_evidence": strongest_evidence,
        "uncertainty_or_conflicts": uncertainty,
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
        snippet = str(item.get("snippet") or item.get("ocr_text") or "").strip()
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
) -> Dict[str, Any]:
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

    recap_outline = None
    if intent == "broad_overview":
        recap_outline = _build_recap_outline(filtered_citations, highlights)

    return {
        "query": query,
        "result_count": len(filtered_citations),
        "mode_used": semantic_result.get("mode_used") if isinstance(semantic_result, dict) else "none",
        "status": semantic_result.get("status") if isinstance(semantic_result, dict) else "unavailable",
        "highlights": highlights,
        "warning": " ".join(part for part in warning_parts if part).strip() or None,
        "topic_specificity": topic_metrics,
        "recap_outline": recap_outline,
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
    group_by: str = "app",
    limit: int = 20,
) -> Dict[str, Any]:
    normalized_query = (query or "").strip()
    if not normalized_query:
        return {
            "success": False,
            "intent_resolved": "semantic_lookup",
            "answer_mode": "unavailable",
            "retrieval_tier": "unavailable",
            "time_truth": None,
            "semantic_truth": None,
            "citations": [],
            "freshness": {"status": "unavailable"},
            "confidence": {"level": "low", "score": 0.0, "corroborating_chunks": 0},
            "provider_path": None,
            "warning": None,
            "error": "query is required",
        }

    safe_limit = max(1, min(int(limit or 20), 100))
    safe_group_by = group_by if group_by in {"app", "domain", "window"} else "app"
    start_day, end_day, resolved_days = _resolve_query_window(
        days_back,
        start_date,
        end_date,
        query=normalized_query,
    )
    start_ms = int(datetime.combine(start_day, dt_time.min).timestamp() * 1000)
    end_ms = int(datetime.combine(end_day, dt_time.max).timestamp() * 1000)
    resolved_intent = _detect_memory_intent(normalized_query, intent)

    memory_db_path = get_local_memory_db_path_impl()
    activity_db_path = get_local_activity_db_path_impl()
    if not os.path.exists(memory_db_path):
        return {
            "success": False,
            "intent_resolved": resolved_intent,
            "answer_mode": "unavailable",
            "retrieval_tier": "unavailable",
            "time_truth": None,
            "semantic_truth": None,
            "citations": [],
            "freshness": {"status": "unavailable"},
            "confidence": {"level": "low", "score": 0.0, "corroborating_chunks": 0},
            "provider_path": None,
            "warning": None,
            "error": f"local memory database not found at {memory_db_path}",
        }

    conn = None
    try:
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

        should_include_time = resolved_intent in {"time_spent", "broad_overview"}
        should_include_semantic = resolved_intent in {"semantic_lookup", "evidence_timeline", "broad_overview"}
        cloud_mode = memory_cloud_enabled()

        now_ms = int(time.time() * 1000)
        freshness = _compute_freshness(
            cursor,
            db_path=memory_db_path,
            now_ms=now_ms,
            intent=resolved_intent,
            query_end_ms=end_ms,
        )
        semantic_readiness: Optional[Dict[str, Any]] = None
        if should_include_semantic and not cloud_mode:
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
            warning_parts.append("No recent capture data is available.")
        if freshness.get("source_mismatch"):
            warning_parts.append(
                str(freshness.get("source_mismatch_note") or "Data source mismatch detected between canonical and legacy local DBs.")
            )
        if should_include_semantic and (not cloud_mode) and semantic_readiness and not semantic_readiness.get("ready", False):
            warning_parts.append(
                "Semantic index is still building; results may use lexical matching until chunk embeddings catch up."
            )

        time_truth: Optional[Dict[str, Any]] = None
        semantic_truth: Optional[Dict[str, Any]] = None
        citations: List[Dict[str, Any]] = []
        provider_path: Optional[Dict[str, Any]] = None
        confidence = {
            "level": "low",
            "score": 0.0,
            "corroborating_chunks": 0,
            "reason": "No semantic evidence evaluated.",
        }

        if should_include_time and _table_exists(cursor, "activity_events"):
            time_truth = _load_time_truth(
                cursor=cursor,
                start_ms=start_ms,
                end_ms=end_ms,
                group_by=safe_group_by,
                limit=safe_limit,
                start_date=start_day.isoformat(),
                end_date=end_day.isoformat(),
            )

        semantic_allowed = freshness.get("status") not in {"stale", "unavailable"}
        if should_include_semantic and semantic_allowed:
            if cloud_mode:
                try:
                    auto_backfill_warning = await _auto_backfill_cloud_if_needed(
                        user_id=user_id,
                        start_ms=start_ms,
                        end_ms=end_ms,
                    )
                    if auto_backfill_warning:
                        warning_parts.append(auto_backfill_warning)

                    cloud_result = await query_semantic_cloud(
                        user_id=user_id,
                        query=normalized_query,
                        intent=resolved_intent,
                        start_ms=start_ms,
                        end_ms=end_ms,
                        limit=safe_limit,
                    )
                    if cloud_result.get("enabled"):
                        semantic_truth = cloud_result.get("semantic_truth")
                        citations = cloud_result.get("citations") or []
                        confidence = cloud_result.get("confidence") or confidence
                        provider_path = cloud_result.get("provider_path")
                        if not isinstance(provider_path, dict):
                            provider_path = {}
                        provider_path["retrieval"] = "turbopuffer"
                        provider_path.setdefault("answer", "openai")
                        if citations:
                            warning_parts = [
                                part
                                for part in warning_parts
                                if part != "Semantic retrieval is degraded; using lexical-first fallback where needed."
                            ]
                        if semantic_truth and semantic_truth.get("warning"):
                            warning_parts.append(str(semantic_truth["warning"]))

                        # When cloud returns zero grounded citations but
                        # local OCR data exists, try the local hybrid bridge
                        # as a secondary source (unless fail-closed).
                        if not citations and not memory_fail_closed():
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
                                    semantic_truth["mode_used"] = "cloud-hybrid+local-bridge-fallback"
                                    semantic_truth["status"] = "hybrid"

                                    confidence = _derive_confidence(
                                        citations,
                                        topic_metrics=local_fallback.get("topic_specificity"),
                                        intent=resolved_intent,
                                    )
                                    if provider_path is None:
                                        provider_path = {}
                                    existing_retrieval = str(provider_path.get("retrieval") or "turbopuffer")
                                    provider_path["retrieval"] = f"{existing_retrieval}+local_bridge_fallback"
                                    warning_parts.append(
                                        "Cloud had no candidates; fused in local hybrid bridge evidence."
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
                    if memory_fail_closed():
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
                            "rerank": "cohere|openai",
                            "answer": "openai",
                        }
                        warning_parts.append(f"Cloud semantic retrieval error: {cloud_exc}")
                    else:
                        warning_parts.append(f"Cloud semantic retrieval error; falling back local path: {cloud_exc}")
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
        elif should_include_semantic:
            warning_parts.append(
                "Semantic lookup blocked by freshness guard; returning activity-only context."
            )

        if resolved_intent == "time_spent" and time_truth is None and _table_exists(cursor, "activity_events"):
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
                "distinct_time_buckets": int(retrieval_debug.get("distinct_time_buckets") or 0),
                "context_version_mix": retrieval_debug.get("context_version_mix") or {},
                "raw_vs_contextual_source": retrieval_debug.get("raw_vs_contextual_source"),
                "rerank_input_count": int(retrieval_debug.get("rerank_input_count") or 0),
                "rerank_items_count": int(retrieval_debug.get("rerank_items_count") or 0),
                "candidate_count_raw": int(retrieval_debug.get("candidate_count_raw") or 0),
                "candidate_count_active": int(retrieval_debug.get("candidate_count_active") or 0),
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
            "source_db": os.path.basename(memory_db_path),
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
            "source_db": os.path.basename(memory_db_path),
        }
    finally:
        if conn is not None:
            conn.close()
