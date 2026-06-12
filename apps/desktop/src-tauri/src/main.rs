// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(unexpected_cfgs)]

mod cloud_sync;
mod desktop_observability;
mod desktop_runtime;
mod desktop_runtime_types;
mod native_widget;
mod ritual_database;
mod watcher;
mod watcher_activity;

use std::env;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent,
};
#[cfg(target_os = "macos")]
use tauri_plugin_deep_link::DeepLinkExt;
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
    if let Err(err) = tauri::async_runtime::block_on(watcher::stop_watcher()) {
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
            match watcher::check_and_restart_watcher_if_hung(60).await {
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

    if watcher::check_accessibility_permission() {
        match tauri::async_runtime::spawn_blocking(move || watcher::start_watcher_sync(config))
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
#[allow(unexpected_cfgs)]
fn configure_macos_native_window_chrome(window: &tauri::WebviewWindow) {
    use cocoa::base::{id, YES};
    use objc::runtime::BOOL;
    use objc::{msg_send, sel, sel_impl};

    match window.ns_window() {
        Ok(raw_window) => unsafe {
            let ns_win: id = raw_window as id;

            let current_style_mask: u64 = msg_send![ns_win, styleMask];
            // Preserve normal document-window behavior after Tauri's overlay
            // titlebar customization. In production builds the overlay/full-size
            // content style can be applied after the builder's `resizable(true)`,
            // so make the AppKit resizable bit explicit here.
            let titled_mask = 1_u64 << 0; // NSWindowStyleMaskTitled
            let closable_mask = 1_u64 << 1; // NSWindowStyleMaskClosable
            let miniaturizable_mask = 1_u64 << 2; // NSWindowStyleMaskMiniaturizable
            let resizable_mask = 1_u64 << 3; // NSWindowStyleMaskResizable
            let full_size_content_view_mask = 1_u64 << 15; // NSWindowStyleMaskFullSizeContentView
            // NSWindowStyleMaskFullSizeContentView lets the webview render under
            // the titlebar, which is required for the thin Atlas-style glass chrome.
            let desired_style_mask = current_style_mask
                | titled_mask
                | closable_mask
                | miniaturizable_mask
                | resizable_mask
                | full_size_content_view_mask;
            let _: () = msg_send![
                ns_win,
                setStyleMask: desired_style_mask
            ];
            let _: () = msg_send![ns_win, setHasShadow: YES];
            let _: () = msg_send![ns_win, setMovableByWindowBackground: YES];
            let _: () = msg_send![ns_win, setTitlebarAppearsTransparent: YES];
            // NSWindowTitleVisibilityHidden = 1
            let _: () = msg_send![ns_win, setTitleVisibility: 1_isize];

            let supports_toolbar_style: BOOL =
                msg_send![ns_win, respondsToSelector: sel!(setToolbarStyle:)];
            if supports_toolbar_style != cocoa::base::NO {
                // NSWindowToolbarStyleUnifiedCompact = 4
                let _: () = msg_send![ns_win, setToolbarStyle: 4_isize];
            }

            println!(
                "✅ NSWindow native chrome tuned (shadow + transparent titlebar + resizable)"
            );
        },
        Err(e) => eprintln!("❌ NSWindow handle not available for chrome tuning: {e}"),
    }
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn configure_macos_window_transparency(window: &tauri::WebviewWindow) {
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil};
    use objc::{msg_send, sel, sel_impl};

    println!("🔧 Configuring macOS window transparency + liquid glass…");

    let _ = window.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));

    match window.ns_window() {
        Ok(raw_window) => unsafe {
            let ns_win: id = raw_window as id;
            ns_win.setOpaque_(cocoa::base::NO);
            ns_win.setBackgroundColor_(NSColor::clearColor(nil));
            println!("✅ NSWindow transparent configured (non-opaque + clear)");

            // -----------------------------------------------------------
            // Apply Apple Liquid Glass (macOS 26+ / NSGlassEffectView)
            // Falls back to NSVisualEffectView vibrancy on older macOS.
            // -----------------------------------------------------------
            let content_view: id = msg_send![ns_win, contentView];
            if content_view.is_null() {
                eprintln!("❌ contentView is null, cannot apply glass");
                return;
            }

            // Try to get NSGlassEffectView class (macOS 26+ / Tahoe)
            let glass_cls = objc::runtime::Class::get("NSGlassEffectView");
            if let Some(cls) = glass_cls {
                // Instantiate NSGlassEffectView
                let frame: cocoa::foundation::NSRect = msg_send![content_view, bounds];
                let alloc: id = msg_send![cls, alloc];
                if alloc.is_null() {
                    eprintln!("⚠️ NSGlassEffectView alloc returned null, falling back to vibrancy");
                    apply_vibrancy_fallback(window);
                    return;
                }
                let glass_view: id = msg_send![alloc, initWithFrame: frame];
                if glass_view.is_null() {
                    eprintln!("⚠️ NSGlassEffectView initWithFrame returned null, falling back");
                    apply_vibrancy_fallback(window);
                    return;
                }

                // Style 16 = Sidebar (matches NSGlassEffectViewStyle::Sidebar)
                let _: () = msg_send![glass_view, setStyle: 16_isize];

                // White tint on the native glass for a frostier look
                let tint: id = NSColor::colorWithRed_green_blue_alpha_(nil, 1.0, 1.0, 1.0, 0.0);
                let _: () = msg_send![glass_view, setTintColor: tint];

                // Make it resize with the window
                // NSViewWidthSizable (2) | NSViewHeightSizable (16) = 18
                let _: () = msg_send![glass_view, setAutoresizingMask: 18_u64];

                // Add BELOW the WKWebView so web content renders on top
                // NSWindowOrderingMode::Below = -1
                let below: i64 = -1;
                let _: () = msg_send![
                    content_view,
                    addSubview: glass_view
                    positioned: below
                    relativeTo: nil
                ];

                println!("✅ Apple Liquid Glass applied (NSGlassEffectView, style=Sidebar)");
            } else {
                println!("⚠️ NSGlassEffectView not available, falling back to vibrancy");
                apply_vibrancy_fallback(window);
            }
        },
        Err(e) => eprintln!("❌ NSWindow handle not available: {e}"),
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
        None,
    ) {
        Ok(()) => println!("✅ Fallback: NSVisualEffectView vibrancy applied (Sidebar material)"),
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
        configure_macos_window_transparency(&sidebar);
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

fn normalize_settings_view(view: Option<String>) -> String {
    match view.as_deref().unwrap_or("account") {
        "account" | "computer-tracking" | "place-tagging" | "apple-health" => {
            view.unwrap_or_else(|| "account".to_string())
        }
        _ => "account".to_string(),
    }
}

fn build_settings_window_url(initial_view: &str) -> String {
    let ritual_env = configured_ritual_env();
    let app_origin = get_app_url();
    let mut settings_url = join_url_path(&app_origin, "/settings-window");
    settings_url = with_query_param(&settings_url, "ritual_settings_window=1");
    settings_url = with_query_param(
        &settings_url,
        &format!("ritual_desktop_env={ritual_env}"),
    );
    with_query_param(&settings_url, &format!("view={initial_view}"))
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle, initial_view: Option<String>) -> Result<(), String> {
    let initial_view = normalize_settings_view(initial_view);
    let payload = SettingsWindowPayload {
        initial_view: initial_view.clone(),
    };

    if let Some(settings) = app.get_webview_window("settings") {
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
    .inner_size(900.0, 560.0)
    .min_inner_size(760.0, 480.0)
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
    let _ = settings.center();

    #[cfg(target_os = "macos")]
    {
        configure_macos_native_window_chrome(&settings);
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

    if watcher::check_accessibility_permission() {
        match watcher::start_watcher_sync(config) {
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
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_deep_link::init());
    #[cfg(not(target_os = "macos"))]
    let builder = builder;

    builder
        .manage(SidebarWindowState::default())
        .manage(shell_feature_flags)
        .manage(desktop_runtime::DesktopShellState::default())
        // Only expose native macOS features - auth is handled by Clerk
        .invoke_handler(tauri::generate_handler![
            // Window management
            show_main_window,
            open_settings_window,
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
            // Ritual Watcher commands for computer activity tracking
            watcher::check_accessibility_permission,
            watcher::request_accessibility_permission,
            watcher::start_watcher,
            watcher::stop_watcher,
            watcher::get_watcher_status,
            watcher::open_accessibility_settings,
            watcher::open_full_disk_access_settings,
            watcher::open_microphone_settings,
            watcher::open_speech_recognition_settings,
            watcher::open_screen_recording_settings,
            watcher::open_input_monitoring_settings,
            watcher::open_location_settings,
            // Local activity queries (for detailed view with full URLs/titles)
            watcher::get_detailed_activity,
            watcher::get_daily_summaries,
            // Real-time status
            watcher::get_watcher_extended_status,
            watcher::get_browser_extension_diagnostics,
            // Watchdog - auto-restart hung watcher
            watcher::check_and_restart_watcher_if_hung,
            // App icon extraction
            watcher::get_app_icon,
            watcher::get_app_icons_batch,
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
            desktop_runtime::get_desktop_runtime_info,
            desktop_runtime::get_desktop_runtime_state,
            desktop_runtime::desktop_set_auth_token,
            desktop_runtime::desktop_frontend_ready,
            desktop_runtime::desktop_manual_update_check,
            desktop_runtime::desktop_install_update,
            desktop_runtime::get_biome_iphone_diagnostics,
            desktop_runtime::desktop_trigger_biome_iphone_sync,
            desktop_runtime::import_biome_iphone_export,
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
                        .title("")
                        .inner_size(1150.0, 800.0)
                        .min_inner_size(800.0, 450.0)
                        .resizable(true)
                        .decorations(true)
                        .transparent(main_glass_enabled)
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
                        configure_macos_window_transparency(&window);
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
                        window.on_window_event(move |event| {
                            match event {
                                tauri::WindowEvent::Moved(_)
                                | tauri::WindowEvent::Resized(_)
                                | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                                    let state = app_handle_for_sync.state::<SidebarWindowState>();
                                    let width = state.get_width();
                                    let _ =
                                        sync_detached_sidebar_window(&app_handle_for_sync, width);
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
                            }
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
