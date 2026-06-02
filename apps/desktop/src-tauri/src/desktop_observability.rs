use once_cell::sync::OnceCell;
use serde_json::{Map, Value};
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
        .or_else(|| {
            build_time
                .map(str::to_string)
                .filter(|value| !value.is_empty())
        })
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
    .or_else(|| {
        env_or_build_time(
            "NEXT_PUBLIC_SENTRY_DESKTOP_DSN",
            option_env!("NEXT_PUBLIC_SENTRY_DESKTOP_DSN"),
        )
    })
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
        .map(redact_sensitive_json)
        .and_then(|value| serde_json::to_string(&value).ok())
        .unwrap_or_else(|| "null".to_string());

    const MAX_LEN: usize = 2048;
    if serialized.len() > MAX_LEN {
        format!("{}…", &serialized[..MAX_LEN])
    } else {
        serialized
    }
}

fn normalized_key(key: &str) -> String {
    key.chars()
        .filter(|character| *character != '_' && *character != '-')
        .flat_map(|character| character.to_lowercase())
        .collect()
}

fn is_sensitive_key(key: &str) -> bool {
    let key = normalized_key(key);
    key.contains("token")
        || key.contains("secret")
        || key.contains("password")
        || key.contains("cookie")
        || key == "auth"
        || key == "authorization"
        || key == "ticket"
        || key == "code"
        || key == "state"
        || key == "session"
        || key == "rawurl"
}

fn is_sensitive_query_key(key: &str) -> bool {
    let key = normalized_key(key);
    key.contains("token")
        || key.contains("secret")
        || key.contains("password")
        || key.contains("cookie")
        || key == "auth"
        || key == "authorization"
        || key == "ticket"
        || key == "code"
        || key == "state"
        || key == "session"
        || key == "jwt"
}

fn looks_like_secret_value(value: &str) -> bool {
    let trimmed = value.trim();
    let token_like = trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "-_=.:/+".contains(character));
    let jwt_like = trimmed.len() > 80 && trimmed.matches('.').count() == 2;
    let long_opaque_value = trimmed.len() > 120 && token_like;
    jwt_like || long_opaque_value
}

pub(crate) fn redact_sensitive_url_for_log(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return value.to_string();
    }

    let Some(query_start) = trimmed.find('?') else {
        return if looks_like_secret_value(trimmed) {
            "[redacted]".to_string()
        } else {
            value.to_string()
        };
    };

    let (prefix, query_and_fragment) = trimmed.split_at(query_start + 1);
    let (query, fragment) = match query_and_fragment.find('#') {
        Some(fragment_start) => query_and_fragment.split_at(fragment_start),
        None => (query_and_fragment, ""),
    };
    let redacted_query = query
        .split('&')
        .map(|part| {
            let Some((key, value)) = part.split_once('=') else {
                return if is_sensitive_query_key(part) {
                    format!("{part}=[redacted]")
                } else {
                    part.to_string()
                };
            };
            if is_sensitive_query_key(key) || looks_like_secret_value(value) {
                format!("{key}=[redacted]")
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("&");

    format!("{prefix}{redacted_query}{fragment}")
}

fn redact_sensitive_string_for_key(key: Option<&str>, value: &str) -> String {
    if let Some(key) = key {
        if is_sensitive_key(key) {
            if value.contains('?') {
                return redact_sensitive_url_for_log(value);
            }
            return "[redacted]".to_string();
        }
    }
    redact_sensitive_url_for_log(value)
}

fn redact_sensitive_json_value(key: Option<&str>, value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut redacted = Map::new();
            for (child_key, child_value) in map {
                redacted.insert(
                    child_key.clone(),
                    redact_sensitive_json_value(Some(&child_key), child_value),
                );
            }
            Value::Object(redacted)
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| redact_sensitive_json_value(None, item))
                .collect(),
        ),
        Value::String(text) => Value::String(redact_sensitive_string_for_key(key, &text)),
        other => other,
    }
}

fn redact_sensitive_json(value: Value) -> Value {
    redact_sensitive_json_value(None, value)
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
            sentry::capture_message(
                &format!("Desktop shell event: {event_name}"),
                sentry::Level::Error,
            );
        }
        "warn" | "warning" => {
            warn!(event = event_name, payload = %payload, "desktop.shell");
            sentry::capture_message(
                &format!("Desktop shell event: {event_name}"),
                sentry::Level::Warning,
            );
        }
        _ => info!(event = event_name, payload = %payload, "desktop.shell"),
    }

    Ok(())
}

#[tauri::command]
pub fn desktop_capture_sentry_smoke() -> Result<(), String> {
    if !init_native_sentry() {
        return Err(
            "Native desktop Sentry is disabled; no SENTRY_DESKTOP_NATIVE_DSN configured"
                .to_string(),
        );
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redacts_sensitive_auth_query_params_in_payloads() {
        let payload = json!({
            "nextPath": "/auth/callback?ticket=secret-ticket&mode=sign-in",
            "rawUrl": "ritual://auth/callback?ticket=secret-ticket&code=abc&state=xyz",
            "backendBase": "https://api.ritual.local",
        });

        let logged = payload_to_log_string(Some(payload));

        assert!(logged.contains("/auth/callback?ticket=[redacted]&mode=sign-in"));
        assert!(logged
            .contains("ritual://auth/callback?ticket=[redacted]&code=[redacted]&state=[redacted]"));
        assert!(logged.contains("https://api.ritual.local"));
        assert!(!logged.contains("secret-ticket"));
        assert!(!logged.contains("\"code\":\"abc\""));
        assert!(!logged.contains("\"state\":\"xyz\""));
    }

    #[test]
    fn redacts_sensitive_nested_values_and_preserves_operational_fields() {
        let payload = json!({
            "desktop_version": "0.1.60",
            "authToken": "token-value",
            "nested": {
                "headers": {
                    "authorization": "Bearer hidden"
                },
                "items": [
                    {
                        "refresh_token": "refresh-hidden",
                        "route": "/dashboard?tab=overview"
                    }
                ]
            }
        });

        let logged = payload_to_log_string(Some(payload));

        assert!(logged.contains("\"desktop_version\":\"0.1.60\""));
        assert!(logged.contains("\"route\":\"/dashboard?tab=overview\""));
        assert!(!logged.contains("token-value"));
        assert!(!logged.contains("Bearer hidden"));
        assert!(!logged.contains("refresh-hidden"));
    }
}
