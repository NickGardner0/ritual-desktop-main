use super::location_outbox::{append_quarantine_records, quarantine_text};
use super::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn biome_outbox_path() -> Option<PathBuf> {
    Some(crate::app_paths::auxiliary_data_dir().join("biome_iphone_events.jsonl"))
}

fn biome_sync_db_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join("Library")
            .join("Biome")
            .join("sync")
            .join("sync.db")
    })
}

fn biome_app_in_focus_remote_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join("Library")
            .join("Biome")
            .join("streams")
            .join("restricted")
            .join("App.InFocus")
            .join("remote")
    })
}

fn biome_committed_cursors_path() -> Option<PathBuf> {
    Some(crate::app_paths::auxiliary_data_dir().join("biome_committed_cursors.json"))
}

fn path_string(path: &Path) -> String {
    path.display().to_string()
}

fn system_time_to_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn is_biome_source_file(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|name| !name.starts_with('.') && name != "lock")
            .unwrap_or(false)
}

fn read_biome_ios_device_peers(sync_db_path: &Path) -> Result<Vec<String>, String> {
    if !sync_db_path.exists() {
        return Ok(Vec::new());
    }
    let conn = rusqlite::Connection::open_with_flags(
        sync_db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("open Biome sync.db: {error}"))?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT device_identifier FROM DevicePeer WHERE platform = 2")
        .map_err(|error| format!("prepare Biome DevicePeer query: {error}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("query Biome DevicePeer rows: {error}"))?;
    let mut devices = Vec::new();
    for row in rows {
        match row {
            Ok(value) if !value.trim().is_empty() => devices.push(value),
            Ok(_) => {}
            Err(error) => return Err(format!("read Biome DevicePeer row: {error}")),
        }
    }
    devices.sort();
    devices.dedup();
    Ok(devices)
}

fn read_biome_device_folders(remote_path: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(remote_path) else {
        return Vec::new();
    };
    let mut devices: Vec<String> = entries
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
        .collect();
    devices.sort();
    devices.dedup();
    devices
}

fn build_biome_device_diagnostics(remote_path: &Path, device_id: &str) -> BiomeDeviceDiagnostics {
    let device_path = remote_path.join(device_id);
    let mut file_count = 0usize;
    let mut bytes = 0u64;
    let mut newest_mtime: Option<i64> = None;
    let mut oldest_mtime: Option<i64> = None;

    if let Ok(entries) = fs::read_dir(&device_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !is_biome_source_file(&path) {
                continue;
            }
            file_count += 1;
            if let Ok(metadata) = entry.metadata() {
                bytes = bytes.saturating_add(metadata.len());
                if let Ok(modified) = metadata.modified() {
                    if let Some(ms) = system_time_to_ms(modified) {
                        newest_mtime = Some(newest_mtime.map(|value| value.max(ms)).unwrap_or(ms));
                        oldest_mtime = Some(oldest_mtime.map(|value| value.min(ms)).unwrap_or(ms));
                    }
                }
            }
        }
    }

    BiomeDeviceDiagnostics {
        device_id: device_id.to_string(),
        path: path_string(&device_path),
        path_exists: device_path.exists(),
        source_file_count: file_count,
        newest_source_file_mtime_ms: newest_mtime,
        oldest_source_file_mtime_ms: oldest_mtime,
        source_file_bytes: bytes,
    }
}

fn build_biome_outbox_diagnostics() -> BiomeOutboxDiagnostics {
    let Some(path) = biome_outbox_path() else {
        return BiomeOutboxDiagnostics::default();
    };
    let exists = path.exists();
    let bytes = path.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let read = if exists {
        read_biome_outbox(&path).ok()
    } else {
        None
    };

    BiomeOutboxDiagnostics {
        path: Some(path_string(&path)),
        exists,
        event_count: read.as_ref().map(|value| value.events.len()).unwrap_or(0),
        malformed_line_count: read
            .as_ref()
            .map(|value| value.malformed_lines.len())
            .unwrap_or(0),
        bytes,
    }
}

fn read_biome_drain_snapshot<R: Runtime>(app: &AppHandle<R>) -> BiomeDrainSnapshot {
    app.state::<DesktopShellState>()
        .biome_drain
        .lock()
        .expect("desktop biome drain state mutex poisoned")
        .clone()
}

fn write_biome_drain_snapshot<R: Runtime>(
    app: &AppHandle<R>,
    status: &str,
    processed_count: Option<usize>,
    error: Option<String>,
) {
    let state = app.state::<DesktopShellState>();
    let mut guard = state
        .biome_drain
        .lock()
        .expect("desktop biome drain state mutex poisoned");
    *guard = BiomeDrainSnapshot {
        last_checked_at_ms: Some(Utc::now().timestamp_millis()),
        last_status: Some(status.to_string()),
        last_processed_count: processed_count,
        last_error: error,
    };
}

pub fn build_biome_iphone_diagnostics<R: Runtime>(app: &AppHandle<R>) -> BiomeIphoneDiagnostics {
    let sync_db_path = biome_sync_db_path();
    let sync_db_exists = sync_db_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let (ios_devices, sync_db_error) = sync_db_path
        .as_deref()
        .map(read_biome_ios_device_peers)
        .map(|result| match result {
            Ok(devices) => (devices, None),
            Err(error) => (Vec::new(), Some(error)),
        })
        .unwrap_or_default();

    let remote_path = biome_app_in_focus_remote_path();
    let app_in_focus_remote_exists = remote_path
        .as_ref()
        .map(|path| path.exists())
        .unwrap_or(false);
    let folder_devices = remote_path
        .as_deref()
        .map(read_biome_device_folders)
        .unwrap_or_default();

    let mut all_devices = ios_devices.clone();
    all_devices.extend(folder_devices.iter().cloned());
    all_devices.sort();
    all_devices.dedup();

    let devices: Vec<BiomeDeviceDiagnostics> = remote_path
        .as_deref()
        .map(|base| {
            all_devices
                .iter()
                .map(|device_id| build_biome_device_diagnostics(base, device_id))
                .collect()
        })
        .unwrap_or_default();
    let source_file_count = devices.iter().map(|device| device.source_file_count).sum();

    let mut notes = Vec::new();
    if !sync_db_exists {
        notes.push("Biome sync.db is missing; macOS has not exposed synced Screen Time device metadata to this user account.".to_string());
    } else if ios_devices.is_empty() {
        notes.push("Biome sync.db exists, but no iOS DevicePeer rows were found. Check Screen Time Share Across Devices and iCloud sync.".to_string());
    }
    if !app_in_focus_remote_exists {
        notes.push("Biome App.InFocus remote directory is missing; no Mac-side iPhone foreground data is available to import.".to_string());
    } else if source_file_count == 0 {
        notes.push(
            "Biome App.InFocus remote directory exists, but contains no readable source files yet."
                .to_string(),
        );
    }
    if build_biome_outbox_diagnostics().malformed_line_count > 0 {
        notes.push("Biome outbox contains malformed rows; valid rows can still drain, malformed rows should be quarantined on drain/load.".to_string());
    }

    BiomeIphoneDiagnostics {
        sync_db_path: sync_db_path.as_ref().map(|path| path_string(path)),
        sync_db_exists,
        sync_db_error,
        ios_device_peer_count: ios_devices.len(),
        app_in_focus_remote_path: remote_path.as_ref().map(|path| path_string(path)),
        app_in_focus_remote_exists,
        device_folder_count: folder_devices.len(),
        source_file_count,
        devices,
        outbox: build_biome_outbox_diagnostics(),
        committed_cursors_path: biome_committed_cursors_path()
            .as_ref()
            .map(|path| path_string(path)),
        committed_cursors: read_biome_committed_cursors(),
        last_drain: read_biome_drain_snapshot(app),
        notes,
    }
}

pub(crate) fn biome_event_key(event: &DesktopBiomeActivityEvent) -> String {
    format!(
        "biome:{}:{}:{}",
        event.device_id, event.app_bundle_id, event.ts_start
    )
}

#[derive(Debug)]
pub(crate) struct BiomeOutboxRead {
    events: Vec<DesktopBiomeActivityEvent>,
    malformed_lines: Vec<String>,
}

pub(crate) fn read_biome_outbox(path: &PathBuf) -> Result<BiomeOutboxRead, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read Biome outbox: {error}"))?;
    let mut events = Vec::new();
    let mut malformed_lines = Vec::new();
    for (index, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<DesktopBiomeActivityEvent>(trimmed) {
            Ok(event) => events.push(event),
            Err(error) => malformed_lines.push(format!(
                "{{\"line\":{},\"error\":{},\"raw\":{}}}",
                index + 1,
                serde_json::to_string(&error.to_string())
                    .unwrap_or_else(|_| "\"parse error\"".to_string()),
                serde_json::to_string(trimmed).unwrap_or_else(|_| "\"\"".to_string())
            )),
        }
    }
    Ok(BiomeOutboxRead {
        events,
        malformed_lines,
    })
}

