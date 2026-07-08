// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(unexpected_cfgs)]

mod cloud_sync;
mod desktop_observability;
mod desktop_runtime;
mod desktop_runtime_types;
mod local_vault;
mod native_widget;
mod privacy_policy;
mod ritual_database;
mod system_audio;
mod watcher;
mod watcher_activity;

use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent,
};
#[cfg(target_os = "macos")]
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tracing::{info, instrument, warn};

// ============================================================================
// AUTHENTICATION NOTE:
// OAuth (Google, Apple, X/Twitter) is handled by Clerk via web UI
// No Rust OAuth code needed - Clerk handles everything!
// ============================================================================

// ============================================================================
// APP URL CONFIGURATION (Midday Pattern)
//
// The desktop app loads the UI from a URL based on environment:
// - Development: http://localhost:3000 (local Next.js server)
// - Staging: https://staging.ritual.app (when you have one)
// - Production: https://desktop.ritualdb.com
//
// Set RITUAL_ENV environment variable to control which URL is used.
// Debug builds default to development; release builds default to production.
// ============================================================================

const DEV_APP_URL: &str = "http://localhost:3000";
const STAGING_APP_URL: &str = "https://staging.ritual.app";
const PROD_APP_URL: &str = "https://desktop.ritualdb.com";
const DESKTOP_SHELL_DEV_URL: &str = "http://127.0.0.1:1420";
const DESKTOP_WEBVIEW_USER_AGENT: &str = "RitualDesktop/0.1.0";
const MAIN_WINDOW_DEFAULT_WIDTH: f64 = 1280.0;
const MAIN_WINDOW_DEFAULT_HEIGHT: f64 = 800.0;
const MAIN_WINDOW_DEFAULT_SIZE_MARKER: &str = ".main_window_default_size_1280x800_v1.done";
#[cfg(target_os = "macos")]
const MACOS_NATIVE_WINDOW_CORNER_RADIUS: f64 = 18.0;
#[cfg(target_os = "macos")]
const MACOS_SETTINGS_WINDOW_CORNER_RADIUS: f64 = 10.0;
const VOICE_HUD_WINDOW_WIDTH: f64 = 860.0;
const VOICE_HUD_WINDOW_HEIGHT: f64 = 244.0;
const DEFAULT_VOICE_SHORTCUT: &str = "Alt+Space";
const VOICE_HOTKEY_SETTINGS_FILE: &str = "voice-hotkey-settings.json";
#[cfg(target_os = "macos")]
const VOICE_HUD_HELPER_APP_NAME: &str = "RitualVoiceHud.app";
#[cfg(target_os = "macos")]
const VOICE_HUD_HELPER_EXECUTABLE: &str = "ritual-voice-hud";

#[derive(Clone, Copy, Debug)]
enum DesktopShellNavGateMode {
    Off,
    Report,
    Enforce,
}

impl DesktopShellNavGateMode {
    fn from_env() -> Self {
        match read_nonempty_env("RITUAL_DESKTOP_NAV_GATE_MODE")
            .unwrap_or_else(|| "off".to_string())
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "report" => Self::Report,
            "enforce" => Self::Enforce,
            _ => Self::Off,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Report => "report",
            Self::Enforce => "enforce",
        }
    }
}

#[derive(Clone, Debug)]
struct DesktopShellFeatureFlags {
    nav_gate_mode: DesktopShellNavGateMode,
    shell_heartbeat_enabled: bool,
    shell_auto_recover_enabled: bool,
    deep_link_v2_enabled: bool,
}

#[derive(Clone, Copy, Debug)]
enum PersistedTursoSyncConfigLoadStatus {
    LoadedFresh,
    Missing,
    ExpiredOrStale,
    Error,
}

impl DesktopShellFeatureFlags {
    fn from_env() -> Self {
        Self {
            nav_gate_mode: DesktopShellNavGateMode::from_env(),
            shell_heartbeat_enabled: env_flag_enabled("RITUAL_DESKTOP_SHELL_HEARTBEAT"),
            shell_auto_recover_enabled: env_flag_enabled("RITUAL_DESKTOP_SHELL_AUTO_RECOVER"),
            deep_link_v2_enabled: env_flag_enabled("RITUAL_DESKTOP_DEEPLINK_V2"),
        }
    }

    fn log_effective_values(&self) {
        info!(
            nav_gate_mode = self.nav_gate_mode.as_str(),
            shell_heartbeat_enabled = self.shell_heartbeat_enabled,
            shell_auto_recover_enabled = self.shell_auto_recover_enabled,
            deep_link_v2_enabled = self.deep_link_v2_enabled,
            "Desktop shell feature flags loaded"
        );
    }
}

fn read_nonempty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn apply_one_time_main_window_default_size(window: &tauri::WebviewWindow) {
    let Some(ritual_dir) = dirs::home_dir().map(|home| home.join(".ritual")) else {
        return;
    };
    let marker_path = ritual_dir.join(MAIN_WINDOW_DEFAULT_SIZE_MARKER);
    if marker_path.exists() {
        return;
    }

    if let Err(error) = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: MAIN_WINDOW_DEFAULT_WIDTH,
        height: MAIN_WINDOW_DEFAULT_HEIGHT,
    })) {
        warn!(error = %error, "Failed to apply one-time main window default size");
        return;
    }

    if let Err(error) = window.center() {
        warn!(error = %error, "Failed to center main window after default size migration");
    }

    if let Err(error) = std::fs::create_dir_all(&ritual_dir) {
        warn!(error = %error, "Failed to create Ritual config directory for window size marker");
        return;
    }
    if let Err(error) = std::fs::write(&marker_path, b"ok\n") {
        warn!(
            error = %error,
            marker_path = %marker_path.display(),
            "Failed to write main window default size marker"
        );
    }
}

fn configured_ritual_env() -> String {
    read_nonempty_env("RITUAL_ENV")
        .or_else(|| {
            option_env!("RITUAL_ENV")
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) {
                "development".to_string()
            } else {
                "production".to_string()
            }
        })
}

/// Get the app URL based on environment
/// This follows the Midday pattern where the desktop app loads from a hosted URL
fn get_app_url() -> String {
    if let Some(explicit_url) = read_nonempty_env("RITUAL_APP_URL") {
        println!(
            "🌍 Using explicit Ritual app URL override: {}",
            explicit_url
        );
        return explicit_url;
    }

    let env = configured_ritual_env();

    println!("🌍 Ritual environment: {}", env);

    match env.as_str() {
        "development" | "dev" => {
            let url =
                read_nonempty_env("RITUAL_DEV_URL").unwrap_or_else(|| DEV_APP_URL.to_string());
            println!("🌍 Using development URL: {}", url);
            url
        }
        "staging" => {
            let url = read_nonempty_env("RITUAL_STAGING_URL")
                .unwrap_or_else(|| STAGING_APP_URL.to_string());
            println!("🌍 Using staging URL: {}", url);
            url
        }
        "production" | "prod" => {
            let url =
                read_nonempty_env("RITUAL_PROD_URL").unwrap_or_else(|| PROD_APP_URL.to_string());
            println!("🌍 Using production URL: {}", url);
            url
        }
        _ => {
            let fallback = if cfg!(debug_assertions) {
                DEV_APP_URL
            } else {
                PROD_APP_URL
            };
            eprintln!(
                "⚠️ Unknown environment: {}, defaulting to {}",
                env,
                if cfg!(debug_assertions) {
                    "development"
                } else {
                    "production"
                }
            );
            let url = fallback.to_string();
            println!("🌍 Using fallback URL: {}", url);
            url
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopShellBootstrapConfig {
    environment: String,
    app_origin: String,
    bootstrap_url: String,
    callback_url: String,
}

fn build_desktop_bootstrap_url(app_origin: &str, ritual_env: &str) -> String {
    if app_origin.starts_with("http://localhost:") || app_origin.starts_with("http://127.0.0.1:") {
        // Local perf/debug runs should hit the real dashboard route directly
        // instead of going through the hosted bootstrap flow, which otherwise
        // adds a blank shell + auth handoff step that obscures first-data timing.
        return join_url_path(app_origin, "/dashboard");
    }

    let transparency_probe = env_flag_enabled("RITUAL_TRANSPARENCY_PROBE");
    let main_glass_enabled = transparency_probe || !env_flag_enabled("RITUAL_DISABLE_MAIN_GLASS");
    let mut bootstrap_url = with_query_param(
        &join_url_path(app_origin, "/dashboard"),
        &format!("ritual_desktop_env={}", ritual_env),
    );

    if main_glass_enabled {
        bootstrap_url = with_query_param(&bootstrap_url, "ritual_main_glass=1");
        bootstrap_url = with_query_param(&bootstrap_url, "ritual_glass_chrome=1");
    }

    if transparency_probe {
        bootstrap_url = with_query_param(&bootstrap_url, "ritual_transparency_probe=1");
    }

    bootstrap_url
}

fn build_desktop_shell_bootstrap_config() -> DesktopShellBootstrapConfig {
    let ritual_env = configured_ritual_env();
    let app_origin = get_app_url();
    let bootstrap_url = build_desktop_bootstrap_url(&app_origin, &ritual_env);
    let callback_url = join_url_path(&app_origin, "/auth/callback");

    DesktopShellBootstrapConfig {
        environment: ritual_env,
        app_origin,
        bootstrap_url,
        callback_url,
    }
}

fn is_supported_desktop_deep_link(raw: &str) -> bool {
    let trimmed = raw.trim();
    trimmed.starts_with("ritual://") || trimmed.starts_with("com.ritual.desktop://")
}

fn focus_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn handle_desktop_auth_deep_link<R: tauri::Runtime>(app: &tauri::AppHandle<R>, raw: String) {
    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        return;
    }
    let redacted_payload = desktop_observability::redact_sensitive_url_for_log(&trimmed);

    if !is_supported_desktop_deep_link(&trimmed) {
        warn!(payload = %redacted_payload, "Ignoring unsupported deep link payload");
        return;
    }

    info!(payload = %redacted_payload, "Desktop deep link received");
    desktop_runtime::emit_auth_deep_link_opened(app, &trimmed);
    focus_main_window(app);
    desktop_runtime::emit_auth_deep_link(app, trimmed);
}

#[tauri::command]
fn get_desktop_shell_bootstrap_config() -> DesktopShellBootstrapConfig {
    build_desktop_shell_bootstrap_config()
}

#[tauri::command]
async fn check_desktop_hosted_app_reachable(url: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(5))
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .map_err(|error| format!("Failed to create hosted app probe client: {error}"))?;

        let response = client
            .get(&url)
            .send()
            .map_err(|error| format!("Failed to reach hosted desktop app: {error}"))?;

        Ok(response.status().is_success() || response.status().is_redirection())
    })
    .await
    .map_err(|error| format!("Hosted desktop reachability task failed: {error}"))?
}

