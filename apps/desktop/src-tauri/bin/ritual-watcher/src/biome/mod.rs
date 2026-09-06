//! iPhone Screen Time import via Apple's Biome App.InFocus stream.
//!
//! The scanner is intentionally best-effort: if Biome is unavailable, Full
//! Disk Access is missing, or parsing fails for a file, the normal Mac watcher
//! continues unaffected. Parsed intervals are appended to the shared activity
//! database outbox and drained by the main Tauri app.

mod outbox;
mod protobuf;
mod segb;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::{debug, info, warn};

pub use outbox::{BiomeActivityEvent, BiomeOutbox};

const SCAN_INTERVAL: Duration = Duration::from_secs(30 * 60);
const APPLE_EPOCH_OFFSET_SECONDS: f64 = 978_307_200.0;
const MAX_PROVISIONAL_INTERVAL_MS: i64 = 2 * 60 * 60 * 1000;
const RECENT_OPEN_SOURCE_WINDOW_MS: i64 = 45 * 60 * 1000;
const IGNORED_BIOME_BUNDLE_IDS: &[&str] = &[
    "com.apple.carplaysplashscreen",
    "com.apple.control-center",
    "com.apple.screenshotservicesservice",
    "com.apple.sleeplockscreen",
];
const IGNORED_BIOME_BUNDLE_PREFIXES: &[&str] = &["com.apple.springboard"];

pub struct BiomeScanner {
    _join: std::thread::JoinHandle<()>,
}

#[derive(Debug, Serialize)]
pub struct BiomeSourceDeviceReport {
    pub device_id: String,
    pub source_file_count: usize,
    pub parsed_record_count: usize,
    pub stitched_interval_count: usize,
    pub source_bytes: u64,
    pub first_event_start_ms: Option<i64>,
    pub last_event_end_ms: Option<i64>,
    pub sample_events: Vec<BiomeActivityEvent>,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct BiomeSourceReport {
    pub generated_at_ms: i64,
    pub home: String,
    pub app_in_focus_remote_path: String,
    pub app_in_focus_remote_exists: bool,
    pub ios_device_ids: Vec<String>,
    pub device_folder_ids: Vec<String>,
    pub devices: Vec<BiomeSourceDeviceReport>,
    pub total_source_file_count: usize,
    pub total_parsed_record_count: usize,
    pub total_stitched_interval_count: usize,
    pub notes: Vec<String>,
}

impl BiomeScanner {
    pub fn spawn() -> Option<Self> {
        if env_flag_enabled("RITUAL_DISABLE_BIOME_IPHONE_TRACKING") {
            info!("📱 Biome iPhone scanner disabled by environment");
            return None;
        }
        let join = std::thread::Builder::new()
            .name("ritual-biome-iphone".to_string())
            .spawn(run_scanner)
            .expect("failed to spawn Biome scanner thread");
        Some(Self { _join: join })
    }
}

fn run_scanner() {
    info!("📱 Biome iPhone scanner starting");
    let outbox = match BiomeOutbox::load() {
        Ok(outbox) => outbox,
        Err(error) => {
            warn!(
                "Failed to open Biome iPhone outbox: {}. Scanner disabled.",
                error
            );
            return;
        }
    };

    if let Err(error) = scan_once(&outbox) {
        warn!("Initial Biome iPhone scan failed: {}", error);
    }

    loop {
        std::thread::sleep(SCAN_INTERVAL);
        if let Err(error) = scan_once(&outbox) {
            warn!("Biome iPhone scan failed: {}", error);
        }
    }
}

fn scan_once(outbox: &BiomeOutbox) -> Result<usize, String> {
    let base = app_in_focus_remote_dir();
    if !base.exists() {
        debug!("Biome App.InFocus remote dir missing at {}", base.display());
        return Ok(0);
    }

    let bookmarks = BiomeBookmarks::load().unwrap_or_default();
    let devices = discover_ios_devices(&base);
    let mut total_added = 0usize;
    let scan_now_ms = now_ms();

    for device_id in devices {
        let files = device_stream_files(&base, &device_id)?;
        if files.is_empty() {
            continue;
        }
        let records = read_device_records(&files);
        let intervals = stitch_intervals(&device_id, records, scan_now_ms);
        let last_end = bookmarks.last_end_ms(&device_id);
        let new_events: Vec<BiomeActivityEvent> = intervals
            .into_iter()
            .filter(|event| event.ts_end > last_end)
            .collect();
        if new_events.is_empty() {
            continue;
        }
        let added = outbox
            .enqueue_many(new_events)
            .map_err(|error| format!("write Biome outbox: {error}"))?;
        total_added += added;
        info!(device_id = %device_id, added, "Queued Biome iPhone activity events");
    }

    Ok(total_added)
}

pub fn build_source_report() -> BiomeSourceReport {
    let base = app_in_focus_remote_dir();
    let ios_device_ids = read_ios_devices_from_sync_db();
    let device_folder_ids = if base.exists() {
        read_device_dirs(&base)
    } else {
        Vec::new()
    };
    let mut all_devices = ios_device_ids.clone();
    all_devices.extend(device_folder_ids.iter().cloned());
    all_devices.sort();
    all_devices.dedup();

    let scan_now_ms = now_ms();
    let devices: Vec<BiomeSourceDeviceReport> = all_devices
        .iter()
        .map(|device_id| build_source_device_report(&base, device_id, scan_now_ms))
        .collect();
    let total_source_file_count = devices.iter().map(|device| device.source_file_count).sum();
    let total_parsed_record_count = devices
        .iter()
        .map(|device| device.parsed_record_count)
        .sum();
    let total_stitched_interval_count = devices
        .iter()
        .map(|device| device.stitched_interval_count)
        .sum();
    let mut notes = Vec::new();
    if !base.exists() {
        notes.push("App.InFocus remote directory is missing for this macOS user.".to_string());
    } else if total_source_file_count == 0 {
        notes.push(
            "App.InFocus remote directory exists but contains no readable source files."
                .to_string(),
        );
    } else if total_stitched_interval_count == 0 {
        notes.push("Source files exist, but Ritual did not decode any foreground intervals. Parser or source format needs review.".to_string());
    } else {
        notes.push(
            "Ritual decoded Biome App.InFocus intervals from this macOS account.".to_string(),
        );
    }

    BiomeSourceReport {
        generated_at_ms: scan_now_ms,
        home: home_dir().display().to_string(),
        app_in_focus_remote_path: base.display().to_string(),
        app_in_focus_remote_exists: base.exists(),
        ios_device_ids,
        device_folder_ids,
        devices,
        total_source_file_count,
        total_parsed_record_count,
        total_stitched_interval_count,
        notes,
    }
}

pub fn write_source_report(output: &Path) -> Result<(), String> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create Biome diagnostics output dir: {error}"))?;
    }
    let report = build_source_report();
    let body = serde_json::to_string_pretty(&report)
        .map_err(|error| format!("encode Biome diagnostics report: {error}"))?;
    fs::write(output, format!("{body}\n"))
        .map_err(|error| format!("write Biome diagnostics report: {error}"))
}

