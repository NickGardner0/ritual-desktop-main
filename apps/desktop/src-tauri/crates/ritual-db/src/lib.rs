//! Ritual Database - Unified libSQL database layer with vector search
//!
//! This crate provides a unified database layer for the Ritual app, consolidating:
//! - Activity tracking (from watcher.db)
//! - Screen recording metadata and OCR (from frames.db)
//! - Sync queue (from sync_queue.db)
//! - Vector embeddings for semantic search (NEW)
//!
//! # Architecture
//!
//! The database uses libSQL (a SQLite fork) which provides:
//! - Full SQLite compatibility
//! - Native vector search (no extensions needed)
//! - Embedded in the application (no separate install)
//!
//! # Usage
//!
//! ```rust,ignore
//! use ritual_db::{RitualDatabase, DatabaseConfig};
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     let config = DatabaseConfig::default();
//!     let db = RitualDatabase::open(&config).await?;
//!     
//!     // Use the database...
//!     
//!     Ok(())
//! }
//! ```

pub mod schema;
pub mod migration;
pub mod activity;
pub mod recorder;
pub mod sync;
pub mod vector;
pub mod segments;
pub mod context;
pub mod error;
pub mod types;
pub mod blocking;
pub mod text_processing;
pub mod activity_classifier;

// Re-export main types at crate root
pub use error::{DatabaseError, Result};
pub use types::*;

use libsql::{Builder, Connection, Database};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

/// Configuration for the Ritual database
#[derive(Debug, Clone)]
pub struct DatabaseConfig {
    /// Path to the database file (default: ~/.ritual/ritual.db)
    pub db_path: PathBuf,
    /// Path to the ritual data directory (default: ~/.ritual)
    pub data_dir: PathBuf,
    /// Whether to run migrations on startup
    pub auto_migrate: bool,
    /// Whether to enable vector embeddings
    pub enable_embeddings: bool,
    /// Maximum number of connections in the pool (not used for embedded, but for future)
    pub max_connections: u32,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let data_dir = PathBuf::from(&home).join(".ritual");
        
        Self {
            db_path: data_dir.join("ritual.db"),
            data_dir,
            auto_migrate: true,
            enable_embeddings: true,
            max_connections: 1,
        }
    }
}

impl DatabaseConfig {
    /// Create a config with a custom database path
    pub fn with_path(db_path: impl Into<PathBuf>) -> Self {
        let db_path = db_path.into();
        let data_dir = db_path.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));
        
        Self {
            db_path,
            data_dir,
            ..Default::default()
        }
    }
    
    /// Create a config for testing with a temporary database
    pub fn for_testing(temp_dir: &Path) -> Self {
        Self {
            db_path: temp_dir.join("test_ritual.db"),
            data_dir: temp_dir.to_path_buf(),
            auto_migrate: true,
            enable_embeddings: false, // Disable for faster tests
            max_connections: 1,
        }
    }
}

/// The main Ritual database handle
/// 
/// Thread-safe and can be cloned and shared across threads.
pub struct RitualDatabase {
    #[allow(dead_code)]
    db: Database,  // Keep reference to prevent database from being dropped
    config: DatabaseConfig,
    /// Connection for general operations
    conn: Arc<RwLock<Connection>>,
    /// Optional embedding service (lazy-initialized)
    embedding_service: Arc<RwLock<Option<vector::EmbeddingService>>>,
}

