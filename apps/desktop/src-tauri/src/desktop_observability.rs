use once_cell::sync::OnceCell;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tracing::{error, info, warn};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

static LOG_GUARD: OnceCell<WorkerGuard> = OnceCell::new();

fn desktop_log_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ritual")
        .join("logs")
}

pub fn init_desktop_observability() -> Result<(), String> {
    if LOG_GUARD.get().is_some() {
        return Ok(());
    }

    let log_dir = desktop_log_dir();
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("Failed to create desktop log directory: {error}"))?;

    let file_appender = tracing_appender::rolling::daily(&log_dir, "ritual-desktop.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,hyper=warn,reqwest=warn,tao=warn,wry=warn"));

    let stderr_layer = fmt::layer().with_target(true).with_ansi(true).compact();

    let file_layer = fmt::layer()
        .with_writer(file_writer)
        .with_target(true)
        .with_ansi(false)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .compact();

    let subscriber = tracing_subscriber::registry()
        .with(env_filter)
        .with(stderr_layer)
        .with(file_layer);

    tracing::subscriber::set_global_default(subscriber)
        .map_err(|error| format!("Failed to initialize tracing subscriber: {error}"))?;

    let _ = LOG_GUARD.set(guard);

    info!(
        log_dir = %log_dir.display(),
        "Desktop observability initialized"
    );

    Ok(())
}

fn payload_to_log_string(payload: Option<Value>) -> String {
    let serialized = payload
        .and_then(|value| serde_json::to_string(&value).ok())
        .unwrap_or_else(|| "null".to_string());

    const MAX_LEN: usize = 2048;
    if serialized.len() > MAX_LEN {
        format!("{}…", &serialized[..MAX_LEN])
    } else {
        serialized
    }
}

#[tauri::command]
pub fn desktop_record_shell_event(
    name: String,
    level: Option<String>,
    data: Option<Value>,
) -> Result<(), String> {
    let event_name = name.trim();
    if event_name.is_empty() {
        return Err("Desktop shell event name is required".to_string());
    }

    let payload = payload_to_log_string(data);
    match level
        .unwrap_or_else(|| "info".to_string())
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "error" => error!(event = event_name, payload = %payload, "desktop.shell"),
        "warn" | "warning" => warn!(event = event_name, payload = %payload, "desktop.shell"),
        _ => info!(event = event_name, payload = %payload, "desktop.shell"),
    }

    Ok(())
}
