//! Ritual Watcher Tauri Commands
//!
//! Orchestrates the ritual-watcher sidecar process for computer activity tracking.
//! Uses the unified ritual-db (libSQL) database for all queries.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::ritual_database::{RITUAL_DB, get_db};

/// Global state for the watcher process
static WATCHER_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

/// Stored device ID from the most recent watcher start
static DEVICE_ID: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Get the current device_id (set when watcher starts)
fn get_device_id() -> Option<String> {
    DEVICE_ID.lock().ok().and_then(|g| g.clone())
}

/// Get device_id or try to read it from the config file
fn get_device_id_or_config() -> Option<String> {
    // First try the in-memory stored device_id
    if let Some(id) = get_device_id() {
        return Some(id);
    }
    
    // Fallback: read from config file
    let home = dirs::home_dir()?;
    let config_path = home.join(".ritual").join("watcher_config.json");
    if config_path.exists() {
        std::fs::read_to_string(&config_path).ok()
            .and_then(|s| serde_json::from_str::<WatcherConfig>(&s).ok())
            .map(|c| c.device_id)
    } else {
        None
    }
}

/// Watcher configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherConfig {
    pub device_id: String,
    pub user_id: String,
    pub poll_interval_ms: u64,
    pub title_mode: String,  // off, full, truncate, hash
    pub truncate_length: usize,
    pub excluded_bundle_ids: Vec<String>,
    // V2: New configuration options
    #[serde(default = "default_afk_timeout")]
    pub afk_timeout_seconds: u64,
    #[serde(default = "default_url_mode")]
    pub url_mode: String,  // off, domain, full
    #[serde(default)]
    pub track_incognito: bool,
}

fn default_afk_timeout() -> u64 { 900 } // 15 minutes - better for coding/reading
fn default_url_mode() -> String { "domain".to_string() }

/// Watcher status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherStatus {
    pub is_running: bool,
    pub pid: Option<u32>,
    pub device_id: Option<String>,
}

/// Detailed activity event from local database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetailedActivityEvent {
    pub id: i64,
    pub ts_start: i64,
    pub ts_end: i64,
    pub duration_ms: i64,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub browser_url: Option<String>,
    pub browser_domain: Option<String>,
    pub is_afk: bool,
    pub is_incognito: bool,
}

/// Convert a ritual-db ActivityEvent to our Tauri response type
impl From<ritual_db::ActivityEvent> for DetailedActivityEvent {
    fn from(e: ritual_db::ActivityEvent) -> Self {
        Self {
            id: e.id.unwrap_or(0),
            ts_start: e.ts_start,
            ts_end: e.ts_end,
            duration_ms: e.ts_end.saturating_sub(e.ts_start),
            app_bundle_id: e.app_bundle_id,
            app_name: e.app_name,
            window_title: e.window_title,
            browser_url: e.browser_url,
            browser_domain: e.browser_domain,
            is_afk: e.is_afk,
            is_incognito: e.is_incognito,
        }
    }
}

/// Summary of activity by app
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppActivitySummary {
    pub app_bundle_id: String,
    pub app_name: String,
    pub total_duration_ms: i64,
    pub event_count: i64,
}

/// Summary of activity by domain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainActivitySummary {
    pub domain: String,
    pub total_duration_ms: i64,
    pub event_count: i64,
}

/// Response for detailed activity query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetailedActivityResponse {
    pub events: Vec<DetailedActivityEvent>,
    pub apps: Vec<AppActivitySummary>,
    pub domains: Vec<DomainActivitySummary>,
    pub total_active_ms: i64,
    pub total_afk_ms: i64,
}

