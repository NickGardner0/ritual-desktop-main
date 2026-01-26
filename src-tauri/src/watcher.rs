//! Ritual Watcher Tauri Commands
//!
//! Orchestrates the ritual-watcher sidecar process for computer activity tracking.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use once_cell::sync::Lazy;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// Global state for the watcher process
static WATCHER_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

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

/// Get the database path
fn get_database_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/watcher.db")
    } else {
        PathBuf::from("./watcher.db")
    }
}

/// Start the ritual-watcher sidecar
#[tauri::command]
pub async fn start_watcher(config: WatcherConfig) -> Result<WatcherStatus, String> {
    println!("🚀 Starting Ritual Watcher...");
    println!("   Device ID: {}", config.device_id);
    println!("   Title Mode: {}", config.title_mode);

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

    // Get database path
    let db_path = get_database_path();
    
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

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
        db_path.to_string_lossy().to_string(),
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

    // Get database path
    let db_path = get_database_path();
    
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

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
        db_path.to_string_lossy().to_string(),
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
            device_id: None,  // We don't track this currently
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

/// Query detailed activity from local SQLite database
/// This returns full URLs and window titles that are stored locally
#[tauri::command]
pub async fn get_detailed_activity(
    start_ts: i64,
    end_ts: i64,
    limit: Option<i64>,
) -> Result<DetailedActivityResponse, String> {
    let db_path = get_database_path();
    
    if !db_path.exists() {
        return Ok(DetailedActivityResponse {
            events: vec![],
            apps: vec![],
            domains: vec![],
            total_active_ms: 0,
            total_afk_ms: 0,
        });
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let limit_val = limit.unwrap_or(500);

    // Query detailed events
    let mut stmt = conn.prepare(
        r#"
        SELECT 
            id, ts_start, ts_end, 
            (ts_end - ts_start) as duration_ms,
            app_bundle_id, app_name, 
            window_title, browser_url, browser_domain,
            COALESCE(is_afk, 0) as is_afk,
            COALESCE(is_incognito, 0) as is_incognito
        FROM activity_events
        WHERE ts_start >= ?1 AND ts_start <= ?2
        ORDER BY ts_start DESC
        LIMIT ?3
        "#
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;

    let events: Vec<DetailedActivityEvent> = stmt
        .query_map([start_ts, end_ts, limit_val], |row| {
            Ok(DetailedActivityEvent {
                id: row.get(0)?,
                ts_start: row.get(1)?,
                ts_end: row.get(2)?,
                duration_ms: row.get(3)?,
                app_bundle_id: row.get(4)?,
                app_name: row.get(5)?,
                window_title: row.get(6)?,
                browser_url: row.get(7)?,
                browser_domain: row.get(8)?,
                is_afk: row.get::<_, i32>(9)? != 0,
                is_incognito: row.get::<_, i32>(10)? != 0,
            })
        })
        .map_err(|e| format!("Failed to query events: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Query app summaries
    let mut app_stmt = conn.prepare(
        r#"
        SELECT 
            app_bundle_id, app_name,
            SUM(ts_end - ts_start) as total_duration_ms,
            COUNT(*) as event_count
        FROM activity_events
        WHERE ts_start >= ?1 AND ts_start <= ?2 AND COALESCE(is_afk, 0) = 0
        GROUP BY app_bundle_id, app_name
        ORDER BY total_duration_ms DESC
        LIMIT 20
        "#
    ).map_err(|e| format!("Failed to prepare app query: {}", e))?;

    let apps: Vec<AppActivitySummary> = app_stmt
        .query_map([start_ts, end_ts], |row| {
            Ok(AppActivitySummary {
                app_bundle_id: row.get(0)?,
                app_name: row.get(1)?,
                total_duration_ms: row.get(2)?,
                event_count: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query apps: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Query domain summaries
    let mut domain_stmt = conn.prepare(
        r#"
        SELECT 
            browser_domain,
            SUM(ts_end - ts_start) as total_duration_ms,
            COUNT(*) as event_count
        FROM activity_events
        WHERE ts_start >= ?1 AND ts_start <= ?2 
            AND browser_domain IS NOT NULL 
            AND browser_domain != ''
            AND COALESCE(is_afk, 0) = 0
        GROUP BY browser_domain
        ORDER BY total_duration_ms DESC
        LIMIT 20
        "#
    ).map_err(|e| format!("Failed to prepare domain query: {}", e))?;

    let domains: Vec<DomainActivitySummary> = domain_stmt
        .query_map([start_ts, end_ts], |row| {
            Ok(DomainActivitySummary {
                domain: row.get(0)?,
                total_duration_ms: row.get(1)?,
                event_count: row.get(2)?,
            })
        })
        .map_err(|e| format!("Failed to query domains: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Calculate totals
    let mut total_stmt = conn.prepare(
        r#"
        SELECT 
            COALESCE(SUM(CASE WHEN COALESCE(is_afk, 0) = 0 THEN ts_end - ts_start ELSE 0 END), 0) as active_ms,
            COALESCE(SUM(CASE WHEN COALESCE(is_afk, 0) = 1 THEN ts_end - ts_start ELSE 0 END), 0) as afk_ms
        FROM activity_events
        WHERE ts_start >= ?1 AND ts_start <= ?2
        "#
    ).map_err(|e| format!("Failed to prepare totals query: {}", e))?;

    let (total_active_ms, total_afk_ms): (i64, i64) = total_stmt
        .query_row([start_ts, end_ts], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap_or((0, 0));

    Ok(DetailedActivityResponse {
        events,
        apps,
        domains,
        total_active_ms,
        total_afk_ms,
    })
}

/// Get activity events grouped by time for timeline view
#[tauri::command]
pub async fn get_activity_timeline(
    start_ts: i64,
    end_ts: i64,
) -> Result<Vec<DetailedActivityEvent>, String> {
    let db_path = get_database_path();
    
    if !db_path.exists() {
        return Ok(vec![]);
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let mut stmt = conn.prepare(
        r#"
        SELECT 
            id, ts_start, ts_end, 
            (ts_end - ts_start) as duration_ms,
            app_bundle_id, app_name, 
            window_title, browser_url, browser_domain,
            COALESCE(is_afk, 0) as is_afk,
            COALESCE(is_incognito, 0) as is_incognito
        FROM activity_events
        WHERE ts_start >= ?1 AND ts_start <= ?2
        ORDER BY ts_start ASC
        "#
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;

    let events: Vec<DetailedActivityEvent> = stmt
        .query_map([start_ts, end_ts], |row| {
            Ok(DetailedActivityEvent {
                id: row.get(0)?,
                ts_start: row.get(1)?,
                ts_end: row.get(2)?,
                duration_ms: row.get(3)?,
                app_bundle_id: row.get(4)?,
                app_name: row.get(5)?,
                window_title: row.get(6)?,
                browser_url: row.get(7)?,
                browser_domain: row.get(8)?,
                is_afk: row.get::<_, i32>(9)? != 0,
                is_incognito: row.get::<_, i32>(10)? != 0,
            })
        })
        .map_err(|e| format!("Failed to query events: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(events)
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

/// Get sync queue path
fn get_sync_queue_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".ritual").join("sync_queue.db")
}

/// Get pending sync items count
#[tauri::command]
pub async fn get_sync_queue_count() -> Result<i64, String> {
    let queue_path = get_sync_queue_path();
    
    if !queue_path.exists() {
        return Ok(0);
    }

    let conn = Connection::open(&queue_path)
        .map_err(|e| format!("Failed to open sync queue: {}", e))?;

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(count)
}

/// Get pending sync items for processing
#[tauri::command]
pub async fn get_pending_sync_items(limit: i64) -> Result<Vec<SyncQueueItem>, String> {
    let queue_path = get_sync_queue_path();
    
    if !queue_path.exists() {
        return Ok(vec![]);
    }

    let conn = Connection::open(&queue_path)
        .map_err(|e| format!("Failed to open sync queue: {}", e))?;

    let mut stmt = conn.prepare(
        r#"
        SELECT id, entry_type, event_id, ts_end, retry_count
        FROM sync_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ?1
        "#
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;

    let items: Vec<SyncQueueItem> = stmt
        .query_map([limit], |row| {
            Ok(SyncQueueItem {
                id: row.get(0)?,
                entry_type: row.get(1)?,
                event_id: row.get(2)?,
                ts_end: row.get(3)?,
                retry_count: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query sync queue: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(items)
}

/// Mark a sync item as completed
#[tauri::command]
pub async fn mark_sync_item_complete(queue_id: i64) -> Result<(), String> {
    let queue_path = get_sync_queue_path();
    
    if !queue_path.exists() {
        return Err("Sync queue not found".to_string());
    }

    let conn = Connection::open(&queue_path)
        .map_err(|e| format!("Failed to open sync queue: {}", e))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    conn.execute(
        "UPDATE sync_queue SET status = 'synced', updated_at = ?1 WHERE id = ?2",
        [now, queue_id],
    ).map_err(|e| format!("Failed to mark item complete: {}", e))?;

    Ok(())
}

/// Mark a sync item as failed (will retry)
#[tauri::command]
pub async fn mark_sync_item_failed(queue_id: i64) -> Result<(), String> {
    let queue_path = get_sync_queue_path();
    
    if !queue_path.exists() {
        return Err("Sync queue not found".to_string());
    }

    let conn = Connection::open(&queue_path)
        .map_err(|e| format!("Failed to open sync queue: {}", e))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    conn.execute(
        "UPDATE sync_queue SET status = 'failed', retry_count = retry_count + 1, updated_at = ?1 WHERE id = ?2",
        [now, queue_id],
    ).map_err(|e| format!("Failed to mark item failed: {}", e))?;

    Ok(())
}

/// Get full event data for syncing
#[tauri::command]
pub async fn get_event_for_sync(event_id: i64) -> Result<Option<DetailedActivityEvent>, String> {
    let db_path = get_database_path();
    
    if !db_path.exists() {
        return Ok(None);
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let result = conn.query_row(
        r#"
        SELECT 
            id, ts_start, ts_end, 
            (ts_end - ts_start) as duration_ms,
            app_bundle_id, app_name, 
            window_title, browser_url, browser_domain,
            COALESCE(is_afk, 0) as is_afk,
            COALESCE(is_incognito, 0) as is_incognito
        FROM activity_events
        WHERE id = ?1
        "#,
        [event_id],
        |row| {
            Ok(DetailedActivityEvent {
                id: row.get(0)?,
                ts_start: row.get(1)?,
                ts_end: row.get(2)?,
                duration_ms: row.get(3)?,
                app_bundle_id: row.get(4)?,
                app_name: row.get(5)?,
                window_title: row.get(6)?,
                browser_url: row.get(7)?,
                browser_domain: row.get(8)?,
                is_afk: row.get::<_, i32>(9)? != 0,
                is_incognito: row.get::<_, i32>(10)? != 0,
            })
        },
    );

    match result {
        Ok(event) => Ok(Some(event)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to get event: {}", e)),
    }
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
    let db_path = get_database_path();
    
    if !db_path.exists() {
        return Ok(DailySummary {
            date: date.clone(),
            total_active_ms: 0,
            total_afk_ms: 0,
            total_hours: 0.0,
            app_count: 0,
            domain_count: 0,
            event_count: 0,
        });
    }

    // Parse date and calculate timestamps
    let date_parts: Vec<&str> = date.split('-').collect();
    if date_parts.len() != 3 {
        return Err("Invalid date format. Use YYYY-MM-DD".to_string());
    }

    let year: i32 = date_parts[0].parse().map_err(|_| "Invalid year")?;
    let month: u32 = date_parts[1].parse().map_err(|_| "Invalid month")?;
    let day: u32 = date_parts[2].parse().map_err(|_| "Invalid day")?;

    // Calculate start and end timestamps for the day
    use chrono::{TimeZone, Local};
    let start_of_day = Local.with_ymd_and_hms(year, month, day, 0, 0, 0)
        .single()
        .ok_or("Invalid date")?;
    let end_of_day = Local.with_ymd_and_hms(year, month, day, 23, 59, 59)
        .single()
        .ok_or("Invalid date")?;

    let start_ts = start_of_day.timestamp_millis();
    let end_ts = end_of_day.timestamp_millis();

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let result = conn.query_row(
        r#"
        SELECT 
            COALESCE(SUM(CASE WHEN COALESCE(is_afk, 0) = 0 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END), 0) as active_ms,
            COALESCE(SUM(CASE WHEN COALESCE(is_afk, 0) = 1 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END), 0) as afk_ms,
            COUNT(*) as event_count,
            COUNT(DISTINCT app_bundle_id) as app_count,
            COUNT(DISTINCT browser_domain) as domain_count
        FROM activity_events
        WHERE ts_start >= ?1 AND ts_start < ?2
        "#,
        [start_ts, end_ts],
        |row| {
            let active_ms: i64 = row.get(0)?;
            let afk_ms: i64 = row.get(1)?;
            let event_count: i64 = row.get(2)?;
            let app_count: i64 = row.get(3)?;
            let domain_count: i64 = row.get(4)?;
            
            Ok(DailySummary {
                date: date.clone(),
                total_active_ms: active_ms,
                total_afk_ms: afk_ms,
                total_hours: active_ms as f64 / (1000.0 * 60.0 * 60.0),
                app_count,
                domain_count,
                event_count,
            })
        },
    ).map_err(|e| format!("Failed to get summary: {}", e))?;

    Ok(result)
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
pub fn get_watcher_db_stats() -> Result<DbStats, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let db_path = home.join(".ritual").join("watcher.db");
    
    if !db_path.exists() {
        return Ok(DbStats {
            event_count: 0,
            afk_count: 0,
            oldest_event_date: None,
            newest_event_date: None,
            db_size_mb: 0.0,
            days_of_data: 0,
        });
    }
    
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    let event_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM activity_events", [], |row| row.get(0)
    ).unwrap_or(0);
    
    let afk_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM afk_events", [], |row| row.get(0)
    ).unwrap_or(0);
    
    let oldest_ts: Option<i64> = conn.query_row(
        "SELECT MIN(ts_start) FROM activity_events", [], |row| row.get(0)
    ).ok();
    
    let newest_ts: Option<i64> = conn.query_row(
        "SELECT MAX(ts_end) FROM activity_events", [], |row| row.get(0)
    ).ok();
    
    // Convert timestamps to dates
    let oldest_event_date = oldest_ts.map(|ts| {
        chrono::DateTime::from_timestamp_millis(ts)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "Unknown".to_string())
    });
    
    let newest_event_date = newest_ts.map(|ts| {
        chrono::DateTime::from_timestamp_millis(ts)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| "Unknown".to_string())
    });
    
    // Calculate days of data
    let days_of_data = match (oldest_ts, newest_ts) {
        (Some(oldest), Some(newest)) => {
            ((newest - oldest) / (24 * 60 * 60 * 1000)).max(1)
        }
        _ => 0,
    };
    
    // Get database size
    let page_count: i64 = conn.query_row("PRAGMA page_count", [], |row| row.get(0)).unwrap_or(0);
    let page_size: i64 = conn.query_row("PRAGMA page_size", [], |row| row.get(0)).unwrap_or(0);
    let db_size_mb = (page_count * page_size) as f64 / (1024.0 * 1024.0);
    
    Ok(DbStats {
        event_count,
        afk_count,
        oldest_event_date,
        newest_event_date,
        db_size_mb,
        days_of_data,
    })
}

/// Delete events older than the specified number of days
/// Returns the number of deleted events
#[tauri::command]
pub fn cleanup_old_events(days: i64) -> Result<i64, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let db_path = home.join(".ritual").join("watcher.db");
    
    if !db_path.exists() {
        return Ok(0);
    }
    
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    let cutoff_ms = chrono::Utc::now().timestamp_millis() - (days * 24 * 60 * 60 * 1000);
    
    let deleted = conn.execute(
        "DELETE FROM activity_events WHERE ts_end < ?1",
        [cutoff_ms],
    ).map_err(|e| format!("Failed to delete events: {}", e))?;
    
    // Also clean up old AFK events
    conn.execute(
        "DELETE FROM afk_events WHERE ts_end < ?1",
        [cutoff_ms],
    ).ok();
    
    // Vacuum if we deleted significant data
    if deleted > 100 {
        conn.execute_batch("VACUUM;").ok();
    }
    
    Ok(deleted as i64)
}

/// Export events for a date range
#[tauri::command]
pub fn export_events(start_date: String, end_date: String) -> Result<Vec<DetailedActivityEvent>, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let db_path = home.join(".ritual").join("watcher.db");
    
    if !db_path.exists() {
        return Ok(vec![]);
    }
    
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
    
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    let mut stmt = conn.prepare(
        r#"
        SELECT id, ts_start, ts_end, app_bundle_id, app_name, 
               window_title, browser_url, browser_domain, 
               COALESCE(is_afk, 0) as is_afk, COALESCE(is_incognito, 0) as is_incognito
        FROM activity_events
        WHERE ts_start >= ?1 AND ts_end <= ?2
        ORDER BY ts_start ASC
        "#
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;
    
    let events: Vec<DetailedActivityEvent> = stmt.query_map([start_ts, end_ts], |row| {
        let ts_start: i64 = row.get(1)?;
        let ts_end: i64 = row.get(2)?;
        Ok(DetailedActivityEvent {
            id: row.get(0)?,
            ts_start,
            ts_end,
            duration_ms: ts_end - ts_start,
            app_bundle_id: row.get(3)?,
            app_name: row.get(4)?,
            window_title: row.get(5)?,
            browser_url: row.get(6)?,
            browser_domain: row.get(7)?,
            is_afk: row.get::<_, i64>(8)? != 0,
            is_incognito: row.get::<_, i64>(9)? != 0,
        })
    }).map_err(|e| format!("Query failed: {}", e))?
    .filter_map(|r| r.ok())
    .collect();
    
    Ok(events)
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
pub fn get_focus_metrics(date: String) -> Result<FocusMetrics, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let db_path = home.join(".ritual").join("watcher.db");
    
    if !db_path.exists() {
        return Ok(FocusMetrics {
            context_switches: 0,
            longest_focus_session_minutes: 0.0,
            focus_sessions_30min_plus: 0,
            fragmented_time_minutes: 0.0,
            deep_work_minutes: 0.0,
            average_session_minutes: 0.0,
        });
    }
    
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
    
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    // Get all non-AFK events for the day
    let mut stmt = conn.prepare(
        r#"
        SELECT ts_start, ts_end, app_bundle_id
        FROM activity_events
        WHERE ts_start >= ?1 AND ts_start < ?2 AND COALESCE(is_afk, 0) = 0
        ORDER BY ts_start ASC
        "#
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;
    
    let events: Vec<(i64, i64, String)> = stmt.query_map([start_ts, end_ts], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    }).map_err(|e| format!("Query failed: {}", e))?
    .filter_map(|r| r.ok())
    .collect();
    
    if events.is_empty() {
        return Ok(FocusMetrics {
            context_switches: 0,
            longest_focus_session_minutes: 0.0,
            focus_sessions_30min_plus: 0,
            fragmented_time_minutes: 0.0,
            deep_work_minutes: 0.0,
            average_session_minutes: 0.0,
        });
    }
    
    let mut context_switches: i64 = 0;
    let mut longest_focus_session_ms: i64 = 0;
    let mut focus_sessions_30min_plus: i64 = 0;
    let mut fragmented_time_ms: i64 = 0;
    let mut deep_work_time_ms: i64 = 0;
    let mut total_duration_ms: i64 = 0;
    let mut last_app: Option<String> = None;
    
    for (start, end, app) in &events {
        let duration = end - start;
        total_duration_ms += duration;
        
        // Track context switches
        if let Some(ref prev_app) = last_app {
            if prev_app != app {
                context_switches += 1;
            }
        }
        last_app = Some(app.clone());
        
        // Track longest session
        if duration > longest_focus_session_ms {
            longest_focus_session_ms = duration;
        }
        
        // 30+ minute sessions
        if duration >= 30 * 60 * 1000 {
            focus_sessions_30min_plus += 1;
            deep_work_time_ms += duration;
        }
        
        // Fragmented time (< 2 minutes)
        if duration < 2 * 60 * 1000 {
            fragmented_time_ms += duration;
        }
    }
    
    let event_count = events.len() as i64;
    let average_session_ms = if event_count > 0 { total_duration_ms / event_count } else { 0 };
    
    Ok(FocusMetrics {
        context_switches,
        longest_focus_session_minutes: longest_focus_session_ms as f64 / 60000.0,
        focus_sessions_30min_plus,
        fragmented_time_minutes: fragmented_time_ms as f64 / 60000.0,
        deep_work_minutes: deep_work_time_ms as f64 / 60000.0,
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
pub fn get_watcher_extended_status() -> Result<WatcherExtendedStatus, String> {
    let mut process_guard = WATCHER_PROCESS.lock().map_err(|e| e.to_string())?;
    
    let is_running = process_guard.as_mut()
        .map(|child| child.try_wait().map(|s| s.is_none()).unwrap_or(false))
        .unwrap_or(false);
    
    let pid = if is_running {
        process_guard.as_ref().map(|c| c.id())
    } else {
        None
    };
    
    // Read config file for device_id
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let config_path = home.join(".ritual").join("watcher_config.json");
    let device_id = if config_path.exists() {
        std::fs::read_to_string(&config_path).ok()
            .and_then(|s| serde_json::from_str::<WatcherConfig>(&s).ok())
            .map(|c| c.device_id)
    } else {
        None
    };
    
    // Get last heartbeat from DB
    let db_path = home.join(".ritual").join("watcher.db");
    let (last_heartbeat_ts, current_app, session_duration_seconds) = if db_path.exists() && device_id.is_some() {
        let conn = Connection::open(&db_path).ok();
        let device = device_id.as_ref().unwrap();
        
        let heartbeat: Option<i64> = conn.as_ref()
            .and_then(|c| c.query_row(
                "SELECT last_seen_ts FROM watcher_heartbeat WHERE device_id = ?1",
                [device],
                |row| row.get(0)
            ).ok());
        
        // Get most recent active event
        let recent: Option<(String, i64, i64)> = conn.as_ref()
            .and_then(|c| c.query_row(
                r#"SELECT app_name, ts_start, ts_end FROM activity_events 
                   WHERE device_id = ?1 ORDER BY ts_end DESC LIMIT 1"#,
                [device],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            ).ok());
        
        let (app, session_dur) = match recent {
            Some((app_name, ts_start, ts_end)) => {
                let now_ms = chrono::Utc::now().timestamp_millis();
                // If event is recent (within 10 seconds), it's the current session
                if now_ms - ts_end < 10_000 {
                    (Some(app_name), Some((ts_end - ts_start) / 1000))
                } else {
                    (None, None)
                }
            }
            None => (None, None),
        };
        
        (heartbeat, app, session_dur)
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
        is_paused: false, // TODO: Implement pause state tracking
        seconds_since_heartbeat,
        current_app,
        session_duration_seconds,
    })
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

