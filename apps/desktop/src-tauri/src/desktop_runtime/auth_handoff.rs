use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tracing::{info, instrument, warn};

pub const DESKTOP_AUTH_HANDOFF_PROTOCOL: &str = "2";
const DESKTOP_AUTH_HANDOFF_TTL_MS: i64 = 5 * 60 * 1000;
const PENDING_HANDOFF_FILE: &str = "desktop_auth_handoff_v2.json";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAuthHandoffStart {
    pub handoff_id: String,
    pub nonce_challenge: String,
    pub channel: String,
    pub protocol: String,
    pub expires_at_ms: i64,
    pub app_version: String,
    pub build_sha: String,
    pub product_name: String,
    pub bundle_id: String,
    pub callback_scheme: String,
    pub target: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingDesktopAuthHandoff {
    handoff_id: String,
    nonce: String,
    channel: String,
    protocol: String,
    expires_at_ms: i64,
}

fn pending_handoff_path() -> PathBuf {
    crate::app_paths::data_dir().join(PENDING_HANDOFF_FILE)
}

fn allow_legacy_v1() -> bool {
    if crate::app_paths::configured_channel() != crate::app_paths::DesktopChannel::Production {
        return false;
    }
    std::env::var("RITUAL_ALLOW_AUTH_HANDOFF_V1")
        .map(|value| {
            !matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            )
        })
        .unwrap_or(true)
}

pub(crate) fn is_supported_scheme(raw: &str) -> bool {
    let channel = crate::app_paths::configured_channel();
    let configured = format!("{}://", channel.callback_scheme());
    raw.trim().starts_with(&configured)
        || (allow_legacy_v1() && raw.trim().starts_with("ritual://"))
}

#[tauri::command]
#[instrument(skip(app))]
pub fn desktop_begin_auth_handoff<R: Runtime>(
    app: AppHandle<R>,
) -> Result<DesktopAuthHandoffStart, String> {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let nonce = URL_SAFE_NO_PAD.encode(bytes);
    let nonce_challenge = format!("{:x}", Sha256::digest(nonce.as_bytes()));
    let mut handoff_bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut handoff_bytes);
    let handoff_id = format!("dah_{}", URL_SAFE_NO_PAD.encode(handoff_bytes));
    let channel = crate::app_paths::configured_channel();
    let expires_at_ms = Utc::now().timestamp_millis() + DESKTOP_AUTH_HANDOFF_TTL_MS;
    let pending = PendingDesktopAuthHandoff {
        handoff_id: handoff_id.clone(),
        nonce: nonce.clone(),
        channel: channel.as_str().to_string(),
        protocol: DESKTOP_AUTH_HANDOFF_PROTOCOL.to_string(),
        expires_at_ms,
    };
    let path = pending_handoff_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed creating desktop auth state directory: {error}"))?;
    }
    let encoded = serde_json::to_vec(&pending)
        .map_err(|error| format!("Failed encoding desktop auth handoff: {error}"))?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&path)
        .map_err(|error| format!("Failed opening desktop auth handoff: {error}"))?;
    file.write_all(&encoded)
        .map_err(|error| format!("Failed persisting desktop auth handoff: {error}"))?;

    let runtime = super::build_runtime_info(&app);
    Ok(DesktopAuthHandoffStart {
        handoff_id,
        nonce_challenge,
        channel: runtime.channel,
        protocol: runtime.handoff_protocol,
        expires_at_ms,
        app_version: runtime.version,
        build_sha: runtime.build_sha,
        product_name: runtime.product_name,
        bundle_id: runtime.bundle_id,
        callback_scheme: runtime.callback_scheme,
        target: runtime.target,
    })
}

pub(crate) fn prepare_deep_link_for_webview(raw: &str) -> Result<String, String> {
    if !is_supported_scheme(raw) {
        return Err(
            "Desktop authentication callback scheme does not match this channel".to_string(),
        );
    }
    let parsed = tauri::Url::parse(raw)
        .map_err(|error| format!("Invalid desktop authentication callback: {error}"))?;
    let query = parsed
        .query_pairs()
        .into_owned()
        .collect::<std::collections::HashMap<String, String>>();
    let protocol = query.get("protocol").map(|value| value.as_ref());
    if protocol != Some(DESKTOP_AUTH_HANDOFF_PROTOCOL) {
        return if allow_legacy_v1() && protocol.is_none() {
            Ok(raw.to_string())
        } else {
            Err("Desktop authentication callback protocol is unsupported".to_string())
        };
    }

    let pending_path = pending_handoff_path();
    let pending: PendingDesktopAuthHandoff =
        serde_json::from_slice(&fs::read(&pending_path).map_err(|_| {
            "No pending desktop authentication request exists for this channel".to_string()
        })?)
        .map_err(|error| format!("Pending desktop authentication request is invalid: {error}"))?;
    if pending.expires_at_ms <= Utc::now().timestamp_millis() {
        let _ = fs::remove_file(&pending_path);
        return Err("Pending desktop authentication request expired".to_string());
    }
    let nonce = query.get("nonce").map(|value| value.as_ref()).unwrap_or("");
    let ticket = query
        .get("ticket")
        .map(|value| value.as_ref())
        .unwrap_or("");
    let handoff_id = query
        .get("handoff_id")
        .map(|value| value.as_ref())
        .unwrap_or("");
    let channel = query
        .get("channel")
        .map(|value| value.as_ref())
        .unwrap_or("");
    if !nonce.is_empty()
        || !ticket.is_empty()
        || handoff_id != pending.handoff_id
        || channel != pending.channel
        || protocol != Some(pending.protocol.as_str())
    {
        return Err(
            "Desktop authentication callback does not match the pending request".to_string(),
        );
    }
    // The verifier never travels through the browser or custom-scheme callback.
    // It is injected only into the event delivered to the initiating webview.
    let mut prepared = parsed;
    prepared
        .query_pairs_mut()
        .append_pair("nonce", &pending.nonce);
    Ok(prepared.to_string())
}

