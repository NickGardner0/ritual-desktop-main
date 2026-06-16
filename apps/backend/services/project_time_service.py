"""Project/task time attribution service.

This is the product-facing computer-work surface. It reads compact project_time_* tables and can recompute them from
activity_events without requiring raw OCR/accessibility text.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

from services.turso_activity_schema import apply_project_time_schema
from services.watcher_service_local_db import open_activity_connection_for_user

logger = logging.getLogger(__name__)

ATTRIBUTION_VERSION = "project_time_v1"
SESSION_GAP_MS = 5 * 60 * 1000
MIN_CONFIDENCE = 0.45


@dataclass
class Classification:
    project_key: str
    project_name: str
    task_key: str
    task_name: str
    source: str
    confidence: float


def _now_ms() -> int:
    return int(time.time() * 1000)


def _date_to_start_ms(value: str) -> int:
    return int(datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)


def _date_to_end_ms(value: str) -> int:
    return int((datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)).timestamp() * 1000)


def _date_from_ms(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return slug or "general"


def _clean(value: str, fallback: str = "General") -> str:
    text = re.sub(r"\s+", " ", (value or "").strip().strip("-")).strip()
    return text[:80] if text else fallback


def _ensure_schema(conn: sqlite3.Connection) -> None:
    apply_project_time_schema(conn)
    conn.commit()


def _has_table(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1
        """,
        (table_name,),
    ).fetchone()
    return row is not None


def _has_project_time_schema(conn: sqlite3.Connection) -> bool:
    return _has_table(conn, "project_time_sessions") and _has_table(conn, "project_time_daily_rollups")


def _json_loads(value: Any) -> Any:
    if not value:
        return []
    try:
        return json.loads(value)
    except Exception:
        return []


def _counts_json(counts: Dict[str, int]) -> str:
    rows = [{"name": key, "active_ms": value} for key, value in sorted(counts.items(), key=lambda item: -item[1])[:12]]
    return json.dumps(rows, separators=(",", ":"))


async def _fetch_remote_project_time_rows(
    user_id: str,
    sql: str,
    params: List[Any],
    columns: List[str],
) -> Optional[Dict[str, Any]]:
    """Read per-user project-time data through libSQL HTTP instead of replica sync.

    Production project-time reads should not block on embedded replica startup.
    The direct remote path is the fast path for per-user Turso databases; legacy
    shared databases still fall through to the local replica path below.
    """
    try:
        from services.turso_activity_remote import fetch_remote_activity_rows
    except Exception as exc:
        logger.warning("Project-time remote client unavailable for %s: %s", user_id, exc)
        return None

    try:
        result = await fetch_remote_activity_rows(user_id, sql, params)
    except Exception as exc:
        logger.warning("Project-time remote read raised for %s: %s", user_id, exc)
        return None
    if not result.expected_remote:
        return None
    if result.error:
        logger.warning("Project-time remote read failed for %s: %s", user_id, result.error)
        return {
            "success": True,
            "data": [],
            "source": "project_time_remote_error",
            "error": result.error,
        }
    return {
        "success": True,
        "data": [dict(zip(columns, row)) for row in result.rows],
        "source": "project_time_remote",
    }