fn should_use_local_shell_window() -> bool {
    !matches!(configured_ritual_env().as_str(), "development" | "dev")
}

fn desktop_shell_window_url() -> Result<tauri::WebviewUrl, std::io::Error> {
    if should_use_local_shell_window() {
        Ok(tauri::WebviewUrl::App("index.html".into()))
    } else {
        let shell_external_url = DESKTOP_SHELL_DEV_URL.parse().map_err(|error| {
            std::io::Error::other(format!("Invalid desktop shell dev URL: {error}"))
        })?;
        Ok(tauri::WebviewUrl::External(shell_external_url))
    }
}

fn env_flag_enabled(name: &str) -> bool {
    env::var(name)
        .map(|v| {
            let value = v.trim().to_ascii_lowercase();
            matches!(value.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
}

fn load_persisted_turso_sync_config() -> PersistedTursoSyncConfigLoadStatus {
    match native_widget::load_turso_sync_config() {
        Ok(Some(config)) => {
            if native_widget::turso_sync_config_is_fresh_enough(&config) {
                native_widget::set_turso_sync_env(Some(&config));
                println!("🔄 Loaded persisted Turso sync config");
                PersistedTursoSyncConfigLoadStatus::LoadedFresh
            } else {
                native_widget::set_turso_sync_env(None);
                println!(
                    "⚠️ Persisted Turso sync config is expired or near expiry; requesting refresh"
                );
                PersistedTursoSyncConfigLoadStatus::ExpiredOrStale
            }
        }
        Ok(None) => {
            println!("📂 No persisted Turso sync config found");
            PersistedTursoSyncConfigLoadStatus::Missing
        }
        Err(error) => {
            eprintln!("⚠️ Failed to load persisted Turso sync config: {}", error);
            native_widget::set_turso_sync_env(None);
            PersistedTursoSyncConfigLoadStatus::Error
        }
    }
}

fn with_query_param(url: &str, query: &str) -> String {
    if url.contains('?') {
        format!("{url}&{query}")
    } else {
        format!("{url}?{query}")
    }
}

fn join_url_path(base: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        path.trim_start_matches('/'),
    )
}

fn shutdown_background_helpers() {
    if let Err(err) = tauri::async_runtime::block_on(watcher::lifecycle::stop_watcher()) {
        eprintln!(
            "⚠️ Failed to stop Ritual Watcher during app shutdown: {}",
            err
        );
    }
}

fn spawn_watcher_watchdog() {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // Skip the immediate bootstrap tick so the watcher can write its first
        // heartbeat/context window before the watchdog evaluates health.
        interval.tick().await;
        loop {
            interval.tick().await;
            match watcher::diagnostics::check_and_restart_watcher_if_hung(60).await {
                Ok(true) => info!("Background watcher watchdog restarted Ritual Watcher"),
                Ok(false) => {}
                Err(e) => warn!(error = %e, "Background watcher watchdog check failed"),
            }
        }
    });
}

const WATCHER_AUTOSTART_SUCCESS_LOG: &str = "Watcher auto-started successfully";

async fn auto_start_watcher_from_config(config: watcher::WatcherConfig) {
    let watcher_start_started_at = Instant::now();
    info!(
        device_id = %config.device_id,
        user_id = %config.user_id,
        "Auto-starting Ritual Watcher"
    );

    if watcher::permissions::check_accessibility_permission() {
        match tauri::async_runtime::spawn_blocking(move || {
            watcher::lifecycle::start_watcher_sync(config)
        })
        .await
        {
            Ok(Ok(status)) => {
                info!(
                    pid = status.pid,
                    duration_ms = watcher_start_started_at.elapsed().as_millis() as u64,
                    "{}",
                    WATCHER_AUTOSTART_SUCCESS_LOG
                );
            }
            Ok(Err(error)) => {
                warn!(
                    error = %error,
                    duration_ms = watcher_start_started_at.elapsed().as_millis() as u64,
                    "Failed to auto-start watcher"
                );
            }
            Err(error) => {
                warn!(
                    error = %error,
                    duration_ms = watcher_start_started_at.elapsed().as_millis() as u64,
                    "Watcher auto-start task failed"
                );
            }
        }
    } else {
        warn!("Watcher auto-start skipped: accessibility permission not granted");
    }
}

fn spawn_background_startup_tasks<R: tauri::Runtime + 'static>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let startup_started_at = Instant::now();
        let mut activity_database_ready = false;

        // Let the webview paint before doing heavier native startup work so the
        // main app finishes launching faster and the Dock icon settles sooner.
        tokio::time::sleep(Duration::from_millis(250)).await;

        let persisted_sync_started_at = Instant::now();
        match tauri::async_runtime::spawn_blocking(load_persisted_turso_sync_config).await {
            Ok(status) => {
                info!(
                    status = ?status,
                    duration_ms = persisted_sync_started_at.elapsed().as_millis() as u64,
                    "Loaded persisted Turso sync config"
                );
                if matches!(
                    status,
                    PersistedTursoSyncConfigLoadStatus::ExpiredOrStale
                        | PersistedTursoSyncConfigLoadStatus::Error
                ) {
                    desktop_runtime::request_token_refresh(&app);
                }
            }
            Err(error) => {
                warn!(
                    error = %error,
                    duration_ms = persisted_sync_started_at.elapsed().as_millis() as u64,
                    "Persisted Turso sync config load task failed"
                );
            }
        }

        let activity_db_init_started_at = Instant::now();
        match tauri::async_runtime::spawn_blocking(|| {
            ritual_database::initialize_activity_database_with_origin("startup:activity")
        })
        .await
        {
            Ok(Ok(())) => {
                activity_database_ready = true;
                info!(
                    duration_ms = activity_db_init_started_at.elapsed().as_millis() as u64,
                    "Ritual activity database ready"
                );
            }
            Ok(Err(error)) => {
                warn!(
                    error = %error,
                    duration_ms = activity_db_init_started_at.elapsed().as_millis() as u64,
                    "Ritual activity database init deferred"
                );
            }
            Err(error) => {
                warn!(
                    error = %error,
                    duration_ms = activity_db_init_started_at.elapsed().as_millis() as u64,
                    "Ritual activity database init task failed"
                );
            }
        }

        if activity_database_ready {
            let historical_import_started_at = Instant::now();
            match tauri::async_runtime::spawn_blocking(|| {
                ritual_database::import_historical_activity_with_origin(
                    "startup:historical-activity",
                )
            })
            .await
            {
                Ok(()) => info!(
                    duration_ms = historical_import_started_at.elapsed().as_millis() as u64,
                    "Historical activity import check completed before watcher start"
                ),
                Err(error) => warn!(
                    error = %error,
                    duration_ms = historical_import_started_at.elapsed().as_millis() as u64,
                    "Historical activity import check task failed before watcher start"
                ),
            }

            cloud_sync::spawn_cloud_sync_worker(app.clone());
        }

        if let Some(config) = read_watcher_config() {
            auto_start_watcher_from_config(config).await;
        }

        spawn_watcher_watchdog();
        desktop_runtime::emit_runtime_state_changed(app.clone());

        let memory_db_init_started_at = Instant::now();
        match tauri::async_runtime::spawn_blocking(|| {
            ritual_database::initialize_memory_database_with_origin("startup:memory")
        })
        .await
        {
            Ok(Ok(())) => {
                info!(
                    duration_ms = memory_db_init_started_at.elapsed().as_millis() as u64,
                    "Ritual memory database ready"
                );
                info!("Project-time attribution is the desktop computer activity cloud path");
                ritual_database::spawn_project_time_attribution_worker();
            }
            Ok(Err(error)) => {
                warn!(
                    error = %error,
                    duration_ms = memory_db_init_started_at.elapsed().as_millis() as u64,
                    "Ritual memory database init deferred"
                );
            }
            Err(error) => {
                warn!(
                    error = %error,
                    duration_ms = memory_db_init_started_at.elapsed().as_millis() as u64,
                    "Ritual memory database init task failed"
                );
            }
        }

        desktop_runtime::emit_runtime_state_changed(app);
        info!(
            duration_ms = startup_started_at.elapsed().as_millis() as u64,
            "Desktop background startup completed"
        );
    });
}

#[cfg(test)]
mod startup_tests {
    use super::*;

    #[test]
    fn watcher_config_startup_has_assertable_success_log() {
        let watcher_config_exists = true;
        let expected_log = watcher_config_exists.then_some(WATCHER_AUTOSTART_SUCCESS_LOG);

        assert_eq!(expected_log, Some("Watcher auto-started successfully"));
    }
}

#[cfg(target_os = "macos")]
unsafe fn set_macos_layer_corner_radius(
    layer: cocoa::base::id,
    radius: f64,
    masks_to_bounds: bool,
) {
    use cocoa::base::{nil, NO, YES};
    use cocoa::foundation::NSString;
    use objc::runtime::BOOL;
    use objc::{msg_send, sel, sel_impl};

    if layer.is_null() {
        return;
    }

    let _: () = msg_send![layer, setCornerRadius: radius];
    if masks_to_bounds {
        let _: () = msg_send![layer, setMasksToBounds: YES];
    }

    let supports_continuous_curve: BOOL =
        msg_send![layer, respondsToSelector: sel!(setCornerCurve:)];
    if supports_continuous_curve != NO {
        let continuous = NSString::alloc(nil).init_str("continuous");
        let _: () = msg_send![layer, setCornerCurve: continuous];
    }
}

