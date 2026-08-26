// FFI bindings for Swift components
#[cfg(target_os = "macos")]
extern "C" {
    fn clear_speech_state();
    fn show_microphone_permission_dialog() -> bool;
    fn check_microphone_permission() -> bool;
    fn show_speech_recognition_permission_dialog() -> bool;
    fn check_speech_recognition_permission() -> bool;
    fn get_speech_state_json() -> *mut std::os::raw::c_char;
    fn free_swift_c_string(ptr: *mut std::os::raw::c_char);
    fn start_speech_recognition() -> bool;
    fn stop_speech_recognition() -> bool;
}

use crate::watcher;
use chrono::{DateTime, Utc};
use std::time::Instant;
use tracing::instrument;

macro_rules! nw_info {
    ($($arg:tt)*) => {
        log::info!("[NATIVE_WIDGET] {}", format!($($arg)*))
    };
}

macro_rules! nw_warn {
    ($($arg:tt)*) => {
        log::warn!("[NATIVE_WIDGET] {}", format!($($arg)*))
    };
}

macro_rules! nw_error {
    ($($arg:tt)*) => {
        log::error!("[NATIVE_WIDGET] {}", format!($($arg)*))
    };
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct NativeSpeechState {
    pub event: String,
    pub transcript: String,
    pub timestamp: f64,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone, PartialEq, Eq)]
pub struct TursoSyncConfig {
    pub sync_url: String,
    pub auth_token: String,
    #[serde(default)]
    pub expires_at: String,
    #[serde(default)]
    pub database_name: String,
    #[serde(default = "default_activity_schema_version")]
    pub activity_schema_version: i64,
}

fn default_activity_schema_version() -> i64 {
    1
}

#[derive(serde::Serialize)]
pub struct RuntimeBridgeSignals {
    pub token_refresh_request: f64,
    pub dashboard_refresh_trigger: f64,
}

fn normalize_widget_command_origin(origin: Option<&str>, fallback: &str) -> String {
    origin
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

#[cfg(target_os = "macos")]
const BUNDLED_VOICE_REQUIRED_ERROR: &str = "native-voice-requires-bundled-app";

#[cfg(target_os = "macos")]
fn ensure_bundled_voice_runtime() -> Result<(), String> {
    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve current executable path: {error}"))?;
    let executable_path_str = executable_path.to_string_lossy();
    let is_bundled_app = executable_path_str.contains(".app/Contents/MacOS/");

    if is_bundled_app {
        return Ok(());
    }

    nw_warn!(
        "Blocking native voice API access outside a bundled app: {}",
        executable_path.display()
    );

    Err(BUNDLED_VOICE_REQUIRED_ERROR.to_string())
}

fn turso_sync_config_path() -> Result<std::path::PathBuf, String> {
    Ok(crate::app_paths::data_dir().join("turso_sync.json"))
}

pub fn load_turso_sync_config() -> Result<Option<TursoSyncConfig>, String> {
    use std::fs;

    let path = turso_sync_config_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read Turso sync config: {e}"))?;
    let config: TursoSyncConfig = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse Turso sync config: {e}"))?;

    if config.sync_url.trim().is_empty() || config.auth_token.trim().is_empty() {
        return Ok(None);
    }

    Ok(Some(config))
}

pub(crate) fn turso_sync_config_is_fresh_enough(config: &TursoSyncConfig) -> bool {
    let expires_at = config.expires_at.trim();
    if expires_at.is_empty() {
        return false;
    }

    let Ok(expires_at) = DateTime::parse_from_rfc3339(expires_at) else {
        return false;
    };

    let refresh_at = expires_at.with_timezone(&Utc) - chrono::Duration::minutes(30);
    refresh_at > Utc::now()
}

pub(crate) fn persisted_turso_sync_config_is_fresh_enough() -> bool {
    let Ok(Some(config)) = load_turso_sync_config() else {
        return false;
    };

    turso_sync_config_is_fresh_enough(&config)
}

pub(crate) fn set_turso_sync_env(config: Option<&TursoSyncConfig>) {
    apply_turso_env(config);
}

fn persist_turso_sync_config_file(config: &TursoSyncConfig) -> Result<std::path::PathBuf, String> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let config_file = turso_sync_config_path()?;
    if let Some(parent) = config_file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create Turso config directory: {e}"))?;
    }

    let contents = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize Turso sync config: {e}"))?;
    fs::write(&config_file, contents)
        .map_err(|e| format!("Failed to write Turso sync config: {e}"))?;

    let mut perms = fs::metadata(&config_file)
        .map_err(|e| format!("Failed to read Turso config metadata: {e}"))?
        .permissions();
    perms.set_mode(0o600);
    fs::set_permissions(&config_file, perms)
        .map_err(|e| format!("Failed to set Turso config permissions: {e}"))?;

    Ok(config_file)
}

