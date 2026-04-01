//! Ritual Watcher Tauri Commands
//!
//! Orchestrates the ritual-watcher sidecar process for computer activity tracking.
//! Uses the unified ritual-db (libSQL) database for all queries.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::ritual_database::{get_activity_db, ACTIVITY_DB};

macro_rules! watcher_info {
    ($($arg:tt)*) => {
        log::info!("[WATCHER] {}", format!($($arg)*))
    };
}

/// Global state for the watcher process
static WATCHER_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

/// Stored device ID from the most recent watcher start
static DEVICE_ID: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

fn apply_turso_sync_env(command: &mut Command) {
    if let Ok(sync_url) = std::env::var("TURSO_SYNC_URL") {
        if !sync_url.trim().is_empty() {
            command.env("TURSO_SYNC_URL", sync_url);
        }
    }

    if let Ok(auth_token) = std::env::var("TURSO_AUTH_TOKEN") {
        if !auth_token.trim().is_empty() {
            command.env("TURSO_AUTH_TOKEN", auth_token);
        }
    }
}

fn require_db<'a, T>(db: Option<&'a T>) -> Result<&'a T, String> {
    db.ok_or_else(|| "Database not initialized. Call initialize_database() first.".to_string())
}

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
        std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str::<WatcherConfig>(&s).ok())
            .map(|c| c.device_id)
    } else {
        None
    }
}

fn load_saved_watcher_config() -> Option<WatcherConfig> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".ritual").join("watcher_config.json");
    if !config_path.exists() {
        return None;
    }
    std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<WatcherConfig>(&contents).ok())
}

pub fn get_saved_watcher_config() -> Option<WatcherConfig> {
    load_saved_watcher_config()
}

/// Watcher configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherConfig {
    pub device_id: String,
    pub user_id: String,
    pub poll_interval_ms: u64,
    pub title_mode: String, // off, full, truncate, hash
    pub truncate_length: usize,
    pub excluded_bundle_ids: Vec<String>,
    // V2: New configuration options
    #[serde(default = "default_afk_timeout")]
    pub afk_timeout_seconds: u64,
    #[serde(default = "default_url_mode")]
    pub url_mode: String, // off, domain, full
    #[serde(default)]
    pub track_incognito: bool,
    #[serde(default = "default_browser_heartbeat_port")]
    pub browser_heartbeat_port: u16,
}

fn default_afk_timeout() -> u64 {
    900
} // 15 minutes - better for coding/reading
fn default_url_mode() -> String {
    "domain".to_string()
}

fn default_browser_heartbeat_port() -> u16 {
    8766
}

const REQUIRED_WATCHER_HELP_FLAGS: [&str; 2] = ["--afk-timeout", "--url-mode"];
const EXTENSION_HEARTBEAT_LIVE_THRESHOLD_SECONDS: i64 = 90;
const WATCHER_HEARTBEAT_ENDPOINTS: [(&str, &str, u16); 2] = [
    ("http://127.0.0.1:8766", "127.0.0.1", 8766),
    ("http://127.0.0.1:8767", "127.0.0.1", 8767),
];

