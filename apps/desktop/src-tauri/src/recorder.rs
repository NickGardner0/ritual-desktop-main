//! Ritual Recorder Tauri Commands
//!
//! Orchestrates the ritual-recorder sidecar process for screen recording and OCR.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use once_cell::sync::Lazy;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

/// Global state for the recorder process
static RECORDER_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

/// Frame cache for on-demand extracted frames (like Screenpipe)
/// Key: "video_chunk_id:frame_offset", Value: (base64_data, extracted_at)
/// Increased to 500 entries to reduce repeated extractions during scrubbing
static FRAME_CACHE: Lazy<Mutex<FrameCache>> = Lazy::new(|| Mutex::new(FrameCache::new(500)));

/// LRU-style frame cache with TTL
struct FrameCache {
    entries: HashMap<String, CachedFrame>,
    max_entries: usize,
    ttl: Duration,
}

struct CachedFrame {
    data: String,  // Base64 encoded JPEG
    extracted_at: Instant,
}

impl FrameCache {
    fn new(max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            max_entries,
            ttl: Duration::from_secs(300), // 5 minute TTL
        }
    }

    fn get(&mut self, key: &str) -> Option<String> {
        if let Some(entry) = self.entries.get(key) {
            if entry.extracted_at.elapsed() < self.ttl {
                return Some(entry.data.clone());
            }
            // Expired, remove it
            self.entries.remove(key);
        }
        None
    }

    fn insert(&mut self, key: String, data: String) {
        // Evict oldest entries if at capacity
        if self.entries.len() >= self.max_entries {
            // Find and remove oldest entry
            let oldest_key = self.entries
                .iter()
                .max_by_key(|(_, v)| v.extracted_at.elapsed())
                .map(|(k, _)| k.clone());
            if let Some(key) = oldest_key {
                self.entries.remove(&key);
            }
        }
        
        self.entries.insert(key, CachedFrame {
            data,
            extracted_at: Instant::now(),
        });
    }

    fn cleanup_expired(&mut self) {
        self.entries.retain(|_, v| v.extracted_at.elapsed() < self.ttl);
    }
}

/// Recorder configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecorderConfig {
    pub device_id: String,
    pub user_id: String,
    #[serde(default = "default_capture_interval")]
    pub capture_interval_ms: u64,
    #[serde(default = "default_thumbnail_interval")]
    pub thumbnail_interval_ms: u64,
    #[serde(default = "default_video_quality")]
    pub video_quality: String,
    #[serde(default = "default_video_chunk_duration")]
    pub video_chunk_duration_secs: u64,
    #[serde(default)]
    pub monitor_id: u32,
    #[serde(default)]
    pub enable_dedup: bool,
    #[serde(default = "default_dedup_threshold")]
    pub dedup_threshold: f64,
    #[serde(default = "default_max_frame_gap")]
    pub max_frame_gap_secs: u64,
    #[serde(default = "default_enable_ocr")]
    pub enable_ocr: bool,
    #[serde(default = "default_ocr_language")]
    pub ocr_language: String,
    #[serde(default = "default_storage_limit")]
    pub storage_limit_gb: u64,
    #[serde(default)]
    pub excluded_apps: Vec<String>,
}

fn default_capture_interval() -> u64 { 1000 }
fn default_thumbnail_interval() -> u64 { 60000 }
fn default_video_quality() -> String { "medium".to_string() }
fn default_video_chunk_duration() -> u64 { 300 }
fn default_dedup_threshold() -> f64 { 0.02 }
fn default_max_frame_gap() -> u64 { 60 }
fn default_enable_ocr() -> bool { true }
fn default_ocr_language() -> String { "en-US".to_string() }
fn default_storage_limit() -> u64 { 20 }

impl Default for RecorderConfig {
    fn default() -> Self {
        Self {
            device_id: String::new(),
            user_id: String::new(),
            capture_interval_ms: default_capture_interval(),
            thumbnail_interval_ms: default_thumbnail_interval(),
            video_quality: default_video_quality(),
            video_chunk_duration_secs: default_video_chunk_duration(),
            monitor_id: 0,
            enable_dedup: true,
            dedup_threshold: default_dedup_threshold(),
            max_frame_gap_secs: default_max_frame_gap(),
            enable_ocr: default_enable_ocr(),
            ocr_language: default_ocr_language(),
            storage_limit_gb: default_storage_limit(),
            excluded_apps: vec![],
        }
    }
}

/// Recorder status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecorderStatus {
    pub is_running: bool,
    pub pid: Option<u32>,
    pub device_id: Option<String>,
}

/// OCR frame from the recorder database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrFrame {
    pub id: i64,
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
}

/// Video chunk metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoChunk {
    pub id: i64,
    pub file_path: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub frame_count: i64,
    pub file_size_bytes: Option<i64>,
    pub monitor_id: u32,
    pub storage_tier: String,
}

/// FFmpeg status for UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FfmpegStatus {
    pub is_installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub needs_download: bool,
}

/// Storage status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageStatus {
    pub video_bytes: u64,
    pub thumbnail_bytes: u64,
    pub total_bytes: u64,
    pub limit_bytes: u64,
    pub usage_percentage: u8,
    pub frame_count: i64,
    pub video_chunk_count: i64,
}