fn write_biome_outbox(path: &PathBuf, events: &[DesktopBiomeActivityEvent]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create Biome outbox dir: {error}"))?;
    }
    let mut body = String::new();
    for event in events {
        let line = serde_json::to_string(event)
            .map_err(|error| format!("Failed to encode Biome outbox event: {error}"))?;
        body.push_str(&line);
        body.push('\n');
    }
    let tmp = path.with_extension("jsonl.tmp");
    fs::write(&tmp, body).map_err(|error| format!("Failed to write Biome outbox: {error}"))?;
    fs::rename(&tmp, path).map_err(|error| format!("Failed to replace Biome outbox: {error}"))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomeImportResult {
    imported: usize,
    duplicates: usize,
    malformed: usize,
    outbox_event_count: usize,
    quarantine_path: Option<String>,
}

fn validate_biome_import_event(event: &DesktopBiomeActivityEvent) -> Result<(), String> {
    if event.device_id.trim().is_empty() {
        return Err("missing device_id".to_string());
    }
    if event.app_bundle_id.trim().is_empty() {
        return Err("missing app_bundle_id".to_string());
    }
    if event.app_name.trim().is_empty() {
        return Err("missing app_name".to_string());
    }
    if event.ts_end <= event.ts_start {
        return Err("ts_end must be greater than ts_start".to_string());
    }
    Ok(())
}

