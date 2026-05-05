//! Migration logic for moving from legacy SQLite databases to unified libSQL
//!
//! This module handles:
//! - Detecting existing legacy databases (watcher.db, frames.db, sync_queue.db)
//! - Migrating data in batches to avoid memory issues
//! - Verifying migration completeness
//! - Backing up legacy databases

use libsql::Connection;
use rusqlite::Connection as SqliteConn;
use std::path::{Path, PathBuf};
use tracing::{debug, error, info, warn};

use crate::error::{DatabaseError, Result};
use crate::types::MigrationResult;

/// Batch size for migration (to avoid memory issues with large databases)
const MIGRATION_BATCH_SIZE: usize = 1000;
const SOURCE_MISMATCH_THRESHOLD_MS: i64 = 60_000;
const RESYNC_TAIL_WINDOW_MS: i64 = 5 * 60 * 1000;

/// Check for legacy databases and migrate if needed
pub async fn migrate_if_needed(conn: &Connection, data_dir: &Path) -> Result<()> {
    let watcher_db = data_dir.join("watcher.db");
    let frames_db = data_dir.join("frames.db");
    let sync_queue_db = data_dir.join("sync_queue.db");

    // Check if any legacy databases exist
    let has_watcher = watcher_db.exists();
    let has_frames = frames_db.exists();
    let has_sync = sync_queue_db.exists();

    if !has_watcher && !has_frames && !has_sync {
        debug!("No legacy databases found, skipping migration");
        return Ok(());
    }

    // Check if migration was already completed
    if is_migration_complete(conn).await? {
        debug!("Migration already completed");
        if has_frames {
            let _ = resync_legacy_tail(conn, &frames_db).await;
        }
        return Ok(());
    }

    info!("Starting migration from legacy SQLite databases...");
    info!(
        "  watcher.db: {}",
        if has_watcher { "found" } else { "not found" }
    );
    info!(
        "  frames.db: {}",
        if has_frames { "found" } else { "not found" }
    );
    info!(
        "  sync_queue.db: {}",
        if has_sync { "found" } else { "not found" }
    );

    // Disable foreign key enforcement during migration since source IDs
    // may not match auto-generated target IDs
    let _ = conn.execute("PRAGMA foreign_keys = OFF", ()).await;

    let mut result = MigrationResult::default();

    // Migrate watcher database
    if has_watcher {
        match migrate_watcher_db(conn, &watcher_db).await {
            Ok((activity_count, afk_count)) => {
                result.activity_events_migrated = activity_count;
                result.afk_events_migrated = afk_count;
                info!(
                    "  Migrated {} activity events, {} AFK events",
                    activity_count, afk_count
                );
            }
            Err(e) => {
                error!("Failed to migrate watcher.db: {}", e);
                result.errors.push(format!("watcher.db: {}", e));
            }
        }
    }

    // Migrate frames database
    if has_frames {
        match migrate_frames_db(conn, &frames_db).await {
            Ok((frame_count, chunk_count)) => {
                result.ocr_frames_migrated = frame_count;
                result.video_chunks_migrated = chunk_count;
                info!(
                    "  Migrated {} OCR frames, {} video chunks",
                    frame_count, chunk_count
                );
            }
            Err(e) => {
                error!("Failed to migrate frames.db: {}", e);
                result.errors.push(format!("frames.db: {}", e));
            }
        }
    }

    // Migrate sync queue database
    if has_sync {
        match migrate_sync_queue_db(conn, &sync_queue_db).await {
            Ok(count) => {
                result.sync_queue_migrated = count;
                info!("  Migrated {} sync queue items", count);
            }
            Err(e) => {
                error!("Failed to migrate sync_queue.db: {}", e);
                result.errors.push(format!("sync_queue.db: {}", e));
            }
        }
    }

    // Re-enable foreign key enforcement
    let _ = conn.execute("PRAGMA foreign_keys = ON", ()).await;

    if result.is_success() {
        backup_legacy_databases(data_dir, &mut result)?;
        info!(
            "Migration completed successfully! Total: {} records",
            result.total_migrated()
        );
        mark_migration_complete(conn).await?;
    } else {
        warn!(
            "Migration completed with errors (will retry on next startup): {:?}",
            result.errors
        );
        return Ok(());
    }

    if has_frames {
        let _ = resync_legacy_tail(conn, &frames_db).await;
    }

    Ok(())
}

