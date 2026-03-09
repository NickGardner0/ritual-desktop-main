//! Shared types for the Ritual database
//!
//! These types are used across all database operations and can be serialized
//! for API responses.

use serde::{Deserialize, Serialize};

// ============================================================
// ACTIVITY TYPES (from watcher)
// ============================================================

/// Activity event record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub id: Option<i64>,
    pub device_id: String,
    pub user_id: String,
    pub ts_start: i64,
    pub ts_end: i64,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub window_title_hash: Option<String>,
    pub window_owner_pid: Option<i32>,
    pub is_afk: bool,
    pub browser_url: Option<String>,
    pub browser_domain: Option<String>,
    pub is_incognito: bool,
    pub source: String,
    pub created_at: i64,
}

impl ActivityEvent {
    /// Create a new activity event (without id, will be assigned on insert)
    pub fn new(
        device_id: impl Into<String>,
        user_id: impl Into<String>,
        ts_start: i64,
        ts_end: i64,
        app_bundle_id: impl Into<String>,
        app_name: impl Into<String>,
    ) -> Self {
        Self {
            id: None,
            device_id: device_id.into(),
            user_id: user_id.into(),
            ts_start,
            ts_end,
            app_bundle_id: app_bundle_id.into(),
            app_name: app_name.into(),
            window_title: None,
            window_title_hash: None,
            window_owner_pid: None,
            is_afk: false,
            browser_url: None,
            browser_domain: None,
            is_incognito: false,
            source: "ritual_watcher_v2".to_string(),
            created_at: chrono::Utc::now().timestamp_millis(),
        }
    }
    
    /// Get the duration in milliseconds
    pub fn duration_ms(&self) -> i64 {
        self.ts_end.saturating_sub(self.ts_start)
    }
}

/// AFK (Away From Keyboard) event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AfkEvent {
    pub id: Option<i64>,
    pub device_id: String,
    pub user_id: String,
    pub ts_start: i64,
    pub ts_end: i64,
    pub status: String,  // "afk" or "not-afk"
    pub created_at: i64,
}

/// Last event info for heartbeat merging
#[derive(Debug, Clone)]
pub struct LastEvent {
    pub id: i64,
    pub ts_start: i64,
    pub ts_end: i64,
    pub app_bundle_id: String,
    pub window_title: Option<String>,
    pub window_title_hash: Option<String>,
    pub browser_url: Option<String>,
    pub browser_domain: Option<String>,
    pub is_afk: bool,
}

/// App usage summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSummary {
    pub bundle_id: String,
    pub app_name: String,
    pub event_count: i64,
    pub total_ms: i64,
}

/// Domain usage summary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainSummary {
    pub domain: String,
    pub event_count: i64,
    pub total_ms: i64,
}

/// Daily summary statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySummary {
    pub date: String,
    pub device_id: String,
    pub active_ms: i64,
    pub afk_ms: i64,
    pub event_count: i64,
    pub app_count: i64,
    pub domain_count: i64,
}

/// Focus and productivity metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusMetrics {
    pub context_switches: i64,
    pub longest_focus_session_ms: i64,
    pub focus_sessions_30min_plus: i64,
    pub fragmented_time_ms: i64,
    pub deep_work_time_ms: i64,
}

// ============================================================
// RECORDER TYPES (OCR frames, video chunks)
// ============================================================

/// Storage tier for data retention
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StorageTier {
    /// Hot tier - recent data, full quality
    Hot,
    /// Warm tier - older data, reduced quality
    Warm,
    /// Cold tier - archived, text only (no video)
    Cold,
}

impl StorageTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            StorageTier::Hot => "hot",
            StorageTier::Warm => "warm",
            StorageTier::Cold => "cold",
        }
    }
    
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "warm" => StorageTier::Warm,
            "cold" => StorageTier::Cold,
            _ => StorageTier::Hot,
        }
    }
}

impl Default for StorageTier {
    fn default() -> Self {
        StorageTier::Hot
    }
}

/// OCR frame record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrFrame {
    pub id: Option<i64>,
    pub timestamp: i64,
    pub activity_event_id: Option<i64>,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub ocr_text: String,
    pub ocr_confidence: f64,
    pub thumbnail_path: Option<String>,
    pub video_chunk_id: Option<i64>,
    pub frame_offset: Option<i64>,
    pub image_hash: String,
    pub storage_tier: StorageTier,
    pub created_at: Option<String>,
    /// Extractive summary of OCR text (for better embeddings)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Classified activity type (coding, browsing, messaging, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_type: Option<String>,
    /// Extracted keywords as JSON array
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keywords: Option<String>,
    /// Text quality score (0.0-1.0)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_quality: Option<f64>,
}