#[cfg(target_os = "macos")]
unsafe fn clip_macos_view_to_native_radius(view: cocoa::base::id, corner_radius: f64) {
    use cocoa::base::{id, NO, YES};
    use objc::runtime::BOOL;
    use objc::{msg_send, sel, sel_impl};

    if view.is_null() {
        return;
    }

    let supports_wants_layer: BOOL = msg_send![view, respondsToSelector: sel!(setWantsLayer:)];
    if supports_wants_layer != NO {
        let _: () = msg_send![view, setWantsLayer: YES];
    }

    let supports_layer: BOOL = msg_send![view, respondsToSelector: sel!(layer)];
    if supports_layer == NO {
        return;
    }

    let layer: id = msg_send![view, layer];
    set_macos_layer_corner_radius(layer, corner_radius, true);
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn configure_macos_window_chrome(window: &tauri::WebviewWindow, corner_radius: f64) {
    use cocoa::base::{id, NO, YES};
    use objc::{msg_send, sel, sel_impl};

    match window.ns_window() {
        Ok(raw_window) => unsafe {
            let ns_win: id = raw_window as id;

            let _: () = msg_send![ns_win, setHasShadow: YES];
            let _: () = msg_send![ns_win, setMovableByWindowBackground: NO];
            let _: () = msg_send![ns_win, setTitlebarAppearsTransparent: YES];
            let _: () = msg_send![ns_win, setTitleVisibility: 1_isize];
            let content_view: id = msg_send![ns_win, contentView];
            clip_macos_view_to_native_radius(content_view, corner_radius);

            println!("✅ NSWindow native chrome tuned (corner_radius={corner_radius})");
        },
        Err(e) => eprintln!("❌ NSWindow handle not available for chrome tuning: {e}"),
    }
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn configure_macos_native_window_chrome(window: &tauri::WebviewWindow) {
    configure_macos_window_chrome(window, MACOS_NATIVE_WINDOW_CORNER_RADIUS);
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn configure_macos_settings_window_chrome(window: &tauri::WebviewWindow) {
    configure_macos_window_chrome(window, MACOS_SETTINGS_WINDOW_CORNER_RADIUS);
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn configure_macos_sidebar_titlebar_glass(window: &tauri::WebviewWindow) {
    use cocoa::base::id;
    use objc::{msg_send, sel, sel_impl};
    use window_vibrancy::{apply_liquid_glass, NSGlassEffectViewStyle};

    println!("🔧 Configuring macOS sidebar/titlebar glass behind native window chrome…");

    match window.ns_window() {
        Ok(raw_window) => unsafe {
            let ns_win: id = raw_window as id;
            let content_view: id = msg_send![ns_win, contentView];
            clip_macos_view_to_native_radius(content_view, MACOS_NATIVE_WINDOW_CORNER_RADIUS);
            println!("✅ NSWindow kept native/opaque; rounded content clipping configured");
        },
        Err(e) => eprintln!("❌ NSWindow handle not available for glass setup: {e}"),
    }

    match apply_liquid_glass(window, NSGlassEffectViewStyle::Sidebar, None, None) {
        Ok(()) => println!("✅ Apple Liquid Glass applied behind rounded native window content"),
        Err(e) => {
            println!("⚠️ Liquid Glass unavailable ({e:?}), falling back to vibrancy");
            apply_vibrancy_fallback(window);
        }
    }
}

/// Fallback for macOS < 26: use traditional NSVisualEffectView vibrancy
#[cfg(target_os = "macos")]
fn apply_vibrancy_fallback(window: &tauri::WebviewWindow) {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

    match apply_vibrancy(
        window,
        NSVisualEffectMaterial::Sidebar,
        Some(NSVisualEffectState::Active),
        Some(MACOS_NATIVE_WINDOW_CORNER_RADIUS),
    ) {
        Ok(()) => println!(
            "✅ Fallback: NSVisualEffectView vibrancy applied (Sidebar material + rounded radius)"
        ),
        Err(e) => eprintln!("❌ Fallback vibrancy also failed: {e:?}"),
    }
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn configure_macos_webview_transparency(window: &tauri::WebviewWindow) {
    use cocoa::appkit::NSColor;
    use cocoa::base::{id, nil, NO, YES};
    use cocoa::foundation::NSString;
    use objc::runtime::BOOL;
    use objc::{class, msg_send, sel, sel_impl};

    /// Recursively clear background on a view and all its subviews/layers.
    unsafe fn clear_view_tree(view: id, depth: usize) {
        if view.is_null() {
            return;
        }
        let prefix = "  ".repeat(depth);
        let cls: id = msg_send![view, class];
        let cls_name: id = msg_send![cls, className];
        let name_cstr: *const std::ffi::c_char = msg_send![cls_name, UTF8String];
        let name = if name_cstr.is_null() {
            "<unknown>".to_string()
        } else {
            std::ffi::CStr::from_ptr(name_cstr)
                .to_string_lossy()
                .to_string()
        };

        // Make the view itself non-opaque
        let responds_opaque: BOOL = msg_send![view, respondsToSelector: sel!(setOpaque:)];
        if responds_opaque != NO {
            let _: () = msg_send![view, setOpaque: NO];
        }

        // Clear background color if the view supports it
        let responds_bg: BOOL = msg_send![view, respondsToSelector: sel!(setBackgroundColor:)];
        if responds_bg != NO {
            let clear = NSColor::clearColor(nil);
            let _: () = msg_send![view, setBackgroundColor: clear];
        }

        // Clear drawsBackground via KVC if available
        let draws_bg_key = NSString::alloc(nil).init_str("drawsBackground");
        // Use @try equivalent: check via valueForKey first
        let responds_draws: BOOL = msg_send![view, respondsToSelector: sel!(setDrawsBackground:)];
        if responds_draws != NO {
            let _: () = msg_send![view, setDrawsBackground: NO];
        }

        // Make the layer transparent
        let has_layer: BOOL = msg_send![view, respondsToSelector: sel!(layer)];
        if has_layer != NO {
            let layer: id = msg_send![view, layer];
            if !layer.is_null() {
                let _: () = msg_send![layer, setOpaque: NO];
                let cg_clear: id = msg_send![class!(NSColor), clearColor];
                let cg_color: id = msg_send![cg_clear, CGColor];
                let _: () = msg_send![layer, setBackgroundColor: cg_color];
            }
        }

        println!("  {prefix}🔍 Cleared: {name}");
        let _ = draws_bg_key; // prevent unused warning

        // Recurse into subviews
        let responds_subviews: BOOL = msg_send![view, respondsToSelector: sel!(subviews)];
        if responds_subviews != NO {
            let subviews: id = msg_send![view, subviews];
            if !subviews.is_null() {
                let count: usize = msg_send![subviews, count];
                for i in 0..count {
                    let child: id = msg_send![subviews, objectAtIndex: i];
                    clear_view_tree(child, depth + 1);
                }
            }
        }
    }

    let result = window.with_webview(|webview| {
        let guarded = std::panic::catch_unwind(|| unsafe {
            let wk = webview.inner() as id;
            if wk.is_null() {
                eprintln!("❌ WKWebView handle is null");
                return;
            }

            // 1. Mark the WKWebView as non-opaque and clear its background color.
            let _: () = msg_send![wk, setOpaque: NO];
            let clear = NSColor::clearColor(nil);
            let _: () = msg_send![wk, setBackgroundColor: clear];
            println!("✅ WKWebView setOpaque(NO) + clearColor applied");

            // 2. Disable drawsBackground via KVC (Key-Value Coding).
            let key = NSString::alloc(nil).init_str("drawsBackground");
            let no_val: id = msg_send![class!(NSNumber), numberWithBool: NO];
            let _: () = msg_send![wk, setValue: no_val forKey: key];

            // Verify the value actually stuck.
            let readback: id = msg_send![wk, valueForKey: key];
            let readback_bool: BOOL = msg_send![readback, boolValue];
            if readback_bool == NO {
                println!("✅ WKWebView drawsBackground=NO via KVC (verified)");
            } else {
                eprintln!("❌ WKWebView drawsBackground KVC set did NOT stick (still YES)");
            }

            // 3. Set underPageBackgroundColor to clear (public API, macOS 12+).
            let has_under_page: BOOL =
                msg_send![wk, respondsToSelector: sel!(setUnderPageBackgroundColor:)];
            if has_under_page != NO {
                let _: () = msg_send![wk, setUnderPageBackgroundColor: clear];
                println!("✅ WKWebView underPageBackgroundColor set to clear");
            } else {
                eprintln!("⚠️ WKWebView does not respond to setUnderPageBackgroundColor:");
            }

            // 4. Try the underscore-prefixed private API as a fallback.
            let has_private: BOOL = msg_send![wk, respondsToSelector: sel!(_setDrawsBackground:)];
            if has_private != NO {
                let _: () = msg_send![wk, _setDrawsBackground: NO];
                println!("✅ WKWebView _setDrawsBackground(NO) applied");
            }

            // 5. Nuclear: make the WKWebView's own layer transparent.
            let _: () = msg_send![wk, setWantsLayer: YES];
            let wk_layer: id = msg_send![wk, layer];
            if !wk_layer.is_null() {
                let _: () = msg_send![wk_layer, setOpaque: NO];
                let cg_clear = NSColor::clearColor(nil);
                let cg_color: id = msg_send![cg_clear, CGColor];
                let _: () = msg_send![wk_layer, setBackgroundColor: cg_color];
                set_macos_layer_corner_radius(wk_layer, MACOS_NATIVE_WINDOW_CORNER_RADIUS, true);
                println!("✅ WKWebView layer set to non-opaque + clear");
            }

            // 6. Traverse ALL subviews of the WKWebView and clear their backgrounds/layers.
            println!("🔍 Traversing WKWebView subview tree:");
            let subviews: id = msg_send![wk, subviews];
            if !subviews.is_null() {
                let count: usize = msg_send![subviews, count];
                println!("  Found {count} direct subviews");
                for i in 0..count {
                    let child: id = msg_send![subviews, objectAtIndex: i];
                    clear_view_tree(child, 1);
                }
            }

            // 7. Also clear the WKWebView's superview (wry container) if present.
            let superview: id = msg_send![wk, superview];
            if !superview.is_null() {
                let _: () = msg_send![superview, setOpaque: NO];
                let responds_bg: BOOL =
                    msg_send![superview, respondsToSelector: sel!(setBackgroundColor:)];
                if responds_bg != NO {
                    let _: () = msg_send![superview, setBackgroundColor: clear];
                }
                let _: () = msg_send![superview, setWantsLayer: YES];
                let sv_layer: id = msg_send![superview, layer];
                if !sv_layer.is_null() {
                    let _: () = msg_send![sv_layer, setOpaque: NO];
                    let cg_clear = NSColor::clearColor(nil);
                    let cg_color: id = msg_send![cg_clear, CGColor];
                    let _: () = msg_send![sv_layer, setBackgroundColor: cg_color];
                }
                let cls: id = msg_send![superview, class];
                let cls_name: id = msg_send![cls, className];
                let name_cstr: *const std::ffi::c_char = msg_send![cls_name, UTF8String];
                let name = if name_cstr.is_null() {
                    "<unknown>".to_string()
                } else {
                    std::ffi::CStr::from_ptr(name_cstr)
                        .to_string_lossy()
                        .to_string()
                };
                println!("✅ Superview ({name}) cleared");
            }

            println!("✅ WKWebView transparency fully configured (nuclear pass complete)");
        });

        if guarded.is_err() {
            eprintln!("❌ WKWebView transparency configuration panicked");
        }
    });

    if let Err(e) = result {
        eprintln!("❌ Failed to access WKWebView handle: {e}");
    }
}

fn normalize_nav_path(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{}", path)
    }
}

#[derive(Default)]
struct SidebarWindowState {
    width: Mutex<f64>,
    detached_enabled: Mutex<bool>,
}

impl SidebarWindowState {
    fn get_width(&self) -> f64 {
        let lock = self.width.lock().unwrap();
        if *lock <= 0.0 {
            70.0
        } else {
            *lock
        }
    }

    fn set_width(&self, width: f64) -> f64 {
        let clamped = width.clamp(70.0, 240.0);
        let mut lock = self.width.lock().unwrap();
        *lock = clamped;
        clamped
    }

    fn is_detached_enabled(&self) -> bool {
        *self.detached_enabled.lock().unwrap()
    }

    fn set_detached_enabled(&self, enabled: bool) {
        let mut lock = self.detached_enabled.lock().unwrap();
        *lock = enabled;
    }
}

#[cfg(target_os = "macos")]
fn sync_detached_sidebar_window(app: &tauri::AppHandle, width: f64) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let sidebar = app
        .get_webview_window("sidebar")
        .ok_or_else(|| "Sidebar window not found".to_string())?;

    let main_pos = main
        .outer_position()
        .map_err(|e| format!("Failed to read main window position: {e}"))?;
    let main_size = main
        .outer_size()
        .map_err(|e| format!("Failed to read main window size: {e}"))?;

    let sidebar_width = width.clamp(70.0, 240.0).round() as u32;
    let _ = sidebar.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
        x: main_pos.x,
        y: main_pos.y,
    }));
    let _ = sidebar.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: sidebar_width,
        height: main_size.height,
    }));

    Ok(())
}

