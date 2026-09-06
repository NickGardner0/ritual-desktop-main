use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant},
};

const SYSTEM_AUDIO_MIN_MACOS_VERSION: &str = include_str!("../system-audio-min-macos-version.txt");
const SYSTEM_AUDIO_HELPER_APP_NAME: &str = "Ritual.app";
const SYSTEM_AUDIO_HELPER_EXECUTABLE: &str = "ritual-system-audio-recorder";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum RecordingSourceMode {
    #[default]
    MicrophoneOnly,
    MicrophonePlusSystem,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RecordingSource {
    Microphone,
    System,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRecordingSourceReadinessRequest {
    #[serde(default)]
    pub source_mode: RecordingSourceMode,
    #[serde(default)]
    pub probe_system_audio: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSourceReadinessDto {
    pub source_mode: RecordingSourceMode,
    pub ready: bool,
    pub checked_at: String,
    pub sources: Vec<SourceReadinessDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceReadinessDto {
    pub source: RecordingSource,
    pub required: bool,
    pub ready: bool,
    pub permission_state: String,
    pub device_available: bool,
    pub capture_available: bool,
    pub recovery_action: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
struct SystemAudioError {
    code: &'static str,
    message: String,
}

impl SystemAudioError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SystemAudioPermissionPreflight {
    Authorized,
    Denied,
    Unknown,
}

#[derive(Debug)]
struct HelperStatus {
    event: String,
    message: Option<String>,
}

#[tauri::command]
pub async fn check_recording_source_readiness(
    request: CheckRecordingSourceReadinessRequest,
) -> Result<RecordingSourceReadinessDto, String> {
    let microphone_ready = crate::native_widget::check_native_microphone_permission()
        .await
        .unwrap_or(false);
    let microphone_source = SourceReadinessDto {
        source: RecordingSource::Microphone,
        required: true,
        ready: microphone_ready,
        permission_state: if microphone_ready {
            "granted"
        } else {
            "unknown"
        }
        .to_string(),
        device_available: microphone_ready,
        capture_available: microphone_ready,
        recovery_action: (!microphone_ready).then(|| "openMicrophoneSettings".to_string()),
        message: (!microphone_ready)
            .then(|| "Microphone access is required for voice logging.".to_string()),
    };

    let mut sources = vec![microphone_source];
    if request.source_mode == RecordingSourceMode::MicrophonePlusSystem {
        let probe_system_audio = request.probe_system_audio;
        let system_source =
            tokio::task::spawn_blocking(move || system_audio_readiness(probe_system_audio))
                .await
                .map_err(|error| format!("Failed to check system audio readiness: {error}"))?;
        sources.push(system_source);
    }

    let ready = sources
        .iter()
        .all(|source| !source.required || source.ready);

    Ok(RecordingSourceReadinessDto {
        source_mode: request.source_mode,
        ready,
        checked_at: Utc::now().to_rfc3339(),
        sources,
    })
}

fn system_audio_readiness(probe_permission: bool) -> SourceReadinessDto {
    #[cfg(target_os = "macos")]
    {
        let os_supported = macos_version_supports_system_audio();
        let helper_available = helper_app_available();
        if !os_supported {
            return SourceReadinessDto {
                source: RecordingSource::System,
                required: true,
                ready: false,
                permission_state: "unsupported".to_string(),
                device_available: false,
                capture_available: false,
                recovery_action: Some("upgradeMacos".to_string()),
                message: Some(format!(
                    "System audio capture requires macOS {} or later.",
                    system_audio_min_macos_version_label()
                )),
            };
        }

        if !helper_available {
            return SourceReadinessDto {
                source: RecordingSource::System,
                required: true,
                ready: false,
                permission_state: "unsupported".to_string(),
                device_available: false,
                capture_available: false,
                recovery_action: Some("restartApp".to_string()),
                message: Some("System audio helper is not bundled with this build.".to_string()),
            };
        }

        let mut source = match helper_permission_preflight() {
            Ok(SystemAudioPermissionPreflight::Authorized) => SourceReadinessDto {
                source: RecordingSource::System,
                required: true,
                ready: true,
                permission_state: "granted".to_string(),
                device_available: true,
                capture_available: true,
                recovery_action: None,
                message: None,
            },
            Ok(SystemAudioPermissionPreflight::Denied) => SourceReadinessDto {
                source: RecordingSource::System,
                required: true,
                ready: false,
                permission_state: "denied".to_string(),
                device_available: true,
                capture_available: false,
                recovery_action: Some("openSystemAudioSettings".to_string()),
                message: Some(
                    "Enable Ritual in System Settings > Privacy & Security > Screen & System Audio Recording."
                        .to_string(),
                ),
            },
            Ok(SystemAudioPermissionPreflight::Unknown) => SourceReadinessDto {
                source: RecordingSource::System,
                required: true,
                ready: false,
                permission_state: "unknown".to_string(),
                device_available: true,
                capture_available: true,
                recovery_action: Some("requestSystemAudio".to_string()),
                message: Some("Approve the macOS prompt when Ritual asks for System Audio Recording.".to_string()),
            },
            Err(error) => SourceReadinessDto {
                source: RecordingSource::System,
                required: true,
                ready: false,
                permission_state: "unknown".to_string(),
                device_available: true,
                capture_available: false,
                recovery_action: Some("restartApp".to_string()),
                message: Some(error.message),
            },
        };

        if probe_permission {
            source = apply_system_audio_permission_probe_result(source, helper_permission_check());
        }

        source
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = probe_permission;
        SourceReadinessDto {
            source: RecordingSource::System,
            required: true,
            ready: false,
            permission_state: "unsupported".to_string(),
            device_available: false,
            capture_available: false,
            recovery_action: None,
            message: Some("System audio capture is only supported on macOS.".to_string()),
        }
    }
}

fn apply_system_audio_permission_probe_result(
    mut source: SourceReadinessDto,
    result: Result<(), SystemAudioError>,
) -> SourceReadinessDto {
    match result {
        Ok(()) => {
            source.ready = true;
            source.permission_state = "granted".to_string();
            source.device_available = true;
            source.capture_available = true;
            source.recovery_action = None;
            source.message = None;
        }
        Err(error) => {
            source.ready = false;
            source.capture_available = false;
            match error.code {
                "system_audio_permission_denied" => {
                    source.permission_state = "denied".to_string();
                    source.recovery_action = Some("openSystemAudioSettings".to_string());
                }
                "system_audio_capture_unavailable" => {
                    source.permission_state = "granted".to_string();
                    source.recovery_action = Some("restartApp".to_string());
                }
                _ => {
                    source.permission_state = "unknown".to_string();
                    source.recovery_action = Some("restartApp".to_string());
                }
            }
            source.message = Some(error.message);
        }
    }
    source
}

#[cfg(target_os = "macos")]
fn helper_permission_preflight() -> Result<SystemAudioPermissionPreflight, SystemAudioError> {
    let helper_app = helper_app_path();
    if !helper_app_available_at(&helper_app) {
        return Err(SystemAudioError::new(
            "system_audio_unavailable",
            "System audio helper is not bundled with this build.",
        ));
    }

    let temp = helper_temp_path("preflight");
    let status_path = temp.with_extension("json");
    let log_path = temp.with_extension("log");
    remove_helper_files(&[&status_path, &log_path]);

    let open_status = Command::new("/usr/bin/open")
        .arg("-n")
        .arg(&helper_app)
        .arg("--args")
        .arg("--preflight")
        .arg("--status")
        .arg(&status_path)
        .arg("--log")
        .arg(&log_path)
        .status()
        .map_err(|error| SystemAudioError::new("system_audio_unavailable", error.to_string()))?;
    if !open_status.success() {
        return Err(SystemAudioError::new(
            "system_audio_unavailable",
            format!("System audio helper could not be launched: {open_status}"),
        ));
    }

    let status = wait_for_status(
        &status_path,
        Some(&log_path),
        Duration::from_secs(5),
        &["authorized", "denied", "unknown", "error"],
        "System audio permission preflight timed out.",
    );
    let result = match status {
        Ok(status) if status.event == "authorized" => {
            Ok(SystemAudioPermissionPreflight::Authorized)
        }
        Ok(status) if status.event == "denied" => Ok(SystemAudioPermissionPreflight::Denied),
        Ok(status) if status.event == "unknown" => Ok(SystemAudioPermissionPreflight::Unknown),
        Ok(status) => Err(SystemAudioError::new(
            "system_audio_unavailable",
            status.message.unwrap_or_else(|| {
                format!(
                    "Unexpected system audio preflight event '{}'.",
                    status.event
                )
            }),
        )),
        Err(error) => Err(error),
    };
    remove_helper_files(&[&status_path, &log_path]);
    result
}

#[cfg(target_os = "macos")]
fn helper_permission_check() -> Result<(), SystemAudioError> {
    let helper_app = helper_app_path();
    if !helper_app_available_at(&helper_app) {
        return Err(SystemAudioError::new(
            "system_audio_unavailable",
            "System audio helper is not bundled with this build.",
        ));
    }

    terminate_existing_helpers();
    let temp = helper_temp_path("check");
    let status_path = temp.with_extension("json");
    let pid_path = temp.with_extension("pid");
    let log_path = temp.with_extension("log");
    remove_helper_files(&[&status_path, &pid_path, &log_path]);

    let open_status = Command::new("/usr/bin/open")
        .arg("-n")
        .arg(&helper_app)
        .arg("--args")
        .arg("--check")
        .arg("--status")
        .arg(&status_path)
        .arg("--pid")
        .arg(&pid_path)
        .arg("--log")
        .arg(&log_path)
        .status()
        .map_err(|error| SystemAudioError::new("system_audio_unavailable", error.to_string()))?;
    if !open_status.success() {
        return Err(SystemAudioError::new(
            "system_audio_unavailable",
            format!("System audio helper could not be launched: {open_status}"),
        ));
    }

    let status = wait_for_status(
        &status_path,
        Some(&log_path),
        Duration::from_secs(75),
        &["authorized", "ready", "level", "error"],
        "System audio helper could not start a usable CoreAudio capture.",
    );
    let helper_pid = read_pid(&pid_path);
    let result = match status {
        Ok(status) if matches!(status.event.as_str(), "authorized" | "ready" | "level") => Ok(()),
        Ok(status) if status.event == "error" => {
            let message = status
                .message
                .unwrap_or_else(|| "System audio capture probe failed.".to_string());
            Err(SystemAudioError::new(helper_error_code(&message), message))
        }
        Ok(status) => Err(SystemAudioError::new(
            "system_audio_unavailable",
            format!(
                "System audio capture probe ended with unexpected event '{}'.",
                status.event
            ),
        )),
        Err(error) => Err(error),
    };

    if let Some(pid) = helper_pid {
        send_signal(pid, "-TERM");
    }
    remove_helper_files(&[&status_path, &pid_path, &log_path]);
    result
}

#[cfg(target_os = "macos")]
fn helper_error_code(message: &str) -> &'static str {
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("permission is denied")
        || normalized.contains("permission was not granted")
        || normalized.contains("permission has not been granted")
        || normalized.contains("timed out waiting for system audio recording permission")
    {
        "system_audio_permission_denied"
    } else {
        "system_audio_capture_unavailable"
    }
}

#[cfg(target_os = "macos")]
fn helper_temp_path(kind: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "ritual-system-audio-{kind}-{}-{}",
        std::process::id(),
        Utc::now().timestamp_millis()
    ))
}

#[cfg(target_os = "macos")]
fn helper_app_available() -> bool {
    helper_app_available_at(&helper_app_path())
}

#[cfg(target_os = "macos")]
fn helper_app_available_at(helper_app: &Path) -> bool {
    helper_app
        .join("Contents")
        .join("MacOS")
        .join(SYSTEM_AUDIO_HELPER_EXECUTABLE)
        .is_file()
}

#[cfg(target_os = "macos")]
fn helper_app_path() -> PathBuf {
    let dev_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .join(".tauri-helper")
        .join(SYSTEM_AUDIO_HELPER_APP_NAME);
    if helper_app_available_at(&dev_path) {
        return dev_path;
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(contents_dir) = current_exe
            .ancestors()
            .find(|path| path.file_name().and_then(|name| name.to_str()) == Some("Contents"))
        {
            let resource_path = contents_dir
                .join("Resources")
                .join("native")
                .join("bin")
                .join(SYSTEM_AUDIO_HELPER_APP_NAME);
            if helper_app_available_at(&resource_path) {
                return resource_path;
            }
        }
    }

    dev_path
}

#[cfg(target_os = "macos")]
fn wait_for_status(
    path: &Path,
    log_path: Option<&Path>,
    timeout: Duration,
    terminal_events: &[&str],
    timeout_message: &str,
) -> Result<HelperStatus, SystemAudioError> {
    let started = Instant::now();
    loop {
        if let Ok(status) = read_status(path) {
            if terminal_events.contains(&status.event.as_str()) {
                return Ok(status);
            }
        }
        if started.elapsed() >= timeout {
            if let Some(log_path) = log_path {
                dump_helper_log(log_path);
            }
            return Err(SystemAudioError::new(
                "system_audio_unavailable",
                timeout_message,
            ));
        }
        std::thread::sleep(Duration::from_millis(80));
    }
}

#[cfg(target_os = "macos")]
fn read_status(path: &Path) -> Result<HelperStatus, String> {
    let data = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    let value =
        serde_json::from_str::<serde_json::Value>(&data).map_err(|error| error.to_string())?;
    Ok(HelperStatus {
        event: value
            .get("event")
            .and_then(|event| event.as_str())
            .unwrap_or_default()
            .to_string(),
        message: value
            .get("message")
            .and_then(|message| message.as_str())
            .map(str::to_string),
    })
}

#[cfg(target_os = "macos")]
fn read_pid(path: &Path) -> Option<u32> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

#[cfg(target_os = "macos")]
fn send_signal(pid: u32, signal: &str) {
    let _ = Command::new("kill")
        .arg(signal)
        .arg(pid.to_string())
        .status();
}

#[cfg(target_os = "macos")]
fn terminate_existing_helpers() {
    let Ok(output) = Command::new("pgrep")
        .arg("-f")
        .arg(SYSTEM_AUDIO_HELPER_EXECUTABLE)
        .output()
    else {
        return;
    };
    for pid in String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .filter(|pid| *pid != std::process::id())
    {
        send_signal(pid, "-TERM");
    }
}

#[cfg(target_os = "macos")]
fn remove_helper_files(paths: &[&Path]) {
    for path in paths {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(target_os = "macos")]
fn macos_version_supports_system_audio() -> bool {
    let output = Command::new("sw_vers").arg("-productVersion").output();
    let Ok(output) = output else {
        return false;
    };
    let version = String::from_utf8_lossy(&output.stdout);
    macos_version_string_supports_system_audio(&version)
}

#[cfg(target_os = "macos")]
fn macos_version_string_supports_system_audio(version: &str) -> bool {
    let Some(current) = parse_macos_version(version) else {
        return false;
    };
    let Some(minimum) = parse_macos_version(SYSTEM_AUDIO_MIN_MACOS_VERSION) else {
        return false;
    };
    current >= minimum
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct MacosVersion {
    major: u32,
    minor: u32,
}

#[cfg(target_os = "macos")]
fn parse_macos_version(version: &str) -> Option<MacosVersion> {
    let mut parts = version.trim().split('.').map(|part| part.parse::<u32>());
    let major = match parts.next() {
        Some(Ok(major)) => major,
        _ => return None,
    };
    let minor = match parts.next() {
        Some(Ok(minor)) => minor,
        Some(Err(_)) => return None,
        None => 0,
    };
    Some(MacosVersion { major, minor })
}

fn system_audio_min_macos_version_label() -> &'static str {
    SYSTEM_AUDIO_MIN_MACOS_VERSION.trim()
}

#[cfg(target_os = "macos")]
fn dump_helper_log(path: &Path) {
    if let Ok(log) = std::fs::read_to_string(path) {
        for line in log.lines() {
            eprintln!("[system-audio-helper] {line}");
        }
    }
}