fn clear_turso_sync_config_file() -> Result<(), String> {
    use std::fs;

    let config_file = turso_sync_config_path()?;
    if config_file.exists() {
        fs::remove_file(config_file)
            .map_err(|e| format!("Failed to remove Turso sync config: {e}"))?;
    }
    Ok(())
}

pub(crate) fn clear_turso_sync_config() -> Result<(), String> {
    clear_turso_sync_config_file()?;
    apply_turso_env(None);
    Ok(())
}

fn apply_turso_env(config: Option<&TursoSyncConfig>) {
    if let Some(config) = config {
        std::env::set_var("TURSO_SYNC_URL", &config.sync_url);
        std::env::set_var("TURSO_AUTH_TOKEN", &config.auth_token);
        std::env::set_var("TURSO_SYNC_EXPIRES_AT", &config.expires_at);
        std::env::set_var("TURSO_DATABASE_NAME", &config.database_name);
        std::env::set_var(
            "TURSO_ACTIVITY_SCHEMA_VERSION",
            config.activity_schema_version.to_string(),
        );
    } else {
        std::env::remove_var("TURSO_SYNC_URL");
        std::env::remove_var("TURSO_AUTH_TOKEN");
        std::env::remove_var("TURSO_SYNC_EXPIRES_AT");
        std::env::remove_var("TURSO_DATABASE_NAME");
        std::env::remove_var("TURSO_ACTIVITY_SCHEMA_VERSION");
    }
}

fn restore_env(entries: &[(&str, Option<String>)]) {
    for (key, value) in entries {
        if let Some(value) = value {
            std::env::set_var(key, value);
        } else {
            std::env::remove_var(key);
        }
    }
}

async fn rollback_turso_config(
    _origin: &str,
    previous_config: &Option<TursoSyncConfig>,
    previous_env: &[(&str, Option<String>)],
    _watcher_restart_config: &Option<watcher::WatcherConfig>,
) -> Result<(), String> {
    if let Some(config) = previous_config {
        let _ = persist_turso_sync_config_file(config)?;
        apply_turso_env(Some(config));
    } else {
        clear_turso_sync_config_file()?;
        restore_env(previous_env);
    }
    Ok(())
}

pub(crate) async fn apply_turso_sync_config_internal(
    config: TursoSyncConfig,
    origin: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    let origin = normalize_widget_command_origin(origin, "native_widget:apply_turso_sync_config");

    let previous_config = load_turso_sync_config()?;
    let previous_env = [
        (
            "TURSO_SYNC_URL",
            std::env::var("TURSO_SYNC_URL")
                .ok()
                .filter(|value| !value.is_empty()),
        ),
        (
            "TURSO_AUTH_TOKEN",
            std::env::var("TURSO_AUTH_TOKEN")
                .ok()
                .filter(|value| !value.is_empty()),
        ),
        (
            "TURSO_SYNC_EXPIRES_AT",
            std::env::var("TURSO_SYNC_EXPIRES_AT")
                .ok()
                .filter(|value| !value.is_empty()),
        ),
        (
            "TURSO_DATABASE_NAME",
            std::env::var("TURSO_DATABASE_NAME")
                .ok()
                .filter(|value| !value.is_empty()),
        ),
    ];

    let config_file = persist_turso_sync_config_file(&config)?;
    apply_turso_env(Some(&config));

    if previous_config.as_ref() == Some(&config) {
        nw_info!(
            "⏭️ Skipping identical Turso sync config apply origin={}",
            origin
        );
        return Ok(config_file);
    }

    let apply_result: Result<(), String> = async {
        nw_info!(
            "✅ Applied Turso sync config for desktop cloud uploader only origin={}",
            origin
        );
        Ok(())
    }
    .await;

    if let Err(error) = apply_result {
        nw_error!("❌ Failed to apply Turso sync config: {}", error);
        if let Err(rollback_error) =
            rollback_turso_config(&origin, &previous_config, &previous_env, &None).await
        {
            return Err(format!(
                "Failed to apply Turso sync config: {error}; rollback also failed: {rollback_error}"
            ));
        }
        return Err(format!(
            "Failed to apply Turso sync config; previous config restored: {error}"
        ));
    }

    Ok(config_file)
}