impl OcrFrame {
    /// Create a new OCR frame
    pub fn new(
        timestamp: i64,
        app_bundle_id: impl Into<String>,
        app_name: impl Into<String>,
        ocr_text: impl Into<String>,
        image_hash: impl Into<String>,
    ) -> Self {
        Self {
            id: None,
            timestamp,
            activity_event_id: None,
            app_bundle_id: app_bundle_id.into(),
            app_name: app_name.into(),
            window_title: None,
            ocr_text: ocr_text.into(),
            ocr_confidence: 0.0,
            thumbnail_path: None,
            video_chunk_id: None,
            frame_offset: None,
            image_hash: image_hash.into(),
            storage_tier: StorageTier::Hot,
            created_at: None,
            summary: None,
            activity_type: None,
            keywords: None,
            text_quality: None,
        }
    }
    
    /// Get the activity type as enum (if set)
    pub fn get_activity_type(&self) -> Option<crate::activity_classifier::ActivityType> {
        self.activity_type.as_ref().map(|s| crate::activity_classifier::ActivityType::from_str(s))
    }
    
    /// Get keywords as a vector (if set)
    pub fn get_keywords(&self) -> Vec<String> {
        self.keywords.as_ref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default()
    }
}

/// Video chunk record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoChunk {
    pub id: Option<i64>,
    pub file_path: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub frame_count: i64,
    pub file_size_bytes: Option<i64>,
    pub monitor_id: u32,
    pub storage_tier: StorageTier,
    pub created_at: Option<String>,
}

impl VideoChunk {
    /// Create a new video chunk
    pub fn new(file_path: impl Into<String>, start_time: i64, monitor_id: u32) -> Self {
        Self {
            id: None,
            file_path: file_path.into(),
            start_time,
            end_time: None,
            frame_count: 0,
            file_size_bytes: None,
            monitor_id,
            storage_tier: StorageTier::Hot,
            created_at: None,
        }
    }
}

/// Recorder statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecorderStats {
    pub total_frames: i64,
    pub total_video_chunks: i64,
    pub total_storage_bytes: i64,
    pub last_capture_time: Option<i64>,
}

/// Activity context from watcher (used by recorder)
#[derive(Debug, Clone)]
pub struct ActivityContext {
    pub event_id: i64,
    pub bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
}

/// Raw capture event for append-only ingestion log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureEventRaw {
    pub id: Option<i64>,
    pub event_type: String,
    pub device_id: Option<String>,
    pub user_id: Option<String>,
    pub ts_event: i64,
    pub payload_json: String,
    pub dedup_key: Option<String>,
    pub ingest_status: String,
    pub ingest_error: Option<String>,
    pub created_at: i64,
    pub ingested_at: Option<i64>,
}

/// Semantic chunk built from contiguous OCR frames
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchChunk {
    pub id: Option<i64>,
    pub device_id: String,
    pub user_id: String,
    pub logical_chunk_id: Option<String>,
    pub chunk_start_ts: i64,
    pub chunk_end_ts: i64,
    pub app_bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title_norm: Option<String>,
    pub browser_domain: Option<String>,
    pub raw_text_compact: String,
    pub contextual_text_compact: String,
    pub text_compact: String,
    pub content_hash: Option<String>,
    pub keywords_json: Option<String>,
    pub quality_score: f64,
    pub frame_count: i64,
    pub build_version: i64,
    pub context_version: i64,
    pub session_key: Option<String>,
    pub session_position: i64,
    pub session_chunk_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Chunk embedding state record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkEmbedding {
    pub id: Option<i64>,
    pub chunk_id: i64,
    pub model_version: String,
    pub status: String,
    pub error_message: Option<String>,
    pub retry_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Pipeline freshness and source state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineWatermarks {
    pub id: i64,
    pub last_capture_ts: Option<i64>,
    pub last_activity_ts: Option<i64>,
    pub last_ocr_frame_ts: Option<i64>,
    pub last_chunk_built_ts: Option<i64>,
    pub last_chunk_embedded_ts: Option<i64>,
    pub pending_chunks: i64,
    pub oldest_pending_chunk_ts: Option<i64>,
    pub source_mismatch: bool,
    pub source_mismatch_note: Option<String>,
    pub updated_at: i64,
}

// ============================================================
// SYNC QUEUE TYPES
// ============================================================

/// Sync status for queued items
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncStatus {
    Pending,
    Synced,
    Failed,
}

impl SyncStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncStatus::Pending => "pending",
            SyncStatus::Synced => "synced",
            SyncStatus::Failed => "failed",
        }
    }
    
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "synced" => SyncStatus::Synced,
            "failed" => SyncStatus::Failed,
            _ => SyncStatus::Pending,
        }
    }
}

