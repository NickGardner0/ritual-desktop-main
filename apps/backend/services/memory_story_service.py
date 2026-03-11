"""Deterministic story planning for context-memory answers."""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "for",
    "from",
    "have",
    "into",
    "its",
    "just",
    "not",
    "that",
    "the",
    "their",
    "this",
    "those",
    "was",
    "were",
    "with",
}

GENERIC_TOKENS = {
    "activity",
    "app",
    "apps",
    "browser",
    "chat",
    "computer",
    "context",
    "dashboard",
    "document",
    "general",
    "google",
    "implementation",
    "main",
    "memory",
    "notes",
    "overview",
    "page",
    "project",
    "recent",
    "research",
    "ritual",
    "screen",
    "session",
    "task",
    "time",
    "todo",
    "window",
    "work",
}

KNOWN_ENTITIES = {
    "anthropic",
    "auth0",
    "calendar",
    "clerk",
    "codex",
    "cohere",
    "cursor",
    "figma",
    "github",
    "linear",
    "littlebird",
    "notion",
    "oauth",
    "openai",
    "ritual",
    "slack",
    "tailscale",
    "things",
    "turbopuffer",
}

ACTION_PATTERNS = (
    "build",
    "debug",
    "deploy",
    "draft",
    "edit",
    "fix",
    "implement",
    "investigate",
    "plan",
    "read",
    "refactor",
    "research",
    "review",
    "ship",
    "submit",
    "summarize",
    "test",
    "update",
    "write",
)

ERROR_PATTERNS = (
    "bug",
    "crash",
    "error",
    "exception",
    "failed",
    "failure",
    "fix",
    "issue",
    "mismatch",
    "regression",
    "retry",
    "stale",
    "traceback",
)

FILE_PATH_RE = re.compile(
    r"\b((?:src|app|api|apps|components|crates|docs|lib|services|tests|bin)/[A-Za-z0-9_./-]+)\b",
    re.IGNORECASE,
)
REPO_RE = re.compile(r"\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\b")
ISSUE_RE = re.compile(r"(?:pull request|pr|issue|ticket)\s*#?\d+", re.IGNORECASE)
BRANCH_RE = re.compile(r"\b(?:feature|fix|chore|release|hotfix)/[A-Za-z0-9._/-]+\b", re.IGNORECASE)
COMMAND_RE = re.compile(r"\b(?:cargo|npm|pnpm|pytest|python|uv|git)\s+[A-Za-z0-9:._/-]+(?:\s+[A-Za-z0-9:._/-]+)?")
TITLE_SPLIT_RE = re.compile(r"\s*[|:>\-]\s*")
PHRASE_SPLIT_RE = re.compile(r"\s*[|;:]\s*|(?:[?!]\s+)|(?:\.\s+)|(?:,\s+)")
TOKEN_RE = re.compile(r"[a-z0-9./:_-]{3,}")
PROPER_NOUN_RE = re.compile(r"\b(?:[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,3}|[A-Z]{2,}[A-Za-z0-9_-]*)\b")

LOW_SIGNAL_EXACT = {
    "address and search bar",
    "accessibility links",
    "add files and more",
    "ask for follow-up changes",
    "codex",
    "command palette",
    "create image",
    "chart creation",
    "chart creation - v0 by vercel",
    "dashboard",
    "dashboard | ritual",
    "dictate",
    "file explorer",
    "find in files",
    "favorites",
    "google chrome",
    "go to file",
    "google search",
    "git ls-remote https",
    "high",
    "chatgpt - google chrome - nick",
    "mcp",
    "mcp • paper",
    "notifications / x",
    "paper",
    "pin on work",
    "pinterest",
    "pinterest.com",
    "press tab then enter to ask ai mode",
    "recents",
    "refactor preview",
    "quick look",
    "reddit - the heart of the internet",
    "ritual dashboard",
    "scratchpad",
    "terminal",
    "today",
    "try the v0 ios app for building on the go",
    "v0 by vercel - build agents",
    "youtube",
    "youtube shorts",
}

LOW_SIGNAL_PATTERNS = (
    r"\baccessibility links\b",
    r"\badd files and more\b",
    r"\baddress and search bar\b",
    r"\bask for follow-up changes\b",
    r"\bdashboard\s*\|\s*ritual\b",
    r"\bdescribe what you want to build and let the agent help\b",
    r"\bdescribe what you want to build\b",
    r"\bdrop files here to add as attachments\b",
    r"\bchat history\b",
    r"\bnew chat\b",
    r"\bposted in:\b",
    r"\bsearch chats\b",
    r"\bskip to content\b",
    r"\bskip to main content\b",
    r"\bsubscribe\b",
    r"\ben please try again\b",
    r"\bfavorites\b",
    r"\bfile explorer\b",
    r"\bfind in files\b",
    r"\bgo to file\b",
    r"\bgoogle search\b",
    r"^do you want to\b",
    r"^can you write me\b",
    r"\bgetting started download the paper desktop app connect\b",
    r"\bnotifications\s*/\s*x\b",
    r"\bon this page overview\b",
    r"\bpricing roadmap build log docs sign up downloads\b",
    r"\bplease try again\b",
    r"\bpin on work\b",
    r"\bpinterest\.com\b",
    r"\bpress tab then enter to ask ai mode\b",
    r"\brefactor preview\b",
    r"\bquick look\b",
    r"\britual dashboard\b",
    r"\bso the major loop looks fixed\b",
    r"\bsleep duration\d",
    r"\bthe next practical check is\b",
    r"\bcaffeine consumption\d",
    r"\bnicotine consumption\d",
    r"\bmorning workout\d",
    r"\bwhat do you want to create\b",
    r"\bwhat i have not yet exercised is\b",
    r"\bjump to position\b",
    r"\bcomputer time\d",
    r"\bscreen time\d",
    r"\bsearch icon\b",
    r"\bskip navigation create\b",
    r"\bto view keyboard shortcuts\b",
    r"\btry the v0 ios app for building on the go\b",
    r"\bshorts\b",
    r"\bwatch later\b",
    r"\bliked videos\b",
    r"^(?:what|can|could|would|please|ideally)\b.{0,160}\b(?:implement|make|help|work on|redesign|focus|allow)\b",
    r"^\s*//",
    r"\bgoogle chrome\b.*\bgoogle chrome\b",
    r"\byoutube\b.*\byoutube\b",
)

APP_SHELL_TOKENS = {
    "chatgpt",
    "chrome",
    "codex",
    "cursor",
    "dashboard",
    "google",
    "paper",
    "quick",
    "ritual",
    "scratchpad",
    "youtube",
}

LOW_SIGNAL_BROWSER_DOMAINS = {
    "chat.openai.com",
    "chatgpt.com",
    "mail.google.com",
    "pinterest.com",
    "reddit.com",
    "www.pinterest.com",
    "twitter.com",
    "x.com",
    "youtube.com",
}

WORKLIKE_ACTIVITY_CLASSES = {"work", "admin"}
RESEARCH_ACTIVITY_CLASSES = {"research", "design_inspiration"}
PERSONAL_ACTIVITY_CLASSES = {"personal", "entertainment"}


def _compact(value: Any, limit: Optional[int] = None) -> str:
    text = " ".join(str(value or "").split()).strip()
    if limit and len(text) > limit:
        return f"{text[: max(limit - 3, 1)].rstrip()}..."
    return text


def _tokenize(value: str) -> List[str]:
    return [
        token
        for token in TOKEN_RE.findall(str(value or "").lower())
        if token not in STOP_WORDS and len(token) >= 3
    ]


def _dedupe(values: Iterable[str], *, limit: Optional[int] = None) -> List[str]:
    seen = set()
    ordered: List[str] = []
    for raw in values:
        value = _compact(raw)
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(value)
        if limit is not None and len(ordered) >= limit:
            break
    return ordered


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0.0)
    except Exception:
        return 0.0