/// Check if migration has already been completed
async fn is_migration_complete(conn: &Connection) -> Result<bool> {
    let mut rows = conn
        .query(
            "SELECT 1 FROM schema_migrations WHERE description = 'legacy_migration_complete'",
            (),
        )
        .await
        .map_err(|e| DatabaseError::Migration(e.to_string()))?;

    Ok(rows
        .next()
        .await
        .map_err(|e| DatabaseError::Migration(e.to_string()))?
        .is_some())
}

/// Mark migration as complete
async fn mark_migration_complete(conn: &Connection) -> Result<()> {
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)",
        libsql::params![0, now, "legacy_migration_complete"],
    )
    .await
    .map_err(|e| DatabaseError::Migration(e.to_string()))?;

    Ok(())
}

async fn get_max_i64(conn: &Connection, sql: &str) -> Result<Option<i64>> {
    let mut rows = conn
        .query(sql, ())
        .await
        .map_err(|e| DatabaseError::Migration(e.to_string()))?;
    Ok(rows
        .next()
        .await
        .map_err(|e| DatabaseError::Migration(e.to_string()))?
        .and_then(|row| row.get::<i64>(0).ok()))
}

async fn resync_legacy_tail(conn: &Connection, frames_db_path: &Path) -> Result<()> {
    if !frames_db_path.exists() {
        return Ok(());
    }

    let target_latest = get_max_i64(conn, "SELECT MAX(timestamp) FROM ocr_frames")
        .await?
        .unwrap_or(0);

    let source = SqliteConn::open(frames_db_path)?;
    let has_source_ocr_table: bool = source.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ocr_frames'",
        [],
        |row| row.get::<_, i32>(0).map(|count| count > 0),
    )?;
    if !has_source_ocr_table {
        return Ok(());
    }

    let source_latest: i64 = source.query_row(
        "SELECT COALESCE(MAX(timestamp), 0) FROM ocr_frames",
        [],
        |row| row.get::<_, i64>(0),
    )?;

    if source_latest <= target_latest + SOURCE_MISMATCH_THRESHOLD_MS {
        return Ok(());
    }

    let tail_start = target_latest.saturating_sub(RESYNC_TAIL_WINDOW_MS);
    let has_source_video_chunks: bool = source.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='video_chunks'",
        [],
        |row| row.get::<_, i32>(0).map(|count| count > 0),
    )?;
    if has_source_video_chunks {
        let mut video_stmt = source.prepare(
            r#"
            SELECT file_path, start_time, end_time, frame_count, file_size_bytes, monitor_id, storage_tier, created_at
            FROM video_chunks
            WHERE start_time >= ?
            ORDER BY start_time ASC
            "#,
        )?;
        let video_rows = video_stmt.query_map([tail_start], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, u32>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })?;

        for row_result in video_rows {
            let row = row_result?;
            conn.execute(
                r#"
                INSERT OR IGNORE INTO video_chunks
                (file_path, start_time, end_time, frame_count, file_size_bytes, monitor_id, storage_tier, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                "#,
                libsql::params![
                    row.0.clone(),
                    row.1,
                    row.2,
                    row.3,
                    row.4,
                    row.5 as i64,
                    row.6.clone(),
                    row.7.clone(),
                ],
            ).await.map_err(|e| DatabaseError::Migration(e.to_string()))?;
        }
    }

    let mut frame_stmt = source.prepare(
        r#"
        SELECT timestamp, activity_event_id, app_bundle_id, app_name, window_title,
               ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
               image_hash, storage_tier, created_at
        FROM ocr_frames
        WHERE timestamp >= ?
        ORDER BY timestamp ASC
        "#,
    )?;
    let frame_rows = frame_stmt.query_map([tail_start], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<i64>>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, f64>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<i64>>(8)?,
            row.get::<_, Option<i64>>(9)?,
            row.get::<_, Option<String>>(10)?,
            row.get::<_, String>(11)?,
            row.get::<_, Option<String>>(12)?,
        ))
    })?;

    for row_result in frame_rows {
        let row = row_result?;
        conn.execute(
            r#"
            INSERT INTO ocr_frames (
                timestamp, activity_event_id, app_bundle_id, app_name, window_title,
                ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
                image_hash, storage_tier, created_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
                SELECT 1 FROM ocr_frames
                WHERE timestamp = ?
                  AND COALESCE(image_hash, '') = COALESCE(?, '')
            )
            "#,
            libsql::params![
                row.0,
                row.1,
                row.2.clone(),
                row.3.clone(),
                row.4.clone(),
                row.5.clone(),
                row.6,
                row.7.clone(),
                row.8,
                row.9,
                row.10.clone(),
                row.11.clone(),
                row.12.clone(),
                row.0,
                row.10.clone(),
            ],
        )
        .await
        .map_err(|e| DatabaseError::Migration(e.to_string()))?;
    }

    Ok(())
}

