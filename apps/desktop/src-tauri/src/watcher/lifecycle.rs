use rusqlite::{Connection as SqliteConnection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use super::config::default_browser_heartbeat_port;
use super::diagnostics::{get_browser_extension_diagnostics, watcher_server_statuses};
use super::internal::{WatcherControllerState, WATCHER_CONTROLLER, WATCHER_OPERATION_GATE};
use tracing::instrument;

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct LocalWatcherFreshness {
    pub(crate) last_heartbeat_ts: Option<i64>,
    pub(crate) last_context_snapshot_ts: Option<i64>,
    pub(crate) last_activity_ts: Option<i64>,
}
/// Watcher status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherStatus {
    pub is_running: bool,
    pub pid: Option<u32>,
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WatcherLifecycleState {
    DisabledByUser,
    DisabledNoPermission,
    Starting,
    Running,
    Unhealthy,
    Backoff,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherLifecycleSnapshot {
    pub state: WatcherLifecycleState,
    pub is_running: bool,
    pub pid: Option<u32>,
    pub device_id: Option<String>,
    pub accessibility_granted: bool,
    pub seconds_since_heartbeat: Option<i64>,
    pub restart_count: u64,
    pub last_restart_reason: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedWatcherBinary {
    path: PathBuf,
    version: Option<String>,
}

/// Check if accessibility permissions are granted (macOS only)
fn watcher_candidate_paths() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Try to get the executable's directory for relative sidecar paths
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));
    let running_from_bundled_app = exe_dir
        .as_ref()
        .map(|path| path.to_string_lossy().contains(".app/Contents/MacOS"))
        .unwrap_or(false);

    // On shipped macOS builds, prefer the stable external install path so
    // Screen Recording permission survives app updates. We still refresh that
    // external binary from the bundled watcher before resolution.
    #[cfg(target_os = "macos")]
    if running_from_bundled_app {
        if let Some(external) = external_watcher_install_path() {
            candidates.push(external);
        }
    }

    // Prefer the bundled helper next so release builds can still run directly
    // from the app bundle when no external install exists yet.
    if let Some(exe) = &exe_dir {
        let target = std::env::var("TARGET").unwrap_or_else(|_| String::new());
        if !target.is_empty() {
            candidates.push(exe.join(format!("ritual-watcher-{target}")));
            candidates.push(exe.join(format!("../Resources/ritual-watcher-{target}")));
            candidates.push(exe.join(format!("../Resources/binaries/ritual-watcher-{target}")));
        }
        candidates.push(exe.join("ritual-watcher"));
        candidates.push(exe.join("../Resources/ritual-watcher"));
        candidates.push(exe.join("../Resources/binaries/ritual-watcher"));
    }

    // Development paths (release/debug) from workspace.
    candidates.extend([
        PathBuf::from("src-tauri/bin/ritual-watcher/target/release/ritual-watcher"),
        PathBuf::from("bin/ritual-watcher/target/release/ritual-watcher"),
        PathBuf::from("target/release/ritual-watcher"),
        PathBuf::from("src-tauri/bin/ritual-watcher/target/debug/ritual-watcher"),
        PathBuf::from("bin/ritual-watcher/target/debug/ritual-watcher"),
        PathBuf::from("target/debug/ritual-watcher"),
    ]);

    // Add absolute fallback paths.
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        // Development-only paths — these are developer-specific and won't exist on user machines.
        #[cfg(debug_assertions)]
        {
            candidates.push(home.join("Desktop/ritual-desktop-main/src-tauri/bin/ritual-watcher/target/release/ritual-watcher"));
            candidates.push(home.join(
                "Desktop/ritual-desktop-main/src-tauri/bin/ritual-watcher/target/debug/ritual-watcher",
            ));
            candidates.push(home.join("Desktop/ritual-desktop-main/apps/desktop/src-tauri/bin/ritual-watcher/target/release/ritual-watcher"));
            candidates.push(home.join("Desktop/ritual-desktop-main/apps/desktop/src-tauri/bin/ritual-watcher/target/debug/ritual-watcher"));
        }
    }

    // External installs are kept as the last-resort fallback everywhere else.
    if let Some(external) = external_watcher_install_path() {
        if !candidates.iter().any(|candidate| candidate == &external) {
            candidates.push(external);
        }
    }

    candidates
}

