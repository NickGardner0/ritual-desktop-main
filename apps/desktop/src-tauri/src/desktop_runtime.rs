use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
#[cfg(target_os = "macos")]
use std::ffi::CString;
use std::fs;
#[cfg(target_os = "macos")]
use std::os::raw::c_char;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;
use tracing::{info, instrument, warn};

use crate::desktop_observability::redact_sensitive_url_for_log;

#[cfg(target_os = "macos")]
extern "C" {
    fn show_ritual_update_install_prompt(version: *const c_char) -> bool;
}

const DESKTOP_RUNTIME_CAPABILITIES: &[&str] = &[
    "desktop-runtime-info-v1",
    "native-updater-v1",
    "native-update-prompt-v1",
    "native-startup-update-fallback-v1",
    "desktop-runtime-state-v1",
    "desktop-auth-handoff-v1",
    "desktop-runtime-events-v1",
];
const TURSO_SYNC_FETCH_RETRY_ATTEMPTS: usize = 3;
const TURSO_SYNC_FETCH_RETRY_BASE_SECS: u64 = 3;
const TURSO_SYNC_FAILURE_RETRY_SECS: u64 = 30;
const LOCATION_OUTBOX_DRAIN_INTERVAL_SECS: u64 = 60;
const LOCATION_OUTBOX_BATCH_SIZE: usize = 500;
const BIOME_OUTBOX_DRAIN_INTERVAL_SECS: u64 = 60;
const BIOME_OUTBOX_BATCH_SIZE: usize = 500;

