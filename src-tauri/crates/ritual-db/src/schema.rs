//! Database schema definitions for Ritual
//!
//! This module contains all SQL statements for creating and maintaining
//! the database schema. It consolidates:
//! - Activity events (from watcher.db)
//! - OCR frames and video chunks (from frames.db)
//! - Sync queue (from sync_queue.db)
//! - Vector embeddings (NEW)

use libsql::Connection;
use tracing::{debug, info};

use crate::error::{DatabaseError, Result};

/// Current schema version - increment when making breaking changes
pub const SCHEMA_VERSION: i32 = 3;

/// Initialize the complete database schema
pub async fn initialize_schema(conn: &Connection) -> Result<()> {
    info!("Initializing Ritual database schema v{}", SCHEMA_VERSION);
    
    // Create tables in dependency order
    create_metadata_tables(conn).await?;
    create_activity_tables(conn).await?;
    create_recorder_tables(conn).await?;
    create_sync_tables(conn).await?;
    create_vector_tables(conn).await?;
    
    // Create indexes
    create_indexes(conn).await?;
    
    // Create FTS tables and triggers
    create_fts_tables(conn).await?;
    
    // Apply any pending migrations for existing databases
    apply_migrations(conn).await?;
    
    // Record schema version
    record_schema_version(conn, SCHEMA_VERSION).await?;
    
    info!("Schema initialization complete");
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
        "#
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
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
        "#
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
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
        "#
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
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
            segment_embedding F32_BLOB(384),
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
        "#
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
    Ok(())
}

/// Create vector embedding tables
async fn create_vector_tables(conn: &Connection) -> Result<()> {
    debug!("Creating vector tables");
    
    conn.execute_batch(
        r#"
        -- OCR embeddings for semantic search
        -- Using F32_BLOB(384) for all-MiniLM-L6-v2 embeddings
        CREATE TABLE IF NOT EXISTS ocr_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            frame_id INTEGER NOT NULL UNIQUE,
            embedding F32_BLOB(384),
            model_version TEXT DEFAULT 'all-MiniLM-L6-v2',
            status TEXT DEFAULT 'ok',
            error_message TEXT,
            retry_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (frame_id) REFERENCES ocr_frames(id) ON DELETE CASCADE
        );
        
        -- Embedding worker state tracking
        CREATE TABLE IF NOT EXISTS embedding_worker_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_running INTEGER DEFAULT 0,
            last_run_at INTEGER,
            frames_processed INTEGER DEFAULT 0,
            frames_failed INTEGER DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
        
        -- Initialize worker state row if not exists
        INSERT OR IGNORE INTO embedding_worker_state (id, updated_at) VALUES (1, 0);
        "#
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
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

        -- AFK event indexes
        CREATE INDEX IF NOT EXISTS idx_afk_events_device_ts 
            ON afk_events(device_id, ts_start);
        
        CREATE INDEX IF NOT EXISTS idx_afk_events_user_device_ts 
            ON afk_events(user_id, device_id, ts_start);

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

        -- Vector embedding indexes
        CREATE INDEX IF NOT EXISTS idx_ocr_embeddings_frame 
            ON ocr_embeddings(frame_id);
        
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
        "#
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
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
        ()
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
    // Create triggers to keep FTS in sync
    // Note: These may fail if triggers already exist, which is fine
    let _ = conn.execute(
        r#"
        CREATE TRIGGER IF NOT EXISTS ocr_frames_ai AFTER INSERT ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(rowid, ocr_text, app_name, window_title)
            VALUES (new.id, new.ocr_text, new.app_name, new.window_title);
        END
        "#,
        ()
    ).await;
    
    let _ = conn.execute(
        r#"
        CREATE TRIGGER IF NOT EXISTS ocr_frames_ad AFTER DELETE ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(ocr_frames_fts, rowid, ocr_text, app_name, window_title)
            VALUES ('delete', old.id, old.ocr_text, old.app_name, old.window_title);
        END
        "#,
        ()
    ).await;
    
    let _ = conn.execute(
        r#"
        CREATE TRIGGER IF NOT EXISTS ocr_frames_au AFTER UPDATE ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(ocr_frames_fts, rowid, ocr_text, app_name, window_title)
            VALUES ('delete', old.id, old.ocr_text, old.app_name, old.window_title);
            INSERT INTO ocr_frames_fts(rowid, ocr_text, app_name, window_title)
            VALUES (new.id, new.ocr_text, new.app_name, new.window_title);
        END
        "#,
        ()
    ).await;
    
    Ok(())
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
    
    // Migration: Add status, error_message, retry_count to ocr_embeddings
    // These columns were added in schema v2
    let _ = add_column_if_missing(
        conn, 
        "ocr_embeddings", 
        "status", 
        "TEXT DEFAULT 'ok'"
    ).await;
    
    let _ = add_column_if_missing(
        conn, 
        "ocr_embeddings", 
        "error_message", 
        "TEXT"
    ).await;
    
    let _ = add_column_if_missing(
        conn, 
        "ocr_embeddings", 
        "retry_count", 
        "INTEGER DEFAULT 0"
    ).await;
    
    // Migration: Add embedding_worker_state table if missing
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS embedding_worker_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_running INTEGER DEFAULT 0,
            last_run_at INTEGER,
            frames_processed INTEGER DEFAULT 0,
            frames_failed INTEGER DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
        "#
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
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
            segment_embedding F32_BLOB(384),
            created_at INTEGER NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS segment_frames (
            segment_id INTEGER NOT NULL,
            frame_id INTEGER NOT NULL,
            PRIMARY KEY (segment_id, frame_id),
            FOREIGN KEY (segment_id) REFERENCES activity_segments(id) ON DELETE CASCADE,
            FOREIGN KEY (frame_id) REFERENCES ocr_frames(id) ON DELETE CASCADE
        );
        "#
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
    // Migration v3: Add text processing columns to ocr_frames
    // summary - extractive summary of OCR text
    let _ = add_column_if_missing(
        conn,
        "ocr_frames",
        "summary",
        "TEXT"
    ).await;
    
    // activity_type - classified activity type (coding, browsing, etc.)
    let _ = add_column_if_missing(
        conn,
        "ocr_frames",
        "activity_type",
        "TEXT"
    ).await;
    
    // keywords - JSON array of extracted keywords
    let _ = add_column_if_missing(
        conn,
        "ocr_frames",
        "keywords",
        "TEXT"
    ).await;
    
    // text_quality - quality score (0.0-1.0) for filtering
    let _ = add_column_if_missing(
        conn,
        "ocr_frames",
        "text_quality",
        "REAL DEFAULT 0.0"
    ).await;
    
    // Create index on activity_type for filtering
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ocr_frames_activity_type ON ocr_frames(activity_type)",
        ()
    ).await;
    
    debug!("Schema migrations complete");
    Ok(())
}

