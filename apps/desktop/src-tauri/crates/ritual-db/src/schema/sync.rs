use libsql::Connection;
use tracing::debug;

use crate::error::{DatabaseError, Result};

pub(super) async fn create_sync_tables(conn: &Connection) -> Result<()> {
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
pub(super) async fn create_indexes(conn: &Connection) -> Result<()> {
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

pub(super) async fn create_cloud_sync_triggers(conn: &Connection) -> Result<()> {
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

pub(super) async fn suppress_legacy_raw_memory_cloud_sync(conn: &Connection) -> Result<()> {
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
