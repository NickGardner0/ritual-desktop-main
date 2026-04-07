"""Durable project memory cards built from per-user activity context."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import sqlite3
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import select

from database.connection import get_db_session
from database.models import UserDB
from services.memory_story_service import (
    PERSONAL_ACTIVITY_CLASSES,
    RESEARCH_ACTIVITY_CLASSES,
    _build_renderer_payload,
    _claim_text_for_item,
    _compact,
    _dedupe,
    _estimate_duration_ms,
    _story_kind_title,
    build_query_semantic_profile,
    detect_story_renderer_kind,
    enrich_story_evidence,
)
from services.watcher_service_local_db import open_activity_connection_for_user

logger = logging.getLogger(__name__)

PROJECT_MEMORY_CARDS_ENABLED = (
    os.getenv("RITUAL_PROJECT_MEMORY_CARDS_ENABLED", "1").strip().lower()
    in {"1", "true", "yes", "on"}
)
SESSION_CARD_BATCH_SIZE = max(
    8,
    int((os.getenv("RITUAL_PROJECT_MEMORY_CARD_BATCH_SIZE") or "24").strip() or "24"),
)
THREAD_CARD_LOOKBACK_DAYS = max(
    7,
    int((os.getenv("RITUAL_PROJECT_MEMORY_THREAD_LOOKBACK_DAYS") or "90").strip() or "90"),
)
THREAD_CARD_SESSION_LIMIT = max(
    16,
    int((os.getenv("RITUAL_PROJECT_MEMORY_THREAD_SESSION_LIMIT") or "200").strip() or "200"),
)
PROJECT_MEMORY_USER_SCAN_LIMIT = max(
    1,
    int((os.getenv("RITUAL_PROJECT_MEMORY_USER_SCAN_LIMIT") or "16").strip() or "16"),
)
PROJECT_MEMORY_CARD_RECENT_DELAY_MS = max(
    60_000,
    int((os.getenv("RITUAL_PROJECT_MEMORY_CARD_RECENT_DELAY_MS") or "120000").strip() or "120000"),
)
PROJECT_MEMORY_CARD_SOURCE_VERSION = "v2"

PROJECT_MEMORY_CARD_SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS project_memory_cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        card_level TEXT NOT NULL,
        source_scope TEXT NOT NULL DEFAULT 'session_closure',
        status TEXT NOT NULL DEFAULT 'active',
        activity_class TEXT NOT NULL DEFAULT 'work',
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        primary_session_id INTEGER,
        primary_app TEXT,
        title TEXT NOT NULL,
        summary_hook TEXT NOT NULL DEFAULT '',
        narrative_text TEXT NOT NULL DEFAULT '',
        outcomes_json TEXT NOT NULL DEFAULT '[]',
        blockers_json TEXT NOT NULL DEFAULT '[]',
        project_nouns_json TEXT NOT NULL DEFAULT '[]',
        apps_json TEXT NOT NULL DEFAULT '[]',
        domains_json TEXT NOT NULL DEFAULT '[]',
        files_json TEXT NOT NULL DEFAULT '[]',
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        commands_json TEXT NOT NULL DEFAULT '[]',
        summary_hook_tokens TEXT NOT NULL DEFAULT '',
        canonical_identity_json TEXT NOT NULL DEFAULT '{}',
        freshness_score REAL NOT NULL DEFAULT 0.0,
        confidence REAL NOT NULL DEFAULT 0.0,
        source_hash TEXT NOT NULL,
        superseded_by_card_id INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        consolidated_at INTEGER
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS project_memory_card_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL,
        session_id INTEGER,
        evidence_id TEXT,
        evidence_kind TEXT NOT NULL DEFAULT 'session_doc',
        timestamp INTEGER NOT NULL,
        score REAL NOT NULL DEFAULT 0.0,
        snippet TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(card_id, evidence_id, timestamp)
    )
    """,
)

PROJECT_MEMORY_CARD_INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_project_memory_cards_user_level_time ON project_memory_cards(user_id, card_level, start_ts, end_ts)",
    "CREATE INDEX IF NOT EXISTS idx_project_memory_cards_user_updated ON project_memory_cards(user_id, updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_project_memory_cards_user_session ON project_memory_cards(user_id, primary_session_id)",
    "CREATE INDEX IF NOT EXISTS idx_project_memory_cards_user_status_activity ON project_memory_cards(user_id, status, activity_class)",
    "CREATE INDEX IF NOT EXISTS idx_project_memory_card_evidence_card_ts ON project_memory_card_evidence(card_id, timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_project_memory_card_evidence_session_ts ON project_memory_card_evidence(session_id, timestamp)",
)

GENERIC_PROJECT_NOUNS = {
    "app",
    "apps",
    "browser",
    "chat",
    "dashboard",
    "general",
    "implementation",
    "project",
    "projects",
    "research",
    "ritual",
    "session",
    "task",
    "tasks",
    "window",
    "work",
    "workstream",
}

NOISY_TITLE_MARKERS = {
    "unwatch",
    "fork",
    "star",
    "branches",
    "tags",
    "visible content",
    "google chrome /",
    "cursor /",
    "contents file-based routing",
    "inbox (",
    "update projects",
    "select date range",
    "all environments",
}

HIGH_SIGNAL_PRODUCT_DOMAINS = {
    "api.clerk.dev",
    "app.railway.com",
    "clerk.com",
    "cloud.tinybird.co",
    "cloud.typesense.org",
    "docs.anthropic.com",
    "docs.stripe.com",
    "github.com",
    "openai.com",
    "platform.openai.com",
    "railway.com",
    "support.littlebird.ai",
    "tinybird.co",
    "turbopuffer.com",
    "typesense.org",
    "vercel.com",
}

