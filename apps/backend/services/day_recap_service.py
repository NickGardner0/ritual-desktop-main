"""Deterministic anchored-day recap bundle service."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import sqlite3
import subprocess
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time as dt_time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import select

from database.connection import get_db_session
from database.models import ScheduledBlockDB
from services.biometrics_service import biometrics_service
from services.watcher_service import watcher_service
from services.watcher_service_activity import get_top_apps_impl, get_top_domains_impl
from services.watcher_service_local_db import (
    get_local_activity_db_path_impl,
    get_local_memory_db_path_impl,
    open_activity_connection_for_user,
)
from services.watcher_service_search import query_memory_impl

logger = logging.getLogger(__name__)

MERGE_GAP_MS = 12 * 60 * 1000
FORCE_SPLIT_GAP_MS = 25 * 60 * 1000
MAX_WORKSTREAMS = 8

CALENDAR_TIMEOUT_S = 8.0
BIOMETRICS_TIMEOUT_S = 8.0
GIT_TIMEOUT_S = 6.0
SEMANTIC_TIMEOUT_S = 10.0
WATCHER_TIMEOUT_S = 8.0

SEMANTIC_STALE_LAG_MS = 15 * 60 * 1000
OUTBOX_PENDING_DEGRADED = 1000


@dataclass
class NormalizedEvidence:
    evidence_id: str
    source: str
    start_ts: int
    end_ts: int
    app: str = ""
    domain: str = ""
    title: str = ""
    document_path: str = ""
    semantic_summary: str = ""
    raw_text: str = ""
    confidence: float = 0.0
    evidence_grade: str = "passive_presence"
    claim_strength: str = "low"
    entity_tokens: set[str] = field(default_factory=set)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RecapWorkstream:
    kind: str
    start_ts: int
    end_ts: int
    primary_title: str
    supporting_entities: List[str]
    source_evidence_ids: List[str]
    confidence: float
    narrative_priority: float
    evidence_grade: str
    claim_strength: str
    direct_evidence_count: int
    sentences: List[str]


def _clip(value: Any, limit: int = 180) -> str:
    text = str(value or "").replace("\n", " ").strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(limit - 3, 1)].rstrip()}..."


def _parse_anchor_date(anchor_date: str) -> date:
    return datetime.strptime(anchor_date, "%Y-%m-%d").date()


def _resolve_zone(timezone_name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _start_end_ms(anchor: date, timezone_name: Optional[str]) -> Tuple[int, int]:
    zone = _resolve_zone(timezone_name)
    start_dt = datetime.combine(anchor, dt_time.min, tzinfo=zone)
    end_dt = datetime.combine(anchor, dt_time.max, tzinfo=zone)
    return int(start_dt.timestamp() * 1000), int(end_dt.timestamp() * 1000)


def _start_end_ms_for_range(
    start_day: date,
    end_day: date,
    timezone_name: Optional[str],
) -> Tuple[int, int]:
    zone = _resolve_zone(timezone_name)
    start_dt = datetime.combine(start_day, dt_time.min, tzinfo=zone)
    end_dt = datetime.combine(end_day, dt_time.max, tzinfo=zone)
    return int(start_dt.timestamp() * 1000), int(end_dt.timestamp() * 1000)


def _iter_days(start_day: date, end_day: date) -> Iterable[date]:
    current = start_day
    while current <= end_day:
        yield current
        current = current.fromordinal(current.toordinal() + 1)


_STOP_WORDS = {
    "about", "after", "again", "app", "apps", "browser", "code", "dashboard", "details",
    "doing", "from", "into", "just", "page", "pages", "project", "query", "related",
    "screen", "session", "some", "task", "tasks", "text", "that", "their", "there",
    "this", "today", "using", "viewing", "were", "what", "when", "where", "with",
    "work", "worked", "working", "your",
}


def _normalize_tokens(*values: str) -> set[str]:
    text = " ".join(str(v or "") for v in values).lower()
    text = re.sub(r"https?://", " ", text)
    text = re.sub(r"[^a-z0-9._/-]+", " ", text)
    return {
        token
        for token in text.split()
        if len(token) >= 3 and token not in _STOP_WORDS
    }


def _count_overlap(a: Iterable[str], b: Iterable[str]) -> int:
    bset = set(b)
    return sum(1 for token in a if token in bset)


def _extract_domain(*values: str) -> str:
    for value in values:
        match = re.search(r"\b([a-z0-9-]+\.)+[a-z]{2,}\b", str(value or ""), re.IGNORECASE)
        if match:
            return match.group(0).lower().removeprefix("www.")
    return ""


def _extract_file_label(path: str) -> str:
    normalized = str(path or "").strip()
    if not normalized:
        return ""
    return normalized.split("/")[-1]


def _extract_project_label(path: str, title: str) -> str:
    parts = [part for part in str(path or "").split("/") if part]
    for part in parts:
        if re.search(r"(desktop|backend|dashboard|ritual|main|app)", part, re.IGNORECASE):
            return part
    title_match = re.search(r"\b([a-z0-9._-]+(?:desktop|backend|dashboard|main)[a-z0-9._-]*)\b", str(title or ""), re.IGNORECASE)
    return title_match.group(1) if title_match else ""


def _extract_window_fragments(title: str) -> List[str]:
    fragments = re.split(r"\s+[|–—-]\s+", str(title or ""))
    return [
        fragment.strip()
        for fragment in fragments
        if 4 <= len(fragment.strip()) <= 90
        and not re.fullmatch(r"(google chrome|chrome|cursor|codex|claude|finder|mail|gmail)", fragment.strip(), re.IGNORECASE)
    ][:4]


def _normalize_browser_entity(domain: str, title: str, raw_text: str) -> List[str]:
    normalized_domain = str(domain or "").strip().lower()
    entities: List[str] = []
    if normalized_domain:
        if normalized_domain in {"mail.google.com", "gmail.com"}:
            entities.append("gmail")
        elif normalized_domain in {"docs.google.com", "drive.google.com"}:
            entities.append("google docs")
        elif normalized_domain == "localhost":
            entities.append("localhost")
        else:
            entities.append(normalized_domain)

    lowered_title = str(title or "").lower()
    lowered_text = str(raw_text or "").lower()
    if "gmail" in lowered_title or "gmail" in lowered_text:
        entities.append("gmail")
    if "google docs" in lowered_title or "docs" in lowered_title:
        entities.append("google docs")
    if "calendar" in lowered_title:
        entities.append("calendar")
    if "slack" in lowered_title or "slack" in lowered_text:
        entities.append("slack")
    return list(dict.fromkeys(entity.strip() for entity in entities if entity.strip()))


def _classification_score(kind: str, evidence: NormalizedEvidence) -> float:
    haystack = " ".join(
        [
            evidence.app,
            evidence.domain,
            evidence.title,
            evidence.document_path,
            evidence.semantic_summary,
            evidence.raw_text,
        ]
    ).lower()
    rules = {
        "meeting": [("meet", 1.2), ("zoom", 1.0), ("calendar", 0.9), ("call", 0.7)],
        "coding": [("cursor", 1.2), ("codex", 1.1), ("claude", 0.7), ("localhost", 0.8), (".ts", 0.9), ("commit", 1.2), ("git", 0.9)],
        "research": [("docs", 0.6), ("perplexity", 0.8), ("google", 0.4), ("x.com", 0.6), ("read", 0.6), ("browse", 0.5)],
        "communication": [("gmail", 1.0), ("mail", 0.7), ("slack", 1.0), ("message", 0.6)],
        "admin": [("settings", 0.8), ("dashboard", 0.6), ("billing", 0.6), ("railway", 0.5), ("vercel", 0.5)],
        "browsing": [("chrome", 0.6), ("safari", 0.6), ("browser", 0.6)],
    }
    return sum(weight for needle, weight in rules.get(kind, []) if needle in haystack)


def _looks_low_signal_ui(*values: str) -> bool:
    haystack = " ".join(str(value or "") for value in values).lower()
    if not haystack.strip():
        return True
    ui_markers = (
        "privacy & security",
        "system settings",
        "search",
        "notifications",
        "users & groups",
        "menu bar",
        "displays",
        "wallpaper",
        "open system settings",
        "allow applications below",
        "settings",
    )
    return any(marker in haystack for marker in ui_markers)


def _grade_evidence(evidence: NormalizedEvidence) -> Tuple[str, str]:
    haystack = " ".join(
        [
            evidence.app,
            evidence.domain,
            evidence.title,
            evidence.document_path,
            evidence.semantic_summary,
            evidence.raw_text,
            str(evidence.metadata.get("message") or ""),
        ]
    ).lower()

    if evidence.source == "git_commit":
        return "direct_action", "high"

    if evidence.document_path and (
        evidence.app.lower() in {"cursor", "codex", "terminal", "warp", "iterm2"}
        or re.search(r"\.(rs|py|ts|tsx|js|jsx|md|json|toml|sql|swift)\b", evidence.document_path, re.IGNORECASE)
    ):
        return "direct_action", "high"

    direct_markers = (
        "commit",
        "git push",
        "git commit",
        "cargo ",
        "npm ",
        "pnpm ",
        "pytest",
        "traceback",
        "error:",
        "fixed ",
        "fix ",
        "implemented",
        "refactor",
        "schema",
        "migration",
        "build ",
        "patched ",
    )
    if any(marker in haystack for marker in direct_markers):
        return "direct_action", "high"

    if _looks_low_signal_ui(evidence.title, evidence.raw_text, evidence.semantic_summary):
        return "low_signal_ui", "low"

    if (evidence.semantic_summary or evidence.raw_text) and float(evidence.confidence or 0.0) >= 0.55:
        return "strong_support", "medium"

    if evidence.domain or evidence.title or evidence.app:
        return "passive_presence", "low"

    return "low_signal_ui", "low"


def _annotate_evidence(evidence: NormalizedEvidence) -> NormalizedEvidence:
    evidence_grade, claim_strength = _grade_evidence(evidence)
    evidence.evidence_grade = evidence_grade
    evidence.claim_strength = claim_strength
    return evidence


def _summarize_evidence_strength(evidence_rows: Sequence[NormalizedEvidence]) -> Tuple[str, str, int]:
    direct_count = sum(1 for item in evidence_rows if item.evidence_grade == "direct_action")
    strong_count = sum(1 for item in evidence_rows if item.evidence_grade == "strong_support")
    if direct_count > 0:
        claim_strength = "high" if direct_count >= 2 else "medium"
        return "direct_action", claim_strength, direct_count
    if strong_count > 0:
        return "strong_support", "medium", 0
    if any(item.evidence_grade == "passive_presence" for item in evidence_rows):
        return "passive_presence", "low", 0
    return "low_signal_ui", "low", 0


def _classify_workstream(evidence_rows: Sequence[NormalizedEvidence], calendar_overlap: bool = False) -> str:
    if calendar_overlap:
        return "meeting"
    aggregate = defaultdict(float)
    for evidence in evidence_rows:
        for kind in ("coding", "meeting", "research", "admin", "communication", "browsing"):
            aggregate[kind] += _classification_score(kind, evidence)
    best_kind, best_score = max(aggregate.items(), key=lambda item: item[1], default=("other", 0.0))
    if best_score <= 0.0:
        return "other"
    if best_kind == "browsing" and aggregate["research"] >= best_score * 0.7:
        return "research"
    if best_kind == "communication" and aggregate["admin"] >= best_score * 0.9:
        return "admin"
    return best_kind


def _pick_primary_title(evidence_rows: Sequence[NormalizedEvidence]) -> str:
    commit_titles = [e.metadata.get("message") for e in evidence_rows if e.source == "git_commit" and e.metadata.get("message")]
    if commit_titles:
        return _clip(commit_titles[0], 110)
    semantic_titles = [e.semantic_summary for e in evidence_rows if e.semantic_summary]
    if semantic_titles:
        return _clip(semantic_titles[0].split(".")[0], 110)
    file_titles = [_extract_file_label(e.document_path) for e in evidence_rows if e.document_path]
    if file_titles:
        return f"{file_titles[0]} changes"
    explicit_titles = [e.title for e in evidence_rows if e.title]
    if explicit_titles:
        return _clip(explicit_titles[0], 110)
    domains = [e.domain for e in evidence_rows if e.domain]
    if domains:
        return domains[0]
    apps = [e.app for e in evidence_rows if e.app]
    if apps:
        return f"{apps[0]} session"
    return "Workstream"


def _summarize_workstream(kind: str, evidence_rows: Sequence[NormalizedEvidence]) -> List[str]:
    apps = list(dict.fromkeys(e.app for e in evidence_rows if e.app))
    domains = list(dict.fromkeys(e.domain for e in evidence_rows if e.domain))
    snippets = list(dict.fromkeys(_clip(e.raw_text, 160) for e in evidence_rows if e.raw_text))[:3]
    files = list(dict.fromkeys(_extract_file_label(e.document_path) for e in evidence_rows if e.document_path))[:4]
    commit_messages = list(dict.fromkeys(_clip(e.metadata.get("message"), 120) for e in evidence_rows if e.source == "git_commit" and e.metadata.get("message")))[:2]
    sentences: List[str] = []
    evidence_grade, _, _ = _summarize_evidence_strength(evidence_rows)

    if evidence_grade in {"passive_presence", "low_signal_ui"}:
        target = _pick_primary_title(evidence_rows)
        sentences.append(f"You briefly checked context related to {_clip(target, 100)} rather than doing strongly evidenced work there.")
    elif kind == "meeting":
        title = _pick_primary_title(evidence_rows)
        sentences.append(f"You spent this block in meeting-related work around {_clip(title, 100)}.")
    elif kind == "coding":
        if files:
            sentences.append(f"You were coding against {', '.join(f'`{name}`' for name in files[:3])}.")
        elif commit_messages:
            sentences.append(f"You pushed code changes including {commit_messages[0]}.")
        elif apps:
            sentences.append(f"You were building/debugging in {', '.join(apps[:3])}.")
    elif kind in {"research", "browsing"}:
        browse_targets = domains[:3] or apps[:2]
        if browse_targets:
            sentences.append(f"You were researching across {', '.join(browse_targets)}.")
    elif kind in {"admin", "communication"}:
        admin_targets = domains[:3] or apps[:3]
        if admin_targets:
            sentences.append(f"You handled coordination and admin work in {', '.join(admin_targets)}.")

    if commit_messages:
        sentences.append(f"Git activity included {commit_messages[0]}.")
    elif snippets:
        sentences.append(f"Strong evidence pointed to {_clip(snippets[0], 140)}.")

    if len(snippets) > 1:
        sentences.append(f"Other evidence mentioned {_clip(snippets[1], 140)}.")
    elif domains and len(domains) > 0 and domains[0] not in " ".join(sentences):
        sentences.append(f"The main browser context was {domains[0]}.")

    return sentences[:4] or ["Evidence for this block was thin, but the day timeline clearly shows activity here."]


def _evidence_sort_key(item: NormalizedEvidence) -> Tuple[int, int]:
    return (int(item.start_ts or item.end_ts or 0), int(item.end_ts or item.start_ts or 0))


def build_recap_workstreams(
    evidence_rows: Sequence[NormalizedEvidence],
    calendar_events: Sequence[Dict[str, Any]],
) -> List[RecapWorkstream]:
    ordered = sorted([row for row in evidence_rows if row.start_ts or row.end_ts], key=_evidence_sort_key)
    if not ordered:
        return []

    clusters: List[List[NormalizedEvidence]] = []
    current: List[NormalizedEvidence] = []
    current_tokens: set[str] = set()

    def flush_current() -> None:
        nonlocal current, current_tokens
        if current:
            clusters.append(current)
        current = []
        current_tokens = set()

    for evidence in ordered:
        tokens = set(evidence.entity_tokens)
        start_ts = evidence.start_ts or evidence.end_ts
        if not current:
            current = [evidence]
            current_tokens = set(tokens)
            continue

        last = current[-1]
        last_end = last.end_ts or last.start_ts
        gap = max(0, start_ts - last_end)
        overlap = _count_overlap(current_tokens, tokens)
        sharp_change = overlap == 0 and gap > MERGE_GAP_MS
        if gap > FORCE_SPLIT_GAP_MS or sharp_change:
            flush_current()
            current = [evidence]
            current_tokens = set(tokens)
            continue

        browser_heavy = bool(evidence.domain or any(item.domain for item in current))
        if gap <= MERGE_GAP_MS or overlap >= 2 or (browser_heavy and overlap >= 1):
            current.append(evidence)
            current_tokens.update(tokens)
            continue

        flush_current()
        current = [evidence]
        current_tokens = set(tokens)

    flush_current()

    workstreams: List[RecapWorkstream] = []
    for cluster in clusters:
        start_ts = min(item.start_ts or item.end_ts for item in cluster)
        end_ts = max(item.end_ts or item.start_ts for item in cluster)
        calendar_overlap = any(
            not (end_ts < int(event.get("start_ts") or 0) or start_ts > int(event.get("end_ts") or 0))
            for event in calendar_events
        )
        kind = _classify_workstream(cluster, calendar_overlap=calendar_overlap)
        title = _pick_primary_title(cluster)
        browser_entities = [
            entity
            for item in cluster
            for entity in _normalize_browser_entity(item.domain, item.title, item.raw_text)
        ]
        flattened_entities = list(dict.fromkeys(browser_entities))
        flattened_entities.extend(item.app for item in cluster if item.app)
        flattened_entities.extend(item.domain for item in cluster if item.domain)
        supporting_entities = list(dict.fromkeys(entity for entity in flattened_entities if entity))[:8]
        confidence = max(0.1, min(1.0, sum(max(item.confidence, 0.1) for item in cluster) / max(len(cluster), 1)))
        narrative_priority = confidence + min(len(cluster), 6) * 0.08
        evidence_grade, claim_strength, direct_evidence_count = _summarize_evidence_strength(cluster)
        workstreams.append(
            RecapWorkstream(
                kind=kind,
                start_ts=start_ts,
                end_ts=end_ts,
                primary_title=title,
                supporting_entities=supporting_entities,
                source_evidence_ids=[item.evidence_id for item in cluster],
                confidence=round(confidence, 3),
                narrative_priority=round(narrative_priority, 3),
                evidence_grade=evidence_grade,
                claim_strength=claim_strength,
                direct_evidence_count=direct_evidence_count,
                sentences=_summarize_workstream(kind, cluster),
            )
        )

    workstreams.sort(key=lambda item: (item.start_ts, item.end_ts))
    if len(workstreams) <= MAX_WORKSTREAMS:
        return workstreams

    main = workstreams[: MAX_WORKSTREAMS - 1]
    leftovers = workstreams[MAX_WORKSTREAMS - 1 :]
    other_entities = list(dict.fromkeys(entity for item in leftovers for entity in item.supporting_entities))[:8]
    other_ids = [evidence_id for item in leftovers for evidence_id in item.source_evidence_ids]
    other_sentences = [
        f"Other smaller blocks included {', '.join(other_entities[:5])}." if other_entities else "There were additional lower-confidence work blocks later in the day.",
    ]
    main.append(
        RecapWorkstream(
            kind="other",
            start_ts=min(item.start_ts for item in leftovers),
            end_ts=max(item.end_ts for item in leftovers),
            primary_title="Other things",
            supporting_entities=other_entities,
            source_evidence_ids=other_ids,
            confidence=round(sum(item.confidence for item in leftovers) / max(len(leftovers), 1), 3),
            narrative_priority=0.1,
            evidence_grade="passive_presence",
            claim_strength="low",
            direct_evidence_count=0,
            sentences=other_sentences,
        )
    )
    return main


def _augment_workstreams_with_usage_hints(
    workstreams: Sequence[RecapWorkstream],
    top_apps: Sequence[Dict[str, Any]],
    top_domains: Sequence[Dict[str, Any]],
) -> List[RecapWorkstream]:
    app_hints = {
        str(item.get("app_name") or "").strip().lower(): str(item.get("app_name") or "").strip()
        for item in top_apps
        if str(item.get("app_name") or "").strip()
    }
    domain_hints = {
        str(item.get("domain") or item.get("browser_domain") or "").strip().lower(): str(item.get("domain") or item.get("browser_domain") or "").strip()
        for item in top_domains
        if str(item.get("domain") or item.get("browser_domain") or "").strip()
    }
    if not app_hints and not domain_hints:
        return list(workstreams)

    augmented: List[RecapWorkstream] = []
    for workstream in workstreams:
        normalized_entities = {entity.lower() for entity in workstream.supporting_entities}
        matched_apps = [
            label for key, label in app_hints.items()
            if key and any(key in entity or entity in key for entity in normalized_entities)
        ]
        matched_domains = [
            label for key, label in domain_hints.items()
            if key and any(key in entity or entity in key for entity in normalized_entities)
        ]
        hint_entities = list(dict.fromkeys([*matched_apps, *matched_domains]))[:3]
        if not hint_entities:
            augmented.append(workstream)
            continue

        supporting_entities = list(dict.fromkeys([*workstream.supporting_entities, *hint_entities]))[:8]
        sentences = list(workstream.sentences)
        existing_text = " ".join(sentences).lower()
        unseen_hints = [entity for entity in hint_entities if entity.lower() not in existing_text]
        if unseen_hints:
            sentences.append(
                f"The strongest tools in this block were {', '.join(unseen_hints[:3])}."
            )

        augmented.append(
            RecapWorkstream(
                kind=workstream.kind,
                start_ts=workstream.start_ts,
                end_ts=workstream.end_ts,
                primary_title=workstream.primary_title,
                supporting_entities=supporting_entities,
                source_evidence_ids=workstream.source_evidence_ids,
                confidence=workstream.confidence,
                narrative_priority=workstream.narrative_priority,
                evidence_grade=workstream.evidence_grade,
                claim_strength=workstream.claim_strength,
                direct_evidence_count=workstream.direct_evidence_count,
                sentences=sentences[:4],
            )
        )
    return augmented


def _format_time_range(start_ts: int, end_ts: int, timezone_name: Optional[str]) -> str:
    zone = _resolve_zone(timezone_name)
    start = datetime.fromtimestamp(start_ts / 1000, tz=zone)
    end = datetime.fromtimestamp(end_ts / 1000, tz=zone)
    start_label = start.strftime("%-I:%M %p")
    end_label = end.strftime("%-I:%M %p")
    if start_label == end_label:
        return start_label
    return f"{start_label} - {end_label}"


def _render_sparse_evidence_sections(bundle: Dict[str, Any]) -> List[str]:
    output: List[str] = []

    top_apps = [item for item in (bundle.get("top_apps") or []) if isinstance(item, dict)]
    if top_apps:
        output.append("**Likely focus areas**")
        for item in top_apps[:4]:
            app_name = _clip(item.get("app_name") or "Unknown app", 80)
            hours = float(item.get("hours") or 0.0)
            total_events = int(item.get("total_events") or 0)
            if hours > 0:
                output.append(f"- {app_name} ({hours:.2f} hours)")
            elif total_events > 0:
                output.append(f"- {app_name} ({total_events} activity events)")
            else:
                output.append(f"- {app_name}")
        output.append("")

    top_domains = [item for item in (bundle.get("top_domains") or []) if isinstance(item, dict)]
    if top_domains:
        output.append("**Top sites checked**")
        for item in top_domains[:4]:
            domain = _clip(item.get("domain") or "Unknown domain", 80)
            minutes = float(item.get("minutes") or 0.0)
            if minutes > 0:
                output.append(f"- {domain} ({minutes:.1f} minutes)")
            else:
                output.append(f"- {domain}")
        output.append("")

    git_commits = [item for item in (bundle.get("git_commits") or []) if isinstance(item, dict)]
    if git_commits:
        output.append("**Git activity**")
        for commit in git_commits[:4]:
            repo = _clip(commit.get("repo") or "repo", 40)
            message = _clip(commit.get("message") or "commit", 100)
            output.append(f"- {repo}: {message}")
        output.append("")

    calendar_events = [item for item in (bundle.get("calendar_events") or []) if isinstance(item, dict)]
    if calendar_events:
        output.append("**Meetings & schedule context**")
        for event in calendar_events[:4]:
            title = _clip(event.get("title") or "Untitled", 80)
            start_time = str(event.get("start_time") or "").strip()
            end_time = str(event.get("end_time") or "").strip()
            if start_time or end_time:
                output.append(f"- {start_time} - {end_time}: {title}".strip())
            else:
                output.append(f"- {title}")
        output.append("")

    screen_evidence = [item for item in (bundle.get("screen_evidence") or []) if isinstance(item, dict)]
    if not output and screen_evidence:
        output.append("**Observed activity**")
        for item in screen_evidence[:4]:
            app_name = _clip(item.get("app_name") or "Unknown app", 40)
            title = _clip(item.get("window_title") or item.get("document_path") or "", 90)
            snippet = _clip(item.get("semantic_summary") or item.get("snippet") or "", 120)
            if title:
                output.append(f"- {app_name}: {title}")
            elif snippet:
                output.append(f"- {app_name}: {snippet}")
            else:
                output.append(f"- {app_name}")
        output.append("")

    return output


def _sanitize_recap_degradation_note(note: str) -> str:
    text = str(note or "").strip()
    lowered = text.lower()
    if not text:
        return ""
    if "database disk image is malformed" in lowered:
        if lowered.startswith("context failed"):
            return "Context snapshots for that day were temporarily unavailable."
        if lowered.startswith("top apps failed"):
            return "App activity totals for that day were temporarily unavailable."
        if lowered.startswith("top domains failed"):
            return "Website activity totals for that day were temporarily unavailable."
        return "Some local recap sources were temporarily unavailable."
    if lowered.startswith("context failed:"):
        return "Context snapshots for that day were temporarily unavailable."
    if lowered.startswith("top apps failed:"):
        return "App activity totals for that day were temporarily unavailable."
    if lowered.startswith("top domains failed:"):
        return "Website activity totals for that day were temporarily unavailable."
    if lowered.startswith("calendar failed:"):
        return "Calendar context was temporarily unavailable."
    if lowered.startswith("biometrics failed:"):
        return "Biometrics data was temporarily unavailable."
    if lowered.startswith("semantic bundle failed:"):
        return "Cloud semantic retrieval was temporarily unavailable."
    return text


def render_day_recap(
    *,
    anchor_date: str,
    timezone_name: Optional[str],
    workstreams: Sequence[RecapWorkstream],
    degradation_notes: Sequence[str],
    bundle: Dict[str, Any],
) -> str:
    if not workstreams:
        note = "I found only thin evidence for that day, so this recap is low confidence."
        if degradation_notes:
            note = f"{note} {' '.join(degradation_notes[:2])}"
        output: List[str] = [f"**{anchor_date}**", "", note, ""]
        output.extend(_render_sparse_evidence_sections(bundle))
        return "\n".join(line for line in output if line is not None).strip()

    output: List[str] = [f"**{anchor_date}**", ""]
    for workstream in workstreams:
        output.append(f"**{_clip(workstream.primary_title, 100)}**")
        output.append(f"*{_format_time_range(workstream.start_ts, workstream.end_ts, timezone_name)}*")
        for sentence in workstream.sentences[:4]:
            output.append(sentence)
        output.append("")

    calendar_events = bundle.get("calendar_events") or []
    if calendar_events:
        output.append("**Meetings & schedule context**")
        for event in calendar_events[:4]:
            title = _clip(event.get("title") or "Untitled", 80)
            start_time = str(event.get("start_time") or "").strip()
            end_time = str(event.get("end_time") or "").strip()
            if start_time or end_time:
                output.append(f"- {start_time} - {end_time}: {title}".strip())
            else:
                output.append(f"- {title}")
        output.append("")

    if degradation_notes:
        output.append("**Recap quality notes**")
        for note in degradation_notes[:4]:
            output.append(f"- {note}")

    return "\n".join(line for line in output if line is not None).strip()


def _bundle_citation(evidence: NormalizedEvidence) -> Dict[str, Any]:
    return {
        "source": evidence.source,
        "timestamp": evidence.start_ts,
        "app_name": evidence.app,
        "window_title": evidence.title,
        "browser_domain": evidence.domain,
        "document_path": evidence.document_path,
        "snippet": _clip(evidence.raw_text or evidence.semantic_summary, 200),
        "confidence": evidence.confidence,
        "evidence_grade": evidence.evidence_grade,
        "claim_strength": evidence.claim_strength,
    }


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1",
        (table_name,),
    ).fetchone()
    return row is not None


def _scalar(conn: sqlite3.Connection, query: str) -> Optional[int]:
    try:
        row = conn.execute(query).fetchone()
        if not row or row[0] is None:
            return None
        return int(row[0])
    except Exception:
        return None


def _memory_health_snapshot(now_ms: int) -> Dict[str, Any]:
    path = get_local_memory_db_path_impl()
    snapshot = {
        "path": path,
        "pending_outbox": 0,
        "uploading_outbox": 0,
        "failed_outbox": 0,
    }
    if not os.path.exists(path):
        return snapshot
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
    try:
        conn.execute("PRAGMA query_only = ON")
        if _table_exists(conn, "memory_upload_outbox"):
            snapshot["pending_outbox"] = _scalar(conn, "SELECT COUNT(*) FROM memory_upload_outbox WHERE status = 'pending'") or 0
            snapshot["uploading_outbox"] = _scalar(conn, "SELECT COUNT(*) FROM memory_upload_outbox WHERE status = 'uploading'") or 0
            snapshot["failed_outbox"] = _scalar(conn, "SELECT COUNT(*) FROM memory_upload_outbox WHERE status = 'failed'") or 0
    finally:
        conn.close()
    return snapshot


def _git_commits_for_date(target_day: str) -> Dict[str, Any]:
    home = Path.home()
    candidate_dirs = [
        home / "Desktop",
        home / "Documents",
        home / "Projects",
        home / "Code",
        home / "dev",
        home / "src",
        home / "repos",
        home / "workspace",
    ]
    commits: List[Dict[str, Any]] = []
    seen_repos: set[str] = set()
    for parent in candidate_dirs:
        if not parent.exists():
            continue
        for candidate in list(parent.iterdir())[:50]:
            if not candidate.is_dir():
                continue
            git_dir = candidate / ".git"
            if not git_dir.exists():
                for sub in list(candidate.iterdir())[:20]:
                    if sub.is_dir() and (sub / ".git").exists():
                        git_dir = sub / ".git"
                        candidate = sub
                        break
                else:
                    continue
            repo_path = str(candidate.resolve())
            if repo_path in seen_repos:
                continue
            seen_repos.add(repo_path)
            try:
                result = subprocess.run(
                    [
                        "git", "log",
                        f"--since={target_day}T00:00:00",
                        f"--until={target_day}T23:59:59",
                        "--format=%H|%aI|%s",
                        "--no-merges",
                    ],
                    capture_output=True,
                    text=True,
                    cwd=repo_path,
                    timeout=3,
                )
            except Exception:
                continue
            if result.returncode != 0 or not result.stdout.strip():
                continue
            repo_name = candidate.name
            for line in result.stdout.strip().splitlines():
                parts = line.split("|", 2)
                if len(parts) < 3:
                    continue
                commits.append(
                    {
                        "repo": repo_name,
                        "hash": parts[0][:8],
                        "time": parts[1],
                        "message": parts[2],
                    }
                )
    commits.sort(key=lambda item: item.get("time") or "", reverse=False)
    return {"success": True, "date": target_day, "commits": commits[:30], "repos_scanned": len(seen_repos)}


def _git_commits_for_range(start_day: str, end_day: str) -> Dict[str, Any]:
    commits: List[Dict[str, Any]] = []
    repos_scanned = 0
    seen_hashes: set[Tuple[str, str]] = set()
    start = _parse_anchor_date(start_day)
    end = _parse_anchor_date(end_day)
    for current in _iter_days(start, end):
        payload = _git_commits_for_date(current.isoformat())
        repos_scanned = max(repos_scanned, int(payload.get("repos_scanned") or 0))
        for commit in payload.get("commits") or []:
            key = (str(commit.get("repo") or ""), str(commit.get("hash") or ""))
            if key in seen_hashes:
                continue
            seen_hashes.add(key)
            commits.append(commit)
    commits.sort(key=lambda item: item.get("time") or "", reverse=False)
    return {
        "success": True,
        "start_date": start_day,
        "end_date": end_day,
        "commits": commits[:80],
        "repos_scanned": repos_scanned,
    }


async def _with_timeout(label: str, timeout_s: float, awaitable):
    try:
        value = await asyncio.wait_for(awaitable, timeout=timeout_s)
        return value, None
    except asyncio.TimeoutError:
        return None, f"{label} timed out after {timeout_s:.0f}s."
    except Exception as exc:
        logger.warning("day_recap lane failed: %s", label, exc_info=exc)
        return None, f"{label} failed: {exc}"


def _normalize_snapshot_row(row: sqlite3.Row) -> NormalizedEvidence:
    raw_text = str(row["visible_text_raw"] or row["visible_text_norm"] or "")
    title = str(row["window_title"] or row["document_title"] or row["tab_title"] or "")
    domain = str(row["browser_domain"] or _extract_domain(row["browser_url"] or "", title, raw_text))
    semantic_summary = str(row["semantic_summary"] or "")
    evidence = NormalizedEvidence(
        evidence_id=f"context_snapshot:{row['id']}",
        source="context_snapshot",
        start_ts=int(row["ts"] or 0),
        end_ts=int(row["ts"] or 0),
        app=str(row["app_name"] or ""),
        domain=domain,
        title=title,
        document_path=str(row["document_path"] or ""),
        semantic_summary=semantic_summary,
        raw_text=raw_text,
        confidence=min(1.0, max(float(row["capture_quality"] or 0.0), float(row["ax_richness_score"] or 0.0))),
        metadata={"session_id": row["session_id"], "source_type": row["source_type"]},
    )
    evidence.entity_tokens = _normalize_tokens(
        evidence.app,
        evidence.domain,
        evidence.title,
        evidence.document_path,
        evidence.semantic_summary,
        evidence.raw_text,
    )
    return _annotate_evidence(evidence)


def _normalize_session_doc_row(row: sqlite3.Row) -> NormalizedEvidence:
    raw_text = str(row["contextual_retrieval_text"] or row["raw_visible_text"] or "")
    title = str(row["window_title"] or row["document_title"] or "")
    semantic_summary = _clip(raw_text.split(".")[0], 140)
    evidence = NormalizedEvidence(
        evidence_id=f"session_doc:{row['id']}",
        source="session_doc",
        start_ts=int(row["chunk_start_ts"] or 0),
        end_ts=int(row["chunk_end_ts"] or row["chunk_start_ts"] or 0),
        app=str(row["app_name"] or ""),
        domain=str(row["browser_domain"] or ""),
        title=title,
        document_path=str(row["document_path"] or ""),
        semantic_summary=semantic_summary,
        raw_text=raw_text,
        confidence=float(row["capture_quality"] or 0.0),
        metadata={"session_id": row["session_id"], "source_kind": row["source_kind"]},
    )
    evidence.entity_tokens = _normalize_tokens(
        evidence.app,
        evidence.domain,
        evidence.title,
        evidence.document_path,
        evidence.semantic_summary,
        evidence.raw_text,
    )
    return _annotate_evidence(evidence)


async def _fetch_context_lanes(user_id: str, start_ms: int, end_ms: int) -> Dict[str, Any]:
    snapshots: List[Dict[str, Any]] = []
    session_docs: List[Dict[str, Any]] = []
    normalized: List[NormalizedEvidence] = []
    context_max_ts = None
    session_docs_max_ts = None

    async with open_activity_connection_for_user(user_id, write=False) as conn:
        if conn is None:
            return {
                "context_snapshots": snapshots,
                "context_docs": session_docs,
                "normalized_evidence": normalized,
                "latest_context_snapshots_ts": None,
                "latest_session_retrieval_docs_ts": None,
            }
        if _table_exists(conn, "context_snapshots"):
            conn.row_factory = sqlite3.Row
            if _scalar(conn, "SELECT 1") is None:
                pass
            try:
                conn.execute("SELECT semantic_summary FROM context_snapshots LIMIT 0")
                has_semantic = True
            except Exception:
                has_semantic = False
            semantic_column = ", semantic_summary" if has_semantic else ", '' as semantic_summary"
            rows = conn.execute(
                f"""
                SELECT
                    id, session_id, ts, source_type, app_name, window_title, browser_url, browser_domain,
                    tab_title, document_title, visible_text_raw, visible_text_norm, capture_quality,
                    ax_richness_score, document_path, app_bundle_id
                    {semantic_column}
                FROM context_snapshots
                WHERE ts >= ? AND ts <= ?
                ORDER BY ts ASC
                LIMIT 320
                """,
                (start_ms, end_ms),
            ).fetchall()
            for row in rows:
                evidence = _normalize_snapshot_row(row)
                normalized.append(evidence)
                snapshots.append(
                    {
                        "id": row["id"],
                        "ts": row["ts"],
                        "app_name": row["app_name"],
                        "window_title": row["window_title"],
                        "browser_domain": row["browser_domain"],
                        "document_path": row["document_path"],
                        "semantic_summary": row["semantic_summary"],
                        "visible_text_raw": _clip(row["visible_text_raw"], 280),
                    }
                )
            context_max_ts = _scalar(conn, "SELECT MAX(ts) FROM context_snapshots")

        if _table_exists(conn, "session_retrieval_docs"):
            columns = {
                str(row["name"])
                for row in conn.execute("PRAGMA table_info(session_retrieval_docs)").fetchall()
            }
            document_path_select = "document_path" if "document_path" in columns else "'' as document_path"
            rows = conn.execute(
                f"""
                SELECT
                    id, session_id, source_kind, chunk_start_ts, chunk_end_ts, app_name, browser_domain,
                    window_title, document_title, raw_visible_text, contextual_retrieval_text, capture_quality,
                    {document_path_select}
                FROM session_retrieval_docs
                WHERE chunk_end_ts >= ? AND chunk_start_ts <= ?
                ORDER BY chunk_start_ts ASC
                LIMIT 220
                """,
                (start_ms, end_ms),
            ).fetchall()
            for row in rows:
                evidence = _normalize_session_doc_row(row)
                normalized.append(evidence)
                session_docs.append(
                    {
                        "id": row["id"],
                        "session_id": row["session_id"],
                        "chunk_start_ts": row["chunk_start_ts"],
                        "chunk_end_ts": row["chunk_end_ts"],
                        "app_name": row["app_name"],
                        "browser_domain": row["browser_domain"],
                        "window_title": row["window_title"],
                        "document_title": row["document_title"],
                        "contextual_retrieval_text": _clip(row["contextual_retrieval_text"], 320),
                        "document_path": row["document_path"],
                    }
                )
            session_docs_max_ts = _scalar(conn, "SELECT MAX(chunk_end_ts) FROM session_retrieval_docs")

    return {
        "context_snapshots": snapshots,
        "context_docs": session_docs,
        "normalized_evidence": normalized,
        "latest_context_snapshots_ts": context_max_ts,
        "latest_session_retrieval_docs_ts": session_docs_max_ts,
    }


async def _fetch_calendar_events(user_id: str, anchor_date: str, timezone_name: Optional[str]) -> List[Dict[str, Any]]:
    async with get_db_session() as session:
        result = await session.execute(
            select(ScheduledBlockDB)
            .where(ScheduledBlockDB.user_id == user_id)
            .where(ScheduledBlockDB.day == anchor_date)
            .order_by(ScheduledBlockDB.start_minutes.asc())
        )
        rows = result.scalars().all()
    events = []
    zone = _resolve_zone(timezone_name)
    for row in rows:
        start_hour = row.start_minutes // 60
        start_minute = row.start_minutes % 60
        end_hour = row.end_minutes // 60
        end_minute = row.end_minutes % 60
        start_label = datetime(2000, 1, 1, start_hour, start_minute).strftime("%-I:%M %p")
        end_label = datetime(2000, 1, 1, min(end_hour, 23), min(end_minute, 59)).strftime("%-I:%M %p")
        events.append(
            {
                "title": row.title,
                "notes": row.notes,
                "day": row.day,
                "start_minutes": row.start_minutes,
                "end_minutes": row.end_minutes,
                "start_time": start_label,
                "end_time": end_label,
                "duration_minutes": max(0, int(row.end_minutes - row.start_minutes)),
                "start_ts": int(datetime.strptime(f"{row.day} {start_hour:02d}:{start_minute:02d}", "%Y-%m-%d %H:%M").replace(tzinfo=zone).timestamp() * 1000),
                "end_ts": int(datetime.strptime(f"{row.day} {min(end_hour, 23):02d}:{min(end_minute, 59):02d}", "%Y-%m-%d %H:%M").replace(tzinfo=zone).timestamp() * 1000),
            }
        )
    return events


async def _fetch_calendar_events_for_range(
    user_id: str,
    start_date: str,
    end_date: str,
    timezone_name: Optional[str],
) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    start = _parse_anchor_date(start_date)
    end = _parse_anchor_date(end_date)
    for current in _iter_days(start, end):
        day_events = await _fetch_calendar_events(user_id, current.isoformat(), timezone_name)
        events.extend(day_events)
    events.sort(key=lambda item: int(item.get("start_ts") or 0))
    return events


def _normalize_git_commit(commit: Dict[str, Any]) -> NormalizedEvidence:
    commit_ts = int(datetime.fromisoformat(str(commit["time"]).replace("Z", "+00:00")).timestamp() * 1000)
    evidence = NormalizedEvidence(
        evidence_id=f"git_commit:{commit.get('repo')}:{commit.get('hash')}",
        source="git_commit",
        start_ts=commit_ts,
        end_ts=commit_ts,
        app="git",
        title=str(commit.get("repo") or ""),
        semantic_summary=str(commit.get("message") or ""),
        raw_text=str(commit.get("message") or ""),
        confidence=0.92,
        metadata=commit,
    )
    evidence.entity_tokens = _normalize_tokens(evidence.title, evidence.semantic_summary)
    return _annotate_evidence(evidence)


async def build_day_recap(
    *,
    user_id: str,
    query: str,
    anchor_date: str,
    timezone_name: Optional[str],
    days_back: Optional[int] = None,
) -> Dict[str, Any]:
    now_ms = int(time.time() * 1000)
    anchor = _parse_anchor_date(anchor_date)
    start_ms, end_ms = _start_end_ms(anchor, timezone_name)
    memory_health = _memory_health_snapshot(now_ms)

    context_task = _with_timeout("context", WATCHER_TIMEOUT_S, _fetch_context_lanes(user_id, start_ms, end_ms))
    apps_task = _with_timeout("top apps", WATCHER_TIMEOUT_S, get_top_apps_impl(watcher_service, user_id, anchor_date, anchor_date, limit=12))
    domains_task = _with_timeout("top domains", WATCHER_TIMEOUT_S, get_top_domains_impl(watcher_service, user_id, anchor_date, anchor_date, limit=12))
    git_task = _with_timeout("git commits", GIT_TIMEOUT_S, asyncio.to_thread(_git_commits_for_date, anchor_date))
    calendar_task = _with_timeout("calendar", CALENDAR_TIMEOUT_S, _fetch_calendar_events(user_id, anchor_date, timezone_name))
    biometrics_task = _with_timeout("biometrics", BIOMETRICS_TIMEOUT_S, biometrics_service.get_day_summary(user_id, anchor))
    semantic_task = _with_timeout(
        "semantic bundle",
        SEMANTIC_TIMEOUT_S,
        query_memory_impl(
            service=watcher_service,
            user_id=user_id,
            query=query,
            intent="broad_overview",
            days_back=max(days_back or 1, 1),
            start_date=anchor_date,
            end_date=anchor_date,
            timezone=timezone_name,
            group_by="app",
            limit=64,
        ),
    )

    (
        (context_payload, context_error),
        (apps_payload, apps_error),
        (domains_payload, domains_error),
        (git_payload, git_error),
        (calendar_payload, calendar_error),
        (biometrics_payload, biometrics_error),
        (semantic_payload, semantic_error),
    ) = await asyncio.gather(
        context_task,
        apps_task,
        domains_task,
        git_task,
        calendar_task,
        biometrics_task,
        semantic_task,
    )

    degradation_notes = [
        note
        for note in (
            _sanitize_recap_degradation_note(raw)
            for raw in [context_error, apps_error, domains_error, git_error, calendar_error, biometrics_error, semantic_error]
        )
        if note
    ]
    context_payload = context_payload or {
        "context_snapshots": [],
        "context_docs": [],
        "normalized_evidence": [],
        "latest_context_snapshots_ts": None,
        "latest_session_retrieval_docs_ts": None,
    }
    apps_payload = apps_payload or []
    domains_payload = domains_payload or []
    git_payload = git_payload or {"commits": []}
    calendar_payload = calendar_payload or []

    if biometrics_payload is not None and hasattr(biometrics_payload, "model_dump"):
        biometrics_payload = biometrics_payload.model_dump()
    elif biometrics_payload is not None and hasattr(biometrics_payload, "dict"):
        biometrics_payload = biometrics_payload.dict()

    normalized_evidence: List[NormalizedEvidence] = list(context_payload.get("normalized_evidence") or [])
    screen_evidence = []
    for snapshot in context_payload.get("context_snapshots") or []:
        screen_evidence.append(
            {
                "time": snapshot.get("ts"),
                "app_name": snapshot.get("app_name"),
                "window_title": snapshot.get("window_title"),
                "document_path": snapshot.get("document_path"),
                "semantic_summary": snapshot.get("semantic_summary"),
                "snippet": snapshot.get("visible_text_raw"),
            }
        )
    for commit in git_payload.get("commits") or []:
        try:
            normalized_evidence.append(_normalize_git_commit(commit))
        except Exception:
            continue

    semantic_citations = [
        {
            **citation,
            "evidence_grade": citation.get("evidence_grade") or "strong_support",
            "claim_strength": citation.get("claim_strength") or "medium",
        }
        for citation in (list(semantic_payload.get("citations") or []) if isinstance(semantic_payload, dict) else [])
        if isinstance(citation, dict)
    ]
    semantic_story_plan = ((semantic_payload or {}).get("semantic_truth") or {}).get("story_plan") if isinstance(semantic_payload, dict) else None
    semantic_freshness = (semantic_payload or {}).get("freshness") if isinstance(semantic_payload, dict) else {}
    semantic_stale = bool(
        semantic_freshness and int(semantic_freshness.get("embedding_lag_seconds") or 0) > 15 * 60
    )
    semantic_sparse = (
        len(semantic_citations) < 8
        or not semantic_story_plan
        or int(memory_health.get("pending_outbox") or 0) > OUTBOX_PENDING_DEGRADED
    )
    semantic_status = "healthy"
    if semantic_error:
        semantic_status = "failed"
    elif semantic_sparse or semantic_stale:
        semantic_status = "degraded"
    if semantic_status != "healthy":
        degradation_notes.append(
            "Cloud semantic retrieval was sparse or stale, so this recap leaned more heavily on local context and watcher evidence."
        )

    latest_context_ts = context_payload.get("latest_context_snapshots_ts")
    latest_session_doc_ts = context_payload.get("latest_session_retrieval_docs_ts")
    context_ready = bool((context_payload.get("context_docs") or []) or (context_payload.get("context_snapshots") or []))
    watcher_ready = bool(screen_evidence or apps_payload or domains_payload)
    calendar_ready = calendar_error is None
    can_answer = bool(context_ready or watcher_ready or git_payload.get("commits") or calendar_payload or biometrics_payload)

    workstreams = build_recap_workstreams(normalized_evidence, calendar_payload)
    workstreams = _augment_workstreams_with_usage_hints(workstreams, apps_payload, domains_payload)
    bundle = {
        "anchor_date": anchor_date,
        "timezone": timezone_name,
        "time_window": {"start_ms": start_ms, "end_ms": end_ms},
        "lane_status": {
            "context": {"status": "healthy" if context_ready else "degraded", "count": len(context_payload.get("context_docs") or []) + len(context_payload.get("context_snapshots") or [])},
            "watcher": {"status": "healthy" if watcher_ready else "degraded", "count": len(screen_evidence) + len(apps_payload) + len(domains_payload)},
            "git": {"status": "healthy" if git_error is None else "degraded", "count": len(git_payload.get("commits") or [])},
            "calendar": {"status": "healthy" if calendar_error is None else "degraded", "count": len(calendar_payload or [])},
            "biometrics": {"status": "healthy" if biometrics_error is None else "degraded", "count": 1 if biometrics_payload else 0},
            "semantic": {"status": semantic_status, "count": len(semantic_citations)},
        },
        "health_snapshot": {
            "latest_context_snapshots_ts": latest_context_ts,
            "latest_session_retrieval_docs_ts": latest_session_doc_ts,
            "pending_memory_upload_outbox": memory_health.get("pending_outbox"),
            "uploading_memory_upload_outbox": memory_health.get("uploading_outbox"),
            "failed_memory_upload_outbox": memory_health.get("failed_outbox"),
            "cloud_freshness": semantic_freshness,
        },
        "context_docs": context_payload.get("context_docs") or [],
        "context_snapshots": context_payload.get("context_snapshots") or [],
        "screen_evidence": screen_evidence,
        "top_apps": apps_payload,
        "top_domains": domains_payload,
        "git_commits": git_payload.get("commits") or [],
        "calendar_events": calendar_payload,
        "daily_biometrics": biometrics_payload,
        "semantic_candidates": semantic_citations[:64],
        "citations": [_bundle_citation(item) for item in normalized_evidence[:48]] + semantic_citations[:12],
        "degradation_notes": degradation_notes,
    }
    rendered_summary = render_day_recap(
        anchor_date=anchor_date,
        timezone_name=timezone_name,
        workstreams=workstreams,
        degradation_notes=degradation_notes,
        bundle=bundle,
    )

    workstream_dicts = [
        {
            "kind": item.kind,
            "start_ts": item.start_ts,
            "end_ts": item.end_ts,
            "primary_title": item.primary_title,
            "supporting_entities": item.supporting_entities,
            "source_evidence_ids": item.source_evidence_ids,
            "confidence": item.confidence,
            "narrative_priority": item.narrative_priority,
            "evidence_grade": item.evidence_grade,
            "claim_strength": item.claim_strength,
            "direct_evidence_count": item.direct_evidence_count,
            "sentences": item.sentences,
        }
        for item in workstreams
    ]

    degradation_reasons = list(dict.fromkeys(note for note in degradation_notes if note))
    if semantic_status != "healthy":
        degradation_reasons.append("semantic_support_degraded")
    catching_up = not semantic_error and (semantic_sparse or semantic_stale)
    overall_status = "healthy"
    if not can_answer:
        overall_status = "insufficient"
    elif catching_up:
        overall_status = "catching_up"
    elif degradation_reasons:
        overall_status = "degraded_but_usable"

    health = {
        "latest_context_snapshots_ts": latest_context_ts,
        "latest_session_retrieval_docs_ts": latest_session_doc_ts,
        "memory_upload_outbox": {
            "pending": int(memory_health.get("pending_outbox") or 0),
            "uploading": int(memory_health.get("uploading_outbox") or 0),
            "failed": int(memory_health.get("failed_outbox") or 0),
        },
        "cloud_freshness": semantic_freshness,
        "lane_readiness": {
            "context_ready": context_ready,
            "semantic_ready": semantic_status == "healthy",
            "calendar_ready": calendar_ready,
            "watcher_ready": watcher_ready,
        },
        "overall_status": overall_status,
        "can_answer_anchored_day_recap": can_answer,
        "primary_source_selected": "cloud_degraded" if semantic_status != "healthy" else "cloud_primary",
        "degradation_reasons": degradation_reasons,
    }

    return {
        "success": True,
        "query": query,
        "anchor_date": anchor_date,
        "days_back": days_back or 1,
        "rendered_summary": rendered_summary,
        "rich_activity_summary": rendered_summary,
        "calendar_style_summary": rendered_summary,
        "calendar_style_date": anchor_date,
        "bundle": bundle,
        "workstreams": workstream_dicts,
        "retrieval_debug": (semantic_payload or {}).get("retrieval_debug") if isinstance(semantic_payload, dict) else None,
        "provider_path": (semantic_payload or {}).get("provider_path") if isinstance(semantic_payload, dict) else None,
        "health": health,
        "degraded": overall_status != "healthy",
        "degradation_notes": degradation_reasons,
        "citations": bundle["citations"][:48],
        "citations_count": len(bundle["citations"][:48]),
        "retrieval_tier": "day_recap_bundle",
        "intent_resolved": "anchored_day_recap",
        "start_date": anchor_date,
        "end_date": anchor_date,
        "freshness": semantic_freshness or {"status": "unknown"},
        "confidence": {
            "level": "high" if workstreams else "low",
            "score": round(sum(item.confidence for item in workstreams) / max(len(workstreams), 1), 3) if workstreams else 0.2,
            "corroborating_chunks": len(bundle["citations"]),
        },
        "time_truth": {
            "start_ms": start_ms,
            "end_ms": end_ms,
            "timezone": timezone_name,
        },
        "semantic_truth": {
            "story_plan": semantic_story_plan,
            "mode_used": (semantic_payload or {}).get("answer_mode") if isinstance(semantic_payload, dict) else None,
            "debug": {"citation_count": len(semantic_citations)},
        },
    }


async def build_range_recap(
    *,
    user_id: str,
    query: str,
    start_date: str,
    end_date: str,
    timezone_name: Optional[str],
    days_back: Optional[int] = None,
) -> Dict[str, Any]:
    now_ms = int(time.time() * 1000)
    start_day = _parse_anchor_date(start_date)
    end_day = _parse_anchor_date(end_date)
    if end_day < start_day:
        raise ValueError("end_date must be on or after start_date")

    start_ms, end_ms = _start_end_ms_for_range(start_day, end_day, timezone_name)
    memory_health = _memory_health_snapshot(now_ms)

    context_task = _with_timeout("context", WATCHER_TIMEOUT_S, _fetch_context_lanes(user_id, start_ms, end_ms))
    apps_task = _with_timeout("top apps", WATCHER_TIMEOUT_S, get_top_apps_impl(watcher_service, user_id, start_date, end_date, limit=12))
    domains_task = _with_timeout("top domains", WATCHER_TIMEOUT_S, get_top_domains_impl(watcher_service, user_id, start_date, end_date, limit=12))
    git_task = _with_timeout("git commits", GIT_TIMEOUT_S, asyncio.to_thread(_git_commits_for_range, start_date, end_date))
    calendar_task = _with_timeout("calendar", CALENDAR_TIMEOUT_S, _fetch_calendar_events_for_range(user_id, start_date, end_date, timezone_name))
    semantic_task = _with_timeout(
        "semantic bundle",
        SEMANTIC_TIMEOUT_S,
        query_memory_impl(
            service=watcher_service,
            user_id=user_id,
            query=query,
            intent="broad_overview",
            days_back=max(days_back or 1, 1),
            start_date=start_date,
            end_date=end_date,
            timezone=timezone_name,
            group_by="app",
            limit=64,
        ),
    )

    (
        (context_payload, context_error),
        (apps_payload, apps_error),
        (domains_payload, domains_error),
        (git_payload, git_error),
        (calendar_payload, calendar_error),
        (semantic_payload, semantic_error),
    ) = await asyncio.gather(
        context_task,
        apps_task,
        domains_task,
        git_task,
        calendar_task,
        semantic_task,
    )

    degradation_notes = [
        note
        for note in (
            _sanitize_recap_degradation_note(raw)
            for raw in [context_error, apps_error, domains_error, git_error, calendar_error, semantic_error]
        )
        if note
    ]
    context_payload = context_payload or {
        "context_snapshots": [],
        "context_docs": [],
        "normalized_evidence": [],
        "latest_context_snapshots_ts": None,
        "latest_session_retrieval_docs_ts": None,
    }
    apps_payload = apps_payload or []
    domains_payload = domains_payload or []
    git_payload = git_payload or {"commits": []}
    calendar_payload = calendar_payload or []

    normalized_evidence: List[NormalizedEvidence] = list(context_payload.get("normalized_evidence") or [])
    screen_evidence = []
    for snapshot in context_payload.get("context_snapshots") or []:
        screen_evidence.append(
            {
                "time": snapshot.get("ts"),
                "app_name": snapshot.get("app_name"),
                "window_title": snapshot.get("window_title"),
                "document_path": snapshot.get("document_path"),
                "semantic_summary": snapshot.get("semantic_summary"),
                "snippet": snapshot.get("visible_text_raw"),
            }
        )
    for commit in git_payload.get("commits") or []:
        try:
            normalized_evidence.append(_normalize_git_commit(commit))
        except Exception:
            continue

    semantic_citations = [
        {
            **citation,
            "evidence_grade": citation.get("evidence_grade") or "strong_support",
            "claim_strength": citation.get("claim_strength") or "medium",
        }
        for citation in (list(semantic_payload.get("citations") or []) if isinstance(semantic_payload, dict) else [])
        if isinstance(citation, dict)
    ]
    semantic_story_plan = ((semantic_payload or {}).get("semantic_truth") or {}).get("story_plan") if isinstance(semantic_payload, dict) else None
    semantic_freshness = (semantic_payload or {}).get("freshness") if isinstance(semantic_payload, dict) else {}
    semantic_stale = bool(
        semantic_freshness and int(semantic_freshness.get("embedding_lag_seconds") or 0) > 15 * 60
    )
    semantic_sparse = (
        len(semantic_citations) < 8
        or not semantic_story_plan
        or int(memory_health.get("pending_outbox") or 0) > OUTBOX_PENDING_DEGRADED
    )
    semantic_status = "healthy"
    if semantic_error:
        semantic_status = "failed"
    elif semantic_sparse or semantic_stale:
        semantic_status = "degraded"
    if semantic_status != "healthy":
        degradation_notes.append(
            "Cloud semantic retrieval was sparse or stale, so this recap leaned more heavily on local context and watcher evidence."
        )

    latest_context_ts = context_payload.get("latest_context_snapshots_ts")
    latest_session_doc_ts = context_payload.get("latest_session_retrieval_docs_ts")
    context_ready = bool((context_payload.get("context_docs") or []) or (context_payload.get("context_snapshots") or []))
    watcher_ready = bool(screen_evidence or apps_payload or domains_payload)
    calendar_ready = calendar_error is None
    can_answer = bool(context_ready or watcher_ready or git_payload.get("commits") or calendar_payload)

    workstreams = build_recap_workstreams(normalized_evidence, calendar_payload)
    label = f"{start_date} to {end_date}" if start_date != end_date else start_date
    bundle = {
        "anchor_date": None,
        "start_date": start_date,
        "end_date": end_date,
        "timezone": timezone_name,
        "time_window": {"start_ms": start_ms, "end_ms": end_ms},
        "lane_status": {
            "context": {"status": "healthy" if context_ready else "degraded", "count": len(context_payload.get("context_docs") or []) + len(context_payload.get("context_snapshots") or [])},
            "watcher": {"status": "healthy" if watcher_ready else "degraded", "count": len(screen_evidence) + len(apps_payload) + len(domains_payload)},
            "git": {"status": "healthy" if git_error is None else "degraded", "count": len(git_payload.get("commits") or [])},
            "calendar": {"status": "healthy" if calendar_error is None else "degraded", "count": len(calendar_payload or [])},
            "semantic": {"status": semantic_status, "count": len(semantic_citations)},
        },
        "health_snapshot": {
            "latest_context_snapshots_ts": latest_context_ts,
            "latest_session_retrieval_docs_ts": latest_session_doc_ts,
            "pending_memory_upload_outbox": memory_health.get("pending_outbox"),
            "uploading_memory_upload_outbox": memory_health.get("uploading_outbox"),
            "failed_memory_upload_outbox": memory_health.get("failed_outbox"),
            "cloud_freshness": semantic_freshness,
        },
        "context_docs": context_payload.get("context_docs") or [],
        "context_snapshots": context_payload.get("context_snapshots") or [],
        "screen_evidence": screen_evidence,
        "top_apps": apps_payload,
        "top_domains": domains_payload,
        "git_commits": git_payload.get("commits") or [],
        "calendar_events": calendar_payload,
        "daily_biometrics": None,
        "semantic_candidates": semantic_citations[:64],
        "citations": [_bundle_citation(item) for item in normalized_evidence[:48]] + semantic_citations[:12],
        "degradation_notes": degradation_notes,
    }
    rendered_summary = render_day_recap(
        anchor_date=label,
        timezone_name=timezone_name,
        workstreams=workstreams,
        degradation_notes=degradation_notes,
        bundle=bundle,
    )

    workstream_dicts = [
        {
            "kind": item.kind,
            "start_ts": item.start_ts,
            "end_ts": item.end_ts,
            "primary_title": item.primary_title,
            "supporting_entities": item.supporting_entities,
            "source_evidence_ids": item.source_evidence_ids,
            "confidence": item.confidence,
            "narrative_priority": item.narrative_priority,
            "evidence_grade": item.evidence_grade,
            "claim_strength": item.claim_strength,
            "direct_evidence_count": item.direct_evidence_count,
            "sentences": item.sentences,
        }
        for item in workstreams
    ]

    degradation_reasons = list(dict.fromkeys(note for note in degradation_notes if note))
    if semantic_status != "healthy":
        degradation_reasons.append("semantic_support_degraded")
    catching_up = not semantic_error and (semantic_sparse or semantic_stale)
    overall_status = "healthy"
    if not can_answer:
        overall_status = "insufficient"
    elif catching_up:
        overall_status = "catching_up"
    elif degradation_reasons:
        overall_status = "degraded_but_usable"

    health = {
        "latest_context_snapshots_ts": latest_context_ts,
        "latest_session_retrieval_docs_ts": latest_session_doc_ts,
        "memory_upload_outbox": {
            "pending": int(memory_health.get("pending_outbox") or 0),
            "uploading": int(memory_health.get("uploading_outbox") or 0),
            "failed": int(memory_health.get("failed_outbox") or 0),
        },
        "cloud_freshness": semantic_freshness,
        "lane_readiness": {
            "context_ready": context_ready,
            "semantic_ready": semantic_status == "healthy",
            "calendar_ready": calendar_ready,
            "watcher_ready": watcher_ready,
        },
        "overall_status": overall_status,
        "can_answer_anchored_day_recap": can_answer,
        "primary_source_selected": "cloud_degraded" if semantic_status != "healthy" else "cloud_primary",
        "degradation_reasons": degradation_reasons,
    }

    return {
        "success": True,
        "query": query,
        "anchor_date": None,
        "days_back": days_back or max(1, (end_day.toordinal() - start_day.toordinal()) + 1),
        "rendered_summary": rendered_summary,
        "rich_activity_summary": rendered_summary,
        "calendar_style_summary": rendered_summary,
        "calendar_style_date": end_date,
        "bundle": bundle,
        "workstreams": workstream_dicts,
        "retrieval_debug": (semantic_payload or {}).get("retrieval_debug") if isinstance(semantic_payload, dict) else None,
        "provider_path": (semantic_payload or {}).get("provider_path") if isinstance(semantic_payload, dict) else None,
        "health": health,
        "degraded": overall_status != "healthy",
        "degradation_notes": degradation_reasons,
        "citations": bundle["citations"][:48],
        "citations_count": len(bundle["citations"][:48]),
        "retrieval_tier": "range_recap_bundle",
        "intent_resolved": "range_recap",
        "start_date": start_date,
        "end_date": end_date,
        "freshness": semantic_freshness or {"status": "unknown"},
        "confidence": {
            "level": "high" if workstreams else "low",
            "score": round(sum(item.confidence for item in workstreams) / max(len(workstreams), 1), 3) if workstreams else 0.2,
            "corroborating_chunks": len(bundle["citations"]),
        },
        "time_truth": {
            "start_ms": start_ms,
            "end_ms": end_ms,
            "timezone": timezone_name,
        },
        "semantic_truth": {
            "story_plan": semantic_story_plan,
            "mode_used": (semantic_payload or {}).get("answer_mode") if isinstance(semantic_payload, dict) else None,
            "debug": {"citation_count": len(semantic_citations)},
        },
    }