impl RitualDatabase {
    /// Open or create the database at the configured path
    pub async fn open(config: &DatabaseConfig) -> Result<Self> {
        info!("Opening Ritual database at: {:?}", config.db_path);
        
        // Ensure directory exists
        if let Some(parent) = config.db_path.parent() {
            tokio::fs::create_dir_all(parent).await
                .map_err(|e| DatabaseError::Io(e.to_string()))?;
        }
        
        // Build the database
        let db = Builder::new_local(config.db_path.to_str().unwrap())
            .build()
            .await
            .map_err(|e| DatabaseError::Connection(e.to_string()))?;
        
        let conn = db.connect()
            .map_err(|e| DatabaseError::Connection(e.to_string()))?;
        
        // Enable WAL mode for better concurrency
        // Note: PRAGMA statements may return rows, so we use query and consume the result
        let _ = conn.query("PRAGMA journal_mode = WAL;", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let _ = conn.query("PRAGMA synchronous = NORMAL;", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        // Wait for write locks under recorder/watcher concurrent writes (two
        // processes share ritual.db; only one writer at a time).
        let _ = conn.query("PRAGMA busy_timeout = 30000;", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        // Keep WAL checkpoints bounded to reduce long writer stalls.
        let _ = conn.query("PRAGMA wal_autocheckpoint = 1000;", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let _ = conn.query("PRAGMA cache_size = -2000;", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let _ = conn.query("PRAGMA temp_store = MEMORY;", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let ritual_db = Self {
            db,
            config: config.clone(),
            conn: Arc::new(RwLock::new(conn)),
            embedding_service: Arc::new(RwLock::new(None)),
        };
        
        // Initialize schema
        ritual_db.initialize_schema().await?;
        
        // Run migrations if enabled
        if config.auto_migrate {
            ritual_db.run_migrations_if_needed().await?;
        }
        
        info!("Ritual database opened successfully");
        
        Ok(ritual_db)
    }
    
    /// Initialize the database schema
    async fn initialize_schema(&self) -> Result<()> {
        let conn = self.conn.read().await;
        schema::initialize_schema(&conn).await
    }
    
    /// Run migrations from legacy SQLite databases if they exist
    async fn run_migrations_if_needed(&self) -> Result<()> {
        let conn = self.conn.read().await;
        migration::migrate_if_needed(&conn, &self.config.data_dir).await
    }
    
    /// Get a reference to the connection for operations
    pub async fn connection(&self) -> tokio::sync::RwLockReadGuard<'_, Connection> {
        self.conn.read().await
    }
    
    /// Get a mutable reference to the connection for write operations
    pub async fn connection_mut(&self) -> tokio::sync::RwLockWriteGuard<'_, Connection> {
        self.conn.write().await
    }
    
    /// Initialize the embedding service (lazy, call when needed)
    pub async fn init_embedding_service(&self) -> Result<()> {
        let mut service = self.embedding_service.write().await;
        if service.is_none() {
            info!("Initializing embedding service...");
            *service = Some(vector::EmbeddingService::new()?);
            info!("Embedding service initialized");
        }
        Ok(())
    }
    
    /// Get the embedding service if initialized
    pub async fn embedding_service(&self) -> Option<tokio::sync::RwLockReadGuard<'_, Option<vector::EmbeddingService>>> {
        let service = self.embedding_service.read().await;
        if service.is_some() {
            Some(service)
        } else {
            None
        }
    }
    
    /// Get the database configuration
    pub fn config(&self) -> &DatabaseConfig {
        &self.config
    }
    
    /// Get the path to the database file
    pub fn db_path(&self) -> &Path {
        &self.config.db_path
    }
    
    /// Check if the database file exists
    pub fn exists(&self) -> bool {
        self.config.db_path.exists()
    }
    
    /// Get database statistics
    pub async fn get_stats(&self) -> Result<DatabaseStats> {
        let conn = self.conn.read().await;
        
        let activity_count: i64 = conn
            .query("SELECT COUNT(*) FROM activity_events", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        let frame_count: i64 = conn
            .query("SELECT COUNT(*) FROM ocr_frames", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        let embedding_count: i64 = conn
            .query("SELECT COUNT(*) FROM ocr_embeddings", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        let video_chunk_count: i64 = conn
            .query("SELECT COUNT(*) FROM video_chunks", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        let sync_queue_pending: i64 = conn
            .query("SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        // Get file size
        let db_size_bytes = tokio::fs::metadata(&self.config.db_path)
            .await
            .map(|m| m.len() as i64)
            .unwrap_or(0);
        
        Ok(DatabaseStats {
            activity_event_count: activity_count,
            ocr_frame_count: frame_count,
            embedding_count,
            video_chunk_count,
            sync_queue_pending,
            db_size_bytes,
        })
    }
}

/// Database statistics
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DatabaseStats {
    pub activity_event_count: i64,
    pub ocr_frame_count: i64,
    pub embedding_count: i64,
    pub video_chunk_count: i64,
    pub sync_queue_pending: i64,
    pub db_size_bytes: i64,
}

// ============================================================================
// CONVENIENCE METHODS - Delegates to operation modules
// ============================================================================

impl RitualDatabase {
    // --------------------------------------------------------------------
    // Activity Operations
    // --------------------------------------------------------------------
    
    /// Insert a new activity event
    pub async fn insert_activity_event(&self, event: &ActivityEvent) -> Result<i64> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).insert_activity_event(event).await
    }
    
    /// Update the end time of an activity event
    pub async fn update_event_end_time(&self, event_id: i64, ts_end: i64) -> Result<()> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).update_event_end_time(event_id, ts_end).await
    }
    
    /// Get the last event for a device (for heartbeat merging)
    pub async fn get_last_event(&self, device_id: &str) -> Result<Option<LastEvent>> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_last_event(device_id).await
    }
    
    /// Get an activity event by ID
    pub async fn get_activity_event(&self, id: i64) -> Result<Option<ActivityEvent>> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_activity_event(id).await
    }
    
    /// Get recent activity events
    pub async fn get_recent_events(&self, device_id: &str, limit: i64) -> Result<Vec<ActivityEvent>> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_recent_events(device_id, limit).await
    }
    
    /// Get activity events in a time range
    pub async fn get_events_in_range(&self, device_id: &str, ts_start: i64, ts_end: i64) -> Result<Vec<ActivityEvent>> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_events_in_range(device_id, ts_start, ts_end).await
    }
    