/// Queued item for sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedSyncItem {
    pub id: i64,
    pub entry_type: String,
    pub event_id: i64,
    pub ts_end: Option<i64>,
    pub retry_count: i64,
    pub status: SyncStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Daily rollup cache
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyRollup {
    pub date: String,
    pub device_id: String,
    pub user_id: String,
    pub total_active_ms: i64,
    pub total_afk_ms: i64,
    pub app_summaries: Option<String>,  // JSON
    pub domain_summaries: Option<String>,  // JSON
    pub updated_at: i64,
}

// ============================================================
// VECTOR/EMBEDDING TYPES
// ============================================================

/// OCR embedding record
#[derive(Debug, Clone)]
pub struct OcrEmbedding {
    pub id: Option<i64>,
    pub frame_id: i64,
    pub embedding: Vec<f32>,
    pub model_version: String,
    pub created_at: i64,
}

/// Search result with similarity score
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub frame: OcrFrame,
    pub distance: f32,
    pub relevance_score: f32,  // 1.0 - distance (higher is better)
}

/// Semantic search options
#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    /// Maximum number of results
    pub limit: usize,
    /// Minimum relevance score (0.0 - 1.0)
    pub min_relevance: Option<f32>,
    /// Filter by time range (start_ts, end_ts)
    pub time_range: Option<(i64, i64)>,
    /// Filter by app bundle IDs
    pub app_filter: Option<Vec<String>>,
    /// Filter by activity type (coding, browsing, etc.)
    pub activity_type_filter: Option<Vec<String>>,
    /// Minimum text quality score (0.0 - 1.0)
    pub min_text_quality: Option<f64>,
    /// Include frames without embeddings in text search fallback
    pub include_non_embedded: bool,
}

impl SearchOptions {
    pub fn new(limit: usize) -> Self {
        Self {
            limit,
            ..Default::default()
        }
    }
    
    pub fn with_time_range(mut self, start: i64, end: i64) -> Self {
        self.time_range = Some((start, end));
        self
    }
    
    pub fn with_min_relevance(mut self, min: f32) -> Self {
        self.min_relevance = Some(min);
        self
    }
    
    pub fn with_apps(mut self, apps: Vec<String>) -> Self {
        self.app_filter = Some(apps);
        self
    }
    
    /// Filter by activity types (coding, browsing, messaging, etc.)
    pub fn with_activity_types(mut self, types: Vec<String>) -> Self {
        self.activity_type_filter = Some(types);
        self
    }
    
    /// Set minimum text quality score
    pub fn with_min_text_quality(mut self, min: f64) -> Self {
        self.min_text_quality = Some(min);
        self
    }
}

// ============================================================
// MIGRATION TYPES
// ============================================================

/// Migration result
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MigrationResult {
    pub activity_events_migrated: i64,
    pub afk_events_migrated: i64,
    pub ocr_frames_migrated: i64,
    pub video_chunks_migrated: i64,
    pub sync_queue_migrated: i64,
    pub legacy_dbs_backed_up: Vec<String>,
    pub errors: Vec<String>,
}

impl MigrationResult {
    pub fn is_success(&self) -> bool {
        self.errors.is_empty()
    }
    
    pub fn total_migrated(&self) -> i64 {
        self.activity_events_migrated
            + self.afk_events_migrated
            + self.ocr_frames_migrated
            + self.video_chunks_migrated
            + self.sync_queue_migrated
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_activity_event_duration() {
        let event = ActivityEvent::new(
            "device1",
            "user1",
            1000,
            2000,
            "com.test.app",
            "Test App",
        );
        assert_eq!(event.duration_ms(), 1000);
    }
    
    #[test]
    fn test_storage_tier_serde() {
        assert_eq!(StorageTier::Hot.as_str(), "hot");
        assert_eq!(StorageTier::from_str("warm"), StorageTier::Warm);
        assert_eq!(StorageTier::from_str("COLD"), StorageTier::Cold);
        assert_eq!(StorageTier::from_str("unknown"), StorageTier::Hot);
    }
    
    #[test]
    fn test_sync_status_serde() {
        assert_eq!(SyncStatus::Pending.as_str(), "pending");
        assert_eq!(SyncStatus::from_str("synced"), SyncStatus::Synced);
        assert_eq!(SyncStatus::from_str("FAILED"), SyncStatus::Failed);
    }
    
    #[test]
    fn test_search_options_builder() {
        let opts = SearchOptions::new(10)
            .with_time_range(1000, 2000)
            .with_min_relevance(0.5);
        
        assert_eq!(opts.limit, 10);
        assert_eq!(opts.time_range, Some((1000, 2000)));
        assert_eq!(opts.min_relevance, Some(0.5));
    }
}
