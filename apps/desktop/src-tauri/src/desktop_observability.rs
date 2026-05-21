use once_cell::sync::OnceCell;
use serde_json::Value;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tracing::{error, info, warn};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

static LOG_GUARD: OnceCell<WorkerGuard> = OnceCell::new();
static SENTRY_GUARD: OnceCell<sentry::ClientInitGuard> = OnceCell::new();

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
    init_native_sentry();

    Ok(())
}

fn env_or_build_time(name: &str, build_time: Option<&'static str>) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| build_time.map(str::to_string).filter(|value| !value.is_empty()))
}

fn desktop_environment() -> String {
    env_or_build_time("SENTRY_ENVIRONMENT", option_env!("SENTRY_ENVIRONMENT"))
        .or_else(|| env_or_build_time("RITUAL_ENV", option_env!("RITUAL_ENV")))
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) {
                "development".to_string()
            } else {
                "production".to_string()
            }
        })
}

fn desktop_release() -> String {
    env_or_build_time("SENTRY_RELEASE", option_env!("SENTRY_RELEASE"))
        .or_else(|| env_or_build_time("GITHUB_SHA", option_env!("GITHUB_SHA")))
        .unwrap_or_else(|| format!("ritual-desktop@{}", env!("CARGO_PKG_VERSION")))
}

fn native_sentry_dsn() -> Option<String> {
    env_or_build_time(
        "SENTRY_DESKTOP_NATIVE_DSN",
        option_env!("SENTRY_DESKTOP_NATIVE_DSN"),
    )
    .or_else(|| env_or_build_time("NEXT_PUBLIC_SENTRY_DESKTOP_DSN", option_env!("NEXT_PUBLIC_SENTRY_DESKTOP_DSN")))
    .or_else(|| env_or_build_time("SENTRY_DSN", option_env!("SENTRY_DSN")))
}

fn sentry_traces_sample_rate() -> f32 {
    env::var("SENTRY_TRACES_SAMPLE_RATE")
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or_else(|| if cfg!(debug_assertions) { 1.0 } else { 0.1 })
}

fn init_native_sentry() -> bool {
    if SENTRY_GUARD.get().is_some() {
        return true;
    }

    let Some(dsn) = native_sentry_dsn() else {
        info!("Native desktop Sentry disabled; no SENTRY_DESKTOP_NATIVE_DSN configured");
        return false;
    };
    let environment = desktop_environment();
    let release = desktop_release();
    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: Some(release.into()),
            environment: Some(environment.into()),
            traces_sample_rate: sentry_traces_sample_rate(),
            ..Default::default()
        },
    ));
    sentry::configure_scope(|scope| {
        scope.set_tag("runtime", "desktop_native");
        scope.set_tag("surface", "tauri_shell");
        scope.set_tag("desktop_version", env!("CARGO_PKG_VERSION"));
    });
    let _ = SENTRY_GUARD.set(guard);
    info!("Native desktop Sentry initialized");
    true
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
        "error" => {
            error!(event = event_name, payload = %payload, "desktop.shell");
            sentry::capture_message(&format!("Desktop shell event: {event_name}"), sentry::Level::Error);
        }
        "warn" | "warning" => {
            warn!(event = event_name, payload = %payload, "desktop.shell");
            sentry::capture_message(&format!("Desktop shell event: {event_name}"), sentry::Level::Warning);
        }
        _ => info!(event = event_name, payload = %payload, "desktop.shell"),
    }

    Ok(())
}

#[tauri::command]
pub fn desktop_capture_sentry_smoke() -> Result<(), String> {
    if !init_native_sentry() {
        return Err("Native desktop Sentry is disabled; no SENTRY_DESKTOP_NATIVE_DSN configured".to_string());
    }
    sentry::configure_scope(|scope| {
        scope.set_tag("runtime", "desktop_native");
        scope.set_tag("surface", "tauri_shell");
        scope.set_tag("smoke_test", "true");
        scope.set_tag("desktop_version", env!("CARGO_PKG_VERSION"));
    });
    sentry::capture_message("Sentry smoke test: native desktop", sentry::Level::Info);
    if let Some(client) = sentry::Hub::current().client() {
        client.flush(Some(Duration::from_secs(2)));
    }
    Ok(())
}
