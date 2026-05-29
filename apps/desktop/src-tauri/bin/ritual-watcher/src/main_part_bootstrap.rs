// Ritual Watcher - macOS Computer Activity Tracker
// 
// A privacy-focused activity tracker that monitors:
// - Active application (bundle ID, app name)
// - Window titles (with privacy controls)
// - Browser URLs and domains (with privacy controls)
// - Browser tab changes (with dedicated polling)
// - AFK (away from keyboard) detection
// - Screen lock/unlock and sleep/wake events
// - Session timing with heartbeat merging
// 
// Inspired by ActivityWatch's open-source implementation and Cronus's native modules.

use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use clap::Parser;
use ritual_db::{
    ContextSnapshot as RitualContextSnapshot, OcrFrame as RitualOcrFrame,
    StorageTier as RitualStorageTier,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tracing::{debug, error, info, warn};

mod afk;
mod browser;
mod browser_heartbeat_server;
mod config;
mod database;
pub mod icons;
mod macos;
mod sync_queue;

#[cfg(target_os = "macos")]
mod applescript_ffi;
#[cfg(target_os = "macos")]
mod browser_tracker;
#[cfg(target_os = "macos")]
mod notifications;
#[cfg(target_os = "macos")]
mod screen_events;
#[cfg(target_os = "macos")]
mod vision_helper;
#[cfg(target_os = "macos")]
mod window_observer;

use afk::{AfkState, AfkWatcher};
use browser::{get_browser_info, is_browser};
use browser_heartbeat_server::BrowserDbCommand;
use config::{TitleMode, UrlMode, WatcherConfig};
use database::WatcherDatabase;
use macos::{dump_accessibility_context, get_active_window_info, get_focused_text_info};
use sync_queue::SyncQueue;

#[cfg(target_os = "macos")]
use browser_tracker::{set_active_browser, BrowserTabTracker};
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2_app_kit::NSApplicationActivationPolicy;
#[cfg(target_os = "macos")]
use screen_events::{ScreenEventListener, ScreenEventType};
#[cfg(target_os = "macos")]
use vision_helper::elements_to_ui_elements_json;
#[cfg(target_os = "macos")]
use window_observer::{observe_app, WindowChangeEvent, WindowChangeListener};

/// Ritual Watcher CLI
#[derive(Parser, Debug)]
#[command(name = "ritual-watcher")]
#[command(about = "macOS computer activity tracker for Ritual")]
struct Args {
    /// Path to the SQLite database
    #[arg(short, long, default_value = "~/.ritual/activity.db")]
    database: String,

    /// Device ID (UUID)
    #[arg(short = 'i', long, required_unless_present_any = ["biome_source_report", "biome_export_jsonl"])]
    device_id: Option<String>,

    /// User ID
    #[arg(short, long, required_unless_present_any = ["biome_source_report", "biome_export_jsonl"])]
    user_id: Option<String>,

    /// Poll interval in milliseconds
    #[arg(short, long, default_value = "2000")]
    poll_interval: u64,

    /// Title mode: off, full, truncate, hash
    #[arg(short, long, default_value = "off")]
    title_mode: String,

    /// Truncate length for title_mode=truncate
    #[arg(long, default_value = "80")]
    truncate_length: usize,

    /// Excluded bundle IDs (comma-separated)
    #[arg(short, long, default_value = "")]
    excluded: String,

    /// AFK timeout in seconds
    #[arg(long, default_value = "300")]
    afk_timeout: u64,

    /// URL mode: off, domain, full
    #[arg(long, default_value = "domain")]
    url_mode: String,

    /// Track incognito/private browsing
    #[arg(long, default_value = "false")]
    track_incognito: bool,

    /// Local port for the browser heartbeat HTTP server
    #[arg(long, default_value = "8766")]
    browser_heartbeat_port: u16,

    /// Run in foreground (don't daemonize)
    #[arg(long)]
    foreground: bool,

    /// Dump the macOS accessibility structure for a target pid and exit.
    #[arg(long)]
    ax_dump_pid: Option<i32>,

    /// Max descendant depth for AX dump mode.
    #[arg(long, default_value = "2")]
    ax_dump_depth: usize,

    /// Max children/siblings per node for AX dump mode.
    #[arg(long, default_value = "8")]
    ax_dump_max_children: usize,

    /// Write a one-shot Biome App.InFocus parser report and exit.
    #[arg(long, value_name = "PATH")]
    biome_source_report: Option<String>,

    /// Export normalized Biome iPhone intervals as JSONL and exit.
    #[arg(long, value_name = "PATH")]
    biome_export_jsonl: Option<String>,
}

/// Activity signature for detecting changes (used for event merging)
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ActivitySignature {
    bundle_id: String,
    title_normalized: String,
    domain: Option<String>,
    is_afk: bool,
}

/// Current session state - explicit state machine for activity tracking
///
/// State transitions:
/// - None → Active: First window detected
/// - Active → Active: Same signature within pulsetime (heartbeat merge)
/// - Active → None: App excluded, no window, permission lost
/// - Active → New Active: Signature changed, hard gap, or AFK state change
struct CurrentSession {
    /// Activity signature for detecting changes
    signature: ActivitySignature,
    /// Database event ID for updating ts_end
    event_id: Option<i64>,
    /// Session start time (first heartbeat)
    start_time: u64,
    /// Last heartbeat time (for gap detection)
    last_seen_ts: u64,
    /// App metadata for logging
    app_name: String,
    window_title: Option<String>,
    browser_url: Option<String>,
    browser_domain: Option<String>,
    is_incognito: bool,
    pid: Option<i32>,
}

/// Reasons for closing a session (for logging/debugging)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionCloseReason {
    SignatureChanged,
    HardGap,
    AfkStateChanged,
    AppExcluded,
    NoWindow,
    PermissionLost,
    Shutdown,
    SleepWake,
    ScreenLocked,
    BrowserTabChanged,
    BrowserExtensionActive,
}