def _is_low_signal_candidate(value: str, *, kind: str = "generic") -> bool:
    candidate = _compact(value, 240)
    if not candidate:
        return True
    normalized = candidate.lower()
    if normalized in LOW_SIGNAL_EXACT:
        return True
    if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in LOW_SIGNAL_PATTERNS):
        return True
    if kind == "document":
        return False
    if FILE_PATH_RE.search(candidate) or ISSUE_RE.search(candidate) or BRANCH_RE.search(candidate) or COMMAND_RE.search(candidate):
        return False
    tokens = _tokenize(candidate)
    if not tokens:
        return True
    non_shell_tokens = [token for token in tokens if token not in APP_SHELL_TOKENS and token not in GENERIC_TOKENS]
    if kind == "task":
        if len(tokens) < 3 and not non_shell_tokens:
            return True
        if len(tokens) < 4 and not any(
            re.search(rf"\b{re.escape(action)}(?:ed|ing|s)?\b", normalized)
            for action in ACTION_PATTERNS
        ) and not non_shell_tokens:
            return True
        if normalized.startswith("do you want to") or normalized.startswith("can you write me"):
            return True
        if re.match(r"^(what['’]s the best|what is the best|trying to find|best online)\b", normalized):
            return True
    if kind == "title":
        if len(tokens) < 3 and len(non_shell_tokens) < 1:
            return True
        if len(non_shell_tokens) == 0:
            return True
    if len(non_shell_tokens) == 0 and len(tokens) <= 4:
        return True
    return False


def _candidate_specificity_score(value: str, *, kind: str = "generic") -> int:
    candidate = _compact(value, 240)
    if not candidate:
        return -10
    score = 0
    if FILE_PATH_RE.search(candidate):
        score += 5
    if COMMAND_RE.search(candidate):
        score += 4
    if ISSUE_RE.search(candidate) or BRANCH_RE.search(candidate):
        score += 3
    if re.search(r"\b(redesign|implement|route|context memory|activity breakdown|sparkline|parity|watcher|accessibility|chart)\b", candidate, re.IGNORECASE):
        score += 3
    if any(re.search(rf"\b{re.escape(action)}(?:ed|ing|s)?\b", candidate, re.IGNORECASE) for action in ACTION_PATTERNS):
        score += 2
    tokens = _tokenize(candidate)
    non_shell_tokens = [token for token in tokens if token not in APP_SHELL_TOKENS and token not in GENERIC_TOKENS]
    score += min(3, len(non_shell_tokens))
    if len(tokens) >= 6:
        score += 1
    if kind == "document" and ("/" in candidate or "." in candidate):
        score += 2
    if kind == "task":
        score += 1
        if COMMAND_RE.search(candidate):
            score -= 2
        if normalized := candidate.lower():
            if normalized.startswith("do you want to") or normalized.startswith("can you write me"):
                score -= 3
            if re.match(r"^(what['’]s the best|what is the best|trying to find|best online)\b", normalized):
                score -= 2
    if _is_low_signal_candidate(candidate, kind=kind):
        score -= 6
    return score


def _normalize_story_snippet(value: str) -> str:
    text = _compact(value, 400)
    if not text:
        return ""
    if "|" not in text:
        return text

    kept: List[str] = []
    for segment in (part.strip() for part in text.split("|")):
        candidate = _compact(segment, 180)
        if len(candidate) < 4:
            continue
        if _is_low_signal_candidate(candidate, kind="task"):
            continue
        if _candidate_specificity_score(candidate, kind="task") <= 0:
            continue
        kept.append(candidate)

    filtered = _dedupe(kept, limit=6)
    if filtered:
        return " | ".join(filtered)
    return ""


def _rank_distinct_candidates(
    values: Sequence[str],
    *,
    kind: str,
    limit: int,
) -> List[str]:
    scored: List[Tuple[int, str]] = []
    for raw in _dedupe(values, limit=32):
        candidate = _compact(raw, 180)
        if not candidate or _is_low_signal_candidate(candidate, kind=kind):
            continue
        score = _candidate_specificity_score(candidate, kind=kind)
        if score <= 0:
            continue
        scored.append((score, candidate))
    return [
        candidate
        for _score, candidate in sorted(
            scored,
            key=lambda row: (-row[0], len(row[1]), row[1]),
        )[:limit]
    ]


def _extract_specific_task_phrases(values: Sequence[str], limit: int = 8) -> List[str]:
    counts: Dict[str, int] = {}

    def _score_phrase(phrase: str) -> int:
        score = 0
        if FILE_PATH_RE.search(phrase):
            score += 4
        if COMMAND_RE.search(phrase):
            score += 3
        if ISSUE_RE.search(phrase) or BRANCH_RE.search(phrase):
            score += 2
        if re.search(r"\b(auth|embedding|hybrid|ingest|landing page|oauth|query|resume|search|session|vector)\b", phrase, re.IGNORECASE):
            score += 2
        if len(phrase.split()) >= 3:
            score += 1
        return score

    for value in values:
        normalized = _compact(value)
        if not normalized:
            continue
        for phrase in PHRASE_SPLIT_RE.split(normalized):
            candidate = _compact(phrase, 160)
            if len(candidate) < 10 or len(candidate) > 160:
                continue
            if _is_low_signal_candidate(candidate, kind="task"):
                continue
            tokens = _tokenize(candidate)
            if len(tokens) < 2:
                continue
            if all(token in GENERIC_TOKENS for token in tokens):
                continue
            counts[candidate] = counts.get(candidate, 0) + _score_phrase(candidate)

    return [
        phrase
        for phrase, _score in sorted(
            counts.items(),
            key=lambda row: (-(int(row[1]) + _candidate_specificity_score(row[0], kind="task")), row[0]),
        )[:limit]
    ]


def _extract_artifact_refs(values: Sequence[str]) -> List[str]:
    artifacts: List[str] = []
    for value in values:
        text = str(value or "")
        artifacts.extend(FILE_PATH_RE.findall(text))
        artifacts.extend(REPO_RE.findall(text))
        artifacts.extend(ISSUE_RE.findall(text))
        artifacts.extend(BRANCH_RE.findall(text))
        artifacts.extend(COMMAND_RE.findall(text))
    return _dedupe(artifacts, limit=12)


def _extract_action_refs(values: Sequence[str]) -> List[str]:
    actions: List[str] = []
    haystack = " ".join(str(value or "") for value in values).lower()
    for action in ACTION_PATTERNS:
        if re.search(rf"\b{re.escape(action)}(?:ed|ing|s)?\b", haystack):
            actions.append(action)
    return actions[:8]


def _extract_error_refs(values: Sequence[str]) -> List[str]:
    errors: List[str] = []
    haystack = " ".join(str(value or "") for value in values).lower()
    for word in ERROR_PATTERNS:
        if re.search(rf"\b{re.escape(word)}\b", haystack):
            errors.append(word)
    return errors[:8]


def _extract_title_candidates(values: Sequence[str]) -> List[str]:
    candidates: List[str] = []
    for value in values:
        normalized = _compact(value)
        if not normalized:
            continue
        for part in TITLE_SPLIT_RE.split(normalized):
            candidate = _compact(part, 120)
            if len(candidate) < 5:
                continue
            if _is_low_signal_candidate(candidate, kind="title"):
                continue
            tokens = _tokenize(candidate)
            if not tokens or all(token in GENERIC_TOKENS for token in tokens):
                continue
            candidates.append(candidate)
    ordered = sorted(
        _dedupe(candidates, limit=12),
        key=lambda candidate: (-_candidate_specificity_score(candidate, kind="title"), candidate),
    )
    return ordered[:6]


def _extract_entity_candidates(values: Sequence[str]) -> List[str]:
    entities: List[str] = []
    for value in values:
        text = str(value or "")
        for match in PROPER_NOUN_RE.findall(text):
            candidate = _compact(match, 80)
            token = candidate.lower()
            if len(candidate) < 3:
                continue
            if token in STOP_WORDS:
                continue
            entities.append(candidate)
        for token in _tokenize(text):
            if token in KNOWN_ENTITIES:
                entities.append(token.title() if token != "oauth" else "OAuth")
    return _dedupe(entities, limit=10)


def _basenameish(value: str) -> str:
    text = _compact(value, 180)
    if not text:
        return ""
    normalized = text.rstrip("/").split("/")[-1].split("\\")[-1].strip()
    return _compact(normalized, 120)