fn external_watcher_install_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".ritual").join("bin").join("ritual-watcher"))
}

fn external_vision_helper_install_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| {
        home.join(".ritual")
            .join("bin")
            .join("ritual-vision-helper")
    })
}

fn bundled_watcher_binary_path() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))?;

    let candidates = [
        exe_dir.join("ritual-watcher"),
        exe_dir.join("../Resources/ritual-watcher"),
        exe_dir.join("../Resources/binaries/ritual-watcher"),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn bundled_vision_helper_binary_path() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))?;

    let candidates = [
        exe_dir.join("ritual-vision-helper"),
        exe_dir.join("../Resources/ritual-vision-helper"),
        exe_dir.join("../Resources/binaries/ritual-vision-helper"),
    ];

    candidates.into_iter().find(|path| path.exists())
}

fn copy_external_support_binary(source: &Path, target: &Path, label: &str) {
    let needs_copy = support_binary_needs_copy(source, target);

    if !needs_copy {
        return;
    }

    if let Some(parent) = target.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            watcher_info!(
                "⚠️ Failed to create external {label} directory {:?}: {}",
                parent,
                err
            );
            return;
        }
    }

    if let Err(err) = std::fs::copy(source, target) {
        watcher_info!(
            "⚠️ Failed to copy {label} binary from {:?} to {:?}: {}",
            source,
            target,
            err
        );
        return;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(err) = std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o755)) {
            watcher_info!(
                "⚠️ Failed to mark external {label} binary executable {:?}: {}",
                target,
                err
            );
        }
    }

    watcher_info!("✅ Installed external {label} helper at {:?}", target);
}

fn support_binary_needs_copy(source: &Path, target: &Path) -> bool {
    let Ok(source_meta) = source.metadata() else {
        return false;
    };
    let Ok(target_meta) = target.metadata() else {
        return true;
    };
    if source_meta.len() != target_meta.len() {
        return true;
    }

    match (std::fs::read(source), std::fs::read(target)) {
        (Ok(source_bytes), Ok(target_bytes)) => source_bytes != target_bytes,
        _ => true,
    }
}

fn ensure_external_watcher_binary() {
    #[cfg(target_os = "macos")]
    {
        let Some(source) = bundled_watcher_binary_path() else {
            return;
        };
        let Some(target) = external_watcher_install_path() else {
            return;
        };

        if source == target {
            return;
        }

        copy_external_support_binary(&source, &target, "watcher");

        if let (Some(helper_source), Some(helper_target)) = (
            bundled_vision_helper_binary_path(),
            external_vision_helper_install_path(),
        ) {
            if helper_source != helper_target {
                copy_external_support_binary(&helper_source, &helper_target, "vision helper");
            }
        }
    }
}

fn validate_watcher_binary(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Err("path does not exist".to_string());
    }

    let metadata = path
        .metadata()
        .map_err(|e| format!("failed to read metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("not a regular file".to_string());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err("not executable".to_string());
        }
    }

    let help_output = Command::new(path)
        .arg("--help")
        .output()
        .map_err(|e| format!("failed to execute --help: {e}"))?;

    if !help_output.status.success() {
        return Err(format!("--help exited with status {}", help_output.status));
    }

    let help_text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&help_output.stdout),
        String::from_utf8_lossy(&help_output.stderr)
    );

    for required_flag in super::config::REQUIRED_WATCHER_HELP_FLAGS {
        if !help_text.contains(required_flag) {
            return Err(format!(
                "incompatible watcher binary: missing {required_flag} support"
            ));
        }
    }

    let version = Command::new(path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                let line = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if line.is_empty() {
                    None
                } else {
                    Some(line)
                }
            } else {
                None
            }
        });

    Ok(version)
}