impl std::fmt::Display for SessionCloseReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionCloseReason::SignatureChanged => write!(f, "activity changed"),
            SessionCloseReason::HardGap => write!(f, "hard gap (>60s)"),
            SessionCloseReason::AfkStateChanged => write!(f, "AFK state changed"),
            SessionCloseReason::AppExcluded => write!(f, "app excluded"),
            SessionCloseReason::NoWindow => write!(f, "no window detected"),
            SessionCloseReason::PermissionLost => write!(f, "permission lost"),
            SessionCloseReason::Shutdown => write!(f, "watcher shutdown"),
            SessionCloseReason::SleepWake => write!(f, "sleep/wake detected"),
            SessionCloseReason::ScreenLocked => write!(f, "screen locked"),
            SessionCloseReason::BrowserTabChanged => write!(f, "browser tab changed"),
            SessionCloseReason::BrowserExtensionActive => write!(f, "browser extension active"),
        }
    }
}

// Keep old struct name as alias for compatibility
type CurrentActivity = CurrentSession;
static BROWSER_DB_LOCK_ERRORS: AtomicU64 = AtomicU64::new(0);
const RECORDER_SPOOL_MAX_FILES_PER_TICK: usize = 256;

#[derive(Debug, Deserialize)]
struct RecorderSpoolFrame {
    timestamp: i64,
    activity_event_id: Option<i64>,
    app_bundle_id: String,
    app_name: String,
    window_title: Option<String>,
    ocr_text: String,
    ocr_confidence: f64,
    thumbnail_path: Option<String>,
    video_chunk_id: Option<i64>,
    frame_offset: Option<i64>,
    image_hash: String,
    storage_tier: String,
}