/// Check if accessibility permissions are granted (macOS only)
#[tauri::command]
pub fn check_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Request accessibility permissions (macOS only)
#[tauri::command]
pub fn request_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        use core_foundation::boolean::CFBoolean;
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::string::CFString;
        use core_foundation::base::TCFType;

        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
        }

        unsafe {
            let key = CFString::new("AXTrustedCheckOptionPrompt");
            let value = CFBoolean::true_value();
            
            let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
            
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const _)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Find the ritual-watcher executable
fn find_watcher_executable() -> Option<PathBuf> {
    // Try to get the executable's directory for relative paths
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));
    
    // Get home directory
    let home_dir = std::env::var("HOME").ok().map(PathBuf::from);
    
    // Build list of candidate paths
    let mut candidates: Vec<PathBuf> = vec![
        // Development paths (release)
        PathBuf::from("src-tauri/bin/ritual-watcher/target/release/ritual-watcher"),
        PathBuf::from("bin/ritual-watcher/target/release/ritual-watcher"),
        PathBuf::from("target/release/ritual-watcher"),
        // Development paths (debug)
        PathBuf::from("src-tauri/bin/ritual-watcher/target/debug/ritual-watcher"),
        PathBuf::from("bin/ritual-watcher/target/debug/ritual-watcher"),
        PathBuf::from("target/debug/ritual-watcher"),
        // Production paths (relative to app bundle on macOS)
        PathBuf::from("../Resources/ritual-watcher"),
        PathBuf::from("ritual-watcher"),
    ];
    
    // Add absolute paths based on project structure
    if let Some(home) = &home_dir {
        // Check in ~/.ritual/bin
        candidates.push(home.join(".ritual/bin/ritual-watcher"));
        
        // Common development path - directly in Desktop project
        candidates.push(home.join("Desktop/ritual-desktop-main/src-tauri/bin/ritual-watcher/target/release/ritual-watcher"));
        candidates.push(home.join("Desktop/ritual-desktop-main/src-tauri/bin/ritual-watcher/target/debug/ritual-watcher"));
    }
    
    // If we know the exe directory, add relative paths from there
    if let Some(exe) = &exe_dir {
        candidates.push(exe.join("ritual-watcher"));
        candidates.push(exe.join("../Resources/ritual-watcher"));
    }

    for path in &candidates {
        if path.exists() {
            println!("📍 Found watcher at: {:?}", path);
            return Some(path.clone());
        }
    }
    
    // Log what we tried
    println!("⚠️ Ritual Watcher not found. Tried:");
    for path in &candidates {
        println!("   - {:?}", path);
    }

    None
}

/// Start the ritual-watcher sidecar
#[tauri::command]
pub async fn start_watcher(config: WatcherConfig) -> Result<WatcherStatus, String> {
    println!("🚀 Starting Ritual Watcher...");
    println!("   Device ID: {}", config.device_id);
    println!("   Title Mode: {}", config.title_mode);

    // Store device_id for later query use
    if let Ok(mut guard) = DEVICE_ID.lock() {
        *guard = Some(config.device_id.clone());
    }

    // CRITICAL: Kill any existing watcher processes first to prevent duplicates
    // This handles orphaned processes from crashes or previous sessions
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("pkill")
            .args(["-f", "ritual-watcher"])
            .output();
        // Brief pause to ensure processes are terminated
        std::thread::sleep(std::time::Duration::from_millis(100));
        println!("🧹 Cleaned up any existing watcher processes");
    }
    
    // Clear our stored handle
    {
        let mut guard = WATCHER_PROCESS.lock().unwrap();
        *guard = None;
    }

    // Find executable
    let executable = find_watcher_executable().ok_or_else(|| {
        "Ritual Watcher executable not found. Please build it first.".to_string()
    })?;

    println!("📍 Using executable: {:?}", executable);

    // Build command arguments
    // Note: --database flag is kept for CLI compatibility but the watcher binary
    // uses the unified ritual.db via ritual-db regardless
    let mut args = vec![
        "--device-id".to_string(),
        config.device_id.clone(),
        "--user-id".to_string(),
        config.user_id.clone(),
        "--poll-interval".to_string(),
        config.poll_interval_ms.to_string(),
        "--title-mode".to_string(),
        config.title_mode.clone(),
        "--truncate-length".to_string(),
        config.truncate_length.to_string(),
        "--database".to_string(),
        "~/.ritual/ritual.db".to_string(),
        "--foreground".to_string(),
        // V2: New arguments
        "--afk-timeout".to_string(),
        config.afk_timeout_seconds.to_string(),
        "--url-mode".to_string(),
        config.url_mode.clone(),
    ];

    if !config.excluded_bundle_ids.is_empty() {
        args.push("--excluded".to_string());
        args.push(config.excluded_bundle_ids.join(","));
    }
    
    if config.track_incognito {
        args.push("--track-incognito".to_string());
        args.push("true".to_string());
    }

    println!("📋 Arguments: {:?}", args);

    // Spawn the watcher process
    let child = Command::new(&executable)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to start watcher: {}", e))?;

    let pid = child.id();
    println!("✅ Watcher started with PID: {}", pid);

    // Store the process handle
    {
        let mut guard = WATCHER_PROCESS.lock().unwrap();
        *guard = Some(child);
    }

    Ok(WatcherStatus {
        is_running: true,
        pid: Some(pid),
        device_id: Some(config.device_id),
    })
}

