//! Read-only recorder compatibility surface for desktop builds without the native recorder.
//!
//! The shipped desktop app no longer starts or manages the old ritual-recorder sidecar,
//! but some OCR-backed UI surfaces still expect these Tauri commands to exist. This
//! module preserves the read/query commands against the local memory database while
//! disabling recorder process management and screen recording controls.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use once_cell::sync::Lazy;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const RECORDER_DISABLED_MESSAGE: &str =
    "Native screen recorder is not shipped in this desktop build.";

static FRAME_CACHE: Lazy<Mutex<FrameCache>> = Lazy::new(|| Mutex::new(FrameCache::new(500)));

struct FrameCache {
    entries: HashMap<String, CachedFrame>,
    max_entries: usize,
    ttl: Duration,
}

struct CachedFrame {
    data: String,
    extracted_at: Instant,
}

impl FrameCache {
    fn new(max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            max_entries,
            ttl: Duration::from_secs(300),
        }
    }

    fn get(&mut self, key: &str) -> Option<String> {
        if let Some(entry) = self.entries.get(key) {
            if entry.extracted_at.elapsed() < self.ttl {
                return Some(entry.data.clone());
            }
            self.entries.remove(key);
        }
        None
    }

    fn insert(&mut self, key: String, data: String) {
        if self.entries.len() >= self.max_entries {
            let oldest_key = self
                .entries
                .iter()
                .max_by_key(|(_, v)| v.extracted_at.elapsed())
                .map(|(k, _)| k.clone());
            if let Some(key) = oldest_key {
                self.entries.remove(&key);
            }
        }

        self.entries.insert(
            key,
            CachedFrame {
                data,
                extracted_at: Instant::now(),
            },
        );
    }

    fn cleanup_expired(&mut self) {
        self.entries
            .retain(|_, v| v.extracted_at.elapsed() < self.ttl);
    }
}

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

fn default_capture_interval() -> u64 {
    1000
}
fn default_thumbnail_interval() -> u64 {
    60000
}
fn default_video_quality() -> String {
    "medium".to_string()
}
fn default_video_chunk_duration() -> u64 {
    300
}
fn default_dedup_threshold() -> f64 {
    0.02
}
fn default_max_frame_gap() -> u64 {
    60
}
fn default_enable_ocr() -> bool {
    true
}
fn default_ocr_language() -> String {
    "en-US".to_string()
}
fn default_storage_limit() -> u64 {
    20
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecorderStatus {
    pub is_running: bool,
    pub pid: Option<u32>,
    pub device_id: Option<String>,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FfmpegStatus {
    pub is_installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub needs_download: bool,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrSearchResult {
    pub frames: Vec<OcrFrame>,
    pub total_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedFrame {
    pub data: String,
    pub mime_type: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub from_cache: bool,
}

fn get_recorder_config_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/recorder_config.json")
    } else {
        PathBuf::from("./recorder_config.json")
    }
}

fn get_memory_database_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/memory.db")
    } else {
        PathBuf::from("./memory.db")
    }
}

fn get_video_dir_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/video")
    } else {
        PathBuf::from("./video")
    }
}

fn get_thumbnail_dir_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/thumbnails")
    } else {
        PathBuf::from("./thumbnails")
    }
}

#[tauri::command]
pub fn check_screen_recording_permission() -> bool {
    false
}

#[tauri::command]
pub fn request_screen_recording_permission() -> bool {
    false
}

#[tauri::command]
pub fn check_ffmpeg_status() -> FfmpegStatus {
    match find_ffmpeg_path() {
        Some(path) => FfmpegStatus {
            is_installed: true,
            version: get_ffmpeg_version_from_path(path.to_string_lossy().as_ref()),
            path: Some(path.to_string_lossy().to_string()),
            needs_download: false,
        },
        None => FfmpegStatus {
            is_installed: false,
            version: None,
            path: None,
            needs_download: false,
        },
    }
}

#[tauri::command]
pub async fn ensure_ffmpeg_installed() -> Result<FfmpegStatus, String> {
    Ok(check_ffmpeg_status())
}

#[tauri::command]
pub async fn start_recorder(_config: RecorderConfig) -> Result<RecorderStatus, String> {
    Err(RECORDER_DISABLED_MESSAGE.to_string())
}

