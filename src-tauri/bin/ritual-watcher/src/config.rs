//! Configuration types for Ritual Watcher

/// Title privacy mode
#[derive(Debug, Clone)]
pub enum TitleMode {
    /// Don't track window titles at all
    Off,
    /// Store full window title
    Full,
    /// Store truncated window title
    Truncate,
    /// Store SHA256 hash of window title
    Hash,
}

/// URL privacy mode for browser tracking
#[derive(Debug, Clone)]
pub enum UrlMode {
    /// Don't track browser URLs
    Off,
    /// Track only the domain (e.g., "github.com")
    DomainOnly,
    /// Track full URLs (privacy concern)
    Full,
}

impl Default for UrlMode {
    fn default() -> Self {
        UrlMode::DomainOnly
    }
}

/// Watcher configuration
#[derive(Debug, Clone)]
pub struct WatcherConfig {
    /// Path to SQLite database
    pub database_path: String,
    /// Unique device identifier
    pub device_id: String,
    /// User ID
    pub user_id: String,
    /// Polling interval in milliseconds
    pub poll_interval_ms: u64,
    /// Title privacy mode
    pub title_mode: TitleMode,
    /// Truncation length for TitleMode::Truncate
    pub truncate_length: usize,
    /// Bundle IDs to exclude from tracking
    pub excluded_bundle_ids: Vec<String>,
    /// AFK timeout in seconds (default: 900 = 15 minutes)
    pub afk_timeout_seconds: f64,
    /// URL privacy mode for browser tracking
    pub url_mode: UrlMode,
    /// Whether to track incognito/private browsing
    pub track_incognito: bool,
    /// Pulsetime for event merging in seconds (default: poll_interval + 1)
    pub pulsetime_seconds: f64,
}

impl Default for WatcherConfig {
    fn default() -> Self {
        Self {
            database_path: "~/.ritual/watcher.db".to_string(),
            device_id: String::new(),
            user_id: String::new(),
            poll_interval_ms: 2000,
            title_mode: TitleMode::Off,
            truncate_length: 80,
            excluded_bundle_ids: Vec::new(),
            afk_timeout_seconds: 900.0, // 15 minutes - better for coding/reading
            url_mode: UrlMode::DomainOnly,
            track_incognito: false, // Privacy-preserving default
            pulsetime_seconds: 3.0, // poll_interval + 1 second buffer
        }
    }
}