/// Migrate data from watcher.db
async fn migrate_watcher_db(target: &Connection, source_path: &Path) -> Result<(i64, i64)> {
    info!("Migrating watcher database from {:?}", source_path);

    let source = SqliteConn::open(source_path)?;

    let has_activity_table = source_table_exists(&source, "activity_events")?;
    let has_heartbeat_table = source_table_exists(&source, "watcher_heartbeat")?;
    let mut afk_count = 0i64;

    // Migrate activity_events
    let activity_count = if has_activity_table {
        migrate_activity_events(target, &source).await?
    } else {
        info!("Legacy watcher.db has no activity_events table; skipping activity migration");
        0
    };

    // Migrate afk_events if table exists
    let has_afk_table = source_table_exists(&source, "afk_events")?;

    if has_afk_table {
        afk_count = migrate_afk_events(target, &source).await?;
    }

    // Migrate heartbeat
    if has_heartbeat_table {
        migrate_heartbeat(target, &source).await?;
    } else {
        info!("Legacy watcher.db has no watcher_heartbeat table; skipping heartbeat migration");
    }

    Ok((activity_count, afk_count))
}

fn source_table_exists(source: &SqliteConn, table_name: &str) -> Result<bool> {
    let count = source.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table_name],
        |row| row.get::<_, i32>(0),
    )?;
    Ok(count > 0)
}

/// Migrate activity events in batches
async fn migrate_activity_events(target: &Connection, source: &SqliteConn) -> Result<i64> {
    debug!("Migrating activity_events");

    // Check which columns exist in source
    let has_browser_url: bool = source
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('activity_events') WHERE name='browser_url'",
            [],
            |row| row.get::<_, i32>(0).map(|c| c > 0),
        )
        .unwrap_or(false);

    let query = if has_browser_url {
        r#"
        SELECT device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
               window_title, window_title_hash, window_owner_pid, is_afk,
               browser_url, browser_domain, is_incognito, source, created_at
        FROM activity_events
        ORDER BY ts_start
        "#
    } else {
        r#"
        SELECT device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
               window_title, window_title_hash, window_owner_pid, is_afk,
               NULL, NULL, 0, source, created_at
        FROM activity_events
        ORDER BY ts_start
        "#
    };

    let mut stmt = source.prepare(query)?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,          // device_id
            row.get::<_, String>(1)?,          // user_id
            row.get::<_, i64>(2)?,             // ts_start
            row.get::<_, i64>(3)?,             // ts_end
            row.get::<_, String>(4)?,          // app_bundle_id
            row.get::<_, String>(5)?,          // app_name
            row.get::<_, Option<String>>(6)?,  // window_title
            row.get::<_, Option<String>>(7)?,  // window_title_hash
            row.get::<_, Option<i32>>(8)?,     // window_owner_pid
            row.get::<_, i64>(9)?,             // is_afk
            row.get::<_, Option<String>>(10)?, // browser_url
            row.get::<_, Option<String>>(11)?, // browser_domain
            row.get::<_, i64>(12)?,            // is_incognito
            row.get::<_, String>(13)?,         // source
            row.get::<_, i64>(14)?,            // created_at
        ))
    })?;

    let mut count = 0i64;
    let mut batch = Vec::with_capacity(MIGRATION_BATCH_SIZE);

    for row_result in rows {
        let row = row_result?;
        batch.push(row);

        if batch.len() >= MIGRATION_BATCH_SIZE {
            insert_activity_batch(target, &batch).await?;
            count += batch.len() as i64;
            batch.clear();

            if count % 10000 == 0 {
                debug!("Migrated {} activity events...", count);
            }
        }
    }

    // Insert remaining
    if !batch.is_empty() {
        insert_activity_batch(target, &batch).await?;
        count += batch.len() as i64;
    }

    debug!("Migrated {} total activity events", count);
    Ok(count)
}