pub fn write_export_jsonl(output: &Path) -> Result<usize, String> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create Biome export output dir: {error}"))?;
    }
    let events = collect_export_events()?;
    let mut body = String::new();
    for event in &events {
        let line = serde_json::to_string(event)
            .map_err(|error| format!("encode Biome export event: {error}"))?;
        body.push_str(&line);
        body.push('\n');
    }
    fs::write(output, body).map_err(|error| format!("write Biome export JSONL: {error}"))?;
    Ok(events.len())
}

fn collect_export_events() -> Result<Vec<BiomeActivityEvent>, String> {
    let base = app_in_focus_remote_dir();
    if !base.exists() {
        return Ok(Vec::new());
    }
    let scan_now_ms = now_ms();
    let mut events = Vec::new();
    for device_id in discover_ios_devices(&base) {
        let files = device_stream_files(&base, &device_id)?;
        let records = read_device_records(&files);
        events.extend(stitch_intervals(&device_id, records, scan_now_ms));
    }
    events.sort_by_key(|event| (event.ts_start, event.ts_end));
    Ok(events)
}

fn build_source_device_report(
    base: &Path,
    device_id: &str,
    scan_now_ms: i64,
) -> BiomeSourceDeviceReport {
    let mut errors = Vec::new();
    let files = match device_stream_files(base, device_id) {
        Ok(files) => files,
        Err(error) => {
            errors.push(error);
            Vec::new()
        }
    };
    let source_bytes = files
        .iter()
        .filter_map(|file| file.metadata().ok().map(|metadata| metadata.len()))
        .sum();
    let records = read_device_records_with_errors(&files, &mut errors);
    let parsed_record_count = records.len();
    let events = stitch_intervals(device_id, records, scan_now_ms);
    let first_event_start_ms = events.iter().map(|event| event.ts_start).min();
    let last_event_end_ms = events.iter().map(|event| event.ts_end).max();
    let sample_events = events.iter().take(10).cloned().collect();

    BiomeSourceDeviceReport {
        device_id: device_id.to_string(),
        source_file_count: files.len(),
        parsed_record_count,
        stitched_interval_count: events.len(),
        source_bytes,
        first_event_start_ms,
        last_event_end_ms,
        sample_events,
        errors,
    }
}