/// Start the ritual-watcher sidecar (synchronous version for auto-start)
pub fn start_watcher_sync(config: WatcherConfig) -> Result<WatcherStatus, String> {
    println!("🚀 Starting Ritual Watcher (sync)...");
    println!("   Device ID: {}", config.device_id);
    println!("   Title Mode: {}", config.title_mode);

    // Store device_id for later query use
    if let Ok(mut guard) = DEVICE_ID.lock() {
        *guard = Some(config.device_id.clone());
    }

    // CRITICAL: Kill any existing watcher processes first to prevent duplicates
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("pkill")
            .args(["-f", "ritual-watcher"])
            .output();
        std::thread::sleep(std::time::Duration::from_millis(100));
        println!("🧹 Cleaned up any existing watcher processes");
    }
    
    // Clear our stored handle
    {
        let mut guard = WATCHER_PROCESS.lock().unwrap();
        *guard = None;
    }

    // Find executable
    let executable = find_watcher_executable().ok_or_else(|| {
        "Ritual Watcher executable not found. Please build it first.".to_string()
    })?;

    println!("📍 Using executable: {:?}", executable);

    // Build command arguments
    let mut args = vec![
        "--device-id".to_string(),
        config.device_id.clone(),
        "--user-id".to_string(),
        config.user_id.clone(),
        "--poll-interval".to_string(),
        config.poll_interval_ms.to_string(),
        "--title-mode".to_string(),
        config.title_mode.clone(),
        "--truncate-length".to_string(),
        config.truncate_length.to_string(),
        "--database".to_string(),
        "~/.ritual/ritual.db".to_string(),
        "--foreground".to_string(),
        "--afk-timeout".to_string(),
        config.afk_timeout_seconds.to_string(),
        "--url-mode".to_string(),
        config.url_mode.clone(),
    ];

    if !config.excluded_bundle_ids.is_empty() {
        args.push("--excluded".to_string());
        args.push(config.excluded_bundle_ids.join(","));
    }
    
    if config.track_incognito {
        args.push("--track-incognito".to_string());
        args.push("true".to_string());
    }

    println!("📋 Arguments: {:?}", args);

    // Spawn the watcher process
    let child = Command::new(&executable)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to start watcher: {}", e))?;

    let pid = child.id();
    println!("✅ Watcher started with PID: {}", pid);

    // Store the process handle
    {
        let mut guard = WATCHER_PROCESS.lock().unwrap();
        *guard = Some(child);
    }

    Ok(WatcherStatus {
        is_running: true,
        pid: Some(pid),
        device_id: Some(config.device_id),
    })
}

/// Stop the ritual-watcher sidecar
#[tauri::command]
pub async fn stop_watcher() -> Result<WatcherStatus, String> {
    println!("🛑 Stopping Ritual Watcher...");

    let mut guard = WATCHER_PROCESS.lock().unwrap();
    
    if let Some(mut child) = guard.take() {
        // Try to kill the process gracefully
        match child.kill() {
            Ok(_) => {
                println!("✅ Watcher stopped");
                // Wait for the process to actually terminate
                let _ = child.wait();
            }
            Err(e) => {
                println!("⚠️ Failed to kill watcher: {}", e);
            }
        }
    } else {
        println!("ℹ️ No watcher process to stop");
    }

    Ok(WatcherStatus {
        is_running: false,
        pid: None,
        device_id: None,
    })
}

/// Get the current status of the watcher
#[tauri::command]
pub async fn get_watcher_status() -> WatcherStatus {
    let guard = WATCHER_PROCESS.lock().unwrap();
    
    if let Some(ref child) = *guard {
        WatcherStatus {
            is_running: true,  // We assume it's running if we have a handle
            pid: Some(child.id()),
            device_id: get_device_id(),
        }
    } else {
        WatcherStatus {
            is_running: false,
            pid: None,
            device_id: None,
        }
    }
}