def _classify_event(row: sqlite3.Row, rules: List[sqlite3.Row]) -> Classification:
    bundle = str(row["app_bundle_id"] or "").lower()
    app_name = str(row["app_name"] or "")
    app_lower = app_name.lower()
    title = str(row["window_title"] or "")
    title_lower = title.lower()
    domain = str(row["browser_domain"] or "")
    domain_lower = domain.lower()
    haystack = f"{bundle} {domain_lower} {title_lower}"

    for rule in rules:
        checks = [
            (rule["matcher_app_bundle_id"], bundle),
            (rule["matcher_domain"], domain_lower),
            (rule["matcher_title_pattern"], title_lower),
            (rule["matcher_artifact_pattern"], title_lower),
            (rule["matcher_keyword_pattern"], haystack),
        ]
        if all(not needle or str(needle).lower() in target for needle, target in checks):
            return Classification(
                project_key=rule["project_key"],
                project_name=rule["project_name"],
                task_key=rule["task_key"],
                task_name=rule["task_name"],
                source="user_rule",
                confidence=0.98,
            )

    if any(token in bundle or token in app_lower for token in ("cursor", "vscode", "xcode", "intellij", "terminal", "code")):
        normalized = title.replace("—", "-").replace("–", "-").replace(" | ", " - ")
        parts = [part.strip() for part in normalized.split(" - ") if part.strip()]
        project = next((part for part in reversed(parts) if _looks_like_project(part)), parts[1] if len(parts) > 1 else app_name)
        task = parts[0] if parts and not _looks_like_project(parts[0]) else "Development"
        if project.lower().replace(" ", "-") == "ritual-desktop-main":
            project = "Ritual Desktop"
        else:
            project = project.replace("-", " ").replace("_", " ").title()
        return Classification(_slug(project), _clean(project), _slug(task), _clean(task), "development_signal", 0.86)

    if any(token in bundle or token in app_lower or token in domain_lower for token in ("slack", "mail", "messages", "gmail", "zoom")):
        return Classification("communication", "Communication", "messages", "Messages", "known_category", 0.82)

    if any(token in domain_lower for token in ("docs.", "developer.", "stackoverflow", "arxiv", "wikipedia", "github.com")):
        return Classification("research", "Research", _slug(domain), _clean(domain, "Web"), "domain_category", 0.78)

    if any(token in domain_lower for token in ("clerk", "railway", "vercel", "turso", "stripe", "console.")):
        return Classification("admin", "Admin", _slug(domain), _clean(domain, "Admin"), "domain_category", 0.7)

    if domain:
        return Classification(_slug(domain), _clean(domain), "web", "Web", "domain", 0.58)

    if app_name:
        return Classification(_slug(app_name), _clean(app_name), "general", "General", "app", 0.52)

    return Classification("unclassified", "Unclassified", "general", "General", "unclassified", 0.25)


def _looks_like_project(value: str) -> bool:
    lowered = value.lower()
    return any(token in lowered for token in ("ritual", "desktop", "backend", "dashboard", "sync", "repo")) or "-" in lowered or "_" in lowered or "/" in lowered


def _load_rules(conn: sqlite3.Connection, user_id: str) -> List[sqlite3.Row]:
    _ensure_schema(conn)
    return list(conn.execute(
        """
        SELECT matcher_app_bundle_id, matcher_domain, matcher_title_pattern,
               matcher_artifact_pattern, matcher_keyword_pattern,
               project_key, project_name, task_key, task_name
        FROM project_classification_rules
        WHERE user_id = ? AND enabled = 1
        ORDER BY priority ASC, updated_at DESC
        """,
        (user_id,),
    ).fetchall())


async def get_project_time_rollups(
    user_id: str,
    *,
    start_date: str,
    end_date: str,
    group_by: str = "project",
    limit: int = 50,
) -> Dict[str, Any]:
    group_by = group_by if group_by in {"project", "task", "day"} else "project"
    limit = max(1, min(int(limit or 50), 200))
    if group_by == "day":
        sql = """
            SELECT date, SUM(active_ms) AS active_ms, SUM(session_count) AS session_count,
                   AVG(confidence_avg) AS confidence_avg
            FROM project_time_daily_rollups
            WHERE user_id = ? AND date >= ? AND date <= ?
            GROUP BY date
            ORDER BY date ASC
            LIMIT ?
        """
        params: List[Any] = [user_id, start_date, end_date, limit]
        columns = ["date", "active_ms", "session_count", "confidence_avg"]
    elif group_by == "task":
        sql = """
            SELECT project_key, project_name, task_key, task_name,
                   SUM(active_ms) AS active_ms, SUM(session_count) AS session_count,
                   AVG(confidence_avg) AS confidence_avg,
                   MAX(summary_text) AS summary_text
            FROM project_time_daily_rollups
            WHERE user_id = ? AND date >= ? AND date <= ?
            GROUP BY project_key, project_name, task_key, task_name
            ORDER BY active_ms DESC
            LIMIT ?
        """
        params = [user_id, start_date, end_date, limit]
        columns = [
            "project_key",
            "project_name",
            "task_key",
            "task_name",
            "active_ms",
            "session_count",
            "confidence_avg",
            "summary_text",
        ]
    else:
        sql = """
            SELECT project_key, project_name,
                   SUM(active_ms) AS active_ms, SUM(session_count) AS session_count,
                   AVG(confidence_avg) AS confidence_avg,
                   MAX(summary_text) AS summary_text
            FROM project_time_daily_rollups
            WHERE user_id = ? AND date >= ? AND date <= ?
            GROUP BY project_key, project_name
            ORDER BY active_ms DESC
            LIMIT ?
        """
        params = [user_id, start_date, end_date, limit]
        columns = [
            "project_key",
            "project_name",
            "active_ms",
            "session_count",
            "confidence_avg",
            "summary_text",
        ]

    remote = await _fetch_remote_project_time_rows(user_id, sql, params, columns)
    if remote is not None:
        return {
            **remote,
            "start_date": start_date,
            "end_date": end_date,
            "group_by": group_by,
        }

    async with open_activity_connection_for_user(user_id, write=False) as conn:
        if conn is None:
            return {"success": True, "data": [], "source": "unavailable"}
        if not _has_project_time_schema(conn):
            return {
                "success": True,
                "data": [],
                "start_date": start_date,
                "end_date": end_date,
                "group_by": group_by,
                "source": "project_time_rollups_missing",
            }
        if group_by == "day":
            rows = conn.execute(sql, params).fetchall()
        elif group_by == "task":
            rows = conn.execute(sql, params).fetchall()
        else:
            rows = conn.execute(sql, params).fetchall()
    return {
        "success": True,
        "data": [dict(row) for row in rows],
        "start_date": start_date,
        "end_date": end_date,
        "group_by": group_by,
        "source": "project_time_rollups",
    }


