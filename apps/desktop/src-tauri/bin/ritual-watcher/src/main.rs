//! Ritual Watcher - macOS Computer Activity Tracker
//!
//! A privacy-focused activity tracker that monitors:
//! - Active application (bundle ID, app name)
//! - Window titles (with privacy controls)
//! - Browser URLs and domains (with privacy controls)
//! - Browser tab changes (with dedicated polling)
//! - AFK (away from keyboard) detection
//! - Screen lock/unlock and sleep/wake events
//! - Session timing with heartbeat merging
//!
//! Inspired by ActivityWatch's open-source implementation and Cronus's native modules.

#![allow(dead_code)] // Some fields are kept for future use and debugging

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
    #[arg(short = 'i', long)]
    device_id: String,

    /// User ID
    #[arg(short, long)]
    user_id: String,

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
    if let Some((x, y, width, height)) = vision_capture_region(window_bounds) {
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
        let _ = fs::remove_file(&screenshot_path);
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
        let _ = fs::remove_file(&screenshot_path);
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
        let _ = fs::remove_file(&screenshot_path);
        return None;
    }
    let output =
        vision_helper::run_vision_helper(&screenshot_path, app_bundle_id, app_name, window_title);
    let _ = fs::remove_file(&screenshot_path);
    let output = match output {
        Some(output) => output,
        None => {
            block_vision_capture(
                "vision helper could not parse OCR output from the screenshot",
                VISION_CAPTURE_HELPER_FAILURE_COOLDOWN_MS,
            );
            return None;
        }
    };
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

fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("ritual_watcher=info".parse().unwrap()),
        )
        .init();

    #[cfg(target_os = "macos")]
    configure_process_as_background_agent();

    let args = Args::parse();

    info!("🚀 Ritual Watcher v2 starting...");
    info!("   Device ID: {}", args.device_id);
    info!("   Poll interval: {}ms", args.poll_interval);
    info!("   Title mode: {}", args.title_mode);
    info!("   URL mode: {}", args.url_mode);
    info!("   AFK timeout: {}s", args.afk_timeout);

    if let Some(pid) = args.ax_dump_pid {
        let active = get_active_window_info().ok().flatten();
        let bundle_id = active
            .as_ref()
            .and_then(|info| (info.pid == Some(pid)).then_some(info.bundle_id.as_str()));
        let window_title = active
            .as_ref()
            .and_then(|info| (info.pid == Some(pid)).then_some(info.window_title.as_deref()))
            .flatten();

        match dump_accessibility_context(
            pid,
            bundle_id,
            window_title,
            args.ax_dump_depth,
            args.ax_dump_max_children,
        ) {
            Ok(dump) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&dump).unwrap_or_else(|_| "{}".to_string())
                );
                return;
            }
            Err(err) => {
                error!("AX dump failed for pid {}: {}", pid, err);
                std::process::exit(1);
            }
        }
    }

    // Parse configuration
    let config = WatcherConfig {
        database_path: shellexpand::tilde(&args.database).to_string(),
        device_id: args.device_id.clone(),
        user_id: args.user_id.clone(),
        poll_interval_ms: args.poll_interval,
        title_mode: match args.title_mode.as_str() {
            "full" => TitleMode::Full,
            "truncate" => TitleMode::Truncate,
            "hash" => TitleMode::Hash,
            _ => TitleMode::Off,
        },
        truncate_length: args.truncate_length,
        excluded_bundle_ids: args
            .excluded
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.trim().to_string())
            .collect(),
        afk_timeout_seconds: args.afk_timeout as f64,
        url_mode: match args.url_mode.as_str() {
            "full" => UrlMode::Full,
            "off" => UrlMode::Off,
            _ => UrlMode::DomainOnly,
        },
        track_incognito: args.track_incognito,
        browser_heartbeat_port: args.browser_heartbeat_port,
        pulsetime_seconds: (args.poll_interval as f64 / 1000.0) + 1.0,
    };

    // Initialize activity database (watcher events + sync queue).
    let db = match WatcherDatabase::new(&config.database_path) {
        Ok(db) => {
            info!("✅ Activity database connected: {}", config.database_path);
            db
        }
        Err(e) => {
            error!("❌ Failed to connect to activity database: {}", e);
            std::process::exit(1);
        }
    };

    // Initialize memory database (OCR frames + chunks + embeddings pipeline).
    let memory_database_path = derive_memory_db_path(&config.database_path);
    let memory_db = match WatcherDatabase::new(&memory_database_path) {
        Ok(db) => {
            info!("✅ Memory database connected: {}", memory_database_path);
            db
        }
        Err(e) => {
            error!(
                "❌ Failed to connect to memory database {}: {}",
                memory_database_path, e
            );
            std::process::exit(1);
        }
    };

    // Set up signal handling for graceful shutdown
    let running = Arc::new(AtomicBool::new(true));
    let r = running.clone();

    ctrlc::set_handler(move || {
        info!("🛑 Shutdown signal received, stopping watcher...");
        r.store(false, Ordering::SeqCst);
    })
    .expect("Error setting Ctrl-C handler");

    let browser_extension_last_seen = Arc::new(AtomicU64::new(0));

    // Main polling loop
    run_watcher_loop(
        &config,
        &db,
        &memory_db,
        &memory_database_path,
        running,
        browser_extension_last_seen,
    );

    info!("👋 Ritual Watcher stopped");
}

#[cfg(target_os = "macos")]
fn configure_process_as_background_agent() {
    let policy_mode = env::var("RITUAL_WATCHER_ACTIVATION_POLICY")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "accessory".to_string());

    if matches!(
        policy_mode.as_str(),
        "off" | "disabled" | "none" | "0" | "false" | "no"
    ) {
        info!("ℹ️ Watcher background-only activation policy disabled");
        return;
    }

    let (policy, policy_label) = match policy_mode.as_str() {
        "prohibited" => (NSApplicationActivationPolicy::Prohibited, "background-only"),
        _ => (
            NSApplicationActivationPolicy::Accessory,
            "accessory background",
        ),
    };

    // The watcher uses AppKit APIs for NSWorkspace notifications and run loop
    // pumping, but it should behave like a background helper and never claim its
    // own Dock icon.
    unsafe {
        let app: *mut AnyObject = objc2::msg_send![objc2::class!(NSApplication), sharedApplication];
        if app.is_null() {
            warn!("⚠️ NSApplication sharedApplication returned null for watcher background mode");
            return;
        }

        let changed: bool = objc2::msg_send![
            app,
            setActivationPolicy: policy
        ];
        if !changed {
            warn!(
                "⚠️ Failed to set watcher activation policy to {}",
                policy_label
            );
        } else {
            info!("✅ Watcher activation policy set to {}", policy_label);
        }
    }
}

/// Pump the main thread's run loop for the given duration instead of sleeping.
/// This allows macOS system events (like NSWorkspace app activation notifications)
/// to be processed, keeping NSWorkspace.frontmostApplication() up to date.
/// Without this, a command-line process gets stale data from frontmostApplication().
#[cfg(target_os = "macos")]
fn pump_run_loop(duration: Duration) {
    use core_foundation_sys::runloop::{kCFRunLoopDefaultMode, CFRunLoopRunInMode};
    unsafe {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, duration.as_secs_f64(), 1);
    }
}

#[cfg(not(target_os = "macos"))]
fn pump_run_loop(duration: Duration) {
    std::thread::sleep(duration);
}