/// Open System Preferences to Accessibility settings
#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map_err(|e| format!("Failed to open settings: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Not supported on this platform".to_string())
    }
}

/// Query detailed activity from the unified ritual.db (libSQL)
/// Returns events, app/domain summaries, and active/afk totals
#[tauri::command]
pub async fn get_detailed_activity(
    start_ts: i64,
    end_ts: i64,
    limit: Option<i64>,
) -> Result<DetailedActivityResponse, String> {
    let device_id = get_device_id_or_config().unwrap_or_default();
    
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    // Get events in range
    let all_events = db.get_events_in_range(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to query events: {}", e))?;
    
    // Apply limit (events are already sorted by ts_start ASC, reverse for DESC)
    let limit_val = limit.unwrap_or(500) as usize;
    let events: Vec<DetailedActivityEvent> = all_events.into_iter()
        .rev() // DESC order like the original query
        .take(limit_val)
        .map(DetailedActivityEvent::from)
        .collect();
    
    // Get app summaries
    let app_summaries = db.get_app_summary(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to query app summaries: {}", e))?;
    
    let apps: Vec<AppActivitySummary> = app_summaries.into_iter()
        .map(|s| AppActivitySummary {
            app_bundle_id: s.bundle_id,
            app_name: s.app_name,
            total_duration_ms: s.total_ms,
            event_count: s.event_count,
        })
        .collect();
    
    // Get domain summaries
    let domain_summaries = db.get_domain_summary(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to query domain summaries: {}", e))?;
    
    let domains: Vec<DomainActivitySummary> = domain_summaries.into_iter()
        .map(|s| DomainActivitySummary {
            domain: s.domain,
            total_duration_ms: s.total_ms,
            event_count: s.event_count,
        })
        .collect();
    
    // Get daily summary for active/afk totals
    let summary = db.get_daily_summary(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to query daily summary: {}", e))?;
    
    Ok(DetailedActivityResponse {
        events,
        apps,
        domains,
        total_active_ms: summary.active_ms,
        total_afk_ms: summary.afk_ms,
    })
}

/// Get activity events grouped by time for timeline view
#[tauri::command]
pub async fn get_activity_timeline(
    start_ts: i64,
    end_ts: i64,
) -> Result<Vec<DetailedActivityEvent>, String> {
    let device_id = get_device_id_or_config().unwrap_or_default();
    
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    let events = db.get_events_in_range(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to query timeline: {}", e))?;
    
    Ok(events.into_iter().map(DetailedActivityEvent::from).collect())
}

/// Sync queue item for backend sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncQueueItem {
    pub id: i64,
    pub entry_type: String,
    pub event_id: i64,
    pub ts_end: Option<i64>,
    pub retry_count: i64,
}

/// Get pending sync items count
#[tauri::command]
pub async fn get_sync_queue_count() -> Result<i64, String> {
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    db.pending_sync_count()
        .await
        .map_err(|e| format!("Failed to get sync count: {}", e))
}

/// Get pending sync items for processing
#[tauri::command]
pub async fn get_pending_sync_items(limit: i64) -> Result<Vec<SyncQueueItem>, String> {
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    let items = db.get_pending_sync(limit)
        .await
        .map_err(|e| format!("Failed to query sync queue: {}", e))?;
    
    Ok(items.into_iter().map(|item| SyncQueueItem {
        id: item.id,
        entry_type: item.entry_type,
        event_id: item.event_id,
        ts_end: item.ts_end,
        retry_count: item.retry_count,
    }).collect())
}

/// Mark a sync item as completed
#[tauri::command]
pub async fn mark_sync_item_complete(queue_id: i64) -> Result<(), String> {
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    db.mark_synced(queue_id)
        .await
        .map_err(|e| format!("Failed to mark item complete: {}", e))
}

/// Mark a sync item as failed (will retry)
#[tauri::command]
pub async fn mark_sync_item_failed(queue_id: i64) -> Result<(), String> {
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    db.mark_sync_failed(queue_id)
        .await
        .map_err(|e| format!("Failed to mark item failed: {}", e))
}

/// Get full event data for syncing
#[tauri::command]
pub async fn get_event_for_sync(event_id: i64) -> Result<Option<DetailedActivityEvent>, String> {
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    let event = db.get_activity_event(event_id)
        .await
        .map_err(|e| format!("Failed to get event: {}", e))?;
    
    Ok(event.map(DetailedActivityEvent::from))
}

/// Daily summary for efficient syncing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySummary {
    pub date: String,
    pub total_active_ms: i64,
    pub total_afk_ms: i64,
    pub total_hours: f64,
    pub app_count: i64,
    pub domain_count: i64,
    pub event_count: i64,
}

/// Get daily summary for a specific date (YYYY-MM-DD)
#[tauri::command]
pub async fn get_daily_summary(date: String) -> Result<DailySummary, String> {
    let device_id = get_device_id_or_config().unwrap_or_default();
    
    // Parse date and calculate timestamps
    let date_parts: Vec<&str> = date.split('-').collect();
    if date_parts.len() != 3 {
        return Err("Invalid date format. Use YYYY-MM-DD".to_string());
    }

    let year: i32 = date_parts[0].parse().map_err(|_| "Invalid year")?;
    let month: u32 = date_parts[1].parse().map_err(|_| "Invalid month")?;
    let day: u32 = date_parts[2].parse().map_err(|_| "Invalid day")?;

    use chrono::{TimeZone, Local};
    let start_of_day = Local.with_ymd_and_hms(year, month, day, 0, 0, 0)
        .single()
        .ok_or("Invalid date")?;
    let end_of_day = Local.with_ymd_and_hms(year, month, day, 23, 59, 59)
        .single()
        .ok_or("Invalid date")?;

    let start_ts = start_of_day.timestamp_millis();
    let end_ts = end_of_day.timestamp_millis();

    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    let summary = db.get_daily_summary(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to get summary: {}", e))?;
    
    Ok(DailySummary {
        date,
        total_active_ms: summary.active_ms,
        total_afk_ms: summary.afk_ms,
        total_hours: summary.active_ms as f64 / (1000.0 * 60.0 * 60.0),
        app_count: summary.app_count,
        domain_count: summary.domain_count,
        event_count: summary.event_count,
    })
}

// ============================================================
// DATABASE MAINTENANCE & DIAGNOSTICS COMMANDS
// ============================================================

/// Database statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbStats {
    pub event_count: i64,
    pub afk_count: i64,
    pub oldest_event_date: Option<String>,
    pub newest_event_date: Option<String>,
    pub db_size_mb: f64,
    pub days_of_data: i64,
}

/// Get database statistics and diagnostics
#[tauri::command]
pub async fn get_watcher_db_stats() -> Result<DbStats, String> {
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    let stats = db.get_stats()
        .await
        .map_err(|e| format!("Failed to get stats: {}", e))?;
    
    // Get date range from the device_id's events
    let device_id = get_device_id_or_config().unwrap_or_default();
    let db_stats = db.get_db_stats(&device_id)
        .await
        .unwrap_or_else(|_| ritual_db::blocking::DbStats {
            event_count: stats.activity_event_count,
            afk_count: 0,
            oldest_event_ts: None,
            newest_event_ts: None,
            db_size_bytes: stats.db_size_bytes,
        });
    
    let oldest_event_date = db_stats.oldest_event_ts.map(|ts| {
        chrono::DateTime::from_timestamp_millis(ts)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "Unknown".to_string())
    });
    
    let newest_event_date = db_stats.newest_event_ts.map(|ts| {
        chrono::DateTime::from_timestamp_millis(ts)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "Unknown".to_string())
    });
    
    let days_of_data = match (db_stats.oldest_event_ts, db_stats.newest_event_ts) {
        (Some(oldest), Some(newest)) => {
            ((newest - oldest) / (24 * 60 * 60 * 1000)).max(1)
        }
        _ => 0,
    };
    
    Ok(DbStats {
        event_count: db_stats.event_count,
        afk_count: db_stats.afk_count,
        oldest_event_date,
        newest_event_date,
        db_size_mb: db_stats.db_size_bytes as f64 / (1024.0 * 1024.0),
        days_of_data,
    })
}

/// Delete events older than the specified number of days
/// Returns the number of deleted events
#[tauri::command]
pub async fn cleanup_old_events(days: i64) -> Result<i64, String> {
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    db.delete_old_events(days)
        .await
        .map_err(|e| format!("Failed to delete events: {}", e))
}

/// Export events for a date range
#[tauri::command]
pub async fn export_events(start_date: String, end_date: String) -> Result<Vec<DetailedActivityEvent>, String> {
    let device_id = get_device_id_or_config().unwrap_or_default();
    
    // Parse dates
    use chrono::{NaiveDate, TimeZone, Local};
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|_| "Invalid start date format (use YYYY-MM-DD)")?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|_| "Invalid end date format (use YYYY-MM-DD)")?;
    
    let start_ts = Local.from_local_datetime(&start.and_hms_opt(0, 0, 0).unwrap())
        .single()
        .ok_or("Invalid start date")?
        .timestamp_millis();
    let end_ts = Local.from_local_datetime(&end.and_hms_opt(23, 59, 59).unwrap())
        .single()
        .ok_or("Invalid end date")?
        .timestamp_millis();
    
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    let events = db.get_events_in_range(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to export events: {}", e))?;
    
    Ok(events.into_iter().map(DetailedActivityEvent::from).collect())
}

