//! Configuration for Ritual Recorder
//!
//! Handles all configuration options including:
//! - Capture settings (interval)
//! - Storage settings (paths, limits, retention)
//! - OCR settings (language, engine)
//! - Privacy settings (excluded apps)
//!
//! Note: Video encoding has been removed to save storage.
//! Thumbnails + OCR text provide sufficient context for semantic search.

#![allow(dead_code)] // Some config options reserved for future use

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

/// Storage tier for data retention
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StorageTier {
    /// Hot tier: Recent data, full quality
    Hot,
    /// Warm tier: Older data, compressed
    Warm,
    /// Cold tier: Old data, thumbnails + OCR text only
    Cold,
}

/// Main configuration for the recorder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecorderConfig {
    // === Paths ===
    /// Path to the frames database
    pub frames_db_path: PathBuf,
    /// Path to the watcher database (for activity correlation)
    pub watcher_db_path: PathBuf,
    /// Directory for thumbnails
    pub thumbnail_dir: PathBuf,

    // === Capture Settings ===
    /// Interval between screen captures in milliseconds
    pub capture_interval_ms: u64,
    /// Monitor ID to capture (0 = primary)
    pub monitor_id: u32,

    // === Deduplication ===
    /// Enable frame deduplication to save storage
    pub enable_dedup: bool,
    /// Minimum visual difference to store a frame (0.0-1.0)
    /// Lower = more sensitive, more frames stored
    pub dedup_threshold: f64,
    /// Maximum interval between stored frames even if identical (seconds)
    pub max_frame_gap_secs: u64,

    // === OCR Settings ===
    /// Enable OCR text extraction
    pub enable_ocr: bool,
    /// OCR language (e.g., "en-US")
    pub ocr_language: String,

    // === Storage Management ===
    /// Maximum storage limit in GB (0 = unlimited)
    pub storage_limit_gb: u64,
    /// Days to keep thumbnails + OCR data
    pub retention_days: u64,

    // === Privacy ===
    /// Bundle IDs of apps to exclude from recording
    pub excluded_apps: Vec<String>,
    /// Window titles to exclude (substring match)
    pub excluded_titles: Vec<String>,
    /// Don't record when screen is locked
    pub pause_when_locked: bool,
}

impl Default for RecorderConfig {
    fn default() -> Self {
        Self {
            // Paths - will be set based on --database arg
            frames_db_path: PathBuf::from("~/.ritual/frames.db"),
            watcher_db_path: PathBuf::from("~/.ritual/watcher.db"),
            thumbnail_dir: PathBuf::from("~/.ritual/thumbnails"),

            // Capture
            capture_interval_ms: 1000, // 1 FPS
            monitor_id: 0,

            // Deduplication
            enable_dedup: true,
            dedup_threshold: 0.02, // 2% visual difference
            max_frame_gap_secs: 60, // Force frame at least every 60s

            // OCR
            enable_ocr: true,
            ocr_language: "en-US".to_string(),

            // Storage (thumbnails + OCR only, ~10MB/day vs 400MB/day with video)
            storage_limit_gb: 5, // Much lower limit needed without video
            retention_days: 90,  // Keep data for 90 days

            // Privacy - common sensitive apps
            excluded_apps: vec![
                "com.apple.SecurityAgent".to_string(), // Password dialogs
                "com.apple.keychainaccess".to_string(),
                "1Password".to_string(),
                "com.agilebits.onepassword7".to_string(),
                "com.bitwarden.desktop".to_string(),
            ],
            excluded_titles: vec![
                "Password".to_string(),
                "Private".to_string(),
                "Incognito".to_string(),
            ],
            pause_when_locked: true,
        }
    }
}

impl RecorderConfig {
    /// Create config from CLI arguments
    pub fn from_args(args: &crate::Args) -> Self {
        let mut config = Self::default();

        // Paths
        config.frames_db_path = PathBuf::from(shellexpand::tilde(&args.database).to_string());
        config.watcher_db_path = PathBuf::from(shellexpand::tilde(&args.watcher_db).to_string());
        config.thumbnail_dir = PathBuf::from(shellexpand::tilde(&args.thumbnail_dir).to_string());

        // Capture
        config.capture_interval_ms = args.capture_interval;
        config.monitor_id = args.monitor_id;

        // Deduplication
        config.enable_dedup = !args.disable_dedup;
        config.dedup_threshold = args.dedup_threshold;
        config.max_frame_gap_secs = args.max_frame_gap;

        // OCR
        config.enable_ocr = !args.disable_ocr;
        config.ocr_language = args.ocr_language.clone();

        // Storage
        config.storage_limit_gb = args.storage_limit_gb;

        // Privacy
        if !args.excluded_apps.is_empty() {
            config.excluded_apps = args
                .excluded_apps
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| s.trim().to_string())
                .collect();
        }

        config
    }

    /// Get capture interval as Duration
    pub fn capture_interval(&self) -> Duration {
        Duration::from_millis(self.capture_interval_ms)
    }

    /// Check if an app should be excluded from recording
    pub fn is_app_excluded(&self, bundle_id: &str) -> bool {
        let bundle_lower = bundle_id.to_lowercase();
        self.excluded_apps
            .iter()
            .any(|excluded| bundle_lower.contains(&excluded.to_lowercase()))
    }

    /// Check if a window title should be excluded
    pub fn is_title_excluded(&self, title: &str) -> bool {
        let title_lower = title.to_lowercase();
        self.excluded_titles
            .iter()
            .any(|excluded| title_lower.contains(&excluded.to_lowercase()))
    }

    /// Ensure all required directories exist
    pub fn ensure_directories(&self) -> std::io::Result<()> {
        if let Some(parent) = self.frames_db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::create_dir_all(&self.thumbnail_dir)?;
        Ok(())
    }
}
