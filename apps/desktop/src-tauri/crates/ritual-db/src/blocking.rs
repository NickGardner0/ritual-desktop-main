//! Blocking (synchronous) API for ritual-db
//!
//! This module provides synchronous wrappers around the async database operations.
//! It's designed for use by standalone local-capture binaries such as ritual-watcher.
//! that don't run in an async context.
//!
//! # Usage
//!
//! ```rust,ignore
//! use ritual_db::blocking::BlockingDatabase;
//!
//! fn main() {
//!     let db = BlockingDatabase::open_default().unwrap();
//!     
//!     // Use synchronous API
//!     db.insert_activity_event(&event).unwrap();
//!     db.update_heartbeat("device-123", timestamp).unwrap();
//! }
//! ```

use std::path::PathBuf;
use std::sync::Arc;

use crate::{
    ActivityContext, ActivityEvent, AppSummary, ContextSnapshot, DailySummary, DatabaseConfig,
    DatabaseError, DeliveryOutboxKind, DomainSummary, FocusMetrics, LastEvent, OcrFrame,
    QueuedSyncItem, RecorderStats, Result, RitualDatabase, VideoChunk,
};

/// A blocking (synchronous) database handle
///
/// This wraps `RitualDatabase` and provides synchronous methods by using
/// a dedicated tokio runtime internally.
pub struct BlockingDatabase {
    rt: tokio::runtime::Runtime,
    db: Arc<RitualDatabase>,
}

impl BlockingDatabase {
    /// Open the database with default configuration
    ///
    /// This opens `~/.ritual/ritual.db` with default settings.
    pub fn open_default() -> Result<Self> {
        Self::open(&DatabaseConfig::default())
    }

    /// Open the database with a custom path
    pub fn open_with_path(db_path: impl Into<PathBuf>) -> Result<Self> {
        Self::open(&DatabaseConfig::with_path(db_path))
    }

    /// Open the activity database as a strictly local operational store.
    pub fn open_activity_db_with_env(db_path: impl Into<PathBuf>) -> Result<Self> {
        Self::open(&DatabaseConfig::with_path(db_path))
    }

    /// Open the database with custom configuration
    pub fn open(config: &DatabaseConfig) -> Result<Self> {
        // Create a dedicated runtime for this database instance
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| DatabaseError::Connection(format!("Failed to create runtime: {}", e)))?;

        // Open the database
        let db = rt.block_on(RitualDatabase::open(config))?;

