use std::env;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::api::dialog::blocking::{ask, message};
use tauri::{AppHandle, Manager, Runtime};
use tracing::{instrument, warn};

const DESKTOP_RUNTIME_CAPABILITIES: &[&str] = &[
    "desktop-runtime-info-v1",
    "native-updater-v1",
    "native-startup-update-fallback-v1",
];

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

#[derive(Default)]
pub struct DesktopShellState {
    frontend_ready: std::sync::Mutex<bool>,
    update_check_in_progress: std::sync::Mutex<bool>,
    pending_update: std::sync::Mutex<Option<PendingUpdateManifest>>,
}

#[derive(Clone, Copy, Debug)]
enum UpdateCheckOrigin {
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
    let frontend_ready = *state.frontend_ready.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let pending_update = state.pending_update.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone();

    DesktopRuntimeInfo {
        version: app.package_info().version.to_string(),
        environment: configured_ritual_env(),
        capabilities: DESKTOP_RUNTIME_CAPABILITIES
            .iter()
            .map(|capability| (*capability).to_string())
            .collect(),
        updater_active: app.config().tauri.updater.active,
        frontend_ready,
        target: tauri::updater::target(),
        pending_update,
    }
}

fn begin_update_check<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<DesktopShellState>();
    let mut in_progress = state.update_check_in_progress.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if *in_progress {
        return false;
    }

    *in_progress = true;
    true
}

fn end_update_check<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<DesktopShellState>();
    let mut in_progress = state.update_check_in_progress.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *in_progress = false;
}

fn set_pending_update<R: Runtime>(app: &AppHandle<R>, update: Option<PendingUpdateManifest>) {
    let state = app.state::<DesktopShellState>();
    let mut pending = state.pending_update.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *pending = update;
}

fn frontend_is_ready<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<DesktopShellState>();
    let ready = *state.frontend_ready.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    ready
}

async fn show_native_message<R: Runtime>(title: String, body: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        message::<R>(None, title, body);
    })
    .await;
}

async fn prompt_for_native_install<R: Runtime>(
    app: AppHandle<R>,
    latest_version: String,
    body: Option<String>,
) -> Result<bool, String> {
    let current_version = app.package_info().version.to_string();
    let release_notes = body.unwrap_or_else(|| "No release notes were provided.".to_string());
    let prompt = format!(
        "Ritual {latest_version} is available. You have {current_version}.\n\nRelease notes:\n{release_notes}\n\nInstall now?"
    );

    tauri::async_runtime::spawn_blocking(move || ask::<R>(None, "Ritual Update Available", prompt))
        .await
        .map_err(|error| format!("Failed to show native update prompt: {error}"))
}

async fn install_latest_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let update = app
        .updater()
        .check()
        .await
        .map_err(|error| format!("Failed to check for updates: {error}"))?;

    if !update.is_update_available() {
        set_pending_update(&app, None);
        return Err("Ritual is already up to date.".to_string());
    }

    let manifest = PendingUpdateManifest {
        version: update.latest_version().to_string(),
        date: update.date().map(|value| value.to_string()),
        body: update.body().cloned(),
    };
    set_pending_update(&app, Some(manifest));

    update
        .download_and_install()
        .await
        .map_err(|error| format!("Failed to download or install the update: {error}"))?;

    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

fn schedule_startup_fallback_prompt<R: Runtime + 'static>(
    app: AppHandle<R>,
    manifest: PendingUpdateManifest,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(6)).await;

        if frontend_is_ready(&app) {
            return;
        }

        let still_pending = {
            let state = app.state::<DesktopShellState>();
            let is_pending = state
                .pending_update
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_ref()
                .map(|pending| pending.version == manifest.version)
                .unwrap_or(false);
            is_pending
        };

        if !still_pending {
            return;
        }

        match prompt_for_native_install(
            app.clone(),
            manifest.version.clone(),
            manifest.body.clone(),
        )
        .await
        {
            Ok(true) => {
                if let Err(error) = install_latest_update(app.clone()).await {
                    show_native_message::<R>("Ritual Update Failed".to_string(), error).await;
                }
            }
            Ok(false) => {}
            Err(error) => {
                show_native_message::<R>("Ritual Update Failed".to_string(), error).await;
            }
        }
    });
}

#[instrument(skip(app), fields(origin = ?origin))]
async fn run_update_check<R: Runtime + 'static>(
    app: AppHandle<R>,
    origin: UpdateCheckOrigin,
) -> Result<(), String> {
    let started_at = Instant::now();
    if !app.config().tauri.updater.active {
        return Err("Ritual desktop updater is disabled in this build.".to_string());
    }

    if !begin_update_check(&app) {
        return Ok(());
    }

    let result = async {
        let update = app
            .updater()
            .check()
            .await
            .map_err(|error| format!("Failed to check for updates: {error}"))?;

        if !update.is_update_available() {
            set_pending_update(&app, None);

            if matches!(origin, UpdateCheckOrigin::Tray) {
                show_native_message::<R>(
                    "Ritual Desktop".to_string(),
                    "You already have the latest Ritual desktop build.".to_string(),
                )
                .await;
            }

            return Ok(());
        }

        let manifest = PendingUpdateManifest {
            version: update.latest_version().to_string(),
            date: update.date().map(|value| value.to_string()),
            body: update.body().cloned(),
        };
        set_pending_update(&app, Some(manifest.clone()));

        match origin {
            UpdateCheckOrigin::Startup => {
                if !frontend_is_ready(&app) {
                    schedule_startup_fallback_prompt(app.clone(), manifest);
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
            show_native_message::<R>("Ritual Update Check Failed".to_string(), error).await;
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
    let mut frontend_ready = state.frontend_ready.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *frontend_ready = true;
    drop(frontend_ready);

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