/// Monitor information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

/// Search results for OCR text
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrSearchResult {
    pub frames: Vec<OcrFrame>,
    pub total_count: i64,
}

/// Find the ritual-recorder executable
fn find_recorder_executable() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));
    
    let home_dir = std::env::var("HOME").ok().map(PathBuf::from);
    
    let mut candidates: Vec<PathBuf> = vec![
        // Development paths (release)
        PathBuf::from("src-tauri/bin/ritual-recorder/target/release/ritual-recorder"),
        PathBuf::from("bin/ritual-recorder/target/release/ritual-recorder"),
        PathBuf::from("target/release/ritual-recorder"),
        // Development paths (debug)
        PathBuf::from("src-tauri/bin/ritual-recorder/target/debug/ritual-recorder"),
        PathBuf::from("bin/ritual-recorder/target/debug/ritual-recorder"),
        // Production paths
        PathBuf::from("../Resources/ritual-recorder"),
        PathBuf::from("ritual-recorder"),
    ];
    
    if let Some(home) = &home_dir {
        candidates.push(home.join(".ritual/bin/ritual-recorder"));
        candidates.push(home.join("Desktop/ritual-desktop-main/src-tauri/bin/ritual-recorder/target/release/ritual-recorder"));
        candidates.push(home.join("Desktop/ritual-desktop-main/src-tauri/bin/ritual-recorder/target/debug/ritual-recorder"));
        candidates.push(home.join("Desktop/ritual-desktop-main/apps/desktop/src-tauri/bin/ritual-recorder/target/release/ritual-recorder"));
        candidates.push(home.join("Desktop/ritual-desktop-main/apps/desktop/src-tauri/bin/ritual-recorder/target/debug/ritual-recorder"));
    }
    
    if let Some(exe) = &exe_dir {
        candidates.push(exe.join("ritual-recorder"));
        candidates.push(exe.join("../Resources/ritual-recorder"));
    }

    for path in &candidates {
        if path.exists() {
            println!("📍 Found recorder at: {:?}", path);
            return Some(path.clone());
        }
    }
    
    println!("⚠️ Ritual Recorder not found. Tried:");
    for path in &candidates {
        println!("   - {:?}", path);
    }

    None
}

/// Get recorder config file path
fn get_recorder_config_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/recorder_config.json")
    } else {
        PathBuf::from("./recorder_config.json")
    }
}

/// Get the frames database path
fn get_frames_database_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/frames.db")
    } else {
        PathBuf::from("./frames.db")
    }
}

/// Get video directory path
fn get_video_dir_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/video")
    } else {
        PathBuf::from("./video")
    }
}

/// Get thumbnail directory path
fn get_thumbnail_dir_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/thumbnails")
    } else {
        PathBuf::from("./thumbnails")
    }
}

/// Get watcher database path (for activity correlation)
fn get_watcher_database_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/watcher.db")
    } else {
        PathBuf::from("./watcher.db")
    }
}

// ============================================================
// TAURI COMMANDS
// ============================================================

/// Check if screen recording permission is granted (macOS only)
#[tauri::command]
pub fn check_screen_recording_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        // On macOS, we can try to capture a screenshot to check permission
        // If CGWindowListCreateImage returns nil, we don't have permission
        use std::process::Command;
        
        let output = Command::new("osascript")
            .arg("-e")
            .arg(r#"
                use framework "CoreGraphics"
                tell application "System Events"
                    set screenCapture to do shell script "screencapture -x -c 2>&1 || echo 'no_permission'"
                    if screenCapture contains "no_permission" then
                        return false
                    else
                        return true
                    end if
                end tell
            "#)
            .output();
        
        match output {
            Ok(o) if o.status.success() => {
                let result = String::from_utf8_lossy(&o.stdout).trim().to_lowercase();
                result != "false"
            }
            _ => {
                // Assume we have permission if check fails
                true
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Request screen recording permission (macOS only)
#[tauri::command]
pub fn request_screen_recording_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        // Open System Preferences to Privacy settings
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn();
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Check FFmpeg installation status
#[tauri::command]
pub fn check_ffmpeg_status() -> FfmpegStatus {
    // Check common FFmpeg locations
    let ffmpeg_paths = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ];
    
    // Check Homebrew paths first
    for path in &ffmpeg_paths {
        if std::path::Path::new(path).exists() {
            let version = get_ffmpeg_version_from_path(path);
            return FfmpegStatus {
                is_installed: true,
                version,
                path: Some(path.to_string()),
                needs_download: false,
            };
        }
    }
    
    // Check $HOME/.local/bin (where auto-download installs)
    if let Ok(home) = std::env::var("HOME") {
        let local_ffmpeg = PathBuf::from(&home).join(".local/bin/ffmpeg");
        if local_ffmpeg.exists() {
            let path_str = local_ffmpeg.to_string_lossy().to_string();
            let version = get_ffmpeg_version_from_path(&path_str);
            return FfmpegStatus {
                is_installed: true,
                version,
                path: Some(path_str),
                needs_download: false,
            };
        }
    }
    
    // Check PATH using which
    if let Ok(output) = Command::new("which").arg("ffmpeg").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                let version = get_ffmpeg_version_from_path(&path);
                return FfmpegStatus {
                    is_installed: true,
                    version,
                    path: Some(path),
                    needs_download: false,
                };
            }
        }
    }
    
    // FFmpeg not found
    FfmpegStatus {
        is_installed: false,
        version: None,
        path: None,
        needs_download: true,
    }
}

