use libsql::Connection;
use tracing::{debug, info};

use crate::error::{DatabaseError, Result};

pub(super) async fn record_schema_version(conn: &Connection, version: i32) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT OR REPLACE INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)",
        libsql::params![version, now, format!("Schema v{}", version)]
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}

/// Apply migrations for existing databases
/// This adds columns that may be missing from older schema versions
pub(super) async fn apply_migrations(conn: &Connection) -> Result<()> {
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
    super::memory::create_memory_pipeline_tables(conn).await?;
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
    add_column_if_missing(
        conn,
        "activity_events",
        "biome_is_provisional",
        "INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    add_column_if_missing(conn, "afk_events", "afk_uid", "TEXT NOT NULL DEFAULT ''").await?;
    add_column_if_missing(conn, "context_sessions", "session_uid", "TEXT NOT NULL DEFAULT ''")
        .await?;
    add_column_if_missing(conn, "context_snapshots", "activity_event_uid", "TEXT").await?;
    add_column_if_missing(conn, "context_snapshots", "session_uid", "TEXT").await?;
    super::sync::create_sync_tables(conn).await?;

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
    Ok(current.map(|v| v < super::SCHEMA_VERSION).unwrap_or(true))
}

