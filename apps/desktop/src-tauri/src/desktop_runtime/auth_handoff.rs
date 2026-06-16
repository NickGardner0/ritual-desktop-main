use super::*;
use tracing::instrument;
use chrono::Utc;
use std::sync::atomic::Ordering;

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
                super::turso_sync::schedule_turso_config_refresh(app.clone(), generation, &config.expires_at);
                update_auth_state(&app, |state| {
                    state.last_turso_error = None;
                });
                log::info!(
                    "[DESKTOP_RUNTIME] reusing persisted Turso config after auth handoff; skipping immediate activity.db reload"
                );
            }
        } else if let Err(error) = super::turso_sync::refresh_turso_sync_config(app.clone(), generation).await {
            warn!(error = %error, "Desktop Turso sync refresh failed after auth handoff");
        }
    }

    super::location_outbox::trigger_location_outbox_drain(app.clone());
    super::biome_outbox::trigger_biome_outbox_drain(app.clone());

    let runtime_state = build_runtime_state(&app).await?;
    let _ = app.emit(RUNTIME_STATE_CHANGED_EVENT, runtime_state.clone());
    Ok(runtime_state)
}