/// Watcher status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherStatus {
    pub is_running: bool,
    pub pid: Option<u32>,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedWatcherBinary {
    path: PathBuf,
    version: Option<String>,
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

#[derive(Debug, Clone)]
struct RangeSummary {
    active_ms: i64,
    afk_ms: i64,
    app_count: i64,
    domain_count: i64,
    event_count: i64,
}

fn clip_interval(
    event: &ritual_db::ActivityEvent,
    range_start: i64,
    range_end: i64,
) -> Option<(i64, i64)> {
    let start = event.ts_start.max(range_start);
    let end = event.ts_end.min(range_end);
    if end > start {
        Some((start, end))
    } else {
        None
    }
}

fn merge_intervals(mut intervals: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
    if intervals.is_empty() {
        return Vec::new();
    }

    intervals.sort_by_key(|(start, _)| *start);
    let mut merged: Vec<(i64, i64)> = Vec::with_capacity(intervals.len());
    let mut current = intervals[0];

    for (start, end) in intervals.into_iter().skip(1) {
        if start <= current.1 {
            current.1 = current.1.max(end);
        } else {
            merged.push(current);
            current = (start, end);
        }
    }

    merged.push(current);
    merged
}

fn total_interval_ms(intervals: Vec<(i64, i64)>) -> i64 {
    merge_intervals(intervals)
        .into_iter()
        .map(|(start, end)| end.saturating_sub(start))
        .sum()
}

fn build_range_summary(
    events: &[ritual_db::ActivityEvent],
    range_start: i64,
    range_end: i64,
) -> RangeSummary {
    let mut active_intervals = Vec::new();
    let mut afk_intervals = Vec::new();
    let mut app_keys = HashSet::new();
    let mut domains = HashSet::new();
    let mut event_count = 0_i64;

    for event in events {
        let Some((start, end)) = clip_interval(event, range_start, range_end) else {
            continue;
        };

        event_count += 1;

        if event.is_afk {
            afk_intervals.push((start, end));
            continue;
        }

        active_intervals.push((start, end));

        let app_key = if event.app_bundle_id.is_empty() {
            event.app_name.clone()
        } else {
            event.app_bundle_id.clone()
        };
        if !app_key.is_empty() {
            app_keys.insert(app_key);
        }

        if let Some(domain) = event.browser_domain.as_ref() {
            if !domain.is_empty() && !event.is_incognito {
                domains.insert(domain.clone());
            }
        }
    }

    RangeSummary {
        active_ms: total_interval_ms(active_intervals),
        afk_ms: total_interval_ms(afk_intervals),
        app_count: app_keys.len() as i64,
        domain_count: domains.len() as i64,
        event_count,
    }
}

fn build_app_summaries(
    events: &[ritual_db::ActivityEvent],
    range_start: i64,
    range_end: i64,
) -> Vec<AppActivitySummary> {
    let mut grouped: HashMap<String, (String, Vec<(i64, i64)>, i64)> = HashMap::new();

    for event in events {
        if event.is_afk {
            continue;
        }
        let Some((start, end)) = clip_interval(event, range_start, range_end) else {
            continue;
        };

        let key = if event.app_bundle_id.is_empty() {
            event.app_name.clone()
        } else {
            event.app_bundle_id.clone()
        };
        if key.is_empty() {
            continue;
        }

        let entry = grouped
            .entry(key.clone())
            .or_insert_with(|| (event.app_name.clone(), Vec::new(), 0));
        if entry.0.is_empty() {
            entry.0 = event.app_name.clone();
        }
        entry.1.push((start, end));
        entry.2 += 1;
    }

    let mut rows: Vec<AppActivitySummary> = grouped
        .into_iter()
        .map(
            |(key, (app_name, intervals, event_count))| AppActivitySummary {
                app_bundle_id: key,
                app_name,
                total_duration_ms: total_interval_ms(intervals),
                event_count,
            },
        )
        .filter(|row| row.total_duration_ms > 0)
        .collect();

    rows.sort_by(|a, b| {
        b.total_duration_ms
            .cmp(&a.total_duration_ms)
            .then_with(|| a.app_name.cmp(&b.app_name))
    });
    rows
}

fn build_domain_summaries(
    events: &[ritual_db::ActivityEvent],
    range_start: i64,
    range_end: i64,
) -> Vec<DomainActivitySummary> {
    let mut grouped: HashMap<String, (Vec<(i64, i64)>, i64)> = HashMap::new();

    for event in events {
        if event.is_afk || event.is_incognito {
            continue;
        }
        let Some(domain) = event.browser_domain.as_ref() else {
            continue;
        };
        if domain.is_empty() {
            continue;
        }
        let Some((start, end)) = clip_interval(event, range_start, range_end) else {
            continue;
        };

        let entry = grouped
            .entry(domain.clone())
            .or_insert_with(|| (Vec::new(), 0));
        entry.0.push((start, end));
        entry.1 += 1;
    }

    let mut rows: Vec<DomainActivitySummary> = grouped
        .into_iter()
        .map(|(domain, (intervals, event_count))| DomainActivitySummary {
            domain,
            total_duration_ms: total_interval_ms(intervals),
            event_count,
        })
        .filter(|row| row.total_duration_ms > 0)
        .collect();

    rows.sort_by(|a, b| {
        b.total_duration_ms
            .cmp(&a.total_duration_ms)
            .then_with(|| a.domain.cmp(&b.domain))
    });
    rows
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
        use core_foundation::base::TCFType;
        use core_foundation::boolean::CFBoolean;
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::string::CFString;

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

fn watcher_candidate_paths() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Try to get the executable's directory for relative sidecar paths
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    // Prefer the bundled helper first in release builds so we do not
    // accidentally launch a stale external copy from ~/.ritual/bin.
    if let Some(exe) = &exe_dir {
        let target = std::env::var("TARGET").unwrap_or_else(|_| String::new());
        if !target.is_empty() {
            candidates.push(exe.join(format!("ritual-watcher-{target}")));
            candidates.push(exe.join(format!("../Resources/ritual-watcher-{target}")));
            candidates.push(exe.join(format!("../Resources/binaries/ritual-watcher-{target}")));
        }
        candidates.push(exe.join("ritual-watcher"));
        candidates.push(exe.join("../Resources/ritual-watcher"));
        candidates.push(exe.join("../Resources/binaries/ritual-watcher"));
    }

    // Development paths (release/debug) from workspace.
    candidates.extend([
        PathBuf::from("src-tauri/bin/ritual-watcher/target/release/ritual-watcher"),
        PathBuf::from("bin/ritual-watcher/target/release/ritual-watcher"),
        PathBuf::from("target/release/ritual-watcher"),
        PathBuf::from("src-tauri/bin/ritual-watcher/target/debug/ritual-watcher"),
        PathBuf::from("bin/ritual-watcher/target/debug/ritual-watcher"),
        PathBuf::from("target/debug/ritual-watcher"),
    ]);

    // Add absolute fallback paths.
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        // Development-only paths — these are developer-specific and won't exist on user machines.
        #[cfg(debug_assertions)]
        {
            candidates.push(home.join("Desktop/ritual-desktop-main/src-tauri/bin/ritual-watcher/target/release/ritual-watcher"));
            candidates.push(home.join(
                "Desktop/ritual-desktop-main/src-tauri/bin/ritual-watcher/target/debug/ritual-watcher",
            ));
            candidates.push(home.join("Desktop/ritual-desktop-main/apps/desktop/src-tauri/bin/ritual-watcher/target/release/ritual-watcher"));
            candidates.push(home.join("Desktop/ritual-desktop-main/apps/desktop/src-tauri/bin/ritual-watcher/target/debug/ritual-watcher"));
        }
    }

    // External installs are kept as the last-resort fallback only.
    if let Some(external) = external_watcher_install_path() {
        candidates.push(external);
    }

    candidates
}

fn external_watcher_install_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".ritual").join("bin").join("ritual-watcher"))
}

