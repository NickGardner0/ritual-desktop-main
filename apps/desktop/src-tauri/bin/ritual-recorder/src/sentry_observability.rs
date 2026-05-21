use std::env;

fn env_or_build_time(name: &str, build_time: Option<&'static str>) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| build_time.map(str::to_string).filter(|value| !value.is_empty()))
}

fn sentry_dsn() -> Option<String> {
    env_or_build_time("SENTRY_DESKTOP_NATIVE_DSN", option_env!("SENTRY_DESKTOP_NATIVE_DSN"))
        .or_else(|| env_or_build_time("NEXT_PUBLIC_SENTRY_DESKTOP_DSN", option_env!("NEXT_PUBLIC_SENTRY_DESKTOP_DSN")))
        .or_else(|| env_or_build_time("SENTRY_DSN", option_env!("SENTRY_DSN")))
}

fn sentry_environment() -> String {
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

fn sentry_release(component: &str) -> String {
    env_or_build_time("SENTRY_RELEASE", option_env!("SENTRY_RELEASE"))
        .or_else(|| env_or_build_time("GITHUB_SHA", option_env!("GITHUB_SHA")))
        .unwrap_or_else(|| format!("{component}@{}", env!("CARGO_PKG_VERSION")))
}

fn sentry_traces_sample_rate() -> f32 {
    env::var("SENTRY_TRACES_SAMPLE_RATE")
        .ok()
        .and_then(|value| value.parse::<f32>().ok())
        .unwrap_or_else(|| if cfg!(debug_assertions) { 1.0 } else { 0.1 })
}

pub fn init_sentry(component: &'static str, surface: &'static str) -> Option<sentry::ClientInitGuard> {
    let dsn = sentry_dsn()?;
    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: Some(sentry_release(component).into()),
            environment: Some(sentry_environment().into()),
            traces_sample_rate: sentry_traces_sample_rate(),
            ..Default::default()
        },
    ));
    sentry::configure_scope(|scope| {
        scope.set_tag("runtime", "desktop_native");
        scope.set_tag("surface", surface);
        scope.set_tag("component", component);
        scope.set_tag("desktop_version", env!("CARGO_PKG_VERSION"));
    });
    Some(guard)
}

pub fn set_recorder_context(database_path: &std::path::Path, watcher_database_path: &std::path::Path) {
    sentry::configure_scope(|scope| {
        scope.set_tag("memory_db_configured", (!database_path.as_os_str().is_empty()).to_string());
        scope.set_tag(
            "watcher_db_configured",
            (!watcher_database_path.as_os_str().is_empty()).to_string(),
        );
    });
}