impl RecorderSpoolFrame {
    fn to_ritual_frame(&self) -> RitualOcrFrame {
        let mut frame = RitualOcrFrame::new(
            self.timestamp,
            &self.app_bundle_id,
            &self.app_name,
            &self.ocr_text,
            &self.image_hash,
        );
        frame.activity_event_id = self.activity_event_id;
        frame.window_title = self.window_title.clone();
        frame.ocr_confidence = self.ocr_confidence;
        frame.thumbnail_path = self.thumbnail_path.clone();
        frame.video_chunk_id = self.video_chunk_id;
        frame.frame_offset = self.frame_offset;
        frame.storage_tier = match self.storage_tier.trim().to_ascii_lowercase().as_str() {
            "warm" => RitualStorageTier::Warm,
            "cold" => RitualStorageTier::Cold,
            _ => RitualStorageTier::Hot,
        };
        frame
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

#[cfg(target_os = "macos")]
const VISION_CAPTURE_DENIED_COOLDOWN_MS: u64 = 10 * 60 * 1000;
#[cfg(target_os = "macos")]
const VISION_CAPTURE_FAILURE_COOLDOWN_MS: u64 = 60 * 1000;
#[cfg(target_os = "macos")]
const VISION_CAPTURE_HELPER_FAILURE_COOLDOWN_MS: u64 = 30 * 1000;
#[cfg(target_os = "macos")]
const VISION_CAPTURE_LOG_THROTTLE_MS: u64 = 60 * 1000;

#[cfg(target_os = "macos")]
static VISION_CAPTURE_DISABLED_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "macos")]
static VISION_CAPTURE_LAST_WARNING_MS: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "macos")]
fn vision_capture_log_block(reason: &str, cooldown_ms: u64) {
    let now = now_ms();
    let last = VISION_CAPTURE_LAST_WARNING_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) >= VISION_CAPTURE_LOG_THROTTLE_MS {
        warn!(
            "Skipping vision fallback for {}s: {}",
            cooldown_ms / 1000,
            reason
        );
        VISION_CAPTURE_LAST_WARNING_MS.store(now, Ordering::Relaxed);
    }
}

#[cfg(target_os = "macos")]
fn vision_capture_backoff_active(now: u64) -> bool {
    now < VISION_CAPTURE_DISABLED_UNTIL_MS.load(Ordering::Relaxed)
}

#[cfg(target_os = "macos")]
fn block_vision_capture(reason: &str, cooldown_ms: u64) {
    let until = now_ms().saturating_add(cooldown_ms);
    VISION_CAPTURE_DISABLED_UNTIL_MS.store(until, Ordering::Relaxed);
    vision_capture_log_block(reason, cooldown_ms);
}

#[cfg(target_os = "macos")]
fn unblock_vision_capture() {
    VISION_CAPTURE_DISABLED_UNTIL_MS.store(0, Ordering::Relaxed);
}

#[cfg(target_os = "macos")]
fn screen_capture_denied_reason(stderr: &str) -> bool {
    let lower = stderr.to_ascii_lowercase();
    lower.contains("declined tcc")
        || lower.contains("user declined")
        || lower.contains("not authorized")
        || lower.contains("grant access")
        || lower.contains("screen recording")
        || lower.contains("screen capture")
        || lower.contains("could not create image from display")
        || lower.contains("capture error")
}

fn is_db_lock_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("database is locked")
        || lower.contains("database busy")
        || lower.contains("busy timeout")
        || lower.contains("sql_busy")
        || lower.contains("database table is locked")
        || lower.contains("sqlite failure")
}

fn recorder_spool_dir(database_path: &str) -> PathBuf {
    Path::new(database_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("ocr_spool")
}

fn derive_memory_db_path(activity_db_path: &str) -> String {
    let activity_path = Path::new(activity_db_path);
    let parent = activity_path.parent().unwrap_or_else(|| Path::new("."));
    parent.join("memory.db").to_string_lossy().to_string()
}

fn recorder_spool_deadletter_dir(spool_dir: &Path) -> PathBuf {
    spool_dir.join("deadletter")
}

fn list_spool_files(spool_dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = match fs::read_dir(spool_dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|path| path.is_file())
            .filter(|path| path.extension().map(|ext| ext == "json").unwrap_or(false))
            .collect(),
        Err(_) => Vec::new(),
    };
    files.sort();
    files
}