async def get_project_time_sessions(
    user_id: str,
    *,
    start_date: str,
    end_date: str,
    project_key: Optional[str] = None,
    task_key: Optional[str] = None,
    limit: int = 100,
) -> Dict[str, Any]:
    limit = max(1, min(int(limit or 100), 500))
    params: List[Any] = [user_id, start_date, end_date]
    filters = ["user_id = ?", "date >= ?", "date <= ?", "status != 'ignored'"]
    if project_key:
        filters.append("project_key = ?")
        params.append(project_key)
    if task_key:
        filters.append("task_key = ?")
        params.append(task_key)
    params.append(limit)
    sql = f"""
        SELECT session_uid, date, start_ts, end_ts, active_ms, afk_ms,
               project_key, project_name, task_key, task_name,
               classification_source, confidence, status,
               apps_json, domains_json, artifacts_json, summary_text,
               updated_at
        FROM project_time_sessions
        WHERE {' AND '.join(filters)}
        ORDER BY start_ts ASC
        LIMIT ?
    """
    columns = [
        "session_uid",
        "date",
        "start_ts",
        "end_ts",
        "active_ms",
        "afk_ms",
        "project_key",
        "project_name",
        "task_key",
        "task_name",
        "classification_source",
        "confidence",
        "status",
        "apps_json",
        "domains_json",
        "artifacts_json",
        "summary_text",
        "updated_at",
    ]
    remote = await _fetch_remote_project_time_rows(user_id, sql, params, columns)
    if remote is not None:
        return {
            **remote,
            "data": [_compact_session_mapping(row) for row in remote.get("data", [])],
            "start_date": start_date,
            "end_date": end_date,
        }

    async with open_activity_connection_for_user(user_id, write=False) as conn:
        if conn is None:
            return {"success": True, "data": [], "source": "unavailable"}
        if not _has_project_time_schema(conn):
            return {
                "success": True,
                "data": [],
                "start_date": start_date,
                "end_date": end_date,
                "source": "project_time_sessions_missing",
            }
        rows = conn.execute(sql, params).fetchall()
    return {
        "success": True,
        "data": [_compact_session_row(row) for row in rows],
        "start_date": start_date,
        "end_date": end_date,
        "source": "project_time_sessions",
    }


def _compact_session_row(row: sqlite3.Row) -> Dict[str, Any]:
    return _compact_session_mapping(dict(row))


def _compact_session_mapping(data: Dict[str, Any]) -> Dict[str, Any]:
    data["apps"] = _json_loads(data.pop("apps_json", None))
    data["domains"] = _json_loads(data.pop("domains_json", None))
    data["artifacts"] = _json_loads(data.pop("artifacts_json", None))
    return data