pub const DASHBOARD_REFRESH_EVENT: &str = "desktop://dashboard-refresh";
pub const TOKEN_REFRESH_NEEDED_EVENT: &str = "desktop://token-refresh-needed";
pub const RUNTIME_STATE_CHANGED_EVENT: &str = "desktop://runtime-state-changed";
pub const AUTH_DEEP_LINK_EVENT: &str = "desktop://auth-deep-link";
pub const UPDATE_STATUS_EVENT: &str = "tauri://update-status";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdateManifest {
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeInfo {
    pub version: String,
    pub environment: String,
    pub capabilities: Vec<String>,
    pub updater_active: bool,
    pub frontend_ready: bool,
    pub target: Option<String>,
    pub pending_update: Option<PendingUpdateManifest>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAuthRuntimeState {
    pub token_ready: bool,
    pub user_id: Option<String>,
    pub backend_base: Option<String>,
    pub last_updated_at_ms: Option<i64>,
    pub last_turso_sync_at_ms: Option<i64>,
    pub turso_refresh_scheduled_for_ms: Option<i64>,
    pub last_turso_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeState {
    pub auth: DesktopAuthRuntimeState,
    pub database: crate::ritual_database::DatabaseRuntimeStateSnapshot,
    pub watcher: crate::watcher::WatcherLifecycleSnapshot,
}

#[derive(Clone, Debug, Default)]
struct DesktopAuthState {
    token: Option<String>,
    user_id: Option<String>,
    backend_base: Option<String>,
    last_updated_at_ms: Option<i64>,
    last_turso_sync_at_ms: Option<i64>,
    turso_refresh_scheduled_for_ms: Option<i64>,
    last_turso_error: Option<String>,
}

pub struct DesktopShellState {
    frontend_ready: Mutex<bool>,
    update_check_in_progress: Mutex<bool>,
    pending_update: Mutex<Option<PendingUpdateManifest>>,
    pending_auth_deep_link: Mutex<Option<String>>,
    auth_state: Mutex<DesktopAuthState>,
    auth_generation: AtomicU64,
    biome_drain: Mutex<BiomeDrainSnapshot>,
}

impl Default for DesktopShellState {
    fn default() -> Self {
        Self {
            frontend_ready: Mutex::new(false),
            update_check_in_progress: Mutex::new(false),
            pending_update: Mutex::new(None),
            pending_auth_deep_link: Mutex::new(None),
            auth_state: Mutex::new(DesktopAuthState::default()),
            auth_generation: AtomicU64::new(0),
            biome_drain: Mutex::new(BiomeDrainSnapshot::default()),
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum UpdateCheckOrigin {
    Startup,
    Frontend,
    Tray,
}

#[derive(Debug, Deserialize)]
struct TursoSyncConfigResponse {
    sync_url: String,
    auth_token: String,
    expires_at: String,
    database_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct DesktopLocationPing {
    #[serde(skip_serializing_if = "Option::is_none")]
    lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    horizontal_accuracy_m: Option<f64>,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bssid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ssid: Option<String>,
    client_ts: i64,
    client_event_id: String,
}

#[derive(Debug, Deserialize)]
struct LocationIngestResponse {
    accepted: i64,
    rejected: i64,
    duplicates: i64,
    #[serde(default)]
    accepted_ids: Vec<String>,
    #[serde(default)]
    duplicate_ids: Vec<String>,
    #[serde(default)]
    rejected_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct DesktopBiomeActivityEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    event_uid: Option<String>,
    device_id: String,
    app_bundle_id: String,
    app_name: String,
    ts_start: i64,
    ts_end: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    browser_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    browser_domain: Option<String>,
    #[serde(default)]
    is_incognito: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    app_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    app_build: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transition_reason: Option<String>,
    #[serde(default)]
    biome_is_provisional: bool,
}

#[derive(Debug, Deserialize)]
struct BiomeIngestResponse {
    accepted: i64,
    rejected: i64,
    duplicates: i64,
    #[serde(default)]
    accepted_event_uids: Vec<String>,
    #[serde(default)]
    duplicate_event_uids: Vec<String>,
    #[serde(default)]
    rejected_event_uids: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomeDrainSnapshot {
    pub last_checked_at_ms: Option<i64>,
    pub last_status: Option<String>,
    pub last_processed_count: Option<usize>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomeDeviceDiagnostics {
    pub device_id: String,
    pub path: String,
    pub path_exists: bool,
    pub source_file_count: usize,
    pub newest_source_file_mtime_ms: Option<i64>,
    pub oldest_source_file_mtime_ms: Option<i64>,
    pub source_file_bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomeOutboxDiagnostics {
    pub path: Option<String>,
    pub exists: bool,
    pub event_count: usize,
    pub malformed_line_count: usize,
    pub bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomeIphoneDiagnostics {
    pub sync_db_path: Option<String>,
    pub sync_db_exists: bool,
    pub sync_db_error: Option<String>,
    pub ios_device_peer_count: usize,
    pub app_in_focus_remote_path: Option<String>,
    pub app_in_focus_remote_exists: bool,
    pub device_folder_count: usize,
    pub source_file_count: usize,
    pub devices: Vec<BiomeDeviceDiagnostics>,
    pub outbox: BiomeOutboxDiagnostics,
    pub committed_cursors_path: Option<String>,
    pub committed_cursors: HashMap<String, i64>,
    pub last_drain: BiomeDrainSnapshot,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatusPayload {
    error: Option<String>,
    status: Option<String>,
}

fn read_nonempty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn configured_ritual_env() -> String {
    read_nonempty_env("RITUAL_ENV")
        .or_else(|| {
            option_env!("RITUAL_ENV")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) {
                "development".to_string()
            } else {
                "production".to_string()
            }
        })
}

fn build_runtime_info<R: Runtime>(app: &AppHandle<R>) -> DesktopRuntimeInfo {
    let state = app.state::<DesktopShellState>();
    let frontend_ready = *state
        .frontend_ready
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let pending_update = state
        .pending_update
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();

    DesktopRuntimeInfo {
        version: app.package_info().version.to_string(),
        environment: configured_ritual_env(),
        capabilities: DESKTOP_RUNTIME_CAPABILITIES
            .iter()
            .map(|capability| (*capability).to_string())
            .collect(),
        updater_active: app.updater().is_ok(),
        frontend_ready,
        target: tauri_plugin_updater::target(),
        pending_update,
    }
}

fn begin_update_check<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<DesktopShellState>();
    let mut in_progress = state
        .update_check_in_progress
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *in_progress {
        return false;
    }

    *in_progress = true;
    true
}

fn end_update_check<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<DesktopShellState>();
    let mut in_progress = state
        .update_check_in_progress
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *in_progress = false;
}

fn set_pending_update<R: Runtime + 'static>(
    app: &AppHandle<R>,
    update: Option<PendingUpdateManifest>,
) {
    let state = app.state::<DesktopShellState>();
    let mut pending = state
        .pending_update
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *pending = update;
    drop(pending);
    emit_runtime_state_changed(app.clone());
}

fn frontend_is_ready<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<DesktopShellState>();
    let ready = *state
        .frontend_ready
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    ready
}

fn take_pending_auth_deep_link<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.state::<DesktopShellState>()
        .pending_auth_deep_link
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
}

fn store_pending_auth_deep_link<R: Runtime>(app: &AppHandle<R>, deep_link: String) {
    let state = app.state::<DesktopShellState>();
    let mut pending = state
        .pending_auth_deep_link
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *pending = Some(deep_link);
}

pub fn emit_auth_deep_link<R: Runtime>(app: &AppHandle<R>, deep_link: String) {
    if frontend_is_ready(app) {
        let redacted_deep_link = redact_sensitive_url_for_log(&deep_link);
        info!(deep_link = %redacted_deep_link, "Emitting desktop auth deep link to frontend");
        let _ = app.emit(AUTH_DEEP_LINK_EVENT, deep_link);
        return;
    }

    info!("Frontend not ready yet; queueing desktop auth deep link");
    store_pending_auth_deep_link(app, deep_link);
}

pub fn flush_pending_auth_deep_link<R: Runtime>(app: &AppHandle<R>) {
    if !frontend_is_ready(app) {
        return;
    }

    if let Some(pending) = take_pending_auth_deep_link(app) {
        let redacted_deep_link = redact_sensitive_url_for_log(&pending);
        info!(deep_link = %redacted_deep_link, "Flushing queued desktop auth deep link");
        let _ = app.emit(AUTH_DEEP_LINK_EVENT, pending);
    }
}

fn normalize_backend_base(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().trim_end_matches('/').to_string())
        .filter(|item| !item.is_empty())
}

fn persisted_turso_config_is_fresh_enough() -> bool {
    crate::native_widget::persisted_turso_sync_config_is_fresh_enough()
}

fn should_skip_immediate_turso_refresh<R: Runtime>(app: &AppHandle<R>) -> bool {
    let database = crate::ritual_database::database_runtime_state_snapshot();
    let activity_ready = matches!(
        database.activity.status,
        crate::ritual_database::DatabaseConnectionState::ReadyLocal
    );

    if !activity_ready {
        return false;
    }

    let auth_state = read_auth_state(app);
    if auth_state.last_turso_error.is_some() {
        return false;
    }

    persisted_turso_config_is_fresh_enough()
}

fn read_auth_state<R: Runtime>(app: &AppHandle<R>) -> DesktopAuthState {
    app.state::<DesktopShellState>()
        .auth_state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn update_auth_state<R: Runtime, F>(app: &AppHandle<R>, mutator: F)
where
    F: FnOnce(&mut DesktopAuthState),
{
    let state = app.state::<DesktopShellState>();
    let mut auth_state = state
        .auth_state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    mutator(&mut auth_state);
}

fn build_auth_runtime_state<R: Runtime>(app: &AppHandle<R>) -> DesktopAuthRuntimeState {
    let auth_state = read_auth_state(app);
    DesktopAuthRuntimeState {
        token_ready: auth_state
            .token
            .as_ref()
            .map(|token| !token.trim().is_empty())
            .unwrap_or(false),
        user_id: auth_state.user_id,
        backend_base: auth_state.backend_base,
        last_updated_at_ms: auth_state.last_updated_at_ms,
        last_turso_sync_at_ms: auth_state.last_turso_sync_at_ms,
        turso_refresh_scheduled_for_ms: auth_state.turso_refresh_scheduled_for_ms,
        last_turso_error: auth_state.last_turso_error,
    }
}

pub(crate) fn request_token_refresh<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(
        TOKEN_REFRESH_NEEDED_EVENT,
        Utc::now().timestamp_millis() as f64,
    );
}

async fn build_runtime_state<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<DesktopRuntimeState, String> {
    let auth = build_auth_runtime_state(app);
    let database = crate::ritual_database::database_runtime_state_snapshot();
    let watcher = crate::watcher::get_watcher_lifecycle_snapshot().await;

    Ok(DesktopRuntimeState {
        auth,
        database,
        watcher,
    })
}

pub fn emit_runtime_state_changed<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        match build_runtime_state(&app).await {
            Ok(runtime_state) => {
                let _ = app.emit(RUNTIME_STATE_CHANGED_EVENT, runtime_state);
            }
            Err(error) => {
                warn!(error = %error, "Failed to emit desktop runtime state change");
            }
        }
    });
}

fn read_runtime_signal_timestamp(file_name: &str) -> f64 {
    use std::fs;

    let target_file = std::env::temp_dir().join(file_name);
    match fs::read_to_string(target_file) {
        Ok(contents) => contents.trim().parse::<f64>().unwrap_or(0.0),
        Err(_) => 0.0,
    }
}

pub fn register_runtime_signal_monitor<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut last_token_refresh_request = 0.0_f64;
        let mut last_dashboard_refresh = 0.0_f64;
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;

            let token_refresh_request =
                read_runtime_signal_timestamp("ritual_refresh_token_request.txt");
            if token_refresh_request > 0.0 && token_refresh_request != last_token_refresh_request {
                last_token_refresh_request = token_refresh_request;
                let _ = app.emit(TOKEN_REFRESH_NEEDED_EVENT, token_refresh_request);
            }

            let dashboard_refresh = read_runtime_signal_timestamp("ritual_timer_updated.txt");
            if dashboard_refresh > 0.0 && dashboard_refresh != last_dashboard_refresh {
                last_dashboard_refresh = dashboard_refresh;
                let _ = app.emit(DASHBOARD_REFRESH_EVENT, dashboard_refresh);
            }
        }
    });
}

