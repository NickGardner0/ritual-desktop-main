use libsql::Connection;
use tracing::debug;

use crate::error::{DatabaseError, Result};

/// Create recorder tables (OCR frames, video chunks)
pub(super) async fn create_recorder_tables(conn: &Connection) -> Result<()> {
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