pub(crate) fn write_auth_token_to_disk(token: &str) -> Result<std::path::PathBuf, String> {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let token_dir = crate::app_paths::data_dir();
    fs::create_dir_all(&token_dir).map_err(|e| format!("Failed to create token directory: {e}"))?;
    let token_file = token_dir.join("auth_token.txt");

    fs::write(&token_file, token).map_err(|e| format!("Failed to write token file: {e}"))?;
    let mut perms = fs::metadata(&token_file)
        .map_err(|e| format!("Failed to read token file metadata: {e}"))?
        .permissions();
    perms.set_mode(0o600);
    fs::set_permissions(&token_file, perms)
        .map_err(|e| format!("Failed to set token file permissions: {e}"))?;

    Ok(token_file)
}

pub(crate) fn clear_auth_token_on_disk() -> Result<(), String> {
    use std::fs;

    let token_file = crate::app_paths::data_dir().join("auth_token.txt");

    if token_file.exists() {
        fs::remove_file(&token_file).map_err(|e| format!("Failed to remove token file: {e}"))?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn read_swift_json_string(ptr: *mut std::os::raw::c_char) -> Result<String, String> {
    if ptr.is_null() {
        return Err("Swift returned null string".to_string());
    }

    let value = unsafe { std::ffi::CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { free_swift_c_string(ptr) };
    Ok(value)
}

#[tauri::command]
#[instrument(skip(token), fields(token_length = token.len()))]
pub async fn write_auth_token_to_file(
    token: String,
    origin: Option<String>,
) -> Result<String, String> {
    let started_at = Instant::now();
    let origin = normalize_widget_command_origin(
        origin.as_deref(),
        "tauri:write_auth_token_to_file:unknown",
    );
    nw_info!(
        "🔐 Writing auth token to file for desktop runtime origin={}...",
        origin
    );
    match write_auth_token_to_disk(&token) {
        Ok(token_file) => {
            nw_info!(
                "✅ Auth token written to: {:?} origin={}",
                token_file,
                origin
            );
            nw_info!(
                "🔐 Token preview: {}...",
                &token[..std::cmp::min(20, token.len())]
            );
            nw_info!(
                "⏱️ Auth token write command completed in {}ms",
                started_at.elapsed().as_millis()
            );
            Ok(format!("Token written to: {:?}", token_file))
        }
        Err(e) => {
            nw_error!("❌ Failed to write token file: {}", e);
            Err(e)
        }
    }
}

#[tauri::command]
#[instrument]
pub async fn check_dashboard_refresh_trigger() -> Result<f64, String> {
    Ok(read_runtime_bridge_timestamp_file(
        "ritual_timer_updated.txt",
        false,
    ))
}

#[tauri::command]
#[instrument]
pub async fn check_token_refresh_request() -> Result<f64, String> {
    Ok(read_runtime_bridge_timestamp_file(
        "ritual_refresh_token_request.txt",
        true,
    ))
}

#[tauri::command]
#[instrument]
pub async fn check_runtime_bridge_signals() -> Result<RuntimeBridgeSignals, String> {
    Ok(RuntimeBridgeSignals {
        token_refresh_request: read_runtime_bridge_timestamp_file(
            "ritual_refresh_token_request.txt",
            true,
        ),
        dashboard_refresh_trigger: read_runtime_bridge_timestamp_file(
            "ritual_timer_updated.txt",
            false,
        ),
    })
}

fn read_runtime_bridge_timestamp_file(file_name: &str, delete_after_read: bool) -> f64 {
    use std::env;
    use std::fs;

    let temp_dir = env::temp_dir();
    let target_file = temp_dir.join(file_name);

    match fs::read_to_string(&target_file) {
        Ok(timestamp_str) => match timestamp_str.trim().parse::<f64>() {
            Ok(timestamp) => {
                if delete_after_read {
                    let _ = fs::remove_file(&target_file);
                }
                timestamp
            }
            Err(_) => 0.0,
        },
        Err(_) => 0.0,
    }
}

#[tauri::command]
pub async fn show_native_microphone_permission_dialog() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        nw_info!("🎤 Showing native macOS microphone permission dialog...");
        ensure_bundled_voice_runtime()?;

        unsafe {
            let granted = show_microphone_permission_dialog();
            nw_info!("🎤 Microphone permission result: {}", granted);
            Ok(granted)
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        nw_info!("🎤 Native microphone permission dialog not available on this platform");
        Ok(false)
    }
}

#[tauri::command]
pub async fn check_native_microphone_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        nw_info!("🎤 Checking native microphone permission...");
        ensure_bundled_voice_runtime()?;

        unsafe {
            let has_permission = check_microphone_permission();
            nw_info!("🎤 Current microphone permission: {}", has_permission);
            Ok(has_permission)
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        nw_info!("🎤 Native microphone permission check not available on this platform");
        Ok(false)
    }
}

#[tauri::command]
pub async fn show_native_speech_recognition_permission_dialog() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        nw_info!("🎤 Showing native macOS speech recognition permission dialog...");
        ensure_bundled_voice_runtime()?;

        unsafe {
            let granted = show_speech_recognition_permission_dialog();
            nw_info!("🎤 Speech recognition permission result: {}", granted);
            Ok(granted)
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        nw_info!("🎤 Native speech recognition permission dialog not available on this platform");
        Ok(false)
    }
}