fn write_biome_import_quarantine(
    source_path: &Path,
    malformed_lines: &[String],
) -> Result<Option<String>, String> {
    if malformed_lines.is_empty() {
        return Ok(None);
    }
    let quarantine_path =
        source_path.with_extension(format!("malformed.{}.jsonl", Utc::now().timestamp_millis()));
    let body = malformed_lines.join("\n");
    fs::write(&quarantine_path, body)
        .map_err(|error| format!("Failed to write Biome import quarantine: {error}"))?;
    Ok(Some(path_string(&quarantine_path)))
}

pub(crate) fn import_biome_export_into_path(
    source_path: &Path,
    outbox_path: &PathBuf,
) -> Result<BiomeImportResult, String> {
    if !source_path.exists() {
        return Err(format!(
            "Biome export file does not exist: {}",
            path_string(source_path)
        ));
    }
    if !source_path.is_file() {
        return Err(format!(
            "Biome export path is not a file: {}",
            path_string(source_path)
        ));
    }

    let mut by_key: HashMap<String, DesktopBiomeActivityEvent> = HashMap::new();
    if outbox_path.exists() {
        let existing = read_biome_outbox(outbox_path)?;
        for event in existing.events {
            by_key.insert(biome_event_key(&event), event);
        }
        if !existing.malformed_lines.is_empty() {
            quarantine_text(
                outbox_path,
                "malformed",
                &existing.malformed_lines.join("\n"),
            )?;
        }
    }

    let raw = fs::read_to_string(source_path)
        .map_err(|error| format!("Failed to read Biome export file: {error}"))?;
    let mut imported = 0usize;
    let mut duplicates = 0usize;
    let mut malformed_lines = Vec::new();

    for (index, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<DesktopBiomeActivityEvent>(trimmed) {
            Ok(event) => match validate_biome_import_event(&event) {
                Ok(()) => {
                    let key = biome_event_key(&event);
                    if by_key.contains_key(&key) {
                        duplicates += 1;
                    } else {
                        by_key.insert(key, event);
                        imported += 1;
                    }
                }
                Err(reason) => malformed_lines.push(format!(
                    "{{\"line\":{},\"reason\":{},\"raw\":{}}}",
                    index + 1,
                    serde_json::to_string(&reason).unwrap_or_else(|_| "\"invalid\"".to_string()),
                    serde_json::to_string(trimmed).unwrap_or_else(|_| "\"\"".to_string())
                )),
            },
            Err(error) => malformed_lines.push(format!(
                "{{\"line\":{},\"reason\":{},\"raw\":{}}}",
                index + 1,
                serde_json::to_string(&error.to_string())
                    .unwrap_or_else(|_| "\"parse error\"".to_string()),
                serde_json::to_string(trimmed).unwrap_or_else(|_| "\"\"".to_string())
            )),
        }
    }

    let quarantine_path = write_biome_import_quarantine(source_path, &malformed_lines)?;
    let mut events: Vec<DesktopBiomeActivityEvent> = by_key.into_values().collect();
    events.sort_by_key(|event| (event.ts_start, event.ts_end, event.device_id.clone()));
    write_biome_outbox(outbox_path, &events)?;

    Ok(BiomeImportResult {
        imported,
        duplicates,
        malformed: malformed_lines.len(),
        outbox_event_count: events.len(),
        quarantine_path,
    })
}