/// Find the ritual-watcher executable and validate it's compatible with the
/// current CLI contract.
fn find_watcher_executable() -> Result<ResolvedWatcherBinary, String> {
    ensure_external_watcher_binary();

    let candidates = watcher_candidate_paths();
    let mut seen = HashSet::new();
    let mut attempted = Vec::new();

    for path in candidates {
        let key = path.to_string_lossy().to_string();
        if !seen.insert(key.clone()) {
            continue;
        }

        match validate_watcher_binary(&path) {
            Ok(version) => {
                watcher_info!(
                    "📍 Using compatible watcher binary: {:?}{}",
                    path,
                    version
                        .as_ref()
                        .map(|v| format!(" ({v})"))
                        .unwrap_or_default()
                );
                return Ok(ResolvedWatcherBinary { path, version });
            }
            Err(reason) => {
                attempted.push(format!("{key} -> {reason}"));
            }
        }
    }

    let mut message = String::from("No compatible ritual-watcher executable found.");
    if !attempted.is_empty() {
        message.push_str("\nChecked:");
        for item in attempted {
            message.push_str(&format!("\n- {item}"));
        }
    }
    Err(message)
}

fn get_activity_database_path() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        home.join(".ritual").join("activity.db")
    } else {
        PathBuf::from("./activity.db")
    }
}

fn configure_watcher_stdio(command: &mut Command) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let log_dir = home.join(".ritual").join("logs");
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create watcher log dir: {}", e))?;
    let log_path = log_dir.join("ritual-watcher.log");
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| {
            format!(
                "Failed to open watcher log file {}: {}",
                log_path.display(),
                e
            )
        })?;
    let stdout = log_file
        .try_clone()
        .map_err(|e| format!("Failed to clone watcher log file handle: {}", e))?;
    command.stdout(Stdio::from(stdout));
    command.stderr(Stdio::from(log_file));
    watcher_info!(
        "📝 Capturing watcher stdout/stderr -> {}",
        log_path.display()
    );
    Ok(())
}