fn move_to_deadletter(path: &Path, deadletter_dir: &Path) {
    if let Err(err) = fs::create_dir_all(deadletter_dir) {
        warn!(
            "Failed to create recorder deadletter dir {}: {}",
            deadletter_dir.display(),
            err
        );
        return;
    }

    let fallback_name = format!("invalid_{}_{}.json", std::process::id(), now_ms());
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|s| s.to_string())
        .unwrap_or(fallback_name);
    let target = deadletter_dir.join(file_name);

    if let Err(err) = fs::rename(path, &target) {
        warn!(
            "Failed to move invalid recorder spool {} to {}: {}",
            path.display(),
            target.display(),
            err
        );
        if let Err(remove_err) = fs::remove_file(path) {
            warn!(
                "Failed to remove invalid recorder spool {}: {}",
                path.display(),
                remove_err
            );
        }
    }
}

fn drain_recorder_spool(
    db: &WatcherDatabase,
    spool_dir: &Path,
    max_files: usize,
) -> (usize, usize) {
    let files = list_spool_files(spool_dir);
    if files.is_empty() {
        return (0, 0);
    }

    let mut ingested = 0usize;
    let mut invalid = 0usize;
    let deadletter_dir = recorder_spool_deadletter_dir(spool_dir);

    for path in files.into_iter().take(max_files.max(1)) {
        let payload = match fs::read_to_string(&path) {
            Ok(raw) => match serde_json::from_str::<RecorderSpoolFrame>(&raw) {
                Ok(payload) => payload,
                Err(err) => {
                    invalid = invalid.saturating_add(1);
                    warn!("Invalid recorder spool JSON {}: {}", path.display(), err);
                    move_to_deadletter(&path, &deadletter_dir);
                    continue;
                }
            },
            Err(err) => {
                invalid = invalid.saturating_add(1);
                warn!("Failed to read recorder spool {}: {}", path.display(), err);
                move_to_deadletter(&path, &deadletter_dir);
                continue;
            }
        };

        let frame = payload.to_ritual_frame();
        match db.insert_ocr_frame(&frame) {
            Ok(_) => {
                if let Err(err) = fs::remove_file(&path) {
                    warn!(
                        "Recorder spool ingested but failed to remove {}: {}",
                        path.display(),
                        err
                    );
                }
                ingested = ingested.saturating_add(1);
            }
            Err(err) => {
                // Keep file in place for retry on the next tick.
                if !is_db_lock_error(&err) {
                    warn!(
                        "Failed to ingest recorder spool {}: {}",
                        path.display(),
                        err
                    );
                }
                break;
            }
        }
    }

    (ingested, invalid)
}

fn hash_title(title: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(title.as_bytes());
    hex::encode(hasher.finalize())
}

fn truncate_title(title: &str, length: usize) -> String {
    if title.chars().count() > length {
        let mut truncated: String = title.chars().take(length).collect();
        truncated.push_str("...");
        truncated
    } else {
        title.to_string()
    }
}

fn normalize_title(title: &str, mode: &TitleMode, truncate_length: usize) -> String {
    match mode {
        TitleMode::Off => String::new(),
        TitleMode::Full => title.to_string(),
        TitleMode::Truncate => truncate_title(title, truncate_length),
        TitleMode::Hash => hash_title(title),
    }
}

fn normalize_visible_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_lowercase()
}

fn context_capture_quality(
    visible_text_norm: &str,
    source_type: &str,
    accessibility_quality: Option<f64>,
) -> f64 {
    if let Some(score) = accessibility_quality {
        if !visible_text_norm.trim().is_empty() {
            return score.clamp(0.0, 0.99);
        }
    }
    if !visible_text_norm.trim().is_empty() {
        if source_type == "browser_extension" {
            0.98
        } else if source_type == "hybrid_native" {
            accessibility_quality.unwrap_or(0.9).clamp(0.0, 0.99)
        } else if source_type == "vision_ui_fallback" {
            accessibility_quality.unwrap_or(0.84).clamp(0.0, 0.99)
        } else {
            0.72
        }
    } else if source_type == "window_metadata_fallback" {
        0.25
    } else {
        0.4
    }
}