/// Insert a batch of activity events
async fn insert_activity_batch(
    target: &Connection,
    batch: &[(
        String,
        String,
        i64,
        i64,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<i32>,
        i64,
        Option<String>,
        Option<String>,
        i64,
        String,
        i64,
    )],
) -> Result<()> {
    for row in batch {
        target
            .execute(
                r#"
            INSERT OR IGNORE INTO activity_events (
                device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                window_title, window_title_hash, window_owner_pid, is_afk,
                browser_url, browser_domain, is_incognito, source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
                libsql::params![
                    row.0.clone(),  // device_id
                    row.1.clone(),  // user_id
                    row.2,          // ts_start
                    row.3,          // ts_end
                    row.4.clone(),  // app_bundle_id
                    row.5.clone(),  // app_name
                    row.6.clone(),  // window_title
                    row.7.clone(),  // window_title_hash
                    row.8,          // window_owner_pid
                    row.9,          // is_afk
                    row.10.clone(), // browser_url
                    row.11.clone(), // browser_domain
                    row.12,         // is_incognito
                    row.13.clone(), // source
                    row.14,         // created_at
                ],
            )
            .await
            .map_err(|e| DatabaseError::Migration(e.to_string()))?;
    }

    Ok(())
}

/// Migrate AFK events
async fn migrate_afk_events(target: &Connection, source: &SqliteConn) -> Result<i64> {
    debug!("Migrating afk_events");

    let mut stmt = source.prepare(
        "SELECT device_id, user_id, ts_start, ts_end, status, created_at FROM afk_events ORDER BY ts_start"
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?, // device_id
            row.get::<_, String>(1)?, // user_id
            row.get::<_, i64>(2)?,    // ts_start
            row.get::<_, i64>(3)?,    // ts_end
            row.get::<_, String>(4)?, // status
            row.get::<_, i64>(5)?,    // created_at
        ))
    })?;

    let mut count = 0i64;

    for row_result in rows {
        let row = row_result?;

        target.execute(
            "INSERT OR IGNORE INTO afk_events (device_id, user_id, ts_start, ts_end, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            libsql::params![row.0.clone(), row.1.clone(), row.2, row.3, row.4.clone(), row.5]
        ).await.map_err(|e| DatabaseError::Migration(e.to_string()))?;

        count += 1;
    }

    Ok(count)
}

/// Migrate heartbeat data
async fn migrate_heartbeat(target: &Connection, source: &SqliteConn) -> Result<()> {
    debug!("Migrating heartbeat");

    let mut stmt = source.prepare("SELECT device_id, last_seen_ts FROM watcher_heartbeat")?;

    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    for row_result in rows {
        let (device_id, last_seen_ts) = row_result?;

        target
            .execute(
                "INSERT OR REPLACE INTO watcher_heartbeat (device_id, last_seen_ts) VALUES (?, ?)",
                libsql::params![device_id, last_seen_ts],
            )
            .await
            .map_err(|e| DatabaseError::Migration(e.to_string()))?;
    }

    Ok(())
}

/// Migrate data from frames.db
async fn migrate_frames_db(target: &Connection, source_path: &Path) -> Result<(i64, i64)> {
    info!("Migrating frames database from {:?}", source_path);

    let source = SqliteConn::open(source_path)?;

    // Migrate video_chunks first (due to foreign key)
    let chunk_count = migrate_video_chunks(target, &source).await?;

    // Migrate ocr_frames
    let frame_count = migrate_ocr_frames(target, &source).await?;

    // Migrate recorder stats
    migrate_recorder_stats(target, &source).await?;

    Ok((frame_count, chunk_count))
}

