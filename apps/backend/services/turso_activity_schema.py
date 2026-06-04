"""Per-user activity database schema helpers.

This module is used by explicit per-user Turso provisioning and migration code.
Normal request/startup paths should not create or alter schema implicitly.
"""

from __future__ import annotations

from typing import Any

ACTIVITY_MIGRATION_TABLES = (
    "activity_events",
    "afk_events",
    "project_time_sessions",
    "project_time_daily_rollups",
    "project_classification_rules",
)

ACTIVITY_SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_uid TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        ts_start INTEGER NOT NULL,
        ts_end INTEGER NOT NULL,
        app_bundle_id TEXT NOT NULL,
        app_name TEXT NOT NULL,
        window_title TEXT,
        window_title_hash TEXT,
        window_owner_pid INTEGER,
        is_afk INTEGER NOT NULL DEFAULT 0,
        browser_url TEXT,
        browser_domain TEXT,
        is_incognito INTEGER NOT NULL DEFAULT 0,
        device_platform TEXT,
        app_version TEXT,
        app_build TEXT,
        transition_reason TEXT,
        biome_source_file TEXT,
        biome_is_provisional INTEGER NOT NULL DEFAULT 0,
        location_lat REAL,
        location_lon REAL,
        location_accuracy_m REAL,
        location_source TEXT,
        location_place_label TEXT,
        location_confidence REAL,
        location_resolved_at INTEGER,
        location_signal_age_ms INTEGER,
        source TEXT NOT NULL DEFAULT 'ritual_watcher_v2',
        created_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS afk_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        afk_uid TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        ts_start INTEGER NOT NULL,
        ts_end INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS project_time_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_uid TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        date TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'local',
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        active_ms INTEGER NOT NULL DEFAULT 0,
        afk_ms INTEGER NOT NULL DEFAULT 0,
        project_key TEXT NOT NULL,
        project_name TEXT NOT NULL,
        task_key TEXT NOT NULL,
        task_name TEXT NOT NULL,
        classification_source TEXT NOT NULL DEFAULT 'rules',
        confidence REAL NOT NULL DEFAULT 0.0,
        status TEXT NOT NULL DEFAULT 'active',
        apps_json TEXT NOT NULL DEFAULT '[]',
        domains_json TEXT NOT NULL DEFAULT '[]',
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        summary_text TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS project_time_daily_rollups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rollup_uid TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        date TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'local',
        project_key TEXT NOT NULL,
        project_name TEXT NOT NULL,
        task_key TEXT NOT NULL,
        task_name TEXT NOT NULL,
        active_ms INTEGER NOT NULL DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 0,
        confidence_avg REAL NOT NULL DEFAULT 0.0,
        top_apps_json TEXT NOT NULL DEFAULT '[]',
        top_domains_json TEXT NOT NULL DEFAULT '[]',
        summary_text TEXT NOT NULL DEFAULT '',
        source_version TEXT NOT NULL DEFAULT 'project_time_v1',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS project_classification_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_uid TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        matcher_app_bundle_id TEXT,
        matcher_domain TEXT,
        matcher_title_pattern TEXT,
        matcher_artifact_pattern TEXT,
        matcher_keyword_pattern TEXT,
        project_key TEXT NOT NULL,
        project_name TEXT NOT NULL,
        task_key TEXT NOT NULL,
        task_name TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
    """,
)

ACTIVITY_INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_activity_events_ts_start ON activity_events(ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_ts_end ON activity_events(ts_end)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_user_device_ts ON activity_events(user_id, device_id, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_domain ON activity_events(browser_domain)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_events_event_uid ON activity_events(event_uid)",
    "CREATE INDEX IF NOT EXISTS idx_activity_events_source_ts ON activity_events(user_id, source, ts_start)",
    "CREATE INDEX IF NOT EXISTS idx_afk_events_user_device_ts ON afk_events(user_id, device_id, ts_start)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_afk_events_afk_uid ON afk_events(afk_uid)",
    "CREATE INDEX IF NOT EXISTS idx_project_time_sessions_user_date ON project_time_sessions(user_id, date, start_ts)",
    "CREATE INDEX IF NOT EXISTS idx_project_time_sessions_project ON project_time_sessions(user_id, project_key, task_key, start_ts)",
    "CREATE INDEX IF NOT EXISTS idx_project_time_daily_rollups_user_date ON project_time_daily_rollups(user_id, date, project_key, task_key)",
    "CREATE INDEX IF NOT EXISTS idx_project_classification_rules_user_enabled ON project_classification_rules(user_id, enabled, priority)",
)

PROJECT_TIME_SCHEMA_STATEMENTS = (
    ACTIVITY_SCHEMA_STATEMENTS[2],
    ACTIVITY_SCHEMA_STATEMENTS[3],
    ACTIVITY_SCHEMA_STATEMENTS[4],
    "CREATE INDEX IF NOT EXISTS idx_project_time_sessions_user_date ON project_time_sessions(user_id, date, start_ts)",
    "CREATE INDEX IF NOT EXISTS idx_project_time_daily_rollups_user_date ON project_time_daily_rollups(user_id, date, project_key, task_key)",
    "CREATE INDEX IF NOT EXISTS idx_project_classification_rules_user_enabled ON project_classification_rules(user_id, enabled, priority)",
)

ACTIVITY_COLUMN_MIGRATIONS = (
    ("activity_events", "event_uid", "TEXT NOT NULL DEFAULT ''"),
    ("activity_events", "device_platform", "TEXT"),
    ("activity_events", "app_version", "TEXT"),
    ("activity_events", "app_build", "TEXT"),
    ("activity_events", "transition_reason", "TEXT"),
    ("activity_events", "biome_source_file", "TEXT"),
    ("activity_events", "biome_is_provisional", "INTEGER NOT NULL DEFAULT 0"),
    ("activity_events", "location_lat", "REAL"),
    ("activity_events", "location_lon", "REAL"),
    ("activity_events", "location_accuracy_m", "REAL"),
    ("activity_events", "location_source", "TEXT"),
    ("activity_events", "location_place_label", "TEXT"),
    ("activity_events", "location_confidence", "REAL"),
    ("activity_events", "location_resolved_at", "INTEGER"),
    ("activity_events", "location_signal_age_ms", "INTEGER"),
    ("afk_events", "afk_uid", "TEXT NOT NULL DEFAULT ''"),
)

ACTIVITY_BACKFILL_STATEMENTS = (
    """
    UPDATE activity_events
    SET event_uid = printf('legacy-activity:%s:%s:%lld', device_id, user_id, id)
    WHERE TRIM(COALESCE(event_uid, '')) = ''
    """,
    """
    UPDATE afk_events
    SET afk_uid = printf('legacy-afk:%s:%s:%lld', device_id, user_id, id)
    WHERE TRIM(COALESCE(afk_uid, '')) = ''
    """,
)


def _is_duplicate_column_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "duplicate column name" in message or "already exists" in message


def _is_missing_table_error(exc: Exception) -> bool:
    return "no such table" in str(exc).lower()


def apply_activity_column_migrations(conn: Any) -> None:
    for table_name, column_name, column_sql in ACTIVITY_COLUMN_MIGRATIONS:
        statement = f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"
        try:
            conn.execute(statement)
        except Exception as exc:
            if _is_duplicate_column_error(exc) or _is_missing_table_error(exc):
                continue
            raise


def apply_activity_backfills(conn: Any) -> None:
    for statement in ACTIVITY_BACKFILL_STATEMENTS:
        try:
            conn.execute(statement)
        except Exception as exc:
            if _is_missing_table_error(exc):
                continue
            raise


def apply_activity_indexes(conn: Any) -> None:
    for statement in ACTIVITY_INDEX_STATEMENTS:
        try:
            conn.execute(statement)
        except Exception as exc:
            if _is_missing_table_error(exc):
                continue
            raise


def apply_full_activity_schema(conn: Any) -> None:
    for statement in ACTIVITY_SCHEMA_STATEMENTS:
        conn.execute(statement)
    apply_activity_column_migrations(conn)
    apply_activity_backfills(conn)
    apply_activity_indexes(conn)


def apply_project_time_schema(conn: Any) -> None:
    for statement in PROJECT_TIME_SCHEMA_STATEMENTS:
        conn.execute(statement)