fn decide_session_action(
    current_session: Option<&CurrentSession>,
    new_signature: &ActivitySignature,
    afk_boundary_crossed: bool,
    now: u64,
    hard_gap_ms: u64,
    pulsetime_ms: u64,
    commit_interval_ms: u64,
    last_commit_time: u64,
) -> (SessionAction, Option<SessionCloseReason>) {
    match current_session {
        Some(session) => {
            if afk_boundary_crossed {
                (
                    SessionAction::Close,
                    Some(SessionCloseReason::AfkStateChanged),
                )
            } else if now.saturating_sub(session.last_seen_ts) > hard_gap_ms {
                (SessionAction::Close, Some(SessionCloseReason::HardGap))
            } else if session.signature != *new_signature {
                (
                    SessionAction::Close,
                    Some(SessionCloseReason::SignatureChanged),
                )
            } else {
                let within_pulsetime = now.saturating_sub(session.last_seen_ts) <= pulsetime_ms;
                if within_pulsetime {
                    let session_duration = now.saturating_sub(session.start_time);
                    let should_commit = session_duration > commit_interval_ms
                        && now.saturating_sub(last_commit_time) > commit_interval_ms;
                    (SessionAction::Merge { should_commit }, None)
                } else {
                    (SessionAction::Close, Some(SessionCloseReason::HardGap))
                }
            }
        }
        None => (SessionAction::CreateNew, None),
    }
}

fn scheduled_pump_duration(
    default_duration: Duration,
    now_ms: u64,
    follow_up_deadline_ms: Option<u64>,
) -> Duration {
    let mut duration = default_duration;
    if let Some(deadline_ms) = follow_up_deadline_ms {
        if deadline_ms <= now_ms {
            return Duration::from_millis(25);
        }
        let until_deadline = Duration::from_millis(deadline_ms.saturating_sub(now_ms));
        duration = duration.min(until_deadline);
    }
    duration
}

fn storage_title_fields(
    mode: &TitleMode,
    truncate_length: usize,
    window_title: Option<&String>,
) -> (Option<String>, Option<String>) {
    match mode {
        TitleMode::Off => (None, None),
        TitleMode::Full => (window_title.cloned(), None),
        TitleMode::Truncate => (
            window_title.map(|t| truncate_title(t, truncate_length)),
            None,
        ),
        TitleMode::Hash => (None, window_title.map(|t| hash_title(t))),
    }
}