fn location_outbox_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join("Library")
            .join("Application Support")
            .join("Ritual")
            .join("location_outbox.json")
    })
}

fn write_location_outbox(path: &PathBuf, pings: &[DesktopLocationPing]) -> Result<(), String> {
    let json = serde_json::to_string(pings)
        .map_err(|error| format!("Failed to encode location outbox: {error}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|error| format!("Failed to write location outbox: {error}"))?;
    fs::rename(&tmp, path).map_err(|error| format!("Failed to replace location outbox: {error}"))
}

fn quarantine_text(path: &PathBuf, suffix: &str, body: &str) -> Result<(), String> {
    let quarantine =
        path.with_extension(format!("{suffix}.{}.jsonl", Utc::now().timestamp_millis()));
    fs::write(&quarantine, body).map_err(|error| {
        format!(
            "Failed to write quarantine {}: {error}",
            quarantine.display()
        )
    })
}

fn append_quarantine_records<T: Serialize>(
    path: &PathBuf,
    suffix: &str,
    reason: &str,
    records: &[T],
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let quarantine = path.with_extension(format!("{suffix}.jsonl"));
    let mut body = String::new();
    for record in records {
        let line = serde_json::to_string(&serde_json::json!({
            "reason": reason,
            "record": record,
            "quarantined_at": Utc::now().to_rfc3339(),
        }))
        .map_err(|error| format!("Failed to encode quarantine record: {error}"))?;
        body.push_str(&line);
        body.push('\n');
    }
    use std::io::Write;
    if let Some(parent) = quarantine.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create quarantine directory: {error}"))?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&quarantine)
        .map_err(|error| {
            format!(
                "Failed to open quarantine {}: {error}",
                quarantine.display()
            )
        })?;
    file.write_all(body.as_bytes()).map_err(|error| {
        format!(
            "Failed to write quarantine {}: {error}",
            quarantine.display()
        )
    })
}

fn classify_location_ack(
    parsed: &LocationIngestResponse,
    chunk: &[DesktopLocationPing],
) -> Result<(HashSet<String>, Vec<DesktopLocationPing>), String> {
    let mut acknowledged: HashSet<String> = parsed
        .accepted_ids
        .iter()
        .chain(parsed.duplicate_ids.iter())
        .cloned()
        .collect();
    let rejected: HashSet<String> = parsed.rejected_ids.iter().cloned().collect();
    if acknowledged.is_empty() && rejected.is_empty() && parsed.rejected == 0 {
        acknowledged.extend(chunk.iter().map(|ping| ping.client_event_id.clone()));
    }
    if acknowledged.is_empty() && rejected.is_empty() && parsed.rejected > 0 {
        return Err(
            "Location ingest returned rejections without IDs; keeping outbox for retry".to_string(),
        );
    }
    let rejected_records: Vec<DesktopLocationPing> = chunk
        .iter()
        .filter(|ping| rejected.contains(&ping.client_event_id))
        .cloned()
        .collect();
    let mut processed_ids = acknowledged;
    processed_ids.extend(rejected);
    Ok((processed_ids, rejected_records))
}

fn drain_location_outbox_blocking(
    auth_token: String,
    backend_base: String,
) -> Result<usize, String> {
    let Some(path) = location_outbox_path() else {
        return Ok(0);
    };
    if !path.exists() {
        return Ok(0);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read location outbox: {error}"))?;
    if raw.trim().is_empty() {
        return Ok(0);
    }

    let pings: Vec<DesktopLocationPing> = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            quarantine_text(&path, "malformed", &raw)?;
            write_location_outbox(&path, &[])?;
            return Err(format!(
                "Failed to parse location outbox; quarantined malformed file: {error}"
            ));
        }
    };
    if pings.is_empty() {
        return Ok(0);
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to create location outbox client: {error}"))?;
    let url = format!("{backend_base}/api/user/location-pings");
    let mut processed_ids: HashSet<String> = HashSet::new();

    for chunk in pings.chunks(LOCATION_OUTBOX_BATCH_SIZE) {
        let body = serde_json::to_string(&serde_json::json!({ "pings": chunk }))
            .map_err(|error| format!("Failed to encode location ingest body: {error}"))?;
        let response = client
            .post(&url)
            .bearer_auth(&auth_token)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .map_err(|error| format!("Failed to submit location outbox: {error}"))?;

        let status = response.status();
        if !status.is_success() {
            return Err(format!("Location outbox request failed with HTTP {status}"));
        }

        let body = response
            .text()
            .map_err(|error| format!("Failed to read location ingest response: {error}"))?;
        let parsed: LocationIngestResponse = serde_json::from_str(&body)
            .map_err(|error| format!("Failed to parse location ingest response: {error}"))?;
        info!(
            accepted = parsed.accepted,
            rejected = parsed.rejected,
            duplicates = parsed.duplicates,
            count = chunk.len(),
            "Submitted location outbox batch"
        );

        let (chunk_processed_ids, rejected_records) = classify_location_ack(&parsed, chunk)?;
        append_quarantine_records(&path, "rejected", "backend_rejected", &rejected_records)?;
        processed_ids.extend(chunk_processed_ids);
    }

    if processed_ids.is_empty() {
        return Ok(0);
    }

    let remaining: Vec<DesktopLocationPing> = pings
        .into_iter()
        .filter(|ping| !processed_ids.contains(&ping.client_event_id))
        .collect();
    write_location_outbox(&path, &remaining)?;
    Ok(processed_ids.len())
}

async fn drain_location_outbox_once<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<usize, String> {
    let auth_state = read_auth_state(&app);
    let auth_token = auth_state
        .token
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "Auth token is unavailable for location outbox drain".to_string())?;
    let backend_base = auth_state
        .backend_base
        .filter(|base| !base.trim().is_empty())
        .ok_or_else(|| "Backend base URL is unavailable for location outbox drain".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        drain_location_outbox_blocking(auth_token, backend_base)
    })
    .await
    .map_err(|error| format!("Location outbox drain task failed: {error}"))?
}