fn build_context_dedup_key(
    ts_ms: u64,
    source_type: &str,
    app_bundle_id: &str,
    browser_domain: Option<&str>,
    window_title: Option<&str>,
    document_title: Option<&str>,
    visible_text_norm: &str,
) -> String {
    let bucket = ts_ms / 120_000;
    let raw = format!(
        "{}|{}|{}|{}|{}|{}|{}",
        bucket,
        source_type.trim().to_lowercase(),
        app_bundle_id.trim().to_lowercase(),
        browser_domain.unwrap_or("").trim().to_lowercase(),
        window_title.unwrap_or("").trim().to_lowercase(),
        document_title.unwrap_or("").trim().to_lowercase(),
        visible_text_norm.trim()
    );
    format!("ctx-{}", hash_title(&raw))
}

#[derive(Debug, Clone)]
struct NativeCaptureTrigger {
    kind: String,
    latency_ms: Option<i64>,
}

#[derive(Debug, Clone, Default)]
struct VisionUiFallbackResult {
    document_title: Option<String>,
    visible_text_raw: Option<String>,
    visible_text_norm: Option<String>,
    ui_elements_json: Option<String>,
    confidence: Option<f64>,
}

fn vision_fallback_env_set(name: &str) -> Vec<String> {
    env::var(name)
        .ok()
        .unwrap_or_default()
        .split(',')
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn app_allows_vision_fallback(app_bundle_id: &str, app_name: &str) -> bool {
    let bundle = app_bundle_id.to_ascii_lowercase();
    let app = app_name.to_ascii_lowercase();

    let denied = vision_fallback_env_set("RITUAL_VISION_FALLBACK_DENYLIST");
    if denied
        .iter()
        .any(|token| bundle.contains(token) || app.contains(token))
    {
        return false;
    }

    let allowed = vision_fallback_env_set("RITUAL_VISION_FALLBACK_ALLOWLIST");
    if !allowed.is_empty() {
        return allowed
            .iter()
            .any(|token| bundle.contains(token) || app.contains(token));
    }

    let known_ax_poor_shells = [
        "claude",
        "codex",
        "code",
        "cursor",
        "discord",
        "electron",
        "figma",
        "linear",
        "notion",
        "obsidian",
        "ritual",
        "slack",
        "todesktop",
    ];
    known_ax_poor_shells
        .iter()
        .any(|token| bundle.contains(token) || app.contains(token))
}

fn compose_vision_retrieval_text(result: &VisionUiFallbackResult) -> String {
    let mut parts = Vec::new();
    if let Some(value) = result.visible_text_raw.as_deref() {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            parts.push(trimmed.to_string());
        }
    }
    if let Some(title) = result.document_title.as_deref() {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            parts.push(format!("Document: {trimmed}"));
        }
    }
    parts.join(" | ")
}

fn merge_visible_text(primary: &str, secondary: &str) -> String {
    let primary_trimmed = primary.trim();
    let secondary_trimmed = secondary.trim();
    if primary_trimmed.is_empty() {
        return secondary_trimmed.to_string();
    }
    if secondary_trimmed.is_empty() {
        return primary_trimmed.to_string();
    }
    let primary_lower = primary_trimmed.to_ascii_lowercase();
    if primary_lower.contains(&secondary_trimmed.to_ascii_lowercase()) {
        primary_trimmed.to_string()
    } else {
        format!("{primary_trimmed} | {secondary_trimmed}")
    }
}

fn native_capture_trigger_kind_for_event(
    event: &WindowChangeEvent,
    delayed_follow_up: bool,
) -> String {
    let base = match event.change_type {
        window_observer::WindowChangeType::SelectedTextChanged => "ax_selected_text_changed",
        window_observer::WindowChangeType::ValueChanged => "ax_value_changed",
        window_observer::WindowChangeType::FocusedUIElementChanged => "ax_focus_changed",
        window_observer::WindowChangeType::MainWindowChanged => "ax_main_window_changed",
        window_observer::WindowChangeType::TitleChanged => "ax_title_changed",
    };
    if delayed_follow_up {
        format!("{base}_followup")
    } else {
        base.to_string()
    }
}

