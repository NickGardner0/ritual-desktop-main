use super::*;
use chrono::{DateTime, Utc};
use std::fmt;
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TursoConfigErrorCode {
    AuthenticationRequired,
    PrivacyBlocked,
    RequestTimeout,
    RateLimited,
    ServiceUnavailable,
    InvalidResponse,
    NetworkUnavailable,
    Forbidden,
}

impl TursoConfigErrorCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::AuthenticationRequired => "authentication_required",
            Self::PrivacyBlocked => "privacy_blocked",
            Self::RequestTimeout => "request_timeout",
            Self::RateLimited => "rate_limited",
            Self::ServiceUnavailable => "service_unavailable",
            Self::InvalidResponse => "invalid_response",
            Self::NetworkUnavailable => "network_unavailable",
            Self::Forbidden => "forbidden",
        }
    }
}

#[derive(Clone, Debug)]
struct TursoConfigFetchError {
    code: TursoConfigErrorCode,
    message: String,
    retryable: bool,
}

impl fmt::Display for TursoConfigFetchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code.as_str(), self.message)
    }
}

fn classify_http_failure(status: u16, body: &str) -> (TursoConfigErrorCode, bool) {
    let retryable = matches!(status, 408 | 429 | 500 | 502 | 503 | 504);
    let code = match status {
        401 => TursoConfigErrorCode::AuthenticationRequired,
        403 if body.contains("privacy_blocked") => TursoConfigErrorCode::PrivacyBlocked,
        403 => TursoConfigErrorCode::Forbidden,
        408 => TursoConfigErrorCode::RequestTimeout,
        429 => TursoConfigErrorCode::RateLimited,
        _ => TursoConfigErrorCode::ServiceUnavailable,
    };
    (code, retryable)
}