pub fn trigger_location_outbox_drain<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        match drain_location_outbox_once(app.clone()).await {
            Ok(count) if count > 0 => {
                info!(count, "Location outbox drained");
            }
            Ok(_) => {}
            Err(error) => {
                if error.contains("HTTP 401") || error.contains("HTTP 403") {
                    request_token_refresh(&app);
                }
                warn!(error = %error, "Location outbox drain skipped");
            }
        }
    });
}

pub fn register_location_outbox_drain_worker<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        let mut interval =
            tokio::time::interval(Duration::from_secs(LOCATION_OUTBOX_DRAIN_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            match drain_location_outbox_once(app.clone()).await {
                Ok(count) if count > 0 => {
                    info!(count, "Location outbox drained by background worker");
                }
                Ok(_) => {}
                Err(error) => {
                    if error.contains("HTTP 401") || error.contains("HTTP 403") {
                        request_token_refresh(&app);
                    }
                    warn!(error = %error, "Location outbox background drain skipped");
                }
            }
        }
    });
}

fn biome_outbox_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join("Library")
            .join("Application Support")
            .join("Ritual")
            .join("biome_iphone_events.jsonl")
    })
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
    dirs::home_dir().map(|home| {
        home.join("Library")
            .join("Application Support")
            .join("Ritual")
            .join("biome_committed_cursors.json")
    })
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