async def update_project_time_session_classification(
    user_id: str,
    *,
    session_uid: str,
    project_name: str,
    task_name: str,
    status: str = "active",
    apply_forward: bool = False,
) -> Dict[str, Any]:
    project_name = _clean(project_name, "Unclassified")
    task_name = _clean(task_name, "General")
    project_key = _slug(project_name)
    task_key = _slug(task_name)
    now = _now_ms()
    async with open_activity_connection_for_user(user_id, write=True) as conn:
        if conn is None:
            return {"success": False, "error": "project-time database unavailable"}
        _ensure_schema(conn)
        row = conn.execute(
            "SELECT * FROM project_time_sessions WHERE user_id = ? AND session_uid = ?",
            (user_id, session_uid),
        ).fetchone()
        if row is None:
            return {"success": False, "error": "session not found"}
        conn.execute(
            """
            UPDATE project_time_sessions
            SET project_key = ?, project_name = ?, task_key = ?, task_name = ?,
                classification_source = 'user_correction', confidence = 1.0,
                status = ?, updated_at = ?
            WHERE user_id = ? AND session_uid = ?
            """,
            (project_key, project_name, task_key, task_name, status, now, user_id, session_uid),
        )
        if apply_forward:
            rule_uid = f"rule:{user_id}:{session_uid}"
            apps = _json_loads(row["apps_json"])
            domains = _json_loads(row["domains_json"])
            app_matcher = apps[0].get("name") if apps and isinstance(apps[0], dict) else None
            domain_matcher = domains[0].get("name") if domains and isinstance(domains[0], dict) else None
            conn.execute(
                """
                INSERT INTO project_classification_rules (
                    rule_uid, user_id, matcher_app_bundle_id, matcher_domain,
                    project_key, project_name, task_key, task_name,
                    priority, enabled, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 1, ?, ?)
                ON CONFLICT(rule_uid) DO UPDATE SET
                    project_key = excluded.project_key,
                    project_name = excluded.project_name,
                    task_key = excluded.task_key,
                    task_name = excluded.task_name,
                    enabled = 1,
                    updated_at = excluded.updated_at
                """,
                (rule_uid, user_id, app_matcher, domain_matcher, project_key, project_name, task_key, task_name, now, now),
            )
        _rebuild_daily_rollups_for_dates(conn, user_id, [row["date"]])
        conn.commit()
    return {"success": True, "session_uid": session_uid, "project_key": project_key, "task_key": task_key}


async def recompute_project_time(user_id: str, *, start_date: str, end_date: str) -> Dict[str, Any]:
    start_ms = _date_to_start_ms(start_date)
    end_ms = _date_to_end_ms(end_date)
    now = _now_ms()
    async with open_activity_connection_for_user(user_id, write=True) as conn:
        if conn is None:
            return {"success": False, "error": "project-time database unavailable"}
        _ensure_schema(conn)
        rules = _load_rules(conn, user_id)
        rows = conn.execute(
            """
            SELECT id, event_uid, user_id, device_id, ts_start, ts_end, app_bundle_id,
                   app_name, window_title, browser_domain, is_afk
            FROM activity_events
            WHERE user_id = ? AND ts_end > ? AND ts_start < ?
            ORDER BY ts_start ASC, id ASC
            """,
            (user_id, start_ms, end_ms),
        ).fetchall()
        conn.execute(
            "DELETE FROM project_time_sessions WHERE user_id = ? AND end_ts > ? AND start_ts < ?",
            (user_id, start_ms, end_ms),
        )
        conn.execute(
            "DELETE FROM project_time_daily_rollups WHERE user_id = ? AND date >= ? AND date <= ?",
            (user_id, start_date, end_date),
        )
        sessions = _build_sessions(rows, rules, start_ms, end_ms)
        for session in sessions:
            conn.execute(
                """
                INSERT OR REPLACE INTO project_time_sessions (
                    session_uid, user_id, device_id, date, timezone,
                    start_ts, end_ts, active_ms, afk_ms,
                    project_key, project_name, task_key, task_name,
                    classification_source, confidence, status,
                    apps_json, domains_json, artifacts_json, summary_text,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'local', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
                """,
                (
                    session["session_uid"], user_id, session["device_id"], session["date"],
                    session["start_ts"], session["end_ts"], session["active_ms"],
                    session["project_key"], session["project_name"], session["task_key"], session["task_name"],
                    session["classification_source"], session["confidence"],
                    _counts_json(session["apps"]), _counts_json(session["domains"]),
                    json.dumps(session["artifacts"][:20], separators=(",", ":")),
                    session["summary_text"][:500], now, now,
                ),
            )
        _rebuild_daily_rollups_for_dates(conn, user_id, sorted({session["date"] for session in sessions}))
        conn.commit()
    return {"success": True, "sessions_written": len(sessions), "start_date": start_date, "end_date": end_date}