async fn fetch_turso_sync_config(
    auth_token: String,
    backend_base: String,
    privacy_mode: String,
    cloud_consents: String,
) -> Result<TursoSyncConfigResponse, TursoConfigFetchError> {
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("{backend_base}/api/user/turso-sync-config");
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|error| TursoConfigFetchError {
                code: TursoConfigErrorCode::NetworkUnavailable,
                message: format!("Failed to create Turso config client: {error}"),
                retryable: true,
            })?;

        let mut last_error: Option<TursoConfigFetchError> = None;
        for attempt in 0..TURSO_SYNC_FETCH_RETRY_ATTEMPTS {
            let response = client
                .get(&url)
                .bearer_auth(&auth_token)
                .header("X-Ritual-Privacy-Mode", &privacy_mode)
                .header("X-Ritual-Cloud-Consents", &cloud_consents)
                .send();

            match response {
                Ok(response) => {
                    let status = response.status().as_u16();
                    let body = response.text().map_err(|error| TursoConfigFetchError {
                        code: TursoConfigErrorCode::InvalidResponse,
                        message: format!("Failed to read Turso sync config response: {error}"),
                        retryable: false,
                    })?;
                    if (200..300).contains(&status) {
                        return serde_json::from_str::<TursoSyncConfigResponse>(&body).map_err(
                            |error| TursoConfigFetchError {
                                code: TursoConfigErrorCode::InvalidResponse,
                                message: format!(
                                    "Failed to parse Turso sync config response: {error}"
                                ),
                                retryable: false,
                            },
                        );
                    }

                    let (code, retryable) = classify_http_failure(status, &body);
                    let error = TursoConfigFetchError {
                        code,
                        message: format!("Turso sync config request failed with HTTP {status}"),
                        retryable,
                    };
                    last_error = Some(error.clone());
                    if retryable && attempt + 1 < TURSO_SYNC_FETCH_RETRY_ATTEMPTS {
                        std::thread::sleep(Duration::from_secs(
                            TURSO_SYNC_FETCH_RETRY_BASE_SECS * (attempt as u64 + 1),
                        ));
                        continue;
                    }

                    return Err(error);
                }
                Err(error) => {
                    let is_timeout = error.is_timeout();
                    let error = TursoConfigFetchError {
                        code: if is_timeout {
                            TursoConfigErrorCode::RequestTimeout
                        } else {
                            TursoConfigErrorCode::NetworkUnavailable
                        },
                        message: format!("Failed to fetch Turso sync config: {error}"),
                        retryable: true,
                    };
                    last_error = Some(error.clone());
                    let retryable = error.retryable;
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

        Err(last_error.unwrap_or_else(|| TursoConfigFetchError {
            code: TursoConfigErrorCode::NetworkUnavailable,
            message: "Failed to fetch Turso sync config for an unknown reason".to_string(),
            retryable: true,
        }))
    })
    .await
    .map_err(|error| TursoConfigFetchError {
        code: TursoConfigErrorCode::NetworkUnavailable,
        message: format!("Turso config fetch task failed: {error}"),
        retryable: true,
    })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_401_is_an_auth_refresh_signal() {
        assert_eq!(
            classify_http_failure(401, "").0,
            TursoConfigErrorCode::AuthenticationRequired
        );
        assert_ne!(
            classify_http_failure(403, r#"{"privacy_blocked":true}"#).0,
            TursoConfigErrorCode::AuthenticationRequired
        );
    }

    #[test]
    fn privacy_403_is_stable_and_not_retryable() {
        assert_eq!(
            classify_http_failure(403, r#"{"privacy_blocked":true}"#),
            (TursoConfigErrorCode::PrivacyBlocked, false)
        );
    }
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
    refresh_turso_sync_config_with_trigger(app, generation, true).await
}

pub(crate) async fn refresh_turso_sync_config_with_trigger<R: Runtime + 'static>(
    app: AppHandle<R>,
    generation: u64,
    trigger_cloud_pass: bool,
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
    let privacy = crate::privacy_policy::read_privacy_state(&app);
    crate::privacy_policy::plaintext_cloud_sync_allowed(&privacy).map_err(|reason| {
        update_computer_sync_state(&app, |sync| {
            sync.stage = DesktopComputerSyncStage::PrivacyBlocked;
            sync.last_error_code = Some("privacy_blocked".to_string());
            sync.last_error_message = Some(reason.clone());
        });
        reason
    })?;

    match fetch_turso_sync_config(
        auth_token,
        backend_base,
        privacy.mode.as_header_value().to_string(),
        privacy.cloud_consents_header(),
    )
    .await
    {
        Ok(response) => {
            let config = crate::native_widget::TursoSyncConfig {
                sync_url: response.sync_url.trim().to_string(),
                auth_token: response.auth_token.trim().to_string(),
                expires_at: response.expires_at.trim().to_string(),
                database_name: response.database_name.trim().to_string(),
                activity_schema_version: response.activity_schema_version,
            };
            crate::native_widget::apply_turso_sync_config_internal(
                config.clone(),
                Some("desktop_runtime:refresh_turso_sync_config"),
            )
            .await?;
            if trigger_cloud_pass {
                crate::cloud_sync::trigger_cloud_sync_now(app.clone());
            }

            update_auth_state(&app, |state| {
                state.last_turso_sync_at_ms = Some(Utc::now().timestamp_millis());
                state.last_turso_error = None;
                state.last_turso_error_code = None;
            });
            update_computer_sync_state(&app, |sync| {
                sync.stage = DesktopComputerSyncStage::Uploading;
                sync.last_error_code = None;
                sync.last_error_message = None;
            });
            schedule_turso_config_refresh(app.clone(), generation, &config.expires_at);
            emit_runtime_state_changed(app.clone());
            Ok(())
        }
        Err(error) => {
            let code = error.code.as_str().to_string();
            let message = error.to_string();
            update_auth_state(&app, |state| {
                state.last_turso_error = Some(message.clone());
                state.last_turso_error_code = Some(code.clone());
            });
            update_computer_sync_state(&app, |sync| {
                sync.stage = if error.code == TursoConfigErrorCode::PrivacyBlocked {
                    DesktopComputerSyncStage::PrivacyBlocked
                } else {
                    DesktopComputerSyncStage::Failed
                };
                sync.last_error_code = Some(code.clone());
                sync.last_error_message = Some(message.clone());
            });

            if error.code == TursoConfigErrorCode::AuthenticationRequired {
                request_token_refresh(&app);
            } else if error.retryable {
                schedule_turso_config_retry(
                    app.clone(),
                    generation,
                    Duration::from_secs(TURSO_SYNC_FAILURE_RETRY_SECS),
                );
            }

            emit_runtime_state_changed(app.clone());
            Err(message)
        }
    }
}