#[cfg(target_os = "macos")]
fn maybe_run_vision_ui_fallback(
    app_bundle_id: &str,
    app_name: &str,
    window_title: Option<&str>,
    window_bounds: Option<&macos::ActiveWindowBounds>,
    focused_text_info: &macos::FocusedTextInfo,
) -> Option<VisionUiFallbackResult> {
    if focused_text_info.is_sensitive || !app_allows_vision_fallback(app_bundle_id, app_name) {
        return None;
    }
    let vision_worthy = focused_text_info.ax_richness_score < 0.55
        || focused_text_info.ax_thinness_score >= 0.45
        || focused_text_info.quality_score < 0.65;
    if !vision_worthy {
        return None;
    }
    let now = now_ms();
    if vision_capture_backoff_active(now) {
        return None;
    }
    // Treat actual screencapture execution as the source of truth. On some
    // startup paths CGPreflightScreenCaptureAccess() can return a false
    // negative even though the watcher binary already has TCC approval.
    let screenshot_path = env::temp_dir().join(format!(
        "ritual-vision-fallback-{}-{}.png",
        std::process::id(),
        now
    ));
    let mut capture_command = std::process::Command::new("screencapture");
    capture_command.arg("-x");
    let capture_region = vision_capture_region(window_bounds);
    if let Some((x, y, width, height)) = capture_region {
        capture_command.arg(format!("-R{},{},{},{}", x, y, width, height));
    }
    capture_command.arg(screenshot_path.to_string_lossy().as_ref());
    let capture_output = capture_command.output().ok();
    let capture_output = match capture_output {
        Some(output) => output,
        None => {
            block_vision_capture(
                "failed to spawn screencapture for vision fallback",
                VISION_CAPTURE_FAILURE_COOLDOWN_MS,
            );
            return None;
        }
    };
    let stderr = String::from_utf8_lossy(&capture_output.stderr);
    if screen_capture_denied_reason(&stderr) {
        let reason = if stderr.trim().is_empty() {
            "screencapture reported denied screen capture access".to_string()
        } else {
            format!("screencapture denied access: {}", stderr.trim())
        };
        block_vision_capture(&reason, VISION_CAPTURE_DENIED_COOLDOWN_MS);
        cleanup_vision_debug_screenshot(&screenshot_path);
        return None;
    }
    if !capture_output.status.success() {
        let cooldown_ms = if screen_capture_denied_reason(&stderr) {
            VISION_CAPTURE_DENIED_COOLDOWN_MS
        } else {
            VISION_CAPTURE_FAILURE_COOLDOWN_MS
        };
        let reason = if stderr.trim().is_empty() {
            format!(
                "screencapture exited with status {}",
                capture_output.status
            )
        } else {
            format!("screencapture failed: {}", stderr.trim())
        };
        block_vision_capture(&reason, cooldown_ms);
        cleanup_vision_debug_screenshot(&screenshot_path);
        return None;
    }
    let screenshot_size = fs::metadata(&screenshot_path)
        .ok()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if screenshot_size == 0 {
        block_vision_capture(
            "screencapture returned no image data for vision fallback",
            VISION_CAPTURE_FAILURE_COOLDOWN_MS,
        );
        cleanup_vision_debug_screenshot(&screenshot_path);
        return None;
    }
    let output =
        vision_helper::run_vision_helper(&screenshot_path, app_bundle_id, app_name, window_title);
    let output = match output {
        Ok(output) => output,
        Err(err) => {
            let region_label = format_vision_capture_region(capture_region);
            let reason = format!(
                "vision helper failed for {} ({}) using {} capture {}: {}",
                app_name,
                app_bundle_id,
                region_label,
                screenshot_path.display(),
                err
            );
            block_vision_capture(&reason, VISION_CAPTURE_HELPER_FAILURE_COOLDOWN_MS);
            cleanup_vision_debug_screenshot(&screenshot_path);
            return None;
        }
    };
    cleanup_vision_debug_screenshot(&screenshot_path);
    unblock_vision_capture();
    let visible_text_raw = output.visible_text_raw.trim().to_string();
    let visible_text_norm = normalize_visible_text(&visible_text_raw);
    let ui_elements_json = elements_to_ui_elements_json(&output.elements);
    Some(VisionUiFallbackResult {
        document_title: window_title
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        visible_text_raw: (!visible_text_raw.is_empty()).then_some(visible_text_raw),
        visible_text_norm: (!visible_text_norm.is_empty()).then_some(visible_text_norm),
        ui_elements_json,
        confidence: output.overall_confidence,
    })
}