GENERIC_FILE_BASENAMES = {
    "readme",
    "security",
    "license",
    "package",
    "package-lock",
    "pnpm-lock",
    "tsconfig",
    "turbo",
    "bunfig",
    "biome",
    "next-env",
    "yarn.lock",
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _coerce_session_id(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        return int(text)
    except Exception:
        match = re.search(r"(\d+)$", text)
        if match:
            return _safe_int(match.group(1), 0)
    return 0


def _json_loads(value: Any, default: Any) -> Any:
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def _extract_structured_ui_text(raw: Any) -> str:
    parsed = _json_loads(raw, {})
    if not isinstance(parsed, dict):
        return ""
    parts: List[str] = []
    for key in ("headings", "semantic_blocks"):
        values = parsed.get(key) or []
        if isinstance(values, list):
            for item in values[:10]:
                if isinstance(item, dict):
                    text = str(item.get("text") or "").strip()
                else:
                    text = str(item or "").strip()
                if text:
                    parts.append(text)
    for key in ("selection_text", "focused_element_text"):
        text = str(parsed.get(key) or "").strip()
        if text:
            parts.append(text)
    ocr_elements = parsed.get("ocr_elements") or []
    if isinstance(ocr_elements, list):
        for item in ocr_elements[:14]:
            if isinstance(item, dict):
                text = str(item.get("text") or "").strip()
            else:
                text = str(item or "").strip()
            if text:
                parts.append(text)
    deduped: List[str] = []
    seen = set()
    for item in parts:
        lowered = item.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(item)
    return _clip_text(" ".join(deduped[:12]), 420)


def _normalized_key(value: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in str(value or "").strip()).strip("-")


def ensure_project_memory_card_schema(conn: sqlite3.Connection) -> None:
    for statement in PROJECT_MEMORY_CARD_SCHEMA_STATEMENTS:
        conn.execute(statement)
    for statement in PROJECT_MEMORY_CARD_INDEX_STATEMENTS:
        conn.execute(statement)
    conn.commit()


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type='table' AND name=?
        LIMIT 1
        """,
        (table_name,),
    ).fetchone()
    return row is not None


def _column_exists(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    try:
        rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    except Exception:
        return False
    return any(str(row[1] or "") == column_name for row in rows)


def _clip_text(value: Any, max_len: int = 240) -> str:
    return _compact(str(value or "").replace("\n", " ").strip(), max_len)


def _strip_code_suffix(value: str) -> str:
    text = str(value or "").strip()
    for suffix in (
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".py",
        ".md",
        ".json",
        ".toml",
        ".yaml",
        ".yml",
        ".zig",
        ".sql",
        ".sh",
    ):
        if text.lower().endswith(suffix):
            return text[: -len(suffix)]
    return text


def _humanize_identifier(value: str) -> str:
    text = _strip_code_suffix(os.path.basename(str(value or "").strip()))
    text = re.sub(r"[\[\]{}()]", " ", text)
    text = re.sub(r"[_./-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    words: List[str] = []
    for part in text.split():
        if part.upper() in {"API", "UI", "LLM", "RAG", "OCR", "SQL"}:
            words.append(part.upper())
        elif len(part) <= 3 and part.isupper():
            words.append(part)
        else:
            words.append(part.capitalize())
    return " ".join(words)


def _repo_label_from_enriched(enriched: Dict[str, Any]) -> str:
    canonical_identity = enriched.get("canonical_identity") or {}
    repo_root = str(canonical_identity.get("repo_root") or "").strip()
    if repo_root:
        return _humanize_identifier(repo_root)
    for value in enriched.get("artifact_refs") or []:
        match = re.search(r"\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\b", str(value or ""))
        if match:
            return _humanize_identifier(match.group(1).split("/")[-1])
    return ""


def _is_noisy_text_candidate(value: str) -> bool:
    text = _clip_text(value, 240)
    if not text:
        return True
    lowered = text.lower()
    if text == "Visible":
        return True
    if len(text) > 110:
        return True
    if sum(marker in lowered for marker in NOISY_TITLE_MARKERS) >= 1:
        return True
    if lowered.count(" / ") >= 3:
        return True
    if sum(ch.isdigit() for ch in text) >= 10:
        return True
    return False


def _is_meaningful_task_phrase(value: str) -> bool:
    text = _clip_text(value, 180)
    if not text:
        return False
    lowered = text.lower()
    if _is_noisy_text_candidate(text):
        return False
    if any(marker in lowered for marker in ("google chrome /", "cursor /", "visible content")):
        return False
    return True


def _best_file_artifact(enriched: Dict[str, Any]) -> str:
    files = [str(value or "").strip() for value in (enriched.get("file_artifacts") or []) if str(value or "").strip()]
    if not files:
        return ""
    ranked = sorted(
        _dedupe(files, limit=24),
        key=lambda value: (
            0 if _strip_code_suffix(os.path.basename(value)).lower() in GENERIC_FILE_BASENAMES else 1,
            len(value.split("/")),
            len(value),
        ),
        reverse=True,
    )
    return ranked[0] if ranked else ""


def _preferred_title_from_files(enriched: Dict[str, Any]) -> str:
    best_file = _best_file_artifact(enriched)
    if not best_file:
        return ""
    base = _strip_code_suffix(os.path.basename(best_file)).lower()
    repo_label = _repo_label_from_enriched(enriched)
    if base in GENERIC_FILE_BASENAMES and repo_label:
        parent = os.path.basename(os.path.dirname(best_file))
        parent_label = _humanize_identifier(parent)
        if parent_label:
            return f"{repo_label} {parent_label}".strip()
        return f"{repo_label} repository work"
    label = _humanize_identifier(best_file)
    if label:
        return label
    return ""


def _session_card_key(user_id: str, session_id: int) -> str:
    return f"session:{user_id}:{session_id}"


def _token_text(values: Iterable[str]) -> str:
    tokens: List[str] = []
    for value in values:
        if not value:
            continue
        tokens.extend(build_query_semantic_profile(str(value)).get("tokens") or [])
    return " ".join(_dedupe(tokens, limit=48))


def _status_from_enriched(enriched: Dict[str, Any]) -> str:
    action_refs = {str(value or "").strip().lower() for value in (enriched.get("action_refs") or [])}
    error_refs = enriched.get("error_refs") or []
    story_kind = str(enriched.get("semantic_kind") or "general").strip().lower()
    if action_refs & {"ship", "deploy", "submit"}:
        return "shipped"
    if error_refs:
        return "blocked"
    if story_kind == "planning":
        return "planning"
    if story_kind == "research":
        return "research"
    return "active"


def _activity_class_from_enriched(enriched: Dict[str, Any]) -> str:
    activity_class = str(enriched.get("activity_class") or "work").strip().lower()
    if activity_class in {"personal", "entertainment"}:
        return "personal"
    if activity_class in {"research", "design_inspiration"}:
        return "research"
    if activity_class in {"communication", "admin"}:
        return activity_class
    return "work"


def _rank_specific_values(values: Iterable[str], limit: int) -> List[str]:
    cleaned = [
        _clip_text(value, 180)
        for value in values
        if _clip_text(value, 180)
    ]
    ranked = sorted(
        _dedupe(cleaned, limit=max(limit * 3, 16)),
        key=lambda value: (
            len(build_query_semantic_profile(value).get("artifact_refs") or []),
            len(build_query_semantic_profile(value).get("entity_refs") or []),
            len(value),
        ),
        reverse=True,
    )
    return ranked[:limit]


def _best_title_from_enriched(enriched: Dict[str, Any]) -> str:
    file_title = _preferred_title_from_files(enriched)
    if file_title:
        return file_title

    candidates: List[str] = []
    for value in (
        enriched.get("task_phrases") or [],
        enriched.get("project_refs") or [],
        enriched.get("document_refs") or [],
        enriched.get("title_candidates") or [],
        enriched.get("file_artifacts") or [],
        enriched.get("artifact_refs") or [],
    ):
        candidates.extend([_clip_text(item, 120) for item in value if _clip_text(item, 120)])

    def _score(candidate: str) -> Tuple[int, int]:
        profile = build_query_semantic_profile(candidate)
        entity_refs = profile.get("entity_refs") or []
        artifact_refs = profile.get("artifact_refs") or []
        generic_penalty = 1 if _normalized_key(candidate) in GENERIC_PROJECT_NOUNS else 0
        return (
            len(entity_refs) + len(artifact_refs) - generic_penalty,
            len(candidate),
        )

    filtered = [
        candidate
        for candidate in _dedupe(candidates, limit=16)
        if _normalized_key(candidate) not in GENERIC_PROJECT_NOUNS and not _is_noisy_text_candidate(candidate)
    ]
    if filtered:
        filtered.sort(key=_score, reverse=True)
        return filtered[0]

    domain = str(enriched.get("browser_domain") or "").strip()
    app_name = str(enriched.get("app_name") or enriched.get("primary_app") or "Work").strip()
    repo_label = _repo_label_from_enriched(enriched)
    if repo_label:
        return repo_label
    if domain:
        return f"{app_name} / {domain}"
    return app_name or "Workstream"


def _build_outcomes(enriched: Dict[str, Any], limit: int = 3) -> List[str]:
    outcomes: List[str] = []
    for task in enriched.get("task_phrases") or []:
        task_text = _clip_text(task, 180)
        if _is_meaningful_task_phrase(task_text):
            outcomes.append(task_text)
    for file_path in enriched.get("file_artifacts") or []:
        clipped = _clip_text(file_path, 120)
        if clipped:
            outcomes.append(f"Updated {clipped}")
    for command in enriched.get("command_artifacts") or []:
        clipped = _clip_text(command, 120)
        if clipped:
            outcomes.append(f"Ran {clipped}")
    for artifact in enriched.get("artifact_refs") or []:
        clipped = _clip_text(artifact, 140)
        if clipped and not _is_noisy_text_candidate(clipped):
            outcomes.append(f"Worked directly on {clipped}")
    return _rank_specific_values(outcomes, limit)


def _build_blockers(enriched: Dict[str, Any], limit: int = 3) -> List[str]:
    blockers: List[str] = []
    for err in enriched.get("error_artifacts") or []:
        clipped = _clip_text(err, 180)
        if clipped:
            blockers.append(clipped)
    for err in enriched.get("error_refs") or []:
        clipped = _clip_text(err, 180)
        if clipped:
            blockers.append(clipped)
    return _rank_specific_values(blockers, limit)


def _build_summary_hook(
    title: str,
    outcomes: Sequence[str],
    blockers: Sequence[str],
    enriched: Dict[str, Any],
) -> str:
    app_name = str(enriched.get("app_name") or enriched.get("primary_app") or "").strip()
    if outcomes:
        if app_name:
            return _clip_text(f"{title} in {app_name}: {outcomes[0]}", 180)
        return _clip_text(f"{title}: {outcomes[0]}", 180)
    if blockers:
        return _clip_text(f"{title}: blocked by {blockers[0]}", 180)
    domain = str(enriched.get("browser_domain") or "").strip()
    if app_name and domain:
        return _clip_text(f"{title} across {app_name} and {domain}", 180)
    if app_name:
        return _clip_text(f"{title} in {app_name}", 180)
    return _clip_text(title, 180)


def _build_narrative_text(
    title: str,
    summary_hook: str,
    outcomes: Sequence[str],
    blockers: Sequence[str],
    enriched: Dict[str, Any],
    *,
    start_ts: int,
    end_ts: int,
) -> str:
    start = datetime.fromtimestamp(start_ts / 1000, tz=timezone.utc).strftime("%-I:%M %p") if start_ts else ""
    end = datetime.fromtimestamp(end_ts / 1000, tz=timezone.utc).strftime("%-I:%M %p") if end_ts else ""
    time_range = f"{start} - {end}" if start and end and start != end else start or end
    apps = _dedupe([str(value) for value in (enriched.get("apps") or [enriched.get("app_name")]) if str(value).strip()], limit=4)
    domains = _dedupe([str(value) for value in (enriched.get("browser_domains") or [enriched.get("browser_domain")]) if str(value).strip()], limit=4)
    files = _dedupe([str(value) for value in (enriched.get("file_artifacts") or []) if str(value).strip()], limit=4)
    parts = []
    if time_range:
        parts.append(f"From {time_range},")
    else:
        parts.append("In this workstream,")
    parts.append(summary_hook.rstrip(".") + ".")
    details: List[str] = []
    if outcomes:
        details.append(f"Concrete outcomes included {', '.join(outcomes[:3])}.")
    if blockers:
        details.append(f"Open blockers included {', '.join(blockers[:2])}.")
    if files:
        details.append(f"Key files or artifacts: {', '.join(files[:3])}.")
    elif domains:
        details.append(f"Primary surfaces included {', '.join(domains[:3])}.")
    elif apps:
        details.append(f"Primary tools included {', '.join(apps[:3])}.")
    return _clip_text(" ".join(parts + details), 520)


def _session_source_pack(row: sqlite3.Row) -> Dict[str, Any]:
    contextual_text = str(row["contextual_retrieval_text"] or "").strip()
    raw_text = str(row["raw_visible_text"] or "").strip()
    semantic_summary = str(row["semantic_summary"] or "").strip()
    representative_text = str(row["representative_text"] or "").strip()
    snapshot_source_type = str(row["snapshot_source_type"] or "").strip()
    snapshot_visible_text = str(row["snapshot_visible_text"] or "").strip()
    snapshot_ui_elements_json = str(row["snapshot_ui_elements_json"] or "").strip()
    snapshot_capture_components_json = str(row["snapshot_capture_components_json"] or "").strip()
    structured_ui_text = _extract_structured_ui_text(snapshot_ui_elements_json)
    snippet = semantic_summary or structured_ui_text or representative_text or snapshot_visible_text[:240] or raw_text[:240]
    app_name = str(row["primary_app_name"] or row["app_name"] or "Unknown").strip()
    browser_domain = str(row["primary_domain"] or row["browser_domain"] or "").strip()
    window_title = str(row["dominant_title"] or row["window_title"] or "").strip()
    document_title = str(row["document_title"] or "").strip()
    document_path = str(row["document_path"] or "").strip()
    source_item = {
        "session_key": row["session_id"],
        "session_id": row["session_id"],
        "timestamp": row["chunk_end_ts"],
        "app_name": app_name,
        "primary_app": app_name,
        "window_title": window_title,
        "document_title": document_title,
        "document_path": document_path,
        "browser_domain": browser_domain,
        "contextual_retrieval_text": contextual_text or structured_ui_text or snapshot_visible_text,
        "semantic_summary": semantic_summary,
        "snippet": snippet,
        "capture_quality": max(
            _safe_float(row["capture_quality"]),
            _safe_float(row["coverage_score"]),
        ),
    }
    enriched = enrich_story_evidence(source_item)
    return {
        "session_id": _safe_int(row["session_id"]),
        "user_id": str(row["user_id"] or ""),
        "start_ts": _safe_int(row["chunk_start_ts"] or row["start_ts"]),
        "end_ts": _safe_int(row["chunk_end_ts"] or row["end_ts"]),
        "app_name": app_name,
        "browser_domain": browser_domain,
        "window_title": window_title,
        "document_title": document_title,
        "document_path": document_path,
        "contextual_retrieval_text": contextual_text,
        "raw_visible_text": raw_text,
        "semantic_summary": semantic_summary,
        "representative_text": representative_text,
        "snapshot_source_type": snapshot_source_type,
        "snapshot_visible_text": snapshot_visible_text,
        "snapshot_ui_elements_json": snapshot_ui_elements_json,
        "snapshot_capture_components_json": snapshot_capture_components_json,
        "structured_ui_text": structured_ui_text,
        "coverage_score": _safe_float(row["coverage_score"]),
        "capture_quality": _safe_float(row["capture_quality"]),
        "snapshot_count": _safe_int(row["snapshot_count"]),
        "source_item": source_item,
        "enriched": enriched,
    }


def _compute_source_hash(pack: Dict[str, Any]) -> str:
    enriched = pack.get("enriched") or {}
    payload = {
        "version": PROJECT_MEMORY_CARD_SOURCE_VERSION,
        "session_id": pack.get("session_id"),
        "start_ts": pack.get("start_ts"),
        "end_ts": pack.get("end_ts"),
        "app_name": pack.get("app_name"),
        "browser_domain": pack.get("browser_domain"),
        "window_title": pack.get("window_title"),
        "document_title": pack.get("document_title"),
        "document_path": pack.get("document_path"),
        "contextual_retrieval_text": _clip_text(pack.get("contextual_retrieval_text"), 2200),
        "semantic_summary": _clip_text(pack.get("semantic_summary"), 420),
        "snapshot_source_type": pack.get("snapshot_source_type"),
        "snapshot_visible_text": _clip_text(pack.get("snapshot_visible_text"), 800),
        "structured_ui_text": _clip_text(pack.get("structured_ui_text"), 800),
        "task_phrases": enriched.get("task_phrases") or [],
        "artifact_refs": enriched.get("artifact_refs") or [],
        "file_artifacts": enriched.get("file_artifacts") or [],
        "command_artifacts": enriched.get("command_artifacts") or [],
        "error_artifacts": enriched.get("error_artifacts") or [],
        "project_refs": enriched.get("project_refs") or [],
        "canonical_identity": enriched.get("canonical_identity") or {},
    }
    return hashlib.sha1(_json_dumps(payload).encode("utf-8")).hexdigest()


def _is_low_signal_session_pack(pack: Dict[str, Any]) -> bool:
    contextual_text = str(pack.get("contextual_retrieval_text") or "").strip()
    semantic_summary = str(pack.get("semantic_summary") or "").strip()
    enriched = pack.get("enriched") or {}
    files = enriched.get("file_artifacts") or []
    commands = enriched.get("command_artifacts") or []
    artifacts = enriched.get("artifact_refs") or []
    tasks = enriched.get("task_phrases") or []
    has_text = len(contextual_text) >= 60 or len(semantic_summary) >= 24
    has_structure = bool(files or commands or artifacts or tasks)
    return not has_text and not has_structure


def _generate_session_card(pack: Dict[str, Any]) -> Dict[str, Any]:
    enriched = pack.get("enriched") or {}
    title = _best_title_from_enriched(enriched)
    outcomes = _build_outcomes(enriched)
    blockers = _build_blockers(enriched)
    project_nouns = _rank_specific_values(
        [_humanize_identifier(value) for value in (enriched.get("file_artifacts") or []) if _humanize_identifier(value)]
        + list(enriched.get("project_refs") or [])
        + list(enriched.get("document_refs") or [])
        + list(enriched.get("title_candidates") or [])
        + list(enriched.get("file_artifacts") or []),
        8,
    )
    apps = _dedupe(
        [str(pack.get("app_name") or "").strip()] + list(enriched.get("apps") or []),
        limit=8,
    )
    domains = _dedupe(
        [str(pack.get("browser_domain") or "").strip()] + list(enriched.get("browser_domains") or []),
        limit=8,
    )
    files = _dedupe(list(enriched.get("file_artifacts") or []), limit=12)
    artifacts = _dedupe(list(enriched.get("artifact_refs") or []), limit=12)
    commands = _dedupe(list(enriched.get("command_artifacts") or []), limit=8)
    status = _status_from_enriched(enriched)
    activity_class = _activity_class_from_enriched(enriched)
    summary_hook = _build_summary_hook(title, outcomes, blockers, enriched)
    narrative_text = _build_narrative_text(
        title,
        summary_hook,
        outcomes,
        blockers,
        enriched,
        start_ts=_safe_int(pack.get("start_ts")),
        end_ts=_safe_int(pack.get("end_ts")),
    )
    confidence = round(
        min(
            0.98,
            0.35
            + min(0.2, len(outcomes) * 0.08)
            + min(0.12, len(project_nouns) * 0.03)
            + min(0.12, len(files) * 0.04)
            + min(0.08, len(commands) * 0.04)
            + min(0.06, len(blockers) * 0.03)
            + min(0.1, _safe_float(enriched.get("confidence")) * 0.2),
        ),
        3,
    )
    freshness_score = round(
        max(0.0, 1.0 - ((_now_ms() - _safe_int(pack.get("end_ts"))) / float(14 * 24 * 60 * 60 * 1000))),
        3,
    )
    snapshot_source_type = str(pack.get("snapshot_source_type") or "").strip()
    structured_ui_text = _clip_text(pack.get("structured_ui_text"), 320)
    snapshot_visible_text = _clip_text(pack.get("snapshot_visible_text"), 320)
    hybrid_snippet = structured_ui_text or snapshot_visible_text
    evidence_rows = [
        {
            "session_id": _safe_int(pack.get("session_id")),
            "evidence_id": f"session-doc:{_safe_int(pack.get('session_id'))}",
            "evidence_kind": "session_doc",
            "timestamp": _safe_int(pack.get("end_ts")),
            "score": confidence,
            "snippet": _clip_text(
                pack.get("contextual_retrieval_text") or pack.get("semantic_summary") or pack.get("representative_text"),
                240,
            ),
        },
        {
            "session_id": _safe_int(pack.get("session_id")),
            "evidence_id": f"snapshot-best:{_safe_int(pack.get('session_id'))}",
            "evidence_kind": "vision_snapshot"
            if snapshot_source_type in {"hybrid_native", "vision_ui_fallback"}
            else "snapshot",
            "timestamp": _safe_int(pack.get("end_ts")),
            "score": max(0.1, confidence - 0.1),
            "snippet": hybrid_snippet or _clip_text(pack.get("semantic_summary") or pack.get("representative_text"), 220),
        },
    ]
    if hybrid_snippet and hybrid_snippet != evidence_rows[-1]["snippet"]:
        evidence_rows.append(
            {
                "session_id": _safe_int(pack.get("session_id")),
                "evidence_id": f"ui-elements:{_safe_int(pack.get('session_id'))}",
                "evidence_kind": "vision_snapshot"
                if snapshot_source_type in {"hybrid_native", "vision_ui_fallback"}
                else "snapshot",
                "timestamp": _safe_int(pack.get("end_ts")),
                "score": max(0.1, confidence - 0.05),
                "snippet": hybrid_snippet,
            }
        )
    return {
        "card_key": _session_card_key(str(pack.get("user_id") or ""), _safe_int(pack.get("session_id"))),
        "card_level": "session",
        "source_scope": "session_closure",
        "status": status,
        "activity_class": activity_class,
        "start_ts": _safe_int(pack.get("start_ts")),
        "end_ts": _safe_int(pack.get("end_ts")),
        "primary_session_id": _safe_int(pack.get("session_id")),
        "primary_app": str(pack.get("app_name") or "").strip() or None,
        "title": title,
        "summary_hook": summary_hook,
        "narrative_text": narrative_text,
        "outcomes": outcomes,
        "blockers": blockers,
        "project_nouns": project_nouns,
        "apps": [app for app in apps if app],
        "domains": [domain for domain in domains if domain],
        "files": files,
        "artifacts": artifacts,
        "commands": commands,
        "summary_hook_tokens": _token_text([title, summary_hook] + outcomes + blockers + project_nouns + files + artifacts),
        "canonical_identity": enriched.get("canonical_identity") or {},
        "freshness_score": freshness_score,
        "confidence": confidence,
        "source_hash": _compute_source_hash(pack),
        "evidence_rows": evidence_rows,
    }


def _upsert_project_memory_card(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    card: Dict[str, Any],
) -> Tuple[int, bool]:
    ensure_project_memory_card_schema(conn)
    now_ms = _now_ms()
    existing = conn.execute(
        """
        SELECT id, source_hash
        FROM project_memory_cards
        WHERE card_key = ?
        LIMIT 1
        """,
        (str(card.get("card_key") or ""),),
    ).fetchone()

    payload = (
        str(card.get("card_key") or ""),
        user_id,
        str(card.get("card_level") or "session"),
        str(card.get("source_scope") or "session_closure"),
        str(card.get("status") or "active"),
        str(card.get("activity_class") or "work"),
        _safe_int(card.get("start_ts")),
        _safe_int(card.get("end_ts")),
        _safe_int(card.get("primary_session_id")) or None,
        str(card.get("primary_app") or "") or None,
        str(card.get("title") or "Workstream"),
        str(card.get("summary_hook") or ""),
        str(card.get("narrative_text") or ""),
        _json_dumps(card.get("outcomes") or []),
        _json_dumps(card.get("blockers") or []),
        _json_dumps(card.get("project_nouns") or []),
        _json_dumps(card.get("apps") or []),
        _json_dumps(card.get("domains") or []),
        _json_dumps(card.get("files") or []),
        _json_dumps(card.get("artifacts") or []),
        _json_dumps(card.get("commands") or []),
        str(card.get("summary_hook_tokens") or ""),
        _json_dumps(card.get("canonical_identity") or {}),
        _safe_float(card.get("freshness_score")),
        _safe_float(card.get("confidence")),
        str(card.get("source_hash") or ""),
        now_ms,
        now_ms,
        _safe_int(card.get("consolidated_at")) or None,
    )

    if existing is None:
        conn.execute(
            """
            INSERT INTO project_memory_cards (
                card_key,
                user_id,
                card_level,
                source_scope,
                status,
                activity_class,
                start_ts,
                end_ts,
                primary_session_id,
                primary_app,
                title,
                summary_hook,
                narrative_text,
                outcomes_json,
                blockers_json,
                project_nouns_json,
                apps_json,
                domains_json,
                files_json,
                artifacts_json,
                commands_json,
                summary_hook_tokens,
                canonical_identity_json,
                freshness_score,
                confidence,
                source_hash,
                created_at,
                updated_at,
                consolidated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            payload,
        )
        card_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        inserted = True
    else:
        card_id = _safe_int(existing["id"])
        update_payload = (
            user_id,
            str(card.get("card_level") or "session"),
            str(card.get("source_scope") or "session_closure"),
            str(card.get("status") or "active"),
            str(card.get("activity_class") or "work"),
            _safe_int(card.get("start_ts")),
            _safe_int(card.get("end_ts")),
            _safe_int(card.get("primary_session_id")) or None,
            str(card.get("primary_app") or "") or None,
            str(card.get("title") or "Workstream"),
            str(card.get("summary_hook") or ""),
            str(card.get("narrative_text") or ""),
            _json_dumps(card.get("outcomes") or []),
            _json_dumps(card.get("blockers") or []),
            _json_dumps(card.get("project_nouns") or []),
            _json_dumps(card.get("apps") or []),
            _json_dumps(card.get("domains") or []),
            _json_dumps(card.get("files") or []),
            _json_dumps(card.get("artifacts") or []),
            _json_dumps(card.get("commands") or []),
            str(card.get("summary_hook_tokens") or ""),
            _json_dumps(card.get("canonical_identity") or {}),
            _safe_float(card.get("freshness_score")),
            _safe_float(card.get("confidence")),
            str(card.get("source_hash") or ""),
            now_ms,
            _safe_int(card.get("consolidated_at")) or None,
            card_id,
        )
        conn.execute(
            """
            UPDATE project_memory_cards
            SET user_id = ?,
                card_level = ?,
                source_scope = ?,
                status = ?,
                activity_class = ?,
                start_ts = ?,
                end_ts = ?,
                primary_session_id = ?,
                primary_app = ?,
                title = ?,
                summary_hook = ?,
                narrative_text = ?,
                outcomes_json = ?,
                blockers_json = ?,
                project_nouns_json = ?,
                apps_json = ?,
                domains_json = ?,
                files_json = ?,
                artifacts_json = ?,
                commands_json = ?,
                summary_hook_tokens = ?,
                canonical_identity_json = ?,
                freshness_score = ?,
                confidence = ?,
                source_hash = ?,
                updated_at = ?,
                consolidated_at = ?,
                superseded_by_card_id = NULL
            WHERE id = ?
            """,
            update_payload,
        )
        inserted = False

    conn.execute(
        "DELETE FROM project_memory_card_evidence WHERE card_id = ?",
        (card_id,),
    )
    evidence_rows = card.get("evidence_rows") or []
    for evidence in evidence_rows:
        conn.execute(
            """
            INSERT OR REPLACE INTO project_memory_card_evidence (
                card_id,
                session_id,
                evidence_id,
                evidence_kind,
                timestamp,
                score,
                snippet,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                card_id,
                _safe_int(evidence.get("session_id")) or None,
                str(evidence.get("evidence_id") or ""),
                str(evidence.get("evidence_kind") or "session_doc"),
                _safe_int(evidence.get("timestamp")),
                _safe_float(evidence.get("score")),
                _clip_text(evidence.get("snippet"), 320),
                now_ms,
                now_ms,
            ),
        )
    return card_id, inserted


def _fetch_pending_session_rows(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    limit: int,
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None,
) -> List[sqlite3.Row]:
    ensure_project_memory_card_schema(conn)
    snapshot_source_type_expr = "source_type" if _column_exists(conn, "context_snapshots", "source_type") else "'' AS source_type"
    snapshot_raw_visible_expr = "raw_visible_text" if _column_exists(conn, "context_snapshots", "raw_visible_text") else "'' AS raw_visible_text"
    snapshot_ui_expr = "ui_elements_json" if _column_exists(conn, "context_snapshots", "ui_elements_json") else "'' AS ui_elements_json"
    snapshot_components_expr = (
        "capture_components_json"
        if _column_exists(conn, "context_snapshots", "capture_components_json")
        else "'' AS capture_components_json"
    )
    snapshot_ui_rank_expr = (
        "COALESCE(TRIM(ui_elements_json), '') != ''"
        if _column_exists(conn, "context_snapshots", "ui_elements_json")
        else "0"
    )
    window_parts = ["s.user_id = ?", "sess.user_id = ?", "sess.end_ts <= ?"]
    params: List[Any] = [user_id, user_id, _now_ms() - PROJECT_MEMORY_CARD_RECENT_DELAY_MS]
    if start_ms is not None:
        window_parts.append("s.chunk_end_ts >= ?")
        params.append(int(start_ms))
    if end_ms is not None:
        window_parts.append("s.chunk_start_ts <= ?")
        params.append(int(end_ms))
    params.append(int(limit))
    rows = conn.execute(
        f"""
        SELECT
            s.session_id,
            s.user_id,
            s.chunk_start_ts,
            s.chunk_end_ts,
            s.app_name,
            s.browser_domain,
            s.window_title,
            s.document_title,
            s.raw_visible_text,
            s.contextual_retrieval_text,
            s.capture_quality,
            s.updated_at,
            sess.primary_app_name,
            sess.primary_domain,
            sess.dominant_title,
            sess.representative_text,
            sess.coverage_score,
            sess.snapshot_count,
            best.document_path,
            best.semantic_summary,
            best.source_type AS snapshot_source_type,
            best.raw_visible_text AS snapshot_visible_text,
            best.ui_elements_json AS snapshot_ui_elements_json,
            best.capture_components_json AS snapshot_capture_components_json,
            pmc.id AS existing_card_id,
            pmc.source_hash AS existing_source_hash,
            pmc.updated_at AS existing_card_updated_at
        FROM session_retrieval_docs s
        JOIN context_sessions sess
          ON sess.id = s.session_id
        LEFT JOIN (
            SELECT
                session_id,
                document_path,
                semantic_summary,
                {snapshot_source_type_expr},
                {snapshot_raw_visible_expr},
                {snapshot_ui_expr},
                {snapshot_components_expr},
                ROW_NUMBER() OVER (
                    PARTITION BY session_id
                    ORDER BY
                        CASE
                            WHEN COALESCE(TRIM(semantic_summary), '') != '' THEN 0
                            WHEN {snapshot_ui_rank_expr} THEN 1
                            WHEN COALESCE(TRIM(document_path), '') != '' THEN 1
                            ELSE 2
                        END,
                        ax_richness_score DESC,
                        ts DESC
                ) AS rn
            FROM context_snapshots
        ) best
          ON best.session_id = s.session_id AND best.rn = 1
        LEFT JOIN project_memory_cards pmc
          ON pmc.primary_session_id = s.session_id
         AND pmc.card_level = 'session'
         AND pmc.superseded_by_card_id IS NULL
        WHERE {" AND ".join(window_parts)}
        ORDER BY
            CASE WHEN pmc.id IS NULL THEN 0 ELSE 1 END ASC,
            COALESCE(pmc.updated_at, 0) ASC,
            s.chunk_end_ts DESC
        LIMIT ?
        """,
        tuple(params),
    ).fetchall()
    return rows


def _materialize_session_cards_sync(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    limit: int = SESSION_CARD_BATCH_SIZE,
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None,
) -> Dict[str, Any]:
    ensure_project_memory_card_schema(conn)
    rows = _fetch_pending_session_rows(
        conn,
        user_id=user_id,
        limit=limit,
        start_ms=start_ms,
        end_ms=end_ms,
    )
    generated = 0
    updated = 0
    skipped = 0
    evidence_rows = 0
    processed_session_ids: List[int] = []
    for row in rows:
        pack = _session_source_pack(row)
        processed_session_ids.append(_safe_int(pack.get("session_id")))
        if _is_low_signal_session_pack(pack):
            skipped += 1
            continue
        card = _generate_session_card(pack)
        existing_hash = str(row["existing_source_hash"] or "")
        if existing_hash and existing_hash == card["source_hash"]:
            skipped += 1
            continue
        _, inserted = _upsert_project_memory_card(conn, user_id=user_id, card=card)
        evidence_rows += len(card.get("evidence_rows") or [])
        if inserted:
            generated += 1
        else:
            updated += 1
    conn.commit()
    return {
        "generated": generated,
        "updated": updated,
        "skipped": skipped,
        "evidence_rows": evidence_rows,
        "processed_session_ids": processed_session_ids,
    }


def _thread_identity_key(card: Dict[str, Any]) -> str:
    canonical_identity = card.get("canonical_identity") or {}
    repo_root = str(canonical_identity.get("repo_root") or "").strip().lower()
    primary_directory = str(canonical_identity.get("primary_directory") or "").strip().lower()
    if repo_root:
        return f"repo:{repo_root}"
    if primary_directory:
        return f"dir:{primary_directory}"
    project_nouns = [str(value or "").strip().lower() for value in (card.get("project_nouns") or []) if str(value or "").strip()]
    for noun in project_nouns:
        if _normalized_key(noun) not in GENERIC_PROJECT_NOUNS:
            return f"noun:{_normalized_key(noun)}"
    domains = [str(value or "").strip().lower() for value in (card.get("domains") or []) if str(value or "").strip()]
    for domain in domains:
        if domain in HIGH_SIGNAL_PRODUCT_DOMAINS:
            return f"domain:{domain}"
    primary_app = str(card.get("primary_app") or "").strip().lower()
    return f"app:{_normalized_key(primary_app or 'work')}"


def _card_similarity(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    score = 0.0
    a_identity = a.get("canonical_identity") or {}
    b_identity = b.get("canonical_identity") or {}
    if a_identity.get("repo_root") and a_identity.get("repo_root") == b_identity.get("repo_root"):
        score += 3.0
    if a_identity.get("primary_directory") and a_identity.get("primary_directory") == b_identity.get("primary_directory"):
        score += 2.0
    overlap_files = set(a.get("files") or []) & set(b.get("files") or [])
    overlap_nouns = {
        _normalized_key(value)
        for value in (a.get("project_nouns") or [])
        if _normalized_key(value) and _normalized_key(value) not in GENERIC_PROJECT_NOUNS
    } & {
        _normalized_key(value)
        for value in (b.get("project_nouns") or [])
        if _normalized_key(value) and _normalized_key(value) not in GENERIC_PROJECT_NOUNS
    }
    overlap_domains = set(a.get("domains") or []) & set(b.get("domains") or [])
    score += min(2.0, len(overlap_files) * 0.7)
    score += min(2.0, len(overlap_nouns) * 0.8)
    score += min(1.0, len(overlap_domains & HIGH_SIGNAL_PRODUCT_DOMAINS) * 0.5)
    if str(a.get("primary_app") or "").strip().lower() == str(b.get("primary_app") or "").strip().lower():
        score += 0.2
    time_gap_ms = abs(_safe_int(a.get("start_ts")) - _safe_int(b.get("end_ts")))
    if time_gap_ms <= 6 * 60 * 60 * 1000:
        score += 0.2
    return score


def _thread_title(cards: Sequence[Dict[str, Any]]) -> str:
    title_counts = Counter()
    noun_counts = Counter()
    file_counts = Counter()
    artifact_counts = Counter()
    domain_counts = Counter()
    for card in cards:
        title = _clip_text(card.get("title"), 120)
        if title and not _is_noisy_text_candidate(title):
            title_counts[title] += 1
        for noun in card.get("project_nouns") or []:
            normalized = _normalized_key(noun)
            if normalized and normalized not in GENERIC_PROJECT_NOUNS:
                noun_counts[_clip_text(noun, 120)] += 1
        for file_path in card.get("files") or []:
            file_label = _humanize_identifier(file_path)
            if file_label and _normalized_key(file_label) not in GENERIC_PROJECT_NOUNS:
                file_counts[_clip_text(file_label, 120)] += 4
        for artifact in card.get("artifacts") or []:
            artifact_label = _humanize_identifier(artifact) or _clip_text(artifact, 120)
            if artifact_label and not _is_noisy_text_candidate(artifact_label):
                artifact_counts[_clip_text(artifact_label, 120)] += 3
        for domain in card.get("domains") or []:
            domain = str(domain or "").strip().lower()
            if domain in HIGH_SIGNAL_PRODUCT_DOMAINS:
                domain_counts[domain] += 2
    if file_counts:
        return file_counts.most_common(1)[0][0]
    if artifact_counts:
        return artifact_counts.most_common(1)[0][0]
    if noun_counts:
        return noun_counts.most_common(1)[0][0]
    if domain_counts:
        domain = domain_counts.most_common(1)[0][0]
        return _humanize_identifier(domain.split(".")[0]) or domain
    if title_counts:
        return title_counts.most_common(1)[0][0]
    return "Ongoing workstream"


def _thread_card_from_cluster(
    *,
    user_id: str,
    cards: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    sorted_cards = sorted(cards, key=lambda item: (_safe_int(item.get("start_ts")), _safe_int(item.get("end_ts"))))
    title = _thread_title(sorted_cards)
    outcomes = _rank_specific_values(
        [value for card in sorted_cards for value in (card.get("outcomes") or [])],
        4,
    )
    blockers = _rank_specific_values(
        [value for card in sorted_cards for value in (card.get("blockers") or [])],
        4,
    )
    project_nouns = _rank_specific_values(
        [value for card in sorted_cards for value in (card.get("project_nouns") or [])],
        10,
    )
    apps = _dedupe([value for card in sorted_cards for value in (card.get("apps") or [])], limit=8)
    domains = _dedupe([value for card in sorted_cards for value in (card.get("domains") or [])], limit=8)
    files = _dedupe([value for card in sorted_cards for value in (card.get("files") or [])], limit=12)
    artifacts = _dedupe([value for card in sorted_cards for value in (card.get("artifacts") or [])], limit=12)
    commands = _dedupe([value for card in sorted_cards for value in (card.get("commands") or [])], limit=8)
    start_ts = min(_safe_int(card.get("start_ts")) for card in sorted_cards)
    end_ts = max(_safe_int(card.get("end_ts")) for card in sorted_cards)
    primary_card = max(sorted_cards, key=lambda card: (_safe_float(card.get("confidence")), len(card.get("outcomes") or []), _safe_int(card.get("end_ts"))))
    identity_key = _thread_identity_key(primary_card)
    first_day = datetime.fromtimestamp(start_ts / 1000, tz=timezone.utc).strftime("%Y%m%d")
    card_key = f"thread:{user_id}:{identity_key}:{first_day}"
    status_values = [str(card.get("status") or "active") for card in sorted_cards]
    if "shipped" in status_values:
        status = "shipped"
    elif "blocked" in status_values:
        status = "blocked"
    elif all(value == "research" for value in status_values):
        status = "research"
    elif all(value == "planning" for value in status_values):
        status = "planning"
    else:
        status = "active"
    activity_classes = [str(card.get("activity_class") or "work") for card in sorted_cards]
    activity_class = Counter(activity_classes).most_common(1)[0][0] if activity_classes else "work"
    summary_hook = _build_summary_hook(
        title,
        outcomes,
        blockers,
        {
            "app_name": primary_card.get("primary_app"),
            "browser_domain": (domains or [None])[0],
        },
    )
    narrative_lines = [
        _clip_text(card.get("summary_hook"), 180)
        for card in sorted_cards
        if _clip_text(card.get("summary_hook"), 180)
    ]
    narrative_text = _clip_text(
        " ".join(_dedupe(narrative_lines, limit=6)),
        700,
    ) or summary_hook
    canonical_identity = dict(primary_card.get("canonical_identity") or {})
    confidence = round(
        min(
            0.99,
            0.45
            + min(0.18, len(sorted_cards) * 0.04)
            + min(0.14, len(outcomes) * 0.03)
            + min(0.12, len(files) * 0.03)
            + min(0.08, len(project_nouns) * 0.02),
        ),
        3,
    )
    evidence_rows: List[Dict[str, Any]] = []
    for card in sorted_cards[:16]:
        evidence_rows.append(
            {
                "session_id": _safe_int(card.get("primary_session_id")) or None,
                "evidence_id": f"session-card:{card.get('card_key')}",
                "evidence_kind": "recap_claim",
                "timestamp": _safe_int(card.get("end_ts")),
                "score": _safe_float(card.get("confidence")),
                "snippet": _clip_text(card.get("summary_hook") or card.get("narrative_text"), 220),
            }
        )
    return {
        "card_key": card_key,
        "card_level": "thread",
        "source_scope": "nightly_consolidation",
        "status": status,
        "activity_class": activity_class,
        "start_ts": start_ts,
        "end_ts": end_ts,
        "primary_session_id": _safe_int(primary_card.get("primary_session_id")) or None,
        "primary_app": primary_card.get("primary_app"),
        "title": title,
        "summary_hook": summary_hook,
        "narrative_text": narrative_text,
        "outcomes": outcomes,
        "blockers": blockers,
        "project_nouns": project_nouns,
        "apps": apps,
        "domains": domains,
        "files": files,
        "artifacts": artifacts,
        "commands": commands,
        "summary_hook_tokens": _token_text([title, summary_hook] + outcomes + blockers + project_nouns + files + domains),
        "canonical_identity": canonical_identity,
        "freshness_score": primary_card.get("freshness_score") or 0.0,
        "confidence": confidence,
        "source_hash": hashlib.sha1(
            _json_dumps(
                {
                    "member_keys": [card.get("card_key") for card in sorted_cards],
                    "updated_at": [card.get("updated_at") for card in sorted_cards],
                }
            ).encode("utf-8")
        ).hexdigest(),
        "consolidated_at": _now_ms(),
        "evidence_rows": evidence_rows,
    }


def _load_active_session_cards(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    lookback_start_ms: int,
    limit: int,
) -> List[Dict[str, Any]]:
    ensure_project_memory_card_schema(conn)
    rows = conn.execute(
        """
        SELECT *
        FROM project_memory_cards
        WHERE user_id = ?
          AND card_level = 'session'
          AND superseded_by_card_id IS NULL
          AND end_ts >= ?
        ORDER BY start_ts ASC, updated_at DESC
        LIMIT ?
        """,
        (user_id, int(lookback_start_ms), int(limit)),
    ).fetchall()
    results: List[Dict[str, Any]] = []
    for row in rows:
        get = lambda key: row[key]  # noqa: E731
        results.append(
            {
                "id": _safe_int(get("id")),
                "card_key": get("card_key"),
                "card_level": get("card_level"),
                "status": get("status"),
                "activity_class": get("activity_class"),
                "start_ts": _safe_int(get("start_ts")),
                "end_ts": _safe_int(get("end_ts")),
                "primary_session_id": _safe_int(get("primary_session_id")) or None,
                "primary_app": get("primary_app"),
                "title": get("title"),
                "summary_hook": get("summary_hook"),
                "narrative_text": get("narrative_text"),
                "outcomes": _json_loads(get("outcomes_json"), []),
                "blockers": _json_loads(get("blockers_json"), []),
                "project_nouns": _json_loads(get("project_nouns_json"), []),
                "apps": _json_loads(get("apps_json"), []),
                "domains": _json_loads(get("domains_json"), []),
                "files": _json_loads(get("files_json"), []),
                "artifacts": _json_loads(get("artifacts_json"), []),
                "commands": _json_loads(get("commands_json"), []),
                "summary_hook_tokens": get("summary_hook_tokens") or "",
                "canonical_identity": _json_loads(get("canonical_identity_json"), {}),
                "freshness_score": _safe_float(get("freshness_score")),
                "confidence": _safe_float(get("confidence")),
                "updated_at": _safe_int(get("updated_at")),
            }
        )
    return results


def _consolidate_thread_cards_sync(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    lookback_days: int = THREAD_CARD_LOOKBACK_DAYS,
    limit: int = THREAD_CARD_SESSION_LIMIT,
) -> Dict[str, Any]:
    ensure_project_memory_card_schema(conn)
    lookback_start_ms = _now_ms() - int(lookback_days * 24 * 60 * 60 * 1000)
    session_cards = _load_active_session_cards(
        conn,
        user_id=user_id,
        lookback_start_ms=lookback_start_ms,
        limit=limit,
    )
    if not session_cards:
        return {"generated": 0, "updated": 0, "clusters": 0}

    clusters: List[List[Dict[str, Any]]] = []
    for card in session_cards:
        best_index = -1
        best_score = 0.0
        for index, cluster in enumerate(clusters):
            anchor = cluster[-1]
            score = _card_similarity(anchor, card)
            if score > best_score:
                best_score = score
                best_index = index
        if best_index >= 0 and best_score >= 1.25:
            clusters[best_index].append(card)
        else:
            clusters.append([card])

    generated = 0
    updated = 0
    for cluster in clusters:
        if not cluster:
            continue
        thread_card = _thread_card_from_cluster(user_id=user_id, cards=cluster)
        _, inserted = _upsert_project_memory_card(conn, user_id=user_id, card=thread_card)
        if inserted:
            generated += 1
        else:
            updated += 1
    conn.commit()
    return {
        "generated": generated,
        "updated": updated,
        "clusters": len(clusters),
    }


def process_project_memory_cards_for_user_sync(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    limit: int = SESSION_CARD_BATCH_SIZE,
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None,
) -> Dict[str, Any]:
    if not PROJECT_MEMORY_CARDS_ENABLED:
        return {"enabled": False, "generated": 0, "updated": 0, "skipped": 0, "thread_cards": 0}
    ensure_project_memory_card_schema(conn)
    session_result = _materialize_session_cards_sync(
        conn,
        user_id=user_id,
        limit=limit,
        start_ms=start_ms,
        end_ms=end_ms,
    )
    thread_result = _consolidate_thread_cards_sync(conn, user_id=user_id)
    return {
        "enabled": True,
        **session_result,
        "thread_cards_generated": int(thread_result.get("generated") or 0),
        "thread_cards_updated": int(thread_result.get("updated") or 0),
        "thread_clusters": int(thread_result.get("clusters") or 0),
    }


async def _list_project_memory_users(limit: int = PROJECT_MEMORY_USER_SCAN_LIMIT) -> List[str]:
    async with get_db_session() as session:
        result = await session.execute(
            select(UserDB.id)
            .where(UserDB.turso_migrated_at.is_not(None))
            .order_by(UserDB.updated_at.desc())
            .limit(limit)
        )
        return [str(value) for value in result.scalars().all() if str(value or "").strip()]


async def process_project_memory_cards_with_guard(
    *,
    limit: int = SESSION_CARD_BATCH_SIZE,
    user_limit: int = PROJECT_MEMORY_USER_SCAN_LIMIT,
) -> Dict[str, Any]:
    if not PROJECT_MEMORY_CARDS_ENABLED:
        return {"enabled": False, "users_scanned": 0, "generated": 0, "updated": 0}
    users = await _list_project_memory_users(limit=user_limit)
    totals = {
        "enabled": True,
        "users_scanned": len(users),
        "generated": 0,
        "updated": 0,
        "skipped": 0,
        "thread_cards_generated": 0,
        "thread_cards_updated": 0,
    }
    for user_id in users:
        try:
            async with open_activity_connection_for_user(user_id, write=True) as conn:
                if conn is None:
                    continue
                conn.row_factory = sqlite3.Row
                result = process_project_memory_cards_for_user_sync(
                    conn,
                    user_id=user_id,
                    limit=limit,
                )
                totals["generated"] += int(result.get("generated") or 0)
                totals["updated"] += int(result.get("updated") or 0)
                totals["skipped"] += int(result.get("skipped") or 0)
                totals["thread_cards_generated"] += int(result.get("thread_cards_generated") or 0)
                totals["thread_cards_updated"] += int(result.get("thread_cards_updated") or 0)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Project memory card processing failed for %s: %s", user_id, exc)
    return totals


async def backfill_project_memory_cards_for_user(
    *,
    user_id: str,
    days: int = 90,
    limit: int = 500,
) -> Dict[str, Any]:
    start_ms = _now_ms() - int(max(1, days) * 24 * 60 * 60 * 1000)
    async with open_activity_connection_for_user(user_id, write=True) as conn:
        if conn is None:
            return {"success": False, "error": "Unable to open per-user activity DB"}
        conn.row_factory = sqlite3.Row
        result = process_project_memory_cards_for_user_sync(
            conn,
            user_id=user_id,
            limit=max(limit, SESSION_CARD_BATCH_SIZE),
            start_ms=start_ms,
            end_ms=_now_ms(),
        )
        return {"success": True, **result}


async def rebuild_project_memory_cards_for_user(
    *,
    user_id: str,
    start_ms: int,
    end_ms: int,
    limit: int = 500,
) -> Dict[str, Any]:
    if start_ms <= 0 or end_ms <= 0 or end_ms < start_ms:
        return {"success": False, "error": "Invalid rebuild range"}
    async with open_activity_connection_for_user(user_id, write=True) as conn:
        if conn is None:
            return {"success": False, "error": "Unable to open per-user activity DB"}
        conn.row_factory = sqlite3.Row
        result = process_project_memory_cards_for_user_sync(
            conn,
            user_id=user_id,
            limit=max(limit, SESSION_CARD_BATCH_SIZE),
            start_ms=start_ms,
            end_ms=end_ms,
        )
        return {
            "success": True,
            "start_ms": int(start_ms),
            "end_ms": int(end_ms),
            **result,
        }


def _decode_card_row(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "id": _safe_int(row["id"]),
        "card_key": row["card_key"],
        "user_id": row["user_id"],
        "card_level": row["card_level"],
        "source_scope": row["source_scope"],
        "status": row["status"],
        "activity_class": row["activity_class"],
        "start_ts": _safe_int(row["start_ts"]),
        "end_ts": _safe_int(row["end_ts"]),
        "primary_session_id": _safe_int(row["primary_session_id"]) or None,
        "primary_app": row["primary_app"],
        "title": row["title"],
        "summary_hook": row["summary_hook"],
        "narrative_text": row["narrative_text"],
        "outcomes": _json_loads(row["outcomes_json"], []),
        "blockers": _json_loads(row["blockers_json"], []),
        "project_nouns": _json_loads(row["project_nouns_json"], []),
        "apps": _json_loads(row["apps_json"], []),
        "domains": _json_loads(row["domains_json"], []),
        "files": _json_loads(row["files_json"], []),
        "artifacts": _json_loads(row["artifacts_json"], []),
        "commands": _json_loads(row["commands_json"], []),
        "summary_hook_tokens": row["summary_hook_tokens"] or "",
        "canonical_identity": _json_loads(row["canonical_identity_json"], {}),
        "freshness_score": _safe_float(row["freshness_score"]),
        "confidence": _safe_float(row["confidence"]),
        "source_hash": row["source_hash"],
        "created_at": _safe_int(row["created_at"]),
        "updated_at": _safe_int(row["updated_at"]),
        "consolidated_at": _safe_int(row["consolidated_at"]) or None,
    }


def load_project_memory_cards_for_range(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    range_start_ts: int,
    range_end_ts: int,
    limit: int = 24,
    card_levels: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    ensure_project_memory_card_schema(conn)
    levels = tuple(card_levels or ("thread", "session"))
    placeholders = ",".join("?" for _ in levels)
    rows = conn.execute(
        f"""
        SELECT *
        FROM project_memory_cards
        WHERE user_id = ?
          AND superseded_by_card_id IS NULL
          AND card_level IN ({placeholders})
          AND start_ts <= ?
          AND end_ts >= ?
        ORDER BY
          CASE card_level WHEN 'thread' THEN 0 ELSE 1 END,
          confidence DESC,
          end_ts DESC
        LIMIT ?
        """,
        (user_id, *levels, int(range_end_ts), int(range_start_ts), int(limit)),
    ).fetchall()
    return [_decode_card_row(row) for row in rows]


def load_cards_for_session_candidates(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    session_ids: Sequence[int],
    limit: int = 24,
) -> List[Dict[str, Any]]:
    ensure_project_memory_card_schema(conn)
    normalized_session_ids = [int(value) for value in session_ids if int(value or 0) > 0]
    if not normalized_session_ids:
        return []
    placeholders = ",".join("?" for _ in normalized_session_ids)
    rows = conn.execute(
        f"""
        SELECT DISTINCT pmc.*
        FROM project_memory_cards pmc
        LEFT JOIN project_memory_card_evidence pmce
          ON pmce.card_id = pmc.id
        WHERE pmc.user_id = ?
          AND pmc.superseded_by_card_id IS NULL
          AND (
                pmc.primary_session_id IN ({placeholders})
             OR pmce.session_id IN ({placeholders})
          )
        ORDER BY
          CASE pmc.card_level WHEN 'thread' THEN 0 ELSE 1 END,
          pmc.confidence DESC,
          pmc.end_ts DESC
        LIMIT ?
        """,
        (user_id, *normalized_session_ids, *normalized_session_ids, int(limit)),
    ).fetchall()
    return [_decode_card_row(row) for row in rows]


def load_compact_project_memory_card_manifest(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    candidate_cards: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    del user_id
    manifest: List[Dict[str, Any]] = []
    for card in candidate_cards:
        manifest.append(
            {
                "id": int(card.get("id") or 0),
                "card_key": card.get("card_key"),
                "card_level": card.get("card_level"),
                "title": card.get("title"),
                "summary_hook": card.get("summary_hook"),
                "project_nouns": card.get("project_nouns") or [],
                "apps": card.get("apps") or [],
                "domains": card.get("domains") or [],
                "files": card.get("files") or [],
                "status": card.get("status"),
                "activity_class": card.get("activity_class"),
                "start_ts": card.get("start_ts"),
                "end_ts": card.get("end_ts"),
                "freshness_score": card.get("freshness_score"),
                "confidence": card.get("confidence"),
                "summary_hook_tokens": card.get("summary_hook_tokens") or "",
                "primary_session_id": card.get("primary_session_id"),
                "canonical_identity": card.get("canonical_identity") or {},
            }
        )
    return manifest


def _load_project_memory_card_evidence(
    conn: sqlite3.Connection,
    *,
    card_ids: Sequence[int],
    limit_per_card: int = 5,
) -> Dict[int, List[Dict[str, Any]]]:
    ensure_project_memory_card_schema(conn)
    normalized_card_ids = [int(value) for value in card_ids if int(value or 0) > 0]
    if not normalized_card_ids:
        return {}
    placeholders = ",".join("?" for _ in normalized_card_ids)
    rows = conn.execute(
        f"""
        SELECT
            card_id,
            session_id,
            evidence_id,
            evidence_kind,
            timestamp,
            score,
            snippet
        FROM project_memory_card_evidence
        WHERE card_id IN ({placeholders})
        ORDER BY
            CASE evidence_kind
                WHEN 'vision_snapshot' THEN 0
                WHEN 'snapshot' THEN 1
                WHEN 'session_doc' THEN 2
                ELSE 3
            END,
            score DESC,
            timestamp DESC
        """,
        tuple(normalized_card_ids),
    ).fetchall()
    grouped: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for row in rows:
        card_id = _safe_int(row["card_id"])
        bucket = grouped[card_id]
        if len(bucket) >= limit_per_card:
            continue
        snippet = _clip_text(row["snippet"], 320)
        if not snippet:
            continue
        bucket.append(
            {
                "session_id": _safe_int(row["session_id"]) or None,
                "evidence_id": row["evidence_id"],
                "evidence_kind": row["evidence_kind"],
                "timestamp": _safe_int(row["timestamp"]),
                "score": _safe_float(row["score"]),
                "snippet": snippet,
            }
        )
    return grouped


def _hydrate_selected_cards_with_evidence(
    selected_cards: Sequence[Dict[str, Any]],
    *,
    evidence_by_card_id: Dict[int, List[Dict[str, Any]]],
    citations: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    by_session: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for citation in citations or []:
        session_id = _coerce_session_id(citation.get("session_id") or citation.get("session_key") or 0)
        snippet = _clip_text(citation.get("snippet"), 320)
        if session_id <= 0 or not snippet:
            continue
        by_session[session_id].append(
            {
                "session_id": session_id,
                "evidence_id": citation.get("evidence_id") or f"citation:{session_id}:{citation.get('timestamp')}",
                "evidence_kind": "retrieved_citation",
                "timestamp": _safe_int(citation.get("timestamp")),
                "score": _safe_float(citation.get("score"), 0.4),
                "snippet": snippet,
            }
        )

    hydrated: List[Dict[str, Any]] = []
    for card in selected_cards:
        merged = list(evidence_by_card_id.get(_safe_int(card.get("id")), []))
        primary_session_id = _safe_int(card.get("primary_session_id"))
        if primary_session_id > 0:
            merged.extend(by_session.get(primary_session_id, []))
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for item in sorted(
            merged,
            key=lambda entry: (
                0 if str(entry.get("evidence_kind") or "") == "vision_snapshot" else 1,
                -_safe_float(entry.get("score")),
                -_safe_int(entry.get("timestamp")),
            ),
        ):
            key = (
                str(item.get("evidence_kind") or ""),
                str(item.get("snippet") or "").lower(),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
            if len(deduped) >= 5:
                break
        hydrated_card = dict(card)
        hydrated_card["evidence"] = deduped
        hydrated.append(hydrated_card)
    return hydrated


def _query_implies_outcomes(query: str) -> bool:
    normalized = str(query or "").lower()
    return any(token in normalized for token in ("get done", "ship", "shipped", "fixed", "accomplish", "outcome"))


def _query_implies_blockers(query: str) -> bool:
    normalized = str(query or "").lower()
    return any(token in normalized for token in ("blocked", "blocker", "issue", "problem", "error", "failed"))


def select_relevant_project_memory_cards(
    manifest: Sequence[Dict[str, Any]],
    *,
    query: str,
    query_start_ts: int,
    query_end_ts: int,
    retrieved_session_ids: Sequence[int],
    limit: int = 8,
) -> List[int]:
    profile = build_query_semantic_profile(query)
    query_tokens = set(profile.get("tokens") or [])
    query_refs = {
        _normalized_key(value)
        for value in (
            list(profile.get("task_phrases") or [])
            + list(profile.get("artifact_refs") or [])
            + list(profile.get("entity_refs") or [])
            + list(profile.get("document_refs") or [])
        )
        if _normalized_key(value)
    }
    session_id_set = {int(value) for value in retrieved_session_ids if int(value or 0) > 0}
    scored: List[Tuple[float, int, Dict[str, Any]]] = []
    outcome_bonus = 0.3 if _query_implies_outcomes(query) else 0.0
    blocker_bonus = 0.3 if _query_implies_blockers(query) else 0.0
    for item in manifest:
        item_tokens = set(
            build_query_semantic_profile(
                " ".join(
                    [
                        str(item.get("title") or ""),
                        str(item.get("summary_hook") or ""),
                        " ".join(item.get("project_nouns") or []),
                        " ".join(item.get("files") or []),
                        " ".join(item.get("domains") or []),
                        str(item.get("summary_hook_tokens") or ""),
                    ]
                )
            ).get("tokens")
            or []
        )
        overlap_tokens = len(query_tokens & item_tokens)
        item_refs = {
            _normalized_key(value)
            for value in (
                list(item.get("project_nouns") or [])
                + list(item.get("files") or [])
                + list(item.get("domains") or [])
            )
            if _normalized_key(value)
        }
        overlap_refs = len(query_refs & item_refs)
        item_start = _safe_int(item.get("start_ts"))
        item_end = _safe_int(item.get("end_ts"))
        overlap_ms = max(0, min(query_end_ts, item_end) - max(query_start_ts, item_start))
        span_ms = max(1, item_end - item_start)
        time_overlap_score = min(2.0, overlap_ms / float(span_ms))
        session_bonus = 0.5 if int(item.get("primary_session_id") or 0) in session_id_set else 0.0
        card_level_bonus = 0.3 if str(item.get("card_level") or "") == "thread" else 0.1
        freshness = _safe_float(item.get("freshness_score"))
        confidence = _safe_float(item.get("confidence"))
        status = str(item.get("status") or "")
        activity_class = str(item.get("activity_class") or "work")
        status_score = 0.0
        if outcome_bonus and status == "shipped":
            status_score += outcome_bonus
        if blocker_bonus and status == "blocked":
            status_score += blocker_bonus
        activity_bias = {
            "work": 0.35,
            "research": 0.25,
            "communication": 0.05,
            "admin": -0.1,
            "personal": -0.25,
        }.get(activity_class, 0.0)
        score = (
            (overlap_tokens * 0.5)
            + (overlap_refs * 0.75)
            + time_overlap_score
            + session_bonus
            + card_level_bonus
            + (freshness * 0.4)
            + (confidence * 0.8)
            + activity_bias
            + status_score
        )
        scored.append((score, int(item.get("id") or 0), item))
    scored.sort(key=lambda row: row[0], reverse=True)

    def _dedupe_key(item: Dict[str, Any]) -> str:
        identity = item.get("canonical_identity") or {}
        repo_root = _normalized_key(identity.get("repo_root") or "")
        primary_directory = _normalized_key(identity.get("primary_directory") or "")
        if primary_directory:
            return f"dir:{primary_directory}"
        if repo_root:
            return f"repo:{repo_root}"
        nouns = [
            _normalized_key(value)
            for value in (item.get("project_nouns") or [])
            if _normalized_key(value) and _normalized_key(value) not in GENERIC_PROJECT_NOUNS
        ]
        if nouns:
            return f"noun:{nouns[0]}"
        title_key = _normalized_key(item.get("title") or "")
        if title_key:
            return f"title:{title_key}"
        return f"card:{int(item.get('id') or 0)}"

    selected_ids: List[int] = []
    seen_keys: Counter[str] = Counter()
    hard_limit = max(3, min(8, limit))
    soft_pool = scored[: max(12, limit * 4)]
    for _score, card_id, item in soft_pool:
        if card_id <= 0:
            continue
        key = _dedupe_key(item)
        allowed = 1 if str(item.get("card_level") or "") == "session" else 2
        if seen_keys[key] >= allowed:
            continue
        selected_ids.append(card_id)
        seen_keys[key] += 1
        if len(selected_ids) >= hard_limit:
            break
    if len(selected_ids) < hard_limit:
        for _score, card_id, _item in soft_pool:
            if card_id <= 0 or card_id in selected_ids:
                continue
            selected_ids.append(card_id)
            if len(selected_ids) >= hard_limit:
                break
    return selected_ids[:hard_limit]


def _claim_from_card(card: Dict[str, Any], *, is_main: bool) -> str:
    pseudo_work_item = {
        "title": card.get("title"),
        "story_kind": "research" if card.get("activity_class") in RESEARCH_ACTIVITY_CLASSES else "general",
        "specific_tasks": card.get("outcomes") or card.get("project_nouns") or [],
        "primary_app": card.get("primary_app"),
        "file_artifacts": card.get("files") or [],
        "command_artifacts": card.get("commands") or [],
        "commit_artifacts": [],
        "error_artifacts": card.get("blockers") or [],
    }
    return _claim_text_for_item(pseudo_work_item, is_main=is_main)


def _card_supporting_snippets(card: Dict[str, Any], *, limit: int = 4) -> List[str]:
    snippets: List[str] = []
    for evidence in card.get("evidence") or []:
        snippet = _clip_text(evidence.get("snippet"), 260)
        if snippet:
            snippets.append(snippet)
    if card.get("summary_hook"):
        snippets.append(_clip_text(card.get("summary_hook"), 220))
    deduped: List[str] = []
    seen = set()
    for snippet in snippets:
        lowered = snippet.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        deduped.append(snippet)
        if len(deduped) >= limit:
            break
    return deduped


def build_story_plan_from_project_memory_cards(
    selected_cards: Sequence[Dict[str, Any]],
    *,
    query: str,
    intent: str,
    time_truth: Optional[Dict[str, Any]] = None,
    citations: Optional[Sequence[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    if not selected_cards:
        return None
    ordered = sorted(
        selected_cards,
        key=lambda item: (_safe_int(item.get("start_ts")), -_safe_float(item.get("confidence"))),
    )
    ranked = sorted(
        ordered,
        key=lambda item: (
            1 if str(item.get("card_level") or "") == "thread" else 0,
            _safe_float(item.get("confidence")),
            _safe_int(item.get("end_ts")),
        ),
        reverse=True,
    )
    main_event = ranked[0]
    supporting = [card for card in ranked[1:] if str(card.get("activity_class") or "") not in PERSONAL_ACTIVITY_CLASSES][:4]
    research = [card for card in ranked if str(card.get("activity_class") or "") in RESEARCH_ACTIVITY_CLASSES][:4]
    personal = [card for card in ranked if str(card.get("activity_class") or "") in PERSONAL_ACTIVITY_CLASSES][:4]

    def _serialize(card: Dict[str, Any], *, sequence_number: int = 0) -> Dict[str, Any]:
        supporting_snippets = _card_supporting_snippets(card)
        return {
            "id": card.get("id"),
            "label": card.get("title"),
            "raw_title": card.get("title"),
            "activity_class": card.get("activity_class"),
            "story_kind": "research" if card.get("activity_class") in RESEARCH_ACTIVITY_CLASSES else "general",
            "evidence_count": len(card.get("evidence") or []) or len(card.get("outcomes") or []) or 1,
            "apps": card.get("apps") or [],
            "specific_tasks": card.get("outcomes") or card.get("project_nouns") or [],
            "artifact_refs": card.get("artifacts") or [],
            "browser_domains": card.get("domains") or [],
            "session_keys": [f"session:{card.get('primary_session_id')}"] if card.get("primary_session_id") else [],
            "score_main_event": round(_safe_float(card.get("confidence")) + (0.2 if card.get("card_level") == "thread" else 0.0), 3),
            "confidence": card.get("confidence"),
            "duration_ms": _estimate_duration_ms(card),
            "start_ts": card.get("start_ts"),
            "end_ts": card.get("end_ts"),
            "interaction_level": "active_editing" if (card.get("files") or card.get("commands") or card.get("outcomes")) else "present",
            "file_artifacts": card.get("files") or [],
            "command_artifacts": card.get("commands") or [],
            "error_artifacts": card.get("blockers") or [],
            "commit_artifacts": [],
            "git_op_artifacts": [],
            "task_doc_artifacts": [],
            "repo_root": (card.get("canonical_identity") or {}).get("repo_root") or "",
            "branch": (card.get("canonical_identity") or {}).get("branch") or "",
            "primary_directory": (card.get("canonical_identity") or {}).get("primary_directory") or "",
            "sequence_number": sequence_number,
            "summary_hook": card.get("summary_hook"),
            "narrative_text": card.get("narrative_text"),
            "supporting_snippets": supporting_snippets,
        }

    numbered = [_serialize(card, sequence_number=index + 1) for index, card in enumerate(ordered[:8])]
    timeline_segments = []
    for card in ordered[:8]:
        timeline_segments.append(
            {
                "bucket": _story_kind_title("research" if card.get("activity_class") in RESEARCH_ACTIVITY_CLASSES else "general"),
                "segment_type": _story_kind_title("research" if card.get("activity_class") in RESEARCH_ACTIVITY_CLASSES else "general").lower().replace(" ", "_"),
                "start_ts": card.get("start_ts"),
                "end_ts": card.get("end_ts"),
                "apps": card.get("apps") or [],
                "tasks": (card.get("outcomes") or card.get("project_nouns") or [])[:5],
                "evidence_count": len(card.get("outcomes") or []) or 1,
            }
        )

    strongest_evidence: List[Dict[str, Any]] = []
    for card in ranked[:6]:
        evidence_items = card.get("evidence") or []
        if evidence_items:
            for evidence in evidence_items[:2]:
                strongest_evidence.append(
                    {
                        "evidence_id": evidence.get("evidence_id") or f"card:{card.get('card_key')}",
                        "timestamp": evidence.get("timestamp") or card.get("end_ts"),
                        "app": card.get("primary_app"),
                        "window": card.get("title"),
                        "snippet": evidence.get("snippet") or card.get("summary_hook") or card.get("narrative_text"),
                        "activity_class": card.get("activity_class"),
                        "score": max(_safe_float(evidence.get("score")), _safe_float(card.get("confidence"))),
                        "reason": evidence.get("evidence_kind") or card.get("status"),
                        "task_phrases": card.get("outcomes") or [],
                    }
                )
        else:
            strongest_evidence.append(
                {
                    "evidence_id": f"card:{card.get('card_key')}",
                    "timestamp": card.get("end_ts"),
                    "app": card.get("primary_app"),
                    "window": card.get("title"),
                    "snippet": card.get("summary_hook") or card.get("narrative_text"),
                    "activity_class": card.get("activity_class"),
                    "score": card.get("confidence"),
                    "reason": card.get("status"),
                    "task_phrases": card.get("outcomes") or [],
                }
            )
    for citation in (citations or [])[:3]:
        strongest_evidence.append(
            {
                "evidence_id": citation.get("evidence_id"),
                "timestamp": citation.get("timestamp"),
                "app": citation.get("app_name"),
                "window": citation.get("window_title"),
                "snippet": citation.get("snippet"),
                "activity_class": "work",
                "score": citation.get("score"),
                "reason": "supporting citation",
                "task_phrases": [],
            }
        )

    claim_cards = []
    for index, card in enumerate(ranked[:6]):
        claim_cards.append(
            {
                "claim_text": _claim_from_card(card, is_main=index == 0),
                "claim_kind": "main_event" if index == 0 else "supporting_workstream",
                "work_item_id": card.get("id"),
                "supporting_evidence_ids": [
                    evidence.get("evidence_id")
                    for evidence in (card.get("evidence") or [])[:3]
                    if evidence.get("evidence_id")
                ] or [f"card:{card.get('card_key')}"],
                "counter_evidence_ids": [],
                "confidence": card.get("confidence"),
                "why_this_claim": f"Derived from durable {card.get('card_level')} memory card grounded in prior session evidence.",
            }
        )

    workstream_summary = []
    for card in ranked[:6]:
        workstream_summary.append(
            {
                "label": card.get("title"),
                "activity_class": card.get("activity_class"),
                "evidence_count": len(card.get("outcomes") or []) or 1,
                "apps": card.get("apps") or [],
                "representative_windows": [card.get("title")],
                "supporting_snippets": _card_supporting_snippets(card),
                "session_keys": [f"session:{card.get('primary_session_id')}"] if card.get("primary_session_id") else [],
                "topic_tokens": card.get("project_nouns") or [],
                "specific_tasks": card.get("outcomes") or [],
                "story_kind": "research" if card.get("activity_class") in RESEARCH_ACTIVITY_CLASSES else "general",
                "score_main_event": round(_safe_float(card.get("confidence")) + (0.2 if card.get("card_level") == "thread" else 0.0), 3),
            }
        )

    files_touched = _dedupe([value for card in ranked[:6] for value in (card.get("files") or [])], limit=16)
    commands_run = _dedupe([value for card in ranked[:6] for value in (card.get("commands") or [])], limit=10)
    errors_encountered = _dedupe([value for card in ranked[:6] for value in (card.get("blockers") or [])], limit=8)
    concrete_tasks = _dedupe([value for card in ranked[:6] for value in (card.get("outcomes") or [])], limit=12)
    planning_and_followups = [
        {
            "label": card.get("title"),
            "specific_tasks": card.get("blockers") or [],
            "work_item_id": card.get("id"),
            "confidence": card.get("confidence"),
        }
        for card in ranked[:4]
        if card.get("blockers")
    ]
    apps_and_tools_used = [
        {
            "app": app,
            "evidence_count": sum(1 for card in ranked if app in (card.get("apps") or [])),
            "top_windows": [{"window": card.get("title"), "count": 1} for card in ranked if app in (card.get("apps") or [])][:3],
        }
        for app in _dedupe([value for card in ranked for value in (card.get("apps") or [])], limit=8)
    ]
    corroborating_activity = []
    for card in ranked[:6]:
        for domain in (card.get("domains") or [])[:3]:
            corroborating_activity.append(
                {
                    "work_item_id": card.get("id"),
                    "kind": "browser",
                    "app_name": card.get("primary_app"),
                    "timestamp": card.get("end_ts"),
                    "commands": card.get("commands") or [],
                    "git_ops": [],
                    "errors": card.get("blockers") or [],
                    "snippet": _clip_text(domain, 120),
                    "grounding_score": round(_safe_float(card.get("confidence")), 2),
                    "grounding_reasons": ["memory_card_domain"],
                }
            )
    story_plan = {
        "renderer_kind": detect_story_renderer_kind(query, intent),
        "main_event": _serialize(main_event, sequence_number=1),
        "supporting_workstreams": [_serialize(card, sequence_number=index + 2) for index, card in enumerate(supporting)],
        "research_browsing": [_serialize(card) for card in research],
        "personal_activity": [_serialize(card) for card in personal],
        "concrete_tasks_completed": concrete_tasks,
        "planning_and_followups": planning_and_followups,
        "apps_and_tools_used": apps_and_tools_used[:6],
        "timeline_segments": timeline_segments,
        "claim_cards": claim_cards,
        "strongest_evidence": strongest_evidence[:8],
        "uncertainty_or_conflicts": [],
        "work_items": [_serialize(card) for card in ranked[:8]],
        "document_items": [],
        "entities": [],
        "entity_aliases": [],
        "temporal_segments": timeline_segments,
        "main_workstreams": workstream_summary,
        "numbered_workstreams": numbered,
        "corroborating_activity": corroborating_activity[:12],
        "files_touched": files_touched,
        "commands_run": commands_run,
        "errors_encountered": errors_encountered,
        "commits_and_pushes": [],
        "task_docs_referenced": [],
        "specific_tasks": concrete_tasks,
        "key_artifacts": _dedupe([value for card in ranked[:5] for value in (card.get("artifacts") or [])], limit=12),
        "metrics": {
            "work_items_considered": len(ranked),
            "cross_app_stitches": len([card for card in ranked if len(card.get("apps") or []) >= 2]),
            "claim_count": len(claim_cards),
            "claim_grounding_rate": 1.0 if claim_cards else 0.0,
            "planning_only_ratio": round(len([card for card in ranked if card.get("status") == "planning"]) / max(len(ranked), 1), 3),
            "generic_fallback_used": False,
            "card_first_used": True,
            "selected_card_count": len(selected_cards),
            "thread_card_count": len([card for card in selected_cards if card.get("card_level") == "thread"]),
            "session_card_count": len([card for card in selected_cards if card.get("card_level") == "session"]),
        },
    }
    story_plan["renderer"] = _build_renderer_payload(
        renderer_kind=story_plan["renderer_kind"],
        story_plan=story_plan,
        time_truth=time_truth,
    )
    return story_plan


async def load_selected_project_memory_cards(
    *,
    user_id: str,
    query: str,
    intent: str,
    range_start_ts: int,
    range_end_ts: int,
    citations: Optional[Sequence[Dict[str, Any]]] = None,
    limit: int = 8,
    allow_on_demand_build: bool = True,
) -> Dict[str, Any]:
    citations = citations or []
    session_ids = [
        _coerce_session_id(item.get("session_id") or item.get("session_key") or 0)
        for item in citations
        if _coerce_session_id(item.get("session_id") or item.get("session_key") or 0) > 0
    ]
    async with open_activity_connection_for_user(user_id, write=allow_on_demand_build) as conn:
        if conn is None:
            return {"cards": [], "selected_card_ids": [], "debug": {"reason": "no_connection"}}
        conn.row_factory = sqlite3.Row
        ensure_project_memory_card_schema(conn)
        candidate_cards = load_cards_for_session_candidates(
            conn,
            user_id=user_id,
            session_ids=session_ids,
            limit=max(limit * 6, 48),
        )
        candidate_cards.extend(
            [
                card
                for card in load_project_memory_cards_for_range(
                    conn,
                    user_id=user_id,
                    range_start_ts=range_start_ts,
                    range_end_ts=range_end_ts,
                    limit=max(limit * 12, 96),
                )
                if card.get("card_key") not in {existing.get("card_key") for existing in candidate_cards}
            ]
        )
        generated_on_demand = False
        if not candidate_cards and allow_on_demand_build:
            build_result = process_project_memory_cards_for_user_sync(
                conn,
                user_id=user_id,
                limit=max(limit * 6, 48),
                start_ms=range_start_ts - int(6 * 60 * 60 * 1000),
                end_ms=range_end_ts + int(6 * 60 * 60 * 1000),
            )
            if int(build_result.get("generated") or 0) > 0 or int(build_result.get("updated") or 0) > 0:
                generated_on_demand = True
                candidate_cards = load_cards_for_session_candidates(
                    conn,
                    user_id=user_id,
                    session_ids=session_ids,
                    limit=max(limit * 6, 48),
                )
                candidate_cards.extend(
                    [
                        card
                        for card in load_project_memory_cards_for_range(
                            conn,
                            user_id=user_id,
                            range_start_ts=range_start_ts,
                            range_end_ts=range_end_ts,
                            limit=max(limit * 12, 96),
                        )
                        if card.get("card_key") not in {existing.get("card_key") for existing in candidate_cards}
                    ]
                )
        manifest = load_compact_project_memory_card_manifest(
            conn,
            user_id=user_id,
            candidate_cards=candidate_cards,
        )
        selected_card_ids = select_relevant_project_memory_cards(
            manifest,
            query=query,
            query_start_ts=range_start_ts,
            query_end_ts=range_end_ts,
            retrieved_session_ids=session_ids,
            limit=limit,
        )
        selected_cards = [
            card
            for card in candidate_cards
            if int(card.get("id") or 0) in set(selected_card_ids)
        ]
        evidence_by_card_id = _load_project_memory_card_evidence(
            conn,
            card_ids=selected_card_ids,
            limit_per_card=5,
        )
        selected_cards = _hydrate_selected_cards_with_evidence(
            selected_cards,
            evidence_by_card_id=evidence_by_card_id,
            citations=citations,
        )
        selected_cards.sort(
            key=lambda card: (
                0 if str(card.get("card_level") or "") == "thread" else 1,
                -_safe_float(card.get("confidence")),
                _safe_int(card.get("start_ts")),
            )
        )
        return {
            "cards": selected_cards[: max(3, min(limit, 8))],
            "selected_card_ids": selected_card_ids,
            "debug": {
                "candidate_cards": len(candidate_cards),
                "selected_cards": len(selected_cards),
                "candidate_session_ids": len(session_ids),
                "generated_on_demand": generated_on_demand,
            },
        }


def get_project_memory_card_health_sync(
    conn: sqlite3.Connection,
    *,
    user_id: str,
) -> Dict[str, Any]:
    ensure_project_memory_card_schema(conn)
    counts = conn.execute(
        """
        SELECT
            SUM(CASE WHEN card_level = 'session' AND superseded_by_card_id IS NULL THEN 1 ELSE 0 END) AS session_cards,
            SUM(CASE WHEN card_level = 'thread' AND superseded_by_card_id IS NULL THEN 1 ELSE 0 END) AS thread_cards,
            MAX(CASE WHEN card_level = 'session' THEN end_ts ELSE NULL END) AS latest_session_card_ts,
            MAX(CASE WHEN card_level = 'thread' THEN end_ts ELSE NULL END) AS latest_thread_card_ts
        FROM project_memory_cards
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    pending_sessions = 0
    if _table_exists(conn, "session_retrieval_docs") and _table_exists(conn, "context_sessions"):
        pending_row = conn.execute(
            """
            SELECT COUNT(*)
            FROM session_retrieval_docs s
            JOIN context_sessions sess
              ON sess.id = s.session_id
            LEFT JOIN project_memory_cards pmc
              ON pmc.primary_session_id = s.session_id
             AND pmc.card_level = 'session'
             AND pmc.superseded_by_card_id IS NULL
            WHERE s.user_id = ?
              AND sess.user_id = ?
              AND sess.end_ts <= ?
              AND pmc.id IS NULL
            """,
            (user_id, user_id, _now_ms() - PROJECT_MEMORY_CARD_RECENT_DELAY_MS),
        ).fetchone()
        pending_sessions = _safe_int((pending_row or [0])[0])
    return {
        "enabled": PROJECT_MEMORY_CARDS_ENABLED,
        "session_cards": _safe_int(counts["session_cards"]) if counts is not None else 0,
        "thread_cards": _safe_int(counts["thread_cards"]) if counts is not None else 0,
        "latest_session_card_ts": _safe_int(counts["latest_session_card_ts"]) if counts is not None else 0,
        "latest_thread_card_ts": _safe_int(counts["latest_thread_card_ts"]) if counts is not None else 0,
        "pending_session_cards": pending_sessions,
    }


async def get_project_memory_card_health(
    *,
    user_id: str,
) -> Dict[str, Any]:
    async with open_activity_connection_for_user(user_id, write=False) as conn:
        if conn is None:
            return {
                "enabled": PROJECT_MEMORY_CARDS_ENABLED,
                "session_cards": 0,
                "thread_cards": 0,
                "latest_session_card_ts": 0,
                "latest_thread_card_ts": 0,
                "pending_session_cards": 0,
                "error": "Unable to open per-user activity DB",
            }
        conn.row_factory = sqlite3.Row
        return get_project_memory_card_health_sync(conn, user_id=user_id)
