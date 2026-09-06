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
    "desktop-auth-handoff-v2",
    "desktop-channel-identity-v1",
    "desktop-runtime-events-v1",
    "desktop-privacy-state-v1",
    "desktop-local-activity-rollups-v1",
    "desktop-computer-sync-v2",
    "desktop-computer-sync-v3",
    "desktop-resident-runtime-v1",
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
    pub channel: String,
    pub product_name: String,
    pub bundle_id: String,
    pub callback_scheme: String,
    pub build_sha: String,
    pub handoff_protocol: String,
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
    pub last_turso_error_code: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DesktopComputerSyncStage {
    #[default]
    Idle,
    Materializing,
    LocalReady,
    ObtainingConfig,
    Uploading,
    Verifying,
    Downloading,
    // Serialized by sync-v2 clients during the compatibility window. New
    // sync-v3 orchestration never constructs this stage.
    #[allow(dead_code)]
    Projecting,
    Synced,
    PrivacyBlocked,
    Failed,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopComputerSyncRuntimeState {
    pub stage: DesktopComputerSyncStage,
    pub pending_rollups: u64,
    pub pending_raw_rows: u64,
    pub uploaded_rollups: u64,
    pub superseded_raw_rows: u64,
    pub local_watermark_ms: Option<i64>,
    pub remote_watermark_ms: Option<i64>,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
    pub last_updated_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WatcherRssSampleState {
    Sampled,
    NotApplicable,
    Pending,
    Unavailable,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopProcessMetrics {
    pub webview_pid: Option<u32>,
    pub webview_rss_bytes: Option<u64>,
    pub watcher_pid: Option<u32>,
    pub watcher_rss_bytes: Option<u64>,
    pub watcher_rss_sample_state: WatcherRssSampleState,
    pub watcher_rss_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeState {
    pub auth: DesktopAuthRuntimeState,
    pub privacy: crate::privacy_policy::DesktopPrivacyState,
    pub computer_sync: DesktopComputerSyncRuntimeState,
    pub database: crate::ritual_database::DatabaseRuntimeStateSnapshot,
    pub watcher: crate::watcher::WatcherLifecycleSnapshot,
    pub process: DesktopProcessMetrics,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopProcessIdentity {
    pub pid: u32,
    pub process_name: String,
    pub executable_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindowDiagnostics {
    pub exists: bool,
    pub visible: bool,
    pub focused: bool,
    pub ignores_mouse_events: Option<bool>,
    pub window_level: Option<i64>,
    pub hit_testable: bool,
    pub main_content_opaque: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDiagnostics {
    pub schema_version: u32,
    pub runtime: DesktopRuntimeInfo,
    pub process: DesktopProcessIdentity,
    pub backend_base: Option<String>,
    pub native_gateway_status: String,
    pub ipc_status: String,
    pub app_data_directory: String,
    pub callback_scheme_owner: Option<String>,
    pub window: DesktopWindowDiagnostics,
    pub state: DesktopRuntimeState,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct DesktopAuthState {
    pub(crate) token: Option<String>,
    pub(crate) user_id: Option<String>,
    pub(crate) backend_base: Option<String>,
    last_updated_at_ms: Option<i64>,
    last_turso_sync_at_ms: Option<i64>,
    turso_refresh_scheduled_for_ms: Option<i64>,
    last_turso_error: Option<String>,
    last_turso_error_code: Option<String>,
}

pub struct DesktopShellState {
    frontend_ready: Mutex<bool>,
    update_check_in_progress: Mutex<bool>,
    pending_update: Mutex<Option<PendingUpdateManifest>>,
    pending_auth_deep_link: Mutex<Option<String>>,
    auth_state: Mutex<DesktopAuthState>,
    pub(crate) privacy_state: Mutex<crate::privacy_policy::DesktopPrivacyState>,
    pub(crate) computer_sync_state: Mutex<DesktopComputerSyncRuntimeState>,
    pub(crate) auth_generation: AtomicU64,
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
            privacy_state: Mutex::new(
                crate::privacy_policy::load_persisted_privacy_state().unwrap_or_default(),
            ),
            computer_sync_state: Mutex::new(DesktopComputerSyncRuntimeState::default()),
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

    let channel = crate::app_paths::configured_channel();
    DesktopRuntimeInfo {
        version: app.package_info().version.to_string(),
        environment: configured_ritual_env(),
        channel: channel.as_str().to_string(),
        product_name: channel.product_name().to_string(),
        bundle_id: channel.bundle_id().to_string(),
        callback_scheme: channel.callback_scheme().to_string(),
        build_sha: read_nonempty_env("RITUAL_BUILD_SHA")
            .or_else(|| option_env!("RITUAL_BUILD_SHA").map(str::to_string))
            .unwrap_or_else(|| "unknown".to_string()),
        handoff_protocol: "2".to_string(),
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
    matches!(
        ritual_env.trim().to_ascii_lowercase().as_str(),
        "production" | "prod"
    )
}

fn is_loopback_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("://127.0.0.1") || lower.contains("://localhost") || lower.contains("://[::1]")
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
        return Some(
            read_nonempty_env("RITUAL_BACKEND_URL")
                .unwrap_or_else(|| PRODUCTION_BACKEND_URL.to_string()),
        );
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
        last_turso_error_code: auth_state.last_turso_error_code,
    }
}

pub(crate) fn read_computer_sync_state<R: Runtime>(
    app: &AppHandle<R>,
) -> DesktopComputerSyncRuntimeState {
    app.state::<DesktopShellState>()
        .computer_sync_state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub(crate) fn update_computer_sync_state<R: Runtime, F>(app: &AppHandle<R>, mutator: F)
where
    F: FnOnce(&mut DesktopComputerSyncRuntimeState),
{
    let state = app.state::<DesktopShellState>();
    let mut computer_sync = state
        .computer_sync_state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    mutator(&mut computer_sync);
    computer_sync.last_updated_at_ms = Some(Utc::now().timestamp_millis());
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

pub(crate) fn process_rss_bytes(pid: u32) -> Option<u64> {
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_ps_rss_bytes(&String::from_utf8_lossy(&output.stdout))
}

fn collect_process_metrics(
    watcher: &crate::watcher::WatcherLifecycleSnapshot,
) -> DesktopProcessMetrics {
    let webview_pid = std::process::id();
    let (watcher_pid, watcher_rss_bytes, watcher_rss_sample_state, watcher_rss_reason) =
        match watcher.state {
            crate::watcher::lifecycle::WatcherLifecycleState::Ready => {
                let rss = watcher
                    .pid
                    .and_then(process_rss_bytes)
                    .filter(|bytes| *bytes > 0);
                if rss.is_some() {
                    (watcher.pid, rss, WatcherRssSampleState::Sampled, None)
                } else {
                    (
                        watcher.pid,
                        None,
                        WatcherRssSampleState::Unavailable,
                        Some("watcher_rss_unavailable_after_readiness".to_string()),
                    )
                }
            }
            crate::watcher::lifecycle::WatcherLifecycleState::NeverEnabled => (
                None,
                None,
                WatcherRssSampleState::NotApplicable,
                Some("watcher_never_enabled".to_string()),
            ),
            crate::watcher::lifecycle::WatcherLifecycleState::DisabledByUser => (
                None,
                None,
                WatcherRssSampleState::NotApplicable,
                Some("watcher_disabled_by_user".to_string()),
            ),
            crate::watcher::lifecycle::WatcherLifecycleState::DisabledNoPermission => (
                None,
                None,
                WatcherRssSampleState::NotApplicable,
                Some("accessibility_permission_not_granted".to_string()),
            ),
            crate::watcher::lifecycle::WatcherLifecycleState::Starting => (
                None,
                None,
                WatcherRssSampleState::Pending,
                Some("watcher_readiness_pending".to_string()),
            ),
            crate::watcher::lifecycle::WatcherLifecycleState::Failed
            | crate::watcher::lifecycle::WatcherLifecycleState::Backoff => (
                None,
                None,
                WatcherRssSampleState::Unavailable,
                watcher
                    .failure_reason
                    .clone()
                    .or_else(|| Some("watcher_not_ready".to_string())),
            ),
        };
    DesktopProcessMetrics {
        webview_pid: Some(webview_pid),
        webview_rss_bytes: process_rss_bytes(webview_pid),
        watcher_pid,
        watcher_rss_bytes,
        watcher_rss_sample_state,
        watcher_rss_reason,
    }
}

async fn build_runtime_state<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<DesktopRuntimeState, String> {
    let auth = build_auth_runtime_state(app);
    let privacy = crate::privacy_policy::read_privacy_state(app);
    let computer_sync = read_computer_sync_state(app);
    let database = crate::ritual_database::database_runtime_state_snapshot();
    let watcher = crate::watcher::get_watcher_lifecycle_snapshot().await;
    let process = collect_process_metrics(&watcher);

    Ok(DesktopRuntimeState {
        auth,
        privacy,
        computer_sync,
        database,
        watcher,
        process,
    })
}

#[tauri::command]
#[instrument(skip(app, state))]
pub async fn desktop_set_privacy_state<R: Runtime + 'static>(
    app: AppHandle<R>,
    state: crate::privacy_policy::DesktopPrivacyStateInput,
) -> Result<DesktopRuntimeState, String> {
    let next_state = crate::privacy_policy::DesktopPrivacyState::try_from(state)?;
    crate::privacy_policy::persist_privacy_state(&next_state)?;
    let cloud_allowed = crate::privacy_policy::plaintext_cloud_sync_allowed(&next_state).is_ok();
    let state_changed = {
        let shell = app.state::<DesktopShellState>();
        let mut current = shell
            .privacy_state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let changed = *current != next_state;
        *current = next_state.clone();
        changed
    };

    if !cloud_allowed {
        crate::native_widget::clear_turso_sync_config()?;
        update_auth_state(&app, |auth| {
            auth.turso_refresh_scheduled_for_ms = None;
            auth.last_turso_error = None;
            auth.last_turso_error_code = None;
        });
        update_computer_sync_state(&app, |sync| {
            sync.stage = if matches!(
                next_state.mode,
                crate::privacy_policy::PrivacyMode::CloudIntelligence
            ) {
                sync.last_error_code = Some("privacy_blocked".to_string());
                sync.last_error_message = Some(
                    "Cloud Intelligence requires plaintext_sync consent for computer rollups"
                        .to_string(),
                );
                DesktopComputerSyncStage::PrivacyBlocked
            } else {
                sync.last_error_code = None;
                sync.last_error_message = None;
                DesktopComputerSyncStage::LocalReady
            };
        });
    } else if state_changed {
        update_computer_sync_state(&app, |sync| {
            sync.stage = DesktopComputerSyncStage::ObtainingConfig;
            sync.last_error_code = None;
            sync.last_error_message = None;
        });
        let generation = app
            .state::<DesktopShellState>()
            .auth_generation
            .load(Ordering::SeqCst);
        let auth = read_auth_state(&app);
        if auth.token.is_some() && auth.backend_base.is_some() {
            if let Err(error) = turso_sync::refresh_turso_sync_config(app.clone(), generation).await
            {
                warn!(error = %error, "Turso refresh failed after privacy state update");
            }
        }
    }

    let runtime_state = build_runtime_state(&app).await?;
    let _ = app.emit(RUNTIME_STATE_CHANGED_EVENT, runtime_state.clone());
    Ok(runtime_state)
}

fn callback_scheme_owner(scheme: &str) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("/usr/bin/defaults")
            .args([
                "read",
                "com.apple.LaunchServices/com.apple.launchservices.secure",
                "LSHandlers",
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let marker = format!("LSHandlerURLScheme = \"{scheme}\"");
        let block = stdout
            .split("},")
            .find(|candidate| candidate.contains(&marker))?;
        for line in block.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("LSHandlerRoleAll =") {
                return trimmed
                    .split_once('=')
                    .map(|(_, value)| value.trim().trim_matches(['\"', ';']).to_string());
            }
        }
        None
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = scheme;
        None
    }
}

fn window_diagnostics<R: Runtime>(app: &AppHandle<R>) -> DesktopWindowDiagnostics {
    let Some(window) = app.get_webview_window("main") else {
        return DesktopWindowDiagnostics {
            exists: false,
            visible: false,
            focused: false,
            ignores_mouse_events: None,
            window_level: None,
            hit_testable: false,
            main_content_opaque: true,
        };
    };
    let mut ignores_mouse_events = None;
    let mut window_level = None;
    #[cfg(target_os = "macos")]
    if let Ok(raw_window) = window.ns_window() {
        use cocoa::base::id;
        use objc::{msg_send, sel, sel_impl};
        unsafe {
            let ns_window: id = raw_window as id;
            let ignores: cocoa::base::BOOL = msg_send![ns_window, ignoresMouseEvents];
            let level: i64 = msg_send![ns_window, level];
            ignores_mouse_events = Some(ignores != cocoa::base::NO);
            window_level = Some(level);
        }
    }
    let hit_testable = ignores_mouse_events != Some(true) && window_level.unwrap_or(0) == 0;
    DesktopWindowDiagnostics {
        exists: true,
        visible: window.is_visible().unwrap_or(false),
        focused: window.is_focused().unwrap_or(false),
        ignores_mouse_events,
        window_level,
        hit_testable,
        main_content_opaque: std::env::var("RITUAL_DISABLE_MAIN_GLASS")
            .map(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(false),
    }
}

pub async fn build_desktop_diagnostics<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<DesktopDiagnostics, String> {
    let runtime = build_runtime_info(app);
    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Failed resolving desktop executable: {error}"))?;
    let state = build_runtime_state(app).await?;
    let backend_base = state.auth.backend_base.clone().or_else(|| {
        read_nonempty_env("RITUAL_BACKEND_URL").or_else(|| {
            Some(PRODUCTION_BACKEND_URL.to_string()).filter(|_| runtime.channel == "production")
        })
    });
    Ok(DesktopDiagnostics {
        schema_version: 1,
        process: DesktopProcessIdentity {
            pid: std::process::id(),
            process_name: executable_path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| runtime.product_name.clone()),
            executable_path: executable_path.to_string_lossy().to_string(),
        },
        backend_base,
        native_gateway_status: "ready".to_string(),
        ipc_status: "tauri-v2".to_string(),
        app_data_directory: crate::app_paths::data_dir().to_string_lossy().to_string(),
        callback_scheme_owner: callback_scheme_owner(&runtime.callback_scheme),
        window: window_diagnostics(app),
        runtime,
        state,
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
pub mod auth_session;
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
pub async fn get_desktop_diagnostics<R: Runtime>(
    app: AppHandle<R>,
) -> Result<DesktopDiagnostics, String> {
    build_desktop_diagnostics(&app).await
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
