//! Screen recorder database operations
//!
//! This module handles:
//! - OCR frame CRUD operations
//! - Video chunk management
//! - Storage tier management
//! - Full-text search on OCR content
//! - Recorder statistics

use libsql::Connection;
use tracing::debug;

use crate::error::{DatabaseError, Result};
use crate::types::{ActivityContext, OcrFrame, RecorderStats, StorageTier, VideoChunk};

/// Recorder operations for the database
pub struct RecorderOps<'a> {
    conn: &'a Connection,
}

impl<'a> RecorderOps<'a> {
    /// Create a new RecorderOps with a connection reference
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
    
    // ========================================================================
    // VIDEO CHUNK OPERATIONS
    // ========================================================================
    
    /// Insert a new video chunk and return its ID
    pub async fn insert_video_chunk(&self, chunk: &VideoChunk) -> Result<i64> {
        self.conn.execute(
            r#"
            INSERT INTO video_chunks (file_path, start_time, end_time, frame_count, file_size_bytes, monitor_id, storage_tier)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            "#,
            libsql::params![
                chunk.file_path.clone(),
                chunk.start_time,
                chunk.end_time,
                chunk.frame_count,
                chunk.file_size_bytes,
                chunk.monitor_id as i64,
                chunk.storage_tier.as_str(),
            ]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        // Get the last inserted row ID
        let mut rows = self.conn.query("SELECT last_insert_rowid()", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let id = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        // Update stats
        self.conn.execute(
            "UPDATE recorder_stats SET total_video_chunks = total_video_chunks + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        debug!("Inserted video chunk {} with id {}", chunk.file_path, id);
        Ok(id)
    }
    
    /// Update video chunk end time and frame count
    pub async fn update_video_chunk(
        &self,
        chunk_id: i64,
        end_time: i64,
        frame_count: i64,
        file_size: Option<i64>,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE video_chunks SET end_time = ?, frame_count = ?, file_size_bytes = ? WHERE id = ?",
            libsql::params![end_time, frame_count, file_size, chunk_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Get video chunk by ID
    pub async fn get_video_chunk(&self, chunk_id: i64) -> Result<Option<VideoChunk>> {
        let mut rows = self.conn.query(
            "SELECT id, file_path, start_time, end_time, frame_count, file_size_bytes, monitor_id, storage_tier, created_at FROM video_chunks WHERE id = ?",
            libsql::params![chunk_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let tier_str: String = row.get(7).unwrap_or_else(|_| "hot".to_string());
            
            Ok(Some(VideoChunk {
                id: Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?),
                file_path: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                start_time: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                end_time: row.get(3).ok(),
                frame_count: row.get(4).unwrap_or(0),
                file_size_bytes: row.get(5).ok(),
                monitor_id: row.get::<i64>(6).unwrap_or(0) as u32,
                storage_tier: StorageTier::from_str(&tier_str),
                created_at: row.get(8).ok(),
            }))
        } else {
            Ok(None)
        }
    }
    
    /// Get video chunks in a time range
    pub async fn get_video_chunks_in_range(&self, start_ts: i64, end_ts: i64) -> Result<Vec<VideoChunk>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, file_path, start_time, end_time, frame_count, file_size_bytes, monitor_id, storage_tier, created_at
            FROM video_chunks
            WHERE start_time >= ? AND start_time < ?
            ORDER BY start_time ASC
            "#,
            libsql::params![start_ts, end_ts]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut chunks = Vec::new();
        
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let tier_str: String = row.get(7).unwrap_or_else(|_| "hot".to_string());
            
            chunks.push(VideoChunk {
                id: Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?),
                file_path: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                start_time: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                end_time: row.get(3).ok(),
                frame_count: row.get(4).unwrap_or(0),
                file_size_bytes: row.get(5).ok(),
                monitor_id: row.get::<i64>(6).unwrap_or(0) as u32,
                storage_tier: StorageTier::from_str(&tier_str),
                created_at: row.get(8).ok(),
            });
        }
        
        Ok(chunks)
    }
    
    /// Get video chunks older than a timestamp for tier migration
    pub async fn get_chunks_older_than(
        &self,
        timestamp: i64,
        current_tier: &str,
    ) -> Result<Vec<VideoChunk>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, file_path, start_time, end_time, frame_count, file_size_bytes, monitor_id, storage_tier, created_at
            FROM video_chunks
            WHERE start_time < ? AND storage_tier = ?
            ORDER BY start_time ASC
            "#,
            libsql::params![timestamp, current_tier]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut chunks = Vec::new();
        
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let tier_str: String = row.get(7).unwrap_or_else(|_| "hot".to_string());
            
            chunks.push(VideoChunk {
                id: Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?),
                file_path: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                start_time: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                end_time: row.get(3).ok(),
                frame_count: row.get(4).unwrap_or(0),
                file_size_bytes: row.get(5).ok(),
                monitor_id: row.get::<i64>(6).unwrap_or(0) as u32,
                storage_tier: StorageTier::from_str(&tier_str),
                created_at: row.get(8).ok(),
            });
        }
        