/// Get FFmpeg version from a path
fn get_ffmpeg_version_from_path(path: &str) -> Option<String> {
    if let Ok(output) = Command::new(path).arg("-version").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Parse first line: "ffmpeg version X.X.X ..."
            if let Some(line) = stdout.lines().next() {
                if let Some(version_part) = line.strip_prefix("ffmpeg version ") {
                    let version = version_part.split_whitespace().next().unwrap_or("");
                    return Some(version.to_string());
                }
            }
        }
    }
    None
}

/// Install FFmpeg (triggers auto-download via ritual-recorder)
/// This is called before starting the recorder if FFmpeg is not found
#[tauri::command]
pub async fn ensure_ffmpeg_installed() -> Result<FfmpegStatus, String> {
    println!("🎬 Checking FFmpeg installation...");
    
    // First check if already installed
    let status = check_ffmpeg_status();
    if status.is_installed {
        println!("✅ FFmpeg already installed at: {:?}", status.path);
        return Ok(status);
    }
    
    println!("📥 FFmpeg not found, will be downloaded on first recorder start...");
    
    // The actual download happens when ritual-recorder starts
    // We just return the current status indicating download is needed
    Ok(FfmpegStatus {
        is_installed: false,
        version: None,
        path: None,
        needs_download: true,
    })
}

/// Start the ritual-recorder sidecar
#[tauri::command]
pub async fn start_recorder(config: RecorderConfig) -> Result<RecorderStatus, String> {
    println!("🎬 Starting Ritual Recorder...");
    println!("   Device ID: {}", config.device_id);
    println!("   Video Quality: {}", config.video_quality);
    println!("   OCR: {}", if config.enable_ocr { "enabled" } else { "disabled" });

    // Kill any existing recorder processes
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("pkill")
            .args(["-f", "ritual-recorder"])
            .output();
        std::thread::sleep(std::time::Duration::from_millis(100));
        println!("🧹 Cleaned up any existing recorder processes");
    }
    
    // Clear stored handle
    {
        let mut guard = RECORDER_PROCESS.lock().unwrap();
        *guard = None;
    }

    // Find executable
    let executable = find_recorder_executable().ok_or_else(|| {
        "Ritual Recorder executable not found. Please build it first with: cd apps/desktop/src-tauri/bin/ritual-recorder && cargo build --release".to_string()
    })?;

    println!("📍 Using executable: {:?}", executable);

    // Get paths
    let frames_db_path = get_frames_database_path();
    let watcher_db_path = get_watcher_database_path();
    let video_dir = get_video_dir_path();
    let thumbnail_dir = get_thumbnail_dir_path();
    
    // Ensure directories exist
    if let Some(parent) = frames_db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::create_dir_all(&video_dir).map_err(|e| format!("Failed to create video dir: {}", e))?;
    std::fs::create_dir_all(&thumbnail_dir).map_err(|e| format!("Failed to create thumbnail dir: {}", e))?;

    // Build command arguments
    let mut args = vec![
        "--database".to_string(),
        frames_db_path.to_string_lossy().to_string(),
        "--watcher-db".to_string(),
        watcher_db_path.to_string_lossy().to_string(),
        "--video-dir".to_string(),
        video_dir.to_string_lossy().to_string(),
        "--thumbnail-dir".to_string(),
        thumbnail_dir.to_string_lossy().to_string(),
        "--capture-interval".to_string(),
        config.capture_interval_ms.to_string(),
        "--thumbnail-interval".to_string(),
        config.thumbnail_interval_ms.to_string(),
        "--video-quality".to_string(),
        config.video_quality.clone(),
        "--video-chunk-duration".to_string(),
        config.video_chunk_duration_secs.to_string(),
        "--monitor-id".to_string(),
        config.monitor_id.to_string(),
        "--dedup-threshold".to_string(),
        config.dedup_threshold.to_string(),
        "--max-frame-gap".to_string(),
        config.max_frame_gap_secs.to_string(),
        "--ocr-language".to_string(),
        config.ocr_language.clone(),
        "--storage-limit-gb".to_string(),
        config.storage_limit_gb.to_string(),
    ];

    if !config.enable_dedup {
        args.push("--disable-dedup".to_string());
    }

    if !config.enable_ocr {
        args.push("--disable-ocr".to_string());
    }

    if !config.excluded_apps.is_empty() {
        args.push("--excluded-apps".to_string());
        args.push(config.excluded_apps.join(","));
    }

    println!("📋 Arguments: {:?}", args);

    // Spawn the recorder process
    let child = Command::new(&executable)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to start recorder: {}", e))?;

    let pid = child.id();
    println!("✅ Recorder started with PID: {}", pid);

    // Store the process handle
    {
        let mut guard = RECORDER_PROCESS.lock().unwrap();
        *guard = Some(child);
    }

    // Save config for auto-start
    save_recorder_config(&config)?;

    Ok(RecorderStatus {
        is_running: true,
        pid: Some(pid),
        device_id: Some(config.device_id),
    })
}