fn build_biome_iphone_diagnostics<R: Runtime>(app: &AppHandle<R>) -> BiomeIphoneDiagnostics {
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

fn biome_event_key(event: &DesktopBiomeActivityEvent) -> String {
    format!(
        "biome:{}:{}:{}",
        event.device_id, event.app_bundle_id, event.ts_start
    )
}

#[derive(Debug)]
struct BiomeOutboxRead {
    events: Vec<DesktopBiomeActivityEvent>,
    malformed_lines: Vec<String>,
}

fn read_biome_outbox(path: &PathBuf) -> Result<BiomeOutboxRead, String> {
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

fn import_biome_export_into_path(
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
            quarantine_text(outbox_path, "malformed", &existing.malformed_lines.join("\n"))?;
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

fn import_biome_export_into_outbox(source_path: &Path) -> Result<BiomeImportResult, String> {
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

fn classify_biome_ack(
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

async fn drain_biome_outbox_once<R: Runtime + 'static>(app: AppHandle<R>) -> Result<usize, String> {
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

    fn location_ping(id: &str) -> DesktopLocationPing {
        DesktopLocationPing {
            lat: Some(40.0),
            lon: Some(-73.0),
            horizontal_accuracy_m: Some(25.0),
            source: "iphone_scls".to_string(),
            device_id: Some("iphone".to_string()),
            bssid: None,
            ssid: None,
            client_ts: 1_000,
            client_event_id: id.to_string(),
        }
    }

    #[test]
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
        assert!(outbox.events.iter().any(|event| event.app_name == "Messages"));
        assert!(outbox.events.iter().any(|event| event.app_name == "Safari"));
        assert!(export_path.exists(), "bridge import must not delete the source export");
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
        assert!(export_path.exists(), "bridge import must not delete the source export");
    }

    #[test]
    fn classify_location_ack_handles_accepted_duplicates_and_rejects() {
        let chunk = vec![
            location_ping("accepted"),
            location_ping("duplicate"),
            location_ping("rejected"),
        ];
        let parsed = LocationIngestResponse {
            accepted: 1,
            rejected: 1,
            duplicates: 1,
            accepted_ids: vec!["accepted".to_string()],
            duplicate_ids: vec!["duplicate".to_string()],
            rejected_ids: vec!["rejected".to_string()],
        };

        let (processed, rejected) = classify_location_ack(&parsed, &chunk).unwrap();

        assert_eq!(processed.len(), 3);
        assert!(processed.contains("accepted"));
        assert!(processed.contains("duplicate"));
        assert!(processed.contains("rejected"));
        assert_eq!(rejected.len(), 1);
        assert_eq!(rejected[0].client_event_id, "rejected");
    }

    #[test]
    fn classify_location_ack_keeps_batch_when_rejects_have_no_ids() {
        let chunk = vec![location_ping("pending")];
        let parsed = LocationIngestResponse {
            accepted: 0,
            rejected: 1,
            duplicates: 0,
            accepted_ids: vec![],
            duplicate_ids: vec![],
            rejected_ids: vec![],
        };

        assert!(classify_location_ack(&parsed, &chunk).is_err());
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

fn emit_update_status<R: Runtime>(app: &AppHandle<R>, status: &str, error: Option<String>) {
    let _ = app.emit(
        UPDATE_STATUS_EVENT,
        UpdateStatusPayload {
            error,
            status: Some(status.to_string()),
        },
    );
}

async fn show_native_message<R: Runtime>(app: AppHandle<R>, title: String, body: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(body)
            .title(title)
            .buttons(MessageDialogButtons::Ok)
            .kind(MessageDialogKind::Info)
            .blocking_show();
    })
    .await;
}

async fn prompt_for_native_install<R: Runtime>(
    _app: AppHandle<R>,
    latest_version: String,
    _body: Option<String>,
) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            let version = CString::new(latest_version)
                .map_err(|_| "Update version contained an interior null byte.".to_string())?;
            let should_install = unsafe { show_ritual_update_install_prompt(version.as_ptr()) };
            Ok::<bool, String>(should_install)
        })
        .await
        .map_err(|error| format!("Failed to show native update prompt: {error}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    let prompt = format!(
        "Ritual {latest_version} is ready to install.\n\nRitual will relaunch after the update is installed."
    );

    #[cfg(not(target_os = "macos"))]
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<bool, String>(
            _app.dialog()
                .message(prompt)
                .title(format!("Install Ritual {latest_version}?"))
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Install".to_string(),
                    "Later".to_string(),
                ))
                .kind(MessageDialogKind::Info)
                .blocking_show(),
        )
    })
    .await
    .map_err(|error| format!("Failed to show native update prompt: {error}"))?
}