/// Migrate video chunks
async fn migrate_video_chunks(target: &Connection, source: &SqliteConn) -> Result<i64> {
    debug!("Migrating video_chunks");

    let mut stmt = source.prepare(
        "SELECT file_path, start_time, end_time, frame_count, file_size_bytes, monitor_id, storage_tier, created_at FROM video_chunks ORDER BY start_time"
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,         // file_path
            row.get::<_, i64>(1)?,            // start_time
            row.get::<_, Option<i64>>(2)?,    // end_time
            row.get::<_, i64>(3)?,            // frame_count
            row.get::<_, Option<i64>>(4)?,    // file_size_bytes
            row.get::<_, u32>(5)?,            // monitor_id
            row.get::<_, String>(6)?,         // storage_tier
            row.get::<_, Option<String>>(7)?, // created_at
        ))
    })?;

    let mut count = 0i64;

    for row_result in rows {
        let row = row_result?;

        target.execute(
            r#"
            INSERT OR IGNORE INTO video_chunks (file_path, start_time, end_time, frame_count, file_size_bytes, monitor_id, storage_tier, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            libsql::params![
                row.0.clone(),
                row.1,
                row.2,
                row.3,
                row.4,
                row.5 as i64,
                row.6.clone(),
                row.7.clone()
            ]
        ).await.map_err(|e| DatabaseError::Migration(e.to_string()))?;

        count += 1;
    }

    Ok(count)
}

/// Migrate OCR frames in batches
async fn migrate_ocr_frames(target: &Connection, source: &SqliteConn) -> Result<i64> {
    debug!("Migrating ocr_frames");

    let mut stmt = source.prepare(
        r#"
        SELECT timestamp, activity_event_id, app_bundle_id, app_name, window_title,
               ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
               image_hash, storage_tier, created_at
        FROM ocr_frames
        ORDER BY timestamp
        "#,
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,             // timestamp
            row.get::<_, Option<i64>>(1)?,     // activity_event_id
            row.get::<_, Option<String>>(2)?,  // app_bundle_id
            row.get::<_, Option<String>>(3)?,  // app_name
            row.get::<_, Option<String>>(4)?,  // window_title
            row.get::<_, Option<String>>(5)?,  // ocr_text
            row.get::<_, f64>(6)?,             // ocr_confidence
            row.get::<_, Option<String>>(7)?,  // thumbnail_path
            row.get::<_, Option<i64>>(8)?,     // video_chunk_id
            row.get::<_, Option<i64>>(9)?,     // frame_offset
            row.get::<_, Option<String>>(10)?, // image_hash
            row.get::<_, String>(11)?,         // storage_tier
            row.get::<_, Option<String>>(12)?, // created_at
        ))
    })?;

    let mut count = 0i64;
    let mut batch = Vec::with_capacity(MIGRATION_BATCH_SIZE);

    for row_result in rows {
        let row = row_result?;
        batch.push(row);

        if batch.len() >= MIGRATION_BATCH_SIZE {
            insert_frame_batch(target, &batch).await?;
            count += batch.len() as i64;
            batch.clear();

            if count % 10000 == 0 {
                debug!("Migrated {} OCR frames...", count);
            }
        }
    }

    // Insert remaining
    if !batch.is_empty() {
        insert_frame_batch(target, &batch).await?;
        count += batch.len() as i64;
    }

    debug!("Migrated {} total OCR frames", count);
    Ok(count)
}