        Ok(chunks)
    }
    
    /// Update storage tier for a video chunk
    pub async fn update_chunk_tier(&self, chunk_id: i64, new_tier: StorageTier) -> Result<()> {
        self.conn.execute(
            "UPDATE video_chunks SET storage_tier = ? WHERE id = ?",
            libsql::params![new_tier.as_str(), chunk_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Delete a video chunk and its associated frames
    pub async fn delete_video_chunk(&self, chunk_id: i64) -> Result<()> {
        // Delete associated frames first
        self.conn.execute(
            "DELETE FROM ocr_frames WHERE video_chunk_id = ?",
            libsql::params![chunk_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        // Delete the chunk
        self.conn.execute(
            "DELETE FROM video_chunks WHERE id = ?",
            libsql::params![chunk_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    // ========================================================================
    // OCR FRAME OPERATIONS
    // ========================================================================
    
    /// Insert a new OCR frame and return its ID
    pub async fn insert_ocr_frame(&self, frame: &OcrFrame) -> Result<i64> {
        self.conn.execute(
            r#"
            INSERT INTO ocr_frames (
                timestamp, activity_event_id, app_bundle_id, app_name, window_title,
                ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
                image_hash, storage_tier
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            libsql::params![
                frame.timestamp,
                frame.activity_event_id,
                frame.app_bundle_id.clone(),
                frame.app_name.clone(),
                frame.window_title.clone(),
                frame.ocr_text.clone(),
                frame.ocr_confidence,
                frame.thumbnail_path.clone(),
                frame.video_chunk_id,
                frame.frame_offset,
                frame.image_hash.clone(),
                frame.storage_tier.as_str(),
            ]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        // Get the last inserted row ID
        let mut rows = self.conn.query("SELECT last_insert_rowid()", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let id = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        // Update stats
        self.conn.execute(
            "UPDATE recorder_stats SET total_frames = total_frames + 1, last_capture_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            libsql::params![frame.timestamp]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(id)
    }
    
    /// Get the most recent frame hash for deduplication
    pub async fn get_last_frame_hash(&self) -> Result<Option<String>> {
        let mut rows = self.conn.query(
            "SELECT image_hash FROM ocr_frames ORDER BY timestamp DESC LIMIT 1",
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            Ok(row.get(0).ok())
        } else {
            Ok(None)
        }
    }
    
    /// Get the timestamp of the last stored frame
    pub async fn get_last_frame_timestamp(&self) -> Result<Option<i64>> {
        let mut rows = self.conn.query(
            "SELECT timestamp FROM ocr_frames ORDER BY timestamp DESC LIMIT 1",
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            Ok(row.get(0).ok())
        } else {
            Ok(None)
        }
    }
    
    /// Get an OCR frame by ID
    pub async fn get_ocr_frame(&self, id: i64) -> Result<Option<OcrFrame>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, timestamp, activity_event_id, app_bundle_id, app_name,
                   window_title, ocr_text, ocr_confidence, thumbnail_path,
                   video_chunk_id, frame_offset, image_hash, storage_tier, created_at,
                   summary, activity_type, keywords, text_quality
            FROM ocr_frames
            WHERE id = ?
            "#,
            libsql::params![id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        self.row_to_ocr_frame(&mut rows).await
    }
    
    /// Get frames in a time range
    pub async fn get_frames_in_range(&self, start_ts: i64, end_ts: i64) -> Result<Vec<OcrFrame>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, timestamp, activity_event_id, app_bundle_id, app_name,
                   window_title, ocr_text, ocr_confidence, thumbnail_path,
                   video_chunk_id, frame_offset, image_hash, storage_tier, created_at,
                   summary, activity_type, keywords, text_quality
            FROM ocr_frames
            WHERE timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
            "#,
            libsql::params![start_ts, end_ts]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        self.rows_to_ocr_frames(&mut rows).await
    }
    
    /// Get frames for a specific activity event
    pub async fn get_frames_for_activity(&self, activity_event_id: i64) -> Result<Vec<OcrFrame>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, timestamp, activity_event_id, app_bundle_id, app_name,
                   window_title, ocr_text, ocr_confidence, thumbnail_path,
                   video_chunk_id, frame_offset, image_hash, storage_tier, created_at,
                   summary, activity_type, keywords, text_quality
            FROM ocr_frames
            WHERE activity_event_id = ?
            ORDER BY timestamp ASC
            "#,
            libsql::params![activity_event_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        self.rows_to_ocr_frames(&mut rows).await
    }
    
    /// Search OCR text using full-text search
    pub async fn search_ocr_text(&self, query: &str, limit: usize) -> Result<Vec<OcrFrame>> {
        let search_start = std::time::Instant::now();
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let expanded_query = build_expanded_fts_query(query);
        let primary_query = if expanded_query.is_empty() { query } else { expanded_query.as_str() };

        let frames = match self.execute_fts_search(primary_query, limit).await {
            Ok(frames) => frames,
            Err(err) if is_fts_syntax_error(&err) => {
                let fallback_query = escape_fts_phrase(query);
                if fallback_query.is_empty() || fallback_query == primary_query {
                    return Err(err);
                }
                tracing::warn!(
                    original_query = query,
                    expanded_query = primary_query,
                    fallback_query = fallback_query,
                    "FTS query syntax failed, retrying with escaped phrase query"
                );
                self.execute_fts_search(&fallback_query, limit).await?
            }
            Err(err) => return Err(err),
        };
        
        let elapsed_ms = search_start.elapsed().as_millis() as u64;
        tracing::info!(
            search_type = "fts",
            fts_ms = elapsed_ms,
            results_count = frames.len(),
            limit = limit,
            "FTS search complete"
        );
        
        Ok(frames)
    }
    
    /// Get frames without embeddings (for background processing)
    pub async fn get_frames_without_embeddings(&self, limit: usize) -> Result<Vec<OcrFrame>> {
        let recent_cutoff = chrono::Utc::now()
            .timestamp_millis()
            .saturating_sub(24 * 60 * 60 * 1000);
        let mut rows = self.conn.query(
            r#"
            SELECT f.id, f.timestamp, f.activity_event_id, f.app_bundle_id, f.app_name,
                   f.window_title, f.ocr_text, f.ocr_confidence, f.thumbnail_path,
                   f.video_chunk_id, f.frame_offset, f.image_hash, f.storage_tier, f.created_at,
                   f.summary, f.activity_type, f.keywords, f.text_quality
            FROM ocr_frames f
            LEFT JOIN ocr_embeddings e ON f.id = e.frame_id
            WHERE e.id IS NULL
              AND f.timestamp >= ?
              AND (
                COALESCE(NULLIF(TRIM(f.ocr_text), ''), '') != ''
                OR COALESCE(NULLIF(TRIM(f.app_name), ''), '') != ''
                OR COALESCE(NULLIF(TRIM(f.window_title), ''), '') != ''
              )
            ORDER BY f.timestamp DESC
            LIMIT ?
            "#,
            libsql::params![recent_cutoff, limit as i64]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        self.rows_to_ocr_frames(&mut rows).await
    }
    
    // ========================================================================
    // ACTIVITY CONTEXT (for recorder to get current activity)
    // ========================================================================
    
    /// Get current activity context from the most recent activity event
    pub async fn get_current_activity(&self) -> Result<Option<ActivityContext>> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        
        let mut rows = self.conn.query(
            r#"
            SELECT id, app_bundle_id, app_name, window_title 
            FROM activity_events 
            WHERE ts_end > ?
            ORDER BY ts_end DESC 
            LIMIT 1
            "#,
            libsql::params![now_ms - 10_000]  // Within last 10 seconds
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            Ok(Some(ActivityContext {
                event_id: row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?,
                bundle_id: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                app_name: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                window_title: row.get(3).ok(),
            }))
        } else {
            Ok(None)
        }
    }
    
    /// Get OCR frames older than a timestamp (for cleanup)
    pub async fn get_frames_older_than(&self, timestamp: i64) -> Result<Vec<OcrFrame>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, timestamp, activity_event_id, app_bundle_id, app_name, window_title,
                   ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
                   image_hash, storage_tier, created_at,
                   summary, activity_type, keywords, text_quality
            FROM ocr_frames
            WHERE timestamp < ?
            ORDER BY timestamp ASC
            LIMIT 1000
            "#,
            libsql::params![timestamp]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        rows_to_ocr_frames(&mut rows).await
    }
    
    /// Get the oldest OCR frames (for storage limit enforcement)
    pub async fn get_oldest_frames(&self, limit: usize) -> Result<Vec<OcrFrame>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, timestamp, activity_event_id, app_bundle_id, app_name, window_title,
                   ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
                   image_hash, storage_tier, created_at,
                   summary, activity_type, keywords, text_quality
            FROM ocr_frames
            ORDER BY timestamp ASC
            LIMIT ?
            "#,
            libsql::params![limit as i64]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        rows_to_ocr_frames(&mut rows).await
    }
    
    /// Update the text processing data for a frame
    /// 
    /// Updates summary, activity_type, keywords, and text_quality
    pub async fn update_frame_text_data(
        &self,
        frame_id: i64,
        summary: Option<&str>,
        activity_type: Option<&str>,
        keywords: Option<&str>,
        text_quality: Option<f64>,
    ) -> Result<()> {
        self.conn.execute(
            r#"
            UPDATE ocr_frames 
            SET summary = ?, activity_type = ?, keywords = ?, text_quality = ?
            WHERE id = ?
            "#,
            libsql::params![summary, activity_type, keywords, text_quality, frame_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        debug!("Updated text data for frame {}", frame_id);
        Ok(())
    }
    
    /// Delete an OCR frame by ID
    pub async fn delete_ocr_frame(&self, frame_id: i64) -> Result<()> {
        // Delete associated embeddings first
        let _ = self.conn.execute(
            "DELETE FROM ocr_embeddings WHERE frame_id = ?",
            libsql::params![frame_id]
        ).await;
        
        // Delete the frame
        self.conn.execute(
            "DELETE FROM ocr_frames WHERE id = ?",
            libsql::params![frame_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        // Update stats
        self.conn.execute(
            "UPDATE recorder_stats SET total_frames = MAX(0, total_frames - 1), updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    // ========================================================================
    // STORAGE OPERATIONS
    // ========================================================================
    
    /// Get total storage used in bytes
    pub async fn get_total_storage_bytes(&self) -> Result<i64> {
        let mut rows = self.conn.query(
            "SELECT COALESCE(SUM(file_size_bytes), 0) FROM video_chunks",
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let bytes = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        Ok(bytes)
    }
    
    /// Get recorder statistics
    pub async fn get_stats(&self) -> Result<RecorderStats> {
        let mut rows = self.conn.query(
            "SELECT total_frames, total_video_chunks, total_storage_bytes, last_capture_time FROM recorder_stats WHERE id = 1",
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            Ok(RecorderStats {
                total_frames: row.get(0).unwrap_or(0),
                total_video_chunks: row.get(1).unwrap_or(0),
                total_storage_bytes: row.get(2).unwrap_or(0),
                last_capture_time: row.get(3).ok(),
            })
        } else {
            Ok(RecorderStats {
                total_frames: 0,
                total_video_chunks: 0,
                total_storage_bytes: 0,
                last_capture_time: None,
            })
        }
    }
    
    /// Update storage bytes in stats
    pub async fn update_storage_stats(&self, bytes: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE recorder_stats SET total_storage_bytes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            libsql::params![bytes]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    // ========================================================================
    // HELPER METHODS
    // ========================================================================
    
    /// Convert a single row to OcrFrame
    async fn row_to_ocr_frame(&self, rows: &mut libsql::Rows) -> Result<Option<OcrFrame>> {
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let tier_str: String = row.get(12).unwrap_or_else(|_| "hot".to_string());
            
            Ok(Some(OcrFrame {
                id: Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?),
                timestamp: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                activity_event_id: row.get(2).ok(),
                app_bundle_id: row.get(3).unwrap_or_default(),
                app_name: row.get(4).unwrap_or_default(),
                window_title: row.get(5).ok(),
                ocr_text: row.get(6).unwrap_or_default(),
                ocr_confidence: row.get(7).unwrap_or(0.0),
                thumbnail_path: row.get(8).ok(),
                video_chunk_id: row.get(9).ok(),
                frame_offset: row.get(10).ok(),
                image_hash: row.get(11).unwrap_or_default(),
                storage_tier: StorageTier::from_str(&tier_str),
                created_at: row.get(13).ok(),
                // New text processing fields (may not exist in older databases)
                summary: row.get(14).ok(),
                activity_type: row.get(15).ok(),
                keywords: row.get(16).ok(),
                text_quality: row.get(17).ok(),
            }))
        } else {
            Ok(None)
        }
    }
    
    /// Convert multiple rows to Vec<OcrFrame>
    async fn rows_to_ocr_frames(&self, rows: &mut libsql::Rows) -> Result<Vec<OcrFrame>> {
        rows_to_ocr_frames(rows).await
    }

    async fn execute_fts_search(&self, query: &str, limit: usize) -> Result<Vec<OcrFrame>> {
        let mut rows = self.conn.query(
            r#"
            SELECT f.id, f.timestamp, f.activity_event_id, f.app_bundle_id, f.app_name,
                   f.window_title, f.ocr_text, f.ocr_confidence, f.thumbnail_path,
                   f.video_chunk_id, f.frame_offset, f.image_hash, f.storage_tier, f.created_at,
                   f.summary, f.activity_type, f.keywords, f.text_quality
            FROM ocr_frames f
            JOIN ocr_frames_fts ON f.id = ocr_frames_fts.rowid
            WHERE ocr_frames_fts MATCH ?
            ORDER BY bm25(ocr_frames_fts) ASC, f.timestamp DESC
            LIMIT ?
            "#,
            libsql::params![query, limit as i64]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        self.rows_to_ocr_frames(&mut rows).await
    }
}

fn escape_fts_phrase(query: &str) -> String {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let normalized: String = trimmed
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();
    let phrase = normalized
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if phrase.is_empty() {
        return String::new();
    }
    format!("\"{}\"", phrase.replace('"', "\"\""))
}

fn extract_base_tokens(query: &str) -> Vec<String> {
    let mut normalized = String::with_capacity(query.len());
    for ch in query.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch.is_whitespace() {
            normalized.push(ch);
        } else {
            normalized.push(' ');
        }
    }

    let mut tokens = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for token in normalized.split_whitespace() {
        let lower = token.to_ascii_lowercase();
        if lower.len() < 3 {
            continue;
        }
        if seen.insert(lower.clone()) {
            tokens.push(lower);
        }
    }
    tokens
}

fn split_compound_token(token: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut prev_is_alpha = false;
    let mut prev_is_lower = false;
    let mut prev_is_digit = false;

    for ch in token.chars() {
        let is_alpha = ch.is_ascii_alphabetic();
        let is_lower = ch.is_ascii_lowercase();
        let is_digit = ch.is_ascii_digit();

        let boundary = (!current.is_empty())
            && (
                (prev_is_lower && ch.is_ascii_uppercase())
                || (prev_is_digit && is_alpha)
                || (prev_is_alpha && is_digit)
            );

        if boundary {
            out.push(current.to_ascii_lowercase());
            current.clear();
        }

        current.push(ch);
        prev_is_alpha = is_alpha;
        prev_is_lower = is_lower;
        prev_is_digit = is_digit;
    }

    if !current.is_empty() {
        out.push(current.to_ascii_lowercase());
    }

    out
}

fn aliases_for_token(token: &str) -> &'static [&'static str] {
    match token {
        "auth" => &["authentication", "login", "signin", "token", "oauth"],
        "authentication" => &["auth", "login", "signin", "token", "oauth"],
        "login" => &["signin", "auth", "authentication"],
        "signin" | "sign-in" => &["login", "auth", "authentication"],
        "bug" => &["issue", "error", "fix"],
        "issue" => &["bug", "error", "fix"],
        "landing" => &["homepage", "home", "marketing"],
        "homepage" => &["landing", "home", "marketing"],
        "repo" => &["repository", "github", "git"],
        "repository" => &["repo", "github", "git"],
        _ => &[],
    }
}

fn build_expanded_fts_query(query: &str) -> String {
    let base_tokens = extract_base_tokens(query);
    if base_tokens.is_empty() {
        return String::new();
    }

    let mut expanded = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for token in base_tokens {
        for split in split_compound_token(&token) {
            if split.len() >= 3 && seen.insert(split.clone()) {
                expanded.push(split);
            }
        }

        for alias in aliases_for_token(&token) {
            let alias_clean: String = alias
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || *c == '.')
                .collect::<String>()
                .to_ascii_lowercase();
            if alias_clean.len() >= 3 && seen.insert(alias_clean.clone()) {
                expanded.push(alias_clean);
            }
        }
    }

    if expanded.is_empty() {
        return String::new();
    }

    let terms: Vec<String> = expanded
        .into_iter()
        .map(|token| format!("\"{}\"*", token.replace('"', "\"\"")))
        .collect();

    if terms.len() == 1 {
        terms[0].clone()
    } else {
        format!("({})", terms.join(" OR "))
    }
}

fn is_fts_syntax_error(err: &DatabaseError) -> bool {
    let DatabaseError::Query(message) = err else {
        return false;
    };
    let lower = message.to_lowercase();
    lower.contains("fts5")
        || lower.contains("match")
        || lower.contains("syntax error")
        || lower.contains("malformed")
        || lower.contains("unterminated string")
}

/// Convert multiple rows to Vec<OcrFrame> (standalone function)
/// 
/// Expects rows with columns: id, timestamp, activity_event_id, app_bundle_id, app_name,
/// window_title, ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
/// image_hash, storage_tier, created_at, summary, activity_type, keywords, text_quality
pub async fn rows_to_ocr_frames(rows: &mut libsql::Rows) -> Result<Vec<OcrFrame>> {
    let mut frames = Vec::new();
    
    while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
        let tier_str: String = row.get(12).unwrap_or_else(|_| "hot".to_string());
        
        frames.push(OcrFrame {
            id: Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?),
            timestamp: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
            activity_event_id: row.get(2).ok(),
            app_bundle_id: row.get(3).unwrap_or_default(),
            app_name: row.get(4).unwrap_or_default(),
            window_title: row.get(5).ok(),
            ocr_text: row.get(6).unwrap_or_default(),
            ocr_confidence: row.get(7).unwrap_or(0.0),
            thumbnail_path: row.get(8).ok(),
            video_chunk_id: row.get(9).ok(),
            frame_offset: row.get(10).ok(),
            image_hash: row.get(11).unwrap_or_default(),
            storage_tier: StorageTier::from_str(&tier_str),
            created_at: row.get(13).ok(),
            // New text processing fields (may not exist in older databases)
            summary: row.get(14).ok(),
            activity_type: row.get(15).ok(),
            keywords: row.get(16).ok(),
            text_quality: row.get(17).ok(),
        });
    }
    
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;
    use libsql::Builder;
    use tempfile::TempDir;
    
    async fn create_test_db() -> (libsql::Database, Connection, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        
        let db = Builder::new_local(db_path.to_str().unwrap())
            .build()
            .await
            .unwrap();
        
        let conn = db.connect().unwrap();
        
        // Initialize schema
        crate::schema::initialize_schema(&conn).await.unwrap();
        
        (db, conn, temp_dir)
    }
    
    #[tokio::test]
    async fn test_insert_and_get_video_chunk() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = RecorderOps::new(&conn);
        
        let chunk = VideoChunk::new("/path/to/video.mp4", 1000, 0);
        
        let id = ops.insert_video_chunk(&chunk).await.unwrap();
        assert!(id > 0);
        
        let retrieved = ops.get_video_chunk(id).await.unwrap();
        assert!(retrieved.is_some());
        
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.file_path, "/path/to/video.mp4");
        assert_eq!(retrieved.start_time, 1000);
    }
    
    #[tokio::test]
    async fn test_insert_and_get_ocr_frame() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = RecorderOps::new(&conn);
        
        let frame = OcrFrame::new(
            1000,
            "com.test.app",
            "Test App",
            "Some OCR text content",
            "abc123hash",
        );
        
        let id = ops.insert_ocr_frame(&frame).await.unwrap();
        assert!(id > 0);
        
        let retrieved = ops.get_ocr_frame(id).await.unwrap();
        assert!(retrieved.is_some());
        
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.ocr_text, "Some OCR text content");
    }
    
    #[tokio::test]
    async fn test_get_frames_in_range() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = RecorderOps::new(&conn);
        
        // Insert some frames
        for i in 0..5 {
            let frame = OcrFrame::new(
                i * 1000,
                "com.test.app",
                "Test App",
                &format!("OCR text {}", i),
                &format!("hash{}", i),
            );
            ops.insert_ocr_frame(&frame).await.unwrap();
        }
        
        // Get frames in range
        let frames = ops.get_frames_in_range(1000, 3000).await.unwrap();
        assert_eq!(frames.len(), 3);  // 1000, 2000, 3000
    }
    
    #[tokio::test]
    async fn test_recorder_stats() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = RecorderOps::new(&conn);
        
        // Initial stats
        let stats = ops.get_stats().await.unwrap();
        assert_eq!(stats.total_frames, 0);
        assert_eq!(stats.total_video_chunks, 0);
        
        // Insert a frame and chunk
        let frame = OcrFrame::new(1000, "com.test", "Test", "text", "hash");
        ops.insert_ocr_frame(&frame).await.unwrap();
        
        let chunk = VideoChunk::new("/path/video.mp4", 1000, 0);
        ops.insert_video_chunk(&chunk).await.unwrap();
        
        // Check updated stats
        let stats = ops.get_stats().await.unwrap();
        assert_eq!(stats.total_frames, 1);
        assert_eq!(stats.total_video_chunks, 1);
    }
    
    #[tokio::test]
    async fn test_last_frame_hash() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = RecorderOps::new(&conn);
        
        // No frames initially
        let hash = ops.get_last_frame_hash().await.unwrap();
        assert!(hash.is_none());
        
        // Insert a frame
        let frame = OcrFrame::new(1000, "com.test", "Test", "text", "unique_hash_123");
        ops.insert_ocr_frame(&frame).await.unwrap();
        
        // Should return the hash
        let hash = ops.get_last_frame_hash().await.unwrap();
        assert_eq!(hash, Some("unique_hash_123".to_string()));
    }

    #[tokio::test]
    async fn test_search_ocr_text_retries_on_malformed_match_query() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = RecorderOps::new(&conn);

        let frame = OcrFrame::new(
            1000,
            "com.test.app",
            "Test App",
            "working on rust integration tests",
            "hash-search",
        );
        ops.insert_ocr_frame(&frame).await.unwrap();

        // Unbalanced quote causes an FTS parse error on first attempt.
        let frames = ops.search_ocr_text("\"integration", 20).await.unwrap();
        assert_eq!(frames.len(), 1);
        assert!(frames[0].ocr_text.contains("integration"));
    }

    #[tokio::test]
    async fn test_search_ocr_text_empty_query_returns_empty() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = RecorderOps::new(&conn);

        let frames = ops.search_ocr_text("   ", 20).await.unwrap();
        assert!(frames.is_empty());
    }
}