def _extract_document_refs(
    *,
    window_title: str,
    document_title: str,
    browser_domain: str,
    artifact_refs: Sequence[str],
) -> List[str]:
    refs: List[str] = []
    if document_title:
        if not _is_low_signal_candidate(document_title, kind="document"):
            refs.append(document_title)
    if window_title and window_title != document_title:
        if not _is_low_signal_candidate(window_title, kind="document"):
            refs.append(window_title)
    for artifact in artifact_refs:
        basename = _basenameish(artifact)
        if basename:
            refs.append(basename)
    if browser_domain and document_title:
        refs.append(f"{browser_domain}: {document_title}")
    ordered = sorted(
        [ref for ref in _dedupe(refs, limit=12) if not _is_low_signal_candidate(ref, kind="document")],
        key=lambda candidate: (-_candidate_specificity_score(candidate, kind="document"), candidate),
    )
    return ordered[:8]


def build_query_semantic_profile(query: str) -> Dict[str, Any]:
    normalized_query = _compact(query, 240)
    task_phrases = _extract_specific_task_phrases([normalized_query], 6)
    artifact_refs = _extract_artifact_refs([normalized_query])
    title_candidates = _extract_title_candidates([normalized_query])
    entity_refs = _extract_entity_candidates([normalized_query] + list(task_phrases) + list(title_candidates))
    document_refs = _extract_document_refs(
        window_title=normalized_query,
        document_title=normalized_query,
        browser_domain="",
        artifact_refs=artifact_refs,
    )
    return {
        "query": normalized_query,
        "tokens": _tokenize(normalized_query),
        "task_phrases": task_phrases,
        "artifact_refs": artifact_refs,
        "entity_refs": entity_refs,
        "document_refs": _dedupe(document_refs + artifact_refs + title_candidates, limit=10),
    }


def detect_story_renderer_kind(query: str, intent: str) -> str:
    normalized = str(query or "").lower()
    if intent == "time_spent" or "where did my time go" in normalized or "time breakdown" in normalized:
        return "time_breakdown"
    if any(
        phrase in normalized
        for phrase in (
            "what happened in ",
            "what did i do in ",
            "what was i doing in ",
            "in cursor",
            "in codex",
            "in slack",
            "in terminal",
        )
    ):
        return "app_drilldown"
    if any(phrase in normalized for phrase in ("this morning", "this afternoon", "this evening", "tonight")):
        return "daypart_overview"
    if intent == "semantic_lookup":
        return "topic_lookup"
    return "broad_overview"


def _infer_semantic_kind(app_name: str, values: Sequence[str]) -> str:
    haystack = f"{app_name} {' '.join(str(value or '') for value in values)}".lower()
    if any(token in haystack for token in ("things", "todo", "planning", "calendar", "schedule", "inbox", "notion")):
        return "planning"
    if any(token in haystack for token in ("slack", "mail", "meeting", "zoom", "calendar invite")):
        return "communication"
    if any(token in haystack for token in ("docs", "article", "documentation", "readme", "reference", "guide", "anthropic")):
        return "research"
    if any(token in haystack for token in ("cursor", "codex", "terminal", "vscode", "github", "repo", "pull request", "pytest", "cargo", "npm")):
        return "implementation"
    if any(token in haystack for token in ("figma", "design", "css", "ui", "ux")):
        return "design"
    return "general"


def _classify_activity(
    *,
    app_name: str,
    browser_domain: str,
    semantic_kind: str,
    values: Sequence[str],
    artifact_refs: Sequence[str],
) -> str:
    haystack = " ".join(str(value or "") for value in values).lower()
    domain = str(browser_domain or "").strip().lower()
    app = str(app_name or "").strip().lower()

    work_markers = (
        "activity breakdown",
        "auth",
        "clerk",
        "component",
        "contribution graph",
        "context memory",
        "dashboard",
        "design system",
        "github",
        "kanban",
        "landing page",
        "mcp",
        "paper",
        "repo",
        "ritual",
        "sparkline",
        "tailwind",
        "v0",
    )
    personal_markers = (
        "appointment",
        "body/brain",
        "body brain",
        "glycine",
        "health and wearable data",
        "insurance",
        "labcorp",
        "netflix",
        "playlist",
        "quantifiedself",
        "r/quantifiedself",
        "sportsbook",
        "watch later",
        "wearable",
        "youtube shorts",
    )
    inspiration_markers = (
        "design inspiration",
        "dribbble",
        "mobbin",
        "pinterest",
        "ui inspiration",
        "visual reference",
    )

    if domain in {"youtube.com", "netflix.com", "open.spotify.com"} or any(marker in haystack for marker in personal_markers):
        return "entertainment"
    if domain in {"mail.google.com", "calendar.google.com", "appstoreconnect.apple.com"}:
        return "admin"
    if domain in {"pinterest.com", "www.pinterest.com", "mobbin.com", "dribbble.com", "behance.net"} or any(
        marker in haystack for marker in inspiration_markers
    ):
        return "design_inspiration"
    if semantic_kind in {"implementation", "design"} and (
        artifact_refs
        or any(marker in haystack for marker in work_markers)
        or app in {"codex", "cursor", "finder", "terminal", "iterm2", "warp"}
    ):
        return "work"
    if semantic_kind == "planning" or app in {"things 3", "things", "calendar", "mail"}:
        return "admin"
    if semantic_kind == "research" or domain in {"anthropic.com", "docs.rs", "github.com", "paper.design", "reddit.com", "www.reddit.com"}:
        if domain in {"reddit.com", "www.reddit.com"} and not any(marker in haystack for marker in work_markers):
            return "personal"
        return "research"
    if semantic_kind == "communication":
        return "admin"
    if app in {"codex", "cursor", "finder", "terminal", "iterm2", "warp"}:
        return "work"
    if domain in {"x.com", "twitter.com", "reddit.com", "www.reddit.com"} and not any(
        marker in haystack for marker in work_markers
    ):
        return "personal"
    if any(marker in haystack for marker in work_markers):
        return "work"
    if any(marker in haystack for marker in personal_markers):
        return "personal"
    if app in {"perplexity", "google chrome", "chrome"} and not artifact_refs:
        return "research" if semantic_kind in {"research", "design"} else "personal"
    return "research" if semantic_kind in {"general", "research"} and domain else "work"


def _extract_parent_context(value: str) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    if text.lower().startswith("context:"):
        text = text[len("Context:") :].strip()
    if "|" in text:
        text = text.split("|", 1)[0].strip()
    return _compact(text, 220)


def enrich_story_evidence(item: Dict[str, Any]) -> Dict[str, Any]:
    app_name = _compact(item.get("app_name") or "Unknown", 80) or "Unknown"
    window_title = _compact(item.get("window_title"), 140)
    document_title = _compact(item.get("document_title"), 140)
    browser_domain = _compact(item.get("browser_domain"), 80)
    parent_context = _extract_parent_context(
        item.get("parent_context")
        or item.get("contextual_retrieval_text")
        or ""
    )
    snippet = _normalize_story_snippet(item.get("snippet") or item.get("ocr_text") or "")
    source_values = [parent_context, window_title, document_title, browser_domain, snippet]
    semantic_kind = _infer_semantic_kind(app_name, source_values)
    task_phrases = _extract_specific_task_phrases(source_values, 6)
    artifact_refs = _extract_artifact_refs(source_values)
    document_refs = _extract_document_refs(
        window_title=window_title,
        document_title=document_title,
        browser_domain=browser_domain,
        artifact_refs=artifact_refs,
    )
    action_refs = _extract_action_refs(source_values)
    error_refs = _extract_error_refs(source_values)
    title_candidates = _extract_title_candidates([window_title, document_title, snippet])
    project_refs = _dedupe(
        _extract_entity_candidates([window_title, document_title] + task_phrases)
        + [title for title in title_candidates if len(title.split()) <= 6],
        limit=8,
    )
    topic_refs = _dedupe(
        [
            token
            for token, count in Counter(_tokenize(" ".join(source_values))).items()
            if count >= 2 and token not in GENERIC_TOKENS
        ],
        limit=8,
    )
    activity_class = _classify_activity(
        app_name=app_name,
        browser_domain=browser_domain,
        semantic_kind=semantic_kind,
        values=source_values,
        artifact_refs=artifact_refs,
    )
    confidence = 0.35
    if semantic_kind != "general":
        confidence += 0.1
    if task_phrases:
        confidence += 0.2
    if artifact_refs:
        confidence += 0.15
    if project_refs:
        confidence += 0.1
    if error_refs:
        confidence += 0.05

    enriched = dict(item)
    enriched.update(
        {
            "evidence_id": item.get("evidence_id")
            or f"e:{item.get('session_key') or app_name}:{_safe_int(item.get('timestamp'))}",
            "semantic_kind": semantic_kind,
            "task_phrases": task_phrases,
            "artifact_refs": artifact_refs,
            "document_refs": document_refs,
            "project_refs": project_refs,
            "action_refs": action_refs,
            "error_refs": error_refs,
            "topic_refs": topic_refs,
            "title_candidates": title_candidates,
            "parent_context": parent_context,
            "activity_class": activity_class,
            "confidence": round(min(confidence, 0.98), 3),
        }
    )
    return enriched