#[derive(Debug, Clone)]
struct FocusRecord {
    device_id: String,
    source_file: String,
    app_bundle_id: String,
    in_foreground: bool,
    ts_ms: i64,
    source_mtime_ms: Option<i64>,
    app_version: Option<String>,
    app_build: Option<String>,
    transition_reason: Option<String>,
}

fn read_device_records(files: &[PathBuf]) -> Vec<FocusRecord> {
    let mut errors = Vec::new();
    read_device_records_with_errors(files, &mut errors)
}

fn read_device_records_with_errors(
    files: &[PathBuf],
    errors: &mut Vec<String>,
) -> Vec<FocusRecord> {
    let mut records = Vec::new();
    for file in files {
        let Some(device_id) = file
            .parent()
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        let source_file = file
            .file_name()
            .and_then(|value| value.to_str())
            .map(|name| format!("{device_id}/{name}"))
            .unwrap_or_else(|| device_id.clone());
        let source_mtime_ms = file
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(system_time_ms);
        match segb::read_app_in_focus_records(file) {
            Ok(parsed) => {
                for record in parsed {
                    let Some(bundle_id) = record.event.bundle_id.clone() else {
                        continue;
                    };
                    let Some(cf_time) = record.event.cf_absolute_time else {
                        continue;
                    };
                    records.push(FocusRecord {
                        device_id: device_id.clone(),
                        source_file: source_file.clone(),
                        app_bundle_id: bundle_id,
                        in_foreground: record.event.in_foreground,
                        ts_ms: cf_absolute_to_unix_ms(cf_time),
                        source_mtime_ms,
                        app_version: record.event.app_version,
                        app_build: record.event.app_build,
                        transition_reason: record.event.transition_reason,
                    });
                }
            }
            Err(error) => {
                debug!(path = %file.display(), error = %error, "Skipping Biome file");
                errors.push(format!("{}: {}", file.display(), error));
            }
        }
    }
    records.sort_by_key(|record| record.ts_ms);
    records
}

fn stitch_intervals(
    device_id: &str,
    records: Vec<FocusRecord>,
    scan_now_ms: i64,
) -> Vec<BiomeActivityEvent> {
    let mut events = Vec::new();
    let mut current: Option<FocusRecord> = None;

    for record in records {
        if record.app_bundle_id.trim().is_empty() {
            continue;
        }

        if is_ignored_biome_bundle(&record.app_bundle_id) {
            if record.in_foreground {
                if let Some(open) = current.take() {
                    if record.ts_ms > open.ts_ms {
                        events.push(event_from_interval(device_id, &open, record.ts_ms, false));
                    }
                }
            }
            continue;
        }

        if record.in_foreground
            && current
                .as_ref()
                .map(|item| item.app_bundle_id == record.app_bundle_id)
                .unwrap_or(false)
        {
            continue;
        }

        let should_close = current.as_ref().is_some_and(|item| {
            (!record.in_foreground && item.app_bundle_id == record.app_bundle_id)
                || (record.in_foreground && item.app_bundle_id != record.app_bundle_id)
        });

        if should_close {
            if let Some(open) = current.take() {
                if record.ts_ms > open.ts_ms {
                    events.push(event_from_interval(device_id, &open, record.ts_ms, false));
                }
            }
        }

        if record.in_foreground {
            current = Some(record);
        } else {
            current = None;
        }
    }

    if let Some(open) = current {
        let source_is_recent = scan_now_ms.saturating_sub(open.ts_ms)
            <= RECENT_OPEN_SOURCE_WINDOW_MS
            || open
                .source_mtime_ms
                .map(|mtime| scan_now_ms.saturating_sub(mtime) <= RECENT_OPEN_SOURCE_WINDOW_MS)
                .unwrap_or(false);
        if source_is_recent {
            let bounded_end =
                scan_now_ms.min(open.ts_ms.saturating_add(MAX_PROVISIONAL_INTERVAL_MS));
            if bounded_end > open.ts_ms {
                events.push(event_from_interval(device_id, &open, bounded_end, true));
            }
        }
    }

    events
}