        Ok(Self {
            rt,
            db: Arc::new(db),
        })
    }

    /// Get the database configuration
    pub fn config(&self) -> &DatabaseConfig {
        self.db.config()
    }

    /// Explicitly sync an embedded replica with its remote Turso database.
    pub fn sync(&self) -> Result<()> {
        self.rt.block_on(self.db.sync())
    }

    /// Run a lightweight integrity probe using the already-open libsql connection.
    pub fn quick_check(&self) -> Result<String> {
        self.rt.block_on(self.db.quick_check())
    }

    /// Get database path
    pub fn db_path(&self) -> &std::path::Path {
        self.db.db_path()
    }

    // ========================================================================
    // Activity Operations
    // ========================================================================

    /// Insert a new activity event
    pub fn insert_activity_event(&self, event: &ActivityEvent) -> Result<i64> {
        self.rt.block_on(self.db.insert_activity_event(event))
    }

    pub fn enqueue_delivery_outbox(
        &self,
        kind: DeliveryOutboxKind,
        event_id: &str,
        payload_json: &str,
    ) -> Result<bool> {
        self.rt.block_on(
            self.db
                .enqueue_delivery_outbox(kind, event_id, payload_json),
        )
    }

    pub fn enqueue_delivery_outbox_batch(
        &self,
        kind: DeliveryOutboxKind,
        items: &[(String, String)],
    ) -> Result<u64> {
        self.rt
            .block_on(self.db.enqueue_delivery_outbox_batch(kind, items))
    }

    pub fn delivery_outbox_count(&self, kind: DeliveryOutboxKind) -> Result<i64> {
        self.rt.block_on(self.db.delivery_outbox_count(kind))
    }

    pub fn biome_delivery_cursors(&self) -> Result<std::collections::HashMap<String, i64>> {
        self.rt.block_on(self.db.biome_delivery_cursors())
    }

    pub fn advance_biome_delivery_cursor(&self, source_key: &str, committed_ts: i64) -> Result<()> {
        self.rt.block_on(
            self.db
                .advance_biome_delivery_cursor(source_key, committed_ts),
        )
    }

    /// Update the end time of an activity event
    pub fn update_event_end_time(&self, event_id: i64, ts_end: i64) -> Result<()> {
        self.rt
            .block_on(self.db.update_event_end_time(event_id, ts_end))
    }

    /// Get the last event for a device (for heartbeat merging)
    pub fn get_last_event(&self, device_id: &str) -> Result<Option<LastEvent>> {
        self.rt.block_on(self.db.get_last_event(device_id))
    }

    /// Get an activity event by ID
    pub fn get_activity_event(&self, id: i64) -> Result<Option<ActivityEvent>> {
        self.rt.block_on(self.db.get_activity_event(id))
    }

    /// Get recent activity events
    pub fn get_recent_events(&self, device_id: &str, limit: i64) -> Result<Vec<ActivityEvent>> {
        self.rt
            .block_on(self.db.get_recent_events(device_id, limit))
    }

    /// Get activity events in a time range
    pub fn get_events_in_range(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<Vec<ActivityEvent>> {
        self.rt
            .block_on(self.db.get_events_in_range(device_id, ts_start, ts_end))
    }

    /// Update heartbeat
    pub fn update_heartbeat(&self, device_id: &str, timestamp: i64) -> Result<()> {
        self.rt
            .block_on(self.db.update_heartbeat(device_id, timestamp))
    }

    /// Get app summary for a time range
    pub fn get_app_summary(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<Vec<AppSummary>> {
        self.rt
            .block_on(self.db.get_app_summary(device_id, ts_start, ts_end))
    }

    /// Get domain summary for a time range
    pub fn get_domain_summary(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<Vec<DomainSummary>> {
        self.rt
            .block_on(self.db.get_domain_summary(device_id, ts_start, ts_end))
    }

    /// Get daily summary
    pub fn get_daily_summary(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<DailySummary> {
        self.rt
            .block_on(self.db.get_daily_summary(device_id, ts_start, ts_end))
    }

    /// Get focus metrics
    pub fn get_focus_metrics(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<FocusMetrics> {
        self.rt
            .block_on(self.db.get_focus_metrics(device_id, ts_start, ts_end))
    }

    /// Delete old activity events
    pub fn delete_old_events(&self, days: i64) -> Result<i64> {
        self.rt.block_on(self.db.delete_old_events(days))
    }

    /// Clamp stale browser-extension events to a bounded session length.
    pub fn clamp_stale_browser_extension_events(
        &self,
        device_id: &str,
        stale_before_ts: i64,
        max_span_ms: i64,
    ) -> Result<i64> {
        self.rt
            .block_on(self.db.clamp_stale_browser_extension_events(
                device_id,
                stale_before_ts,
                max_span_ms,
            ))
    }

    /// Delete exact duplicate browser-extension events.
    pub fn delete_duplicate_browser_extension_events(
        &self,
        device_id: &str,
        lookback_ts: i64,
    ) -> Result<i64> {
        self.rt.block_on(
            self.db
                .delete_duplicate_browser_extension_events(device_id, lookback_ts),
        )
    }

    /// Insert or update an AFK event
    pub fn upsert_afk_event(
        &self,
        device_id: &str,
        user_id: &str,
        ts_start: i64,
        ts_end: i64,
        status: &str,
    ) -> Result<i64> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::activity::ActivityOps::new(&conn);
        self.rt
            .block_on(ops.upsert_afk_event(device_id, user_id, ts_start, ts_end, status))
    }

    /// Get event count for a device
    pub fn get_event_count(&self, device_id: &str) -> Result<i64> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::activity::ActivityOps::new(&conn);
        self.rt.block_on(ops.get_event_count(device_id))
    }

    /// Get database stats
    pub fn get_db_stats(&self) -> Result<DbStats> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::activity::ActivityOps::new(&conn);
        self.rt.block_on(ops.get_db_stats())
    }

    // ========================================================================
    // Recorder Operations
    // ========================================================================

    /// Insert a new video chunk
    pub fn insert_video_chunk(&self, chunk: &VideoChunk) -> Result<i64> {
        self.rt.block_on(self.db.insert_video_chunk(chunk))
    }

    /// Update video chunk
    pub fn update_video_chunk(
        &self,
        chunk_id: i64,
        end_time: i64,
        frame_count: i64,
        file_size: Option<i64>,
    ) -> Result<()> {
        self.rt.block_on(
            self.db
                .update_video_chunk(chunk_id, end_time, frame_count, file_size),
        )
    }

    /// Get video chunk by ID
    pub fn get_video_chunk(&self, chunk_id: i64) -> Result<Option<VideoChunk>> {
        self.rt.block_on(self.db.get_video_chunk(chunk_id))
    }

    /// Get video chunks in time range
    pub fn get_video_chunks_in_range(&self, start_ts: i64, end_ts: i64) -> Result<Vec<VideoChunk>> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::recorder::RecorderOps::new(&conn);
        self.rt
            .block_on(ops.get_video_chunks_in_range(start_ts, end_ts))
    }

    /// Insert a new OCR frame
    pub fn insert_ocr_frame(&self, frame: &OcrFrame) -> Result<i64> {
        self.rt.block_on(self.db.insert_ocr_frame(frame))
    }

    /// Get OCR frame by ID
    pub fn get_ocr_frame(&self, id: i64) -> Result<Option<OcrFrame>> {
        self.rt.block_on(self.db.get_ocr_frame(id))
    }

    /// Get frames in time range
    pub fn get_frames_in_range(&self, start_ts: i64, end_ts: i64) -> Result<Vec<OcrFrame>> {
        self.rt
            .block_on(self.db.get_frames_in_range(start_ts, end_ts))
    }

    /// Search OCR text (FTS)
    pub fn search_ocr_text(&self, query: &str, limit: usize) -> Result<Vec<OcrFrame>> {
        self.rt.block_on(self.db.search_ocr_text(query, limit))
    }

    /// Get last frame hash for deduplication
    pub fn get_last_frame_hash(&self) -> Result<Option<String>> {
        self.rt.block_on(self.db.get_last_frame_hash())
    }

    /// Get current activity context
    pub fn get_current_activity(&self) -> Result<Option<ActivityContext>> {
        self.rt.block_on(self.db.get_current_activity())
    }

    /// Get recorder stats
    pub fn get_recorder_stats(&self) -> Result<RecorderStats> {
        self.rt.block_on(self.db.get_recorder_stats())
    }

    /// Get video chunks older than a timestamp for a specific tier
    pub fn get_chunks_older_than(&self, timestamp: i64, tier: &str) -> Result<Vec<VideoChunk>> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::recorder::RecorderOps::new(&conn);
        self.rt.block_on(ops.get_chunks_older_than(timestamp, tier))
    }

    /// Update storage tier for a video chunk
    pub fn update_chunk_tier(
        &self,
        chunk_id: i64,
        new_tier: crate::types::StorageTier,
    ) -> Result<()> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::recorder::RecorderOps::new(&conn);
        self.rt.block_on(ops.update_chunk_tier(chunk_id, new_tier))
    }

    /// Delete a video chunk and its associated frames
    pub fn delete_video_chunk(&self, chunk_id: i64) -> Result<()> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::recorder::RecorderOps::new(&conn);
        self.rt.block_on(ops.delete_video_chunk(chunk_id))
    }

    /// Get OCR frames older than a timestamp (for cleanup)
    pub fn get_frames_older_than(&self, timestamp: i64) -> Result<Vec<OcrFrame>> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::recorder::RecorderOps::new(&conn);
        self.rt.block_on(ops.get_frames_older_than(timestamp))
    }

    /// Get the oldest OCR frames (for storage limit enforcement)
    pub fn get_oldest_frames(&self, limit: usize) -> Result<Vec<OcrFrame>> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::recorder::RecorderOps::new(&conn);
        self.rt.block_on(ops.get_oldest_frames(limit))
    }

    /// Delete an OCR frame by ID
    pub fn delete_ocr_frame(&self, frame_id: i64) -> Result<()> {
        let conn = self.rt.block_on(self.db.connection());
        let ops = crate::recorder::RecorderOps::new(&conn);
        self.rt.block_on(ops.delete_ocr_frame(frame_id))
    }

    // ========================================================================
    // Context Memory Operations
    // ========================================================================

    /// Record a context snapshot and update its owning session.
    pub fn record_context_snapshot(
        &self,
        snapshot: &ContextSnapshot,
    ) -> Result<crate::context::ContextRecordOutcome> {
        self.rt.block_on(self.db.record_context_snapshot(snapshot))
    }

    /// Get recent context snapshots in a time range.
    pub fn get_recent_context_snapshots(
        &self,
        start_ts: i64,
        end_ts: i64,
        limit: i64,
    ) -> Result<Vec<ContextSnapshot>> {
        self.rt.block_on(
            self.db
                .get_recent_context_snapshots(start_ts, end_ts, limit),
        )
    }

    // ========================================================================
    // Sync Queue Operations
    // ========================================================================

    /// Queue activity event for sync
    pub fn queue_activity_sync(&self, event_id: i64) -> Result<()> {
        self.rt.block_on(self.db.queue_activity_sync(event_id))
    }

    /// Queue activity update
    pub fn queue_activity_update(&self, event_id: i64, ts_end: i64) -> Result<()> {
        self.rt
            .block_on(self.db.queue_activity_update(event_id, ts_end))
    }

    /// Get pending sync count
    pub fn pending_sync_count(&self) -> Result<i64> {
        self.rt.block_on(self.db.pending_sync_count())
    }

    /// Get pending sync items
    pub fn get_pending_sync(&self, limit: i64) -> Result<Vec<QueuedSyncItem>> {
        self.rt.block_on(self.db.get_pending_sync(limit))
    }

    /// Mark sync item as synced
    pub fn mark_synced(&self, queue_id: i64) -> Result<()> {
        self.rt.block_on(self.db.mark_synced(queue_id))
    }

    pub fn mark_synced_many(&self, queue_ids: &[i64]) -> Result<()> {
        self.rt.block_on(self.db.mark_synced_many(queue_ids))
    }

    /// Mark sync item as failed
    pub fn mark_sync_failed(&self, queue_id: i64) -> Result<()> {
        self.rt.block_on(self.db.mark_sync_failed(queue_id))
    }

    /// Mark sync item as permanently invalid.
    pub fn mark_sync_dead_letter(&self, queue_id: i64, last_error: &str) -> Result<()> {
        self.rt
            .block_on(self.db.mark_sync_dead_letter(queue_id, last_error))
    }
}

/// Database statistics (compatible with watcher binary)
#[derive(Debug, Clone)]
pub struct DbStats {
    pub event_count: i64,
    pub afk_count: i64,
    pub oldest_event_ts: Option<i64>,
    pub newest_event_ts: Option<i64>,
    pub db_size_bytes: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_blocking_database_open() {
        let temp_dir = TempDir::new().unwrap();
        let config = DatabaseConfig::for_testing(temp_dir.path());

        let db = BlockingDatabase::open(&config).unwrap();

        assert!(db.db_path().exists());
    }

    #[test]
    fn test_blocking_activity_operations() {
        let temp_dir = TempDir::new().unwrap();
        let config = DatabaseConfig::for_testing(temp_dir.path());
        let db = BlockingDatabase::open(&config).unwrap();

        // Insert an event
        let event = ActivityEvent::new(
            "device-1",
            "user-1",
            1000,
            2000,
            "com.example.app",
            "Example App",
        );

        let id = db.insert_activity_event(&event).unwrap();
        assert!(id > 0);

        // Get it back
        let retrieved = db.get_activity_event(id).unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().app_name, "Example App");
    }
}