pub(crate) fn read_local_watcher_freshness(device_id: &str) -> Option<LocalWatcherFreshness> {
    if device_id.trim().is_empty() {
        return None;
    }

    let db_path = get_activity_database_path();
    let conn = SqliteConnection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;

    let last_heartbeat_ts = conn
        .query_row(
            "SELECT last_seen_ts FROM watcher_heartbeat WHERE device_id = ?1",
            [device_id],
            |row| row.get(0),
        )
        .ok();

    let last_context_snapshot_ts = conn
        .query_row(
            "SELECT MAX(ts) FROM context_snapshots WHERE device_id = ?1",
            [device_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .ok()
        .flatten();

    let last_activity_ts = conn
        .query_row(
            "SELECT MAX(ts_end) FROM activity_events WHERE device_id = ?1",
            [device_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .ok()
        .flatten();

    Some(LocalWatcherFreshness {
        last_heartbeat_ts,
        last_context_snapshot_ts,
        last_activity_ts,
    })
}

fn build_watcher_args(config: &super::config::WatcherConfig) -> Vec<String> {
    let activity_db_path = get_activity_database_path();
    let mut args = vec![
        "--device-id".to_string(),
        config.device_id.clone(),
        "--user-id".to_string(),
        config.user_id.clone(),
        "--poll-interval".to_string(),
        config.poll_interval_ms.to_string(),
        "--title-mode".to_string(),
        config.title_mode.clone(),
        "--truncate-length".to_string(),
        config.truncate_length.to_string(),
        "--database".to_string(),
        activity_db_path.to_string_lossy().to_string(),
        "--foreground".to_string(),
        "--afk-timeout".to_string(),
        config.afk_timeout_seconds.to_string(),
        "--url-mode".to_string(),
        config.url_mode.clone(),
        "--browser-heartbeat-port".to_string(),
        config.browser_heartbeat_port.to_string(),
    ];

    if !config.excluded_bundle_ids.is_empty() {
        args.push("--excluded".to_string());
        args.push(config.excluded_bundle_ids.join(","));
    }

    if config.track_incognito {
        args.push("--track-incognito".to_string());
        args.push("true".to_string());
    }

    args
}

fn log_existing_watcher_bindings(context: &str) {
    let statuses = watcher_server_statuses();
    if statuses.is_empty() {
        return;
    }
    for status in statuses {
        let listener_port = status.status.listener_port.unwrap_or(status.port);
        watcher_info!(
            "⚠️ {}: watcher heartbeat server already reachable at {} (pid={:?}, listener_port={}, uptime={}s, heartbeats={})",
            context,
            status.server_url,
            status.status.process_id,
            listener_port,
            status.status.uptime_seconds,
            status.status.total_heartbeats
        );
    }
}

fn list_watcher_pids_for_device(device_id: &str) -> Vec<u32> {
    if device_id.trim().is_empty() {
        return Vec::new();
    }

    let Ok(output) = Command::new("ps").args(["-axo", "pid=,command="]).output() else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    let device_flag = format!("--device-id {}", device_id);

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || !trimmed.contains("ritual-watcher")
                || !trimmed.contains(&device_flag)
            {
                return None;
            }

            let mut parts = trimmed.splitn(2, char::is_whitespace);
            let pid = parts.next()?.trim().parse::<u32>().ok()?;
            Some(pid)
        })
        .collect()
}

fn kill_watcher_pid(pid: u32) {
    let _ = Command::new("kill").arg(pid.to_string()).output();
}

fn cleanup_existing_watcher_processes(device_id: &str, context: &str) {
    #[cfg(target_os = "macos")]
    {
        let pids = list_watcher_pids_for_device(device_id);
        if pids.is_empty() {
            watcher_info!(
                "🧹 {}: no existing watcher processes found for device",
                context
            );
            return;
        }

        for pid in &pids {
            kill_watcher_pid(*pid);
        }

        std::thread::sleep(std::time::Duration::from_millis(500));
        watcher_info!(
            "🧹 {}: cleaned up {} existing watcher process(es) for device {}",
            context,
            pids.len(),
            device_id
        );
    }
}

/// Start the ritual-watcher sidecar
#[tauri::command]
#[instrument(skip(config), fields(device_id = %config.device_id, user_id = %config.user_id))]
pub async fn start_watcher(config: super::config::WatcherConfig) -> Result<WatcherStatus, String> {
    let _operation = WATCHER_OPERATION_GATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let started_at = Instant::now();
    watcher_info!("🚀 Starting Ritual Watcher...");
    watcher_info!("   Device ID: {}", config.device_id);
    watcher_info!("   Title Mode: {}", config.title_mode);
    watcher_info!(
        "   Browser heartbeat port: {}",
        config.browser_heartbeat_port
    );
    log_existing_watcher_bindings("pre-start self-check");

    // Store device_id for later query use
    {
        let mut controller = WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        controller.device_id = Some(config.device_id.clone());
        controller.last_started_at = Some(Instant::now());
        controller.state = WatcherControllerState::Starting;
    }

    // Clear our stored handle
    {
        let mut controller = WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(mut existing_child) = controller.process.take() {
            let _ = existing_child.kill();
            let _ = existing_child.wait();
        }
    }

    // Clean up orphaned watcher processes for this exact device only.
    cleanup_existing_watcher_processes(&config.device_id, "pre-start");

    // Find executable
    let resolved_binary = find_watcher_executable()?;
    let executable = resolved_binary.path;
    watcher_info!(
        "📍 Using executable: {:?}{}",
        executable,
        resolved_binary
            .version
            .as_ref()
            .map(|v| format!(" ({v})"))
            .unwrap_or_default()
    );

    // Watcher writes activity/sync data to ~/.ritual/activity.db.
    let args = build_watcher_args(&config);

    watcher_info!("📋 Arguments: {:?}", args);

    // Spawn the watcher process
    let mut command = Command::new(&executable);
    command.args(&args);
    super::config::apply_turso_sync_env(&mut command);
    configure_watcher_stdio(&mut command)?;
    let child = command.spawn().map_err(|e| {
        WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .state = WatcherControllerState::Backoff;
        format!("Failed to start watcher: {}", e)
    })?;

    let pid = child.id();
    watcher_info!("✅ Watcher started with PID: {}", pid);

    // Store the process handle
    {
        let mut controller = WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        controller.process = Some(child);
        controller.state = WatcherControllerState::Running;
    }

    watcher_info!(
        "⏱️ start_watcher completed in {}ms",
        started_at.elapsed().as_millis()
    );

    Ok(WatcherStatus {
        is_running: true,
        pid: Some(pid),
        device_id: Some(config.device_id),
    })
}

/// Start the ritual-watcher sidecar (synchronous version for auto-start)
#[instrument(skip(config), fields(device_id = %config.device_id, user_id = %config.user_id))]
pub fn start_watcher_sync(config: super::config::WatcherConfig) -> Result<WatcherStatus, String> {
    let _operation = WATCHER_OPERATION_GATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let started_at = Instant::now();
    watcher_info!("🚀 Starting Ritual Watcher (sync)...");
    watcher_info!("   Device ID: {}", config.device_id);
    watcher_info!("   Title Mode: {}", config.title_mode);
    watcher_info!(
        "   Browser heartbeat port: {}",
        config.browser_heartbeat_port
    );
    log_existing_watcher_bindings("pre-start self-check");

    // Store device_id for later query use
    {
        let mut controller = WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        controller.device_id = Some(config.device_id.clone());
        controller.last_started_at = Some(Instant::now());
        controller.state = WatcherControllerState::Starting;
    }

    // Clear our stored handle
    {
        let mut controller = WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(mut existing_child) = controller.process.take() {
            let _ = existing_child.kill();
            let _ = existing_child.wait();
        }
    }

    // Clean up orphaned watcher processes for this exact device only.
    cleanup_existing_watcher_processes(&config.device_id, "pre-start sync");

    // Find executable
    let resolved_binary = find_watcher_executable()?;
    let executable = resolved_binary.path;
    watcher_info!(
        "📍 Using executable: {:?}{}",
        executable,
        resolved_binary
            .version
            .as_ref()
            .map(|v| format!(" ({v})"))
            .unwrap_or_default()
    );

    let args = build_watcher_args(&config);

    watcher_info!("📋 Arguments: {:?}", args);

    // Spawn the watcher process
    let mut command = Command::new(&executable);
    command.args(&args);
    super::config::apply_turso_sync_env(&mut command);
    configure_watcher_stdio(&mut command)?;
    let child = command.spawn().map_err(|e| {
        WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .state = WatcherControllerState::Backoff;
        format!("Failed to start watcher: {}", e)
    })?;

    let pid = child.id();
    watcher_info!("✅ Watcher started with PID: {}", pid);

    // Store the process handle
    {
        let mut controller = WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        controller.process = Some(child);
        controller.state = WatcherControllerState::Running;
    }

    watcher_info!(
        "⏱️ start_watcher_sync completed in {}ms",
        started_at.elapsed().as_millis()
    );

    Ok(WatcherStatus {
        is_running: true,
        pid: Some(pid),
        device_id: Some(config.device_id),
    })
}

/// Stop the ritual-watcher sidecar
#[tauri::command]
#[instrument]
pub async fn stop_watcher() -> Result<WatcherStatus, String> {
    let _operation = WATCHER_OPERATION_GATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    watcher_info!("🛑 Stopping Ritual Watcher...");

    let mut controller = WATCHER_CONTROLLER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if let Some(mut child) = controller.process.take() {
        // Try to kill the process gracefully
        match child.kill() {
            Ok(_) => {
                watcher_info!("✅ Watcher stopped");
                // Wait for the process to actually terminate
                let _ = child.wait();
            }
            Err(e) => {
                watcher_info!("⚠️ Failed to kill watcher: {}", e);
            }
        }
    } else {
        watcher_info!("ℹ️ No watcher process to stop");
        if let Some(device_id) = super::config::get_device_id_or_config() {
            cleanup_existing_watcher_processes(&device_id, "stop fallback");
        }
    }
    controller.state = if super::config::load_saved_watcher_config().is_some() {
        WatcherControllerState::Stopped
    } else {
        WatcherControllerState::Disabled
    };

    Ok(WatcherStatus {
        is_running: false,
        pid: None,
        device_id: None,
    })
}

/// Get the current status of the watcher
#[tauri::command]
#[instrument]
pub async fn get_watcher_status() -> WatcherStatus {
    let managed_pid = {
        let mut controller = WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(child) = controller.process.as_mut() {
            match child.try_wait() {
                Ok(None) => Some(child.id()),
                Ok(Some(_)) | Err(_) => {
                    controller.process = None;
                    controller.state = WatcherControllerState::Stopped;
                    None
                }
            }
        } else {
            None
        }
    };

    let heartbeat_status = watcher_server_statuses()
        .into_iter()
        .find(|status| status.port == default_browser_heartbeat_port())
        .or_else(|| watcher_server_statuses().into_iter().next());
    let reachable_pid = heartbeat_status
        .as_ref()
        .and_then(|status| status.status.process_id);

    WatcherStatus {
        is_running: managed_pid.is_some() || heartbeat_status.is_some(),
        pid: managed_pid.or(reachable_pid),
        device_id: super::config::get_device_id_or_config(),
    }
}

pub async fn get_watcher_lifecycle_snapshot() -> WatcherLifecycleSnapshot {
    let saved_config = super::config::load_saved_watcher_config();
    let accessibility_granted = super::permissions::check_accessibility_permission();
    let basic_status = get_watcher_status().await;
    let extended_status = super::queries::get_watcher_extended_status().await.ok();
    let diagnostics = get_browser_extension_diagnostics().await.ok();
    let seconds_since_heartbeat = extended_status
        .as_ref()
        .and_then(|status| status.seconds_since_heartbeat);
    let watcher_reachable = diagnostics
        .as_ref()
        .map(|diag| diag.watcher_reachable)
        .unwrap_or(basic_status.is_running);
    let heartbeat_stale = seconds_since_heartbeat
        .map(|seconds| seconds > 60)
        .unwrap_or(false);
    let (recently_started, last_restart_reason, restart_count) = {
        let controller = WATCHER_CONTROLLER
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        (
            controller
                .last_started_at
                .map(|started_at| started_at.elapsed() < Duration::from_secs(20))
                .unwrap_or(false),
            controller.last_restart_reason.clone(),
            controller.restart_count,
        )
    };

    let state = if saved_config.is_none() {
        WatcherLifecycleState::DisabledByUser
    } else if !accessibility_granted {
        WatcherLifecycleState::DisabledNoPermission
    } else if basic_status.is_running && recently_started && !heartbeat_stale {
        WatcherLifecycleState::Starting
    } else if basic_status.is_running && watcher_reachable && !heartbeat_stale {
        WatcherLifecycleState::Running
    } else if basic_status.is_running {
        WatcherLifecycleState::Unhealthy
    } else {
        WatcherLifecycleState::Backoff
    };

    WatcherLifecycleSnapshot {
        state,
        is_running: basic_status.is_running,
        pid: basic_status.pid,
        device_id: basic_status.device_id,
        accessibility_granted,
        seconds_since_heartbeat,
        restart_count,
        last_restart_reason,
    }
}