/// Insert a batch of OCR frames
async fn insert_frame_batch(
    target: &Connection,
    batch: &[(
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        f64,
        Option<String>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        String,
        Option<String>,
    )],
) -> Result<()> {
    for row in batch {
        target
            .execute(
                r#"
            INSERT OR IGNORE INTO ocr_frames (
                timestamp, activity_event_id, app_bundle_id, app_name, window_title,
                ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
                image_hash, storage_tier, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
                libsql::params![
                    row.0,          // timestamp
                    row.1,          // activity_event_id
                    row.2.clone(),  // app_bundle_id
                    row.3.clone(),  // app_name
                    row.4.clone(),  // window_title
                    row.5.clone(),  // ocr_text
                    row.6,          // ocr_confidence
                    row.7.clone(),  // thumbnail_path
                    row.8,          // video_chunk_id
                    row.9,          // frame_offset
                    row.10.clone(), // image_hash
                    row.11.clone(), // storage_tier
                    row.12.clone(), // created_at
                ],
            )
            .await
            .map_err(|e| DatabaseError::Migration(e.to_string()))?;
    }

    Ok(())
}

/// Migrate recorder stats
async fn migrate_recorder_stats(target: &Connection, source: &SqliteConn) -> Result<()> {
    debug!("Migrating recorder_stats");

    let result = source.query_row(
        "SELECT total_frames, total_video_chunks, total_storage_bytes, last_capture_time FROM recorder_stats WHERE id = 1",
        [],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<i64>>(3)?,
            ))
        }
    );

    if let Ok((total_frames, total_chunks, total_storage, last_capture)) = result {
        target.execute(
            "UPDATE recorder_stats SET total_frames = ?, total_video_chunks = ?, total_storage_bytes = ?, last_capture_time = ? WHERE id = 1",
            libsql::params![total_frames, total_chunks, total_storage, last_capture]
        ).await.map_err(|e| DatabaseError::Migration(e.to_string()))?;
    }

    Ok(())
}

/// Migrate sync queue database
async fn migrate_sync_queue_db(target: &Connection, source_path: &Path) -> Result<i64> {
    info!("Migrating sync queue database from {:?}", source_path);

    let source = SqliteConn::open(source_path)?;

    // Migrate sync_queue
    let mut stmt = source.prepare(
        "SELECT entry_type, event_id, ts_end, status, retry_count, created_at, updated_at FROM sync_queue ORDER BY created_at"
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,      // entry_type
            row.get::<_, i64>(1)?,         // event_id
            row.get::<_, Option<i64>>(2)?, // ts_end
            row.get::<_, String>(3)?,      // status
            row.get::<_, i64>(4)?,         // retry_count
            row.get::<_, i64>(5)?,         // created_at
            row.get::<_, i64>(6)?,         // updated_at
        ))
    })?;

    let mut count = 0i64;

    for row_result in rows {
        let row = row_result?;

        target.execute(
            "INSERT OR IGNORE INTO sync_queue (entry_type, event_id, ts_end, status, retry_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            libsql::params![row.0.clone(), row.1, row.2, row.3.clone(), row.4, row.5, row.6]
        ).await.map_err(|e| DatabaseError::Migration(e.to_string()))?;

        count += 1;
    }

    // Migrate daily_rollup_cache if exists
    let has_rollup: bool = source
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='daily_rollup_cache'",
            [],
            |row| row.get::<_, i32>(0).map(|c| c > 0),
        )
        .unwrap_or(false);

    if has_rollup {
        migrate_daily_rollup(target, &source).await?;
    }

    Ok(count)
}

/// Migrate daily rollup cache
async fn migrate_daily_rollup(target: &Connection, source: &SqliteConn) -> Result<()> {
    debug!("Migrating daily_rollup_cache");

    let mut stmt = source.prepare(
        "SELECT date, device_id, user_id, total_active_ms, total_afk_ms, app_summaries, domain_summaries, updated_at FROM daily_rollup_cache"
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,         // date
            row.get::<_, String>(1)?,         // device_id
            row.get::<_, String>(2)?,         // user_id
            row.get::<_, i64>(3)?,            // total_active_ms
            row.get::<_, i64>(4)?,            // total_afk_ms
            row.get::<_, Option<String>>(5)?, // app_summaries
            row.get::<_, Option<String>>(6)?, // domain_summaries
            row.get::<_, i64>(7)?,            // updated_at
        ))
    })?;

    for row_result in rows {
        let row = row_result?;

        target.execute(
            r#"
            INSERT OR REPLACE INTO daily_rollup_cache 
            (date, device_id, user_id, total_active_ms, total_afk_ms, app_summaries, domain_summaries, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            libsql::params![
                row.0.clone(),
                row.1.clone(),
                row.2.clone(),
                row.3,
                row.4,
                row.5.clone(),
                row.6.clone(),
                row.7
            ]
        ).await.map_err(|e| DatabaseError::Migration(e.to_string()))?;
    }

    Ok(())
}