// ============================================================
// FOCUS METRICS COMMANDS
// ============================================================

/// Focus and productivity metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusMetrics {
    pub context_switches: i64,
    pub longest_focus_session_minutes: f64,
    pub focus_sessions_30min_plus: i64,
    pub fragmented_time_minutes: f64,
    pub deep_work_minutes: f64,
    pub average_session_minutes: f64,
}

/// Get focus metrics for a specific day
#[tauri::command]
pub async fn get_focus_metrics(date: String) -> Result<FocusMetrics, String> {
    let device_id = get_device_id_or_config().unwrap_or_default();
    
    // Parse date
    let date_parts: Vec<&str> = date.split('-').collect();
    if date_parts.len() != 3 {
        return Err("Invalid date format. Use YYYY-MM-DD".to_string());
    }
    let year: i32 = date_parts[0].parse().map_err(|_| "Invalid year")?;
    let month: u32 = date_parts[1].parse().map_err(|_| "Invalid month")?;
    let day: u32 = date_parts[2].parse().map_err(|_| "Invalid day")?;
    
    use chrono::{TimeZone, Local};
    let start_ts = Local.with_ymd_and_hms(year, month, day, 0, 0, 0)
        .single()
        .ok_or("Invalid date")?
        .timestamp_millis();
    let end_ts = Local.with_ymd_and_hms(year, month, day, 23, 59, 59)
        .single()
        .ok_or("Invalid date")?
        .timestamp_millis();
    
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();
    
    let metrics = db.get_focus_metrics(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to get focus metrics: {}", e))?;
    
    // Compute average session from events
    let events = db.get_events_in_range(&device_id, start_ts, end_ts)
        .await
        .unwrap_or_default();
    
    let active_events: Vec<_> = events.iter().filter(|e| !e.is_afk).collect();
    let total_duration_ms: i64 = active_events.iter()
        .map(|e| e.ts_end.saturating_sub(e.ts_start))
        .sum();
    let event_count = active_events.len() as i64;
    let average_session_ms = if event_count > 0 { total_duration_ms / event_count } else { 0 };
    
    Ok(FocusMetrics {
        context_switches: metrics.context_switches,
        longest_focus_session_minutes: metrics.longest_focus_session_ms as f64 / 60000.0,
        focus_sessions_30min_plus: metrics.focus_sessions_30min_plus,
        fragmented_time_minutes: metrics.fragmented_time_ms as f64 / 60000.0,
        deep_work_minutes: metrics.deep_work_time_ms as f64 / 60000.0,
        average_session_minutes: average_session_ms as f64 / 60000.0,
    })
}

// ============================================================
// REAL-TIME STATUS COMMANDS
// ============================================================

/// Extended watcher status with more detail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherExtendedStatus {
    pub is_running: bool,
    pub pid: Option<u32>,
    pub device_id: Option<String>,
    pub last_heartbeat_ts: Option<i64>,
    pub is_paused: bool,
    pub seconds_since_heartbeat: Option<i64>,
    pub current_app: Option<String>,
    pub session_duration_seconds: Option<i64>,
}

