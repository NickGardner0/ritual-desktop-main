"""Derived semantic work items for recap-oriented retrieval."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any, Dict, Iterable, List, Optional, Sequence


SEMANTIC_WORK_ITEM_SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS semantic_work_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        source_scope TEXT NOT NULL DEFAULT 'broad_overview',
        range_start_ts INTEGER NOT NULL,
        range_end_ts INTEGER NOT NULL,
        session_id INTEGER,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        title TEXT NOT NULL,
        action_summary TEXT NOT NULL DEFAULT '',
        activity_class TEXT NOT NULL DEFAULT 'work',
        story_kind TEXT NOT NULL DEFAULT 'general',
        primary_app TEXT,
        apps_json TEXT NOT NULL DEFAULT '[]',
        domains_json TEXT NOT NULL DEFAULT '[]',
        files_json TEXT NOT NULL DEFAULT '[]',
        commands_json TEXT NOT NULL DEFAULT '[]',
        errors_json TEXT NOT NULL DEFAULT '[]',
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        semantic_summary TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL DEFAULT 0.0,
        evidence_count INTEGER NOT NULL DEFAULT 0,
        score_main_event REAL NOT NULL DEFAULT 0.0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS semantic_work_item_evidence (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        evidence_id TEXT,
        session_id INTEGER,
        evidence_kind TEXT NOT NULL DEFAULT 'citation',
        snippet TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL,
        score REAL NOT NULL DEFAULT 0.0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(work_item_id, evidence_id, timestamp)
    )
    """,
)

SEMANTIC_WORK_ITEM_INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_semantic_work_items_user_scope_range ON semantic_work_items(user_id, source_scope, range_start_ts, range_end_ts)",
    "CREATE INDEX IF NOT EXISTS idx_semantic_work_items_user_time ON semantic_work_items(user_id, start_ts, end_ts)",
    "CREATE INDEX IF NOT EXISTS idx_semantic_work_item_evidence_work_item ON semantic_work_item_evidence(work_item_id, timestamp)",
)


def ensure_semantic_work_item_schema(conn: sqlite3.Connection) -> None:
    for statement in SEMANTIC_WORK_ITEM_SCHEMA_STATEMENTS:
        conn.execute(statement)
    for statement in SEMANTIC_WORK_ITEM_INDEX_STATEMENTS:
        conn.execute(statement)