fn bundled_watcher_binary_path() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))?;

    let candidates = [
        exe_dir.join("ritual-watcher"),
        exe_dir.join("../Resources/ritual-watcher"),
        exe_dir.join("../Resources/binaries/ritual-watcher"),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn ensure_external_watcher_binary() {
    #[cfg(target_os = "macos")]
    {
        let Some(source) = bundled_watcher_binary_path() else {
            return;
        };
        let Some(target) = external_watcher_install_path() else {
            return;
        };

        if source == target {
            return;
        }

        let needs_copy = match (source.metadata(), target.metadata()) {
            (Ok(source_meta), Ok(target_meta)) => {
                let source_mtime = source_meta.modified().ok();
                let target_mtime = target_meta.modified().ok();
                source_meta.len() != target_meta.len()
                    || source_mtime.zip(target_mtime).map(|(s, t)| s > t).unwrap_or(false)
            }
            (Ok(_), Err(_)) => true,
            _ => false,
        };

        if !needs_copy {
            return;
        }

        if let Some(parent) = target.parent() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                watcher_info!(
                    "⚠️ Failed to create external watcher directory {:?}: {}",
                    parent,
                    err
                );
                return;
            }
        }

        if let Err(err) = std::fs::copy(&source, &target) {
            watcher_info!(
                "⚠️ Failed to copy watcher binary from {:?} to {:?}: {}",
                source,
                target,
                err
            );
            return;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(err) =
                std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))
            {
                watcher_info!(
                    "⚠️ Failed to mark external watcher binary executable {:?}: {}",
                    target,
                    err
                );
            }
        }

        watcher_info!(
            "✅ Installed background watcher helper outside app bundle at {:?}",
            target
        );
    }
}

fn validate_watcher_binary(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Err("path does not exist".to_string());
    }

    let metadata = path
        .metadata()
        .map_err(|e| format!("failed to read metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("not a regular file".to_string());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err("not executable".to_string());
        }
    }

    let help_output = Command::new(path)
        .arg("--help")
        .output()
        .map_err(|e| format!("failed to execute --help: {e}"))?;

    if !help_output.status.success() {
        return Err(format!("--help exited with status {}", help_output.status));
    }

    let help_text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&help_output.stdout),
        String::from_utf8_lossy(&help_output.stderr)
    );

    for required_flag in REQUIRED_WATCHER_HELP_FLAGS {
        if !help_text.contains(required_flag) {
            return Err(format!(
                "incompatible watcher binary: missing {required_flag} support"
            ));
        }
    }

    let version = Command::new(path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                let line = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if line.is_empty() {
                    None
                } else {
                    Some(line)
                }
            } else {
                None
            }
        });

    Ok(version)
}

/// Find the ritual-watcher executable and validate it's compatible with the
/// current CLI contract.
fn find_watcher_executable() -> Result<ResolvedWatcherBinary, String> {
    ensure_external_watcher_binary();

    let candidates = watcher_candidate_paths();
    let mut seen = HashSet::new();
    let mut attempted = Vec::new();

    for path in candidates {
        let key = path.to_string_lossy().to_string();
        if !seen.insert(key.clone()) {
            continue;
        }

        match validate_watcher_binary(&path) {
            Ok(version) => {
                watcher_info!(
                    "📍 Using compatible watcher binary: {:?}{}",
                    path,
                    version
                        .as_ref()
                        .map(|v| format!(" ({v})"))
                        .unwrap_or_default()
                );
                return Ok(ResolvedWatcherBinary { path, version });
            }
            Err(reason) => {
                attempted.push(format!("{key} -> {reason}"));
            }
        }
    }

    let mut message = String::from("No compatible ritual-watcher executable found.");
    if !attempted.is_empty() {
        message.push_str("\nChecked:");
        for item in attempted {
            message.push_str(&format!("\n- {item}"));
        }
    }
    Err(message)
}

fn get_activity_database_path() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        home.join(".ritual").join("activity.db")
    } else {
        PathBuf::from("./activity.db")
    }
}

fn build_watcher_args(config: &WatcherConfig) -> Vec<String> {
    let activity_db_path = get_activity_database_path();
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
        activity_db_path.to_string_lossy().to_string(),
        "--foreground".to_string(),
        "--afk-timeout".to_string(),
        config.afk_timeout_seconds.to_string(),
        "--url-mode".to_string(),
        config.url_mode.clone(),
        "--browser-heartbeat-port".to_string(),
        config.browser_heartbeat_port.to_string(),
    ];

    if !config.excluded_bundle_ids.is_empty() {
        args.push("--excluded".to_string());
        args.push(config.excluded_bundle_ids.join(","));
    }

    if config.track_incognito {
        args.push("--track-incognito".to_string());
        args.push("true".to_string());
    }

    args
}

fn log_existing_watcher_bindings(context: &str) {
    let statuses = watcher_server_statuses();
    if statuses.is_empty() {
        return;
    }
    for status in statuses {
        let listener_port = status.status.listener_port.unwrap_or(status.port);
        watcher_info!(
            "⚠️ {}: watcher heartbeat server already reachable at {} (pid={:?}, listener_port={}, uptime={}s, heartbeats={})",
            context,
            status.server_url,
            status.status.process_id,
            listener_port,
            status.status.uptime_seconds,
            status.status.total_heartbeats
        );
    }
}

fn list_watcher_pids_for_device(device_id: &str) -> Vec<u32> {
    if device_id.trim().is_empty() {
        return Vec::new();
    }

    let Ok(output) = Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
    else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    let device_flag = format!("--device-id {}", device_id);

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || !trimmed.contains("ritual-watcher") || !trimmed.contains(&device_flag) {
                return None;
            }

            let mut parts = trimmed.splitn(2, char::is_whitespace);
            let pid = parts.next()?.trim().parse::<u32>().ok()?;
            Some(pid)
        })
        .collect()
}

fn kill_watcher_pid(pid: u32) {
    let _ = Command::new("kill").arg(pid.to_string()).output();
}

fn cleanup_existing_watcher_processes(device_id: &str, context: &str) {
    #[cfg(target_os = "macos")]
    {
        let pids = list_watcher_pids_for_device(device_id);
        if pids.is_empty() {
            watcher_info!("🧹 {}: no existing watcher processes found for device", context);
            return;
        }

        for pid in &pids {
            kill_watcher_pid(*pid);
        }

        std::thread::sleep(std::time::Duration::from_millis(500));
        watcher_info!(
            "🧹 {}: cleaned up {} existing watcher process(es) for device {}",
            context,
            pids.len(),
            device_id
        );
    }
}