/// Get extended watcher status including real-time info
#[tauri::command]
pub async fn get_watcher_extended_status() -> Result<WatcherExtendedStatus, String> {
    let (is_running, pid) = {
        let mut process_guard = WATCHER_PROCESS.lock().map_err(|e| e.to_string())?;
        
        let running = process_guard.as_mut()
            .map(|child| child.try_wait().map(|s| s.is_none()).unwrap_or(false))
            .unwrap_or(false);
        
        let p = if running {
            process_guard.as_ref().map(|c| c.id())
        } else {
            None
        };
        (running, p)
    }; // Drop the MutexGuard before any .await
    
    let device_id = get_device_id_or_config();
    
    // Query real-time info from the unified database
    let (last_heartbeat_ts, current_app, session_duration_seconds) = if let Some(ref dev_id) = device_id {
        let guard = RITUAL_DB.read().await;
        if let Some(ref db) = *guard {
            // Get last heartbeat
            let heartbeat = db.get_last_heartbeat(dev_id)
                .await
                .unwrap_or(None);
            
            // Get most recent event
            let recent_events = db.get_recent_events(dev_id, 1)
                .await
                .unwrap_or_default();
            
            let (app, session_dur) = if let Some(event) = recent_events.first() {
                let now_ms = chrono::Utc::now().timestamp_millis();
                // If event is recent (within 10 seconds), it's the current session
                if now_ms - event.ts_end < 10_000 {
                    (
                        Some(event.app_name.clone()),
                        Some((event.ts_end - event.ts_start) / 1000),
                    )
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            };
            
            (heartbeat, app, session_dur)
        } else {
            (None, None, None)
        }
    } else {
        (None, None, None)
    };
    
    let now_ms = chrono::Utc::now().timestamp_millis();
    let seconds_since_heartbeat = last_heartbeat_ts.map(|ts| (now_ms - ts) / 1000);
    
    Ok(WatcherExtendedStatus {
        is_running,
        pid,
        device_id,
        last_heartbeat_ts,
        is_paused: false,
        seconds_since_heartbeat,
        current_app,
        session_duration_seconds,
    })
}

/// Check watcher health and auto-restart if hung
/// Returns true if watcher was restarted, false if it was healthy
#[tauri::command]
pub async fn check_and_restart_watcher_if_hung(max_stale_seconds: i64) -> Result<bool, String> {
    let status = get_watcher_extended_status().await?;
    
    // Check if watcher is supposedly running but heartbeat is stale
    if status.is_running {
        if let Some(seconds_stale) = status.seconds_since_heartbeat {
            if seconds_stale > max_stale_seconds {
                println!("⚠️ Watcher hung detected! Heartbeat stale for {} seconds (threshold: {})", 
                         seconds_stale, max_stale_seconds);
                
                // Stop the hung watcher
                if let Err(e) = stop_watcher().await {
                    println!("   Failed to stop hung watcher: {}", e);
                }
                
                // Small delay to ensure process is terminated
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                
                // Read existing config
                let home = dirs::home_dir().ok_or("Could not find home directory")?;
                let config_path = home.join(".ritual").join("watcher_config.json");
                
                if config_path.exists() {
                    let config_str = std::fs::read_to_string(&config_path)
                        .map_err(|e| format!("Failed to read config: {}", e))?;
                    let config: WatcherConfig = serde_json::from_str(&config_str)
                        .map_err(|e| format!("Failed to parse config: {}", e))?;
                    
                    // Restart watcher
                    match start_watcher_sync(config) {
                        Ok(_) => {
                            println!("✅ Watcher auto-restarted after hang detection");
                            return Ok(true);
                        }
                        Err(e) => {
                            return Err(format!("Failed to restart watcher: {}", e));
                        }
                    }
                } else {
                    return Err("No watcher config found for restart".to_string());
                }
            }
        }
    }
    
    Ok(false)
}

// ============================================================
// APP ICON COMMANDS
// ============================================================

/// Response for app icon request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppIconResponse {
    pub bundle_id: String,
    pub icon_path: Option<String>,
    pub icon_base64: Option<String>,
}