async fn install_latest_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|error| format!("Failed to access updater plugin: {error}"))?
        .check()
        .await
        .map_err(|error| format!("Failed to check for updates: {error}"))?;

    let Some(update) = update else {
        set_pending_update(&app, None);
        return Err("Ritual is already up to date.".to_string());
    };

    let manifest = PendingUpdateManifest {
        version: update.version.clone(),
        date: update.date.map(|value| value.to_string()),
        body: update.body.clone(),
    };
    set_pending_update(&app, Some(manifest));
    emit_update_status(&app, "PENDING", None);

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| {
            let message = format!("Failed to download or install the update: {error}");
            emit_update_status(&app, "ERROR", Some(message.clone()));
            message
        })?;

    emit_update_status(&app, "DONE", None);
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

#[instrument(skip(app), fields(origin = ?origin))]
async fn run_update_check<R: Runtime + 'static>(
    app: AppHandle<R>,
    origin: UpdateCheckOrigin,
) -> Result<(), String> {
    let started_at = Instant::now();
    if app.updater().is_err() {
        return Err("Ritual desktop updater is disabled in this build.".to_string());
    }

    if !begin_update_check(&app) {
        return Ok(());
    }

    let result = async {
        let update = app
            .updater()
            .map_err(|error| format!("Failed to access updater plugin: {error}"))?
            .check()
            .await
            .map_err(|error| format!("Failed to check for updates: {error}"))?;

        let Some(update) = update else {
            set_pending_update(&app, None);
            emit_update_status(&app, "UPTODATE", None);

            if matches!(origin, UpdateCheckOrigin::Tray) {
                show_native_message::<R>(
                    app.clone(),
                    "Ritual Desktop".to_string(),
                    "You already have the latest Ritual desktop build.".to_string(),
                )
                .await;
            }

            return Ok(());
        };

        let latest_version = update.version.clone();
        let release_notes = update.body.clone();

        log::info!(
            "[DESKTOP_RUNTIME] update {} pending from {:?}; showing native install prompt",
            latest_version,
            origin
        );

        if prompt_for_native_install(app.clone(), latest_version, release_notes).await? {
            if let Err(error) = install_latest_update(app.clone()).await {
                show_native_message::<R>(
                    app.clone(),
                    "Ritual Update Failed".to_string(),
                    error.clone(),
                )
                .await;
                return Err(error);
            }
        }

        Ok(())
    }
    .await;

    log::info!(
        "[DESKTOP_RUNTIME] run_update_check completed in {}ms",
        started_at.elapsed().as_millis()
    );
    end_update_check(&app);
    result
}

fn reconcile_native_user_configs(user_id: &str) -> Result<(), String> {
    let trimmed_user_id = user_id.trim();
    if trimmed_user_id.is_empty() {
        return Ok(());
    }

    if let Some(mut watcher_config) = crate::watcher::get_saved_watcher_config() {
        if watcher_config.user_id != trimmed_user_id {
            watcher_config.user_id = trimmed_user_id.to_string();
            crate::watcher::save_watcher_config(&watcher_config)?;

            if crate::watcher::check_accessibility_permission() {
                if let Err(error) = crate::watcher::start_watcher_sync(watcher_config) {
                    warn!(error = %error, "Failed restarting watcher after auth handoff reconciliation");
                }
            }
        }
    }

    Ok(())
}

async fn fetch_turso_sync_config(
    auth_token: String,
    backend_base: String,
) -> Result<TursoSyncConfigResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("{backend_base}/api/user/turso-sync-config");
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| format!("Failed to create Turso config client: {error}"))?;

        let mut last_error: Option<String> = None;
        for attempt in 0..TURSO_SYNC_FETCH_RETRY_ATTEMPTS {
            let response = client.get(&url).bearer_auth(&auth_token).send();

            match response {
                Ok(response) => {
                    if response.status().is_success() {
                        let body = response.text().map_err(|error| {
                            format!("Failed to read Turso sync config response: {error}")
                        })?;

                        return serde_json::from_str::<TursoSyncConfigResponse>(&body).map_err(
                            |error| format!("Failed to parse Turso sync config response: {error}"),
                        );
                    }

                    let error = format!(
                        "Turso sync config request failed with HTTP {}",
                        response.status()
                    );
                    last_error = Some(error.clone());

                    let status = response.status().as_u16();
                    let retryable = matches!(status, 408 | 429 | 500 | 502 | 503 | 504);
                    if retryable && attempt + 1 < TURSO_SYNC_FETCH_RETRY_ATTEMPTS {
                        std::thread::sleep(Duration::from_secs(
                            TURSO_SYNC_FETCH_RETRY_BASE_SECS * (attempt as u64 + 1),
                        ));
                        continue;
                    }

                    return Err(error);
                }
                Err(error) => {
                    let error = format!("Failed to fetch Turso sync config: {error}");
                    last_error = Some(error.clone());
                    let retryable = error.to_ascii_lowercase().contains("timed out")
                        || error.to_ascii_lowercase().contains("timeout")
                        || error.to_ascii_lowercase().contains("connection")
                        || error.to_ascii_lowercase().contains("connect")
                        || error.to_ascii_lowercase().contains("tempor");
                    if retryable && attempt + 1 < TURSO_SYNC_FETCH_RETRY_ATTEMPTS {
                        std::thread::sleep(Duration::from_secs(
                            TURSO_SYNC_FETCH_RETRY_BASE_SECS * (attempt as u64 + 1),
                        ));
                        continue;
                    }

                    return Err(error);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            "Failed to fetch Turso sync config for an unknown reason".to_string()
        }))
    })
    .await
    .map_err(|error| format!("Turso config fetch task failed: {error}"))?
}