#[cfg(target_os = "macos")]
fn ensure_detached_sidebar_window(
    app: &tauri::AppHandle,
    app_url: &str,
    width: f64,
) -> Result<(), String> {
    let sidebar_url = with_query_param(
        &format!("{}/sidebar", app_url.trim_end_matches('/')),
        "ritual_sidebar_window=1",
    );

    if app.get_webview_window("sidebar").is_none() {
        let sidebar_external_url = sidebar_url
            .parse()
            .map_err(|e| format!("Invalid sidebar URL: {e}"))?;

        tauri::WebviewWindowBuilder::new(
            app,
            "sidebar",
            tauri::WebviewUrl::External(sidebar_external_url),
        )
        .user_agent(DESKTOP_WEBVIEW_USER_AGENT)
        .title("")
        .decorations(false)
        .transparent(true)
        .visible(true)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .build()
        .map_err(|e| format!("Failed to create detached sidebar window: {e}"))?;
    } else if let Some(sidebar) = app.get_webview_window("sidebar") {
        let sidebar_url_json = serde_json::to_string(&sidebar_url)
            .unwrap_or_else(|_| "\"http://localhost:3000/sidebar\"".to_string());
        let _ = sidebar.eval(&format!("window.location.replace({});", sidebar_url_json));
    }

    if let Some(sidebar) = app.get_webview_window("sidebar") {
        configure_macos_sidebar_titlebar_glass(&sidebar);
        let _ = sidebar.set_always_on_top(false);
    }
    sync_detached_sidebar_window(app, width)?;

    Ok(())
}