/// Get app icon for a bundle ID
/// Extracts the icon from the app bundle and caches it
#[tauri::command]
pub fn get_app_icon(bundle_id: String) -> Result<AppIconResponse, String> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let cache_dir = home.join(".ritual").join("icons");
        
        // Ensure cache directory exists
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create icon cache: {}", e))?;
        
        // Create safe filename from bundle ID
        let safe_name = bundle_id.replace('.', "_").replace('/', "_");
        let cache_path = cache_dir.join(format!("{}.png", safe_name));
        
        // Check if already cached
        if cache_path.exists() {
            use base64::Engine;
            let icon_data = std::fs::read(&cache_path)
                .map_err(|e| format!("Failed to read cached icon: {}", e))?;
            let base64_data = base64::engine::general_purpose::STANDARD.encode(&icon_data);
            
            return Ok(AppIconResponse {
                bundle_id,
                icon_path: Some(cache_path.to_string_lossy().to_string()),
                icon_base64: Some(base64_data),
            });
        }
        
        // Extract icon using macOS tools
        if let Some(icon_path) = extract_app_icon_macos(&bundle_id, &cache_path) {
            use base64::Engine;
            let icon_data = std::fs::read(&icon_path)
                .map_err(|e| format!("Failed to read icon: {}", e))?;
            let base64_data = base64::engine::general_purpose::STANDARD.encode(&icon_data);
            
            return Ok(AppIconResponse {
                bundle_id,
                icon_path: Some(icon_path),
                icon_base64: Some(base64_data),
            });
        }
        
        Ok(AppIconResponse {
            bundle_id,
            icon_path: None,
            icon_base64: None,
        })
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Ok(AppIconResponse {
            bundle_id,
            icon_path: None,
            icon_base64: None,
        })
    }
}

