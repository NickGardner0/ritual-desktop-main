//! iPhone Screen Time import via Apple's Biome App.InFocus stream.
//!
//! The scanner is intentionally best-effort: if Biome is unavailable, Full
//! Disk Access is missing, or parsing fails for a file, the normal Mac watcher
//! continues unaffected. Parsed intervals are written to a disk JSONL outbox
//! drained by the main Tauri app.

mod outbox;
mod protobuf;
mod segb;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tracing::{debug, info, warn};

pub use outbox::{BiomeActivityEvent, BiomeOutbox};

const SCAN_INTERVAL: Duration = Duration::from_secs(30 * 60);
const APPLE_EPOCH_OFFSET_SECONDS: f64 = 978_307_200.0;

pub struct BiomeScanner {
    _join: std::thread::JoinHandle<()>,
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
            warn!("Failed to open Biome iPhone outbox: {}. Scanner disabled.", error);
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

    let mut bookmarks = BiomeBookmarks::load().unwrap_or_default();
    let devices = discover_ios_devices(&base);
    let mut total_added = 0usize;

    for device_id in devices {
        let files = device_stream_files(&base, &device_id)?;
        if files.is_empty() {
            continue;
        }
        let records = read_device_records(&files);
        let intervals = stitch_intervals(&device_id, records);
        let last_end = bookmarks.last_end_ms(&device_id);
        let new_events: Vec<BiomeActivityEvent> = intervals
            .into_iter()
            .filter(|event| event.ts_end > last_end)
            .collect();
        if new_events.is_empty() {
            continue;
        }
        let next_last_end = new_events
            .iter()
            .map(|event| event.ts_end)
            .max()
            .unwrap_or(last_end);
        let added = outbox
            .enqueue_many(new_events)
            .map_err(|error| format!("write Biome outbox: {error}"))?;
        bookmarks.set_last_end_ms(&device_id, next_last_end);
        total_added += added;
        info!(device_id = %device_id, added, "Queued Biome iPhone activity events");
    }

    bookmarks.save()?;
    Ok(total_added)
}

#[derive(Debug, Clone)]
struct FocusRecord {
    device_id: String,
    source_file: String,
    app_bundle_id: String,
    in_foreground: bool,
    ts_ms: i64,
    app_version: Option<String>,
    app_build: Option<String>,
    transition_reason: Option<String>,
}

fn read_device_records(files: &[PathBuf]) -> Vec<FocusRecord> {
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
                        app_version: record.event.app_version,
                        app_build: record.event.app_build,
                        transition_reason: record.event.transition_reason,
                    });
                }
            }
            Err(error) => {
                debug!(path = %file.display(), error = %error, "Skipping Biome file");
            }
        }
    }
    records.sort_by_key(|record| record.ts_ms);
    records
}

fn stitch_intervals(device_id: &str, records: Vec<FocusRecord>) -> Vec<BiomeActivityEvent> {
    let mut events = Vec::new();
    let mut current: Option<FocusRecord> = None;

    for record in records {
        if record.app_bundle_id.trim().is_empty() {
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
                    events.push(event_from_interval(device_id, &open, record.ts_ms));
                }
            }
        }

        if record.in_foreground {
            current = Some(record);
        } else {
            current = None;
        }
    }

    events
}

fn event_from_interval(device_id: &str, start: &FocusRecord, ts_end: i64) -> BiomeActivityEvent {
    let app_name = app_name_from_bundle(&start.app_bundle_id);
    BiomeActivityEvent {
        event_uid: Some(format!(
            "biome:{}:{}:{}:{}",
            device_id, start.app_bundle_id, start.ts_ms, ts_end
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

#[derive(Debug, Default, Serialize, Deserialize)]
struct BiomeBookmarks {
    devices: std::collections::HashMap<String, i64>,
}

impl BiomeBookmarks {
    fn load() -> Result<Self, String> {
        let path = bookmarks_path();
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("read Biome bookmarks: {error}"))?;
        serde_json::from_str(&raw).map_err(|error| format!("parse Biome bookmarks: {error}"))
    }

    fn save(&self) -> Result<(), String> {
        let path = bookmarks_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create Biome bookmark dir: {error}"))?;
        }
        let raw = serde_json::to_string(self)
            .map_err(|error| format!("encode Biome bookmarks: {error}"))?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, raw).map_err(|error| format!("write Biome bookmarks: {error}"))?;
        fs::rename(&tmp, &path).map_err(|error| format!("replace Biome bookmarks: {error}"))
    }

    fn last_end_ms(&self, device_id: &str) -> i64 {
        self.devices.get(device_id).copied().unwrap_or(0)
    }

    fn set_last_end_ms(&mut self, device_id: &str, value: i64) {
        self.devices.insert(device_id.to_string(), value);
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
    home_dir()
        .join("Library")
        .join("Application Support")
        .join("Ritual")
        .join("biome_scan_bookmarks.json")
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn cf_absolute_to_unix_ms(value: f64) -> i64 {
    ((value + APPLE_EPOCH_OFFSET_SECONDS) * 1000.0).round() as i64
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(bundle: &str, foreground: bool, ts: i64) -> FocusRecord {
        FocusRecord {
            device_id: "iphone".to_string(),
            source_file: "iphone/file".to_string(),
            app_bundle_id: bundle.to_string(),
            in_foreground: foreground,
            ts_ms: ts,
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
        );
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].app_name, "Messages");
        assert_eq!(events[0].ts_start, 100);
        assert_eq!(events[0].ts_end, 250);
        assert_eq!(events[1].app_name, "YouTube");
        assert_eq!(events[1].ts_start, 300);
        assert_eq!(events[1].ts_end, 500);
    }

    #[test]
    fn converts_cf_absolute_time() {
        assert_eq!(cf_absolute_to_unix_ms(0.0), 978_307_200_000);
    }
}
