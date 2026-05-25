use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;
use tracing::{info, instrument, warn};

use crate::desktop_observability::redact_sensitive_url_for_log;

const DESKTOP_RUNTIME_CAPABILITIES: &[&str] = &[
    "desktop-runtime-info-v1",
    "native-updater-v1",
    "native-startup-update-fallback-v1",
    "desktop-runtime-state-v1",
    "desktop-auth-handoff-v1",
    "desktop-runtime-events-v1",
];
const TURSO_SYNC_FETCH_RETRY_ATTEMPTS: usize = 3;
const TURSO_SYNC_FETCH_RETRY_BASE_SECS: u64 = 3;
const TURSO_SYNC_FAILURE_RETRY_SECS: u64 = 30;

pub const DASHBOARD_REFRESH_EVENT: &str = "desktop://dashboard-refresh";
pub const TOKEN_REFRESH_NEEDED_EVENT: &str = "desktop://token-refresh-needed";
pub const RUNTIME_STATE_CHANGED_EVENT: &str = "desktop://runtime-state-changed";
pub const AUTH_DEEP_LINK_EVENT: &str = "desktop://auth-deep-link";
pub const UPDATE_AVAILABLE_EVENT: &str = "tauri://update-available";
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

fn is_frontend_ready<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<DesktopShellState>();
    let frontend_ready = state
        .frontend_ready
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *frontend_ready
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

fn emit_update_available<R: Runtime>(app: &AppHandle<R>, manifest: &PendingUpdateManifest) {
    let _ = app.emit(UPDATE_AVAILABLE_EVENT, manifest.clone());
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
    body: Option<String>,
) -> Result<bool, String> {
    let release_notes = body.unwrap_or_else(|| {
        "This update includes the latest Ritual desktop improvements.".to_string()
    });
    let prompt =
        format!("Ritual {latest_version} is ready to install.\n\n{release_notes}\n\nInstall now?");

    tauri::async_runtime::spawn_blocking(move || {
        Ok::<bool, String>(
            _app.dialog()
                .message(prompt)
                .title("Ritual Update Ready")
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

        let manifest = PendingUpdateManifest {
            version: update.version.clone(),
            date: update.date.map(|value| value.to_string()),
            body: update.body.clone(),
        };
        set_pending_update(&app, Some(manifest.clone()));
        emit_update_available(&app, &manifest);

        match origin {
            UpdateCheckOrigin::Startup => {
                if is_frontend_ready(&app) {
                    log::info!(
                        "[DESKTOP_RUNTIME] update {} pending; branded frontend prompt will handle install",
                        manifest.version
                    );
                } else {
                    log::info!(
                        "[DESKTOP_RUNTIME] update {} pending before frontend readiness; showing native install prompt",
                        manifest.version
                    );
                    if prompt_for_native_install(
                        app.clone(),
                        manifest.version.clone(),
                        manifest.body.clone(),
                    )
                    .await?
                    {
                        install_latest_update(app.clone()).await?;
                    }
                }
            }
            UpdateCheckOrigin::Tray => {
                if prompt_for_native_install(
                    app.clone(),
                    manifest.version.clone(),
                    manifest.body.clone(),
                )
                .await?
                {
                    install_latest_update(app.clone()).await?;
                }
            }
            UpdateCheckOrigin::Frontend => {}
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

    let runtime_state = build_runtime_state(&app).await?;
    let _ = app.emit(RUNTIME_STATE_CHANGED_EVENT, runtime_state.clone());
    Ok(runtime_state)
}