fn is_ignored_biome_bundle(bundle_id: &str) -> bool {
    let normalized = bundle_id.trim().to_ascii_lowercase();
    IGNORED_BIOME_BUNDLE_IDS.contains(&normalized.as_str())
        || IGNORED_BIOME_BUNDLE_PREFIXES
            .iter()
            .any(|prefix| normalized == *prefix || normalized.starts_with(&format!("{prefix}.")))
}

fn event_from_interval(
    device_id: &str,
    start: &FocusRecord,
    ts_end: i64,
    provisional: bool,
) -> BiomeActivityEvent {
    let app_name = app_name_from_bundle(&start.app_bundle_id);
    BiomeActivityEvent {
        event_uid: Some(format!(
            "biome:{}:{}:{}",
            device_id, start.app_bundle_id, start.ts_ms
        )),
        device_id: start.device_id.clone(),
        app_bundle_id: start.app_bundle_id.clone(),
        app_name: app_name.clone(),
        ts_start: start.ts_ms,
        ts_end,
        window_title: Some(app_name),
        browser_url: None,
        browser_domain: None,
        is_incognito: false,
        source_file: Some(start.source_file.clone()),
        app_version: start.app_version.clone(),
        app_build: start.app_build.clone(),
        transition_reason: start.transition_reason.clone(),
        biome_is_provisional: provisional,
    }
}

fn app_name_from_bundle(bundle_id: &str) -> String {
    match bundle_id {
        "com.apple.MobileSMS" => "Messages".to_string(),
        "com.apple.mobilesafari" => "Safari".to_string(),
        "com.google.chrome.ios" => "Google Chrome".to_string(),
        "com.google.ios.youtube" => "YouTube".to_string(),
        "com.burbn.instagram" => "Instagram".to_string(),
        "com.reddit.Reddit" => "Reddit".to_string(),
        "com.atebits.Tweetie2" => "X".to_string(),
        "com.openai.chat" => "ChatGPT".to_string(),
        "com.whoop.iphone" => "WHOOP".to_string(),
        "com.apple.mobiletimer" => "Clock".to_string(),
        "com.apple.Preferences" => "Settings".to_string(),
        "com.apple.mobileslideshow" => "Photos".to_string(),
        "com.apple.camera" => "Camera".to_string(),
        "com.apple.mobilephone" => "Phone".to_string(),
        "com.apple.Maps" => "Apple Maps".to_string(),
        "com.apple.mobilenotes" => "Notes".to_string(),
        "com.linkedin.LinkedIn" => "LinkedIn".to_string(),
        "net.kortina.labs.Venmo" => "Venmo".to_string(),
        "com.withopal.opal" => "Opal".to_string(),
        _ => bundle_id
            .rsplit('.')
            .next()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(bundle_id)
            .to_string(),
    }
}

fn discover_ios_devices(base: &Path) -> Vec<String> {
    let mut devices = read_ios_devices_from_sync_db();
    if devices.is_empty() {
        devices = read_device_dirs(base);
    } else {
        let present: HashSet<String> = read_device_dirs(base).into_iter().collect();
        devices.retain(|device_id| present.contains(device_id));
    }
    devices.sort();
    devices.dedup();
    devices
}

fn read_ios_devices_from_sync_db() -> Vec<String> {
    let db_path = home_dir()
        .join("Library")
        .join("Biome")
        .join("sync")
        .join("sync.db");
    if !db_path.exists() {
        return Vec::new();
    }
    let output = Command::new("/usr/bin/sqlite3")
        .arg("-readonly")
        .arg("-json")
        .arg(db_path)
        .arg("SELECT device_identifier FROM DevicePeer WHERE platform = 2")
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    #[derive(Deserialize)]
    struct Row {
        device_identifier: String,
    }
    serde_json::from_slice::<Vec<Row>>(&output.stdout)
        .unwrap_or_default()
        .into_iter()
        .map(|row| row.device_identifier)
        .filter(|value| !value.trim().is_empty())
        .collect()
}