#[tauri::command]
pub fn desktop_complete_auth_handoff(handoff_id: String) -> Result<(), String> {
    let pending_path = pending_handoff_path();
    let pending: PendingDesktopAuthHandoff = serde_json::from_slice(
        &fs::read(&pending_path)
            .map_err(|_| "No pending desktop authentication request exists".to_string())?,
    )
    .map_err(|error| format!("Pending desktop authentication request is invalid: {error}"))?;
    if pending.handoff_id != handoff_id.trim() {
        return Err(
            "Desktop authentication completion does not match the pending request".to_string(),
        );
    }
    fs::remove_file(&pending_path)
        .map_err(|error| format!("Failed clearing desktop authentication request: {error}"))
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
    let incoming_backend_base = backend_base;
    let generation = app
        .state::<DesktopShellState>()
        .auth_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;

    crate::native_widget::write_auth_token_to_disk(&trimmed_token)?;

    update_auth_state(&app, |state| {
        state.token = Some(trimmed_token.clone());
        state.user_id = normalized_user_id.clone();
        state.backend_base = normalize_backend_base(
            incoming_backend_base
                .clone()
                .or_else(|| state.backend_base.clone()),
        );
        state.last_updated_at_ms = Some(Utc::now().timestamp_millis());
        state.last_turso_error = None;
    });

    if let Some(user_id) = normalized_user_id.as_deref() {
        reconcile_native_user_configs(user_id)?;
    }

    if read_auth_state(&app).backend_base.is_some() {
        if should_skip_immediate_turso_refresh(&app) {
            if let Ok(Some(config)) = crate::native_widget::load_turso_sync_config() {
                super::turso_sync::schedule_turso_config_refresh(
                    app.clone(),
                    generation,
                    &config.expires_at,
                );
                update_auth_state(&app, |state| {
                    state.last_turso_error = None;
                });
                log::info!(
                    "[DESKTOP_RUNTIME] reusing persisted Turso config after auth handoff; skipping immediate activity.db reload"
                );
            }
        } else if let Err(error) =
            super::turso_sync::refresh_turso_sync_config(app.clone(), generation).await
        {
            warn!(error = %error, "Desktop Turso sync refresh failed after auth handoff");
        }
    }

    super::location_outbox::trigger_location_outbox_drain(app.clone());
    super::biome_outbox::trigger_biome_outbox_drain(app.clone());

    let runtime_state = build_runtime_state(&app).await?;
    let _ = app.emit(RUNTIME_STATE_CHANGED_EVENT, runtime_state.clone());
    Ok(runtime_state)
}

#[tauri::command]
#[instrument(skip(app))]
pub async fn desktop_clear_auth_state<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<DesktopRuntimeState, String> {
    let generation = app
        .state::<DesktopShellState>()
        .auth_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;

    if let Err(error) = crate::watcher::lifecycle::stop_watcher().await {
        warn!(error = %error, "Failed stopping watcher during desktop auth clear");
    }

    if let Err(error) = crate::watcher::clear_watcher_config() {
        warn!(error = %error, "Failed clearing watcher config during desktop auth clear");
    }

    crate::native_widget::clear_auth_token_on_disk()?;
    crate::native_widget::clear_turso_sync_config()?;
    super::clear_pending_auth_deep_link(&app);

    update_auth_state(&app, |state| {
        *state = DesktopAuthState::default();
    });

    update_auth_state(&app, |state| {
        state.last_updated_at_ms = Some(Utc::now().timestamp_millis());
        state.last_turso_error = None;
        state.turso_refresh_scheduled_for_ms = None;
    });

    info!(generation, "Desktop auth state cleared");

    let runtime_state = build_runtime_state(&app).await?;
    let _ = app.emit(RUNTIME_STATE_CHANGED_EVENT, runtime_state.clone());
    Ok(runtime_state)
}