#[tauri::command]
fn sidebar_set_width(
    app: tauri::AppHandle,
    state: tauri::State<SidebarWindowState>,
    width: f64,
) -> Result<(), String> {
    let width = state.set_width(width);
    #[cfg(target_os = "macos")]
    {
        if state.is_detached_enabled() {
            let _ = sync_detached_sidebar_window(&app, width);
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit("sidebar:width", width);
    }
    Ok(())
}

#[tauri::command]
fn sidebar_navigate(
    app: tauri::AppHandle,
    state: tauri::State<SidebarWindowState>,
    path: String,
) -> Result<(), String> {
    let mut target = normalize_nav_path(&path);
    if state.is_detached_enabled() {
        target = with_query_param(&target, "ritual_detached_sidebar=1");
    }

    let target_json = serde_json::to_string(&target)
        .map_err(|e| format!("Failed to serialize target path: {e}"))?;
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    main.eval(&format!("window.location.replace({});", target_json))
        .map_err(|e| format!("Failed to navigate main window: {e}"))?;
    if let Some(sidebar) = app.get_webview_window("sidebar") {
        let _ = sidebar.emit("sidebar:route", target);
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct SidebarMainState {
    path: String,
    width: f64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsWindowPayload {
    initial_view: String,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceHotkeySettings {
    enabled: bool,
    shortcut: String,
    #[serde(default)]
    registered: bool,
    #[serde(default)]
    registration_error: Option<String>,
}

impl Default for VoiceHotkeySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            shortcut: DEFAULT_VOICE_SHORTCUT.to_string(),
            registered: false,
            registration_error: None,
        }
    }
}

#[derive(Default)]
struct VoiceHotkeyState {
    inner: Mutex<VoiceHotkeySettings>,
}

#[derive(Default)]
struct VoiceHudRuntimeState {
    active: Mutex<bool>,
    helper: Mutex<Option<VoiceHudHelperSession>>,
}

impl VoiceHudRuntimeState {
    fn set_active(&self, active: bool) {
        if let Ok(mut guard) = self.active.lock() {
            *guard = active;
        }
    }

    fn is_active(&self) -> bool {
        self.active.lock().map(|guard| *guard).unwrap_or(false)
    }

    fn set_helper(&self, helper: Option<VoiceHudHelperSession>) {
        if let Ok(mut guard) = self.helper.lock() {
            *guard = helper;
        }
    }

    fn helper(&self) -> Option<VoiceHudHelperSession> {
        self.helper.lock().ok().and_then(|guard| guard.clone())
    }
}

#[derive(Clone, Debug)]
struct VoiceHudHelperSession {
    session_id: String,
    state_path: PathBuf,
    command_dir: PathBuf,
    status_path: PathBuf,
    log_path: PathBuf,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceSessionStartPayload {
    session_id: String,
    target: String,
    source: String,
    submit_on_final: bool,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceHotkeyOpenPayload {
    source: String,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceHudVisualState {
    session_id: String,
    #[serde(default)]
    is_listening: bool,
    #[serde(default)]
    is_processing_voice: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    partial_transcript: Option<String>,
}

const SETTINGS_WINDOW_WIDTH: f64 = 820.0;
const SETTINGS_WINDOW_HEIGHT: f64 = 580.0;
const SETTINGS_WINDOW_MIN_WIDTH: f64 = 720.0;
const SETTINGS_WINDOW_MIN_HEIGHT: f64 = 500.0;

fn ritual_config_dir() -> Result<std::path::PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or_else(|| "Home directory is unavailable".to_string())?
        .join(".ritual");
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create Ritual config directory: {error}"))?;
    Ok(dir)
}

fn voice_hotkey_settings_path() -> Result<std::path::PathBuf, String> {
    Ok(ritual_config_dir()?.join(VOICE_HOTKEY_SETTINGS_FILE))
}

fn sanitize_voice_hotkey_settings(mut settings: VoiceHotkeySettings) -> VoiceHotkeySettings {
    if settings.shortcut.trim().is_empty() {
        settings.shortcut = DEFAULT_VOICE_SHORTCUT.to_string();
    }
    settings.shortcut = canonical_voice_shortcut_label(&settings.shortcut)
        .unwrap_or_else(|| settings.shortcut.trim().to_string());
    settings.registered = false;
    settings.registration_error = None;
    settings
}

fn load_voice_hotkey_settings() -> VoiceHotkeySettings {
    let Ok(path) = voice_hotkey_settings_path() else {
        return VoiceHotkeySettings::default();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return VoiceHotkeySettings::default();
    };
    serde_json::from_str::<VoiceHotkeySettings>(&raw)
        .map(sanitize_voice_hotkey_settings)
        .unwrap_or_default()
}

fn persist_voice_hotkey_settings(settings: &VoiceHotkeySettings) -> Result<(), String> {
    let path = voice_hotkey_settings_path()?;
    let mut persisted = settings.clone();
    persisted.registered = false;
    persisted.registration_error = None;
    let raw = serde_json::to_string_pretty(&persisted)
        .map_err(|error| format!("Failed to serialize voice hotkey settings: {error}"))?;
    std::fs::write(path, raw)
        .map_err(|error| format!("Failed to save voice hotkey settings: {error}"))
}

fn canonical_voice_shortcut_label(raw: &str) -> Option<String> {
    let shortcut = raw.trim();
    if shortcut.is_empty() {
        return None;
    }

    let mut parts: Vec<String> = Vec::new();
    let mut key: Option<String> = None;

    for token in shortcut.split('+') {
        let normalized = token.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "alt" | "option" | "opt" => {
                if !parts.iter().any(|part| part == "Alt") {
                    parts.push("Alt".to_string());
                }
            }
            "control" | "ctrl" => {
                if !parts.iter().any(|part| part == "Control") {
                    parts.push("Control".to_string());
                }
            }
            "command" | "cmd" | "meta" | "super" => {
                if !parts.iter().any(|part| part == "Command") {
                    parts.push("Command".to_string());
                }
            }
            "shift" => {
                if !parts.iter().any(|part| part == "Shift") {
                    parts.push("Shift".to_string());
                }
            }
            "space" => key = Some("Space".to_string()),
            "enter" | "return" => key = Some("Enter".to_string()),
            "tab" => key = Some("Tab".to_string()),
            value if value.len() == 1 => key = Some(value.to_ascii_uppercase()),
            value if value.starts_with("key") && value.len() == 4 => {
                key = Some(value[3..].to_ascii_uppercase());
            }
            value if value.starts_with("digit") && value.len() == 6 => {
                key = Some(value[5..].to_string());
            }
            _ => {}
        }
    }

    let key = key?;
    if parts.is_empty() {
        return None;
    }
    parts.push(key);
    Some(parts.join("+"))
}

fn parse_voice_shortcut(raw: &str) -> Result<Shortcut, String> {
    let shortcut = raw.trim();
    if shortcut.is_empty() {
        return Err("Shortcut cannot be empty.".to_string());
    }

    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;

    for token in shortcut.split('+') {
        let normalized = token.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "alt" | "option" | "opt" => modifiers.insert(Modifiers::ALT),
            "control" | "ctrl" => modifiers.insert(Modifiers::CONTROL),
            "command" | "cmd" | "meta" | "super" => modifiers.insert(Modifiers::SUPER),
            "shift" => modifiers.insert(Modifiers::SHIFT),
            "space" => code = Some(Code::Space),
            "enter" | "return" => code = Some(Code::Enter),
            "tab" => code = Some(Code::Tab),
            value => {
                if let Some(next_code) = parse_voice_shortcut_key_code(value) {
                    code = Some(next_code);
                }
            }
        }
    }

    if modifiers.is_empty() {
        return Err("Shortcut must include at least one modifier.".to_string());
    }

    let code = code.ok_or_else(|| "Shortcut must include a key.".to_string())?;
    Ok(Shortcut::new(Some(modifiers), code))
}

fn parse_voice_shortcut_key_code(value: &str) -> Option<Code> {
    let key = value
        .strip_prefix("key")
        .or_else(|| value.strip_prefix("digit"))
        .unwrap_or(value)
        .to_ascii_uppercase();

    match key.as_str() {
        "A" => Some(Code::KeyA),
        "B" => Some(Code::KeyB),
        "C" => Some(Code::KeyC),
        "D" => Some(Code::KeyD),
        "E" => Some(Code::KeyE),
        "F" => Some(Code::KeyF),
        "G" => Some(Code::KeyG),
        "H" => Some(Code::KeyH),
        "I" => Some(Code::KeyI),
        "J" => Some(Code::KeyJ),
        "K" => Some(Code::KeyK),
        "L" => Some(Code::KeyL),
        "M" => Some(Code::KeyM),
        "N" => Some(Code::KeyN),
        "O" => Some(Code::KeyO),
        "P" => Some(Code::KeyP),
        "Q" => Some(Code::KeyQ),
        "R" => Some(Code::KeyR),
        "S" => Some(Code::KeyS),
        "T" => Some(Code::KeyT),
        "U" => Some(Code::KeyU),
        "V" => Some(Code::KeyV),
        "W" => Some(Code::KeyW),
        "X" => Some(Code::KeyX),
        "Y" => Some(Code::KeyY),
        "Z" => Some(Code::KeyZ),
        "0" => Some(Code::Digit0),
        "1" => Some(Code::Digit1),
        "2" => Some(Code::Digit2),
        "3" => Some(Code::Digit3),
        "4" => Some(Code::Digit4),
        "5" => Some(Code::Digit5),
        "6" => Some(Code::Digit6),
        "7" => Some(Code::Digit7),
        "8" => Some(Code::Digit8),
        "9" => Some(Code::Digit9),
        _ => None,
    }
}

fn register_voice_hotkey(
    app: &tauri::AppHandle,
    state: tauri::State<VoiceHotkeyState>,
    settings: VoiceHotkeySettings,
) -> VoiceHotkeySettings {
    let mut next = sanitize_voice_hotkey_settings(settings);
    if let Err(error) = app.global_shortcut().unregister_all() {
        warn!(error = %error, "Failed to unregister previous voice shortcut");
    }

    if !next.enabled {
        let mut guard = state.inner.lock().expect("voice hotkey state poisoned");
        *guard = next.clone();
        return next;
    }

    match parse_voice_shortcut(&next.shortcut).and_then(|shortcut| {
        app.global_shortcut()
            .register(shortcut)
            .map_err(|error| format!("Failed to register shortcut: {error}"))
    }) {
        Ok(()) => {
            next.registered = true;
            next.registration_error = None;
        }
        Err(error) => {
            next.registered = false;
            next.registration_error = Some(error);
        }
    }

    let mut guard = state.inner.lock().expect("voice hotkey state poisoned");
    *guard = next.clone();
    next
}

fn initialize_voice_hotkey(app: &tauri::AppHandle) {
    let settings = load_voice_hotkey_settings();
    let state = app.state::<VoiceHotkeyState>();
    let registered = register_voice_hotkey(app, state, settings);
    if let Some(error) = &registered.registration_error {
        warn!(error = %error, shortcut = %registered.shortcut, "Voice shortcut registration failed");
    } else if registered.enabled {
        info!(shortcut = %registered.shortcut, "Voice shortcut registered");
    }
}

fn normalize_voice_target(target: String) -> String {
    match target.as_str() {
        "habit-log" | "chat-query" => target,
        _ => "chat-query".to_string(),
    }
}

fn normalize_voice_source(source: Option<String>) -> String {
    match source.as_deref().unwrap_or("composer") {
        "hotkey" => "hotkey".to_string(),
        _ => "composer".to_string(),
    }
}

fn build_voice_session_payload(
    target: String,
    source: Option<String>,
    submit_on_final: Option<bool>,
) -> VoiceSessionStartPayload {
    let timestamp = chrono::Utc::now().timestamp_millis();
    VoiceSessionStartPayload {
        session_id: format!("voice-{timestamp}"),
        target: normalize_voice_target(target),
        source: normalize_voice_source(source),
        submit_on_final: submit_on_final.unwrap_or(false),
    }
}

fn build_voice_hud_url(payload: &VoiceSessionStartPayload) -> String {
    let ritual_env = configured_ritual_env();
    let app_origin = get_app_url();
    let mut url = join_url_path(&app_origin, "/voice-hud");
    url = with_query_param(&url, "ritual_voice_hud_window=1");
    url = with_query_param(&url, "ritual_native_voice_hud=1");
    url = with_query_param(&url, &format!("ritual_desktop_env={ritual_env}"));
    url = with_query_param(
        &url,
        &format!("sessionId={}", urlencoding::encode(&payload.session_id)),
    );
    url = with_query_param(
        &url,
        &format!("target={}", urlencoding::encode(&payload.target)),
    );
    with_query_param(
        &url,
        &format!("source={}", urlencoding::encode(&payload.source)),
    )
}

fn initial_voice_hud_visual_state(payload: &VoiceSessionStartPayload) -> VoiceHudVisualState {
    VoiceHudVisualState {
        session_id: payload.session_id.clone(),
        is_listening: true,
        is_processing_voice: false,
        error: None,
        partial_transcript: None,
    }
}

#[cfg(target_os = "macos")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceHudHelperStatus {
    session_id: String,
    event: String,
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
fn voice_hud_helper_available_at(helper_app: &Path) -> bool {
    helper_app
        .join("Contents")
        .join("MacOS")
        .join(VOICE_HUD_HELPER_EXECUTABLE)
        .is_file()
}

#[cfg(target_os = "macos")]
fn voice_hud_helper_app_path() -> PathBuf {
    let dev_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .join(".tauri-helper")
        .join(VOICE_HUD_HELPER_APP_NAME);
    if voice_hud_helper_available_at(&dev_path) {
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
                .join(VOICE_HUD_HELPER_APP_NAME);
            if voice_hud_helper_available_at(&resource_path) {
                return resource_path;
            }
        }
    }

    dev_path
}

#[cfg(target_os = "macos")]
fn voice_hud_helper_temp_dir(session_id: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir()
        .join("ritual-voice-hud")
        .join(session_id);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create voice HUD helper temp directory: {error}"))?;
    Ok(dir)
}

#[cfg(target_os = "macos")]
fn write_voice_hud_helper_state(
    session: &VoiceHudHelperSession,
    state: &VoiceHudVisualState,
) -> Result<(), String> {
    let json = serde_json::to_string(state)
        .map_err(|error| format!("Failed to serialize native voice HUD state: {error}"))?;
    std::fs::write(&session.state_path, json)
        .map_err(|error| format!("Failed to write native voice HUD state: {error}"))
}

#[cfg(target_os = "macos")]
fn read_voice_hud_helper_status(path: &Path) -> Option<VoiceHudHelperStatus> {
    let data = std::fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

#[cfg(target_os = "macos")]
fn wait_for_voice_hud_helper_shown(session: &VoiceHudHelperSession) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(2) {
        if let Some(status) = read_voice_hud_helper_status(&session.status_path) {
            if status.session_id == session.session_id
                && status.event == "shown"
                && status.width >= 400.0
                && status.height >= 100.0
            {
                return true;
            }
        }
        thread::sleep(Duration::from_millis(40));
    }
    false
}

#[cfg(target_os = "macos")]
fn create_voice_hud_helper_session(
    payload: &VoiceSessionStartPayload,
    state: &VoiceHudVisualState,
) -> Result<VoiceHudHelperSession, String> {
    let dir = voice_hud_helper_temp_dir(&payload.session_id)?;
    let command_dir = dir.join("commands");
    std::fs::create_dir_all(&command_dir)
        .map_err(|error| format!("Failed to create voice HUD command directory: {error}"))?;
    let session = VoiceHudHelperSession {
        session_id: payload.session_id.clone(),
        state_path: dir.join("state.json"),
        command_dir,
        status_path: dir.join("status.json"),
        log_path: dir.join("helper.log"),
    };
    let _ = std::fs::remove_file(&session.status_path);
    let _ = std::fs::remove_file(session.command_dir.join("stop"));
    let _ = std::fs::remove_file(session.command_dir.join("cancel"));
    let _ = std::fs::remove_file(session.command_dir.join("quit"));
    write_voice_hud_helper_state(&session, state)?;
    Ok(session)
}

#[cfg(target_os = "macos")]
fn launch_voice_hud_helper(session: &VoiceHudHelperSession) -> Result<(), String> {
    let helper_app = voice_hud_helper_app_path();
    if !voice_hud_helper_available_at(&helper_app) {
        return Err(format!(
            "Voice HUD helper is not bundled at {}",
            helper_app.display()
        ));
    }

    let status = Command::new("/usr/bin/open")
        .arg("-n")
        .arg(&helper_app)
        .arg("--args")
        .arg("--session")
        .arg(&session.session_id)
        .arg("--state")
        .arg(&session.state_path)
        .arg("--command-dir")
        .arg(&session.command_dir)
        .arg("--status")
        .arg(&session.status_path)
        .arg("--log")
        .arg(&session.log_path)
        .status()
        .map_err(|error| format!("Failed to launch voice HUD helper: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("Voice HUD helper launch failed: {status}"))
    }
}

#[cfg(target_os = "macos")]
fn emit_voice_hud_control_event_with_retry(app: &tauri::AppHandle, event: &str) {
    for _ in 0..30 {
        if emit_voice_hud_control_event(app, event) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(target_os = "macos")]
fn spawn_voice_hud_command_monitor(app: tauri::AppHandle, session: VoiceHudHelperSession) {
    thread::spawn(move || {
        let stop_path = session.command_dir.join("stop");
        let cancel_path = session.command_dir.join("cancel");
        loop {
            let still_current = app
                .try_state::<VoiceHudRuntimeState>()
                .and_then(|state| state.helper())
                .is_some_and(|helper| helper.session_id == session.session_id);
            if !still_current {
                break;
            }

            if stop_path.exists() {
                let _ = std::fs::remove_file(&stop_path);
                emit_voice_hud_control_event_with_retry(&app, VOICE_EVENTS_STOP_REQUEST);
            }

            if cancel_path.exists() {
                let _ = std::fs::remove_file(&cancel_path);
                emit_voice_hud_control_event_with_retry(&app, VOICE_EVENTS_CANCEL_REQUEST);
            }

            thread::sleep(Duration::from_millis(50));
        }
    });
}

#[cfg(target_os = "macos")]
fn show_native_voice_hud(app: &tauri::AppHandle, payload: &VoiceSessionStartPayload) -> bool {
    let state = initial_voice_hud_visual_state(payload);
    let session = match create_voice_hud_helper_session(payload, &state) {
        Ok(session) => session,
        Err(error) => {
            warn!(error = %error, "Failed to prepare native voice HUD helper");
            return false;
        }
    };

    if let Err(error) = launch_voice_hud_helper(&session) {
        warn!(error = %error, "Failed to launch native voice HUD helper");
        return false;
    }

    if !wait_for_voice_hud_helper_shown(&session) {
        warn!("Native voice HUD helper did not report visible bounds; falling back to web HUD");
        let _ = std::fs::write(session.command_dir.join("quit"), "");
        return false;
    }

    app.state::<VoiceHudRuntimeState>()
        .set_helper(Some(session.clone()));
    spawn_voice_hud_command_monitor(app.clone(), session);
    true
}

#[cfg(not(target_os = "macos"))]
fn show_native_voice_hud(_app: &tauri::AppHandle, _payload: &VoiceSessionStartPayload) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn update_native_voice_hud(app: &tauri::AppHandle, state: &VoiceHudVisualState) -> bool {
    let Some(session) = app.state::<VoiceHudRuntimeState>().helper() else {
        return false;
    };
    if session.session_id != state.session_id {
        return false;
    }
    if let Err(error) = write_voice_hud_helper_state(&session, state) {
        warn!(error = %error, "Failed to update native voice HUD helper");
        return false;
    }
    true
}

#[cfg(not(target_os = "macos"))]
fn update_native_voice_hud(_app: &tauri::AppHandle, _state: &VoiceHudVisualState) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn hide_native_voice_hud(app: &tauri::AppHandle) {
    if let Some(session) = app.state::<VoiceHudRuntimeState>().helper() {
        let _ = std::fs::write(session.command_dir.join("quit"), "");
    }
    app.state::<VoiceHudRuntimeState>().set_helper(None);
}

#[cfg(not(target_os = "macos"))]
fn hide_native_voice_hud(_app: &tauri::AppHandle) {}

fn emit_voice_hud_control_event(app: &tauri::AppHandle, event: &str) -> bool {
    if let Some(window) = app.get_webview_window("voice-hud") {
        let _ = window.emit(event, ());
        return true;
    }
    false
}

fn resize_voice_hud_window(window: &tauri::WebviewWindow) {
    let size = tauri::Size::Logical(tauri::LogicalSize {
        width: VOICE_HUD_WINDOW_WIDTH,
        height: VOICE_HUD_WINDOW_HEIGHT,
    });
    let _ = window.set_size(size);
}

fn show_voice_hud_window(
    app: &tauri::AppHandle,
    payload: VoiceSessionStartPayload,
) -> Result<VoiceSessionStartPayload, String> {
    let native_hud_shown = show_native_voice_hud(app, &payload);
    app.state::<VoiceHudRuntimeState>()
        .set_active(native_hud_shown);

    if let Some(window) = app.get_webview_window("voice-hud") {
        resize_voice_hud_window(&window);
        if native_hud_shown {
            let _ = window.hide();
        } else {
            let _ = window.center();
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let _ = window.emit(VOICE_EVENTS_START, payload.clone());
        return Ok(payload);
    }

    let url = build_voice_hud_url(&payload);
    let external_url = url
        .parse()
        .map_err(|error| format!("Invalid voice HUD URL: {error}"))?;

    let window = tauri::WebviewWindowBuilder::new(
        app,
        "voice-hud",
        tauri::WebviewUrl::External(external_url),
    )
    .user_agent(DESKTOP_WEBVIEW_USER_AGENT)
    .title("")
    .inner_size(VOICE_HUD_WINDOW_WIDTH, VOICE_HUD_WINDOW_HEIGHT)
    .min_inner_size(VOICE_HUD_WINDOW_WIDTH, VOICE_HUD_WINDOW_HEIGHT)
    .max_inner_size(VOICE_HUD_WINDOW_WIDTH, VOICE_HUD_WINDOW_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(!native_hud_shown)
    .focused(!native_hud_shown)
    .build()
    .map_err(|error| format!("Failed to create voice HUD window: {error}"))?;

    if native_hud_shown {
        let _ = window.hide();
    } else {
        let _ = window.center();
    }
    let _ = window.emit(VOICE_EVENTS_START, payload.clone());
    Ok(payload)
}

const VOICE_EVENTS_START: &str = "voice:start";
const VOICE_EVENTS_STOP_REQUEST: &str = "voice:stop-request";
const VOICE_EVENTS_CANCEL_REQUEST: &str = "voice:cancel-request";
const VOICE_EVENTS_HOTKEY_OPEN: &str = "voice:hotkey-open";

fn handle_voice_hotkey(app: &tauri::AppHandle) {
    let native_active = app
        .try_state::<VoiceHudRuntimeState>()
        .map(|state| state.is_active())
        .unwrap_or(false);
    if native_active {
        emit_voice_hud_control_event(app, VOICE_EVENTS_STOP_REQUEST);
        return;
    }

    if let Some(hud) = app.get_webview_window("voice-hud") {
        if hud.is_visible().unwrap_or(false) {
            let _ = hud.emit(VOICE_EVENTS_STOP_REQUEST, ());
            let _ = hud.set_focus();
            return;
        }
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.emit(
            VOICE_EVENTS_HOTKEY_OPEN,
            VoiceHotkeyOpenPayload {
                source: "hotkey".to_string(),
            },
        );
        return;
    }

    let payload = build_voice_session_payload(
        "chat-query".to_string(),
        Some("hotkey".to_string()),
        Some(false),
    );
    let _ = show_voice_hud_window(app, payload);
}

#[tauri::command]
fn open_voice_hud(
    app: tauri::AppHandle,
    target: String,
    source: Option<String>,
    submit_on_final: Option<bool>,
) -> Result<VoiceSessionStartPayload, String> {
    let payload = build_voice_session_payload(target, source, submit_on_final);
    show_voice_hud_window(&app, payload)
}

#[tauri::command]
fn hide_voice_hud(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("voice-hud") {
        window
            .hide()
            .map_err(|error| format!("Failed to hide voice HUD: {error}"))?;
    }
    app.state::<VoiceHudRuntimeState>().set_active(false);
    hide_native_voice_hud(&app);
    Ok(())
}

#[tauri::command]
fn update_voice_hud_state(app: tauri::AppHandle, state: VoiceHudVisualState) -> Result<(), String> {
    if app.state::<VoiceHudRuntimeState>().is_active() {
        let _ = update_native_voice_hud(&app, &state);
    }
    Ok(())
}

#[tauri::command]
fn get_voice_hotkey_settings(
    state: tauri::State<VoiceHotkeyState>,
) -> Result<VoiceHotkeySettings, String> {
    let guard = state
        .inner
        .lock()
        .map_err(|_| "Voice hotkey state poisoned".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
fn set_voice_hotkey_settings(
    app: tauri::AppHandle,
    state: tauri::State<VoiceHotkeyState>,
    settings: VoiceHotkeySettings,
) -> Result<VoiceHotkeySettings, String> {
    let next = sanitize_voice_hotkey_settings(settings);
    persist_voice_hotkey_settings(&next)?;
    Ok(register_voice_hotkey(&app, state, next))
}

fn normalize_settings_view(view: Option<String>) -> String {
    match view.as_deref().unwrap_or("account") {
        "account" | "privacy" | "voice" | "computer-tracking" | "place-tagging"
        | "apple-health" => view.unwrap_or_else(|| "account".to_string()),
        _ => "account".to_string(),
    }
}

fn build_settings_window_url(initial_view: &str) -> String {
    let ritual_env = configured_ritual_env();
    let app_origin = get_app_url();
    let mut settings_url = join_url_path(&app_origin, "/settings-window");
    settings_url = with_query_param(&settings_url, "ritual_settings_window=1");
    settings_url = with_query_param(&settings_url, &format!("ritual_desktop_env={ritual_env}"));
    with_query_param(&settings_url, &format!("view={initial_view}"))
}

fn resize_settings_window(settings: &tauri::WebviewWindow) {
    let _ = settings.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: SETTINGS_WINDOW_WIDTH,
        height: SETTINGS_WINDOW_HEIGHT,
    }));
}

fn center_settings_window_over_main(
    app: &tauri::AppHandle,
    settings: &tauri::WebviewWindow,
) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let main_pos = main
        .outer_position()
        .map_err(|e| format!("Failed to read main window position: {e}"))?;
    let main_size = main
        .outer_size()
        .map_err(|e| format!("Failed to read main window size: {e}"))?;
    let settings_size = settings
        .outer_size()
        .map_err(|e| format!("Failed to read settings window size: {e}"))?;

    let x = main_pos.x + ((main_size.width as i32 - settings_size.width as i32) / 2);
    let y = main_pos.y + ((main_size.height as i32 - settings_size.height as i32) / 2);
    settings
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| format!("Failed to position settings window: {e}"))?;

    Ok(())
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle, initial_view: Option<String>) -> Result<(), String> {
    let initial_view = normalize_settings_view(initial_view);
    let payload = SettingsWindowPayload {
        initial_view: initial_view.clone(),
    };

    if let Some(settings) = app.get_webview_window("settings") {
        resize_settings_window(&settings);
        if center_settings_window_over_main(&app, &settings).is_err() {
            let _ = settings.center();
        }
        #[cfg(target_os = "macos")]
        configure_macos_settings_window_chrome(&settings);
        let _ = settings.show();
        let _ = settings.unminimize();
        let _ = settings.set_focus();
        let _ = settings.emit("settings:show", payload);
        return Ok(());
    }

    let settings_url = build_settings_window_url(&initial_view);
    let settings_external_url = settings_url
        .parse()
        .map_err(|error| format!("Invalid settings window URL: {error}"))?;

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "settings",
        tauri::WebviewUrl::External(settings_external_url),
    )
    .user_agent(DESKTOP_WEBVIEW_USER_AGENT)
    .title("Settings")
    .inner_size(SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT)
    .min_inner_size(SETTINGS_WINDOW_MIN_WIDTH, SETTINGS_WINDOW_MIN_HEIGHT)
    .resizable(true)
    .decorations(true)
    .transparent(false)
    .shadow(true)
    .visible(true)
    .focused(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    let settings = builder
        .build()
        .map_err(|error| format!("Failed to create settings window: {error}"))?;
    if center_settings_window_over_main(&app, &settings).is_err() {
        let _ = settings.center();
    }

    #[cfg(target_os = "macos")]
    {
        configure_macos_settings_window_chrome(&settings);
    }

    let _ = settings.emit("settings:show", payload);
    Ok(())
}

#[tauri::command]
fn sidebar_get_main_state(
    app: tauri::AppHandle,
    state: tauri::State<SidebarWindowState>,
) -> Result<SidebarMainState, String> {
    let width = state.get_width();
    let mut path = "/dashboard".to_string();
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(url) = main.url() {
            let mut p = url.path().to_string();
            if let Some(query) = url.query() {
                p.push('?');
                p.push_str(query);
            }
            if !p.is_empty() {
                path = p;
            }
        }
    }
    Ok(SidebarMainState { path, width })
}

/// Show the main window (called from frontend when React is ready)
#[tauri::command]
#[instrument(skip(window))]
fn show_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .show()
        .map_err(|e| format!("Failed to show window: {}", e))?;
    window
        .set_focus()
        .map_err(|e| format!("Failed to focus window: {}", e))?;
    Ok(())
}

