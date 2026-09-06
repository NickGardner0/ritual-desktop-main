use libsql::Connection;
use tracing::debug;

use crate::error::{DatabaseError, Result};

/// Create local context evidence tables.
pub(super) async fn create_memory_pipeline_tables(conn: &Connection) -> Result<()> {
    debug!("Creating local context evidence tables");

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS context_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_uid TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            start_ts INTEGER NOT NULL,
            end_ts INTEGER NOT NULL,
            primary_app_bundle_id TEXT,
            primary_app_name TEXT,
            primary_domain TEXT,
            dominant_title TEXT,
            representative_text TEXT,
            coverage_score REAL NOT NULL DEFAULT 0.0,
            snapshot_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS context_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            activity_event_id INTEGER,
            activity_event_uid TEXT,
            session_id INTEGER,
            session_uid TEXT,
            ts INTEGER NOT NULL,
            source_type TEXT NOT NULL,
            app_bundle_id TEXT NOT NULL,
            app_name TEXT NOT NULL,
            window_title TEXT,
            browser_url TEXT,
            browser_domain TEXT,
            tab_title TEXT,
            document_title TEXT,
            visible_text_raw TEXT NOT NULL DEFAULT '',
            visible_text_norm TEXT NOT NULL DEFAULT '',
            capture_quality REAL NOT NULL DEFAULT 0.0,
            capture_components_json TEXT,
            ax_richness_score REAL NOT NULL DEFAULT 0.0,
            selected_text_present INTEGER NOT NULL DEFAULT 0,
            document_path TEXT,
            ax_source TEXT,
            capture_trigger TEXT,
            trigger_to_snapshot_ms INTEGER,
            ui_elements_json TEXT,
            dedup_key TEXT NOT NULL,
            is_sensitive_redacted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES context_sessions(id) ON DELETE SET NULL,
            FOREIGN KEY (activity_event_id) REFERENCES activity_events(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS entities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            entity_type TEXT NOT NULL DEFAULT 'project',
            canonical_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            first_seen_ts INTEGER,
            last_seen_ts INTEGER,
            salience REAL NOT NULL DEFAULT 0.0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS entity_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id INTEGER NOT NULL,
            alias TEXT NOT NULL,
            normalized_alias TEXT NOT NULL,
            match_score REAL NOT NULL DEFAULT 0.0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS work_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            start_ts INTEGER NOT NULL,
            end_ts INTEGER NOT NULL,
            title TEXT NOT NULL,
            normalized_title TEXT NOT NULL,
            story_kind TEXT NOT NULL DEFAULT 'general',
            status_hint TEXT,
            primary_entity_id INTEGER,
            primary_app TEXT,
            confidence REAL NOT NULL DEFAULT 0.0,
            score_main_event REAL NOT NULL DEFAULT 0.0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (primary_entity_id) REFERENCES entities(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS work_item_evidence (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            work_item_id INTEGER NOT NULL,
            session_id INTEGER,
            snapshot_id INTEGER,
            evidence_kind TEXT NOT NULL,
            excerpt TEXT,
            artifact_key TEXT,
            timestamp INTEGER NOT NULL,
            score REAL NOT NULL DEFAULT 0.0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES context_sessions(id) ON DELETE SET NULL,
            FOREIGN KEY (snapshot_id) REFERENCES context_snapshots(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS temporal_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            day_key TEXT NOT NULL,
            segment_type TEXT NOT NULL,
            start_ts INTEGER NOT NULL,
            end_ts INTEGER NOT NULL,
            dominant_work_item_id INTEGER,
            evidence_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (dominant_work_item_id) REFERENCES work_items(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS project_time_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_uid TEXT NOT NULL,
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
        );

        CREATE TABLE IF NOT EXISTS project_time_daily_rollups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rollup_uid TEXT NOT NULL,
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
        );

        CREATE TABLE IF NOT EXISTS project_classification_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_uid TEXT NOT NULL,
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
        );

        CREATE TABLE IF NOT EXISTS project_time_session_evidence_local (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_uid TEXT NOT NULL,
            user_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            evidence_kind TEXT NOT NULL,
            activity_event_id INTEGER,
            context_snapshot_id INTEGER,
            ocr_frame_id INTEGER,
            excerpt TEXT,
            timestamp INTEGER NOT NULL,
            score REAL NOT NULL DEFAULT 0.0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (activity_event_id) REFERENCES activity_events(id) ON DELETE SET NULL,
            FOREIGN KEY (context_snapshot_id) REFERENCES context_snapshots(id) ON DELETE SET NULL,
            FOREIGN KEY (ocr_frame_id) REFERENCES ocr_frames(id) ON DELETE SET NULL
        );
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}