fn env_flag(name: &str) -> Option<bool> {
    match env::var(name).ok()?.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn macos_feature_enabled(enable_var: &str, disable_var: &str) -> bool {
    if let Some(disabled) = env_flag(disable_var) {
        return !disabled;
    }
    env_flag(enable_var).unwrap_or(true)
}

#[cfg(target_os = "macos")]
fn event_driven_app_switch_enabled() -> bool {
    macos_feature_enabled(
        "RITUAL_ENABLE_APP_SWITCH_NOTIFICATIONS",
        "RITUAL_DISABLE_APP_SWITCH_NOTIFICATIONS",
    )
}

#[cfg(not(target_os = "macos"))]
fn event_driven_app_switch_enabled() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn screen_event_detection_enabled() -> bool {
    macos_feature_enabled(
        "RITUAL_ENABLE_SCREEN_EVENT_NOTIFICATIONS",
        "RITUAL_DISABLE_SCREEN_EVENT_NOTIFICATIONS",
    )
}

#[cfg(not(target_os = "macos"))]
fn screen_event_detection_enabled() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn browser_tab_tracker_enabled() -> bool {
    matches!(
        env::var("RITUAL_ENABLE_BROWSER_TAB_TRACKER")
            .ok()
            .as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

#[cfg(not(target_os = "macos"))]
fn browser_tab_tracker_enabled() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn window_title_observer_enabled() -> bool {
    macos_feature_enabled(
        "RITUAL_ENABLE_WINDOW_TITLE_OBSERVER",
        "RITUAL_DISABLE_WINDOW_TITLE_OBSERVER",
    )
}

#[cfg(not(target_os = "macos"))]
fn window_title_observer_enabled() -> bool {
    false
}

fn deep_accessibility_capture_enabled() -> bool {
    matches!(
        env::var("RITUAL_ENABLE_DEEP_ACCESSIBILITY_CAPTURE")
            .ok()
            .as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

fn deep_accessibility_capture_disabled() -> bool {
    matches!(
        env::var("RITUAL_DISABLE_DEEP_ACCESSIBILITY_CAPTURE")
            .ok()
            .as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

fn deep_accessibility_high_risk_app_shell(bundle_id: &str, app_name: &str) -> bool {
    let bundle = bundle_id.to_ascii_lowercase();
    let name = app_name.to_ascii_lowercase();

    name == "ritual"
        || name == "codex"
        || name == "cursor"
        || name == "claude"
        || bundle == "com.ritual.desktop"
        || bundle.contains("codex")
        || bundle.contains("claude")
        || bundle.contains("cursor")
        || bundle.contains("slack")
        || bundle.contains("notion")
        || bundle.contains("todesktop")
}

fn deep_accessibility_capture_enabled_for_app(bundle_id: &str, app_name: &str) -> bool {
    if deep_accessibility_capture_disabled() {
        return false;
    }
    if deep_accessibility_capture_enabled() {
        return true;
    }

    if deep_accessibility_high_risk_app_shell(bundle_id, app_name) {
        return false;
    }

    !is_browser(bundle_id)
}

fn ensure_session_event_persisted(
    session: &mut CurrentSession,
    config: &WatcherConfig,
    db: &WatcherDatabase,
    sync_queue: &Option<SyncQueue>,
    now: u64,
    main_db_lock_errors: &mut u64,
    context: &str,
) -> bool {
    if session.event_id.is_some() {
        return true;
    }

    let (stored_title, stored_hash) = storage_title_fields(
        &config.title_mode,
        config.truncate_length,
        session.window_title.as_ref(),
    );

    match db.insert_activity_event(
        &config.device_id,
        &config.user_id,
        session.start_time.min(now),
        now,
        &session.signature.bundle_id,
        &session.app_name,
        stored_title.as_deref(),
        stored_hash.as_deref(),
        session.pid,
        session.signature.is_afk,
        session.browser_url.as_deref(),
        session.browser_domain.as_deref(),
        session.is_incognito,
    ) {
        Ok(id) => {
            session.event_id = Some(id);
            if context == "create_new" {
                info!("Started tracking: {} (event {})", session.app_name, id);
            } else if context == "close_then_create" {
                debug!("Created new session {} for {}", id, session.app_name);
            } else {
                debug!(
                    "Recovered deferred session write: {} (event {}, context={})",
                    session.app_name, id, context
                );
            }
            if let Some(ref sq) = sync_queue {
                if let Err(e) = sq.queue_activity_sync(id) {
                    debug!("Failed to queue recovered session for sync: {}", e);
                }
            }
            true
        }
        Err(e) => {
            if is_db_lock_error(&e) {
                *main_db_lock_errors = main_db_lock_errors.saturating_add(1);
                debug!(
                    "Deferring session create due to lock contention: app={}, context={}",
                    session.app_name, context
                );
            } else {
                warn!(
                    "Failed to persist session activity (context={}, app={}): {}",
                    context, session.app_name, e
                );
            }
            false
        }
    }
}

fn close_session_with_lock_fallback(
    session: &mut CurrentSession,
    config: &WatcherConfig,
    db: &WatcherDatabase,
    sync_queue: &Option<SyncQueue>,
    now: u64,
    reason: SessionCloseReason,
    main_db_lock_errors: &mut u64,
    pending_main_end_update: &mut Option<(i64, u64)>,
    last_main_session_end_update_ms: &mut u64,
) {
    if session.event_id.is_none() {
        let _ = ensure_session_event_persisted(
            session,
            config,
            db,
            sync_queue,
            now,
            main_db_lock_errors,
            "close_before_drop",
        );
    }

    if let Some(event_id) = session.event_id {
        debug!(
            "Closing session {} ({}): {} [{:.1}s]",
            event_id,
            session.app_name,
            reason,
            (now - session.start_time) as f64 / 1000.0
        );
        if let Err(e) = db.update_event_end_time(event_id, now) {
            if is_db_lock_error(&e) {
                debug!(
                    "Deferring close for event {} due to lock contention; will retry",
                    event_id
                );
                *pending_main_end_update = Some((event_id, now));
            } else {
                error!("Failed to close event: {}", e);
            }
        } else {
            *last_main_session_end_update_ms = now;
            *pending_main_end_update = None;
        }
        if let Some(ref sq) = sync_queue {
            if let Err(e) = sq.queue_activity_sync(event_id) {
                debug!("Failed to queue for sync: {}", e);
            }
        }
    } else {
        debug!(
            "Dropping session without persisted event due to ongoing lock contention: {}",
            session.app_name
        );
    }
}

fn run_watcher_loop(
    config: &WatcherConfig,
    db: &WatcherDatabase,
    memory_db: &WatcherDatabase,
    memory_database_path: &str,
    running: Arc<AtomicBool>,
    browser_extension_last_seen: Arc<AtomicU64>,
) {
    let poll_interval = Duration::from_millis(config.poll_interval_ms);
    let excluded: HashSet<String> = config.excluded_bundle_ids.iter().cloned().collect();

    // On macOS, pump the main thread's run loop instead of sleeping.
    // This is critical: without a running run loop, NSWorkspace.frontmostApplication()
    // returns stale/cached data because system events that update workspace state
    // (like app activations) are never delivered to this process.
    info!("✅ Using run loop pumping for accurate app detection");
    let pulsetime_ms = (config.pulsetime_seconds * 1000.0) as u64;

    // Hard gap threshold: if time since last heartbeat exceeds this, always close the event
    // This catches sleep, lock screen, CPU hangs, etc.
    let hard_gap_ms: u64 = 60_000; // 60 seconds

    // Commit interval: how often to consider committing long-running events
    // This prevents a single event from growing indefinitely
    let commit_interval_ms: u64 = 30_000; // 30 seconds - commit long sessions periodically

    // Sleep/wake detection threshold: if wall clock jumped forward significantly
    let sleep_wake_threshold_ms: u64 = 5 * 60 * 1000; // 5 minutes
                                                      // If extension heartbeats are recent, use extension as browser source-of-truth.
    let browser_extension_recent_ms: u64 = 90_000; // 90 seconds

    let mut current_session: Option<CurrentSession> = None;
    let mut afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
    let mut last_commit_time = now_ms();
    let mut last_poll_time = now_ms();
    let mut was_afk = false; // Track AFK state for boundary detection
    let mut last_notified_bundle: Option<String> = None; // Track last notification to avoid duplicates
    let mut loop_iteration: u64 = 0; // Track loop iterations for diagnostics
    let mut last_status_log = now_ms(); // Periodic status logging
    let mut last_main_session_end_update_ms: u64 = 0;
    let coalesce_end_update_ms: u64 = 2_000;
    let heartbeat_write_interval_ms: u64 = 15_000;
    let mut last_heartbeat_write_ms: u64 = 0;
    let mut heartbeat_write_pending = false;
    let mut pending_main_end_update: Option<(i64, u64)> = None;
    let mut pending_main_end_retry_not_before_ms: u64 = 0;
    let mut pending_main_end_retry_delay_ms: u64 = 250;
    let mut main_db_lock_errors: u64 = 0;
    let mut spool_ingested_total: u64 = 0;
    let mut spool_invalid_total: u64 = 0;
    let mut browser_server_started = false;
    let mut _browser_server_handle: Option<std::thread::JoinHandle<()>> = None;
    let (browser_db_tx, browser_db_rx): (Sender<BrowserDbCommand>, Receiver<BrowserDbCommand>) =
        mpsc::channel();
    let spool_dir = recorder_spool_dir(memory_database_path);
    if let Err(err) = fs::create_dir_all(&spool_dir) {
        warn!(
            "Failed to ensure recorder spool dir {}: {}",
            spool_dir.display(),
            err
        );
    } else {
        info!("📥 Recorder spool ingest enabled: {}", spool_dir.display());
    }

    // Initialize sync queue for backend reliability (with runtime retry if startup is locked).
    let mut sync_queue = match SyncQueue::new(&config.database_path) {
        Ok(sq) => {
            info!("✅ Sync queue initialized");
            Some(sq)
        }
        Err(e) => {
            warn!(
                "⚠️ Could not initialize sync queue at startup: {} - will retry in background",
                e
            );
            None
        }
    };
    let mut sync_queue_retry_not_before_ms: u64 = 0;
    let mut sync_queue_retry_delay_ms: u64 = 1_000;

    // Initialize event-driven notification listener (macOS)
    // This provides immediate app switch detection instead of waiting for next poll
    #[cfg(target_os = "macos")]
    let notification_listener = if event_driven_app_switch_enabled() {
        use notifications::NotificationListener;
        Some(NotificationListener::new())
    } else {
        info!("ℹ️ Event-driven app switch detection disabled; using polling only");
        None
    };
    #[cfg(not(target_os = "macos"))]
    let notification_listener: Option<()> = None;

    // Initialize screen event listener for lock/unlock and sleep/wake detection
    #[cfg(target_os = "macos")]
    let screen_event_listener = if screen_event_detection_enabled() {
        Some(ScreenEventListener::new())
    } else {
        info!("ℹ️ Screen event detection disabled");
        None
    };
    #[cfg(not(target_os = "macos"))]
    let screen_event_listener: Option<()> = None;

    // Initialize browser tab tracker (polls every 10 seconds)
    #[cfg(target_os = "macos")]
    let browser_tab_tracker = if browser_tab_tracker_enabled() {
        Some(BrowserTabTracker::new(10))
    } else {
        info!("ℹ️ Browser tab tracker disabled");
        None
    };
    #[cfg(not(target_os = "macos"))]
    let browser_tab_tracker: Option<()> = None;

    // Initialize window change listener for title changes within same app
    #[cfg(target_os = "macos")]
    let window_change_listener = if window_title_observer_enabled() {
        Some(WindowChangeListener::new())
    } else {
        info!("ℹ️ Window title observer disabled");
        None
    };
    #[cfg(not(target_os = "macos"))]
    let window_change_listener: Option<()> = None;
    #[cfg(target_os = "macos")]
    let mut last_window_change_event: Option<WindowChangeEvent> = None;
    #[cfg(target_os = "macos")]
    let mut pending_follow_up_capture_ms: Option<u64> = None;
    #[cfg(target_os = "macos")]
    let mut recent_window_event_debounce_ms: HashMap<String, u64> = HashMap::new();

    // Track screen lock state
    let mut is_screen_locked = false;

    info!("📡 Starting activity monitoring with heartbeat merging...");
    info!("   Pulsetime: {:.1}s", config.pulsetime_seconds);
    info!("   Hard gap threshold: {:.0}s", hard_gap_ms as f64 / 1000.0);
    info!(
        "   Commit interval: {:.0}s",
        commit_interval_ms as f64 / 1000.0
    );
    info!("   AFK timeout: {:.0}s", config.afk_timeout_seconds);
    #[cfg(target_os = "macos")]
    {
        info!(
            "   Event-driven detection: {}",
            if event_driven_app_switch_enabled() {
                "enabled"
            } else {
                "disabled (polling only)"
            }
        );
        info!(
            "   Screen lock detection: {}",
            if screen_event_detection_enabled() {
                "enabled"
            } else {
                "disabled"
            }
        );
        info!(
            "   Browser tab polling: {}",
            if browser_tab_tracker_enabled() {
                "10s interval"
            } else {
                "disabled"
            }
        );
        info!(
            "   Window title observer: {}",
            if window_title_observer_enabled() && WindowChangeListener::has_permission() {
                "enabled"
            } else if window_title_observer_enabled() {
                "disabled (no AX permission)"
            } else {
                "disabled"
            }
        );
        info!(
            "   Deep accessibility capture: {}",
            if deep_accessibility_capture_disabled() {
                "disabled"
            } else if deep_accessibility_capture_enabled() {
                "enabled"
            } else {
                "enabled (non-browser apps, excluding high-risk app shells)"
            }
        );
    }

    let stale_browser_cutoff_ms = now_ms().saturating_sub(90_000);
    let browser_duplicate_lookback_ms = now_ms().saturating_sub(14 * 24 * 60 * 60 * 1000);
    match db.clamp_stale_browser_extension_events(
        &config.device_id,
        stale_browser_cutoff_ms,
        15 * 60 * 1000,
    ) {
        Ok(repaired) if repaired > 0 => {
            info!(
                "🧹 Repaired {} stale browser-extension activity rows on startup",
                repaired
            );
        }
        Ok(_) => {}
        Err(err) => warn!("Failed stale browser session repair on startup: {}", err),
    }
    match db
        .delete_duplicate_browser_extension_events(&config.device_id, browser_duplicate_lookback_ms)
    {
        Ok(deleted) if deleted > 0 => {
            info!(
                "🧹 Removed {} duplicate browser-extension activity rows on startup",
                deleted
            );
        }
        Ok(_) => {}
        Err(err) => warn!(
            "Failed duplicate browser session cleanup on startup: {}",
            err
        ),
    }

    while running.load(Ordering::SeqCst) {
        let loop_now = now_ms();
        if sync_queue.is_none() && loop_now >= sync_queue_retry_not_before_ms {
            match SyncQueue::new(&config.database_path) {
                Ok(sq) => {
                    info!("✅ Sync queue initialized (retry)");
                    sync_queue = Some(sq);
                    sync_queue_retry_not_before_ms = 0;
                    sync_queue_retry_delay_ms = 1_000;
                }
                Err(e) => {
                    if is_db_lock_error(&e) {
                        debug!(
                            "Sync queue init lock contention; retrying in {}ms",
                            sync_queue_retry_delay_ms
                        );
                    } else {
                        warn!(
                            "Sync queue init retry failed: {} (retry in {}ms)",
                            e, sync_queue_retry_delay_ms
                        );
                    }
                    sync_queue_retry_not_before_ms =
                        loop_now.saturating_add(sync_queue_retry_delay_ms);
                    sync_queue_retry_delay_ms =
                        (sync_queue_retry_delay_ms.saturating_mul(2)).min(30_000);
                }
            }
        }

        process_browser_db_commands(db, &sync_queue, &browser_db_rx);
        let (spool_ingested, spool_invalid) =
            drain_recorder_spool(memory_db, &spool_dir, RECORDER_SPOOL_MAX_FILES_PER_TICK);
        spool_ingested_total = spool_ingested_total.saturating_add(spool_ingested as u64);
        spool_invalid_total = spool_invalid_total.saturating_add(spool_invalid as u64);

        let now = now_ms();
        if let Some((event_id, ts_end)) = pending_main_end_update {
            if now >= pending_main_end_retry_not_before_ms {
                match db.update_event_end_time(event_id, ts_end) {
                    Ok(()) => {
                        pending_main_end_update = None;
                        last_main_session_end_update_ms = now;
                        pending_main_end_retry_delay_ms = 250;
                        pending_main_end_retry_not_before_ms = 0;
                    }
                    Err(e) => {
                        if is_db_lock_error(&e) {
                            main_db_lock_errors = main_db_lock_errors.saturating_add(1);
                            pending_main_end_retry_not_before_ms =
                                now.saturating_add(pending_main_end_retry_delay_ms);
                            pending_main_end_retry_delay_ms =
                                (pending_main_end_retry_delay_ms.saturating_mul(2)).min(4_000);
                        } else {
                            warn!(
                                "Pending end-time update for event {} failed: {}",
                                event_id, e
                            );
                            pending_main_end_update = None;
                            pending_main_end_retry_delay_ms = 250;
                            pending_main_end_retry_not_before_ms = 0;
                        }
                    }
                }
            }
        }

        let browser_extension_active = now
            .saturating_sub(browser_extension_last_seen.load(Ordering::Relaxed))
            <= browser_extension_recent_ms;

        // ===== EVENT-DRIVEN APP SWITCH DETECTION =====
        // Check for notification events first - these indicate immediate app switches
        // This is much more responsive than waiting for the next poll cycle
        #[cfg(target_os = "macos")]
        let _notification_triggered = {
            let mut triggered = false;
            if let Some(ref listener) = notification_listener {
                // Drain all pending notifications
                let events = listener.drain();
                for event in events {
                    // Only process if this is a different app than we last saw via notification
                    // This prevents duplicate processing when both notification and poll fire
                    if last_notified_bundle.as_ref() != Some(&event.bundle_id) {
                        debug!(
                            "🔔 Processing notification: {} at {}ms",
                            event.app_name, event.timestamp_ms
                        );
                        last_notified_bundle = Some(event.bundle_id.clone());
                        triggered = true;
                    }
                }
            }
            triggered
        };
        #[cfg(not(target_os = "macos"))]
        let _notification_triggered = false;

        // ===== SCREEN LOCK/UNLOCK AND SLEEP/WAKE EVENTS =====
        #[cfg(target_os = "macos")]
        {
            if let Some(ref listener) = screen_event_listener {
                for event in listener.drain() {
                    match event.event_type {
                        ScreenEventType::ScreenLocked => {
                            info!("🔒 Screen locked - closing current session");
                            is_screen_locked = true;
                            if let Some(ref mut session) = current_session {
                                close_session_with_lock_fallback(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    event.timestamp_ms,
                                    SessionCloseReason::ScreenLocked,
                                    &mut main_db_lock_errors,
                                    &mut pending_main_end_update,
                                    &mut last_main_session_end_update_ms,
                                );
                            }
                            current_session = None;
                        }
                        ScreenEventType::ScreenUnlocked => {
                            info!("🔓 Screen unlocked");
                            is_screen_locked = false;
                            // Reset AFK state after unlock
                            afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
                            was_afk = false;
                        }
                        ScreenEventType::WillSleep => {
                            info!("💤 System going to sleep - closing current session");
                            if let Some(ref mut session) = current_session {
                                close_session_with_lock_fallback(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    event.timestamp_ms,
                                    SessionCloseReason::SleepWake,
                                    &mut main_db_lock_errors,
                                    &mut pending_main_end_update,
                                    &mut last_main_session_end_update_ms,
                                );
                            }
                            current_session = None;
                        }
                        ScreenEventType::DidWake => {
                            info!("⏰ System woke from sleep");
                            // Reset AFK state after wake
                            afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
                            was_afk = false;
                            last_notified_bundle = None;
                        }
                    }
                }
            }
        }

        // ===== BROWSER TAB CHANGE EVENTS =====
        // Process tab changes detected by the background browser tracker
        // Store pending tab events for processing after AFK detection
        #[cfg(target_os = "macos")]
        let pending_tab_events: Vec<_> = {
            if let Some(ref tracker) = browser_tab_tracker {
                tracker.drain()
            } else {
                Vec::new()
            }
        };
        #[cfg(not(target_os = "macos"))]
        let pending_tab_events: Vec<()> = Vec::new();

        // ===== WINDOW TITLE CHANGE EVENTS =====
        #[cfg(target_os = "macos")]
        {
            if let Some(ref listener) = window_change_listener {
                for event in listener.drain() {
                    if !is_screen_locked {
                        let event_key = format!(
                            "{}:{}:{}",
                            event.pid,
                            event.change_type,
                            event.title.as_deref().unwrap_or("")
                        );
                        let should_process = recent_window_event_debounce_ms
                            .get(&event_key)
                            .map(|previous| event.timestamp_ms.saturating_sub(*previous) >= 300)
                            .unwrap_or(true);
                        if !should_process {
                            continue;
                        }
                        recent_window_event_debounce_ms.insert(event_key, event.timestamp_ms);
                        recent_window_event_debounce_ms
                            .retain(|_, ts| event.timestamp_ms.saturating_sub(*ts) <= 30_000);
                        last_window_change_event = Some(event.clone());
                        if matches!(
                            event.change_type,
                            window_observer::WindowChangeType::FocusedUIElementChanged
                                | window_observer::WindowChangeType::SelectedTextChanged
                                | window_observer::WindowChangeType::ValueChanged
                                | window_observer::WindowChangeType::MainWindowChanged
                        ) {
                            pending_follow_up_capture_ms =
                                Some(event.timestamp_ms.saturating_add(350));
                        }
                        debug!(
                            "🪟 Window change detected: PID {} - {:?} ({})",
                            event.pid,
                            event.title.as_ref().map(|s| if s.len() > 40 {
                                format!("{}...", &s[..40])
                            } else {
                                s.clone()
                            }),
                            event.change_type
                        );
                        // Window title changes are captured but we don't force session close
                        // The signature comparison in the main logic will handle this
                    }
                }
            }
        }

        // ===== SLEEP/WAKE DETECTION (FALLBACK) =====
        // If wall clock jumped forward significantly, we likely woke from sleep
        // This is a fallback for cases where the explicit notifications didn't fire
        let time_since_last_poll = now.saturating_sub(last_poll_time);
        if time_since_last_poll > sleep_wake_threshold_ms {
            info!(
                "⏰ Sleep/wake detected via gap: {:.1}s",
                time_since_last_poll as f64 / 1000.0
            );
            // Close current session at the last known time
            if let Some(ref mut session) = current_session {
                close_session_with_lock_fallback(
                    session,
                    config,
                    db,
                    &sync_queue,
                    last_poll_time,
                    SessionCloseReason::SleepWake,
                    &mut main_db_lock_errors,
                    &mut pending_main_end_update,
                    &mut last_main_session_end_update_ms,
                );
                current_session = None;
            }
            // Reset AFK state after wake
            afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
            was_afk = false;
            last_notified_bundle = None;
        }
        last_poll_time = now;

        // ===== SKIP PROCESSING IF SCREEN IS LOCKED =====
        if is_screen_locked {
            #[cfg(target_os = "macos")]
            let sleep_duration =
                scheduled_pump_duration(poll_interval, now, pending_follow_up_capture_ms);
            #[cfg(not(target_os = "macos"))]
            let sleep_duration = poll_interval;
            pump_run_loop(sleep_duration);
            continue;
        }

        // ===== AFK DETECTION =====
        let (afk_state, afk_changed, seconds_idle) = afk_watcher.check(now);
        let is_afk = afk_state == AfkState::Afk;

        // Record AFK state changes to afk_events table
        if afk_changed {
            let status = if is_afk { "afk" } else { "not-afk" };
            if let Err(e) =
                db.upsert_afk_event(&config.device_id, &config.user_id, now, now, status)
            {
                error!("Failed to record AFK event: {}", e);
            }
        }

        // ===== AFK BOUNDARY SPLITTING =====
        // When AFK state changes, force close current session and start fresh
        // This creates clean boundaries between "active" and "afk" time
        let afk_boundary_crossed = was_afk != is_afk;
        was_afk = is_afk;

        // ===== PROCESS PENDING BROWSER TAB EVENTS =====
        #[cfg(target_os = "macos")]
        {
            for tab_event in pending_tab_events {
                if !is_screen_locked && !is_afk {
                    debug!(
                        "🌐 Browser tab change: {} -> {:?} (domain: {:?})",
                        tab_event.bundle_id,
                        tab_event.url.as_ref().map(|s| if s.len() > 50 {
                            format!("{}...", &s[..50])
                        } else {
                            s.clone()
                        }),
                        tab_event.domain
                    );

                    // If we have a current session for this browser, check if domain changed
                    if let Some(ref mut session) = current_session {
                        if session.signature.bundle_id == tab_event.bundle_id {
                            // Same browser - check if domain changed (significant change)
                            let domain_changed = session.browser_domain != tab_event.domain;
                            if domain_changed {
                                // Close current session - the next poll will create a new one with updated info
                                close_session_with_lock_fallback(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    tab_event.timestamp_ms,
                                    SessionCloseReason::BrowserTabChanged,
                                    &mut main_db_lock_errors,
                                    &mut pending_main_end_update,
                                    &mut last_main_session_end_update_ms,
                                );
                                current_session = None;
                            }
                        }
                    }
                }
            }
        }

        // ===== APP SWITCH SETTLING DELAY =====
        // After an app switch notification, wait 100ms before querying window info.
        // This gives macOS time to fully update the window list and focus state,
        // preventing stale window titles from being attributed to the new app.
        #[cfg(target_os = "macos")]
        if _notification_triggered {
            std::thread::sleep(Duration::from_millis(100));
        }

        // ===== GET ACTIVE WINDOW INFO =====
        match get_active_window_info() {
            Ok(Some(info)) => {
                debug!(
                    "Active: {} ({}) - {:?} [AFK: {}, idle: {:.1}s]",
                    info.app_name, info.bundle_id, info.window_title, is_afk, seconds_idle
                );

                // Avoid duplicate browser accounting: if extension heartbeats are active,
                // let the extension own browser sessions and skip native browser polling.
                if browser_extension_active && is_browser(&info.bundle_id) {
                    debug!(
                        "Skipping native browser tracking for {} (extension active)",
                        info.bundle_id
                    );
                    if let Some(ref mut session) = current_session {
                        close_session_with_lock_fallback(
                            session,
                            config,
                            db,
                            &sync_queue,
                            now,
                            SessionCloseReason::BrowserExtensionActive,
                            &mut main_db_lock_errors,
                            &mut pending_main_end_update,
                            &mut last_main_session_end_update_ms,
                        );
                    }
                    current_session = None;
                    #[cfg(target_os = "macos")]
                    {
                        if browser_tab_tracker_enabled() {
                            set_active_browser(None);
                        }
                    }
                    #[cfg(target_os = "macos")]
                    let sleep_duration =
                        scheduled_pump_duration(poll_interval, now, pending_follow_up_capture_ms);
                    #[cfg(not(target_os = "macos"))]
                    let sleep_duration = poll_interval;
                    pump_run_loop(sleep_duration);
                    continue;
                }

                // ===== UPDATE BROWSER TRACKER =====
                // Notify the browser tracker which app is active so it knows when to poll
                #[cfg(target_os = "macos")]
                {
                    if browser_tab_tracker_enabled() {
                        set_active_browser(Some(info.bundle_id.clone()));
                    }
                }

                // ===== UPDATE WINDOW OBSERVER =====
                // Set up AX observer for this app's window title changes
                #[cfg(target_os = "macos")]
                {
                    if window_title_observer_enabled() {
                        if let Some(pid) = info.pid {
                            observe_app(pid);
                        }
                    }
                }

                // ===== EXCLUDED APP CHECK =====
                if excluded.contains(&info.bundle_id) {
                    debug!("Skipping excluded app: {}", info.bundle_id);
                    if let Some(ref mut session) = current_session {
                        close_session_with_lock_fallback(
                            session,
                            config,
                            db,
                            &sync_queue,
                            now,
                            SessionCloseReason::AppExcluded,
                            &mut main_db_lock_errors,
                            &mut pending_main_end_update,
                            &mut last_main_session_end_update_ms,
                        );
                    }
                    current_session = None;
                    #[cfg(target_os = "macos")]
                    let sleep_duration =
                        scheduled_pump_duration(poll_interval, now, pending_follow_up_capture_ms);
                    #[cfg(not(target_os = "macos"))]
                    let sleep_duration = poll_interval;
                    pump_run_loop(sleep_duration);
                    continue;
                }

                // ===== BROWSER INFO =====
                let browser_info = if is_browser(&info.bundle_id) && !is_afk {
                    let bi = get_browser_info(&info.bundle_id);
                    if bi.is_incognito && !config.track_incognito {
                        debug!("Skipping incognito browser activity");
                        browser::BrowserInfo::default()
                    } else {
                        bi
                    }
                } else {
                    browser::BrowserInfo::default()
                };

                // Apply URL privacy mode
                let (tracked_url, tracked_domain) = match &config.url_mode {
                    UrlMode::Off => (None, None),
                    UrlMode::DomainOnly => (None, browser_info.domain.clone()),
                    UrlMode::Full => (browser_info.url.clone(), browser_info.domain.clone()),
                };
                let focused_text_info = if deep_accessibility_capture_enabled_for_app(
                    &info.bundle_id,
                    &info.app_name,
                ) {
                    info.pid
                        .map(|pid| {
                            get_focused_text_info(
                                pid,
                                Some(info.bundle_id.as_str()),
                                info.window_title.as_deref(),
                            )
                        })
                        .unwrap_or_default()
                } else {
                    macos::FocusedTextInfo::default()
                };
                let capture_bundle_id = info.bundle_id.clone();
                let capture_app_name = info.app_name.clone();
                let capture_window_title = info.window_title.clone();
                let capture_document_title = if is_browser(&capture_bundle_id) {
                    info.window_title.clone()
                } else {
                    None
                };

                // Normalize title based on privacy mode
                let title_normalized = info
                    .window_title
                    .as_ref()
                    .map(|t| normalize_title(t, &config.title_mode, config.truncate_length))
                    .unwrap_or_default();

                // ===== ACTIVITY SIGNATURE =====
                let new_signature = ActivitySignature {
                    bundle_id: info.bundle_id.clone(),
                    title_normalized: title_normalized.clone(),
                    domain: tracked_domain.clone(),
                    is_afk,
                };

                // ===== STATE MACHINE: DETERMINE ACTION =====
                // Priority of close reasons (highest to lowest):
                // 1. AFK boundary crossed → always split
                // 2. Hard gap (>60s since last heartbeat) → always split
                // 3. Signature changed → split
                // 4. Same signature + within pulsetime → merge (heartbeat)

                let (action, close_reason) = decide_session_action(
                    current_session.as_ref(),
                    &new_signature,
                    afk_boundary_crossed,
                    now,
                    hard_gap_ms,
                    pulsetime_ms,
                    commit_interval_ms,
                    last_commit_time,
                );

                // ===== EXECUTE ACTION =====
                match action {
                    SessionAction::Merge { should_commit } => {
                        // Update end time (heartbeat)
                        if let Some(ref mut session) = current_session {
                            session.last_seen_ts = now;
                            if session.event_id.is_none() {
                                let _ = ensure_session_event_persisted(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    now,
                                    &mut main_db_lock_errors,
                                    "merge_retry",
                                );
                            }
                            if let Some(event_id) = session.event_id {
                                let due_for_end_update = now
                                    .saturating_sub(last_main_session_end_update_ms)
                                    >= coalesce_end_update_ms;
                                if due_for_end_update || should_commit {
                                    if let Err(e) = db.update_event_end_time(event_id, now) {
                                        if is_db_lock_error(&e) {
                                            pending_main_end_update = Some((event_id, now));
                                            pending_main_end_retry_not_before_ms =
                                                now.saturating_add(125);
                                            main_db_lock_errors =
                                                main_db_lock_errors.saturating_add(1);
                                        } else {
                                            error!("Failed to update event end time: {}", e);
                                        }
                                    } else {
                                        last_main_session_end_update_ms = now;
                                        pending_main_end_update = None;
                                    }
                                }

                                // Periodic sync for long sessions
                                if should_commit {
                                    if let Some(ref sq) = sync_queue {
                                        if let Err(e) = sq.queue_activity_update(event_id, now) {
                                            debug!("Failed to queue activity for sync: {}", e);
                                        }
                                    }
                                    last_commit_time = now;
                                }
                            }
                        }
                    }
                    SessionAction::Close => {
                        // Close previous session
                        if let Some(ref mut session) = current_session {
                            if let Some(reason) = close_reason {
                                close_session_with_lock_fallback(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    now,
                                    reason,
                                    &mut main_db_lock_errors,
                                    &mut pending_main_end_update,
                                    &mut last_main_session_end_update_ms,
                                );
                            }
                        }

                        last_commit_time = now;
                        last_main_session_end_update_ms = now;
                        let mut new_session = CurrentSession {
                            signature: new_signature,
                            event_id: None,
                            start_time: now,
                            last_seen_ts: now,
                            app_name: info.app_name,
                            window_title: info.window_title,
                            browser_url: tracked_url.clone(),
                            browser_domain: tracked_domain.clone(),
                            is_incognito: browser_info.is_incognito,
                            pid: info.pid,
                        };
                        let _ = ensure_session_event_persisted(
                            &mut new_session,
                            config,
                            db,
                            &sync_queue,
                            now,
                            &mut main_db_lock_errors,
                            "close_then_create",
                        );
                        current_session = Some(new_session);
                    }
                    SessionAction::CreateNew => {
                        last_commit_time = now;
                        last_main_session_end_update_ms = now;
                        let mut new_session = CurrentSession {
                            signature: new_signature,
                            event_id: None,
                            start_time: now,
                            last_seen_ts: now,
                            app_name: info.app_name,
                            window_title: info.window_title,
                            browser_url: tracked_url.clone(),
                            browser_domain: tracked_domain.clone(),
                            is_incognito: browser_info.is_incognito,
                            pid: info.pid,
                        };
                        let _ = ensure_session_event_persisted(
                            &mut new_session,
                            config,
                            db,
                            &sync_queue,
                            now,
                            &mut main_db_lock_errors,
                            "create_new",
                        );
                        current_session = Some(new_session);
                    }
                }

                if !is_afk {
                    let activity_event_id = current_session
                        .as_ref()
                        .and_then(|session| session.event_id);
                    #[cfg(target_os = "macos")]
                    let delayed_follow_up = pending_follow_up_capture_ms
                        .map(|deadline_ms| now >= deadline_ms)
                        .unwrap_or(false);
                    #[cfg(target_os = "macos")]
                    if delayed_follow_up {
                        pending_follow_up_capture_ms = None;
                    }
                    #[cfg(target_os = "macos")]
                    let capture_trigger = derive_native_capture_trigger(
                        info.pid,
                        now,
                        last_window_change_event.as_ref(),
                        delayed_follow_up,
                    );
                    #[cfg(not(target_os = "macos"))]
                    let capture_trigger = derive_native_capture_trigger(info.pid, now, None, false);
                    record_native_context_snapshot(
                        db,
                        config,
                        now,
                        activity_event_id,
                        &capture_bundle_id,
                        &capture_app_name,
                        capture_window_title,
                        #[cfg(target_os = "macos")]
                        info.bounds,
                        tracked_url,
                        tracked_domain,
                        capture_document_title,
                        &focused_text_info,
                        &capture_trigger,
                    );
                }
            }
            Ok(None) => {
                debug!("No active window detected");
                if let Some(ref mut session) = current_session {
                    close_session_with_lock_fallback(
                        session,
                        config,
                        db,
                        &sync_queue,
                        now,
                        SessionCloseReason::NoWindow,
                        &mut main_db_lock_errors,
                        &mut pending_main_end_update,
                        &mut last_main_session_end_update_ms,
                    );
                }
                current_session = None;
            }
            Err(e) => {
                // Permission may have been revoked
                warn!(
                    "Failed to get active window info: {} (permission revoked?)",
                    e
                );
                if let Some(ref mut session) = current_session {
                    close_session_with_lock_fallback(
                        session,
                        config,
                        db,
                        &sync_queue,
                        now,
                        SessionCloseReason::PermissionLost,
                        &mut main_db_lock_errors,
                        &mut pending_main_end_update,
                        &mut last_main_session_end_update_ms,
                    );
                }
                current_session = None;
            }
        }

        // Update heartbeat (coalesced to reduce write contention with recorder).
        let heartbeat_due = heartbeat_write_pending
            || now.saturating_sub(last_heartbeat_write_ms) >= heartbeat_write_interval_ms;
        if heartbeat_due {
            match db.update_heartbeat(&config.device_id, now) {
                Ok(()) => {
                    heartbeat_write_pending = false;
                    last_heartbeat_write_ms = now;
                    if !browser_server_started {
                        let url_mode = match &config.url_mode {
                            UrlMode::Off => "off",
                            UrlMode::DomainOnly => "domain",
                            UrlMode::Full => "full",
                        }
                        .to_string();
                        _browser_server_handle = Some(browser_heartbeat_server::start_server(
                            config.device_id.clone(),
                            config.user_id.clone(),
                            config.track_incognito,
                            url_mode,
                            config.browser_heartbeat_port,
                            browser_extension_last_seen.clone(),
                            browser_db_tx.clone(),
                        ));
                        browser_server_started = true;
                        info!(
                            "✅ Browser heartbeat server started after first successful heartbeat write"
                        );
                    }
                }
                Err(e) => {
                    if is_db_lock_error(&e) {
                        heartbeat_write_pending = true;
                        main_db_lock_errors = main_db_lock_errors.saturating_add(1);
                    } else {
                        error!("Failed to update heartbeat: {}", e);
                    }
                }
            }
        }

        // Increment loop counter
        loop_iteration += 1;

        // Periodic status logging (every 5 minutes) to help diagnose hangs
        let status_interval_ms: u64 = 5 * 60 * 1000; // 5 minutes
        if now.saturating_sub(last_status_log) > status_interval_ms {
            let session_info = current_session
                .as_ref()
                .map(|s| {
                    format!(
                        "{} ({:.1}s)",
                        s.app_name,
                        (now - s.start_time) as f64 / 1000.0
                    )
                })
                .unwrap_or_else(|| "none".to_string());
            info!(
                "📊 Watcher status: {} iterations, current session: {}, AFK: {}, extension: {}, db_locks(main={}, browser={}), recorder_spool(ingested={}, invalid={})",
                loop_iteration,
                session_info,
                if was_afk { "yes" } else { "no" },
                if browser_extension_active {
                    "active"
                } else {
                    "inactive"
                },
                main_db_lock_errors,
                BROWSER_DB_LOCK_ERRORS.load(Ordering::Relaxed),
                spool_ingested_total,
                spool_invalid_total,
            );
            last_status_log = now;
        }

        #[cfg(target_os = "macos")]
        let sleep_duration =
            scheduled_pump_duration(poll_interval, now, pending_follow_up_capture_ms);
        #[cfg(not(target_os = "macos"))]
        let sleep_duration = poll_interval;
        pump_run_loop(sleep_duration);
    }

    // ===== SHUTDOWN: Close final session =====
    process_browser_db_commands(db, &sync_queue, &browser_db_rx);

    if let Some(ref mut session) = current_session {
        close_session_with_lock_fallback(
            session,
            config,
            db,
            &sync_queue,
            now_ms(),
            SessionCloseReason::Shutdown,
            &mut main_db_lock_errors,
            &mut pending_main_end_update,
            &mut last_main_session_end_update_ms,
        );
    }

    if let Some((event_id, ts_end)) = pending_main_end_update {
        if let Err(e) = db.update_event_end_time(event_id, ts_end) {
            if !is_db_lock_error(&e) {
                warn!(
                    "Final pending end-time update for event {} failed: {}",
                    event_id, e
                );
            }
        }
    }

    info!("📊 Watcher statistics:");
    if let Ok(count) = db.get_event_count(&config.device_id) {
        info!("   Total events recorded: {}", count);
    }
    if let Ok(stats) = db.get_db_stats() {
        info!(
            "   Database size: {:.2} MB",
            stats.db_size_bytes as f64 / 1024.0 / 1024.0
        );
    }

    // Report sync queue status
    if let Some(ref sq) = sync_queue {
        if let Ok(pending) = sq.pending_count() {
            info!("   Pending sync items: {}", pending);
        }
    }
}

fn process_browser_db_commands(
    db: &WatcherDatabase,
    sync_queue: &Option<SyncQueue>,
    browser_db_rx: &Receiver<BrowserDbCommand>,
) {
    loop {
        match browser_db_rx.try_recv() {
            Ok(BrowserDbCommand::InsertBrowserActivityEvent {
                device_id,
                user_id,
                ts_start,
                ts_end,
                app_bundle_id,
                app_name,
                window_title,
                browser_url,
                browser_domain,
                is_incognito,
                response,
            }) => {
                let result = db.insert_activity_event_with_source(
                    &device_id,
                    &user_id,
                    ts_start,
                    ts_end,
                    &app_bundle_id,
                    &app_name,
                    window_title.as_deref(),
                    None,
                    None,
                    false,
                    browser_url.as_deref(),
                    browser_domain.as_deref(),
                    is_incognito,
                    Some("browser_extension"),
                );
                match result {
                    Ok(event_id) => {
                        if let Some(ref sq) = sync_queue {
                            if let Err(e) = sq.queue_activity_sync(event_id) {
                                debug!("Failed to queue browser insert for sync: {}", e);
                            }
                        }
                        let _ = response.send(Ok(event_id));
                    }
                    Err(err) => {
                        if is_db_lock_error(&err) {
                            BROWSER_DB_LOCK_ERRORS.fetch_add(1, Ordering::Relaxed);
                        }
                        let _ = response.send(Err(err));
                    }
                }
            }
            Ok(BrowserDbCommand::UpdateEventEndTime {
                event_id,
                ts_end,
                response,
            }) => {
                match db.update_event_end_time(event_id, ts_end) {
                    Ok(()) => {
                        if let Some(ref sq) = sync_queue {
                            if let Err(e) = sq.queue_activity_update(event_id, ts_end) {
                                debug!("Failed to queue browser update for sync: {}", e);
                            }
                        }
                        let _ = response.send(Ok(()));
                    }
                    Err(err) => {
                        if is_db_lock_error(&err) {
                            BROWSER_DB_LOCK_ERRORS.fetch_add(1, Ordering::Relaxed);
                            // Best effort: browser heartbeats will keep retrying and close flush
                            // paths will write the latest ts_end eventually.
                            let _ = response.send(Ok(()));
                        } else {
                            let _ = response.send(Err(err));
                        }
                    }
                }
            }
            Ok(BrowserDbCommand::InsertContextSnapshot {
                device_id,
                user_id,
                activity_event_id,
                ts,
                source_type,
                app_bundle_id,
                app_name,
                window_title,
                browser_url,
                browser_domain,
                tab_title,
                document_title,
                visible_text_raw,
                visible_text_norm,
                capture_quality,
                dedup_key,
                capture_components_json,
                ui_elements_json,
                is_sensitive_redacted,
                response,
            }) => {
                let mut snapshot = RitualContextSnapshot::new(
                    device_id,
                    user_id,
                    ts as i64,
                    source_type,
                    app_bundle_id,
                    app_name,
                    dedup_key,
                );
                snapshot.activity_event_id = activity_event_id;
                snapshot.window_title = window_title;
                snapshot.browser_url = browser_url;
                snapshot.browser_domain = browser_domain;
                snapshot.tab_title = tab_title;
                snapshot.document_title = document_title;
                snapshot.visible_text_raw = visible_text_raw;
                snapshot.visible_text_norm = visible_text_norm;
                snapshot.capture_quality = capture_quality;
                snapshot.capture_trigger = Some("browser_heartbeat".to_string());
                snapshot.capture_components_json = capture_components_json.or_else(|| {
                    serde_json::to_string(&vec!["document_title", "browser_tab", "visible_text"])
                        .ok()
                });
                snapshot.ui_elements_json = ui_elements_json;
                snapshot.is_sensitive_redacted = is_sensitive_redacted;

                match db.record_context_snapshot(&snapshot) {
                    Ok(snapshot_id) => {
                        let _ = response.send(Ok(snapshot_id));
                    }
                    Err(err) => {
                        if is_db_lock_error(&err) {
                            BROWSER_DB_LOCK_ERRORS.fetch_add(1, Ordering::Relaxed);
                        }
                        let _ = response.send(Err(err));
                    }
                }
            }
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => {
                warn!("Browser DB command channel disconnected");
                break;
            }
        }
    }
}

/// Actions the state machine can take
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionAction {
    /// Merge heartbeat into existing session
    Merge { should_commit: bool },
    /// Close current session and create new one
    Close,
    /// Create first session (no existing session)
    CreateNew,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(bundle_id: &str, title: &str, domain: Option<&str>, is_afk: bool) -> ActivitySignature {
        ActivitySignature {
            bundle_id: bundle_id.to_string(),
            title_normalized: title.to_string(),
            domain: domain.map(|d| d.to_string()),
            is_afk,
        }
    }

    fn mk_session(
        signature: ActivitySignature,
        start_time: u64,
        last_seen_ts: u64,
    ) -> CurrentSession {
        CurrentSession {
            signature,
            event_id: Some(1),
            start_time,
            last_seen_ts,
            app_name: "App".to_string(),
            window_title: None,
            browser_url: None,
            browser_domain: None,
            is_incognito: false,
            pid: None,
        }
    }

    #[test]
    fn rapid_app_switch_forces_close_with_signature_reason() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 1_500);
        let new_sig = sig("com.browser", "tab-b", Some("example.com"), false);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            false,
            2_000,
            60_000,
            3_000,
            30_000,
            1_000,
        );

        assert_eq!(action, SessionAction::Close);
        assert_eq!(reason, Some(SessionCloseReason::SignatureChanged));
    }

    #[test]
    fn sleep_wake_gap_forces_hard_gap_split() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 2_000);
        let new_sig = sig("com.editor", "file-a", None, false);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            false,
            80_500,
            60_000,
            3_000,
            30_000,
            1_000,
        );

        assert_eq!(action, SessionAction::Close);
        assert_eq!(reason, Some(SessionCloseReason::HardGap));
    }

    #[test]
    fn same_signature_within_pulsetime_merges() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 2_000);
        let new_sig = sig("com.editor", "file-a", None, false);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            false,
            4_000,
            60_000,
            3_000,
            30_000,
            1_000,
        );

        assert_eq!(
            action,
            SessionAction::Merge {
                should_commit: false
            }
        );
        assert_eq!(reason, None);
    }

    #[test]
    fn long_running_session_requests_periodic_commit() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 35_000);
        let new_sig = sig("com.editor", "file-a", None, false);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            false,
            70_100,
            60_000,
            40_000,
            30_000,
            35_000,
        );

        assert_eq!(
            action,
            SessionAction::Merge {
                should_commit: true
            }
        );
        assert_eq!(reason, None);
    }

    #[test]
    fn afk_boundary_always_splits_session() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 2_000);
        let new_sig = sig("com.editor", "file-a", None, true);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            true,
            2_100,
            60_000,
            3_000,
            30_000,
            1_000,
        );

        assert_eq!(action, SessionAction::Close);
        assert_eq!(reason, Some(SessionCloseReason::AfkStateChanged));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn detects_screen_capture_denial_signals() {
        assert!(screen_capture_denied_reason(
            "Error capturing screenshot: The user declined TCCs for application, window, display capture"
        ));
        assert!(screen_capture_denied_reason(
            "Grant access to this application in Privacy & Security settings"
        ));
        assert!(!screen_capture_denied_reason(
            "screencapture exited with status 1"
        ));
    }
}
