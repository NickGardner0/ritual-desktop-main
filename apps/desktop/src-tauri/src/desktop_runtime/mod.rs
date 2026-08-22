use chrono::Utc;
use serde::Serialize;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::UpdaterExt;
use tracing::{info, instrument, warn};

use crate::desktop_observability::redact_sensitive_url_for_log;
use crate::desktop_runtime_types::{
    BiomeDeviceDiagnostics, BiomeDrainSnapshot, BiomeIngestResponse, BiomeIphoneDiagnostics,
    BiomeOutboxDiagnostics, DesktopBiomeActivityEvent, DesktopLocationPing, LocationIngestResponse,
    TursoSyncConfigResponse, UpdateStatusPayload,
};

pub(crate) const DESKTOP_RUNTIME_CAPABILITIES: &[&str] = &[
    "desktop-runtime-info-v1",
    "native-updater-v1",
    "sidebar-updater-v1",
    "native-startup-update-fallback-v1",
    "desktop-runtime-state-v1",
    "desktop-auth-handoff-v1",
    "desktop-runtime-events-v1",
];
pub(crate) const TURSO_SYNC_FETCH_RETRY_ATTEMPTS: usize = 3;
pub(crate) const TURSO_SYNC_FETCH_RETRY_BASE_SECS: u64 = 3;
pub(crate) const TURSO_SYNC_FAILURE_RETRY_SECS: u64 = 30;
pub(crate) const LOCATION_OUTBOX_DRAIN_INTERVAL_SECS: u64 = 60;
pub(crate) const LOCATION_OUTBOX_BATCH_SIZE: usize = 500;
pub(crate) const BIOME_OUTBOX_DRAIN_INTERVAL_SECS: u64 = 60;
pub(crate) const BIOME_OUTBOX_BATCH_SIZE: usize = 500;

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

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesktopProcessMetrics {
    pub webview_pid: Option<u32>,
    pub webview_rss_bytes: Option<u64>,
    pub watcher_pid: Option<u32>,
    pub watcher_rss_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeState {
    pub auth: DesktopAuthRuntimeState,
    pub database: crate::ritual_database::DatabaseRuntimeStateSnapshot,
    pub watcher: crate::watcher::WatcherLifecycleSnapshot,
    pub process: DesktopProcessMetrics,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct DesktopAuthState {
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
pub(crate) enum UpdateCheckOrigin {
    Startup,
    Frontend,
    Tray,
}

fn read_nonempty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn configured_ritual_env() -> String {
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

pub(crate) fn build_runtime_info<R: Runtime>(app: &AppHandle<R>) -> DesktopRuntimeInfo {
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

pub(crate) fn begin_update_check<R: Runtime>(app: &AppHandle<R>) -> bool {
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

pub(crate) fn end_update_check<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<DesktopShellState>();
    let mut in_progress = state
        .update_check_in_progress
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *in_progress = false;
}

pub(crate) fn set_pending_update<R: Runtime + 'static>(
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

pub(crate) fn frontend_is_ready<R: Runtime>(app: &AppHandle<R>) -> bool {
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

pub(crate) fn clear_pending_auth_deep_link<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<DesktopShellState>();
    let mut pending = state
        .pending_auth_deep_link
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *pending = None;
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

const PRODUCTION_BACKEND_URL: &str = "https://backend-api-production-a37e.up.railway.app";

fn is_production_ritual_env(ritual_env: &str) -> bool {
    matches!(ritual_env.trim().to_ascii_lowercase().as_str(), "production" | "prod")
}

fn is_loopback_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("://127.0.0.1")
        || lower.contains("://localhost")
        || lower.contains("://[::1]")
}

pub(crate) fn normalize_backend_base(value: Option<String>) -> Option<String> {
    normalize_backend_base_for_env(value, &configured_ritual_env())
}

pub(crate) fn normalize_backend_base_for_env(
    value: Option<String>,
    ritual_env: &str,
) -> Option<String> {
    let url = value
        .map(|item| item.trim().trim_end_matches('/').to_string())
        .filter(|item| !item.is_empty())?;
    if is_production_ritual_env(ritual_env) && is_loopback_http_url(&url) {
        return Some(read_nonempty_env("RITUAL_BACKEND_URL").unwrap_or_else(|| {
            PRODUCTION_BACKEND_URL.to_string()
        }));
    }
    Some(url)
}

pub(crate) fn persisted_turso_config_is_fresh_enough() -> bool {
    crate::native_widget::persisted_turso_sync_config_is_fresh_enough()
}

pub(crate) fn should_skip_immediate_turso_refresh<R: Runtime>(app: &AppHandle<R>) -> bool {
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

pub(crate) fn read_auth_state<R: Runtime>(app: &AppHandle<R>) -> DesktopAuthState {
    app.state::<DesktopShellState>()
        .auth_state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub(crate) fn update_auth_state<R: Runtime, F>(app: &AppHandle<R>, mutator: F)
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

pub(crate) fn parse_ps_rss_bytes(stdout: &str) -> Option<u64> {
    stdout
        .trim()
        .parse::<u64>()
        .ok()
        .map(|kilobytes| kilobytes.saturating_mul(1024))
}

fn process_rss_bytes(pid: u32) -> Option<u64> {
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_ps_rss_bytes(&String::from_utf8_lossy(&output.stdout))
}

fn collect_process_metrics(watcher_pid: Option<u32>) -> DesktopProcessMetrics {
    let webview_pid = std::process::id();
    DesktopProcessMetrics {
        webview_pid: Some(webview_pid),
        webview_rss_bytes: process_rss_bytes(webview_pid),
        watcher_pid,
        watcher_rss_bytes: watcher_pid.and_then(process_rss_bytes),
    }
}

async fn build_runtime_state<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<DesktopRuntimeState, String> {
    let auth = build_auth_runtime_state(app);
    let database = crate::ritual_database::database_runtime_state_snapshot();
    let watcher = crate::watcher::get_watcher_lifecycle_snapshot().await;
    let process = collect_process_metrics(watcher.pid);

    Ok(DesktopRuntimeState {
        auth,
        database,
        watcher,
        process,
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

pub mod auth_handoff;
pub mod biome_outbox;
pub mod location_outbox;
pub mod turso_sync;
pub mod updater;

pub use biome_outbox::{register_biome_outbox_drain_worker, BiomeImportResult};
pub use location_outbox::register_location_outbox_drain_worker;
pub use updater::{register_startup_update_check, tray_check_for_updates};

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
    Ok(biome_outbox::build_biome_iphone_diagnostics(&app))
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn desktop_trigger_biome_iphone_sync<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<BiomeIphoneDiagnostics, String> {
    biome_outbox::drain_biome_outbox_once(app.clone()).await?;
    Ok(biome_outbox::build_biome_iphone_diagnostics(&app))
}

#[tauri::command]
#[instrument(skip(_app))]
pub async fn import_biome_iphone_export<R: Runtime + 'static>(
    _app: AppHandle<R>,
    path: String,
) -> Result<BiomeImportResult, String> {
    let source_path = PathBuf::from(path);
    let result = tauri::async_runtime::spawn_blocking(move || {
        biome_outbox::import_biome_export_into_outbox(&source_path)
    })
    .await
    .map_err(|error| format!("Biome import task failed: {error}"))??;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::parse_ps_rss_bytes;

    #[test]
    fn parses_ps_rss_kilobytes_into_bytes() {
        assert_eq!(parse_ps_rss_bytes("  2048\n"), Some(2048 * 1024));
        assert_eq!(parse_ps_rss_bytes("not-a-number"), None);
    }

    #[test]
    fn production_env_rewrites_loopback_backend_base() {
        assert_eq!(
            super::normalize_backend_base_for_env(
                Some("http://127.0.0.1:8000/".to_string()),
                "production",
            ),
            Some("https://backend-api-production-a37e.up.railway.app".to_string()),
        );
    }

    #[test]
    fn development_env_keeps_loopback_backend_base() {
        assert_eq!(
            super::normalize_backend_base_for_env(
                Some("http://127.0.0.1:8000".to_string()),
                "development",
            ),
            Some("http://127.0.0.1:8000".to_string()),
        );
    }
}