/// Backup legacy databases by renaming them
fn backup_legacy_databases(data_dir: &Path, result: &mut MigrationResult) -> Result<()> {
    let databases = [
        ("watcher.db", "watcher.db.migrated"),
        ("frames.db", "frames.db.migrated"),
        ("sync_queue.db", "sync_queue.db.migrated"),
    ];

    for (old_name, new_name) in databases {
        let old_path = data_dir.join(old_name);
        let new_path = data_dir.join(new_name);

        if old_path.exists() {
            // Also handle WAL and SHM files
            for ext in ["", "-wal", "-shm"] {
                let old_file = if ext.is_empty() {
                    old_path.clone()
                } else {
                    data_dir.join(format!("{}{}", old_name, ext))
                };

                let new_file = if ext.is_empty() {
                    new_path.clone()
                } else {
                    data_dir.join(format!("{}{}", new_name, ext))
                };

                if old_file.exists() {
                    if let Err(e) = std::fs::rename(&old_file, &new_file) {
                        warn!("Failed to rename {:?} to {:?}: {}", old_file, new_file, e);
                    }
                }
            }

            result.legacy_dbs_backed_up.push(old_name.to_string());
            info!("Backed up {} -> {}", old_name, new_name);
        }
    }

    Ok(())
}

/// Get paths to legacy databases (for external use)
pub fn get_legacy_db_paths(data_dir: &Path) -> Vec<PathBuf> {
    let names = ["watcher.db", "frames.db", "sync_queue.db"];
    names
        .iter()
        .map(|name| data_dir.join(name))
        .filter(|path| path.exists())
        .collect()
}

/// Check if there are legacy databases that need migration
pub fn has_legacy_databases(data_dir: &Path) -> bool {
    !get_legacy_db_paths(data_dir).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[allow(dead_code)]
    fn create_test_watcher_db(path: &Path) -> SqliteConn {
        let conn = SqliteConn::open(path).unwrap();

        conn.execute_batch(r#"
            CREATE TABLE activity_events (
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
                source TEXT NOT NULL DEFAULT 'test',
                created_at INTEGER NOT NULL
            );
            
            CREATE TABLE watcher_heartbeat (
                device_id TEXT PRIMARY KEY,
                last_seen_ts INTEGER NOT NULL
            );
            
            INSERT INTO activity_events (device_id, user_id, ts_start, ts_end, app_bundle_id, app_name, is_afk, source, created_at)
            VALUES ('dev1', 'user1', 1000, 2000, 'com.test', 'Test App', 0, 'test', 1000);
            
            INSERT INTO watcher_heartbeat (device_id, last_seen_ts) VALUES ('dev1', 2000);
        "#).unwrap();

        conn
    }

    #[tokio::test]
    async fn test_has_legacy_databases() {
        let temp_dir = TempDir::new().unwrap();

        // No legacy databases
        assert!(!has_legacy_databases(temp_dir.path()));

        // Create a legacy database
        let watcher_path = temp_dir.path().join("watcher.db");
        let _conn = SqliteConn::open(&watcher_path).unwrap();

        assert!(has_legacy_databases(temp_dir.path()));
    }

    #[tokio::test]
    async fn test_migration_marks_complete() {
        let temp_dir = TempDir::new().unwrap();

        // Create target libsql database
        let db = libsql::Builder::new_local(temp_dir.path().join("ritual.db").to_str().unwrap())
            .build()
            .await
            .unwrap();
        let conn = db.connect().unwrap();

        // Initialize schema first
        crate::schema::initialize_schema(&conn).await.unwrap();

        // Should not be marked complete initially
        assert!(!is_migration_complete(&conn).await.unwrap());

        // Mark complete
        mark_migration_complete(&conn).await.unwrap();

        // Should now be marked complete
        assert!(is_migration_complete(&conn).await.unwrap());
    }
}
