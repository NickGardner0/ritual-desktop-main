//! Database schema definitions for Ritual
//!
//! This module contains all SQL statements for creating and maintaining
//! the database schema. It consolidates:
//! - Activity events (from watcher.db)
//! - OCR frames and video chunks (from frames.db)
//! - Sync queue (from sync_queue.db)
//! - Local context evidence for project-time attribution

use libsql::Connection;
use tracing::{debug, info};

use crate::error::{DatabaseError, Result};

/// Current schema version - increment when making breaking changes
pub const SCHEMA_VERSION: i32 = 9;

/// Initialize the complete database schema
pub async fn initialize_schema(conn: &Connection) -> Result<()> {
    info!("Initializing Ritual database schema v{}", SCHEMA_VERSION);

    // Create tables in dependency order
    create_metadata_tables(conn).await?;
    let schema_needs_update = needs_schema_update(conn).await?;
    create_activity_tables(conn).await?;
    create_recorder_tables(conn).await?;
    create_sync_tables(conn).await?;
    create_memory_pipeline_tables(conn).await?;

    if schema_needs_update {
        // Apply migrations before indexes so older DBs get new columns (e.g. logical_chunk_id)
        // before we create indexes that reference them.
        apply_migrations(conn).await?;
    } else {
        debug!("Schema v{} already recorded; skipping migration backfills", SCHEMA_VERSION);
    }

    // Create indexes
    create_indexes(conn).await?;
    create_cloud_sync_triggers(conn).await?;
    // Keep this cheap safety pass on every startup so stale raw-memory rows cannot
    // re-enter the upload path after a previous crash or partial migration.
    suppress_legacy_raw_memory_cloud_sync(conn).await?;

    // Create FTS tables and triggers
    create_fts_tables(conn).await?;

    // Record schema version
    record_schema_version(conn, SCHEMA_VERSION).await?;

    info!("Schema initialization complete");
    Ok(())
}

