// FFI bindings for Swift components
#[cfg(target_os = "macos")]
extern "C" {
    fn clear_speech_state();
    fn show_microphone_permission_dialog() -> bool;
    fn check_microphone_permission() -> bool;
    fn get_speech_state_json() -> *mut std::os::raw::c_char;
    fn free_swift_c_string(ptr: *mut std::os::raw::c_char);
    fn start_speech_recognition() -> bool;
    fn stop_speech_recognition() -> bool;
}

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

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct TursoSyncConfig {
    pub sync_url: String,
    pub auth_token: String,
    #[serde(default)]
    pub expires_at: String,
    #[serde(default)]
    pub database_name: String,
}

fn turso_sync_config_path() -> Result<std::path::PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Failed to resolve home directory".to_string())
        .map(|home| home.join(".ritual").join("turso_sync.json"))
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

#[tauri::command]
pub async fn write_turso_sync_config(
    sync_url: String,
    auth_token: String,
    expires_at: String,
    database_name: String,
) -> Result<String, String> {
    nw_info!("🔄 Applying Turso sync config...");

    use crate::{ritual_database, watcher};
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let config = TursoSyncConfig {
        sync_url: sync_url.trim().to_string(),
        auth_token: auth_token.trim().to_string(),
        expires_at: expires_at.trim().to_string(),
        database_name: database_name.trim().to_string(),
    };

    if config.sync_url.is_empty()
        || config.auth_token.is_empty()
        || config.expires_at.is_empty()
        || config.database_name.is_empty()
    {
        return Err(
            "Turso sync config requires sync_url, auth_token, expires_at, and database_name"
                .to_string(),
        );
    }

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

    let watcher_status = watcher::get_watcher_status().await;
    let watcher_restart_config = if watcher_status.is_running {
        Some(watcher::get_saved_watcher_config().ok_or_else(|| {
            "Watcher is running but no saved watcher config is available for restart".to_string()
        })?)
    } else {
        None
    };

    let config_file = turso_sync_config_path()?;
    if let Some(parent) = config_file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create Turso config directory: {e}"))?;
    }

    fn persist_turso_sync_config(
        config_file: &std::path::Path,
        config: &TursoSyncConfig,
    ) -> Result<(), String> {
        let contents = serde_json::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize Turso sync config: {e}"))?;
        fs::write(config_file, contents)
            .map_err(|e| format!("Failed to write Turso sync config: {e}"))?;

        let mut perms = fs::metadata(config_file)
            .map_err(|e| format!("Failed to read Turso config metadata: {e}"))?
            .permissions();
        perms.set_mode(0o600);
        fs::set_permissions(config_file, perms)
            .map_err(|e| format!("Failed to set Turso config permissions: {e}"))?;
        Ok(())
    }

    fn clear_turso_sync_config(config_file: &std::path::Path) -> Result<(), String> {
        if config_file.exists() {
            fs::remove_file(config_file)
                .map_err(|e| format!("Failed to remove Turso sync config: {e}"))?;
        }
        Ok(())
    }

    fn apply_turso_env(config: Option<&TursoSyncConfig>) {
        if let Some(config) = config {
            std::env::set_var("TURSO_SYNC_URL", &config.sync_url);
            std::env::set_var("TURSO_AUTH_TOKEN", &config.auth_token);
            std::env::set_var("TURSO_SYNC_EXPIRES_AT", &config.expires_at);
            std::env::set_var("TURSO_DATABASE_NAME", &config.database_name);
        } else {
            std::env::remove_var("TURSO_SYNC_URL");
            std::env::remove_var("TURSO_AUTH_TOKEN");
            std::env::remove_var("TURSO_SYNC_EXPIRES_AT");
            std::env::remove_var("TURSO_DATABASE_NAME");
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
        config_file: &std::path::Path,
        previous_config: &Option<TursoSyncConfig>,
        previous_env: &[(&str, Option<String>)],
        watcher_restart_config: &Option<watcher::WatcherConfig>,
    ) -> Result<(), String> {
        if let Some(config) = previous_config {
            persist_turso_sync_config(config_file, config)?;
            apply_turso_env(Some(config));
        } else {
            clear_turso_sync_config(config_file)?;
            restore_env(previous_env);
        }

        ritual_database::reload_activity_database()?;

        if let Some(config) = watcher_restart_config.clone() {
            watcher::start_watcher(config).await?;
        }

        Ok(())
    }

    if watcher_restart_config.is_some() {
        watcher::stop_watcher().await?;
    }

    let apply_result: Result<(), String> = async {
        persist_turso_sync_config(&config_file, &config)?;
        apply_turso_env(Some(&config));
        ritual_database::reload_activity_database()?;

        if let Some(saved_config) = watcher_restart_config.clone() {
            watcher::start_watcher(saved_config).await?;
        }

        Ok(())
    }
    .await;

    if let Err(error) = apply_result {
        nw_error!("❌ Failed to apply Turso sync config: {}", error);
        if let Err(rollback_error) = rollback_turso_config(
            &config_file,
            &previous_config,
            &previous_env,
            &watcher_restart_config,
        )
        .await
        {
            return Err(format!(
                "Failed to apply Turso sync config: {error}; rollback also failed: {rollback_error}"
            ));
        }
        return Err(format!(
            "Failed to apply Turso sync config; previous config restored: {error}"
        ));
    }

    nw_info!("✅ Turso sync config written to: {:?}", config_file);
    Ok(format!("Turso sync config written to: {:?}", config_file))
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

fn native_widget_process_running() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        match Command::new("pgrep")
            .args(["-x", "NativeTimerWidget"])
            .output()
        {
            Ok(output) => output.status.success() && !output.stdout.is_empty(),
            Err(e) => {
                nw_warn!(
                    "⚠️ Could not check NativeTimerWidget process state via pgrep: {}",
                    e
                );
                false
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn terminate_native_widget_processes() {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        use std::time::Duration;

        match Command::new("pkill")
            .args(["-x", "NativeTimerWidget"])
            .status()
        {
            Ok(status) => {
                if status.success() {
                    nw_info!("🛑 Terminated existing NativeTimerWidget process");
                }
            }
            Err(e) => {
                nw_warn!("⚠️ Could not terminate NativeTimerWidget via pkill: {}", e);
            }
        }

        std::thread::sleep(Duration::from_millis(140));
    }
}

fn build_native_timer_widget_if_possible() {
    use std::path::Path;
    use std::process::Command;

    // Locate build script for both possible CWDs.
    let script_candidates = [
        Path::new("native-timer/build_widget.sh").to_path_buf(),
        Path::new("src-tauri/native-timer/build_widget.sh").to_path_buf(),
    ];
    let script_path = script_candidates.iter().find(|p| p.exists()).cloned();

    if let Some(script) = script_path {
        let _ = Command::new("bash")
            .arg("-c")
            .arg(format!(
                "chmod +x '{}' && '{}'",
                script.display(),
                script.display()
            ))
            .status();
    } else {
        nw_error!("❌ Could not find build script 'native-timer/build_widget.sh'.");
    }
}

fn native_widget_needs_rebuild(exec_path: &std::path::Path) -> bool {
    use std::fs;
    use std::path::Path;

    let binary_metadata = match fs::metadata(exec_path) {
        Ok(metadata) => metadata,
        Err(_) => return true,
    };

    let binary_modified = match binary_metadata.modified() {
        Ok(mtime) => mtime,
        Err(_) => return true,
    };

    // Candidate Swift source paths depending on current working directory.
    let source_candidates = [
        Path::new("native-timer/Package.swift"),
        Path::new("native-timer/TimerWidgetApp.swift"),
        Path::new("native-timer/MicrophonePermission.swift"),
        Path::new("native-timer/SpeechRecognition.swift"),
        Path::new("native-timer/Notch/NotchController.swift"),
        Path::new("native-timer/Notch/NotchTimerView.swift"),
        Path::new("native-timer/Notch/NotchHabitPicker.swift"),
        Path::new("native-timer/Notch/NotchVoiceViews.swift"),
        Path::new("native-timer/Stores/TimerSessionStore.swift"),
        Path::new("native-timer/Hotkeys/ModifierEventTap.swift"),
        Path::new("native-timer/Hotkeys/GlobalHotkey.swift"),
        Path::new("native-timer/Permissions/AccessibilityPermission.swift"),
        Path::new("native-timer/Speech/SpeechEngine.swift"),
        Path::new("native-timer/Speech/VoicePermissions.swift"),
        Path::new("src-tauri/native-timer/Package.swift"),
        Path::new("src-tauri/native-timer/TimerWidgetApp.swift"),
        Path::new("src-tauri/native-timer/MicrophonePermission.swift"),
        Path::new("src-tauri/native-timer/SpeechRecognition.swift"),
        Path::new("src-tauri/native-timer/Notch/NotchController.swift"),
        Path::new("src-tauri/native-timer/Notch/NotchTimerView.swift"),
        Path::new("src-tauri/native-timer/Notch/NotchHabitPicker.swift"),
        Path::new("src-tauri/native-timer/Notch/NotchVoiceViews.swift"),
        Path::new("src-tauri/native-timer/Stores/TimerSessionStore.swift"),
        Path::new("src-tauri/native-timer/Hotkeys/ModifierEventTap.swift"),
        Path::new("src-tauri/native-timer/Hotkeys/GlobalHotkey.swift"),
        Path::new("src-tauri/native-timer/Permissions/AccessibilityPermission.swift"),
        Path::new("src-tauri/native-timer/Speech/SpeechEngine.swift"),
        Path::new("src-tauri/native-timer/Speech/VoicePermissions.swift"),
    ];

    for source in source_candidates {
        if !source.exists() {
            continue;
        }

        match fs::metadata(source).and_then(|metadata| metadata.modified()) {
            Ok(source_modified) => {
                if source_modified > binary_modified {
                    nw_info!(
                        "🔨 Native widget rebuild required: {:?} is newer than binary",
                        source
                    );
                    return true;
                }
            }
            Err(_) => return true,
        }
    }

    false
}

fn launch_native_timer_widget(force_restart: bool) {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    nw_info!("🚀 Creating native Swift timer widget...");

    if force_restart {
        terminate_native_widget_processes();
    } else if native_widget_process_running() {
        nw_info!("ℹ️ Native Swift timer widget already running; skipping duplicate launch");
        return;
    }

    // Prefer the .app bundle launched via `open` so macOS Launch Services
    // registers the bundle identity (required for permission dialogs to
    // list the app in System Settings).  Fall back to the bare binary.
    let app_bundle_candidates: [PathBuf; 2] = [
        Path::new("src-tauri/target/release/NativeTimerWidget.app").to_path_buf(),
        Path::new("target/release/NativeTimerWidget.app").to_path_buf(),
    ];
    let bare_candidates: [PathBuf; 2] = [
        Path::new("src-tauri/target/release/NativeTimerWidget").to_path_buf(),
        Path::new("target/release/NativeTimerWidget").to_path_buf(),
    ];

    let parent_pid = std::process::id().to_string();

    let find_app_bundle =
        || -> Option<PathBuf> { app_bundle_candidates.iter().find(|p| p.exists()).cloned() };
    let find_bare = || -> Option<PathBuf> { bare_candidates.iter().find(|p| p.exists()).cloned() };
    let find_any_binary = || -> Option<PathBuf> {
        // For rebuild-check we need the actual binary, not the .app dir
        let bin_inside_app: Vec<PathBuf> = app_bundle_candidates
            .iter()
            .map(|p| p.join("Contents/MacOS/NativeTimerWidget"))
            .collect();
        bin_inside_app
            .iter()
            .find(|p| p.exists())
            .cloned()
            .or_else(|| bare_candidates.iter().find(|p| p.exists()).cloned())
    };

    nw_info!(
        "🔍 Current working directory: {:?}",
        std::env::current_dir().unwrap_or_default()
    );

    // Check if a build exists; if not, or if stale, rebuild.
    match find_any_binary() {
        None => {
            nw_info!(
                "⚠️ Native widget executable not found. Attempting to build via build_widget.sh..."
            );
            build_native_timer_widget_if_possible();
        }
        Some(bin) => {
            if native_widget_needs_rebuild(&bin) {
                nw_info!("🔄 Rebuilding native widget to pick up latest Swift changes...");
                build_native_timer_widget_if_possible();
            }
        }
    }

    // Launch: prefer .app bundle via `open` (absolute path required), fall back to bare binary.
    if let Some(bundle_path) = find_app_bundle() {
        let abs_bundle = std::fs::canonicalize(&bundle_path).unwrap_or(bundle_path);
        let bundle_str = abs_bundle.to_string_lossy().to_string();
        nw_info!("🔍 Launching widget via `open -n -a {}`", bundle_str);
        match Command::new("open")
            .args([
                "-n",
                "-a",
                &bundle_str,
                "--args",
                &format!("--parent-pid={}", parent_pid),
            ])
            .output()
        {
            Ok(output) if output.status.success() => {
                nw_info!("✅ Native Swift timer widget launched successfully!");
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                nw_info!("⚠️ `open` exited with {}: {}", output.status, stderr.trim());
                nw_info!("⚠️ Falling back to direct binary exec");
                launch_bare_binary(find_bare(), &parent_pid);
            }
            Err(e) => {
                nw_info!("⚠️ `open` failed ({}), falling back to direct exec", e);
                launch_bare_binary(find_bare(), &parent_pid);
            }
        }
    } else if let Some(bare_path) = find_bare() {
        nw_info!(
            "🔍 No .app bundle found, using bare binary: {:?}",
            bare_path
        );
        launch_bare_binary(Some(bare_path), &parent_pid);
    } else {
        nw_error!("❌ No widget executable found. Trying build + retry...");
        build_native_timer_widget_if_possible();
        if let Some(bundle_path) = find_app_bundle() {
            let abs_bundle = std::fs::canonicalize(&bundle_path).unwrap_or(bundle_path);
            let bundle_str = abs_bundle.to_string_lossy().to_string();
            let _ = Command::new("open")
                .args([
                    "-n",
                    "-a",
                    &bundle_str,
                    "--args",
                    &format!("--parent-pid={}", parent_pid),
                ])
                .output();
        } else {
            launch_bare_binary(find_bare(), &parent_pid);
        }
    }
}

fn launch_bare_binary(path: Option<std::path::PathBuf>, parent_pid: &str) {
    use std::process::Command;

    match path {
        Some(p) => {
            nw_info!("🔍 Using bare widget binary at: {:?}", p);
            match Command::new(&p)
                .env("RITUAL_PARENT_PID", parent_pid)
                .spawn()
            {
                Ok(_) => nw_info!("✅ Native Swift timer widget launched (bare binary)!"),
                Err(e) => {
                    nw_error!("❌ Failed to launch native Swift widget: {}", e);
                    nw_info!("🔄 If the problem persists, try: 'bash native-timer/build_widget.sh' from 'src-tauri/'.");
                }
            }
        }
        None => {
            nw_error!("❌ Failed to locate or build the native widget executable.");
            nw_info!("🔄 Ensure Xcode Command Line Tools are installed and run 'bash native-timer/build_widget.sh' from 'src-tauri/'.");
        }
    }
}

#[tauri::command]
pub fn create_native_timer_widget() {
    launch_native_timer_widget(false);
}

pub fn restart_native_timer_widget() {
    launch_native_timer_widget(true);
}

#[tauri::command]
pub fn close_native_timer_widget() {
    nw_info!("🔴 Close native Swift timer widget requested (disabled)");
    // TODO: Add close function to Swift and call it here
}

#[tauri::command]
pub async fn write_auth_token_to_file(token: String) -> Result<String, String> {
    nw_info!("🔐 Writing auth token to file for native widget...");

    use dirs::home_dir;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    let token_dir = home_dir()
        .ok_or_else(|| "Failed to resolve home directory".to_string())?
        .join(".ritual");
    fs::create_dir_all(&token_dir).map_err(|e| format!("Failed to create token directory: {e}"))?;
    let token_file = token_dir.join("auth_token.txt");

    match fs::write(&token_file, &token) {
        Ok(_) => {
            let mut perms = fs::metadata(&token_file)
                .map_err(|e| format!("Failed to read token file metadata: {e}"))?
                .permissions();
            perms.set_mode(0o600);
            fs::set_permissions(&token_file, perms)
                .map_err(|e| format!("Failed to set token file permissions: {e}"))?;
            nw_info!("✅ Auth token written to: {:?}", token_file);
            nw_info!(
                "🔐 Token preview: {}...",
                &token[..std::cmp::min(20, token.len())]
            );
            Ok(format!("Token written to: {:?}", token_file))
        }
        Err(e) => {
            nw_error!("❌ Failed to write token file: {}", e);
            Err(format!("Failed to write token file: {}", e))
        }
    }
}

#[tauri::command]
pub async fn check_dashboard_refresh_trigger() -> Result<f64, String> {
    use std::env;
    use std::fs;

    let temp_dir = env::temp_dir();
    let trigger_file = temp_dir.join("ritual_timer_updated.txt");

    match fs::read_to_string(&trigger_file) {
        Ok(timestamp_str) => {
            match timestamp_str.trim().parse::<f64>() {
                Ok(timestamp) => Ok(timestamp),
                Err(_) => Ok(0.0), // Invalid timestamp, return 0
            }
        }
        Err(_) => Ok(0.0), // File doesn't exist or can't be read, return 0
    }
}

#[tauri::command]
pub async fn check_token_refresh_request() -> Result<f64, String> {
    use std::env;
    use std::fs;

    let temp_dir = env::temp_dir();
    let request_file = temp_dir.join("ritual_refresh_token_request.txt");

    match fs::read_to_string(&request_file) {
        Ok(timestamp_str) => {
            match timestamp_str.trim().parse::<f64>() {
                Ok(timestamp) => {
                    // Delete the request file after reading
                    let _ = fs::remove_file(&request_file);
                    Ok(timestamp)
                }
                Err(_) => Ok(0.0),
            }
        }
        Err(_) => Ok(0.0),
    }
}

#[tauri::command]
pub async fn show_native_microphone_permission_dialog() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        nw_info!("🎤 Showing native macOS microphone permission dialog...");

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
pub async fn start_native_speech_recognition() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        nw_info!("🎤 Starting native speech recognition...");

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