def _work_item_seed(item: Dict[str, Any]) -> str:
    task_candidates = sorted(
        list(item.get("task_phrases") or []),
        key=lambda phrase: _candidate_specificity_score(phrase, kind="task"),
        reverse=True,
    )
    for phrase in task_candidates:
        if len(_tokenize(phrase)) >= 2 and not _is_low_signal_candidate(phrase, kind="task"):
            return phrase
    for document in item.get("document_refs") or []:
        if len(_tokenize(document)) >= 1 and not _is_low_signal_candidate(document, kind="document"):
            return document
    for artifact in item.get("artifact_refs") or []:
        label = _basenameish(artifact)
        if len(_tokenize(label)) >= 1 and not _is_low_signal_candidate(label, kind="document"):
            return label
    for candidate in item.get("title_candidates") or []:
        if len(_tokenize(candidate)) >= 2 and not _is_low_signal_candidate(candidate, kind="title"):
            return candidate
    for project in item.get("project_refs") or []:
        if len(_tokenize(project)) >= 1:
            return project
    app_name = _compact(item.get("app_name") or "General", 60) or "General"
    kind = str(item.get("semantic_kind") or "general").replace("_", " ")
    return f"{app_name} {kind} work"


def _choose_work_item_title(work_item: Dict[str, Any]) -> str:
    candidates: List[Tuple[int, str]] = []
    for task in work_item.get("specific_tasks") or []:
        candidates.append((_candidate_specificity_score(task, kind="task") + 3, task))
    for document in work_item.get("document_refs") or []:
        candidates.append((_candidate_specificity_score(document, kind="document") + 2, document))
    for artifact in work_item.get("artifact_refs") or []:
        label = _basenameish(artifact)
        if label:
            candidates.append((_candidate_specificity_score(label, kind="document") + 1, label))
    for title in work_item.get("title_candidates") or []:
        candidates.append((_candidate_specificity_score(title, kind="title"), title))
    for project in work_item.get("project_refs") or []:
        candidates.append((_candidate_specificity_score(project, kind="generic"), project))

    for _score, candidate in sorted(candidates, key=lambda row: (-row[0], row[1])):
        if candidate and not _is_low_signal_candidate(candidate, kind="title"):
            return candidate
    return _story_kind_title(str(work_item.get("story_kind") or "general"))


def _normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _item_similarity(existing: Dict[str, Any], item: Dict[str, Any]) -> float:
    existing_projects = set(value.lower() for value in existing.get("project_refs") or [])
    item_projects = set(value.lower() for value in item.get("project_refs") or [])
    existing_artifacts = set(value.lower() for value in existing.get("artifact_refs") or [])
    item_artifacts = set(value.lower() for value in item.get("artifact_refs") or [])
    existing_documents = set(_normalized_key(value) for value in existing.get("document_refs") or [])
    item_documents = set(_normalized_key(value) for value in item.get("document_refs") or [])
    existing_tasks = set(_normalized_key(value) for value in existing.get("task_phrases") or [])
    item_tasks = set(_normalized_key(value) for value in item.get("task_phrases") or [])
    overlap = 0.0
    if existing_projects & item_projects:
        overlap += 1.2
    if existing_artifacts & item_artifacts:
        overlap += 1.0
    if existing_documents & item_documents:
        overlap += 0.9
    if existing_tasks & item_tasks:
        overlap += 0.8
    if _normalized_key(existing.get("seed_title")) == _normalized_key(item.get("seed_title")):
        overlap += 1.2
    if str(existing.get("semantic_kind")) == str(item.get("semantic_kind")):
        overlap += 0.25
    if str(existing.get("primary_app")) == str(item.get("app_name")):
        overlap += 0.15
    existing_domains = set(value.lower() for value in existing.get("browser_domains") or [])
    item_domains = set(value.lower() for value in item.get("browser_domains") or [])
    existing_browser_only = str(existing.get("primary_app") or "").lower() == "google chrome" and len(existing.get("apps") or []) == 1
    item_browser_only = str(item.get("app_name") or "").lower() == "google chrome"
    has_real_overlap = bool(
        (existing_projects & item_projects)
        or (existing_artifacts & item_artifacts)
        or (existing_documents & item_documents)
        or (existing_tasks & item_tasks)
    )
    if existing_domains & item_domains:
        overlap += 0.2
    if existing_browser_only and item_browser_only and not has_real_overlap:
        overlap -= 0.55
        if existing_domains and item_domains and not (existing_domains & item_domains):
            overlap -= 0.25
    try:
        gap_ms = abs(_safe_int(item.get("timestamp")) - _safe_int(existing.get("end_ts")))
    except Exception:
        gap_ms = 0
    if gap_ms <= 45 * 60 * 1000:
        overlap += 0.2
    return overlap


def _story_kind_title(story_kind: str) -> str:
    mapping = {
        "communication": "Communication and coordination",
        "design": "Design and interface work",
        "general": "General workstream",
        "implementation": "Implementation and code changes",
        "planning": "Planning and task management",
        "research": "Research and documentation review",
    }
    return mapping.get(story_kind, story_kind.replace("_", " ").title())