    /// Update heartbeat
    pub async fn update_heartbeat(&self, device_id: &str, timestamp: i64) -> Result<()> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).update_heartbeat(device_id, timestamp).await
    }
    
    /// Get app summary for a time range
    pub async fn get_app_summary(&self, device_id: &str, ts_start: i64, ts_end: i64) -> Result<Vec<AppSummary>> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_app_summary(device_id, ts_start, ts_end).await
    }
    
    /// Get domain summary for a time range
    pub async fn get_domain_summary(&self, device_id: &str, ts_start: i64, ts_end: i64) -> Result<Vec<DomainSummary>> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_domain_summary(device_id, ts_start, ts_end).await
    }
    
    /// Get daily summary
    pub async fn get_daily_summary(&self, device_id: &str, ts_start: i64, ts_end: i64) -> Result<DailySummary> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_daily_summary(device_id, ts_start, ts_end).await
    }
    
    /// Get focus metrics
    pub async fn get_focus_metrics(&self, device_id: &str, ts_start: i64, ts_end: i64) -> Result<FocusMetrics> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_focus_metrics(device_id, ts_start, ts_end).await
    }
    
    /// Delete old activity events
    pub async fn delete_old_events(&self, days: i64) -> Result<i64> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).delete_old_events(days).await
    }

    /// Clamp stale browser-extension events to a maximum span.
    pub async fn clamp_stale_browser_extension_events(
        &self,
        device_id: &str,
        stale_before_ts: i64,
        max_span_ms: i64,
    ) -> Result<i64> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn)
            .clamp_stale_browser_extension_events(device_id, stale_before_ts, max_span_ms)
            .await
    }

    /// Delete exact duplicate browser-extension events.
    pub async fn delete_duplicate_browser_extension_events(
        &self,
        device_id: &str,
        lookback_ts: i64,
    ) -> Result<i64> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn)
            .delete_duplicate_browser_extension_events(device_id, lookback_ts)
            .await
    }
    
    /// Get the last heartbeat timestamp for a device
    pub async fn get_last_heartbeat(&self, device_id: &str) -> Result<Option<i64>> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_last_heartbeat(device_id).await
    }
    
    /// Get database statistics (event counts, date range, size)
    pub async fn get_db_stats(&self, _device_id: &str) -> Result<blocking::DbStats> {
        let conn = self.conn.read().await;
        activity::ActivityOps::new(&conn).get_db_stats().await
    }
    
    // --------------------------------------------------------------------
    // Recorder Operations
    // --------------------------------------------------------------------
    
    /// Insert a new video chunk
    pub async fn insert_video_chunk(&self, chunk: &VideoChunk) -> Result<i64> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).insert_video_chunk(chunk).await
    }
    
    /// Update video chunk
    pub async fn update_video_chunk(&self, chunk_id: i64, end_time: i64, frame_count: i64, file_size: Option<i64>) -> Result<()> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).update_video_chunk(chunk_id, end_time, frame_count, file_size).await
    }
    
    /// Get video chunk by ID
    pub async fn get_video_chunk(&self, chunk_id: i64) -> Result<Option<VideoChunk>> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).get_video_chunk(chunk_id).await
    }
    
    /// Insert a new OCR frame
    pub async fn insert_ocr_frame(&self, frame: &OcrFrame) -> Result<i64> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).insert_ocr_frame(frame).await
    }
    
    /// Get OCR frame by ID
    pub async fn get_ocr_frame(&self, id: i64) -> Result<Option<OcrFrame>> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).get_ocr_frame(id).await
    }
    
    /// Get frames in time range
    pub async fn get_frames_in_range(&self, start_ts: i64, end_ts: i64) -> Result<Vec<OcrFrame>> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).get_frames_in_range(start_ts, end_ts).await
    }
    
    /// Search OCR text
    pub async fn search_ocr_text(&self, query: &str, limit: usize) -> Result<Vec<OcrFrame>> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).search_ocr_text(query, limit).await
    }
    
    /// Get last frame hash for deduplication
    pub async fn get_last_frame_hash(&self) -> Result<Option<String>> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).get_last_frame_hash().await
    }
    
    /// Get current activity context
    pub async fn get_current_activity(&self) -> Result<Option<ActivityContext>> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).get_current_activity().await
    }
    
    /// Get recorder stats
    pub async fn get_recorder_stats(&self) -> Result<RecorderStats> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).get_stats().await
    }
    
    /// Get frames without embeddings
    pub async fn get_frames_without_embeddings(&self, limit: usize) -> Result<Vec<OcrFrame>> {
        let conn = self.conn.read().await;
        recorder::RecorderOps::new(&conn).get_frames_without_embeddings(limit).await
    }

    // --------------------------------------------------------------------
    // Context Memory Operations
    // --------------------------------------------------------------------

    /// Record a context snapshot and update its owning session/doc.
    pub async fn record_context_snapshot(
        &self,
        snapshot: &ContextSnapshot,
    ) -> Result<context::ContextRecordOutcome> {
        let conn = self.conn.read().await;
        context::ContextOps::new(&conn)
            .record_context_snapshot(snapshot)
            .await
    }

    /// Get recent context snapshots in a time range.
    pub async fn get_recent_context_snapshots(
        &self,
        start_ts: i64,
        end_ts: i64,
        limit: i64,
    ) -> Result<Vec<ContextSnapshot>> {
        let conn = self.conn.read().await;
        context::ContextOps::new(&conn)
            .get_recent_context_snapshots(start_ts, end_ts, limit)
            .await
    }

    /// Get context-derived retrieval docs in a time range.
    pub async fn get_session_retrieval_docs(
        &self,
        start_ts: i64,
        end_ts: i64,
        limit: i64,
    ) -> Result<Vec<SessionRetrievalDoc>> {
        let conn = self.conn.read().await;
        context::ContextOps::new(&conn)
            .get_session_retrieval_docs(start_ts, end_ts, limit)
            .await
    }
    
    // --------------------------------------------------------------------
    // Sync Queue Operations
    // --------------------------------------------------------------------
    
    /// Queue activity event for sync
    pub async fn queue_activity_sync(&self, event_id: i64) -> Result<()> {
        let conn = self.conn.read().await;
        sync::SyncOps::new(&conn).queue_activity_sync(event_id).await
    }
    
    /// Queue activity update
    pub async fn queue_activity_update(&self, event_id: i64, ts_end: i64) -> Result<()> {
        let conn = self.conn.read().await;
        sync::SyncOps::new(&conn).queue_activity_update(event_id, ts_end).await
    }
    
    /// Get pending sync count
    pub async fn pending_sync_count(&self) -> Result<i64> {
        let conn = self.conn.read().await;
        sync::SyncOps::new(&conn).pending_count().await
    }
    
    /// Get pending sync items
    pub async fn get_pending_sync(&self, limit: i64) -> Result<Vec<QueuedSyncItem>> {
        let conn = self.conn.read().await;
        sync::SyncOps::new(&conn).get_pending(limit).await
    }
    
    /// Mark sync item as synced
    pub async fn mark_synced(&self, queue_id: i64) -> Result<()> {
        let conn = self.conn.read().await;
        sync::SyncOps::new(&conn).mark_synced(queue_id).await
    }
    
    /// Mark sync item as failed
    pub async fn mark_sync_failed(&self, queue_id: i64) -> Result<()> {
        let conn = self.conn.read().await;
        sync::SyncOps::new(&conn).mark_failed(queue_id).await
    }
    
    // --------------------------------------------------------------------
    // Vector/Embedding Operations
    // --------------------------------------------------------------------
    
    /// Insert embedding for a frame
    pub async fn insert_embedding(&self, frame_id: i64, embedding: &[f32]) -> Result<i64> {
        let conn = self.conn.read().await;
        vector::VectorOps::new(&conn).insert_embedding(frame_id, embedding).await
    }
    
    /// Semantic search
    pub async fn semantic_search(&self, query_embedding: &[f32], options: &SearchOptions) -> Result<Vec<SearchResult>> {
        let conn = self.conn.read().await;
        vector::VectorOps::new(&conn).semantic_search(query_embedding, options).await
    }
    
    /// Get embedding stats
    pub async fn get_embedding_stats(&self) -> Result<vector::EmbeddingStats> {
        let conn = self.conn.read().await;
        vector::VectorOps::new(&conn).get_embedding_stats().await
    }
    
    /// High-level semantic search with text query
    /// 
    /// This combines embedding generation and vector search.
    pub async fn search_semantic(&self, query: &str, options: SearchOptions) -> Result<Vec<SearchResult>> {
        // Get or initialize embedding service
        let service_guard = self.embedding_service.read().await;
        let service = service_guard.as_ref()
            .ok_or_else(|| DatabaseError::Embedding("Embedding service not initialized. Call init_embedding_service() first.".to_string()))?;
        
        // Generate query embedding
        let query_embedding = service.embed(query)?;
        
        // Perform search
        drop(service_guard);  // Release the lock before the next await
        self.semantic_search(&query_embedding, &options).await
    }
    
    /// High-level hybrid search combining FTS and vector similarity
    /// 
    /// This is the recommended search method for best results:
    /// - FTS provides fast, precise keyword matching
    /// - Vector similarity provides semantic understanding
    /// - Combined scoring provides the best of both
    pub async fn search_hybrid(
        &self,
        query: &str,
        options: SearchOptions,
        fts_weight: f32,
        vector_weight: f32,
    ) -> Result<Vec<vector::HybridSearchResult>> {
        // Get or initialize embedding service
        let service_guard = self.embedding_service.read().await;
        let service = service_guard.as_ref()
            .ok_or_else(|| DatabaseError::Embedding("Embedding service not initialized. Call init_embedding_service() first.".to_string()))?;
        
        // Generate query embedding
        let query_embedding = service.embed(query)?;
        
        // Perform hybrid search
        drop(service_guard);  // Release the lock before the next await
        
        let conn = self.conn.read().await;
        vector::VectorOps::new(&conn).hybrid_search(
            query,
            &query_embedding,
            &options,
            fts_weight,
            vector_weight,
        ).await
    }
    
    // --------------------------------------------------------------------
    // Segment Operations
    // --------------------------------------------------------------------
    
    /// Get segments in a time range
    pub async fn get_segments_in_range(&self, device_id: &str, ts_start: i64, ts_end: i64) -> Result<Vec<segments::ActivitySegment>> {
        let conn = self.conn.read().await;
        segments::SegmentOps::new(&conn).get_segments_in_range(device_id, ts_start, ts_end).await
    }
    
    /// Get the segment at a specific timestamp
    pub async fn get_segment_at_time(&self, device_id: &str, timestamp: i64) -> Result<Option<segments::ActivitySegment>> {
        let conn = self.conn.read().await;
        segments::SegmentOps::new(&conn).get_segment_at_time(device_id, timestamp).await
    }
    
    /// Get frames for a segment
    pub async fn get_frames_for_segment(&self, segment_id: i64) -> Result<Vec<OcrFrame>> {
        let conn = self.conn.read().await;
        segments::SegmentOps::new(&conn).get_frames_for_segment(segment_id).await
    }
    
    /// Create segments from activity events in a time range
    pub async fn create_segments(&self, device_id: &str, ts_start: i64, ts_end: i64) -> Result<Vec<i64>> {
        let conn = self.conn.read().await;
        segments::SegmentOps::new(&conn).create_segments_from_events(
            device_id,
            ts_start,
            ts_end,
            segments::SEGMENT_GAP_THRESHOLD_MS,
        ).await
    }
    
    /// Get segment statistics
    pub async fn get_segment_stats(&self, device_id: &str, ts_start: i64, ts_end: i64) -> Result<segments::SegmentStats> {
        let conn = self.conn.read().await;
        segments::SegmentOps::new(&conn).get_segment_stats(device_id, ts_start, ts_end).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    
    #[tokio::test]
    async fn test_database_open() {
        let temp_dir = TempDir::new().unwrap();
        let config = DatabaseConfig::for_testing(temp_dir.path());
        
        let db = RitualDatabase::open(&config).await.unwrap();
        
        assert!(db.exists());
        
        let stats = db.get_stats().await.unwrap();
        assert_eq!(stats.activity_event_count, 0);
        assert_eq!(stats.ocr_frame_count, 0);
    }
    
    #[tokio::test]
    async fn test_database_config_default() {
        let config = DatabaseConfig::default();
        assert!(config.db_path.to_string_lossy().contains(".ritual"));
        assert!(config.db_path.to_string_lossy().contains("ritual.db"));
    }
}