pub(crate) fn import_biome_export_into_outbox(
    source_path: &Path,
) -> Result<BiomeImportResult, String> {
    let Some(outbox_path) = biome_outbox_path() else {
        return Err("Biome outbox path is unavailable".to_string());
    };
    import_biome_export_into_path(source_path, &outbox_path)
}

fn read_biome_committed_cursors() -> HashMap<String, i64> {
    let Some(path) = biome_committed_cursors_path() else {
        return HashMap::new();
    };
    if !path.exists() {
        return HashMap::new();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<HashMap<String, i64>>(&raw).ok())
        .unwrap_or_default()
}

fn write_biome_committed_cursors(cursors: &HashMap<String, i64>) -> Result<(), String> {
    let Some(path) = biome_committed_cursors_path() else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create Biome cursor dir: {error}"))?;
    }
    let raw = serde_json::to_string(cursors)
        .map_err(|error| format!("Failed to encode Biome committed cursors: {error}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, raw).map_err(|error| format!("Failed to write Biome cursors: {error}"))?;
    fs::rename(&tmp, path).map_err(|error| format!("Failed to replace Biome cursors: {error}"))
}

fn advance_biome_committed_cursors(events: &[DesktopBiomeActivityEvent]) -> Result<(), String> {
    if events.is_empty() {
        return Ok(());
    }
    let mut cursors = read_biome_committed_cursors();
    for event in events {
        let entry = cursors.entry(event.device_id.clone()).or_insert(0);
        *entry = (*entry).max(event.ts_end);
    }
    write_biome_committed_cursors(&cursors)
}

pub(crate) fn classify_biome_ack(
    parsed: &BiomeIngestResponse,
    chunk: &[DesktopBiomeActivityEvent],
) -> Result<
    (
        HashSet<String>,
        Vec<DesktopBiomeActivityEvent>,
        Vec<DesktopBiomeActivityEvent>,
    ),
    String,
> {
    let mut acknowledged: HashSet<String> = parsed
        .accepted_event_uids
        .iter()
        .chain(parsed.duplicate_event_uids.iter())
        .cloned()
        .collect();
    let rejected: HashSet<String> = parsed.rejected_event_uids.iter().cloned().collect();
    if acknowledged.is_empty() && rejected.is_empty() && parsed.rejected == 0 {
        acknowledged.extend(chunk.iter().map(biome_event_key));
    }
    if acknowledged.is_empty() && rejected.is_empty() && parsed.rejected > 0 {
        return Err(
            "Biome ingest returned rejections without event IDs; keeping outbox for retry"
                .to_string(),
        );
    }
    let rejected_records: Vec<DesktopBiomeActivityEvent> = chunk
        .iter()
        .filter(|event| rejected.contains(&biome_event_key(event)))
        .cloned()
        .collect();
    let mut processed_keys = HashSet::new();
    let mut committed_events = Vec::new();
    for event in chunk {
        let key = biome_event_key(event);
        if acknowledged.contains(&key) || rejected.contains(&key) {
            processed_keys.insert(key);
            committed_events.push(event.clone());
        }
    }
    Ok((processed_keys, rejected_records, committed_events))
}

fn drain_biome_outbox_blocking(auth_token: String, backend_base: String) -> Result<usize, String> {
    let Some(path) = biome_outbox_path() else {
        return Ok(0);
    };
    if !path.exists() {
        return Ok(0);
    }

    let read = read_biome_outbox(&path)?;
    if !read.malformed_lines.is_empty() {
        quarantine_text(&path, "malformed", &read.malformed_lines.join("\n"))?;
    }
    let events = read.events;
    if events.is_empty() {
        if !read.malformed_lines.is_empty() {
            write_biome_outbox(&path, &[])?;
        }
        return Ok(0);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Failed to create Biome outbox client: {error}"))?;
    let url = format!("{backend_base}/api/watcher/biome-ingest");
    let mut processed_keys: HashSet<String> = HashSet::new();
    let mut committed_events: Vec<DesktopBiomeActivityEvent> = Vec::new();

    for chunk in events.chunks(BIOME_OUTBOX_BATCH_SIZE) {
        let body = serde_json::to_string(&serde_json::json!({ "events": chunk }))
            .map_err(|error| format!("Failed to encode Biome ingest body: {error}"))?;
        let response = client
            .post(&url)
            .bearer_auth(&auth_token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .map_err(|error| format!("Failed to submit Biome outbox: {error}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("Biome outbox request failed with HTTP {status}"));
        }

        let body = response
            .text()
            .map_err(|error| format!("Failed to read Biome ingest response: {error}"))?;
        let parsed: BiomeIngestResponse = serde_json::from_str(&body)
            .map_err(|error| format!("Failed to parse Biome ingest response: {error}"))?;
        info!(
            accepted = parsed.accepted,
            rejected = parsed.rejected,
            duplicates = parsed.duplicates,
            count = chunk.len(),
            "Submitted Biome iPhone activity outbox batch"
        );

        let (chunk_processed_keys, rejected_records, chunk_committed_events) =
            classify_biome_ack(&parsed, chunk)?;
        append_quarantine_records(&path, "rejected", "backend_rejected", &rejected_records)?;
        processed_keys.extend(chunk_processed_keys);
        committed_events.extend(chunk_committed_events);
    }

    let remaining: Vec<DesktopBiomeActivityEvent> = events
        .into_iter()
        .filter(|event| !processed_keys.contains(&biome_event_key(event)))
        .collect();
    write_biome_outbox(&path, &remaining)?;
    advance_biome_committed_cursors(&committed_events)?;
    Ok(processed_keys.len())
}

pub(crate) async fn drain_biome_outbox_once<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<usize, String> {
    let auth_state = read_auth_state(&app);
    let auth_token = match auth_state.token.filter(|token| !token.trim().is_empty()) {
        Some(token) => token,
        None => {
            let error = "Auth token is unavailable for Biome outbox drain".to_string();
            write_biome_drain_snapshot(&app, "skipped", Some(0), Some(error.clone()));
            return Err(error);
        }
    };
    let backend_base = match auth_state
        .backend_base
        .filter(|base| !base.trim().is_empty())
    {
        Some(base) => base,
        None => {
            let error = "Backend base URL is unavailable for Biome outbox drain".to_string();
            write_biome_drain_snapshot(&app, "skipped", Some(0), Some(error.clone()));
            return Err(error);
        }
    };

    let result = tauri::async_runtime::spawn_blocking(move || {
        drain_biome_outbox_blocking(auth_token, backend_base)
    })
    .await
    .map_err(|error| format!("Biome outbox drain task failed: {error}"))
    .and_then(|result| result);

    match &result {
        Ok(count) => write_biome_drain_snapshot(&app, "success", Some(*count), None),
        Err(error) => write_biome_drain_snapshot(&app, "error", None, Some(error.clone())),
    }
    result
}

pub fn trigger_biome_outbox_drain<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        match drain_biome_outbox_once(app.clone()).await {
            Ok(count) if count > 0 => {
                info!(count, "Biome iPhone activity outbox drained");
            }
            Ok(_) => {}
            Err(error) => {
                if error.contains("HTTP 401") || error.contains("HTTP 403") {
                    request_token_refresh(&app);
                }
                warn!(error = %error, "Biome iPhone activity outbox drain skipped");
            }
        }
    });
}

pub fn register_biome_outbox_drain_worker<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        let mut interval =
            tokio::time::interval(Duration::from_secs(BIOME_OUTBOX_DRAIN_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            match drain_biome_outbox_once(app.clone()).await {
                Ok(count) if count > 0 => {
                    info!(
                        count,
                        "Biome iPhone activity outbox drained by background worker"
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    if error.contains("HTTP 401") || error.contains("HTTP 403") {
                        request_token_refresh(&app);
                    }
                    warn!(error = %error, "Biome iPhone activity background drain skipped");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_file(name: &str) -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = env::temp_dir().join(format!(
            "ritual-desktop-runtime-test-{}-{}",
            std::process::id(),
            n
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test directory");
        dir.join(name)
    }

    fn biome_event(event_uid: Option<&str>, ts_end: i64) -> DesktopBiomeActivityEvent {
        DesktopBiomeActivityEvent {
            event_uid: event_uid.map(str::to_string),
            device_id: "iphone".to_string(),
            app_bundle_id: "com.apple.MobileSMS".to_string(),
            app_name: "Messages".to_string(),
            ts_start: 1_000,
            ts_end,
            window_title: Some("Messages".to_string()),
            browser_url: None,
            browser_domain: None,
            is_incognito: false,
            source_file: Some("fixture.segb".to_string()),
            app_version: None,
            app_build: None,
            transition_reason: None,
            biome_is_provisional: false,
        }
    }

    fn biome_event_key_ignores_legacy_uid_and_end_time() {
        let legacy = biome_event(Some("old:iphone:messages:1000:2000"), 2_000);
        let newer = biome_event(Some("old:iphone:messages:1000:4000"), 4_000);

        assert_eq!(
            biome_event_key(&legacy),
            "biome:iphone:com.apple.MobileSMS:1000"
        );
        assert_eq!(biome_event_key(&legacy), biome_event_key(&newer));
    }

    #[test]
    fn read_biome_outbox_keeps_valid_rows_when_one_line_is_malformed() {
        let path = temp_file("biome_iphone_events.jsonl");
        let first = serde_json::to_string(&biome_event(Some("first"), 2_000)).unwrap();
        let second = serde_json::to_string(&biome_event(Some("second"), 3_000)).unwrap();
        fs::write(&path, format!("{first}\n{{bad-json\n{second}\n")).unwrap();

        let read = read_biome_outbox(&path).expect("read biome outbox");

        assert_eq!(read.events.len(), 2);
        assert_eq!(read.malformed_lines.len(), 1);
        assert!(read.malformed_lines[0].contains("bad-json"));
    }

    #[test]
    fn import_biome_export_accepts_valid_rows_and_dedupes_existing_events() {
        let outbox_path = temp_file("biome_iphone_events.jsonl");
        let export_path = temp_file("ritual-biome-iphone-export.jsonl");
        let existing = biome_event(Some("existing"), 2_000);
        let mut imported = biome_event(Some("imported"), 4_000);
        imported.app_bundle_id = "com.apple.mobilesafari".to_string();
        imported.app_name = "Safari".to_string();
        imported.ts_start = 3_000;
        imported.ts_end = 4_000;

        write_biome_outbox(&outbox_path, &[existing.clone()]).unwrap();
        fs::write(
            &export_path,
            format!(
                "{}\n{}\n",
                serde_json::to_string(&existing).unwrap(),
                serde_json::to_string(&imported).unwrap()
            ),
        )
        .unwrap();

        let result =
            import_biome_export_into_path(&export_path, &outbox_path).expect("import export");
        let outbox = read_biome_outbox(&outbox_path).expect("read imported outbox");

        assert_eq!(result.imported, 1);
        assert_eq!(result.duplicates, 1);
        assert_eq!(result.malformed, 0);
        assert_eq!(result.outbox_event_count, 2);
        assert!(result.quarantine_path.is_none());
        assert_eq!(outbox.events.len(), 2);
        assert!(outbox
            .events
            .iter()
            .any(|event| event.app_name == "Messages"));
        assert!(outbox.events.iter().any(|event| event.app_name == "Safari"));
        assert!(
            export_path.exists(),
            "bridge import must not delete the source export"
        );
    }

    #[test]
    fn import_biome_export_quarantines_malformed_rows_and_keeps_source_file() {
        let outbox_path = temp_file("biome_iphone_events.jsonl");
        let export_path = temp_file("ritual-biome-iphone-export.jsonl");
        let mut invalid_event = biome_event(Some("invalid"), 5_000);
        invalid_event.ts_end = invalid_event.ts_start;
        let valid_event = biome_event(Some("valid"), 2_000);

        fs::write(
            &export_path,
            format!(
                "{{bad-json\n{}\n{}\n",
                serde_json::to_string(&invalid_event).unwrap(),
                serde_json::to_string(&valid_event).unwrap()
            ),
        )
        .unwrap();

        let result =
            import_biome_export_into_path(&export_path, &outbox_path).expect("import export");
        let quarantine_path = result
            .quarantine_path
            .as_ref()
            .map(PathBuf::from)
            .expect("malformed rows should be quarantined");
        let quarantine_body = fs::read_to_string(&quarantine_path).unwrap();
        let outbox = read_biome_outbox(&outbox_path).expect("read imported outbox");

        assert_eq!(result.imported, 1);
        assert_eq!(result.duplicates, 0);
        assert_eq!(result.malformed, 2);
        assert_eq!(result.outbox_event_count, 1);
        assert!(quarantine_path.exists());
        assert!(quarantine_body.contains("bad-json"));
        assert!(quarantine_body.contains("ts_end must be greater than ts_start"));
        assert_eq!(outbox.events.len(), 1);
        assert!(
            export_path.exists(),
            "bridge import must not delete the source export"
        );
    }

    #[test]
    fn classify_biome_ack_handles_mixed_response_and_commits_processed_events() {
        let accepted = biome_event(Some("legacy-accepted"), 2_000);
        let mut rejected = biome_event(Some("legacy-rejected"), 3_000);
        rejected.app_bundle_id = "com.apple.Preferences".to_string();
        rejected.ts_start = 3_000;
        let accepted_key = biome_event_key(&accepted);
        let rejected_key = biome_event_key(&rejected);
        let chunk = vec![accepted, rejected];
        let parsed = BiomeIngestResponse {
            accepted: 1,
            rejected: 1,
            duplicates: 0,
            accepted_event_uids: vec![accepted_key.clone()],
            duplicate_event_uids: vec![],
            rejected_event_uids: vec![rejected_key.clone()],
        };

        let (processed, rejected_records, committed) = classify_biome_ack(&parsed, &chunk).unwrap();

        assert_eq!(processed.len(), 2);
        assert!(processed.contains(&accepted_key));
        assert!(processed.contains(&rejected_key));
        assert_eq!(rejected_records.len(), 1);
        assert_eq!(committed.len(), 2);
    }

    #[test]
    fn classify_biome_ack_keeps_batch_when_rejects_have_no_ids() {
        let chunk = vec![biome_event(Some("pending"), 2_000)];
        let parsed = BiomeIngestResponse {
            accepted: 0,
            rejected: 1,
            duplicates: 0,
            accepted_event_uids: vec![],
            duplicate_event_uids: vec![],
            rejected_event_uids: vec![],
        };

        assert!(classify_biome_ack(&parsed, &chunk).is_err());
    }
}
