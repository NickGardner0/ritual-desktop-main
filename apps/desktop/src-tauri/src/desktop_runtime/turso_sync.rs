use super::*;
use chrono::{DateTime, Utc};
use std::time::Duration;

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

pub(crate) fn schedule_turso_config_refresh<R: Runtime + 'static>(
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

pub async fn refresh_turso_sync_config<R: Runtime + 'static>(
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