fn should_retry_turso_sync_error(error: &str) -> bool {
    let lowered = error.to_ascii_lowercase();
    lowered.contains("timed out")
        || lowered.contains("timeout")
        || lowered.contains("connection")
        || lowered.contains("connect")
        || lowered.contains("tempor")
        || lowered.contains("http 408")
        || lowered.contains("http 429")
        || lowered.contains("http 500")
        || lowered.contains("http 502")
        || lowered.contains("http 503")
        || lowered.contains("http 504")
}

fn schedule_turso_config_retry<R: Runtime + 'static>(
    app: AppHandle<R>,
    generation: u64,
    delay: Duration,
) {
    let retry_at_ms = Utc::now().timestamp_millis() + delay.as_millis() as i64;
    update_auth_state(&app, |state| {
        state.turso_refresh_scheduled_for_ms = Some(retry_at_ms);
    });

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        let current_generation = app
            .state::<DesktopShellState>()
            .auth_generation
            .load(Ordering::SeqCst);
        if current_generation != generation {
            return;
        }

        if let Err(error) = refresh_turso_sync_config(app.clone(), generation).await {
            warn!(error = %error, "Scheduled retry for Turso sync config failed");
        }
    });
}

fn schedule_turso_config_refresh<R: Runtime + 'static>(
    app: AppHandle<R>,
    generation: u64,
    expires_at: &str,
) {
    let Ok(expires_at) = DateTime::parse_from_rfc3339(expires_at) else {
        update_auth_state(&app, |state| {
            state.turso_refresh_scheduled_for_ms = None;
        });
        return;
    };

    let refresh_at = expires_at.with_timezone(&Utc) - chrono::Duration::minutes(30);
    let now = Utc::now();
    let delay = (refresh_at - now)
        .to_std()
        .unwrap_or_else(|_| Duration::from_secs(0));

    update_auth_state(&app, |state| {
        state.turso_refresh_scheduled_for_ms = Some(refresh_at.timestamp_millis());
    });

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        let current_generation = app
            .state::<DesktopShellState>()
            .auth_generation
            .load(Ordering::SeqCst);
        if current_generation != generation {
            return;
        }

        if let Err(error) = refresh_turso_sync_config(app.clone(), generation).await {
            warn!(error = %error, "Scheduled Turso sync refresh failed");
        }
    });
}

async fn refresh_turso_sync_config<R: Runtime + 'static>(
    app: AppHandle<R>,
    generation: u64,
) -> Result<(), String> {
    let auth_state = read_auth_state(&app);
    let auth_token = auth_state
        .token
        .clone()
        .ok_or_else(|| "Auth token is not available for Turso sync refresh".to_string())?;
    let backend_base = auth_state
        .backend_base
        .clone()
        .ok_or_else(|| "Backend base URL is not available for Turso sync refresh".to_string())?;

    match fetch_turso_sync_config(auth_token, backend_base).await {
        Ok(response) => {
            let config = crate::native_widget::TursoSyncConfig {
                sync_url: response.sync_url.trim().to_string(),
                auth_token: response.auth_token.trim().to_string(),
                expires_at: response.expires_at.trim().to_string(),
                database_name: response.database_name.trim().to_string(),
            };
            crate::native_widget::apply_turso_sync_config_internal(
                config.clone(),
                Some("desktop_runtime:refresh_turso_sync_config"),
            )
            .await?;
            crate::cloud_sync::trigger_cloud_sync_now(app.clone());

            update_auth_state(&app, |state| {
                state.last_turso_sync_at_ms = Some(Utc::now().timestamp_millis());
                state.last_turso_error = None;
            });
            schedule_turso_config_refresh(app.clone(), generation, &config.expires_at);
            emit_runtime_state_changed(app.clone());
            Ok(())
        }
        Err(error) => {
            update_auth_state(&app, |state| {
                state.last_turso_error = Some(error.clone());
            });

            let lowered = error.to_ascii_lowercase();
            if lowered.contains("http 401") || lowered.contains("http 403") {
                request_token_refresh(&app);
            } else if should_retry_turso_sync_error(&error) {
                schedule_turso_config_retry(
                    app.clone(),
                    generation,
                    Duration::from_secs(TURSO_SYNC_FAILURE_RETRY_SECS),
                );
            }

            emit_runtime_state_changed(app.clone());
            Err(error)
        }
    }
}