def _build_entities(enriched_items: Sequence[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    counts: Counter[str] = Counter()
    labels: Dict[str, str] = {}
    first_seen: Dict[str, int] = {}
    last_seen: Dict[str, int] = {}
    for item in enriched_items:
        ts = _safe_int(item.get("timestamp"))
        for candidate in item.get("project_refs") or []:
            key = _normalized_key(candidate)
            if not key:
                continue
            counts[key] += 1
            labels.setdefault(key, candidate)
            if key not in first_seen or ts < first_seen[key]:
                first_seen[key] = ts
            if key not in last_seen or ts > last_seen[key]:
                last_seen[key] = ts

    entities: List[Dict[str, Any]] = []
    entity_index: Dict[str, int] = {}
    for ordinal, (key, count) in enumerate(counts.most_common(12), start=1):
        if count < 2 and key not in KNOWN_ENTITIES:
            continue
        entity_id = ordinal
        entity_index[key] = entity_id
        entities.append(
            {
                "id": entity_id,
                "entity_type": "project",
                "canonical_name": labels.get(key) or key,
                "normalized_name": key,
                "first_seen_ts": first_seen.get(key),
                "last_seen_ts": last_seen.get(key),
                "salience": round(min(1.0, 0.2 + count * 0.12), 3),
                "aliases": [labels.get(key) or key],
            }
        )

    return entities, entity_index


def _build_document_items(
    enriched_items: Sequence[Dict[str, Any]],
    work_items: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}
    for item in enriched_items:
        refs = list(item.get("document_refs") or [])
        if not refs:
            continue
        ts = _safe_int(item.get("timestamp"))
        for ref in refs[:3]:
            label = _compact(ref, 140)
            key = _normalized_key(label)
            if len(key) < 4 or key in GENERIC_TOKENS:
                continue
            current = grouped.setdefault(
                key,
                {
                    "label": label,
                    "normalized_label": key,
                    "evidence_ids": [],
                    "artifact_refs": [],
                    "apps": [],
                    "browser_domains": [],
                    "parent_contexts": [],
                    "first_seen_ts": ts,
                    "last_seen_ts": ts,
                    "evidence_count": 0,
                },
            )
            current["label"] = current.get("label") or label
            current["evidence_count"] += 1
            current["evidence_ids"] = _dedupe(list(current.get("evidence_ids") or []) + [item.get("evidence_id")], limit=10)
            current["artifact_refs"] = _dedupe(list(current.get("artifact_refs") or []) + list(item.get("artifact_refs") or []), limit=8)
            current["apps"] = _dedupe(list(current.get("apps") or []) + [str(item.get("app_name") or "Unknown")], limit=6)
            if item.get("parent_context"):
                current["parent_contexts"] = _dedupe(
                    list(current.get("parent_contexts") or []) + [str(item.get("parent_context"))],
                    limit=4,
                )
            if item.get("browser_domain"):
                current["browser_domains"] = _dedupe(list(current.get("browser_domains") or []) + [str(item.get("browser_domain"))], limit=4)
            current["first_seen_ts"] = min(_safe_int(current.get("first_seen_ts")), ts or _safe_int(current.get("first_seen_ts")))
            current["last_seen_ts"] = max(_safe_int(current.get("last_seen_ts")), ts)

    document_items: List[Dict[str, Any]] = []
    for index, item in enumerate(
        sorted(
            grouped.values(),
            key=lambda row: (int(row.get("evidence_count") or 0), int(row.get("last_seen_ts") or 0)),
            reverse=True,
        )[:12],
        start=1,
    ):
        normalized_label = str(item.get("normalized_label") or "")
        related_work_item_ids = [
            int(work_item.get("id") or 0)
            for work_item in work_items
            if normalized_label
            and (
                normalized_label in {_normalized_key(value) for value in work_item.get("artifact_refs") or []}
                or normalized_label in {_normalized_key(value) for value in work_item.get("window_titles") or []}
                or normalized_label in {_normalized_key(value) for value in work_item.get("specific_tasks") or []}
            )
        ]
        document_items.append(
            {
                "id": index,
                "label": item.get("label"),
                "normalized_label": normalized_label,
                "evidence_count": int(item.get("evidence_count") or 0),
                "apps": item.get("apps") or [],
                "browser_domains": item.get("browser_domains") or [],
                "artifact_refs": item.get("artifact_refs") or [],
                "parent_contexts": item.get("parent_contexts") or [],
                "supporting_evidence_ids": item.get("evidence_ids") or [],
                "first_seen_ts": item.get("first_seen_ts"),
                "last_seen_ts": item.get("last_seen_ts"),
                "related_work_item_ids": [work_item_id for work_item_id in related_work_item_ids if work_item_id > 0][:4],
            }
        )
    return document_items


def _estimate_duration_ms(work_item: Dict[str, Any]) -> int:
    span_ms = max(0, _safe_int(work_item.get("end_ts")) - _safe_int(work_item.get("start_ts")))
    evidence_based = int(work_item.get("evidence_count") or 0) * 120_000
    return max(span_ms, evidence_based)


def _score_work_item(work_item: Dict[str, Any], execution_heavy_exists: bool) -> float:
    duration_ms = _estimate_duration_ms(work_item)
    duration_score = min(4.0, duration_ms / (1000.0 * 60.0 * 60.0))
    repetition_score = max(0.0, len(work_item.get("session_keys") or []) - 1) * 0.6
    artifact_score = min(2.0, len(work_item.get("artifact_refs") or []) * 0.35)
    task_score = min(2.0, len(work_item.get("specific_tasks") or []) * 0.3)
    continuity_score = max(0.0, len(work_item.get("apps") or []) - 1) * 0.45
    novelty_score = 0.6 if work_item.get("error_refs") else 0.0
    if any(action in {"submit", "ship", "deploy"} for action in (work_item.get("action_refs") or [])):
        novelty_score += 0.4
    planning_penalty = 0.9 if execution_heavy_exists and work_item.get("story_kind") == "planning" else 0.0
    generic_penalty = 0.8 if not work_item.get("specific_tasks") and not work_item.get("artifact_refs") else 0.0
    browser_domains = {str(value or "").strip().lower() for value in (work_item.get("browser_domains") or []) if str(value or "").strip()}
    primary_app = str(work_item.get("primary_app") or "").strip().lower()
    browser_only_penalty = 0.0
    if primary_app == "google chrome" and len(work_item.get("apps") or []) == 1:
        if browser_domains & LOW_SIGNAL_BROWSER_DOMAINS:
            browser_only_penalty += 2.6
        elif not work_item.get("artifact_refs") and work_item.get("story_kind") == "general":
            browser_only_penalty += 0.6
    low_signal_title_penalty = 0.0
    if _is_low_signal_candidate(str(work_item.get("title") or work_item.get("seed_title") or ""), kind="title"):
        low_signal_title_penalty += 0.9
    activity_class = str(work_item.get("activity_class") or "")
    activity_bonus = 0.0
    if activity_class in WORKLIKE_ACTIVITY_CLASSES:
        activity_bonus += 0.7
    elif activity_class in RESEARCH_ACTIVITY_CLASSES:
        activity_bonus += 0.15
    elif activity_class == "personal":
        activity_bonus -= 1.1
    elif activity_class == "entertainment":
        activity_bonus -= 2.0
    return round(
        duration_score
        + repetition_score
        + artifact_score
        + task_score
        + continuity_score
        + novelty_score
        + activity_bonus
        - planning_penalty
        - generic_penalty,
        3,
    ) - round(browser_only_penalty + low_signal_title_penalty, 3)


def _is_low_signal_browser_work_item(work_item: Dict[str, Any]) -> bool:
    browser_domains = {
        str(value or "").strip().lower()
        for value in (work_item.get("browser_domains") or [])
        if str(value or "").strip()
    }
    primary_app = str(work_item.get("primary_app") or "").strip().lower()
    if primary_app != "google chrome" or len(work_item.get("apps") or []) != 1:
        return False
    if browser_domains & {"youtube.com", "pinterest.com", "www.pinterest.com"}:
        return True
    if browser_domains & LOW_SIGNAL_BROWSER_DOMAINS and not work_item.get("artifact_refs"):
        return True
    return False


def _segment_label_for_work_item(work_item: Dict[str, Any], *, is_first: bool, is_last: bool) -> str:
    story_kind = str(work_item.get("story_kind") or "general")
    start_ts = _safe_int(work_item.get("start_ts"))
    hour = datetime.fromtimestamp(start_ts / 1000).hour if start_ts > 0 else 12
    if story_kind == "planning":
        return "planning"
    if story_kind == "research":
        return "research"
    if story_kind == "communication":
        return "communication"
    if is_last and hour >= 16:
        return "wrap_up"
    if is_first and hour < 10 and (len(work_item.get("specific_tasks") or []) <= 1):
        return "setup"
    return "main_work_block"


def _build_temporal_segments(work_items: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    ordered = sorted(work_items, key=lambda item: (_safe_int(item.get("start_ts")), -float(item.get("score_main_event") or 0.0)))
    segments: List[Dict[str, Any]] = []
    for index, work_item in enumerate(ordered):
        label = _segment_label_for_work_item(
            work_item,
            is_first=index == 0,
            is_last=index == len(ordered) - 1,
        )
        if segments:
            previous = segments[-1]
            gap_ms = _safe_int(work_item.get("start_ts")) - _safe_int(previous.get("end_ts"))
            if previous.get("segment_type") == label and gap_ms <= 45 * 60 * 1000:
                previous["end_ts"] = max(_safe_int(previous.get("end_ts")), _safe_int(work_item.get("end_ts")))
                previous["work_item_ids"].append(work_item["id"])
                previous["apps"] = _dedupe(previous["apps"] + list(work_item.get("apps") or []), limit=8)
                previous["tasks"] = _dedupe(previous["tasks"] + list(work_item.get("specific_tasks") or []), limit=8)
                previous["evidence_count"] += int(work_item.get("evidence_count") or 0)
                continue

        segments.append(
            {
                "id": len(segments) + 1,
                "segment_type": label,
                "start_ts": _safe_int(work_item.get("start_ts")),
                "end_ts": _safe_int(work_item.get("end_ts")),
                "work_item_ids": [work_item["id"]],
                "apps": list(work_item.get("apps") or []),
                "tasks": list(work_item.get("specific_tasks") or [])[:5],
                "evidence_count": int(work_item.get("evidence_count") or 0),
            }
        )
    return segments


def _claim_text_for_item(work_item: Dict[str, Any], is_main: bool) -> str:
    title = str(work_item.get("title") or "this workstream")
    story_kind = str(work_item.get("story_kind") or "general")
    tasks = work_item.get("specific_tasks") or []
    if story_kind == "planning":
        prefix = "A notable planning thread was" if not is_main else "The clearest planning thread was"
        detail = f" around {tasks[0]}" if tasks else ""
        return f"{prefix} {title}{detail}."
    if story_kind == "research":
        detail = f", especially {tasks[0]}" if tasks else ""
        return f"You spent a meaningful block researching {title}{detail}."
    if story_kind == "communication":
        detail = f" tied to {tasks[0]}" if tasks else ""
        return f"You spent time coordinating around {title}{detail}."
    detail = f", including {tasks[0]}" if tasks else ""
    lead = "The main event was" if is_main else "Another supporting thread was"
    return f"{lead} {title}{detail}."


def _build_renderer_payload(
    *,
    renderer_kind: str,
    story_plan: Dict[str, Any],
    time_truth: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    sections: List[Dict[str, Any]] = []
    if renderer_kind in {"broad_overview", "daypart_overview"}:
        sections.append({"id": "main_event", "title": "Main event", "items": [story_plan.get("main_event")] if story_plan.get("main_event") else []})
        if renderer_kind == "broad_overview":
            sections.append({"id": "supporting_workstreams", "title": "Supporting workstreams", "items": story_plan.get("supporting_workstreams") or []})
        else:
            sections.append({"id": "timeline_segments", "title": "Timeline segments", "items": story_plan.get("timeline_segments") or []})
        sections.append({"id": "research_browsing", "title": "Research and browsing", "items": story_plan.get("research_browsing") or []})
        sections.append({"id": "personal_activity", "title": "Personal", "items": story_plan.get("personal_activity") or []})
        sections.append({"id": "concrete_tasks_completed", "title": "Concrete tasks", "items": story_plan.get("concrete_tasks_completed") or []})
        if renderer_kind == "broad_overview":
            sections.append({"id": "apps_and_tools_used", "title": "Apps and tools used", "items": story_plan.get("apps_and_tools_used") or []})
        sections.append({"id": "strongest_evidence", "title": "Strongest evidence", "items": story_plan.get("strongest_evidence") or []})
        sections.append({"id": "uncertainty_or_conflicts", "title": "Uncertainty or conflicts", "items": story_plan.get("uncertainty_or_conflicts") or []})
    elif renderer_kind == "app_drilldown":
        sections.extend(
            [
                {"id": "what_you_did_in_app", "title": "What you did in app", "items": [story_plan.get("main_event")] + list(story_plan.get("supporting_workstreams") or [])[:2]},
                {"id": "document_items", "title": "Documents worked on", "items": story_plan.get("document_items") or []},
                {"id": "related_projects_entities", "title": "Related projects/entities", "items": story_plan.get("entities") or []},
                {"id": "key_artifacts", "title": "Key artifacts", "items": story_plan.get("key_artifacts") or []},
                {"id": "evidence_timeline", "title": "Evidence timeline", "items": story_plan.get("timeline_segments") or []},
                {"id": "uncertainty", "title": "Uncertainty", "items": story_plan.get("uncertainty_or_conflicts") or []},
            ]
        )
    elif renderer_kind == "time_breakdown":
        sections.extend(
            [
                {"id": "time_buckets", "title": "Time buckets", "items": (time_truth or {}).get("breakdown") or story_plan.get("timeline_segments") or []},
                {"id": "dominant_work_items", "title": "Dominant work items", "items": [story_plan.get("main_event")] + list(story_plan.get("supporting_workstreams") or [])[:3]},
                {"id": "planning_vs_execution_split", "title": "Planning vs execution split", "items": story_plan.get("planning_and_followups") or []},
                {"id": "evidence_notes", "title": "Evidence notes", "items": story_plan.get("strongest_evidence") or []},
            ]
        )
    else:
        sections.extend(
            [
                {"id": "matched_work", "title": "Matched work", "items": [story_plan.get("main_event")] + list(story_plan.get("supporting_workstreams") or [])[:2]},
                {"id": "document_items", "title": "Documents worked on", "items": story_plan.get("document_items") or []},
                {"id": "claim_cards", "title": "Claim cards", "items": story_plan.get("claim_cards") or []},
                {"id": "evidence_timeline", "title": "Evidence timeline", "items": story_plan.get("timeline_segments") or []},
                {"id": "uncertainty", "title": "Uncertainty", "items": story_plan.get("uncertainty_or_conflicts") or []},
            ]
        )

    scaffold_lines: List[str] = []
    for section in sections:
        title = section["title"]
        items = [item for item in section.get("items") or [] if item]
        if not items:
            continue
        scaffold_lines.append(f"{title}:")
        for item in items[:4]:
            if isinstance(item, dict):
                label = item.get("label") or item.get("title") or item.get("claim_text") or item.get("canonical_name") or item.get("segment_type")
                if label:
                    scaffold_lines.append(f"- {label}")
            else:
                scaffold_lines.append(f"- {item}")

    generation_mode = "low" if len(story_plan.get("claim_cards") or []) >= 3 else "default"
    return {
        "kind": renderer_kind,
        "sections": sections,
        "generation_mode": generation_mode,
        "scaffold_text": "\n".join(scaffold_lines),
    }


def build_story_plan(
    citations: Sequence[Dict[str, Any]],
    *,
    query: str,
    intent: str,
    time_truth: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    enriched_items = [enrich_story_evidence(item) for item in citations if isinstance(item, dict)]
    entities, entity_index = _build_entities(enriched_items)
    work_items: List[Dict[str, Any]] = []

    for item in sorted(enriched_items, key=lambda row: (_safe_int(row.get("timestamp")), -_safe_float(row.get("score")))):
        seed_title = _work_item_seed(item)
        best_index = -1
        best_score = 0.0
        for index, existing in enumerate(work_items):
            score = _item_similarity(existing, {**item, "seed_title": seed_title})
            if score > best_score:
                best_score = score
                best_index = index

        if best_index >= 0 and best_score >= 1.2:
            work_item = work_items[best_index]
        else:
            primary_entity_id = None
            for project in item.get("project_refs") or []:
                primary_entity_id = entity_index.get(_normalized_key(project))
                if primary_entity_id:
                    break
            work_item = {
                "id": len(work_items) + 1,
                "user_id": None,
                "start_ts": _safe_int(item.get("timestamp")),
                "end_ts": _safe_int(item.get("timestamp")),
                "title": seed_title,
                "normalized_title": _normalized_key(seed_title),
                "seed_title": seed_title,
                "story_kind": item.get("semantic_kind") or "general",
                "status_hint": "planned" if item.get("semantic_kind") == "planning" else "active",
                "primary_entity_id": primary_entity_id,
                "primary_app": item.get("app_name") or "Unknown",
                "confidence": 0.0,
                "score_main_event": 0.0,
                "created_at": _safe_int(item.get("timestamp")),
                "updated_at": _safe_int(item.get("timestamp")),
                "evidence_count": 0,
                "evidence_ids": [],
                "session_keys": [],
                "apps": [],
                "window_titles": [],
                "browser_domains": [],
                "project_refs": [],
                "artifact_refs": [],
                "document_refs": [],
                "action_refs": [],
                "error_refs": [],
                "activity_classes": [],
                "specific_tasks": [],
                "topic_refs": [],
                "title_candidates": [],
                "supporting_snippets": [],
                "capture_quality": 0.0,
            }
            work_items.append(work_item)

        work_item["start_ts"] = min(_safe_int(work_item.get("start_ts")), _safe_int(item.get("timestamp")) or _safe_int(work_item.get("start_ts")))
        work_item["end_ts"] = max(_safe_int(work_item.get("end_ts")), _safe_int(item.get("timestamp")))
        work_item["updated_at"] = max(_safe_int(work_item.get("updated_at")), _safe_int(item.get("timestamp")))
        work_item["evidence_count"] += 1
        work_item["evidence_ids"] = _dedupe(list(work_item.get("evidence_ids") or []) + [item["evidence_id"]], limit=12)
        work_item["session_keys"] = _dedupe(list(work_item.get("session_keys") or []) + [str(item.get("session_key") or "")], limit=8)
        work_item["apps"] = _dedupe(list(work_item.get("apps") or []) + [str(item.get("app_name") or "Unknown")], limit=8)
        work_item["window_titles"] = _dedupe(list(work_item.get("window_titles") or []) + [str(item.get("window_title") or "")], limit=8)
        if item.get("browser_domain"):
            work_item["browser_domains"] = _dedupe(
                list(work_item.get("browser_domains") or []) + [str(item.get("browser_domain") or "")],
                limit=6,
            )
        work_item["project_refs"] = _dedupe(list(work_item.get("project_refs") or []) + list(item.get("project_refs") or []), limit=10)
        work_item["artifact_refs"] = _dedupe(list(work_item.get("artifact_refs") or []) + list(item.get("artifact_refs") or []), limit=10)
        work_item["document_refs"] = _dedupe(list(work_item.get("document_refs") or []) + list(item.get("document_refs") or []), limit=10)
        work_item["action_refs"] = _dedupe(list(work_item.get("action_refs") or []) + list(item.get("action_refs") or []), limit=8)
        work_item["error_refs"] = _dedupe(list(work_item.get("error_refs") or []) + list(item.get("error_refs") or []), limit=8)
        work_item["activity_classes"] = _dedupe(
            list(work_item.get("activity_classes") or []) + [str(item.get("activity_class") or "work")],
            limit=6,
        )
        work_item["specific_tasks"] = _dedupe(list(work_item.get("specific_tasks") or []) + list(item.get("task_phrases") or []), limit=8)
        work_item["topic_refs"] = _dedupe(list(work_item.get("topic_refs") or []) + list(item.get("topic_refs") or []), limit=8)
        work_item["title_candidates"] = _dedupe(list(work_item.get("title_candidates") or []) + list(item.get("title_candidates") or []), limit=8)
        if item.get("snippet"):
            work_item["supporting_snippets"] = _dedupe(list(work_item.get("supporting_snippets") or []) + [str(item.get("snippet"))], limit=4)
        work_item["capture_quality"] = max(_safe_float(work_item.get("capture_quality")), _safe_float(item.get("capture_quality")))

    execution_heavy_exists = any(item.get("story_kind") not in {"planning", "communication"} and int(item.get("evidence_count") or 0) >= 2 for item in work_items)
    for work_item in work_items:
        work_item["specific_tasks"] = _rank_distinct_candidates(work_item.get("specific_tasks") or [], kind="task", limit=6)
        work_item["document_refs"] = _rank_distinct_candidates(work_item.get("document_refs") or [], kind="document", limit=6)
        work_item["title_candidates"] = _rank_distinct_candidates(work_item.get("title_candidates") or [], kind="title", limit=6)
        work_item["score_main_event"] = _score_work_item(work_item, execution_heavy_exists)
        work_item["confidence"] = round(
            min(
                0.99,
                0.3
                + min(0.3, int(work_item.get("evidence_count") or 0) * 0.08)
                + min(0.2, len(work_item.get("specific_tasks") or []) * 0.04)
                + min(0.15, len(work_item.get("artifact_refs") or []) * 0.03)
                + min(0.1, len(work_item.get("apps") or []) * 0.03),
            ),
            3,
        )
        work_item["title"] = _choose_work_item_title(work_item)
        work_item["activity_class"] = (
            Counter(work_item.get("activity_classes") or []).most_common(1)[0][0]
            if work_item.get("activity_classes")
            else "work"
        )
        work_item["representative_windows"] = list(work_item.get("window_titles") or [])[:3]
        work_item["duration_ms"] = _estimate_duration_ms(work_item)

    ranked_work_items = sorted(
        work_items,
        key=lambda item: (float(item.get("score_main_event") or 0.0), _safe_int(item.get("end_ts"))),
        reverse=True,
    )
    worklike_ranked_items = [
        item
        for item in ranked_work_items
        if str(item.get("activity_class") or "") not in PERSONAL_ACTIVITY_CLASSES
    ]
    main_event = (worklike_ranked_items or ranked_work_items)[0] if ranked_work_items else None
    supporting = [
        item
        for item in worklike_ranked_items
        if item.get("id") != (main_event or {}).get("id")
        if str(item.get("activity_class") or "") not in RESEARCH_ACTIVITY_CLASSES
        if (
            str(item.get("story_kind") or "") != "general"
            or len(item.get("specific_tasks") or []) >= 2
            or len(item.get("artifact_refs") or []) >= 1
        )
        and str(item.get("title") or "") != "General workstream"
        and not _is_low_signal_browser_work_item(item)
    ][:4]
    research_browsing = [
        item
        for item in ranked_work_items
        if str(item.get("activity_class") or "") in RESEARCH_ACTIVITY_CLASSES
        and item.get("id") != (main_event or {}).get("id")
        and not _is_low_signal_browser_work_item(item)
    ][:4]
    personal_activity = [
        item
        for item in ranked_work_items
        if str(item.get("activity_class") or "") in PERSONAL_ACTIVITY_CLASSES
        and not _is_low_signal_browser_work_item(item)
    ][:4]
    temporal_segments = _build_temporal_segments(ranked_work_items[:8])

    strongest_evidence = []
    evidence_pool = [
        item
        for item in enriched_items
        if str(item.get("activity_class") or "") not in PERSONAL_ACTIVITY_CLASSES
    ] or list(enriched_items)
    for item in sorted(evidence_pool, key=lambda row: (_safe_float(row.get("score")) + _safe_float(row.get("confidence")), _safe_int(row.get("timestamp"))), reverse=True)[:8]:
        strongest_evidence.append(
            {
                "evidence_id": item.get("evidence_id"),
                "timestamp": item.get("timestamp"),
                "app": item.get("app_name"),
                "window": item.get("window_title"),
                "snippet": item.get("snippet"),
                "activity_class": item.get("activity_class"),
                "score": round(min(1.0, _safe_float(item.get("score")) + _safe_float(item.get("confidence")) * 0.15), 3),
                "reason": _story_kind_title(str(item.get("semantic_kind") or "general")),
                "task_phrases": item.get("task_phrases") or [],
            }
        )

    document_items = _build_document_items(enriched_items, ranked_work_items)
    claim_cards: List[Dict[str, Any]] = []
    for index, work_item in enumerate(ranked_work_items[:5]):
        if str(work_item.get("activity_class") or "") in PERSONAL_ACTIVITY_CLASSES and index > 0:
            continue
        claim_cards.append(
            {
                "claim_text": _claim_text_for_item(work_item, is_main=index == 0),
                "claim_kind": "main_event" if index == 0 else "supporting_workstream",
                "work_item_id": work_item.get("id"),
                "supporting_evidence_ids": list(work_item.get("evidence_ids") or [])[:4],
                "counter_evidence_ids": [],
                "confidence": work_item.get("confidence"),
                "why_this_claim": f"Grounded in {work_item.get('evidence_count')} evidence rows across {len(work_item.get('apps') or [])} app(s).",
            }
        )
    for document_item in document_items[:3]:
        claim_cards.append(
            {
                "claim_text": f"You worked directly on {document_item.get('label')}.",
                "claim_kind": "document_worked_on",
                "work_item_id": (document_item.get("related_work_item_ids") or [None])[0],
                "supporting_evidence_ids": list(document_item.get("supporting_evidence_ids") or [])[:4],
                "counter_evidence_ids": [],
                "confidence": round(min(0.95, 0.4 + int(document_item.get("evidence_count") or 0) * 0.08), 3),
                "why_this_claim": f"Repeated document identity across {document_item.get('evidence_count')} evidence rows.",
            }
        )
    for item in ranked_work_items:
        if item.get("story_kind") == "planning":
            claim_cards.append(
                {
                    "claim_text": f"You also planned or queued follow-up work around {item.get('title')}.",
                    "claim_kind": "planning_followup",
                    "work_item_id": item.get("id"),
                    "supporting_evidence_ids": list(item.get("evidence_ids") or [])[:4],
                    "counter_evidence_ids": [],
                    "confidence": item.get("confidence"),
                    "why_this_claim": f"Planning evidence from {item.get('evidence_count')} row(s).",
                }
            )
            break
    for item in ranked_work_items:
        if item.get("story_kind") == "research":
            claim_cards.append(
                {
                    "claim_text": f"You researched {item.get('title')}.",
                    "claim_kind": "research_topic",
                    "work_item_id": item.get("id"),
                    "supporting_evidence_ids": list(item.get("evidence_ids") or [])[:4],
                    "counter_evidence_ids": [],
                    "confidence": item.get("confidence"),
                    "why_this_claim": f"Research-oriented evidence across {len(item.get('apps') or [])} app(s).",
                }
            )
            break

    apps_and_tools_used = [
        {
            "app": app,
            "evidence_count": sum(1 for item in enriched_items if str(item.get("app_name") or "Unknown") == app),
            "top_windows": [
                {
                    "window": window,
                    "count": sum(
                        1
                        for item in enriched_items
                        if str(item.get("app_name") or "Unknown") == app and str(item.get("window_title") or "") == window
                    ),
                }
                for window in _dedupe(
                    [
                        str(item.get("window_title") or "")
                        for item in enriched_items
                        if str(item.get("app_name") or "Unknown") == app and str(item.get("window_title") or "")
                    ],
                    limit=3,
                )
            ],
        }
        for app in _dedupe(
            [
                str(item.get("app_name") or "Unknown")
                for item in enriched_items
                if str(item.get("app_name") or "Unknown") != "Unknown"
                and str(item.get("activity_class") or "") not in PERSONAL_ACTIVITY_CLASSES
            ],
            limit=8,
        )
    ]

    concrete_tasks_completed = _rank_distinct_candidates(
        [
            task
            for item in ranked_work_items
            if str(item.get("activity_class") or "") not in PERSONAL_ACTIVITY_CLASSES
            if str(item.get("activity_class") or "") not in RESEARCH_ACTIVITY_CLASSES
            if not _is_low_signal_browser_work_item(item)
            if item.get("story_kind") not in {"planning", "communication"}
            for task in (item.get("specific_tasks") or [])
        ],
        kind="task",
        limit=8,
    )
    planning_and_followups = [
        {
            "label": item.get("title"),
            "specific_tasks": item.get("specific_tasks") or [],
            "work_item_id": item.get("id"),
            "confidence": item.get("confidence"),
        }
        for item in ranked_work_items
        if item.get("story_kind") == "planning"
    ][:5]

    uncertainty: List[str] = []
    if len(ranked_work_items) <= 1:
        uncertainty.append("Evidence concentrates on one dominant storyline, so secondary tasks may be underrepresented.")
    if len(temporal_segments) < 2:
        uncertainty.append("Temporal coverage is narrow, so ordering across the day may be incomplete.")
    if len([item for item in enriched_items if item.get("task_phrases")]) < 3:
        uncertainty.append("Only a few evidence rows contain concrete task phrases, so some labels remain approximate.")
    if planning_and_followups and not concrete_tasks_completed:
        uncertainty.append("Most strong evidence looks like planning rather than clear execution.")
    for note in uncertainty[:2]:
        claim_cards.append(
            {
                "claim_text": note,
                "claim_kind": "uncertainty",
                "work_item_id": None,
                "supporting_evidence_ids": [],
                "counter_evidence_ids": [],
                "confidence": 0.2,
                "why_this_claim": "Planner could not ground this area with strong enough evidence.",
            }
        )

    renderer_kind = detect_story_renderer_kind(query, intent)
    timeline_segments = [
        {
            "bucket": segment.get("segment_type"),
            "start_ts": segment.get("start_ts"),
            "end_ts": segment.get("end_ts"),
            "apps": segment.get("apps") or [],
            "tasks": segment.get("tasks") or [],
            "evidence_count": segment.get("evidence_count"),
        }
        for segment in temporal_segments
    ]
    workstream_summary = [
        {
            "label": item.get("title"),
            "activity_class": item.get("activity_class"),
            "evidence_count": item.get("evidence_count"),
            "apps": item.get("apps") or [],
            "representative_windows": item.get("representative_windows") or [],
            "supporting_snippets": item.get("supporting_snippets") or [],
            "session_keys": item.get("session_keys") or [],
            "topic_tokens": item.get("topic_refs") or [],
            "specific_tasks": item.get("specific_tasks") or [],
            "story_kind": item.get("story_kind"),
            "score_main_event": item.get("score_main_event"),
        }
        for item in ranked_work_items[:6]
    ]

    story_plan = {
        "renderer_kind": renderer_kind,
        "main_event": (
            {
                "id": main_event.get("id"),
                "label": main_event.get("title"),
                "activity_class": main_event.get("activity_class"),
                "story_kind": main_event.get("story_kind"),
                "evidence_count": main_event.get("evidence_count"),
                "apps": main_event.get("apps") or [],
                "specific_tasks": main_event.get("specific_tasks") or [],
                "artifact_refs": main_event.get("artifact_refs") or [],
                "browser_domains": main_event.get("browser_domains") or [],
                "session_keys": main_event.get("session_keys") or [],
                "score_main_event": main_event.get("score_main_event"),
                "confidence": main_event.get("confidence"),
                "duration_ms": main_event.get("duration_ms"),
            }
            if main_event
            else None
        ),
        "supporting_workstreams": [
            {
                "id": item.get("id"),
                "label": item.get("title"),
                "activity_class": item.get("activity_class"),
                "story_kind": item.get("story_kind"),
                "evidence_count": item.get("evidence_count"),
                "apps": item.get("apps") or [],
                "specific_tasks": item.get("specific_tasks") or [],
                "artifact_refs": item.get("artifact_refs") or [],
                "browser_domains": item.get("browser_domains") or [],
                "confidence": item.get("confidence"),
                "duration_ms": item.get("duration_ms"),
            }
            for item in supporting
        ],
        "research_browsing": [
            {
                "id": item.get("id"),
                "label": item.get("title"),
                "activity_class": item.get("activity_class"),
                "story_kind": item.get("story_kind"),
                "evidence_count": item.get("evidence_count"),
                "apps": item.get("apps") or [],
                "specific_tasks": item.get("specific_tasks") or [],
                "artifact_refs": item.get("artifact_refs") or [],
                "browser_domains": item.get("browser_domains") or [],
                "confidence": item.get("confidence"),
                "duration_ms": item.get("duration_ms"),
            }
            for item in research_browsing
        ],
        "personal_activity": [
            {
                "id": item.get("id"),
                "label": item.get("title"),
                "activity_class": item.get("activity_class"),
                "story_kind": item.get("story_kind"),
                "evidence_count": item.get("evidence_count"),
                "apps": item.get("apps") or [],
                "specific_tasks": item.get("specific_tasks") or [],
                "browser_domains": item.get("browser_domains") or [],
                "confidence": item.get("confidence"),
                "duration_ms": item.get("duration_ms"),
            }
            for item in personal_activity
        ],
        "concrete_tasks_completed": concrete_tasks_completed,
        "planning_and_followups": planning_and_followups,
        "apps_and_tools_used": apps_and_tools_used[:6],
        "timeline_segments": timeline_segments,
        "claim_cards": claim_cards,
        "strongest_evidence": strongest_evidence,
        "uncertainty_or_conflicts": uncertainty,
        "work_items": ranked_work_items[:8],
        "document_items": document_items,
        "entities": entities,
        "entity_aliases": [
            {
                "entity_id": entity.get("id"),
                "canonical_name": entity.get("canonical_name"),
                "aliases": entity.get("aliases") or [],
            }
            for entity in entities
        ],
        "temporal_segments": temporal_segments,
        "main_workstreams": workstream_summary,
        "specific_tasks": concrete_tasks_completed[:12] or _dedupe(
            [task for item in ranked_work_items for task in (item.get("specific_tasks") or [])],
            limit=12,
        ),
        "key_artifacts": _dedupe([artifact for item in ranked_work_items[:5] for artifact in (item.get("artifact_refs") or [])], limit=12),
        "metrics": {
            "work_items_considered": len(ranked_work_items),
            "cross_app_stitches": len([item for item in ranked_work_items if len(item.get("apps") or []) >= 2]),
            "claim_count": len(claim_cards),
            "claim_grounding_rate": round(
                (
                    sum(1 for claim in claim_cards if claim.get("supporting_evidence_ids"))
                    / max(len(claim_cards), 1)
                ),
                3,
            ),
            "planning_only_ratio": round(
                (
                    len([item for item in ranked_work_items if item.get("story_kind") == "planning"])
                    / max(len(ranked_work_items), 1)
                ),
                3,
            ),
            "generic_fallback_used": not bool(concrete_tasks_completed),
        },
    }
    story_plan["renderer"] = _build_renderer_payload(
        renderer_kind=renderer_kind,
        story_plan=story_plan,
        time_truth=time_truth,
    )
    return story_plan