/// Read saved watcher config for auto-start
fn read_watcher_config() -> Option<watcher::WatcherConfig> {
    watcher::get_saved_watcher_config()
}

/// Save watcher config for auto-start (called from frontend)
#[tauri::command]
#[instrument(skip(config), fields(device_id = %config.device_id, user_id = %config.user_id))]
fn save_watcher_config_cmd(config: watcher::WatcherConfig) -> Result<(), String> {
    watcher::save_watcher_config(&config)?;
    info!("Watcher config saved for auto-start");
    Ok(())
}

/// Clear watcher config (disable auto-start) (called from frontend)
#[tauri::command]
#[instrument]
fn clear_watcher_config_cmd() -> Result<(), String> {
    watcher::clear_watcher_config()?;
    info!("Watcher config cleared (auto-start disabled)");
    Ok(())
}

#[tauri::command]
#[instrument(fields(user_id = %user_id))]
fn reconcile_watcher_config_user_cmd(user_id: String) -> Result<bool, String> {
    let trimmed_user_id = user_id.trim();
    if trimmed_user_id.is_empty() {
        return Err("User ID is required".to_string());
    }

    let Some(mut config) = read_watcher_config() else {
        return Ok(false);
    };

    if config.user_id == trimmed_user_id {
        return Ok(false);
    }

    info!(
        previous_user_id = %config.user_id,
        new_user_id = %trimmed_user_id,
        "Reconciling watcher config user"
    );
    config.user_id = trimmed_user_id.to_string();
    save_watcher_config_cmd(config.clone())?;

    if watcher::permissions::check_accessibility_permission() {
        match watcher::lifecycle::start_watcher_sync(config) {
            Ok(status) => {
                info!(
                    pid = status.pid,
                    "Watcher restarted after config reconciliation"
                );
            }
            Err(error) => {
                warn!(error = %error, "Failed restarting watcher after config reconciliation");
            }
        }
    }

    Ok(true)
}