fn read_device_dirs(base: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(base) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            path.file_name()
                .and_then(|value| value.to_str())
                .map(str::to_string)
        })
        .collect()
}

fn device_stream_files(base: &Path, device_id: &str) -> Result<Vec<PathBuf>, String> {
    let dir = base.join(device_id);
    let entries = fs::read_dir(&dir)
        .map_err(|error| format!("read Biome device dir {}: {error}", dir.display()))?;
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .map(|name| !name.starts_with('.') && name != "lock")
                .unwrap_or(false)
        })
        .collect();
    files.sort_by_key(|path| {
        path.metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    Ok(files)
}

#[derive(Debug, Default, Deserialize)]
struct BiomeBookmarks {
    devices: HashMap<String, i64>,
}

impl BiomeBookmarks {
    fn load() -> Result<Self, String> {
        let database_path = crate::paths::data_dir().join("activity.db");
        let database =
            ritual_db::blocking::BlockingDatabase::open_activity_db_with_env(database_path)
                .map_err(|error| error.to_string())?;
        let mut devices = database
            .biome_delivery_cursors()
            .map_err(|error| error.to_string())?;
        let legacy_path = bookmarks_path();
        if devices.is_empty() && legacy_path.exists() {
            let legacy = Self::load_from(&legacy_path)?;
            for (source_key, committed_ts) in &legacy.devices {
                database
                    .advance_biome_delivery_cursor(source_key, *committed_ts)
                    .map_err(|error| error.to_string())?;
            }
            devices = legacy.devices;
            fs::rename(&legacy_path, legacy_path.with_extension("json.migrated"))
                .map_err(|error| format!("archive Biome bookmarks: {error}"))?;
        }
        Ok(Self { devices })
    }

    fn load_from(path: &Path) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw =
            fs::read_to_string(&path).map_err(|error| format!("read Biome bookmarks: {error}"))?;
        Self::from_json(&raw)
    }

    fn from_json(raw: &str) -> Result<Self, String> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum CursorFile {
            Plain(HashMap<String, i64>),
            Wrapped { devices: HashMap<String, i64> },
        }

        match serde_json::from_str::<CursorFile>(raw)
            .map_err(|error| format!("parse Biome bookmarks: {error}"))?
        {
            CursorFile::Plain(devices) => Ok(Self { devices }),
            CursorFile::Wrapped { devices } => Ok(Self { devices }),
        }
    }

    fn last_end_ms(&self, device_id: &str) -> i64 {
        self.devices.get(device_id).copied().unwrap_or(0)
    }
}

fn app_in_focus_remote_dir() -> PathBuf {
    home_dir()
        .join("Library")
        .join("Biome")
        .join("streams")
        .join("restricted")
        .join("App.InFocus")
        .join("remote")
}