def _compact(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


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


def _json_dumps(values: Iterable[Any]) -> str:
    return json.dumps(list(values), ensure_ascii=True, separators=(",", ":"))


def _json_loads(value: Any) -> List[Any]:
    raw = str(value or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


def _extract_session_id(item: Dict[str, Any]) -> Optional[int]:
    direct = _safe_int(item.get("session_id") or 0, 0)
    if direct > 0:
        return direct
    for session_key in item.get("session_keys") or []:
        text = str(session_key or "").strip()
        if text.startswith("session:"):
            parsed = _safe_int(text.split(":", 1)[1], 0)
            if parsed > 0:
                return parsed
    return None


def _build_action_summary(item: Dict[str, Any]) -> str:
    parts: List[str] = []
    label = _compact(item.get("title") or "")
    tasks = [_compact(task) for task in (item.get("specific_tasks") or []) if _compact(task)]
    files = [_compact(path) for path in (item.get("file_artifacts") or []) if _compact(path)]
    commands = [_compact(cmd) for cmd in (item.get("command_artifacts") or []) if _compact(cmd)]
    errors = [_compact(err) for err in (item.get("error_artifacts") or []) if _compact(err)]

    if label:
        parts.append(label)
    if tasks:
        parts.append("Tasks: " + "; ".join(tasks[:3]))
    if files:
        parts.append("Files: " + ", ".join(files[:3]))
    if commands:
        parts.append("Commands: " + ", ".join(commands[:2]))
    if errors:
        parts.append("Errors: " + "; ".join(errors[:2]))

    return "\n".join(parts).strip()


def _build_semantic_summary(item: Dict[str, Any]) -> str:
    label = _compact(item.get("title") or "")
    tasks = [_compact(task) for task in (item.get("specific_tasks") or []) if _compact(task)]
    artifacts = [_compact(artifact) for artifact in (item.get("artifact_refs") or []) if _compact(artifact)]
    snippets = [_compact(snippet) for snippet in (item.get("supporting_snippets") or []) if _compact(snippet)]

    segments: List[str] = []
    if label:
        segments.append(label)
    if tasks:
        segments.append("Key tasks: " + "; ".join(tasks[:3]))
    if artifacts:
        segments.append("Artifacts: " + ", ".join(artifacts[:3]))
    if snippets:
        segments.append("Evidence: " + " ".join(snippets[:2]))
    return "\n".join(segment for segment in segments if segment).strip()


def _work_item_key(
    *,
    user_id: str,
    source_scope: str,
    range_start_ts: int,
    range_end_ts: int,
    item: Dict[str, Any],
) -> str:
    parts = [
        user_id,
        source_scope,
        str(range_start_ts),
        str(range_end_ts),
        _compact(item.get("title") or ""),
        str(_extract_session_id(item) or ""),
        str(_safe_int(item.get("start_ts"))),
        str(_safe_int(item.get("end_ts"))),
        "|".join(sorted(str(app or "") for app in (item.get("apps") or []))),
    ]
    return hashlib.sha1("||".join(parts).encode("utf-8")).hexdigest()


def materialize_semantic_work_items(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    range_start_ts: int,
    range_end_ts: int,
    source_scope: str,
    story_plan: Dict[str, Any],
    citations: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    ensure_semantic_work_item_schema(conn)

    raw_work_items = [
        item for item in (story_plan.get("work_items") or []) if isinstance(item, dict)
    ]
    if not raw_work_items:
        return {"stored": 0, "evidence": 0}

    evidence_by_id = {
        str(item.get("evidence_id") or ""): item
        for item in citations
        if isinstance(item, dict) and str(item.get("evidence_id") or "").strip()
    }
    now_ts = max(range_end_ts, 1)

    existing_ids = conn.execute(
        """
        SELECT id
        FROM semantic_work_items
        WHERE user_id = ?
          AND source_scope = ?
          AND range_start_ts = ?
          AND range_end_ts = ?
        """,
        (user_id, source_scope, int(range_start_ts), int(range_end_ts)),
    ).fetchall()
    if existing_ids:
        ids = [int(row[0]) for row in existing_ids]
        placeholders = ",".join("?" for _ in ids)
        conn.execute(
            f"DELETE FROM semantic_work_item_evidence WHERE work_item_id IN ({placeholders})",
            tuple(ids),
        )
        conn.execute(
            """
            DELETE FROM semantic_work_items
            WHERE user_id = ?
              AND source_scope = ?
              AND range_start_ts = ?
              AND range_end_ts = ?
            """,
            (user_id, source_scope, int(range_start_ts), int(range_end_ts)),
        )

    stored = 0
    evidence_rows = 0
    for item in raw_work_items:
        session_id = _extract_session_id(item)
        work_item_key = _work_item_key(
            user_id=user_id,
            source_scope=source_scope,
            range_start_ts=range_start_ts,
            range_end_ts=range_end_ts,
            item=item,
        )
        conn.execute(
            """
            INSERT INTO semantic_work_items (
                work_item_key,
                user_id,
                source_scope,
                range_start_ts,
                range_end_ts,
                session_id,
                start_ts,
                end_ts,
                title,
                action_summary,
                activity_class,
                story_kind,
                primary_app,
                apps_json,
                domains_json,
                files_json,
                commands_json,
                errors_json,
                artifacts_json,
                semantic_summary,
                confidence,
                evidence_count,
                score_main_event,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                work_item_key,
                user_id,
                source_scope,
                int(range_start_ts),
                int(range_end_ts),
                session_id,
                _safe_int(item.get("start_ts")),
                _safe_int(item.get("end_ts")),
                _compact(item.get("title") or "Untitled work item"),
                _build_action_summary(item),
                _compact(item.get("activity_class") or "work") or "work",
                _compact(item.get("story_kind") or "general") or "general",
                _compact(item.get("primary_app") or ""),
                _json_dumps(item.get("apps") or []),
                _json_dumps(item.get("browser_domains") or []),
                _json_dumps(item.get("file_artifacts") or []),
                _json_dumps(item.get("command_artifacts") or []),
                _json_dumps(item.get("error_artifacts") or []),
                _json_dumps(item.get("artifact_refs") or []),
                _build_semantic_summary(item),
                round(_safe_float(item.get("confidence")), 3),
                _safe_int(item.get("evidence_count")),
                round(_safe_float(item.get("score_main_event")), 3),
                now_ts,
                now_ts,
            ),
        )
        work_item_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        stored += 1

        for evidence_id in item.get("evidence_ids") or []:
            evidence = evidence_by_id.get(str(evidence_id or ""))
            if not evidence:
                continue
            snippet = _compact(
                evidence.get("semantic_summary")
                or evidence.get("contextual_retrieval_text")
                or evidence.get("snippet")
                or ""
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO semantic_work_item_evidence (
                    work_item_id,
                    evidence_id,
                    session_id,
                    evidence_kind,
                    snippet,
                    timestamp,
                    score,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    work_item_id,
                    str(evidence.get("evidence_id") or ""),
                    _safe_int(evidence.get("session_id")),
                    "citation",
                    snippet,
                    _safe_int(evidence.get("timestamp")),
                    round(_safe_float(evidence.get("score")), 3),
                    now_ts,
                    now_ts,
                ),
            )
            evidence_rows += 1

    conn.commit()
    return {"stored": stored, "evidence": evidence_rows}


def load_semantic_work_items_for_range(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    range_start_ts: int,
    range_end_ts: int,
    source_scope: Optional[str] = None,
    limit: int = 12,
) -> List[Dict[str, Any]]:
    ensure_semantic_work_item_schema(conn)

    params: List[Any] = [user_id, int(range_end_ts), int(range_start_ts)]
    scope_sql = ""
    if source_scope:
        scope_sql = "AND source_scope = ?"
        params.append(source_scope)
    params.append(int(limit))

    rows = conn.execute(
        f"""
        SELECT
            id,
            work_item_key,
            user_id,
            source_scope,
            range_start_ts,
            range_end_ts,
            session_id,
            start_ts,
            end_ts,
            title,
            action_summary,
            activity_class,
            story_kind,
            primary_app,
            apps_json,
            domains_json,
            files_json,
            commands_json,
            errors_json,
            artifacts_json,
            semantic_summary,
            confidence,
            evidence_count,
            score_main_event,
            created_at,
            updated_at
        FROM semantic_work_items
        WHERE user_id = ?
          AND start_ts <= ?
          AND end_ts >= ?
          {scope_sql}
        ORDER BY score_main_event DESC, end_ts DESC
        LIMIT ?
        """,
        tuple(params),
    ).fetchall()

    item_ids = [int(row["id"] if isinstance(row, sqlite3.Row) else row[0]) for row in rows]
    evidence_map: Dict[int, List[Dict[str, Any]]] = {}
    if item_ids:
        placeholders = ",".join("?" for _ in item_ids)
        evidence_rows = conn.execute(
            f"""
            SELECT
                work_item_id,
                evidence_id,
                session_id,
                evidence_kind,
                snippet,
                timestamp,
                score
            FROM semantic_work_item_evidence
            WHERE work_item_id IN ({placeholders})
            ORDER BY timestamp ASC, score DESC
            """,
            tuple(item_ids),
        ).fetchall()
        for row in evidence_rows:
            work_item_id = int(row["work_item_id"] if isinstance(row, sqlite3.Row) else row[0])
            evidence_map.setdefault(work_item_id, []).append(
                {
                    "evidence_id": row["evidence_id"] if isinstance(row, sqlite3.Row) else row[1],
                    "session_id": row["session_id"] if isinstance(row, sqlite3.Row) else row[2],
                    "evidence_kind": row["evidence_kind"] if isinstance(row, sqlite3.Row) else row[3],
                    "snippet": row["snippet"] if isinstance(row, sqlite3.Row) else row[4],
                    "timestamp": row["timestamp"] if isinstance(row, sqlite3.Row) else row[5],
                    "score": row["score"] if isinstance(row, sqlite3.Row) else row[6],
                }
            )

    results: List[Dict[str, Any]] = []
    for row in rows:
        get = (lambda key: row[key]) if isinstance(row, sqlite3.Row) else None
        item_id = int(get("id") if get else row[0])
        results.append(
            {
                "id": item_id,
                "work_item_key": get("work_item_key") if get else row[1],
                "user_id": get("user_id") if get else row[2],
                "source_scope": get("source_scope") if get else row[3],
                "range_start_ts": get("range_start_ts") if get else row[4],
                "range_end_ts": get("range_end_ts") if get else row[5],
                "session_id": get("session_id") if get else row[6],
                "start_ts": get("start_ts") if get else row[7],
                "end_ts": get("end_ts") if get else row[8],
                "title": get("title") if get else row[9],
                "action_summary": get("action_summary") if get else row[10],
                "activity_class": get("activity_class") if get else row[11],
                "story_kind": get("story_kind") if get else row[12],
                "primary_app": get("primary_app") if get else row[13],
                "apps": _json_loads(get("apps_json") if get else row[14]),
                "domains": _json_loads(get("domains_json") if get else row[15]),
                "files": _json_loads(get("files_json") if get else row[16]),
                "commands": _json_loads(get("commands_json") if get else row[17]),
                "errors": _json_loads(get("errors_json") if get else row[18]),
                "artifacts": _json_loads(get("artifacts_json") if get else row[19]),
                "semantic_summary": get("semantic_summary") if get else row[20],
                "confidence": get("confidence") if get else row[21],
                "evidence_count": get("evidence_count") if get else row[22],
                "score_main_event": get("score_main_event") if get else row[23],
                "created_at": get("created_at") if get else row[24],
                "updated_at": get("updated_at") if get else row[25],
                "evidence": evidence_map.get(item_id, []),
            }
        )
    return results