/// Start the ritual-watcher sidecar
#[tauri::command]
pub async fn start_watcher(config: WatcherConfig) -> Result<WatcherStatus, String> {
    watcher_info!("🚀 Starting Ritual Watcher...");
    watcher_info!("   Device ID: {}", config.device_id);
    watcher_info!("   Title Mode: {}", config.title_mode);
    watcher_info!(
        "   Browser heartbeat port: {}",
        config.browser_heartbeat_port
    );
    log_existing_watcher_bindings("pre-start self-check");

    // Store device_id for later query use
    if let Ok(mut guard) = DEVICE_ID.lock() {
        *guard = Some(config.device_id.clone());
    }

    // Clear our stored handle
    {
        let mut guard = WATCHER_PROCESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(mut existing_child) = guard.take() {
            let _ = existing_child.kill();
            let _ = existing_child.wait();
        }
    }

    // Clean up orphaned watcher processes for this exact device only.
    cleanup_existing_watcher_processes(&config.device_id, "pre-start");

    // Find executable
    let resolved_binary = find_watcher_executable()?;
    let executable = resolved_binary.path;
    watcher_info!(
        "📍 Using executable: {:?}{}",
        executable,
        resolved_binary
            .version
            .as_ref()
            .map(|v| format!(" ({v})"))
            .unwrap_or_default()
    );

    // Watcher writes activity/sync data to ~/.ritual/activity.db.
    let args = build_watcher_args(&config);

    watcher_info!("📋 Arguments: {:?}", args);

    // Spawn the watcher process
    let mut command = Command::new(&executable);
    command.args(&args);
    apply_turso_sync_env(&mut command);
    let child = command
        .spawn()
        .map_err(|e| format!("Failed to start watcher: {}", e))?;

    let pid = child.id();
    watcher_info!("✅ Watcher started with PID: {}", pid);

    // Store the process handle
    {
        let mut guard = WATCHER_PROCESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
    watcher_info!("🚀 Starting Ritual Watcher (sync)...");
    watcher_info!("   Device ID: {}", config.device_id);
    watcher_info!("   Title Mode: {}", config.title_mode);
    watcher_info!(
        "   Browser heartbeat port: {}",
        config.browser_heartbeat_port
    );
    log_existing_watcher_bindings("pre-start self-check");

    // Store device_id for later query use
    if let Ok(mut guard) = DEVICE_ID.lock() {
        *guard = Some(config.device_id.clone());
    }

    // Clear our stored handle
    {
        let mut guard = WATCHER_PROCESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(mut existing_child) = guard.take() {
            let _ = existing_child.kill();
            let _ = existing_child.wait();
        }
    }

    // Clean up orphaned watcher processes for this exact device only.
    cleanup_existing_watcher_processes(&config.device_id, "pre-start sync");

    // Find executable
    let resolved_binary = find_watcher_executable()?;
    let executable = resolved_binary.path;
    watcher_info!(
        "📍 Using executable: {:?}{}",
        executable,
        resolved_binary
            .version
            .as_ref()
            .map(|v| format!(" ({v})"))
            .unwrap_or_default()
    );

    let args = build_watcher_args(&config);

    watcher_info!("📋 Arguments: {:?}", args);

    // Spawn the watcher process
    let mut command = Command::new(&executable);
    command.args(&args);
    apply_turso_sync_env(&mut command);
    let child = command
        .spawn()
        .map_err(|e| format!("Failed to start watcher: {}", e))?;

    let pid = child.id();
    watcher_info!("✅ Watcher started with PID: {}", pid);

    // Store the process handle
    {
        let mut guard = WATCHER_PROCESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
    watcher_info!("🛑 Stopping Ritual Watcher...");

    let mut guard = WATCHER_PROCESS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if let Some(mut child) = guard.take() {
        // Try to kill the process gracefully
        match child.kill() {
            Ok(_) => {
                watcher_info!("✅ Watcher stopped");
                // Wait for the process to actually terminate
                let _ = child.wait();
            }
            Err(e) => {
                watcher_info!("⚠️ Failed to kill watcher: {}", e);
            }
        }
    } else {
        watcher_info!("ℹ️ No watcher process to stop");
        if let Some(device_id) = get_device_id_or_config() {
            cleanup_existing_watcher_processes(&device_id, "stop fallback");
        }
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
    let managed_pid = {
        let mut guard = WATCHER_PROCESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => Some(child.id()),
                Ok(Some(_)) | Err(_) => {
                    *guard = None;
                    None
                }
            }
        } else {
            None
        }
    };

    let heartbeat_status = watcher_server_statuses()
        .into_iter()
        .find(|status| status.port == default_browser_heartbeat_port())
        .or_else(|| watcher_server_statuses().into_iter().next());
    let reachable_pid = heartbeat_status
        .as_ref()
        .and_then(|status| status.status.process_id);

    WatcherStatus {
        is_running: managed_pid.is_some() || heartbeat_status.is_some(),
        pid: managed_pid.or(reachable_pid),
        device_id: get_device_id_or_config(),
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

/// Query detailed activity from local activity storage.
/// Returns events, app/domain summaries, and active/afk totals
#[tauri::command]
pub async fn get_detailed_activity(
    start_ts: i64,
    end_ts: i64,
    limit: Option<i64>,
) -> Result<DetailedActivityResponse, String> {
    let started_at = Instant::now();
    let device_id = get_device_id_or_config().unwrap_or_default();

    let guard = get_activity_db().await?;
    let db = require_db(guard.as_ref())?;

    // Get events in range
    let all_events = db
        .get_events_in_range(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to query events: {}", e))?;

    let mut clipped_events: Vec<DetailedActivityEvent> = all_events
        .iter()
        .filter_map(|event| {
            let (clipped_start, clipped_end) = clip_interval(event, start_ts, end_ts)?;
            Some(DetailedActivityEvent {
                id: event.id.unwrap_or(0),
                ts_start: clipped_start,
                ts_end: clipped_end,
                duration_ms: clipped_end.saturating_sub(clipped_start),
                app_bundle_id: event.app_bundle_id.clone(),
                app_name: event.app_name.clone(),
                window_title: event.window_title.clone(),
                browser_url: event.browser_url.clone(),
                browser_domain: event.browser_domain.clone(),
                is_afk: event.is_afk,
                is_incognito: event.is_incognito,
            })
        })
        .collect();

    clipped_events.sort_by(|a, b| b.ts_start.cmp(&a.ts_start));

    // Apply limit to the event list only. Aggregate summaries are computed from
    // the full local range so desktop metrics stay accurate.
    let limit_val = limit.unwrap_or(500) as usize;
    let events: Vec<DetailedActivityEvent> = clipped_events.into_iter().take(limit_val).collect();

    let apps = build_app_summaries(&all_events, start_ts, end_ts);
    let domains = build_domain_summaries(&all_events, start_ts, end_ts);
    let summary = build_range_summary(&all_events, start_ts, end_ts);

    watcher_info!(
        "get_detailed_activity start_ts={} end_ts={} limit={:?} total_events={} clipped_events={} apps={} domains={} duration_ms={}",
        start_ts,
        end_ts,
        limit,
        all_events.len(),
        events.len(),
        apps.len(),
        domains.len(),
        started_at.elapsed().as_millis()
    );

    Ok(DetailedActivityResponse {
        events,
        apps,
        domains,
        total_active_ms: summary.active_ms,
        total_afk_ms: summary.afk_ms,
    })
}

// ============================================================
// DAILY SUMMARIES (internal, used by local_search_bridge)
// ============================================================

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

/// Get daily summaries for an inclusive date range (YYYY-MM-DD).
/// Not a Tauri command — called directly by the local HTTP bridge.
pub async fn get_daily_summaries(
    start_date: String,
    end_date: String,
) -> Result<Vec<DailySummary>, String> {
    let started_at = Instant::now();
    use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone};

    let device_id = get_device_id_or_config().unwrap_or_default();
    let start =
        NaiveDate::parse_from_str(&start_date, "%Y-%m-%d").map_err(|_| "Invalid start_date")?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d").map_err(|_| "Invalid end_date")?;

    if end < start {
        return Err("end_date must be on or after start_date".to_string());
    }

    let guard = get_activity_db().await?;
    let db = require_db(guard.as_ref())?;
    let start_of_range = Local
        .with_ymd_and_hms(start.year(), start.month(), start.day(), 0, 0, 0)
        .single()
        .ok_or("Invalid start_date")?;
    let end_of_range = Local
        .with_ymd_and_hms(end.year(), end.month(), end.day(), 23, 59, 59)
        .single()
        .ok_or("Invalid end_date")?;
    let all_events = db
        .get_events_in_range(
            &device_id,
            start_of_range.timestamp_millis(),
            end_of_range.timestamp_millis(),
        )
        .await
        .map_err(|e| format!("Failed to get summary events: {}", e))?;
    let mut rows = Vec::new();
    let mut day = start;

    while day <= end {
        let start_of_day = Local
            .with_ymd_and_hms(day.year(), day.month(), day.day(), 0, 0, 0)
            .single()
            .ok_or("Invalid date")?;
        let end_of_day = Local
            .with_ymd_and_hms(day.year(), day.month(), day.day(), 23, 59, 59)
            .single()
            .ok_or("Invalid date")?;

        let summary = build_range_summary(
            &all_events,
            start_of_day.timestamp_millis(),
            end_of_day.timestamp_millis(),
        );

        rows.push(DailySummary {
            date: day.format("%Y-%m-%d").to_string(),
            total_active_ms: summary.active_ms,
            total_afk_ms: summary.afk_ms,
            total_hours: summary.active_ms as f64 / (1000.0 * 60.0 * 60.0),
            app_count: summary.app_count,
            domain_count: summary.domain_count,
            event_count: summary.event_count,
        });

        day += Duration::days(1);
    }

    watcher_info!(
        "get_daily_summaries start_date={} end_date={} source_events={} row_count={} duration_ms={}",
        start_date,
        end_date,
        all_events.len(),
        rows.len(),
        started_at.elapsed().as_millis()
    );

    Ok(rows)
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

        let running = process_guard
            .as_mut()
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
    let (last_heartbeat_ts, current_app, session_duration_seconds) =
        if let Some(ref dev_id) = device_id {
            let guard = ACTIVITY_DB.read().await;
            if let Some(ref db) = *guard {
                // Get last heartbeat
                let heartbeat = db.get_last_heartbeat(dev_id).await.unwrap_or(None);

                // Get most recent event
                let recent_events = db.get_recent_events(dev_id, 1).await.unwrap_or_default();

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserExtensionDiagnostics {
    pub extension_installed: bool,
    pub watcher_reachable: bool,
    pub heartbeat_live: bool,
    pub watcher_server_url: Option<String>,
    pub current_listener_port: Option<u16>,
    pub watcher_pid: Option<u32>,
    pub duplicate_watcher_detected: bool,
    pub browser_heartbeat_port_mismatch: bool,
    pub last_browser_extension_heartbeat_ts: Option<i64>,
    pub seconds_since_browser_extension_heartbeat: Option<i64>,
    pub context_enabled: bool,
    pub context_quality: String,
    pub recent_context_snapshot_count: i64,
    pub recent_browser_snapshot_count: i64,
    pub recent_accessibility_snapshot_count: i64,
    pub recent_deep_accessibility_snapshot_count: i64,
    pub recent_metadata_fallback_count: i64,
    pub recent_event_triggered_snapshot_count: i64,
    pub recent_polling_snapshot_count: i64,
    pub recent_vision_fallback_snapshot_count: i64,
    pub last_context_snapshot_ts: Option<i64>,
    pub last_native_context_snapshot_ts: Option<i64>,
    pub seconds_since_context_snapshot: Option<i64>,
    pub native_capture_quality: String,
    pub ax_observer_live: bool,
    pub vision_fallback_apps: Vec<String>,
    pub vision_fallback_rate: f64,
    pub context_note: String,
    pub detection_note: String,
}

#[derive(Debug, Clone, Deserialize)]
struct WatcherHeartbeatStatusResponse {
    uptime_seconds: u64,
    total_heartbeats: u64,
    #[serde(default)]
    process_id: Option<u32>,
    #[serde(default)]
    listener_port: Option<u16>,
    #[serde(default)]
    last_extension_heartbeat_ms: Option<u64>,
}

#[derive(Debug, Clone)]
struct WatcherHeartbeatEndpointStatus {
    server_url: String,
    port: u16,
    status: WatcherHeartbeatStatusResponse,
}

fn watcher_server_statuses() -> Vec<WatcherHeartbeatEndpointStatus> {
    let mut statuses = Vec::new();
    for (url, host, port) in WATCHER_HEARTBEAT_ENDPOINTS {
        if let Some(status) = fetch_watcher_server_status(url, host, port) {
            statuses.push(status);
        }
    }
    statuses
}

fn fetch_watcher_server_status(
    url: &str,
    host: &str,
    port: u16,
) -> Option<WatcherHeartbeatEndpointStatus> {
    let address = format!("{host}:{port}");
    let socket_addr = address.to_socket_addrs().ok()?.next()?;
    let mut stream = TcpStream::connect_timeout(&socket_addr, Duration::from_millis(250)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));

    let request =
        format!("GET /api/status HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;

    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let body = response.split("\r\n\r\n").nth(1)?.trim();
    let status: WatcherHeartbeatStatusResponse = serde_json::from_str(body).ok()?;

    Some(WatcherHeartbeatEndpointStatus {
        server_url: url.to_string(),
        port,
        status,
    })
}

#[tauri::command]
pub async fn get_browser_extension_diagnostics() -> Result<BrowserExtensionDiagnostics, String> {
    let server_statuses = watcher_server_statuses();
    let watcher_reachable = !server_statuses.is_empty();
    let preferred_status = server_statuses
        .iter()
        .find(|status| status.port == default_browser_heartbeat_port())
        .or_else(|| server_statuses.first());
    let watcher_server_url = preferred_status.map(|status| status.server_url.clone());
    let current_listener_port = preferred_status
        .and_then(|status| status.status.listener_port)
        .or_else(|| preferred_status.map(|status| status.port));
    let managed_watcher_pid = {
        let mut guard = WATCHER_PROCESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.as_mut().and_then(|child| {
            child
                .try_wait()
                .ok()
                .and_then(|state| state.is_none().then_some(child.id()))
        })
    };
    let watcher_pid = preferred_status
        .and_then(|status| status.status.process_id)
        .or(managed_watcher_pid);
    let unique_pids: HashSet<u32> = server_statuses
        .iter()
        .filter_map(|status| status.status.process_id)
        .collect();
    let unique_ports: HashSet<u16> = server_statuses
        .iter()
        .filter_map(|status| status.status.listener_port.or(Some(status.port)))
        .collect();
    let duplicate_watcher_detected = unique_pids.len() > 1
        || unique_ports.len() > 1
        || managed_watcher_pid
            .map(|pid| {
                server_statuses
                    .iter()
                    .filter_map(|status| status.status.process_id)
                    .any(|server_pid| server_pid != pid)
            })
            .unwrap_or(false);
    let device_id = get_device_id_or_config();

    let mut last_browser_extension_heartbeat_ts: Option<i64> = preferred_status
        .and_then(|status| status.status.last_extension_heartbeat_ms)
        .map(|value| value as i64);
    let mut recent_context_snapshot_count = 0i64;
    let mut recent_browser_snapshot_count = 0i64;
    let mut recent_accessibility_snapshot_count = 0i64;
    let mut recent_deep_accessibility_snapshot_count = 0i64;
    let mut recent_metadata_fallback_count = 0i64;
    let mut recent_event_triggered_snapshot_count = 0i64;
    let mut recent_polling_snapshot_count = 0i64;
    let mut recent_vision_fallback_snapshot_count = 0i64;
    let mut last_context_snapshot_ts: Option<i64> = None;
    let mut last_native_context_snapshot_ts: Option<i64> = None;
    let mut native_capture_quality_score = 0.0f64;
    let mut native_capture_quality_count = 0i64;
    let mut vision_fallback_apps = HashSet::new();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let recent_window_start = now_ms - (10 * 60 * 1000);

    if let Some(ref dev_id) = device_id {
        let guard = ACTIVITY_DB.read().await;
        if let Some(ref db) = *guard {
            // Pull a bounded set of recent events and derive the latest extension heartbeat.
            let recent_events = db.get_recent_events(dev_id, 500).await.unwrap_or_default();

            for event in recent_events {
                if event.source.contains("browser_extension") {
                    last_browser_extension_heartbeat_ts = Some(
                        last_browser_extension_heartbeat_ts
                            .map(|existing| existing.max(event.ts_end))
                            .unwrap_or(event.ts_end),
                    );
                }
            }

            if let Ok(snapshots) = db
                .get_recent_context_snapshots(recent_window_start, now_ms, 500)
                .await
            {
                for snapshot in snapshots {
                    recent_context_snapshot_count += 1;
                    last_context_snapshot_ts = Some(
                        last_context_snapshot_ts
                            .map(|existing| existing.max(snapshot.ts))
                            .unwrap_or(snapshot.ts),
                    );
                    let is_native = !matches!(snapshot.source_type.as_str(), "browser_extension");
                    if is_native {
                        last_native_context_snapshot_ts = Some(
                            last_native_context_snapshot_ts
                                .map(|existing| existing.max(snapshot.ts))
                                .unwrap_or(snapshot.ts),
                        );
                        native_capture_quality_score += snapshot.capture_quality;
                        native_capture_quality_count += 1;
                    }
                    match snapshot.source_type.as_str() {
                        "browser_extension" => recent_browser_snapshot_count += 1,
                        "macos_accessibility" => recent_accessibility_snapshot_count += 1,
                        "macos_accessibility_deep" => {
                            recent_accessibility_snapshot_count += 1;
                            recent_deep_accessibility_snapshot_count += 1;
                        }
                        "window_metadata_fallback" => recent_metadata_fallback_count += 1,
                        "vision_ui_fallback" => {
                            recent_vision_fallback_snapshot_count += 1;
                            recent_accessibility_snapshot_count += 1;
                            if !snapshot.app_name.trim().is_empty() {
                                vision_fallback_apps.insert(snapshot.app_name.clone());
                            }
                        }
                        _ => {}
                    }
                    match snapshot.capture_trigger.as_deref() {
                        Some("ax_event") => recent_event_triggered_snapshot_count += 1,
                        Some("polling") | Some("idle_fallback") => {
                            recent_polling_snapshot_count += 1
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    let seconds_since_browser_extension_heartbeat =
        last_browser_extension_heartbeat_ts.map(|ts| (now_ms - ts) / 1000);
    let seconds_since_context_snapshot = last_context_snapshot_ts.map(|ts| (now_ms - ts) / 1000);
    let avg_native_capture_quality = if native_capture_quality_count > 0 {
        native_capture_quality_score / native_capture_quality_count as f64
    } else {
        0.0
    };
    let native_capture_quality =
        if recent_deep_accessibility_snapshot_count >= 4 && avg_native_capture_quality >= 0.8 {
            "high".to_string()
        } else if recent_accessibility_snapshot_count > 0 && avg_native_capture_quality >= 0.55 {
            "medium".to_string()
        } else if last_native_context_snapshot_ts.is_some() {
            "degraded".to_string()
        } else {
            "unavailable".to_string()
        };
    let ax_observer_live = recent_event_triggered_snapshot_count > 0
        || (recent_accessibility_snapshot_count > 0
            && seconds_since_context_snapshot
                .map(|seconds| seconds <= 120)
                .unwrap_or(false));

    let extension_installed = last_browser_extension_heartbeat_ts.is_some();
    let heartbeat_live = watcher_reachable
        && seconds_since_browser_extension_heartbeat
            .map(|seconds| seconds <= EXTENSION_HEARTBEAT_LIVE_THRESHOLD_SECONDS)
            .unwrap_or(false);
    let high_fidelity_count = recent_browser_snapshot_count + recent_accessibility_snapshot_count;
    let context_enabled = watcher_reachable
        && recent_context_snapshot_count >= 3
        && high_fidelity_count >= 1
        && seconds_since_context_snapshot
            .map(|seconds| seconds <= 120)
            .unwrap_or(false);
    let context_quality = if context_enabled && high_fidelity_count >= 6 {
        "high".to_string()
    } else if context_enabled {
        "medium".to_string()
    } else if recent_context_snapshot_count > 0 {
        "degraded".to_string()
    } else {
        "unavailable".to_string()
    };
    let browser_heartbeat_port_mismatch = duplicate_watcher_detected
        || current_listener_port
            .map(|port| port != default_browser_heartbeat_port())
            .unwrap_or(false);
    let vision_fallback_rate = if recent_context_snapshot_count > 0 {
        recent_vision_fallback_snapshot_count as f64 / recent_context_snapshot_count as f64
    } else {
        0.0
    };

    let detection_note = if duplicate_watcher_detected {
        let ports = server_statuses
            .iter()
            .map(|status| {
                status
                    .status
                    .listener_port
                    .unwrap_or(status.port)
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "Duplicate watcher listeners detected on {}. Browser/native capture may be split until only one watcher owns {}.",
            ports,
            default_browser_heartbeat_port()
        )
    } else if browser_heartbeat_port_mismatch {
        format!(
            "Watcher heartbeat server is reachable on port {} instead of the expected {}.",
            current_listener_port.unwrap_or_default(),
            default_browser_heartbeat_port()
        )
    } else if extension_installed {
        "Detected via browser_extension heartbeat events".to_string()
    } else if watcher_reachable {
        "Watcher is reachable, but no extension heartbeat has been observed yet".to_string()
    } else {
        "Watcher heartbeat server is not reachable".to_string()
    };
    let context_note = if context_enabled {
        format!(
            "Recent context capture is active (browser={}, accessibility={}, deep={}, fallback={}, vision={}, event_triggered={}).",
            recent_browser_snapshot_count,
            recent_accessibility_snapshot_count,
            recent_deep_accessibility_snapshot_count,
            recent_metadata_fallback_count,
            recent_vision_fallback_snapshot_count,
            recent_event_triggered_snapshot_count
        )
    } else if recent_context_snapshot_count > 0 {
        format!(
            "Context snapshots exist, but coverage is degraded (browser={}, accessibility={}, deep={}, fallback={}, vision={}, event_triggered={}).",
            recent_browser_snapshot_count,
            recent_accessibility_snapshot_count,
            recent_deep_accessibility_snapshot_count,
            recent_metadata_fallback_count,
            recent_vision_fallback_snapshot_count,
            recent_event_triggered_snapshot_count
        )
    } else {
        "No recent context snapshots were detected.".to_string()
    };

    Ok(BrowserExtensionDiagnostics {
        extension_installed,
        watcher_reachable,
        heartbeat_live,
        watcher_server_url,
        current_listener_port,
        watcher_pid,
        duplicate_watcher_detected,
        browser_heartbeat_port_mismatch,
        last_browser_extension_heartbeat_ts,
        seconds_since_browser_extension_heartbeat,
        context_enabled,
        context_quality,
        recent_context_snapshot_count,
        recent_browser_snapshot_count,
        recent_accessibility_snapshot_count,
        recent_deep_accessibility_snapshot_count,
        recent_metadata_fallback_count,
        recent_event_triggered_snapshot_count,
        recent_polling_snapshot_count,
        recent_vision_fallback_snapshot_count,
        last_context_snapshot_ts,
        last_native_context_snapshot_ts,
        seconds_since_context_snapshot,
        native_capture_quality,
        ax_observer_live,
        vision_fallback_apps: vision_fallback_apps.into_iter().collect(),
        vision_fallback_rate,
        context_note,
        detection_note,
    })
}

/// Check watcher health and auto-restart if hung
/// Returns true if watcher was restarted, false if it was healthy
#[tauri::command]
pub async fn check_and_restart_watcher_if_hung(max_stale_seconds: i64) -> Result<bool, String> {
    let status = get_watcher_extended_status().await?;
    let diagnostics = get_browser_extension_diagnostics().await.ok();
    let watcher_reachable = diagnostics
        .as_ref()
        .map(|diag| diag.watcher_reachable)
        .unwrap_or(false);
    let context_stale = diagnostics
        .as_ref()
        .and_then(|diag| diag.seconds_since_context_snapshot)
        .map(|seconds| seconds > max_stale_seconds)
        .unwrap_or(false);
    let heartbeat_stale = status
        .seconds_since_heartbeat
        .map(|seconds| seconds > max_stale_seconds)
        .unwrap_or(false);
    let should_restart = (!status.is_running && !watcher_reachable)
        || (status.is_running && (heartbeat_stale || context_stale || !watcher_reachable));

    if should_restart {
        watcher_info!(
            "⚠️ Watcher unhealthy or missing (is_running={}, watcher_reachable={}, heartbeat_stale={}, context_stale={})",
            status.is_running,
            watcher_reachable,
            heartbeat_stale,
            context_stale
        );

        if let Err(e) = stop_watcher().await {
            watcher_info!("   Failed to stop unhealthy watcher: {}", e);
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        if let Some(config) = load_saved_watcher_config() {
            match start_watcher_sync(config) {
                Ok(_) => {
                    watcher_info!("✅ Watcher auto-restarted after health-check failure");
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

fn get_app_icon_impl(bundle_id: String) -> Result<AppIconResponse, String> {
    let started_at = Instant::now();
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
            watcher_info!(
                "get_app_icon bundle_id={} cache_hit=true duration_ms={}",
                bundle_id,
                started_at.elapsed().as_millis()
            );

            return Ok(AppIconResponse {
                bundle_id,
                icon_path: Some(cache_path.to_string_lossy().to_string()),
                icon_base64: Some(base64_data),
            });
        }

        // Extract icon using macOS tools
        if let Some(icon_path) = extract_app_icon_macos(&bundle_id, &cache_path) {
            use base64::Engine;
            let icon_data =
                std::fs::read(&icon_path).map_err(|e| format!("Failed to read icon: {}", e))?;
            let base64_data = base64::engine::general_purpose::STANDARD.encode(&icon_data);
            watcher_info!(
                "get_app_icon bundle_id={} cache_hit=false extracted=true duration_ms={}",
                bundle_id,
                started_at.elapsed().as_millis()
            );

            return Ok(AppIconResponse {
                bundle_id,
                icon_path: Some(icon_path),
                icon_base64: Some(base64_data),
            });
        }

        watcher_info!(
            "get_app_icon bundle_id={} cache_hit=false extracted=false duration_ms={}",
            bundle_id,
            started_at.elapsed().as_millis()
        );
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

/// Get app icon for a bundle ID
/// Extracts the icon from the app bundle and caches it
#[tauri::command]
pub async fn get_app_icon(bundle_id: String) -> Result<AppIconResponse, String> {
    tauri::async_runtime::spawn_blocking(move || get_app_icon_impl(bundle_id))
        .await
        .map_err(|e| format!("Failed to join get_app_icon task: {}", e))?
}

/// Get icons for multiple bundle IDs at once (batch operation)
#[tauri::command]
pub async fn get_app_icons_batch(bundle_ids: Vec<String>) -> Result<Vec<AppIconResponse>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        let mut results = Vec::new();
        let requested = bundle_ids.len();

        for bundle_id in bundle_ids {
            match get_app_icon_impl(bundle_id.clone()) {
                Ok(response) => results.push(response),
                Err(_) => results.push(AppIconResponse {
                    bundle_id,
                    icon_path: None,
                    icon_base64: None,
                }),
            }
        }

        watcher_info!(
            "get_app_icons_batch requested={} returned={} duration_ms={}",
            requested,
            results.len(),
            started_at.elapsed().as_millis()
        );

        Ok(results)
    })
    .await
    .map_err(|e| format!("Failed to join get_app_icons_batch task: {}", e))?
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
            stdout
                .lines()
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
            "-s",
            "format",
            "png",
            "-z",
            "64",
            "64",
            &icns_path,
            "--out",
            output_path.to_str()?,
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
                Some(if name.ends_with(".icns") {
                    name
                } else {
                    format!("{}.icns", name)
                })
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
    std::fs::read_dir(&resources_path)
        .ok()?
        .filter_map(|e| e.ok())
        .find(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "icns")
                .unwrap_or(false)
        })
        .and_then(|e| e.path().to_str().map(|s| s.to_string()))
}
