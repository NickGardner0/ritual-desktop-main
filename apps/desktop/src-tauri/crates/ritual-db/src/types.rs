//! Shared types for the Ritual database
//!
//! These types are used across all database operations and can be serialized
//! for API responses.

use serde::{Deserialize, Serialize};

fn new_logical_uid(prefix: &str) -> String {
    let ts = chrono::Utc::now().timestamp_millis();
    let entropy = rand::random::<u64>();
    format!("{prefix}_{ts:016x}_{entropy:016x}")
}

// ============================================================
// ACTIVITY TYPES (from watcher)
// ============================================================

/// Activity event record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub id: Option<i64>,
    pub event_uid: String,
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
            event_uid: new_logical_uid("activity"),
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
    pub afk_uid: String,
    pub device_id: String,
    pub user_id: String,
    pub ts_start: i64,
    pub ts_end: i64,
    pub status: String, // "afk" or "not-afk"
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
// CONTEXT MEMORY TYPES
// ============================================================

/// Structured snapshot of the active foreground context.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSnapshot {
    pub id: Option<i64>,
    pub device_id: String,
    pub user_id: String,
    pub activity_event_id: Option<i64>,
    pub activity_event_uid: Option<String>,
    pub session_id: Option<i64>,
    pub session_uid: Option<String>,
    pub ts: i64,
    pub source_type: String,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub browser_url: Option<String>,
    pub browser_domain: Option<String>,
    pub tab_title: Option<String>,
    pub document_title: Option<String>,
    pub visible_text_raw: String,
    pub visible_text_norm: String,
    pub capture_quality: f64,
    pub capture_components_json: Option<String>,
    pub ax_richness_score: f64,
    pub selected_text_present: bool,
    pub document_path: Option<String>,
    pub ax_source: Option<String>,
    pub capture_trigger: Option<String>,
    pub trigger_to_snapshot_ms: Option<i64>,
    pub ui_elements_json: Option<String>,
    pub dedup_key: String,
    pub is_sensitive_redacted: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ContextSnapshot {
    pub fn new(
        device_id: impl Into<String>,
        user_id: impl Into<String>,
        ts: i64,
        source_type: impl Into<String>,
        app_bundle_id: impl Into<String>,
        app_name: impl Into<String>,
        dedup_key: impl Into<String>,
    ) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            id: None,
            device_id: device_id.into(),
            user_id: user_id.into(),
            activity_event_id: None,
            activity_event_uid: None,
            session_id: None,
            session_uid: None,
            ts,
            source_type: source_type.into(),
            app_bundle_id: app_bundle_id.into(),
            app_name: app_name.into(),
            window_title: None,
            browser_url: None,
            browser_domain: None,
            tab_title: None,
            document_title: None,
            visible_text_raw: String::new(),
            visible_text_norm: String::new(),
            capture_quality: 0.0,
            capture_components_json: None,
            ax_richness_score: 0.0,
            selected_text_present: false,
            document_path: None,
            ax_source: None,
            capture_trigger: None,
            trigger_to_snapshot_ms: None,
            ui_elements_json: None,
            dedup_key: dedup_key.into(),
            is_sensitive_redacted: false,
            created_at: now,
            updated_at: now,
        }
    }
}

/// Session built from contiguous context snapshots.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSession {
    pub id: Option<i64>,
    pub session_uid: String,
    pub device_id: String,
    pub user_id: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub primary_app_bundle_id: Option<String>,
    pub primary_app_name: Option<String>,
    pub primary_domain: Option<String>,
    pub dominant_title: Option<String>,
    pub representative_text: Option<String>,
    pub coverage_score: f64,
    pub snapshot_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ContextSession {
    pub fn new(
        device_id: impl Into<String>,
        user_id: impl Into<String>,
        start_ts: i64,
        end_ts: i64,
    ) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Self {
            id: None,
            session_uid: new_logical_uid("context_session"),
            device_id: device_id.into(),
            user_id: user_id.into(),
            start_ts,
            end_ts,
            primary_app_bundle_id: None,
            primary_app_name: None,
            primary_domain: None,
            dominant_title: None,
            representative_text: None,
            coverage_score: 0.0,
            snapshot_count: 0,
            created_at: now,
            updated_at: now,
        }
    }
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
    /// Extractive summary of OCR text
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
        self.activity_type
            .as_ref()
            .map(|s| crate::activity_classifier::ActivityType::from_str(s))
    }

    /// Get keywords as a vector (if set)
    pub fn get_keywords(&self) -> Vec<String> {
        self.keywords
            .as_ref()
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
    #[serde(rename = "dead_letter")]
    DeadLetter,
}

impl SyncStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncStatus::Pending => "pending",
            SyncStatus::Synced => "synced",
            SyncStatus::Failed => "failed",
            SyncStatus::DeadLetter => "dead_letter",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "synced" | "uploaded" => SyncStatus::Synced,
            "failed" => SyncStatus::Failed,
            "dead_letter" => SyncStatus::DeadLetter,
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
    pub user_id: Option<String>,
    pub device_id: Option<String>,
    pub entity_uid: Option<String>,
    pub op_kind: Option<String>,
    pub payload_json: Option<String>,
    pub retry_count: i64,
    pub status: SyncStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloudSyncStatus {
    Pending,
    Uploading,
    Failed,
    Uploaded,
}

impl CloudSyncStatus {
    pub fn from_str(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "uploading" => Self::Uploading,
            "failed" => Self::Failed,
            "uploaded" => Self::Uploaded,
            _ => Self::Pending,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Uploading => "uploading",
            Self::Failed => "failed",
            Self::Uploaded => "uploaded",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudSyncOutboxItem {
    pub id: i64,
    pub user_id: String,
    pub device_id: String,
    pub entity_type: String,
    pub entity_uid: String,
    pub op_kind: String,
    pub payload_json: String,
    pub status: CloudSyncStatus,
    pub retry_count: i64,
    pub next_retry_at: Option<i64>,
    pub last_error: Option<String>,
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
    pub app_summaries: Option<String>,    // JSON
    pub domain_summaries: Option<String>, // JSON
    pub updated_at: i64,
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
        let event = ActivityEvent::new("device1", "user1", 1000, 2000, "com.test.app", "Test App");
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

}