fn bookmarks_path() -> PathBuf {
    crate::paths::auxiliary_data_dir().join("biome_committed_cursors.json")
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn cf_absolute_to_unix_ms(value: f64) -> i64 {
    ((value + APPLE_EPOCH_OFFSET_SECONDS) * 1000.0).round() as i64
}

fn now_ms() -> i64 {
    system_time_ms(SystemTime::now()).unwrap_or(0)
}

fn system_time_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn record(bundle: &str, foreground: bool, ts: i64) -> FocusRecord {
        FocusRecord {
            device_id: "iphone".to_string(),
            source_file: "iphone/file".to_string(),
            app_bundle_id: bundle.to_string(),
            in_foreground: foreground,
            ts_ms: ts,
            source_mtime_ms: None,
            app_version: None,
            app_build: None,
            transition_reason: None,
        }
    }

    #[test]
    fn stitch_closes_on_loss_and_switch() {
        let events = stitch_intervals(
            "iphone",
            vec![
                record("com.apple.MobileSMS", true, 100),
                record("com.apple.MobileSMS", false, 250),
                record("com.google.ios.youtube", true, 300),
                record("com.burbn.instagram", true, 500),
            ],
            500 + RECENT_OPEN_SOURCE_WINDOW_MS + 1,
        );
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].app_name, "Messages");
        assert_eq!(events[0].ts_start, 100);
        assert_eq!(events[0].ts_end, 250);
        assert_eq!(events[1].app_name, "YouTube");
        assert_eq!(events[1].ts_start, 300);
        assert_eq!(events[1].ts_end, 500);
        assert!(!events[1].biome_is_provisional);
    }

    #[test]
    fn stitch_closes_current_interval_on_ignored_system_foreground() {
        let events = stitch_intervals(
            "iphone",
            vec![
                record("com.apple.MobileSMS", true, 100),
                record("com.apple.SleepLockScreen", true, 250),
                record("com.apple.SleepLockScreen", false, 300),
                record("com.google.ios.youtube", true, 400),
                record("com.google.ios.youtube", false, 600),
            ],
            1_000,
        );

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].app_bundle_id, "com.apple.MobileSMS");
        assert_eq!(events[0].ts_end, 250);
        assert_eq!(events[1].app_bundle_id, "com.google.ios.youtube");
    }

    #[test]
    fn stitch_ignores_springboard_prefix_and_system_ui() {
        let events = stitch_intervals(
            "iphone",
            vec![
                record("com.apple.springboard.home-screen-open-folder", true, 100),
                record("com.apple.ScreenshotServicesService", true, 200),
                record("com.google.ios.youtube", true, 300),
                record("com.apple.control-center", true, 450),
                record("com.google.chrome.ios", true, 600),
                record("com.google.chrome.ios", false, 900),
            ],
            1_000,
        );

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].app_bundle_id, "com.google.ios.youtube");
        assert_eq!(events[0].ts_start, 300);
        assert_eq!(events[0].ts_end, 450);
        assert_eq!(events[1].app_bundle_id, "com.google.chrome.ios");
    }

    #[test]
    fn stitch_emits_bounded_recent_open_interval() {
        let events = stitch_intervals(
            "iphone",
            vec![record("com.openai.chat", true, 1_000)],
            1_000 + MAX_PROVISIONAL_INTERVAL_MS + 10_000,
        );
        assert_eq!(events.len(), 0);

        let mut recent = record("com.openai.chat", true, 1_000);
        recent.source_mtime_ms = Some(1_000 + MAX_PROVISIONAL_INTERVAL_MS + 10_000);
        let events = stitch_intervals(
            "iphone",
            vec![recent],
            1_000 + MAX_PROVISIONAL_INTERVAL_MS + 10_000,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].ts_end, 1_000 + MAX_PROVISIONAL_INTERVAL_MS);
        assert!(events[0].biome_is_provisional);
    }

    #[test]
    fn event_uid_is_stable_when_end_changes() {
        let record = record("com.openai.chat", true, 1_000);
        let first = event_from_interval("iphone", &record, 2_000, true);
        let second = event_from_interval("iphone", &record, 3_000, false);
        assert_eq!(first.event_uid, second.event_uid);
    }

    #[test]
    fn sanitized_segb_fixture_parses_and_stitches() {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir()
            .join(format!("ritual-biome-fixture-{}-{}", std::process::id(), n))
            .join("iphone-fixture");
        fs::create_dir_all(&dir).expect("create fixture dir");
        let path = dir.join("app_in_focus.segb");
        let bytes = hex::decode(include_str!("fixtures/app_in_focus_v2.hex").trim())
            .expect("decode fixture");
        fs::write(&path, bytes).expect("write fixture");

        let records = read_device_records(&[path]);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].app_bundle_id, "com.apple.MobileSMS");
        let events = stitch_intervals("iphone-fixture", records, cf_absolute_to_unix_ms(1200.0));
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].app_name, "Messages");
        assert_eq!(
            events[0].event_uid.as_deref(),
            Some("biome:iphone-fixture:com.apple.MobileSMS:978308200000")
        );
        assert!(!events[0].biome_is_provisional);
    }

    #[test]
    fn converts_cf_absolute_time() {
        assert_eq!(cf_absolute_to_unix_ms(0.0), 978_307_200_000);
    }

    #[test]
    fn bookmarks_read_plain_committed_cursor_shape() {
        let parsed = BiomeBookmarks::from_json(r#"{"iphone-a":1234,"iphone-b":5678}"#)
            .expect("parse plain cursors");

        assert_eq!(parsed.last_end_ms("iphone-a"), 1234);
        assert_eq!(parsed.last_end_ms("iphone-b"), 5678);
    }

    #[test]
    fn bookmarks_read_legacy_wrapped_cursor_shape() {
        let parsed = BiomeBookmarks::from_json(r#"{"devices":{"iphone-a":1234}}"#)
            .expect("parse wrapped cursors");

        assert_eq!(parsed.last_end_ms("iphone-a"), 1234);
    }
}