def _build_sessions(rows: Iterable[sqlite3.Row], rules: List[sqlite3.Row], start_ms: int, end_ms: int) -> List[Dict[str, Any]]:
    sessions: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    for row in rows:
        if int(row["is_afk"] or 0):
            if current:
                sessions.append(current)
                current = None
            continue
        active_ms = max(0, min(int(row["ts_end"]), end_ms) - max(int(row["ts_start"]), start_ms))
        if active_ms <= 0:
            continue
        classification = _classify_event(row, rules)
        if classification.confidence < MIN_CONFIDENCE:
            classification = Classification("unclassified", "Unclassified", "general", "General", "unclassified", 0.25)
        event_start = max(int(row["ts_start"]), start_ms)
        event_end = min(int(row["ts_end"]), end_ms)
        can_merge = bool(
            current
            and event_start - int(current["end_ts"]) <= SESSION_GAP_MS
            and current["project_key"] == classification.project_key
            and current["task_key"] == classification.task_key
        )
        if not can_merge:
            if current:
                sessions.append(current)
            current = {
                "device_id": row["device_id"],
                "date": _date_from_ms(event_start),
                "start_ts": event_start,
                "end_ts": event_end,
                "active_ms": active_ms,
                "project_key": classification.project_key,
                "project_name": classification.project_name,
                "task_key": classification.task_key,
                "task_name": classification.task_name,
                "classification_source": classification.source,
                "confidence": classification.confidence,
                "apps": {},
                "domains": {},
                "artifacts": [],
            }
        else:
            current["end_ts"] = max(int(current["end_ts"]), event_end)
            current["active_ms"] += active_ms
        assert current is not None
        app_name = str(row["app_name"] or "").strip()
        if app_name:
            current["apps"][app_name] = current["apps"].get(app_name, 0) + active_ms
        domain = str(row["browser_domain"] or "").strip()
        if domain:
            current["domains"][domain] = current["domains"].get(domain, 0) + active_ms
        title = str(row["window_title"] or "")
        for token in re.findall(r"\b[\w.-]+\.[A-Za-z0-9]{1,8}\b", title):
            if token not in current["artifacts"]:
                current["artifacts"].append(token)
        current["session_uid"] = f"project-session:{current['device_id']}:{current['start_ts']}:{current['end_ts']}:{current['project_key']}:{current['task_key']}"
        current["summary_text"] = f"{current['project_name']} / {current['task_name']}"
    if current:
        sessions.append(current)
    return sessions


def _rebuild_daily_rollups_for_dates(conn: sqlite3.Connection, user_id: str, dates: Iterable[str]) -> None:
    now = _now_ms()
    for date in dates:
        conn.execute("DELETE FROM project_time_daily_rollups WHERE user_id = ? AND date = ?", (user_id, date))
        rows = conn.execute(
            """
            SELECT user_id, device_id, date, project_key, project_name, task_key, task_name,
                   SUM(active_ms) AS active_ms, COUNT(*) AS session_count,
                   AVG(confidence) AS confidence_avg,
                   MAX(summary_text) AS summary_text
            FROM project_time_sessions
            WHERE user_id = ? AND date = ? AND status != 'ignored'
            GROUP BY user_id, device_id, date, project_key, project_name, task_key, task_name
            """,
            (user_id, date),
        ).fetchall()
        for row in rows:
            apps = _merge_session_counts(conn, user_id, date, row["project_key"], row["task_key"], "apps_json")
            domains = _merge_session_counts(conn, user_id, date, row["project_key"], row["task_key"], "domains_json")
            rollup_uid = f"project-rollup:{row['device_id']}:{date}:{row['project_key']}:{row['task_key']}"
            conn.execute(
                """
                INSERT INTO project_time_daily_rollups (
                    rollup_uid, user_id, device_id, date, timezone,
                    project_key, project_name, task_key, task_name,
                    active_ms, session_count, confidence_avg,
                    top_apps_json, top_domains_json, summary_text,
                    source_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    rollup_uid, user_id, row["device_id"], date,
                    row["project_key"], row["project_name"], row["task_key"], row["task_name"],
                    row["active_ms"], row["session_count"], row["confidence_avg"] or 0.0,
                    _counts_json(apps), _counts_json(domains), row["summary_text"] or "",
                    ATTRIBUTION_VERSION, now, now,
                ),
            )


def _merge_session_counts(conn: sqlite3.Connection, user_id: str, date: str, project_key: str, task_key: str, column: str) -> Dict[str, int]:
    totals: Dict[str, int] = {}
    for row in conn.execute(
        f"SELECT {column} FROM project_time_sessions WHERE user_id = ? AND date = ? AND project_key = ? AND task_key = ?",
        (user_id, date, project_key, task_key),
    ):
        for item in _json_loads(row[0]):
            if isinstance(item, dict) and item.get("name"):
                totals[str(item["name"])] = totals.get(str(item["name"]), 0) + int(item.get("active_ms") or 0)
    return totals


project_time_service = {
    "get_rollups": get_project_time_rollups,
    "get_sessions": get_project_time_sessions,
    "update_session": update_project_time_session_classification,
    "recompute": recompute_project_time,
}