fn main() {
    if let Err(error) = desktop_observability::init_desktop_observability() {
        eprintln!("Failed to initialize desktop observability: {error}");
    }

    let startup_started_at = Instant::now();
    info!("Starting Ritual desktop app");
    let shell_feature_flags = DesktopShellFeatureFlags::from_env();
    shell_feature_flags.log_effective_values();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if matches!(event.state(), ShortcutState::Pressed) {
                        handle_voice_hotkey(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_deep_link::init());
    #[cfg(not(target_os = "macos"))]
    let builder = builder;

    builder
        .manage(SidebarWindowState::default())
        .manage(VoiceHotkeyState::default())
        .manage(VoiceHudRuntimeState::default())
        .manage(shell_feature_flags)
        .manage(desktop_runtime::DesktopShellState::default())
        // Only expose native macOS features - auth is handled by Clerk
        .invoke_handler(tauri::generate_handler![
            // Window management
            show_main_window,
            open_settings_window,
            open_voice_hud,
            hide_voice_hud,
            update_voice_hud_state,
            get_voice_hotkey_settings,
            set_voice_hotkey_settings,
            sidebar_set_width,
            sidebar_navigate,
            sidebar_get_main_state,
            // Desktop runtime bridge commands
            native_widget::write_auth_token_to_file,
            native_widget::write_turso_sync_config,
            native_widget::check_runtime_bridge_signals,
            native_widget::check_dashboard_refresh_trigger,
            native_widget::check_token_refresh_request,
            native_widget::show_native_microphone_permission_dialog,
            native_widget::check_native_microphone_permission,
            native_widget::show_native_speech_recognition_permission_dialog,
            native_widget::check_native_speech_recognition_permission,
            native_widget::start_native_speech_recognition,
            native_widget::stop_native_speech_recognition,
            native_widget::get_native_speech_state,
            native_widget::clear_native_speech_state,
            system_audio::check_recording_source_readiness,
            // Ritual Watcher commands for computer activity tracking
            watcher::permissions::check_accessibility_permission,
            watcher::permissions::request_accessibility_permission,
            watcher::lifecycle::start_watcher,
            watcher::lifecycle::stop_watcher,
            watcher::lifecycle::get_watcher_status,
            watcher::permissions::open_accessibility_settings,
            watcher::permissions::open_full_disk_access_settings,
            watcher::permissions::open_microphone_settings,
            watcher::permissions::open_speech_recognition_settings,
            watcher::permissions::open_screen_recording_settings,
            watcher::permissions::open_system_audio_settings,
            watcher::permissions::open_input_monitoring_settings,
            watcher::permissions::open_location_settings,
            // Local activity queries (for detailed view with full URLs/titles)
            watcher::queries::get_detailed_activity,
            watcher::queries::get_daily_summaries,
            // Real-time status
            watcher::queries::get_watcher_extended_status,
            watcher::diagnostics::get_browser_extension_diagnostics,
            // Watchdog - auto-restart hung watcher
            watcher::diagnostics::check_and_restart_watcher_if_hung,
            // App icon extraction
            watcher::icons::get_app_icon,
            watcher::icons::get_app_icons_batch,
            // Watcher config persistence for auto-start
            save_watcher_config_cmd,
            clear_watcher_config_cmd,
            reconcile_watcher_config_user_cmd,
            // Desktop shell bootstrap commands
            get_desktop_shell_bootstrap_config,
            check_desktop_hosted_app_reachable,
            desktop_observability::desktop_record_shell_event,
            desktop_observability::desktop_capture_sentry_smoke,
            // Desktop runtime / updater commands
            desktop_runtime::updater::get_desktop_runtime_info,
            desktop_runtime::get_desktop_runtime_state,
            desktop_runtime::auth_handoff::desktop_set_auth_token,
            desktop_runtime::auth_handoff::desktop_clear_auth_state,
            desktop_runtime::updater::desktop_frontend_ready,
            desktop_runtime::updater::desktop_manual_update_check,
            desktop_runtime::updater::desktop_install_update,
            desktop_runtime::get_biome_iphone_diagnostics,
            desktop_runtime::desktop_trigger_biome_iphone_sync,
            desktop_runtime::import_biome_iphone_export,
            // Local encrypted vault commands
            local_vault::vault_initialize,
            local_vault::vault_get_status,
            local_vault::vault_put_record,
            local_vault::vault_get_record,
            local_vault::vault_list_records,
            local_vault::vault_tombstone_record,
            local_vault::vault_put_migration_manifest,
            local_vault::vault_list_migration_manifests,
            local_vault::vault_put_deletion_receipt,
            local_vault::vault_list_deletion_receipts,
            // Ritual Database commands (unified libSQL)
            ritual_database::init_ritual_database,
            ritual_database::get_ritual_db_stats,
            ritual_database::text_search,
            ritual_database::check_migration_status,
            ritual_database::run_project_time_attribution_once,
            ritual_database::run_project_time_retention_once,
            ritual_database::get_project_time_attribution_health,
        ])
        .setup(|app| {
            let setup_started_at = Instant::now();
            desktop_runtime::register_runtime_signal_monitor(app.handle().clone());
            desktop_runtime::register_location_outbox_drain_worker(app.handle().clone());
            desktop_runtime::register_biome_outbox_drain_worker(app.handle().clone());
            initialize_voice_hotkey(app.handle());

            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let check_updates =
                MenuItemBuilder::with_id("check_updates", "Check for Updates").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .items(&[&check_updates, &quit])
                .build()?;
            let _tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "check_updates" => {
                        info!("Check for updates requested from system tray");
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        desktop_runtime::tray_check_for_updates(app.clone());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            #[cfg(target_os = "macos")]
            {
                if let Some(urls) = app.deep_link().get_current().map_err(|error| {
                    std::io::Error::other(format!("Failed reading initial deep links: {error}"))
                })? {
                    for url in urls {
                        handle_desktop_auth_deep_link(&app.handle(), url.to_string());
                    }
                }

                let deep_link_app = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_desktop_auth_deep_link(&deep_link_app, url.to_string());
                    }
                });
            }

            // Get the app URL based on environment (Midday pattern)
            let ritual_env = configured_ritual_env();
            let app_origin = get_app_url();
            let mut app_url =
                with_query_param(&app_origin, &format!("ritual_desktop_env={}", ritual_env));
            let bootstrap_url = build_desktop_bootstrap_url(&app_origin, &ritual_env);
            let transparency_probe = env_flag_enabled("RITUAL_TRANSPARENCY_PROBE");
            let main_glass_enabled =
                transparency_probe || !env_flag_enabled("RITUAL_DISABLE_MAIN_GLASS");
            if main_glass_enabled {
                app_url = with_query_param(&app_url, "ritual_main_glass=1");
                app_url = with_query_param(&app_url, "ritual_glass_chrome=1");
            }
            if transparency_probe {
                info!("Transparency probe mode enabled");
                app_url = with_query_param(&app_url, "ritual_transparency_probe=1");
            }

            let window = if let Some(window) = app.get_webview_window("main") {
                window
            } else {
                let mut builder =
                    tauri::WebviewWindowBuilder::new(app, "main", desktop_shell_window_url()?)
                        .user_agent(DESKTOP_WEBVIEW_USER_AGENT)
                        .title("Ritual")
                        .inner_size(MAIN_WINDOW_DEFAULT_WIDTH, MAIN_WINDOW_DEFAULT_HEIGHT)
                        .min_inner_size(800.0, 450.0)
                        .resizable(true)
                        .decorations(true)
                        .transparent(transparency_probe)
                        .shadow(true)
                        .visible(true);

                #[cfg(target_os = "macos")]
                {
                    builder = builder
                        .title_bar_style(tauri::TitleBarStyle::Overlay)
                        .hidden_title(true);
                }

                builder.build().map_err(|e| {
                    std::io::Error::other(format!("Failed to create main window: {e}"))
                })?
            };

            // Configure window after creation
            {
                #[cfg(target_os = "macos")]
                {
                    configure_macos_native_window_chrome(&window);

                    if main_glass_enabled {
                        info!("Main window glass enabled");
                        configure_macos_sidebar_titlebar_glass(&window);
                        configure_macos_webview_transparency(&window);
                    } else {
                        info!("Main window glass disabled for stable production rendering");
                    }

                    if let Err(error) = window.set_resizable(true) {
                        warn!(error = %error, "Failed to force main window resizable");
                    }

                    let detached_sidebar_enabled = !transparency_probe
                        && env::var("RITUAL_DETACHED_SIDEBAR")
                            .map(|v| {
                                let value = v.trim().to_ascii_lowercase();
                                matches!(value.as_str(), "1" | "true" | "on" | "yes")
                            })
                            .unwrap_or(false);
                    let sidebar_state = app.state::<SidebarWindowState>();
                    sidebar_state.set_detached_enabled(detached_sidebar_enabled);
                    sidebar_state.set_width(70.0);

                    if detached_sidebar_enabled {
                        info!("Detached sidebar mode enabled");
                        let _ = ensure_detached_sidebar_window(
                            &app.handle(),
                            &app_url,
                            sidebar_state.get_width(),
                        );
                        let _ = window.emit("sidebar:width", sidebar_state.get_width());

                        let app_handle_for_sync = app.handle().clone();
                        window.on_window_event(move |event| match event {
                            tauri::WindowEvent::Moved(_)
                            | tauri::WindowEvent::Resized(_)
                            | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                                let state = app_handle_for_sync.state::<SidebarWindowState>();
                                let width = state.get_width();
                                let _ = sync_detached_sidebar_window(&app_handle_for_sync, width);
                                if let Some(main_window) =
                                    app_handle_for_sync.get_webview_window("main")
                                {
                                    let _ = main_window.emit("sidebar:width", width);
                                }
                            }
                            tauri::WindowEvent::CloseRequested { .. } => {
                                if let Some(sidebar_window) =
                                    app_handle_for_sync.get_webview_window("sidebar")
                                {
                                    let _ = sidebar_window.close();
                                }
                            }
                            _ => {}
                        });
                    } else {
                        sidebar_state.set_detached_enabled(false);
                        if let Some(sidebar_window) = app.get_webview_window("sidebar") {
                            let _ = sidebar_window.close();
                        }
                    }
                }

                if should_use_local_shell_window() {
                    let bootstrap_url_json =
                        serde_json::to_string(&bootstrap_url).unwrap_or_else(|_| {
                            "\"https://desktop.ritualdb.com/dashboard\"".to_string()
                        });
                    let _ = window.eval(&format!(
                        "window.__RITUAL_BOOTSTRAP_URL__ = {};",
                        bootstrap_url_json
                    ));
                }
                apply_one_time_main_window_default_size(&window);
                let _ = window.show();
                let _ = window.set_focus();
            }
            info!("Using watcher-owned context capture; legacy recorder sidecar is not shipped");

            desktop_runtime::emit_runtime_state_changed(app.handle().clone());
            spawn_background_startup_tasks(app.handle().clone());

            desktop_runtime::register_startup_update_check(app.handle().clone());
            info!(
                duration_ms = setup_started_at.elapsed().as_millis() as u64,
                "Desktop setup completed"
            );

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                shutdown_background_helpers();
            }
            _ => {}
        });

    info!(
        duration_ms = startup_started_at.elapsed().as_millis() as u64,
        "Ritual desktop event loop exited"
    );
}