/// Helper to add a column if it doesn't exist
async fn add_column_if_missing(
    conn: &Connection, 
    table: &str, 
    column: &str, 
    definition: &str
) -> Result<()> {
    // Check if column exists by querying table_info
    let query = format!("PRAGMA table_info({})", table);
    let mut rows = conn.query(&query, ()).await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
    let mut column_exists = false;
    while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Schema(e.to_string()))? {
        let col_name: String = row.get(1).unwrap_or_default();
        if col_name == column {
            column_exists = true;
            break;
        }
    }
    
    if !column_exists {
        let alter_sql = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition);
        info!("Adding missing column: {}.{}", table, column);
        conn.execute(&alter_sql, ()).await
            .map_err(|e| DatabaseError::Schema(e.to_string()))?;
    }
    
    Ok(())
}

/// Get the current schema version from the database
pub async fn get_schema_version(conn: &Connection) -> Result<Option<i32>> {
    let mut rows = conn
        .query("SELECT MAX(version) FROM schema_migrations", ())
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?;
    
    if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Schema(e.to_string()))? {
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
        let mut rows = conn.query(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
            ()
        ).await.unwrap();
        
        let mut tables = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            let name: String = row.get(0).unwrap();
            tables.push(name);
        }
        
        assert!(tables.contains(&"activity_events".to_string()));
        assert!(tables.contains(&"ocr_frames".to_string()));
        assert!(tables.contains(&"video_chunks".to_string()));
        assert!(tables.contains(&"sync_queue".to_string()));
        assert!(tables.contains(&"ocr_embeddings".to_string()));
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
}