pub fn start_recorder_sync(_config: RecorderConfig) -> Result<RecorderStatus, String> {
    Err(RECORDER_DISABLED_MESSAGE.to_string())
}

#[tauri::command]
pub async fn stop_recorder() -> Result<RecorderStatus, String> {
    Ok(RecorderStatus {
        is_running: false,
        pid: None,
        device_id: None,
    })
}

#[tauri::command]
pub async fn get_recorder_status() -> RecorderStatus {
    RecorderStatus {
        is_running: false,
        pid: None,
        device_id: None,
    }
}

#[tauri::command]
pub fn get_available_monitors() -> Result<Vec<MonitorInfo>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn get_recorder_storage_status() -> Result<StorageStatus, String> {
    let frames_db = get_memory_database_path();
    let video_dir = get_video_dir_path();
    let thumbnail_dir = get_thumbnail_dir_path();

    let video_bytes = if video_dir.exists() {
        dir_size(&video_dir).unwrap_or(0)
    } else {
        0
    };
    let thumbnail_bytes = if thumbnail_dir.exists() {
        dir_size(&thumbnail_dir).unwrap_or(0)
    } else {
        0
    };

    let (frame_count, video_chunk_count) = if frames_db.exists() {
        let conn = Connection::open(&frames_db)
            .map_err(|e| format!("Failed to open ritual database: {}", e))?;

        let frames: i64 = conn
            .query_row("SELECT COUNT(*) FROM ocr_frames", [], |row| row.get(0))
            .unwrap_or(0);
        let chunks: i64 = conn
            .query_row("SELECT COUNT(*) FROM video_chunks", [], |row| row.get(0))
            .unwrap_or(0);

        (frames, chunks)
    } else {
        (0, 0)
    };

    let total_bytes = video_bytes + thumbnail_bytes;
    let limit_bytes = 20 * 1024 * 1024 * 1024;
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

#[tauri::command]
pub async fn get_ocr_frames(
    start_ts: i64,
    end_ts: i64,
    limit: Option<i64>,
) -> Result<Vec<OcrFrame>, String> {
    let frames_db = get_memory_database_path();
    if !frames_db.exists() {
        return Ok(vec![]);
    }

    let conn =
        Connection::open(&frames_db).map_err(|e| format!("Failed to open database: {}", e))?;
    let limit_val = limit.unwrap_or(500);

    let mut stmt = conn
        .prepare(
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
        "#,
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

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
        .filter_map(|row| row.ok())
        .collect();

    Ok(frames)
}

#[tauri::command]
pub async fn search_ocr_text(
    query: String,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    limit: Option<i64>,
) -> Result<OcrSearchResult, String> {
    let frames_db = get_memory_database_path();
    if !frames_db.exists() {
        return Ok(OcrSearchResult {
            frames: vec![],
            total_count: 0,
        });
    }

    let conn =
        Connection::open(&frames_db).map_err(|e| format!("Failed to open database: {}", e))?;
    let limit_val = limit.unwrap_or(100);
    let now_ms = chrono::Utc::now().timestamp_millis();
    let start = start_ts.unwrap_or(0);
    let end = end_ts.unwrap_or(now_ms);

    let mut stmt = conn
        .prepare(
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
        "#,
        )
        .map_err(|e| format!("Failed to prepare search query: {}", e))?;

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
        .filter_map(|row| row.ok())
        .collect();

    let total_count: i64 = conn
        .query_row(
            r#"
        SELECT COUNT(*) FROM ocr_frames f
        JOIN ocr_frames_fts fts ON f.id = fts.rowid
        WHERE ocr_frames_fts MATCH ?1
          AND f.timestamp >= ?2 AND f.timestamp <= ?3
        "#,
            rusqlite::params![query, start, end],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(OcrSearchResult {
        frames,
        total_count,
    })
}

#[tauri::command]
pub async fn get_video_chunks(start_ts: i64, end_ts: i64) -> Result<Vec<VideoChunk>, String> {
    let frames_db = get_memory_database_path();
    if !frames_db.exists() {
        return Ok(vec![]);
    }

    let conn =
        Connection::open(&frames_db).map_err(|e| format!("Failed to open database: {}", e))?;

    let mut stmt = conn
        .prepare(
            r#"
        SELECT id, file_path, start_time, end_time, frame_count,
               file_size_bytes, monitor_id, storage_tier
        FROM video_chunks
        WHERE start_time <= ?2 AND (end_time IS NULL OR end_time >= ?1)
        ORDER BY start_time ASC
        "#,
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

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
        .filter_map(|row| row.ok())
        .collect();

    Ok(chunks)
}

#[tauri::command]
pub async fn run_recorder_maintenance() -> Result<String, String> {
    Ok(RECORDER_DISABLED_MESSAGE.to_string())
}

#[tauri::command]
pub async fn extract_frame_image(
    frame_id: Option<i64>,
    video_chunk_id: Option<i64>,
    frame_offset: Option<i64>,
    scale: Option<f32>,
) -> Result<ExtractedFrame, String> {
    let frames_db = get_memory_database_path();
    if !frames_db.exists() {
        return Err("Ritual database not found".to_string());
    }

    let (video_path, offset): (String, i64) = if let Some(fid) = frame_id {
        let conn =
            Connection::open(&frames_db).map_err(|e| format!("Failed to open database: {}", e))?;
        let result: Result<(Option<i64>, Option<i64>), _> = conn.query_row(
            "SELECT video_chunk_id, frame_offset FROM ocr_frames WHERE id = ?1",
            [fid],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        let (chunk_id_opt, offset_opt) =
            result.map_err(|e| format!("Frame {} not found: {}", fid, e))?;
        let chunk_id = chunk_id_opt.ok_or_else(|| {
            format!(
                "Frame {} has no video_chunk_id - may be an old frame without video",
                fid
            )
        })?;
        let offset = offset_opt.unwrap_or(0);

        let chunk_info: Result<(String, Option<i64>), _> = conn.query_row(
            "SELECT file_path, end_time FROM video_chunks WHERE id = ?1",
            [chunk_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        let (path, end_time) =
            chunk_info.map_err(|e| format!("Video chunk {} not found: {}", chunk_id, e))?;
        if end_time.is_none() {
            return Err(format!(
                "Video chunk {} is still being recorded. Cannot extract frames from active recordings.",
                chunk_id
            ));
        }
        (path, offset)
    } else if let (Some(chunk_id), Some(offset)) = (video_chunk_id, frame_offset) {
        let conn =
            Connection::open(&frames_db).map_err(|e| format!("Failed to open database: {}", e))?;
        let chunk_info: Result<(String, Option<i64>), _> = conn.query_row(
            "SELECT file_path, end_time FROM video_chunks WHERE id = ?1",
            [chunk_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        let (path, end_time) =
            chunk_info.map_err(|e| format!("Video chunk {} not found: {}", chunk_id, e))?;
        if end_time.is_none() {
            return Err(format!(
                "Video chunk {} is still being recorded. Cannot extract frames from active recordings.",
                chunk_id
            ));
        }
        (path, offset)
    } else {
        return Err("Must provide either frame_id or (video_chunk_id, frame_offset)".to_string());
    };

    let cache_key = format!("{}:{}", video_path, offset);
    {
        let mut cache = FRAME_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.cleanup_expired();
        if let Some(cached_data) = cache.get(&cache_key) {
            return Ok(ExtractedFrame {
                data: cached_data,
                mime_type: "image/jpeg".to_string(),
                width: None,
                height: None,
                from_cache: true,
            });
        }
    }

    if !std::path::Path::new(&video_path).exists() {
        return Err(format!("Video file not found: {}", video_path));
    }

    let base64_data = extract_frame_with_ffmpeg(&video_path, offset, scale.unwrap_or(0.75)).await?;

    {
        let mut cache = FRAME_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        cache.insert(cache_key, base64_data.clone());
    }

    Ok(ExtractedFrame {
        data: base64_data,
        mime_type: "image/jpeg".to_string(),
        width: None,
        height: None,
        from_cache: false,
    })
}

async fn extract_frame_with_ffmpeg(
    video_path: &str,
    frame_offset: i64,
    scale: f32,
) -> Result<String, String> {
    let ffmpeg =
        find_ffmpeg_path().ok_or_else(|| "FFmpeg not found. Please install FFmpeg.".to_string())?;

    let (duration, fps) = get_video_info(&ffmpeg, video_path).unwrap_or((300.0, 1.0));
    let mut offset_seconds = frame_offset as f64 / fps;
    let max_offset = (duration - 0.5).max(0.0);
    if offset_seconds > max_offset {
        offset_seconds = max_offset;
    }
    if offset_seconds < 0.0 {
        offset_seconds = 0.0;
    }

    let offset_str = format!("{:.3}", offset_seconds);
    let temp_dir = std::env::temp_dir().join("ritual_frames");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let now_millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let output_path = temp_dir.join(format!("frame_{}_{}.jpg", now_millis, frame_offset));
    let output_path_str = output_path
        .to_str()
        .ok_or_else(|| "Invalid output path for extracted frame".to_string())?;

    let scale_filter = format!("scale=iw*{:.2}:-2,format=yuvj420p", scale);
    let output = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "warning",
            "-ss",
            &offset_str,
            "-i",
            video_path,
            "-vf",
            &scale_filter,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            "-f",
            "image2",
            "-y",
            output_path_str,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

    if !output_path.exists() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "FFmpeg extraction failed - no output created. Error: {}",
            stderr
        ));
    }

    let frame_data = std::fs::read(&output_path)
        .map_err(|e| format!("Failed to read extracted frame: {}", e))?;
    let _ = std::fs::remove_file(&output_path);

    if frame_data.is_empty() {
        return Err("Extracted frame is empty".to_string());
    }

    Ok(BASE64.encode(&frame_data))
}

fn get_video_info(ffmpeg_path: &PathBuf, video_path: &str) -> Option<(f64, f64)> {
    let ffprobe_path = ffmpeg_path.parent()?.join("ffprobe");
    if ffprobe_path.exists() {
        let duration_output = Command::new(&ffprobe_path)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                video_path,
            ])
            .output()
            .ok()?;
        let duration_str = String::from_utf8_lossy(&duration_output.stdout);
        let duration: f64 = duration_str.trim().parse().unwrap_or(300.0);

        let fps_output = Command::new(&ffprobe_path)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=r_frame_rate",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                video_path,
            ])
            .output()
            .ok()?;
        let fps_str = String::from_utf8_lossy(&fps_output.stdout);
        let fps = parse_fps_string(fps_str.trim()).unwrap_or(1.0);
        Some((duration, fps))
    } else {
        Some((300.0, 1.0))
    }
}

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

fn find_ffmpeg_path() -> Option<PathBuf> {
    let paths = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "ffmpeg",
    ];

    for path in paths {
        let candidate = PathBuf::from(path);
        if path == "ffmpeg" {
            if Command::new("which")
                .arg("ffmpeg")
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
            {
                return Some(candidate);
            }
        } else if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

fn get_ffmpeg_version_from_path(path: &str) -> Option<String> {
    if let Ok(output) = Command::new(path).arg("-version").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = stdout.lines().next() {
                if let Some(version_part) = line.strip_prefix("ffmpeg version ") {
                    return Some(
                        version_part
                            .split_whitespace()
                            .next()
                            .unwrap_or("")
                            .to_string(),
                    );
                }
            }
        }
    }
    None
}

#[tauri::command]
pub fn clear_frame_cache() -> Result<u32, String> {
    let mut cache = FRAME_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let count = cache.entries.len() as u32;
    cache.entries.clear();
    Ok(count)
}

#[tauri::command]
pub fn get_frame_cache_stats() -> Result<serde_json::Value, String> {
    let cache = FRAME_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(serde_json::json!({
        "entry_count": cache.entries.len(),
        "max_entries": cache.max_entries,
        "ttl_seconds": cache.ttl.as_secs(),
        "recorder_enabled": false,
    }))
}

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

#[tauri::command]
pub fn save_recorder_config_cmd(config: RecorderConfig) -> Result<(), String> {
    let config_path = get_recorder_config_path();
    if let Some(parent) = config_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn clear_recorder_config_cmd() -> Result<(), String> {
    let config_path = get_recorder_config_path();
    if config_path.exists() {
        std::fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove config: {}", e))?;
    }
    Ok(())
}

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