/// Start recorder synchronously (for auto-start)
pub fn start_recorder_sync(config: RecorderConfig) -> Result<RecorderStatus, String> {
    println!("🎬 Starting Ritual Recorder (sync)...");

    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("pkill")
            .args(["-f", "ritual-recorder"])
            .output();
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    
    {
        let mut guard = RECORDER_PROCESS.lock().unwrap();
        *guard = None;
    }

    let executable = find_recorder_executable().ok_or_else(|| {
        "Ritual Recorder executable not found.".to_string()
    })?;

    let frames_db_path = get_frames_database_path();
    let watcher_db_path = get_watcher_database_path();
    let video_dir = get_video_dir_path();
    let thumbnail_dir = get_thumbnail_dir_path();
    
    if let Some(parent) = frames_db_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::create_dir_all(&video_dir);
    let _ = std::fs::create_dir_all(&thumbnail_dir);

    let mut args = vec![
        "--database".to_string(),
        frames_db_path.to_string_lossy().to_string(),
        "--watcher-db".to_string(),
        watcher_db_path.to_string_lossy().to_string(),
        "--video-dir".to_string(),
        video_dir.to_string_lossy().to_string(),
        "--thumbnail-dir".to_string(),
        thumbnail_dir.to_string_lossy().to_string(),
        "--capture-interval".to_string(),
        config.capture_interval_ms.to_string(),
        "--video-quality".to_string(),
        config.video_quality.clone(),
        "--storage-limit-gb".to_string(),
        config.storage_limit_gb.to_string(),
    ];

    if !config.enable_ocr {
        args.push("--disable-ocr".to_string());
    }

    let child = Command::new(&executable)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to start recorder: {}", e))?;

    let pid = child.id();
    println!("✅ Recorder started with PID: {}", pid);

    {
        let mut guard = RECORDER_PROCESS.lock().unwrap();
        *guard = Some(child);
    }

    Ok(RecorderStatus {
        is_running: true,
        pid: Some(pid),
        device_id: Some(config.device_id),
    })
}

/// Stop the ritual-recorder sidecar
#[tauri::command]
pub async fn stop_recorder() -> Result<RecorderStatus, String> {
    println!("🛑 Stopping Ritual Recorder...");

    let mut guard = RECORDER_PROCESS.lock().unwrap();
    
    if let Some(mut child) = guard.take() {
        match child.kill() {
            Ok(_) => {
                println!("✅ Recorder stopped");
                let _ = child.wait();
            }
            Err(e) => {
                println!("⚠️ Failed to kill recorder: {}", e);
            }
        }
    } else {
        println!("ℹ️ No recorder process to stop");
    }

    Ok(RecorderStatus {
        is_running: false,
        pid: None,
        device_id: None,
    })
}

/// Get recorder status
#[tauri::command]
pub async fn get_recorder_status() -> RecorderStatus {
    let guard = RECORDER_PROCESS.lock().unwrap();
    
    if let Some(ref child) = *guard {
        RecorderStatus {
            is_running: true,
            pid: Some(child.id()),
            device_id: None,
        }
    } else {
        RecorderStatus {
            is_running: false,
            pid: None,
            device_id: None,
        }
    }
}

