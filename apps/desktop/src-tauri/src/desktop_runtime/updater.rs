use super::*;
use tracing::instrument;
#[cfg(target_os = "macos")]
use std::ffi::CString;
#[cfg(target_os = "macos")]
use std::os::raw::c_char;
use std::time::{Duration, Instant};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "macos")]
extern "C" {
    fn show_ritual_update_install_prompt(version: *const c_char) -> bool;
}

pub(crate) fn emit_update_status<R: Runtime>(app: &AppHandle<R>, status: &str, error: Option<String>) {
    let _ = app.emit(
        UPDATE_STATUS_EVENT,
        UpdateStatusPayload {
            error,
            status: Some(status.to_string()),
        },
    );
}

pub(crate) async fn show_native_message<R: Runtime>(app: AppHandle<R>, title: String, body: String) {
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

pub(crate) async fn prompt_for_native_install<R: Runtime>(
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

pub(crate) async fn install_latest_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
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
pub(crate) async fn run_update_check<R: Runtime + 'static>(
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
