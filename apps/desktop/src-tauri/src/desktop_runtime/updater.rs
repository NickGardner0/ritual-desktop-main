use super::*;
use std::time::{Duration, Instant};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;
use tracing::instrument;

pub(crate) fn emit_update_status<R: Runtime>(app: &AppHandle<R>, event: UpdateStatusPhaseV2) {
    let (status, error, content_length, downloaded, percentage) = match &event {
        UpdateStatusPhaseV2::UpToDate => ("UPTODATE", None, None, None, None),
        UpdateStatusPhaseV2::Available => ("AVAILABLE", None, None, None, None),
        UpdateStatusPhaseV2::Downloading {
            content_length,
            downloaded,
            percentage,
        } => (
            "DOWNLOADING",
            None,
            Some(*content_length),
            Some(*downloaded),
            Some(*percentage),
        ),
        UpdateStatusPhaseV2::Installing => ("INSTALLING", None, None, None, Some(100)),
        UpdateStatusPhaseV2::Relaunching => ("DONE", None, None, None, Some(100)),
        UpdateStatusPhaseV2::Error { message } => {
            ("ERROR", Some(message.clone()), None, None, None)
        }
    };

    let _ = app.emit(
        UPDATE_STATUS_EVENT,
        UpdateStatusPayload {
            version: 2,
            event,
            content_length,
            downloaded,
            error,
            percentage,
            status: Some(status.to_string()),
        },
    );
}

pub(crate) async fn show_native_message<R: Runtime>(
    app: AppHandle<R>,
    title: String,
    body: String,
) {
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
    emit_update_status(
        &app,
        UpdateStatusPhaseV2::Downloading {
            content_length: 0,
            downloaded: 0,
            percentage: 0,
        },
    );

    let progress_app = app.clone();
    let installing_app = app.clone();
    let mut content_length: u64 = 0;
    let mut downloaded: u64 = 0;

    update
        .download_and_install(
            move |chunk_length, total| {
                content_length = total.unwrap_or(content_length);
                downloaded = downloaded.saturating_add(chunk_length as u64);
                let percentage = if content_length > 0 {
                    ((downloaded
                        .saturating_mul(100)
                        .saturating_add(content_length / 2)
                        / content_length)
                        .min(100)) as u8
                } else {
                    0
                };
                emit_update_status(
                    &progress_app,
                    UpdateStatusPhaseV2::Downloading {
                        content_length,
                        downloaded,
                        percentage,
                    },
                );
            },
            move || {
                emit_update_status(&installing_app, UpdateStatusPhaseV2::Installing);
            },
        )
        .await
        .map_err(|error| {
            let message = format!("Failed to download or install the update: {error}");
            emit_update_status(
                &app,
                UpdateStatusPhaseV2::Error {
                    message: message.clone(),
                },
            );
            message
        })?;

    emit_update_status(&app, UpdateStatusPhaseV2::Relaunching);
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
            emit_update_status(&app, UpdateStatusPhaseV2::UpToDate);

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
        let latest_version = manifest.version.clone();
        set_pending_update(&app, Some(manifest));
        emit_update_status(&app, UpdateStatusPhaseV2::Available);

        log::info!(
            "[DESKTOP_RUNTIME] update {} pending from {:?}; showing sidebar update control",
            latest_version,
            origin
        );

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
        tokio::time::sleep(Duration::from_secs(5)).await;

        loop {
            if let Err(error) = run_update_check(app.clone(), UpdateCheckOrigin::Startup).await {
                warn!(error = %error, "Desktop automatic update check failed");
            }
            tokio::time::sleep(Duration::from_secs(4 * 60 * 60)).await;
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