/// Create local context evidence tables.
async fn create_memory_pipeline_tables(conn: &Connection) -> Result<()> {
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

/// Create metadata and migration tracking tables
async fn create_metadata_tables(conn: &Connection) -> Result<()> {
    debug!("Creating metadata tables");

    conn.execute_batch(
        r#"
        -- Schema version tracking
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL,
            description TEXT
        );
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

/// Create activity tracking tables (from watcher)
async fn create_activity_tables(conn: &Connection) -> Result<()> {
    debug!("Creating activity tables");

    conn.execute_batch(
        r#"
        -- Activity events table
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
            source TEXT NOT NULL DEFAULT 'ritual_watcher_v2',
            created_at INTEGER NOT NULL
        );

        -- AFK events table
        CREATE TABLE IF NOT EXISTS afk_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            afk_uid TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        -- Heartbeat tracking for watcher liveness
        CREATE TABLE IF NOT EXISTS watcher_heartbeat (
            device_id TEXT PRIMARY KEY,
            last_seen_ts INTEGER NOT NULL
        );
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

/// Create recorder tables (OCR frames, video chunks)
async fn create_recorder_tables(conn: &Connection) -> Result<()> {
    debug!("Creating recorder tables");

    conn.execute_batch(
        r#"
        -- Video chunks table
        CREATE TABLE IF NOT EXISTS video_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            start_time INTEGER NOT NULL,
            end_time INTEGER,
            frame_count INTEGER DEFAULT 0,
            file_size_bytes INTEGER,
            monitor_id INTEGER DEFAULT 0,
            storage_tier TEXT DEFAULT 'hot',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- OCR frames table
        CREATE TABLE IF NOT EXISTS ocr_frames (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            activity_event_id INTEGER,
            app_bundle_id TEXT,
            app_name TEXT,
            window_title TEXT,
            ocr_text TEXT,
            ocr_confidence REAL DEFAULT 0.0,
            thumbnail_path TEXT,
            video_chunk_id INTEGER,
            frame_offset INTEGER,
            image_hash TEXT,
            storage_tier TEXT DEFAULT 'hot',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (video_chunk_id) REFERENCES video_chunks(id),
            FOREIGN KEY (activity_event_id) REFERENCES activity_events(id)
        );

        -- Recorder statistics (single row)
        CREATE TABLE IF NOT EXISTS recorder_stats (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            total_frames INTEGER DEFAULT 0,
            total_video_chunks INTEGER DEFAULT 0,
            total_storage_bytes INTEGER DEFAULT 0,
            last_capture_time INTEGER,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- Initialize stats row if not exists
        INSERT OR IGNORE INTO recorder_stats (id) VALUES (1);
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

/// Create sync queue tables
async fn create_sync_tables(conn: &Connection) -> Result<()> {
    debug!("Creating sync tables");

    conn.execute_batch(
        r#"
        -- Sync queue for backend reliability
        CREATE TABLE IF NOT EXISTS sync_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_type TEXT NOT NULL,
            event_id INTEGER NOT NULL,
            ts_end INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS cloud_sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_uid TEXT NOT NULL,
            op_kind TEXT NOT NULL DEFAULT 'upsert',
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            next_retry_at INTEGER,
            last_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        -- Daily rollup cache for efficient summaries
        CREATE TABLE IF NOT EXISTS daily_rollup_cache (
            date TEXT NOT NULL,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            total_active_ms INTEGER NOT NULL DEFAULT 0,
            total_afk_ms INTEGER NOT NULL DEFAULT 0,
            app_summaries TEXT,
            domain_summaries TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (date, device_id)
        );
        
        -- Activity segments for sessionization
        -- Groups consecutive activity events by app/window into meaningful sessions
        CREATE TABLE IF NOT EXISTS activity_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            app_bundle_id TEXT,
            app_name TEXT,
            window_title_normalized TEXT,
            browser_domain TEXT,
            segment_kind TEXT DEFAULT 'work',
            duration_ms INTEGER NOT NULL,
            frame_count INTEGER DEFAULT 0,
            key_topics TEXT,
            created_at INTEGER NOT NULL
        );
        
        -- Segment to frames mapping
        CREATE TABLE IF NOT EXISTS segment_frames (
            segment_id INTEGER NOT NULL,
            frame_id INTEGER NOT NULL,
            PRIMARY KEY (segment_id, frame_id),
            FOREIGN KEY (segment_id) REFERENCES activity_segments(id) ON DELETE CASCADE,
            FOREIGN KEY (frame_id) REFERENCES ocr_frames(id) ON DELETE CASCADE
        );
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

/// Create all indexes for efficient querying
async fn create_indexes(conn: &Connection) -> Result<()> {
    debug!("Creating indexes");

    conn.execute_batch(
        r#"
        -- Activity event indexes
        CREATE INDEX IF NOT EXISTS idx_activity_events_ts_start 
            ON activity_events(ts_start);
        
        CREATE INDEX IF NOT EXISTS idx_activity_events_ts_end 
            ON activity_events(ts_end);

        CREATE INDEX IF NOT EXISTS idx_activity_events_device_ts 
            ON activity_events(device_id, ts_start);
        
        CREATE INDEX IF NOT EXISTS idx_activity_events_device_ts_end 
            ON activity_events(device_id, ts_end DESC);

        CREATE INDEX IF NOT EXISTS idx_activity_events_user_device_ts 
            ON activity_events(user_id, device_id, ts_start);
        
        CREATE INDEX IF NOT EXISTS idx_activity_events_user_device_ts_end 
            ON activity_events(user_id, device_id, ts_end);
        
        CREATE INDEX IF NOT EXISTS idx_activity_events_app_ts 
            ON activity_events(user_id, device_id, app_bundle_id, ts_start);
        
        CREATE INDEX IF NOT EXISTS idx_activity_events_domain 
            ON activity_events(browser_domain);
        
        CREATE INDEX IF NOT EXISTS idx_activity_events_summary 
            ON activity_events(device_id, ts_start, ts_end, is_afk);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_events_event_uid
            ON activity_events(event_uid)
            WHERE TRIM(COALESCE(event_uid, '')) != '';

        -- AFK event indexes
        CREATE INDEX IF NOT EXISTS idx_afk_events_device_ts 
            ON afk_events(device_id, ts_start);
        
        CREATE INDEX IF NOT EXISTS idx_afk_events_user_device_ts 
            ON afk_events(user_id, device_id, ts_start);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_afk_events_afk_uid
            ON afk_events(afk_uid)
            WHERE TRIM(COALESCE(afk_uid, '')) != '';

        -- OCR frame indexes
        CREATE INDEX IF NOT EXISTS idx_ocr_frames_timestamp 
            ON ocr_frames(timestamp);
        
        CREATE INDEX IF NOT EXISTS idx_ocr_frames_activity 
            ON ocr_frames(activity_event_id);
        
        CREATE INDEX IF NOT EXISTS idx_ocr_frames_app 
            ON ocr_frames(app_bundle_id);
        
        CREATE INDEX IF NOT EXISTS idx_ocr_frames_tier 
            ON ocr_frames(storage_tier);

        -- Video chunk indexes
        CREATE INDEX IF NOT EXISTS idx_video_chunks_time 
            ON video_chunks(start_time);
        
        CREATE INDEX IF NOT EXISTS idx_video_chunks_tier 
            ON video_chunks(storage_tier);

        -- Sync queue indexes
        CREATE INDEX IF NOT EXISTS idx_sync_queue_status 
            ON sync_queue(status, created_at);
        
        CREATE INDEX IF NOT EXISTS idx_sync_queue_event 
            ON sync_queue(event_id, entry_type);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_sync_outbox_entity
            ON cloud_sync_outbox(entity_type, entity_uid, op_kind);

        CREATE INDEX IF NOT EXISTS idx_cloud_sync_outbox_status
            ON cloud_sync_outbox(status, next_retry_at, updated_at);

        CREATE INDEX IF NOT EXISTS idx_cloud_sync_outbox_status_created
            ON cloud_sync_outbox(status, created_at, id);

        CREATE INDEX IF NOT EXISTS idx_context_snapshots_ts
            ON context_snapshots(ts);

        CREATE INDEX IF NOT EXISTS idx_context_snapshots_app_ts
            ON context_snapshots(app_bundle_id, ts);

        CREATE INDEX IF NOT EXISTS idx_context_snapshots_domain_ts
            ON context_snapshots(browser_domain, ts);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_context_snapshots_dedup
            ON context_snapshots(dedup_key);

        CREATE INDEX IF NOT EXISTS idx_context_snapshots_session_ts
            ON context_snapshots(session_id, ts);

        CREATE INDEX IF NOT EXISTS idx_context_snapshots_session_uid_ts
            ON context_snapshots(session_uid, ts);

        CREATE INDEX IF NOT EXISTS idx_context_snapshots_activity_uid_ts
            ON context_snapshots(activity_event_uid, ts);

        CREATE INDEX IF NOT EXISTS idx_context_sessions_time
            ON context_sessions(start_ts, end_ts);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_context_sessions_session_uid
            ON context_sessions(session_uid)
            WHERE TRIM(COALESCE(session_uid, '')) != '';

        CREATE INDEX IF NOT EXISTS idx_entities_user_norm
            ON entities(user_id, normalized_name);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_aliases_entity_alias
            ON entity_aliases(entity_id, normalized_alias);

        CREATE INDEX IF NOT EXISTS idx_work_items_user_time
            ON work_items(user_id, start_ts, end_ts);

        CREATE INDEX IF NOT EXISTS idx_work_items_entity
            ON work_items(primary_entity_id, score_main_event DESC);

        CREATE INDEX IF NOT EXISTS idx_work_item_evidence_work_item_ts
            ON work_item_evidence(work_item_id, timestamp);

        CREATE INDEX IF NOT EXISTS idx_temporal_segments_user_day
            ON temporal_segments(user_id, day_key, start_ts);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_time_sessions_uid
            ON project_time_sessions(session_uid);

        CREATE INDEX IF NOT EXISTS idx_project_time_sessions_user_date
            ON project_time_sessions(user_id, date, start_ts);

        CREATE INDEX IF NOT EXISTS idx_project_time_sessions_project
            ON project_time_sessions(user_id, project_key, task_key, start_ts);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_time_daily_rollups_uid
            ON project_time_daily_rollups(rollup_uid);

        CREATE INDEX IF NOT EXISTS idx_project_time_daily_rollups_user_date
            ON project_time_daily_rollups(user_id, date, project_key, task_key);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_project_classification_rules_uid
            ON project_classification_rules(rule_uid);

        CREATE INDEX IF NOT EXISTS idx_project_classification_rules_user_enabled
            ON project_classification_rules(user_id, enabled, priority);

        CREATE INDEX IF NOT EXISTS idx_project_time_session_evidence_session
            ON project_time_session_evidence_local(session_uid, timestamp);

        CREATE INDEX IF NOT EXISTS idx_project_time_session_evidence_retention
            ON project_time_session_evidence_local(timestamp);
        
        -- Activity segment indexes
        CREATE INDEX IF NOT EXISTS idx_segments_device_ts 
            ON activity_segments(device_id, ts_start);
        
        CREATE INDEX IF NOT EXISTS idx_segments_user_device_ts 
            ON activity_segments(user_id, device_id, ts_start);
        
        CREATE INDEX IF NOT EXISTS idx_segments_kind 
            ON activity_segments(segment_kind);
        
        CREATE INDEX IF NOT EXISTS idx_segments_app 
            ON activity_segments(app_bundle_id);
        
        CREATE INDEX IF NOT EXISTS idx_segment_frames_segment 
            ON segment_frames(segment_id);
        
        CREATE INDEX IF NOT EXISTS idx_segment_frames_frame 
            ON segment_frames(frame_id);
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

async fn create_cloud_sync_triggers(conn: &Connection) -> Result<()> {
    debug!("Creating cloud sync triggers");

    conn.execute_batch(
        r#"
        DROP TRIGGER IF EXISTS activity_events_cloud_sync_ai;
        DROP TRIGGER IF EXISTS activity_events_cloud_sync_au;
        DROP TRIGGER IF EXISTS afk_events_cloud_sync_ai;
        DROP TRIGGER IF EXISTS afk_events_cloud_sync_au;
        DROP TRIGGER IF EXISTS context_sessions_cloud_sync_ai;
        DROP TRIGGER IF EXISTS context_sessions_cloud_sync_au;
        DROP TRIGGER IF EXISTS context_snapshots_cloud_sync_ai;
        DROP TRIGGER IF EXISTS context_snapshots_cloud_sync_au;
        DROP TRIGGER IF EXISTS session_retrieval_docs_cloud_sync_ai;
        DROP TRIGGER IF EXISTS session_retrieval_docs_cloud_sync_au;

        CREATE TRIGGER activity_events_cloud_sync_ai
        AFTER INSERT ON activity_events
        WHEN TRIM(COALESCE(NEW.event_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id,
                NEW.device_id,
                'activity_event',
                NEW.event_uid,
                'upsert',
                json_object(
                    'id', NEW.id,
                    'event_uid', NEW.event_uid,
                    'device_id', NEW.device_id,
                    'user_id', NEW.user_id,
                    'ts_start', NEW.ts_start,
                    'ts_end', NEW.ts_end,
                    'app_bundle_id', NEW.app_bundle_id,
                    'app_name', NEW.app_name,
                    'window_title', NEW.window_title,
                    'window_title_hash', NEW.window_title_hash,
                    'window_owner_pid', NEW.window_owner_pid,
                    'is_afk', NEW.is_afk,
                    'browser_url', NEW.browser_url,
                    'browser_domain', NEW.browser_domain,
                    'is_incognito', NEW.is_incognito,
                    'source', NEW.source,
                    'created_at', NEW.created_at
                ),
                'pending',
                0,
                NULL,
                NULL,
                COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000),
                CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;

        CREATE TRIGGER activity_events_cloud_sync_au
        AFTER UPDATE ON activity_events
        WHEN TRIM(COALESCE(NEW.event_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id,
                NEW.device_id,
                'activity_event',
                NEW.event_uid,
                'upsert',
                json_object(
                    'id', NEW.id,
                    'event_uid', NEW.event_uid,
                    'device_id', NEW.device_id,
                    'user_id', NEW.user_id,
                    'ts_start', NEW.ts_start,
                    'ts_end', NEW.ts_end,
                    'app_bundle_id', NEW.app_bundle_id,
                    'app_name', NEW.app_name,
                    'window_title', NEW.window_title,
                    'window_title_hash', NEW.window_title_hash,
                    'window_owner_pid', NEW.window_owner_pid,
                    'is_afk', NEW.is_afk,
                    'browser_url', NEW.browser_url,
                    'browser_domain', NEW.browser_domain,
                    'is_incognito', NEW.is_incognito,
                    'source', NEW.source,
                    'created_at', NEW.created_at
                ),
                'pending',
                0,
                NULL,
                NULL,
                COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000),
                CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;

        CREATE TRIGGER afk_events_cloud_sync_ai
        AFTER INSERT ON afk_events
        WHEN TRIM(COALESCE(NEW.afk_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id,
                NEW.device_id,
                'afk_event',
                NEW.afk_uid,
                'upsert',
                json_object(
                    'id', NEW.id,
                    'afk_uid', NEW.afk_uid,
                    'device_id', NEW.device_id,
                    'user_id', NEW.user_id,
                    'ts_start', NEW.ts_start,
                    'ts_end', NEW.ts_end,
                    'status', NEW.status,
                    'created_at', NEW.created_at
                ),
                'pending',
                0,
                NULL,
                NULL,
                COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000),
                CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;

        CREATE TRIGGER afk_events_cloud_sync_au
        AFTER UPDATE ON afk_events
        WHEN TRIM(COALESCE(NEW.afk_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id,
                NEW.device_id,
                'afk_event',
                NEW.afk_uid,
                'upsert',
                json_object(
                    'id', NEW.id,
                    'afk_uid', NEW.afk_uid,
                    'device_id', NEW.device_id,
                    'user_id', NEW.user_id,
                    'ts_start', NEW.ts_start,
                    'ts_end', NEW.ts_end,
                    'status', NEW.status,
                    'created_at', NEW.created_at
                ),
                'pending',
                0,
                NULL,
                NULL,
                COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000),
                CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;

        DROP TRIGGER IF EXISTS project_time_sessions_cloud_sync_ai;
        DROP TRIGGER IF EXISTS project_time_sessions_cloud_sync_au;
        DROP TRIGGER IF EXISTS project_time_daily_rollups_cloud_sync_ai;
        DROP TRIGGER IF EXISTS project_time_daily_rollups_cloud_sync_au;
        DROP TRIGGER IF EXISTS project_classification_rules_cloud_sync_ai;
        DROP TRIGGER IF EXISTS project_classification_rules_cloud_sync_au;

        CREATE TRIGGER project_time_sessions_cloud_sync_ai
        AFTER INSERT ON project_time_sessions
        WHEN TRIM(COALESCE(NEW.session_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id, NEW.device_id, 'project_time_session', NEW.session_uid, 'upsert',
                json_object(
                    'session_uid', NEW.session_uid,
                    'user_id', NEW.user_id,
                    'device_id', NEW.device_id,
                    'date', NEW.date,
                    'timezone', NEW.timezone,
                    'start_ts', NEW.start_ts,
                    'end_ts', NEW.end_ts,
                    'active_ms', NEW.active_ms,
                    'afk_ms', NEW.afk_ms,
                    'project_key', NEW.project_key,
                    'project_name', NEW.project_name,
                    'task_key', NEW.task_key,
                    'task_name', NEW.task_name,
                    'classification_source', NEW.classification_source,
                    'confidence', NEW.confidence,
                    'status', NEW.status,
                    'apps_json', NEW.apps_json,
                    'domains_json', NEW.domains_json,
                    'artifacts_json', NEW.artifacts_json,
                    'summary_text', substr(COALESCE(NEW.summary_text, ''), 1, 500),
                    'created_at', NEW.created_at,
                    'updated_at', NEW.updated_at
                ),
                'pending', 0, NULL, NULL, COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000), CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;

        CREATE TRIGGER project_time_sessions_cloud_sync_au
        AFTER UPDATE ON project_time_sessions
        WHEN TRIM(COALESCE(NEW.session_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id, NEW.device_id, 'project_time_session', NEW.session_uid, 'upsert',
                json_object(
                    'session_uid', NEW.session_uid,
                    'user_id', NEW.user_id,
                    'device_id', NEW.device_id,
                    'date', NEW.date,
                    'timezone', NEW.timezone,
                    'start_ts', NEW.start_ts,
                    'end_ts', NEW.end_ts,
                    'active_ms', NEW.active_ms,
                    'afk_ms', NEW.afk_ms,
                    'project_key', NEW.project_key,
                    'project_name', NEW.project_name,
                    'task_key', NEW.task_key,
                    'task_name', NEW.task_name,
                    'classification_source', NEW.classification_source,
                    'confidence', NEW.confidence,
                    'status', NEW.status,
                    'apps_json', NEW.apps_json,
                    'domains_json', NEW.domains_json,
                    'artifacts_json', NEW.artifacts_json,
                    'summary_text', substr(COALESCE(NEW.summary_text, ''), 1, 500),
                    'created_at', NEW.created_at,
                    'updated_at', NEW.updated_at
                ),
                'pending', 0, NULL, NULL, COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000), CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;

        CREATE TRIGGER project_time_daily_rollups_cloud_sync_ai
        AFTER INSERT ON project_time_daily_rollups
        WHEN TRIM(COALESCE(NEW.rollup_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id, NEW.device_id, 'project_time_daily_rollup', NEW.rollup_uid, 'upsert',
                json_object(
                    'rollup_uid', NEW.rollup_uid,
                    'user_id', NEW.user_id,
                    'device_id', NEW.device_id,
                    'date', NEW.date,
                    'timezone', NEW.timezone,
                    'project_key', NEW.project_key,
                    'project_name', NEW.project_name,
                    'task_key', NEW.task_key,
                    'task_name', NEW.task_name,
                    'active_ms', NEW.active_ms,
                    'session_count', NEW.session_count,
                    'confidence_avg', NEW.confidence_avg,
                    'top_apps_json', NEW.top_apps_json,
                    'top_domains_json', NEW.top_domains_json,
                    'summary_text', substr(COALESCE(NEW.summary_text, ''), 1, 500),
                    'source_version', NEW.source_version,
                    'created_at', NEW.created_at,
                    'updated_at', NEW.updated_at
                ),
                'pending', 0, NULL, NULL, COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000), CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;

        CREATE TRIGGER project_time_daily_rollups_cloud_sync_au
        AFTER UPDATE ON project_time_daily_rollups
        WHEN TRIM(COALESCE(NEW.rollup_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id, NEW.device_id, 'project_time_daily_rollup', NEW.rollup_uid, 'upsert',
                json_object(
                    'rollup_uid', NEW.rollup_uid,
                    'user_id', NEW.user_id,
                    'device_id', NEW.device_id,
                    'date', NEW.date,
                    'timezone', NEW.timezone,
                    'project_key', NEW.project_key,
                    'project_name', NEW.project_name,
                    'task_key', NEW.task_key,
                    'task_name', NEW.task_name,
                    'active_ms', NEW.active_ms,
                    'session_count', NEW.session_count,
                    'confidence_avg', NEW.confidence_avg,
                    'top_apps_json', NEW.top_apps_json,
                    'top_domains_json', NEW.top_domains_json,
                    'summary_text', substr(COALESCE(NEW.summary_text, ''), 1, 500),
                    'source_version', NEW.source_version,
                    'created_at', NEW.created_at,
                    'updated_at', NEW.updated_at
                ),
                'pending', 0, NULL, NULL, COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000), CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;

        CREATE TRIGGER project_classification_rules_cloud_sync_ai
        AFTER INSERT ON project_classification_rules
        WHEN TRIM(COALESCE(NEW.rule_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id, 'project-time-rules', 'project_classification_rule', NEW.rule_uid, 'upsert',
                json_object(
                    'rule_uid', NEW.rule_uid,
                    'user_id', NEW.user_id,
                    'matcher_app_bundle_id', NEW.matcher_app_bundle_id,
                    'matcher_domain', NEW.matcher_domain,
                    'matcher_title_pattern', NEW.matcher_title_pattern,
                    'matcher_artifact_pattern', NEW.matcher_artifact_pattern,
                    'matcher_keyword_pattern', NEW.matcher_keyword_pattern,
                    'project_key', NEW.project_key,
                    'project_name', NEW.project_name,
                    'task_key', NEW.task_key,
                    'task_name', NEW.task_name,
                    'priority', NEW.priority,
                    'enabled', NEW.enabled,
                    'created_at', NEW.created_at,
                    'updated_at', NEW.updated_at
                ),
                'pending', 0, NULL, NULL, COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000), CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;

        CREATE TRIGGER project_classification_rules_cloud_sync_au
        AFTER UPDATE ON project_classification_rules
        WHEN TRIM(COALESCE(NEW.rule_uid, '')) != ''
        BEGIN
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, retry_count, next_retry_at, last_error, created_at, updated_at
            ) VALUES (
                NEW.user_id, 'project-time-rules', 'project_classification_rule', NEW.rule_uid, 'upsert',
                json_object(
                    'rule_uid', NEW.rule_uid,
                    'user_id', NEW.user_id,
                    'matcher_app_bundle_id', NEW.matcher_app_bundle_id,
                    'matcher_domain', NEW.matcher_domain,
                    'matcher_title_pattern', NEW.matcher_title_pattern,
                    'matcher_artifact_pattern', NEW.matcher_artifact_pattern,
                    'matcher_keyword_pattern', NEW.matcher_keyword_pattern,
                    'project_key', NEW.project_key,
                    'project_name', NEW.project_name,
                    'task_key', NEW.task_key,
                    'task_name', NEW.task_name,
                    'priority', NEW.priority,
                    'enabled', NEW.enabled,
                    'created_at', NEW.created_at,
                    'updated_at', NEW.updated_at
                ),
                'pending', 0, NULL, NULL, COALESCE(NEW.created_at, CAST(strftime('%s','now') AS INTEGER) * 1000), CAST(strftime('%s','now') AS INTEGER) * 1000
            )
            ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                payload_json = excluded.payload_json,
                status = 'pending',
                retry_count = 0,
                next_retry_at = NULL,
                last_error = NULL,
                updated_at = excluded.updated_at;
        END;
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

async fn suppress_legacy_raw_memory_cloud_sync(conn: &Connection) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        r#"
        UPDATE cloud_sync_outbox
        SET status = 'dead_letter',
            next_retry_at = NULL,
            last_error = 'raw_memory_cloud_sync_disabled',
            updated_at = ?
        WHERE entity_type IN ('context_session', 'context_snapshot', 'session_retrieval_doc')
          AND status IN ('pending', 'failed', 'uploading')
        "#,
        libsql::params![now],
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    conn.execute(
        r#"
        DELETE FROM cloud_sync_outbox
        WHERE entity_type IN ('context_session', 'context_snapshot', 'session_retrieval_doc')
          AND status = 'uploaded'
        "#,
        (),
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

/// Create FTS5 tables and triggers for full-text search
async fn create_fts_tables(conn: &Connection) -> Result<()> {
    debug!("Creating FTS tables");

    // Create FTS virtual table
    conn.execute(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS ocr_frames_fts USING fts5(
            ocr_text,
            app_name,
            window_title,
            content='ocr_frames',
            content_rowid='id'
        )
        "#,
        (),
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    // Create triggers to keep FTS in sync
    // Note: These may fail if triggers already exist, which is fine
    let _ = conn
        .execute(
            r#"
        CREATE TRIGGER IF NOT EXISTS ocr_frames_ai AFTER INSERT ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(rowid, ocr_text, app_name, window_title)
            VALUES (new.id, new.ocr_text, new.app_name, new.window_title);
        END
        "#,
            (),
        )
        .await;

    let _ = conn
        .execute(
            r#"
        CREATE TRIGGER IF NOT EXISTS ocr_frames_ad AFTER DELETE ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(ocr_frames_fts, rowid, ocr_text, app_name, window_title)
            VALUES ('delete', old.id, old.ocr_text, old.app_name, old.window_title);
        END
        "#,
            (),
        )
        .await;

    let _ = conn
        .execute(
            r#"
        CREATE TRIGGER IF NOT EXISTS ocr_frames_au AFTER UPDATE ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(ocr_frames_fts, rowid, ocr_text, app_name, window_title)
            VALUES ('delete', old.id, old.ocr_text, old.app_name, old.window_title);
            INSERT INTO ocr_frames_fts(rowid, ocr_text, app_name, window_title)
            VALUES (new.id, new.ocr_text, new.app_name, new.window_title);
        END
        "#,
            (),
        )
        .await;

    // Existing databases may already have rows in ocr_frames before FTS triggers existed.
    // Rebuild once when the FTS index is empty so historical rows become searchable.
    backfill_fts_if_needed(conn).await?;

    Ok(())
}

async fn backfill_fts_if_needed(conn: &Connection) -> Result<()> {
    let frame_count = count_rows(conn, "ocr_frames").await?;
    if frame_count == 0 {
        return Ok(());
    }

    if needs_fts_rebuild(conn).await? {
        info!(
            frame_count = frame_count,
            "FTS index appears stale, rebuilding index from ocr_frames"
        );
        conn.execute(
            "INSERT INTO ocr_frames_fts(ocr_frames_fts) VALUES('rebuild')",
            (),
        )
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?;
    }

    Ok(())
}

async fn needs_fts_rebuild(conn: &Connection) -> Result<bool> {
    let mut probe_rows = conn.query(
        "SELECT id, ocr_text FROM ocr_frames WHERE ocr_text IS NOT NULL AND ocr_text != '' LIMIT 1",
        ()
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;

    if let Some(row) = probe_rows
        .next()
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?
    {
        let row_id: i64 = row.get(0).unwrap_or(0);
        let text: String = row.get(1).unwrap_or_default();
        if let Some(token) = extract_probe_token(&text) {
            let mut match_rows = conn.query(
                "SELECT 1 FROM ocr_frames_fts WHERE rowid = ? AND ocr_frames_fts MATCH ? LIMIT 1",
                libsql::params![row_id, token]
            ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;

            return Ok(match_rows
                .next()
                .await
                .map_err(|e| DatabaseError::Schema(e.to_string()))?
                .is_none());
        }
    }

    Ok(count_rows(conn, "ocr_frames_fts").await? == 0)
}

fn extract_probe_token(text: &str) -> Option<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .find(|token| token.len() >= 3)
        .map(|token| token.to_lowercase())
}

async fn count_rows(conn: &Connection, table: &str) -> Result<i64> {
    let sql = format!("SELECT COUNT(*) FROM {}", table);
    let mut rows = conn
        .query(&sql, ())
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    let count = rows
        .next()
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?
        .map(|row| row.get::<i64>(0).unwrap_or(0))
        .unwrap_or(0);

    Ok(count)
}

/// Record the schema version in the migrations table
async fn record_schema_version(conn: &Connection, version: i32) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT OR REPLACE INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)",
        libsql::params![version, now, format!("Schema v{}", version)]
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

/// Apply migrations for existing databases
/// This adds columns that may be missing from older schema versions
async fn apply_migrations(conn: &Connection) -> Result<()> {
    debug!("Applying schema migrations...");

    // Migration: Add activity_segments table if missing
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS activity_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            app_bundle_id TEXT,
            app_name TEXT,
            window_title_normalized TEXT,
            browser_domain TEXT,
            segment_kind TEXT DEFAULT 'work',
            duration_ms INTEGER NOT NULL,
            frame_count INTEGER DEFAULT 0,
            key_topics TEXT,
            created_at INTEGER NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS segment_frames (
            segment_id INTEGER NOT NULL,
            frame_id INTEGER NOT NULL,
            PRIMARY KEY (segment_id, frame_id),
            FOREIGN KEY (segment_id) REFERENCES activity_segments(id) ON DELETE CASCADE,
            FOREIGN KEY (frame_id) REFERENCES ocr_frames(id) ON DELETE CASCADE
        );
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    // Migration v3: Add text processing columns to ocr_frames
    // summary - extractive summary of OCR text
    let _ = add_column_if_missing(conn, "ocr_frames", "summary", "TEXT").await;

    // activity_type - classified activity type (coding, browsing, etc.)
    let _ = add_column_if_missing(conn, "ocr_frames", "activity_type", "TEXT").await;

    // keywords - JSON array of extracted keywords
    let _ = add_column_if_missing(conn, "ocr_frames", "keywords", "TEXT").await;

    // text_quality - quality score (0.0-1.0) for filtering
    let _ = add_column_if_missing(conn, "ocr_frames", "text_quality", "REAL DEFAULT 0.0").await;

    // Create index on activity_type for filtering
    let _ = conn
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_ocr_frames_activity_type ON ocr_frames(activity_type)",
            (),
        )
        .await;

    // Migration v4: local context evidence tables/indexes
    create_memory_pipeline_tables(conn).await?;
    add_column_if_missing(conn, "context_snapshots", "capture_components_json", "TEXT").await?;
    add_column_if_missing(
        conn,
        "context_snapshots",
        "ax_richness_score",
        "REAL NOT NULL DEFAULT 0.0",
    )
    .await?;
    add_column_if_missing(
        conn,
        "context_snapshots",
        "selected_text_present",
        "INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    add_column_if_missing(conn, "context_snapshots", "document_path", "TEXT").await?;
    add_column_if_missing(conn, "context_snapshots", "ax_source", "TEXT").await?;
    add_column_if_missing(conn, "context_snapshots", "capture_trigger", "TEXT").await?;
    add_column_if_missing(
        conn,
        "context_snapshots",
        "trigger_to_snapshot_ms",
        "INTEGER",
    )
    .await?;
    add_column_if_missing(conn, "context_snapshots", "ui_elements_json", "TEXT").await?;
    let _ = conn
        .execute(
            "CREATE INDEX IF NOT EXISTS idx_context_snapshots_ts ON context_snapshots(ts)",
            (),
        )
        .await;
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_context_snapshots_app_ts ON context_snapshots(app_bundle_id, ts)",
        ()
    ).await;
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_context_snapshots_domain_ts ON context_snapshots(browser_domain, ts)",
        ()
    ).await;
    let _ = conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_context_snapshots_dedup ON context_snapshots(dedup_key)",
        ()
    ).await;
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_context_snapshots_session_ts ON context_snapshots(session_id, ts)",
        ()
    ).await;
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_context_sessions_time ON context_sessions(start_ts, end_ts)",
        ()
    ).await;
    add_column_if_missing(conn, "activity_events", "event_uid", "TEXT NOT NULL DEFAULT ''").await?;
    add_column_if_missing(conn, "afk_events", "afk_uid", "TEXT NOT NULL DEFAULT ''").await?;
    add_column_if_missing(conn, "context_sessions", "session_uid", "TEXT NOT NULL DEFAULT ''")
        .await?;
    add_column_if_missing(conn, "context_snapshots", "activity_event_uid", "TEXT").await?;
    add_column_if_missing(conn, "context_snapshots", "session_uid", "TEXT").await?;
    create_sync_tables(conn).await?;

    let _ = conn
        .execute(
            r#"
        UPDATE activity_events
        SET event_uid = printf(
            'legacy-activity:%s:%s:%lld',
            COALESCE(device_id, ''),
            COALESCE(user_id, ''),
            id
        )
        WHERE event_uid IS NULL OR TRIM(event_uid) = ''
        "#,
            (),
        )
        .await;

    let _ = conn
        .execute(
            r#"
        UPDATE afk_events
        SET afk_uid = printf(
            'legacy-afk:%s:%s:%lld',
            COALESCE(device_id, ''),
            COALESCE(user_id, ''),
            id
        )
        WHERE afk_uid IS NULL OR TRIM(afk_uid) = ''
        "#,
            (),
        )
        .await;

    let _ = conn
        .execute(
            r#"
        UPDATE context_sessions
        SET session_uid = printf(
            'legacy-session:%s:%s:%lld',
            COALESCE(device_id, ''),
            COALESCE(user_id, ''),
            id
        )
        WHERE session_uid IS NULL OR TRIM(session_uid) = ''
        "#,
            (),
        )
        .await;

    let _ = conn
        .execute(
            r#"
        UPDATE context_snapshots
        SET activity_event_uid = (
            SELECT activity_events.event_uid
            FROM activity_events
            WHERE activity_events.id = context_snapshots.activity_event_id
        )
        WHERE activity_event_id IS NOT NULL
          AND (activity_event_uid IS NULL OR TRIM(activity_event_uid) = '')
        "#,
            (),
        )
        .await;

    let _ = conn
        .execute(
            r#"
        UPDATE context_snapshots
        SET session_uid = (
            SELECT context_sessions.session_uid
            FROM context_sessions
            WHERE context_sessions.id = context_snapshots.session_id
        )
        WHERE session_id IS NOT NULL
          AND (session_uid IS NULL OR TRIM(session_uid) = '')
        "#,
            (),
        )
        .await;

    backfill_cloud_sync_outbox(conn).await?;

    debug!("Schema migrations complete");
    Ok(())
}

/// Helper to add a column if it doesn't exist
async fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<()> {
    // Check if column exists by querying table_info
    let query = format!("PRAGMA table_info({})", table);
    let mut rows = conn
        .query(&query, ())
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    let mut column_exists = false;
    while let Some(row) = rows
        .next()
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?
    {
        let col_name: String = row.get(1).unwrap_or_default();
        if col_name == column {
            column_exists = true;
            break;
        }
    }

    if !column_exists {
        let alter_sql = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition);
        info!("Adding missing column: {}.{}", table, column);
        conn.execute(&alter_sql, ())
            .await
            .map_err(|e| DatabaseError::Schema(e.to_string()))?;
    }

    Ok(())
}

async fn backfill_cloud_sync_outbox(conn: &Connection) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        r#"
        INSERT OR IGNORE INTO cloud_sync_outbox (
            user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
            status, retry_count, next_retry_at, last_error, created_at, updated_at
        )
        SELECT
            user_id,
            device_id,
            'activity_event',
            event_uid,
            'upsert',
            json_object(
                'id', id,
                'event_uid', event_uid,
                'device_id', device_id,
                'user_id', user_id,
                'ts_start', ts_start,
                'ts_end', ts_end,
                'app_bundle_id', app_bundle_id,
                'app_name', app_name,
                'window_title', window_title,
                'window_title_hash', window_title_hash,
                'window_owner_pid', window_owner_pid,
                'is_afk', is_afk,
                'browser_url', browser_url,
                'browser_domain', browser_domain,
                'is_incognito', is_incognito,
                'source', source,
                'created_at', created_at
            ),
            'pending',
            0,
            NULL,
            NULL,
            created_at,
            ?
        FROM activity_events
        WHERE TRIM(COALESCE(event_uid, '')) != ''
        "#,
        libsql::params![now],
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    conn.execute(
        r#"
        INSERT OR IGNORE INTO cloud_sync_outbox (
            user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
            status, retry_count, next_retry_at, last_error, created_at, updated_at
        )
        SELECT
            user_id,
            device_id,
            'afk_event',
            afk_uid,
            'upsert',
            json_object(
                'id', id,
                'afk_uid', afk_uid,
                'device_id', device_id,
                'user_id', user_id,
                'ts_start', ts_start,
                'ts_end', ts_end,
                'status', status,
                'created_at', created_at
            ),
            'pending',
            0,
            NULL,
            NULL,
            created_at,
            ?
        FROM afk_events
        WHERE TRIM(COALESCE(afk_uid, '')) != ''
        "#,
        libsql::params![now],
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

/// Get the current schema version from the database
pub async fn get_schema_version(conn: &Connection) -> Result<Option<i32>> {
    let mut rows = conn
        .query("SELECT MAX(version) FROM schema_migrations", ())
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    if let Some(row) = rows
        .next()
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?
    {
        let version: Option<i32> = row.get(0).ok();
        Ok(version)
    } else {
        Ok(None)
    }
}

/// Check if the schema needs to be updated
pub async fn needs_schema_update(conn: &Connection) -> Result<bool> {
    let current = get_schema_version(conn).await?;
    Ok(current.map(|v| v < SCHEMA_VERSION).unwrap_or(true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use libsql::Builder;
    use tempfile::TempDir;

    async fn create_test_db() -> (Connection, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");

        let db = Builder::new_local(db_path.to_str().unwrap())
            .build()
            .await
            .unwrap();

        let conn = db.connect().unwrap();
        (conn, temp_dir)
    }

    #[tokio::test]
    async fn test_schema_initialization() {
        let (conn, _temp) = create_test_db().await;

        initialize_schema(&conn).await.unwrap();

        // Verify tables exist
        let mut rows = conn
            .query(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
                (),
            )
            .await
            .unwrap();

        let mut tables = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            let name: String = row.get(0).unwrap();
            tables.push(name);
        }

        assert!(tables.contains(&"activity_events".to_string()));
        assert!(tables.contains(&"ocr_frames".to_string()));
        assert!(tables.contains(&"video_chunks".to_string()));
        assert!(tables.contains(&"sync_queue".to_string()));
        assert!(!tables.contains(&"ocr_embeddings".to_string()));
        assert!(!tables.contains(&"memory_upload_outbox".to_string()));
        assert!(!tables.contains(&"session_retrieval_docs".to_string()));
    }

    #[tokio::test]
    async fn test_schema_version() {
        let (conn, _temp) = create_test_db().await;

        initialize_schema(&conn).await.unwrap();

        let version = get_schema_version(&conn).await.unwrap();
        assert_eq!(version, Some(SCHEMA_VERSION));
    }

    #[tokio::test]
    async fn test_schema_idempotent() {
        let (conn, _temp) = create_test_db().await;

        // Initialize twice - should not fail
        initialize_schema(&conn).await.unwrap();
        initialize_schema(&conn).await.unwrap();

        let version = get_schema_version(&conn).await.unwrap();
        assert_eq!(version, Some(SCHEMA_VERSION));
    }

    #[tokio::test]
    async fn test_schema_suppresses_legacy_raw_memory_cloud_sync() {
        let (conn, _temp) = create_test_db().await;

        initialize_schema(&conn).await.unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE memory_upload_outbox (id INTEGER PRIMARY KEY);
            CREATE TABLE session_retrieval_docs (id INTEGER PRIMARY KEY);
            CREATE TABLE embedding_worker_state (id INTEGER PRIMARY KEY);
            INSERT INTO memory_upload_outbox (id) VALUES (1);
            INSERT INTO session_retrieval_docs (id) VALUES (1);
            INSERT INTO embedding_worker_state (id) VALUES (1);
            "#,
        )
        .await
        .unwrap();

        for (entity_type, entity_uid, status) in [
            ("context_session", "legacy-session-1", "pending"),
            ("context_snapshot", "legacy-snapshot-1", "failed"),
            ("session_retrieval_doc", "legacy-doc-1", "uploading"),
            ("context_snapshot", "legacy-snapshot-2", "uploaded"),
            ("activity_event", "activity-1", "pending"),
        ] {
            conn.execute(
                r#"
                INSERT INTO cloud_sync_outbox (
                    user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                    status, retry_count, next_retry_at, last_error, created_at, updated_at
                ) VALUES ('user', 'device', ?, ?, 'upsert', '{}', ?, 0, NULL, NULL, 1, 1)
                "#,
                libsql::params![entity_type, entity_uid, status],
            )
            .await
            .unwrap();
        }

        initialize_schema(&conn).await.unwrap();

        let raw_active = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type IN ('context_session', 'context_snapshot', 'session_retrieval_doc') AND status IN ('pending', 'failed', 'uploading')",
        )
        .await;
        assert_eq!(raw_active, 0);

        let raw_uploaded = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type IN ('context_session', 'context_snapshot', 'session_retrieval_doc') AND status = 'uploaded'",
        )
        .await;
        assert_eq!(raw_uploaded, 0);

        let raw_dead_letter = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type IN ('context_session', 'context_snapshot', 'session_retrieval_doc') AND status = 'dead_letter' AND last_error = 'raw_memory_cloud_sync_disabled'",
        )
        .await;
        assert_eq!(raw_dead_letter, 3);

        let activity_pending = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type = 'activity_event' AND status = 'pending'",
        )
        .await;
        assert_eq!(activity_pending, 1);

        let legacy_tables = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('memory_upload_outbox', 'session_retrieval_docs', 'embedding_worker_state')",
        )
        .await;
        assert_eq!(legacy_tables, 3);
    }

    #[tokio::test]
    async fn test_fts_backfill_rebuilds_index_for_existing_frames() {
        let (conn, _temp) = create_test_db().await;
        initialize_schema(&conn).await.unwrap();

        conn.execute(
            r#"
            INSERT INTO ocr_frames (
                timestamp, app_bundle_id, app_name, ocr_text, image_hash
            ) VALUES (?, ?, ?, ?, ?)
            "#,
            libsql::params![
                1234i64,
                "com.test.app",
                "Test App",
                "backfill search term",
                "hash-backfill"
            ],
        )
        .await
        .unwrap();

        // Simulate a legacy DB with missing FTS index content.
        conn.execute(
            "INSERT INTO ocr_frames_fts(ocr_frames_fts) VALUES('delete-all')",
            (),
        )
        .await
        .unwrap();

        // Re-running initialization should trigger backfill rebuild.
        initialize_schema(&conn).await.unwrap();

        let mut rows = conn
            .query(
                "SELECT COUNT(*) FROM ocr_frames_fts WHERE ocr_frames_fts MATCH ?",
                libsql::params!["backfill"],
            )
            .await
            .unwrap();
        let matched = rows
            .next()
            .await
            .unwrap()
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);

        assert_eq!(matched, 1);
    }

    async fn count_matching_rows(conn: &Connection, sql: &str) -> i64 {
        let mut rows = conn.query(sql, ()).await.unwrap();
        rows.next()
            .await
            .unwrap()
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0)
    }
}