#[cfg(test)]
mod voice_hotkey_tests {
    use super::*;

    #[test]
    fn canonical_voice_shortcut_normalizes_option_space() {
        assert_eq!(
            canonical_voice_shortcut_label("Option + Space").as_deref(),
            Some("Alt+Space"),
        );
    }

    #[test]
    fn parse_voice_shortcut_rejects_empty_or_unmodified_keys() {
        assert!(parse_voice_shortcut("").is_err());
        assert!(parse_voice_shortcut("Space").is_err());
    }

    #[test]
    fn parse_voice_shortcut_accepts_default() {
        assert!(parse_voice_shortcut(DEFAULT_VOICE_SHORTCUT).is_ok());
    }

    #[test]
    fn voice_hotkey_settings_use_camel_case_json() {
        let settings = VoiceHotkeySettings {
            enabled: true,
            shortcut: DEFAULT_VOICE_SHORTCUT.to_string(),
            registered: false,
            registration_error: Some("conflict".to_string()),
        };

        let raw = serde_json::to_string(&settings).expect("serialize settings");
        assert!(raw.contains("registrationError"));
        assert!(!raw.contains("registration_error"));

        let parsed: VoiceHotkeySettings = serde_json::from_str(&raw).expect("deserialize settings");
        assert_eq!(parsed.shortcut, DEFAULT_VOICE_SHORTCUT);
        assert_eq!(parsed.registration_error.as_deref(), Some("conflict"));
    }
}