/// Get available monitors
#[tauri::command]
pub fn get_available_monitors() -> Result<Vec<MonitorInfo>, String> {
    let executable = find_recorder_executable().ok_or_else(|| {
        "Ritual Recorder not found".to_string()
    })?;

    let output = Command::new(&executable)
        .arg("--list-monitors")
        .output()
        .map_err(|e| format!("Failed to get monitors: {}", e))?;

    if !output.status.success() {
        return Err("Failed to list monitors".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut monitors = Vec::new();

    for line in stdout.lines() {
        if line.starts_with("  Monitor") {
            // Parse: "  Monitor 3 - BenQ RD280U (2048x1365, primary)"
            if let Some(rest) = line.strip_prefix("  Monitor ") {
                let parts: Vec<&str> = rest.splitn(2, " - ").collect();
                if parts.len() == 2 {
                    let id: u32 = parts[0].parse().unwrap_or(0);
                    let name_part = parts[1];
                    
                    // Extract dimensions and primary flag
                    let is_primary = name_part.contains("primary");
                    let mut width = 0u32;
                    let mut height = 0u32;
                    let mut name = name_part.to_string();

                    if let Some(paren_start) = name_part.find('(') {
                        name = name_part[..paren_start].trim().to_string();
                        let dims_str = &name_part[paren_start + 1..];
                        if let Some(x_pos) = dims_str.find('x') {
                            width = dims_str[..x_pos].parse().unwrap_or(0);
                            let after_x = &dims_str[x_pos + 1..];
                            if let Some(end) = after_x.find(|c: char| !c.is_numeric()) {
                                height = after_x[..end].parse().unwrap_or(0);
                            } else {
                                height = after_x.trim_end_matches(|c: char| !c.is_numeric()).parse().unwrap_or(0);
                            }
                        }
                    }

                    monitors.push(MonitorInfo {
                        id,
                        name,
                        width,
                        height,
                        is_primary,
                    });
                }
            }
        }
    }

    Ok(monitors)
}

/// Get storage status
#[tauri::command]
pub fn get_recorder_storage_status() -> Result<StorageStatus, String> {
    let frames_db = get_frames_database_path();
    let video_dir = get_video_dir_path();
    let thumbnail_dir = get_thumbnail_dir_path();

    // Calculate video size
    let video_bytes = if video_dir.exists() {
        dir_size(&video_dir).unwrap_or(0)
    } else {
        0
    };

    // Calculate thumbnail size
    let thumbnail_bytes = if thumbnail_dir.exists() {
        dir_size(&thumbnail_dir).unwrap_or(0)
    } else {
        0
    };

    // Get frame and chunk counts from database
    let (frame_count, video_chunk_count) = if frames_db.exists() {
        let conn = Connection::open(&frames_db)
            .map_err(|e| format!("Failed to open frames database: {}", e))?;
        
        let frames: i64 = conn.query_row(
            "SELECT COUNT(*) FROM ocr_frames",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let chunks: i64 = conn.query_row(
            "SELECT COUNT(*) FROM video_chunks",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        (frames, chunks)
    } else {
        (0, 0)
    };

    let total_bytes = video_bytes + thumbnail_bytes;
    let limit_bytes = 20 * 1024 * 1024 * 1024; // Default 20GB
    let usage_percentage = if limit_bytes > 0 {
        ((total_bytes as f64 / limit_bytes as f64) * 100.0) as u8
    } else {
        0
    };

    Ok(StorageStatus {
        video_bytes,
        thumbnail_bytes,
        total_bytes,
        limit_bytes,
        usage_percentage,
        frame_count,
        video_chunk_count,
    })
}

/// Query OCR frames
#[tauri::command]
pub async fn get_ocr_frames(
    start_ts: i64,
    end_ts: i64,
    limit: Option<i64>,
) -> Result<Vec<OcrFrame>, String> {
    println!("📸 get_ocr_frames called: start={}, end={}, limit={:?}", start_ts, end_ts, limit);
    
    let frames_db = get_frames_database_path();
    
    if !frames_db.exists() {
        println!("⚠️ Frames database doesn't exist: {:?}", frames_db);
        return Ok(vec![]);
    }

    let conn = Connection::open(&frames_db)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let limit_val = limit.unwrap_or(500);

    // Only return frames from COMPLETED video chunks (end_time IS NOT NULL)
    // Active recordings don't have a readable moov atom in the MP4 file
    let mut stmt = conn.prepare(
        r#"
        SELECT f.id, f.timestamp, f.activity_event_id, f.app_bundle_id, f.app_name,
               f.window_title, f.ocr_text, f.ocr_confidence, f.thumbnail_path,
               f.video_chunk_id, f.frame_offset
        FROM ocr_frames f
        LEFT JOIN video_chunks vc ON f.video_chunk_id = vc.id
        WHERE f.timestamp >= ?1 AND f.timestamp <= ?2
          AND (f.video_chunk_id IS NULL OR vc.end_time IS NOT NULL)
        ORDER BY f.timestamp DESC
        LIMIT ?3
        "#
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;

    let frames: Vec<OcrFrame> = stmt
        .query_map([start_ts, end_ts, limit_val], |row| {
            Ok(OcrFrame {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                activity_event_id: row.get(2)?,
                app_bundle_id: row.get(3)?,
                app_name: row.get(4)?,
                window_title: row.get(5)?,
                ocr_text: row.get(6)?,
                ocr_confidence: row.get(7)?,
                thumbnail_path: row.get(8)?,
                video_chunk_id: row.get(9)?,
                frame_offset: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to query frames: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    let extractable = frames.iter().filter(|f| f.video_chunk_id.is_some() && f.frame_offset.is_some()).count();
    println!("📸 Returning {} frames ({} extractable from completed videos)", frames.len(), extractable);
    
    Ok(frames)
}

/// Search OCR text
#[tauri::command]
pub async fn search_ocr_text(
    query: String,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    limit: Option<i64>,
) -> Result<OcrSearchResult, String> {
    let frames_db = get_frames_database_path();
    
    if !frames_db.exists() {
        return Ok(OcrSearchResult {
            frames: vec![],
            total_count: 0,
        });
    }

    let conn = Connection::open(&frames_db)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let limit_val = limit.unwrap_or(100);
    let now_ms = chrono::Utc::now().timestamp_millis();
    let start = start_ts.unwrap_or(0);
    let end = end_ts.unwrap_or(now_ms);

    // Use FTS5 full-text search
    let mut stmt = conn.prepare(
        r#"
        SELECT f.id, f.timestamp, f.activity_event_id, f.app_bundle_id, f.app_name,
               f.window_title, f.ocr_text, f.ocr_confidence, f.thumbnail_path,
               f.video_chunk_id, f.frame_offset
        FROM ocr_frames f
        JOIN ocr_frames_fts fts ON f.id = fts.rowid
        WHERE ocr_frames_fts MATCH ?1
          AND f.timestamp >= ?2 AND f.timestamp <= ?3
        ORDER BY f.timestamp DESC
        LIMIT ?4
        "#
    ).map_err(|e| format!("Failed to prepare search query: {}", e))?;

    let frames: Vec<OcrFrame> = stmt
        .query_map(rusqlite::params![query, start, end, limit_val], |row| {
            Ok(OcrFrame {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                activity_event_id: row.get(2)?,
                app_bundle_id: row.get(3)?,
                app_name: row.get(4)?,
                window_title: row.get(5)?,
                ocr_text: row.get(6)?,
                ocr_confidence: row.get(7)?,
                thumbnail_path: row.get(8)?,
                video_chunk_id: row.get(9)?,
                frame_offset: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to search: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    // Get total count
    let total_count: i64 = conn.query_row(
        r#"
        SELECT COUNT(*) FROM ocr_frames f
        JOIN ocr_frames_fts fts ON f.id = fts.rowid
        WHERE ocr_frames_fts MATCH ?1
          AND f.timestamp >= ?2 AND f.timestamp <= ?3
        "#,
        rusqlite::params![query, start, end],
        |row| row.get(0),
    ).unwrap_or(0);

    Ok(OcrSearchResult {
        frames,
        total_count,
    })
}

/// Get video chunks
#[tauri::command]
pub async fn get_video_chunks(
    start_ts: i64,
    end_ts: i64,
) -> Result<Vec<VideoChunk>, String> {
    let frames_db = get_frames_database_path();
    
    if !frames_db.exists() {
        return Ok(vec![]);
    }

    let conn = Connection::open(&frames_db)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    let mut stmt = conn.prepare(
        r#"
        SELECT id, file_path, start_time, end_time, frame_count,
               file_size_bytes, monitor_id, storage_tier
        FROM video_chunks
        WHERE start_time <= ?2 AND (end_time IS NULL OR end_time >= ?1)
        ORDER BY start_time ASC
        "#
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;

    let chunks: Vec<VideoChunk> = stmt
        .query_map([start_ts, end_ts], |row| {
            Ok(VideoChunk {
                id: row.get(0)?,
                file_path: row.get(1)?,
                start_time: row.get(2)?,
                end_time: row.get(3)?,
                frame_count: row.get(4)?,
                file_size_bytes: row.get(5)?,
                monitor_id: row.get(6)?,
                storage_tier: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to query chunks: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(chunks)
}

/// Run storage maintenance
#[tauri::command]
pub async fn run_recorder_maintenance() -> Result<String, String> {
    let executable = find_recorder_executable().ok_or_else(|| {
        "Ritual Recorder not found".to_string()
    })?;

    let output = Command::new(&executable)
        .arg("--maintenance")
        .output()
        .map_err(|e| format!("Failed to run maintenance: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

// ============================================================
// ON-DEMAND FRAME EXTRACTION (Screenpipe-style architecture)
// ============================================================

/// Response for extracted frame
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedFrame {
    pub data: String,       // Base64 encoded JPEG
    pub mime_type: String,  // "image/jpeg"
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub from_cache: bool,
}

/// Extract a frame from video on-demand (like Screenpipe)
/// This replaces the need for pre-generated thumbnails
#[tauri::command]
pub async fn extract_frame_image(
    frame_id: Option<i64>,
    video_chunk_id: Option<i64>,
    frame_offset: Option<i64>,
    scale: Option<f32>,  // Optional scale factor (0.5 = half size)
) -> Result<ExtractedFrame, String> {
    let frames_db = get_frames_database_path();
    
    if !frames_db.exists() {
        return Err("Frames database not found".to_string());
    }

    // Determine video path and offset
    let (video_path, offset): (String, i64) = if let Some(fid) = frame_id {
        // Look up from frame_id
        let conn = Connection::open(&frames_db)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        
        // Handle nullable columns
        let result: Result<(Option<i64>, Option<i64>), _> = conn.query_row(
            "SELECT video_chunk_id, frame_offset FROM ocr_frames WHERE id = ?1",
            [fid],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        
        let (chunk_id_opt, offset_opt) = result
            .map_err(|e| format!("Frame {} not found: {}", fid, e))?;
        
        let chunk_id = chunk_id_opt.ok_or_else(|| 
            format!("Frame {} has no video_chunk_id - may be an old frame without video", fid))?;
        let offset = offset_opt.unwrap_or(0); // Default to frame 0 if offset is NULL
        
        // Check if video chunk is complete (has end_time)
        // Videos without end_time are still being written and can't be read
        let chunk_info: Result<(String, Option<i64>), _> = conn.query_row(
            "SELECT file_path, end_time FROM video_chunks WHERE id = ?1",
            [chunk_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        
        let (path, end_time) = chunk_info
            .map_err(|e| format!("Video chunk {} not found: {}", chunk_id, e))?;
        
        if end_time.is_none() {
            return Err(format!(
                "Video chunk {} is still being recorded (no end_time). Cannot extract frames from active recordings.",
                chunk_id
            ));
        }
        
        println!("🔍 Frame lookup: id={}, chunk={}, offset={}, path={}", fid, chunk_id, offset, path);
        
        (path, offset)
    } else if let (Some(chunk_id), Some(offset)) = (video_chunk_id, frame_offset) {
        // Use provided chunk_id and offset
        let conn = Connection::open(&frames_db)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        
        // Check if video chunk is complete
        let chunk_info: Result<(String, Option<i64>), _> = conn.query_row(
            "SELECT file_path, end_time FROM video_chunks WHERE id = ?1",
            [chunk_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        
        let (path, end_time) = chunk_info
            .map_err(|e| format!("Video chunk {} not found: {}", chunk_id, e))?;
        
        if end_time.is_none() {
            return Err(format!(
                "Video chunk {} is still being recorded. Cannot extract frames from active recordings.",
                chunk_id
            ));
        }
        
        println!("🔍 Direct lookup: chunk={}, offset={}, path={}", chunk_id, offset, path);
        
        (path, offset)
    } else {
        return Err("Must provide either frame_id or (video_chunk_id, frame_offset)".to_string());
    };

    // Check cache first
    let cache_key = format!("{}:{}", video_path, offset);
    {
        let mut cache = FRAME_CACHE.lock().unwrap();
        cache.cleanup_expired();
        if let Some(cached_data) = cache.get(&cache_key) {
            println!("🎯 Frame cache hit: {}", cache_key);
            return Ok(ExtractedFrame {
                data: cached_data,
                mime_type: "image/jpeg".to_string(),
                width: None,
                height: None,
                from_cache: true,
            });
        }
    }

    // Verify video file exists
    if !std::path::Path::new(&video_path).exists() {
        return Err(format!("Video file not found: {}", video_path));
    }

    // Extract frame using FFmpeg
    let base64_data = extract_frame_with_ffmpeg(&video_path, offset, scale.unwrap_or(0.75)).await?;

    // Cache the result
    {
        let mut cache = FRAME_CACHE.lock().unwrap();
        cache.insert(cache_key.clone(), base64_data.clone());
        println!("💾 Frame cached: {} (cache size: {})", cache_key, cache.entries.len());
    }

    Ok(ExtractedFrame {
        data: base64_data,
        mime_type: "image/jpeg".to_string(),
        width: None,
        height: None,
        from_cache: false,
    })
}

/// Extract frame from video using FFmpeg (Screenpipe-style)
async fn extract_frame_with_ffmpeg(
    video_path: &str,
    frame_offset: i64,
    scale: f32,
) -> Result<String, String> {
    // Find FFmpeg
    let ffmpeg = find_ffmpeg_path()
        .ok_or_else(|| "FFmpeg not found. Please install FFmpeg.".to_string())?;

    println!("🎬 Extracting frame: video={}, offset={}", video_path, frame_offset);

    // Get video duration and FPS
    let (duration, fps) = get_video_info(&ffmpeg, video_path).unwrap_or((300.0, 1.0));
    println!("📊 Video info: duration={}s, fps={}", duration, fps);
    
    // frame_offset is the frame index (0, 1, 2, ...)
    // Convert to seconds: frame_time = frame_offset / fps
    let mut offset_seconds = frame_offset as f64 / fps;
    
    // Clamp to valid range (0 to duration - small buffer)
    let max_offset = (duration - 0.5).max(0.0);
    if offset_seconds > max_offset {
        println!("⚠️ Offset {}s exceeds duration {}s, clamping to {}", offset_seconds, duration, max_offset);
        offset_seconds = max_offset;
    }
    if offset_seconds < 0.0 {
        offset_seconds = 0.0;
    }
    
    let offset_str = format!("{:.3}", offset_seconds);
    println!("🎯 Seeking to: {}s (frame_offset={}, fps={})", offset_str, frame_offset, fps);

    // Create temp file for output
    let temp_dir = std::env::temp_dir().join("ritual_frames");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;
    
    let output_path = temp_dir.join(format!("frame_{}_{}.jpg", 
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
        frame_offset
    ));

    // Build FFmpeg command
    // Put -ss BEFORE -i for fast seeking (input seeking)
    // Use filter chain with pixel format conversion to avoid MJPEG encoder errors
    // The yuvj420p format is native for JPEG and prevents "Non full-range YUV" errors
    let scale_filter = format!("scale=iw*{:.2}:-2,format=yuvj420p", scale); // -2 ensures even height
    
    let output = Command::new(&ffmpeg)
        .args([
            "-hide_banner",        // Suppress version info
            "-loglevel", "warning",// Show warnings (not just errors) for debugging
            "-ss", &offset_str,    // Seek position (before -i for speed)
            "-i", video_path,      // Input file
            "-vf", &scale_filter,  // Scale + pixel format conversion
            "-frames:v", "1",      // Extract 1 frame (newer syntax)
            "-q:v", "3",           // JPEG quality (lower = better, was 5)
            "-f", "image2",        // Force image output format
            "-y",                  // Overwrite output
            output_path.to_str().unwrap(),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    
    // Check if output file was created (more reliable than exit code)
    if !output_path.exists() {
        // Try alternative extraction method - extract from start
        println!("⚠️ First extraction failed, trying from video start...");
        if !stderr.is_empty() {
            println!("📝 FFmpeg stderr: {}", stderr);
        }
        
        // Try extracting frame 0 as fallback
        let fallback_output = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel", "error",
                "-i", video_path,
                "-vf", &scale_filter,
                "-frames:v", "1",
                "-q:v", "5",
                "-f", "image2",
                "-y",
                output_path.to_str().unwrap(),
            ])
            .output()
            .map_err(|e| format!("Fallback FFmpeg failed: {}", e))?;
            
        if !output_path.exists() {
            let fallback_stderr = String::from_utf8_lossy(&fallback_output.stderr);
            return Err(format!("FFmpeg extraction failed - no output created. Error: {}", 
                if fallback_stderr.is_empty() { stderr.to_string() } else { fallback_stderr.to_string() }));
        }
    }

    // Read and encode as base64
    let frame_data = std::fs::read(&output_path)
        .map_err(|e| format!("Failed to read extracted frame: {}", e))?;
    
    // Clean up temp file
    let _ = std::fs::remove_file(&output_path);

    if frame_data.is_empty() {
        return Err("Extracted frame is empty".to_string());
    }

    let base64_data = BASE64.encode(&frame_data);
    
    println!("📸 Extracted frame: offset={}s, size={}KB", offset_str, frame_data.len() / 1024);
    
    Ok(base64_data)
}

/// Get video duration and FPS
fn get_video_info(ffmpeg_path: &PathBuf, video_path: &str) -> Option<(f64, f64)> {
    let ffprobe_path = ffmpeg_path.parent()?.join("ffprobe");
    
    if ffprobe_path.exists() {
        // Get duration
        let duration_output = Command::new(&ffprobe_path)
            .args([
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ])
            .output()
            .ok()?;
        
        let duration_str = String::from_utf8_lossy(&duration_output.stdout);
        let duration: f64 = duration_str.trim().parse().unwrap_or(300.0);
        
        // Get FPS
        let fps_output = Command::new(&ffprobe_path)
            .args([
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=r_frame_rate",
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path,
            ])
            .output()
            .ok()?;
        
        let fps_str = String::from_utf8_lossy(&fps_output.stdout);
        let fps = parse_fps_string(fps_str.trim()).unwrap_or(1.0);
        
        Some((duration, fps))
    } else {
        // Fallback to defaults
        Some((300.0, 1.0))
    }
}


/// Parse FPS string like "30/1" or "30"
fn parse_fps_string(s: &str) -> Option<f64> {
    if s.contains('/') {
        let parts: Vec<&str> = s.split('/').collect();
        if parts.len() == 2 {
            let num: f64 = parts[0].parse().ok()?;
            let den: f64 = parts[1].parse().ok()?;
            if den > 0.0 {
                return Some(num / den);
            }
        }
    } else {
        return s.parse().ok();
    }
    None
}

/// Find FFmpeg executable path
fn find_ffmpeg_path() -> Option<PathBuf> {
    // Check common locations
    let paths = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "ffmpeg",  // PATH lookup
    ];
    
    for path in paths {
        let p = PathBuf::from(path);
        if path == "ffmpeg" {
            // Check if in PATH
            if Command::new("which")
                .arg("ffmpeg")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                return Some(p);
            }
        } else if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Clear the frame cache
#[tauri::command]
pub fn clear_frame_cache() -> Result<u32, String> {
    let mut cache = FRAME_CACHE.lock().unwrap();
    let count = cache.entries.len() as u32;
    cache.entries.clear();
    println!("🧹 Cleared {} cached frames", count);
    Ok(count)
}

/// Get frame cache stats
#[tauri::command]
pub fn get_frame_cache_stats() -> Result<serde_json::Value, String> {
    let cache = FRAME_CACHE.lock().unwrap();
    Ok(serde_json::json!({
        "entry_count": cache.entries.len(),
        "max_entries": cache.max_entries,
        "ttl_seconds": cache.ttl.as_secs(),
    }))
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/// Save recorder config for auto-start
fn save_recorder_config(config: &RecorderConfig) -> Result<(), String> {
    let config_path = get_recorder_config_path();
    
    if let Some(parent) = config_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    
    std::fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    
    println!("💾 Recorder config saved for auto-start");
    Ok(())
}

/// Read saved recorder config
pub fn read_recorder_config() -> Option<RecorderConfig> {
    let config_path = get_recorder_config_path();
    if config_path.exists() {
        if let Ok(contents) = std::fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<RecorderConfig>(&contents) {
                return Some(config);
            }
        }
    }
    None
}

/// Save recorder config command
#[tauri::command]
pub fn save_recorder_config_cmd(config: RecorderConfig) -> Result<(), String> {
    save_recorder_config(&config)
}

/// Clear recorder config command
#[tauri::command]
pub fn clear_recorder_config_cmd() -> Result<(), String> {
    let config_path = get_recorder_config_path();
    if config_path.exists() {
        std::fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove config: {}", e))?;
        println!("🗑️ Recorder config cleared (auto-start disabled)");
    }
    Ok(())
}

/// Calculate directory size recursively
fn dir_size(path: &PathBuf) -> Result<u64, std::io::Error> {
    let mut size = 0u64;
    
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        
        if metadata.is_file() {
            size += metadata.len();
        } else if metadata.is_dir() {
            size += dir_size(&entry.path())?;
        }
    }
    
    Ok(size)
}