/// Get icons for multiple bundle IDs at once (batch operation)
#[tauri::command]
pub fn get_app_icons_batch(bundle_ids: Vec<String>) -> Result<Vec<AppIconResponse>, String> {
    let mut results = Vec::new();
    
    for bundle_id in bundle_ids {
        match get_app_icon(bundle_id.clone()) {
            Ok(response) => results.push(response),
            Err(_) => results.push(AppIconResponse {
                bundle_id,
                icon_path: None,
                icon_base64: None,
            }),
        }
    }
    
    Ok(results)
}

/// Extract app icon on macOS using system tools
#[cfg(target_os = "macos")]
fn extract_app_icon_macos(bundle_id: &str, output_path: &std::path::PathBuf) -> Option<String> {
    use std::process::Command;
    
    // Step 1: Find the app path from bundle ID using mdfind
    let app_path = {
        let output = Command::new("mdfind")
            .args([&format!("kMDItemCFBundleIdentifier == '{}'", bundle_id)])
            .output()
            .ok()?;
        
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.lines()
                .find(|line| line.ends_with(".app"))
                .map(|s| s.to_string())
        } else {
            None
        }
    };
    
    let app_path = app_path.or_else(|| {
        // Fallback: check common locations
        let app_name = bundle_id.split('.').last()?;
        let locations = [
            "/Applications",
            "/System/Applications",
            "/System/Applications/Utilities",
        ];
        
        for loc in locations {
            let path = format!("{}/{}.app", loc, app_name);
            if std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
        None
    })?;
    
    // Step 2: Find the .icns file in the app bundle
    let icns_path = find_icns_file(&app_path)?;
    
    // Step 3: Convert .icns to .png using sips
    let output = Command::new("sips")
        .args([
            "-s", "format", "png",
            "-z", "64", "64",
            &icns_path,
            "--out", output_path.to_str()?,
        ])
        .output()
        .ok()?;
    
    if output.status.success() {
        Some(output_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Find the .icns file inside an app bundle
#[cfg(target_os = "macos")]
fn find_icns_file(app_path: &str) -> Option<String> {
    use std::process::Command;
    
    let info_plist = format!("{}/Contents/Info.plist", app_path);
    let resources_path = format!("{}/Contents/Resources", app_path);
    
    // Try to get icon name from Info.plist
    let icon_name = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIconFile", &info_plist])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Some(if name.ends_with(".icns") { name } else { format!("{}.icns", name) })
            } else {
                None
            }
        })
        .unwrap_or_else(|| "AppIcon.icns".to_string());
    
    let icon_path = format!("{}/{}", resources_path, icon_name);
    
    if std::path::Path::new(&icon_path).exists() {
        return Some(icon_path);
    }
    
    // Fallback: find any .icns file
    std::fs::read_dir(&resources_path).ok()?
        .filter_map(|e| e.ok())
        .find(|e| e.path().extension().map(|ext| ext == "icns").unwrap_or(false))
        .and_then(|e| e.path().to_str().map(|s| s.to_string()))
}