pub fn register_startup_update_check<R: Runtime + 'static>(app: AppHandle<R>) {
    let env = configured_ritual_env();
    if !matches!(env.as_str(), "production" | "prod") {
        return;
    }

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(6)).await;
        if let Err(error) = run_update_check(app.clone(), UpdateCheckOrigin::Startup).await {
            warn!(error = %error, "Desktop startup update check failed");
        }
    });
}

pub fn tray_check_for_updates<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_update_check(app.clone(), UpdateCheckOrigin::Tray).await {
            show_native_message::<R>(app.clone(), "Ritual Update Check Failed".to_string(), error)
                .await;
        }
    });
}

#[tauri::command]
#[instrument(skip(app))]
pub fn get_desktop_runtime_info<R: Runtime>(app: AppHandle<R>) -> DesktopRuntimeInfo {
    build_runtime_info(&app)
}

#[tauri::command]
#[instrument(skip(app))]
pub fn desktop_frontend_ready<R: Runtime>(app: AppHandle<R>) -> DesktopRuntimeInfo {
    let state = app.state::<DesktopShellState>();
    let mut frontend_ready = state
        .frontend_ready
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *frontend_ready = true;
    drop(frontend_ready);

    flush_pending_auth_deep_link(&app);
    if !persisted_turso_config_is_fresh_enough() {
        request_token_refresh(&app);
    }

    build_runtime_info(&app)
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn desktop_manual_update_check<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<DesktopRuntimeInfo, String> {
    run_update_check(app.clone(), UpdateCheckOrigin::Frontend).await?;
    Ok(build_runtime_info(&app))
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn desktop_install_update<R: Runtime + 'static>(app: AppHandle<R>) -> Result<(), String> {
    install_latest_update(app).await
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn get_desktop_runtime_state<R: Runtime>(
    app: AppHandle<R>,
) -> Result<DesktopRuntimeState, String> {
    build_runtime_state(&app).await
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn get_biome_iphone_diagnostics<R: Runtime>(
    app: AppHandle<R>,
) -> Result<BiomeIphoneDiagnostics, String> {
    Ok(build_biome_iphone_diagnostics(&app))
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn desktop_trigger_biome_iphone_sync<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<BiomeIphoneDiagnostics, String> {
    drain_biome_outbox_once(app.clone()).await?;
    Ok(build_biome_iphone_diagnostics(&app))
}

#[tauri::command]
#[instrument(skip(_app))]
pub async fn import_biome_iphone_export<R: Runtime + 'static>(
    _app: AppHandle<R>,
    path: String,
) -> Result<BiomeImportResult, String> {
    let source_path = PathBuf::from(path);
    let result = tauri::async_runtime::spawn_blocking(move || {
        import_biome_export_into_outbox(&source_path)
    })
    .await
    .map_err(|error| format!("Biome import task failed: {error}"))??;
    Ok(result)
}

#[tauri::command]
#[instrument(skip(app, token), fields(user_id = user_id.as_deref().unwrap_or(""), backend_base = backend_base.as_deref().unwrap_or("")))]
pub async fn desktop_set_auth_token<R: Runtime + 'static>(
    app: AppHandle<R>,
    token: String,
    user_id: Option<String>,
    backend_base: Option<String>,
) -> Result<DesktopRuntimeState, String> {
    let trimmed_token = token.trim().to_string();
    if trimmed_token.is_empty() {
        return Err("Auth token is required".to_string());
    }

    let normalized_user_id = user_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized_backend_base = normalize_backend_base(backend_base);
    let generation = app
        .state::<DesktopShellState>()
        .auth_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;

    crate::native_widget::write_auth_token_to_disk(&trimmed_token)?;

    update_auth_state(&app, |state| {
        state.token = Some(trimmed_token.clone());
        state.user_id = normalized_user_id.clone();
        state.backend_base = normalized_backend_base
            .clone()
            .or_else(|| state.backend_base.clone());
        state.last_updated_at_ms = Some(Utc::now().timestamp_millis());
        state.last_turso_error = None;
    });

    if let Some(user_id) = normalized_user_id.as_deref() {
        reconcile_native_user_configs(user_id)?;
    }

    if normalized_backend_base.is_some() {
        if should_skip_immediate_turso_refresh(&app) {
            if let Ok(Some(config)) = crate::native_widget::load_turso_sync_config() {
                schedule_turso_config_refresh(app.clone(), generation, &config.expires_at);
                update_auth_state(&app, |state| {
                    state.last_turso_error = None;
                });
                log::info!(
                    "[DESKTOP_RUNTIME] reusing persisted Turso config after auth handoff; skipping immediate activity.db reload"
                );
            }
        } else if let Err(error) = refresh_turso_sync_config(app.clone(), generation).await {
            warn!(error = %error, "Desktop Turso sync refresh failed after auth handoff");
        }
    }

    trigger_location_outbox_drain(app.clone());
    trigger_biome_outbox_drain(app.clone());

    let runtime_state = build_runtime_state(&app).await?;
    let _ = app.emit(RUNTIME_STATE_CHANGED_EVENT, runtime_state.clone());
    Ok(runtime_state)
}