#[tauri::command]
pub async fn check_native_speech_recognition_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        nw_info!("🎤 Checking native speech recognition permission...");
        ensure_bundled_voice_runtime()?;

        unsafe {
            let has_permission = check_speech_recognition_permission();
            nw_info!(
                "🎤 Current speech recognition permission: {}",
                has_permission
            );
            Ok(has_permission)
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        nw_info!("🎤 Native speech recognition permission check not available on this platform");
        Ok(false)
    }
}

#[tauri::command]
pub async fn start_native_speech_recognition() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        nw_info!("🎤 Starting native speech recognition...");
        ensure_bundled_voice_runtime()?;

        unsafe {
            let success = start_speech_recognition();
            if success {
                nw_info!("✅ Native speech recognition started successfully");
                Ok(())
            } else {
                nw_error!("❌ Failed to start native speech recognition");
                let detailed_error = read_swift_json_string(get_speech_state_json())
                    .ok()
                    .and_then(|json| serde_json::from_str::<NativeSpeechState>(&json).ok())
                    .filter(|state| {
                        state.event == "ritual:speech:error" && !state.transcript.is_empty()
                    })
                    .map(|state| state.transcript);

                Err(detailed_error
                    .unwrap_or_else(|| "Failed to start speech recognition".to_string()))
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        nw_info!("🎤 Native speech recognition not available on this platform");
        Err("Speech recognition not supported on this platform".to_string())
    }
}

#[tauri::command]
pub async fn stop_native_speech_recognition() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        nw_info!("🎤 Stopping native speech recognition...");

        unsafe {
            let success = stop_speech_recognition();
            if success {
                nw_info!("✅ Native speech recognition stopped successfully");
                Ok(())
            } else {
                nw_error!("❌ Failed to stop native speech recognition");
                Err("Failed to stop speech recognition".to_string())
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        nw_info!("🎤 Native speech recognition not available on this platform");
        Err("Speech recognition not supported on this platform".to_string())
    }
}

#[tauri::command]
pub async fn get_native_speech_state() -> Result<NativeSpeechState, String> {
    #[cfg(target_os = "macos")]
    {
        let json = unsafe { read_swift_json_string(get_speech_state_json())? };
        serde_json::from_str::<NativeSpeechState>(&json)
            .map_err(|e| format!("Failed to parse native speech state: {}", e))
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Speech state not supported on this platform".to_string())
    }
}

#[tauri::command]
pub async fn clear_native_speech_state() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            clear_speech_state();
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Speech state not supported on this platform".to_string())
    }
}