#[cfg(target_os = "macos")]
fn keep_vision_debug_screenshot() -> bool {
    env::var("RITUAL_VISION_DEBUG_KEEP_SCREENSHOT")
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn cleanup_vision_debug_screenshot(path: &Path) {
    if keep_vision_debug_screenshot() {
        debug!(
            "Keeping vision fallback screenshot for debugging: {}",
            path.display()
        );
        return;
    }
    let _ = fs::remove_file(path);
}

#[cfg(target_os = "macos")]
fn format_vision_capture_region(region: Option<(i32, i32, i32, i32)>) -> String {
    region
        .map(|(x, y, width, height)| format!("window-region [{x},{y} {width}x{height}]"))
        .unwrap_or_else(|| "full-screen".to_string())
}

#[cfg(target_os = "macos")]
fn vision_capture_region(
    window_bounds: Option<&macos::ActiveWindowBounds>,
) -> Option<(i32, i32, i32, i32)> {
    let bounds = window_bounds?;
    if bounds.width < 60.0 || bounds.height < 60.0 {
        return None;
    }

    let padding = 20.0;
    let x = (bounds.x - padding).floor().max(0.0) as i32;
    let y = (bounds.y - padding).floor().max(0.0) as i32;
    let right = (bounds.x + bounds.width + padding)
        .ceil()
        .max(x as f64 + 1.0);
    let bottom = (bounds.y + bounds.height + padding)
        .ceil()
        .max(y as f64 + 1.0);
    let width = (right - x as f64).round() as i32;
    let height = (bottom - y as f64).round() as i32;

    if width <= 1 || height <= 1 {
        None
    } else {
        Some((x, y, width, height))
    }
}

#[cfg(not(target_os = "macos"))]
fn maybe_run_vision_ui_fallback(
    _app_bundle_id: &str,
    _app_name: &str,
    _window_title: Option<&str>,
    _focused_text_info: &macos::FocusedTextInfo,
) -> Option<VisionUiFallbackResult> {
    None
}

#[cfg(target_os = "macos")]
fn derive_native_capture_trigger(
    active_pid: Option<i32>,
    now_ms: u64,
    recent_event: Option<&WindowChangeEvent>,
    delayed_follow_up: bool,
) -> NativeCaptureTrigger {
    if let (Some(pid), Some(event)) = (active_pid, recent_event) {
        if pid == event.pid {
            let latency = now_ms.saturating_sub(event.timestamp_ms) as i64;
            if latency <= 2_500 {
                return NativeCaptureTrigger {
                    kind: native_capture_trigger_kind_for_event(event, delayed_follow_up),
                    latency_ms: Some(latency),
                };
            }
        }
    }
    NativeCaptureTrigger {
        kind: "polling_idle".to_string(),
        latency_ms: None,
    }
}

#[cfg(not(target_os = "macos"))]
fn derive_native_capture_trigger(
    _active_pid: Option<i32>,
    _now_ms: u64,
    _recent_event: Option<&()>,
    _delayed_follow_up: bool,
) -> NativeCaptureTrigger {
    NativeCaptureTrigger {
        kind: "polling_idle".to_string(),
        latency_ms: None,
    }
}

#[allow(clippy::too_many_arguments)]
fn record_native_context_snapshot(
    db: &WatcherDatabase,
    config: &WatcherConfig,
    ts_ms: u64,
    activity_event_id: Option<i64>,
    app_bundle_id: &str,
    app_name: &str,
    window_title: Option<String>,
    #[cfg(target_os = "macos")] window_bounds: Option<macos::ActiveWindowBounds>,
    browser_url: Option<String>,
    browser_domain: Option<String>,
    document_title: Option<String>,
    focused_text_info: &macos::FocusedTextInfo,
    capture_trigger: &NativeCaptureTrigger,
) {
    let vision_fallback = maybe_run_vision_ui_fallback(
        app_bundle_id,
        app_name,
        window_title.as_deref(),
        window_bounds.as_ref(),
        focused_text_info,
    );
    let vision_text = vision_fallback
        .as_ref()
        .map(compose_vision_retrieval_text)
        .unwrap_or_default();
    let mut visible_text_raw = merge_visible_text(
        focused_text_info.text.as_deref().unwrap_or_default(),
        &vision_text,
    );
    let mut visible_text_norm = normalize_visible_text(&visible_text_raw);
    let base_source_type = if visible_text_norm.is_empty() {
        "window_metadata_fallback"
    } else {
        "macos_accessibility_deep"
    };
    let mut source_type = base_source_type;
    if vision_fallback.is_some() {
        source_type = if focused_text_info
            .text
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
        {
            "vision_ui_fallback"
        } else {
            "hybrid_native"
        };
    }
    if visible_text_norm.is_empty() && vision_fallback.is_some() {
        visible_text_raw = vision_text;
        visible_text_norm = normalize_visible_text(&visible_text_raw);
    }
    let dedup_key = build_context_dedup_key(
        ts_ms,
        source_type,
        app_bundle_id,
        browser_domain.as_deref(),
        window_title.as_deref(),
        document_title.as_deref(),
        &visible_text_norm,
    );

    let mut snapshot = RitualContextSnapshot::new(
        config.device_id.clone(),
        config.user_id.clone(),
        ts_ms as i64,
        source_type,
        app_bundle_id.to_string(),
        app_name.to_string(),
        dedup_key,
    );
    snapshot.activity_event_id = activity_event_id;
    snapshot.window_title = window_title;
    snapshot.browser_url = browser_url;
    snapshot.browser_domain = browser_domain;
    snapshot.document_title = document_title;
    snapshot.visible_text_raw = visible_text_raw;
    snapshot.visible_text_norm = visible_text_norm;
    snapshot.capture_quality = context_capture_quality(
        &snapshot.visible_text_norm,
        source_type,
        Some(focused_text_info.quality_score),
    );
    if !focused_text_info.capture_components.is_empty() {
        snapshot.capture_components_json =
            serde_json::to_string(&focused_text_info.capture_components).ok();
    }
    snapshot.ax_richness_score = focused_text_info.ax_richness_score;
    snapshot.selected_text_present = focused_text_info.selected_text_present;
    snapshot.document_path = focused_text_info.document_path.clone();
    snapshot.ax_source = focused_text_info.ax_source.clone();
    snapshot.capture_trigger = Some(
        if source_type == "window_metadata_fallback" && capture_trigger.kind == "polling_idle" {
            "idle_fallback".to_string()
        } else {
            capture_trigger.kind.clone()
        },
    );
    snapshot.trigger_to_snapshot_ms = capture_trigger.latency_ms;
    if let Some(result) = vision_fallback {
        if snapshot
            .document_title
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
        {
            snapshot.document_title = result.document_title;
        }
        snapshot.ui_elements_json = result.ui_elements_json;
        let mut components = focused_text_info.capture_components.clone();
        components.push("vision_ui_fallback".to_string());
        snapshot.capture_components_json = serde_json::to_string(&components).ok();
    }
    snapshot.is_sensitive_redacted = focused_text_info.is_sensitive;

    if let Err(err) = db.record_context_snapshot(&snapshot) {
        if !is_db_lock_error(&err) {
            debug!("Failed to persist native context snapshot: {}", err);
        }
    }
}
