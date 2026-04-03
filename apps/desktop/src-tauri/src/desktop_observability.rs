use once_cell::sync::OnceCell;
use std::fs;
use std::path::PathBuf;
use tracing::info;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_log::LogTracer;
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

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new("info,hyper=warn,reqwest=warn,tao=warn,wry=warn")
    });

    let stderr_layer = fmt::layer()
        .with_target(true)
        .with_ansi(true)
        .compact();

    let file_layer = fmt::layer()
        .with_writer(file_writer)
        .with_target(true)
        .with_ansi(false)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .compact();

    LogTracer::init().map_err(|error| format!("Failed to install LogTracer: {error}"))?;

    tracing_subscriber::registry()
        .with(env_filter)
        .with(stderr_layer)
        .with(file_layer)
        .try_init()
        .map_err(|error| format!("Failed to initialize tracing subscriber: {error}"))?;

    let _ = LOG_GUARD.set(guard);

    info!(
        log_dir = %log_dir.display(),
        "Desktop observability initialized"
    );

    Ok(())
}
