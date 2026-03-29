// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(unexpected_cfgs)]

mod desktop_runtime;
mod local_search_bridge;
mod native_widget;
#[cfg(feature = "native-recorder")]
mod recorder;
#[cfg(not(feature = "native-recorder"))]
mod recorder_disabled;
mod ritual_database;
mod watcher;

#[cfg(not(feature = "native-recorder"))]
use crate::recorder_disabled as recorder;

use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{CustomMenuItem, Manager, RunEvent, SystemTray, SystemTrayEvent, SystemTrayMenu};

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

fn build_desktop_shell_bootstrap_config() -> DesktopShellBootstrapConfig {
    let ritual_env = configured_ritual_env();
    let app_origin = get_app_url();
    let bootstrap_url = with_query_param(
        &join_url_path(&app_origin, "/desktop/bootstrap"),
        &format!("ritual_desktop_env={}", ritual_env),
    );
    let callback_url = join_url_path(&app_origin, "/auth/callback");

    DesktopShellBootstrapConfig {
        environment: ritual_env,
        app_origin,
        bootstrap_url,
        callback_url,
    }
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

fn desktop_shell_window_url() -> Result<tauri::WindowUrl, std::io::Error> {
    if should_use_local_shell_window() {
        Ok(tauri::WindowUrl::App("index.html".into()))
    } else {
        let shell_external_url = DESKTOP_SHELL_DEV_URL
            .parse()
            .map_err(|error| std::io::Error::other(format!("Invalid desktop shell dev URL: {error}")))?;
        Ok(tauri::WindowUrl::External(shell_external_url))
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

fn load_persisted_turso_sync_config() {
    match native_widget::load_turso_sync_config() {
        Ok(Some(config)) => {
            env::set_var("TURSO_SYNC_URL", &config.sync_url);
            env::set_var("TURSO_AUTH_TOKEN", &config.auth_token);
            if !config.expires_at.trim().is_empty() {
                env::set_var("TURSO_SYNC_EXPIRES_AT", &config.expires_at);
            }
            if !config.database_name.trim().is_empty() {
                env::set_var("TURSO_DATABASE_NAME", &config.database_name);
            }
            println!("🔄 Loaded persisted Turso sync config");
        }
        Ok(None) => {
            println!("📂 No persisted Turso sync config found");
        }
        Err(error) => {
            eprintln!("⚠️ Failed to load persisted Turso sync config: {}", error);
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

    if let Err(err) = tauri::async_runtime::block_on(recorder::stop_recorder()) {
        eprintln!(
            "⚠️ Failed to stop Ritual Recorder during app shutdown: {}",
            err
        );
    }
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn configure_macos_window_transparency(window: &tauri::Window) {
    use cocoa::appkit::{NSColor, NSWindow};
    use cocoa::base::{id, nil};
    use objc::{msg_send, sel, sel_impl};

    println!("🔧 Configuring macOS window transparency + liquid glass…");

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
fn apply_vibrancy_fallback(window: &tauri::Window) {
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
fn configure_macos_webview_transparency(window: &tauri::Window) {
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
            let wk: id = webview.inner();
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
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let sidebar = app
        .get_window("sidebar")
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

    if app.get_window("sidebar").is_none() {
        let sidebar_external_url = sidebar_url
            .parse()
            .map_err(|e| format!("Invalid sidebar URL: {e}"))?;

        tauri::WindowBuilder::new(
            app,
            "sidebar",
            tauri::WindowUrl::External(sidebar_external_url),
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
    } else if let Some(sidebar) = app.get_window("sidebar") {
        let sidebar_url_json = serde_json::to_string(&sidebar_url)
            .unwrap_or_else(|_| "\"http://localhost:3000/sidebar\"".to_string());
        let _ = sidebar.eval(&format!("window.location.replace({});", sidebar_url_json));
    }

    if let Some(sidebar) = app.get_window("sidebar") {
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
    if let Some(main) = app.get_window("main") {
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
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    main.eval(&format!("window.location.replace({});", target_json))
        .map_err(|e| format!("Failed to navigate main window: {e}"))?;
    if let Some(sidebar) = app.get_window("sidebar") {
        let _ = sidebar.emit("sidebar:route", target);
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct SidebarMainState {
    path: String,
    width: f64,
}

#[tauri::command]
fn sidebar_get_main_state(
    app: tauri::AppHandle,
    state: tauri::State<SidebarWindowState>,
) -> Result<SidebarMainState, String> {
    let width = state.get_width();
    let mut path = "/dashboard".to_string();
    if let Some(main) = app.get_window("main") {
        let url = main.url();
        let mut p = url.path().to_string();
        if let Some(query) = url.query() {
            p.push('?');
            p.push_str(query);
        }
        if !p.is_empty() {
            path = p;
        }
    }
    Ok(SidebarMainState { path, width })
}

/// Show the main window (called from frontend when React is ready)
#[tauri::command]
fn show_main_window(window: tauri::Window) -> Result<(), String> {
    window
        .show()
        .map_err(|e| format!("Failed to show window: {}", e))?;
    window
        .set_focus()
        .map_err(|e| format!("Failed to focus window: {}", e))?;
    Ok(())
}

/// Get the path to the watcher config file
fn get_watcher_config_path() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual/watcher_config.json")
    } else {
        PathBuf::from("./watcher_config.json")
    }
}

/// Read saved watcher config for auto-start
fn read_watcher_config() -> Option<watcher::WatcherConfig> {
    let config_path = get_watcher_config_path();
    if config_path.exists() {
        if let Ok(contents) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<watcher::WatcherConfig>(&contents) {
                return Some(config);
            }
        }
    }
    None
}

/// Save watcher config for auto-start (called from frontend)
#[tauri::command]
fn save_watcher_config_cmd(config: watcher::WatcherConfig) -> Result<(), String> {
    let config_path = get_watcher_config_path();

    // Ensure directory exists
    if let Some(parent) = config_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    println!("💾 Watcher config saved for auto-start");
    Ok(())
}

/// Clear watcher config (disable auto-start) (called from frontend)
#[tauri::command]
fn clear_watcher_config_cmd() -> Result<(), String> {
    let config_path = get_watcher_config_path();
    if config_path.exists() {
        fs::remove_file(&config_path).map_err(|e| format!("Failed to remove config: {}", e))?;
        println!("🗑️ Watcher config cleared (auto-start disabled)");
    }
    Ok(())
}

#[tauri::command]
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

    println!(
        "🔁 Reconciling watcher config user from {} to {}",
        config.user_id, trimmed_user_id
    );
    config.user_id = trimmed_user_id.to_string();
    save_watcher_config_cmd(config.clone())?;

    if watcher::check_accessibility_permission() {
        match watcher::start_watcher_sync(config) {
            Ok(status) => {
                println!(
                    "✅ Watcher restarted after config reconciliation (PID: {:?})",
                    status.pid
                );
            }
            Err(error) => {
                println!("⚠️ Failed restarting watcher after config reconciliation: {}", error);
            }
        }
    }

    Ok(true)
}

fn get_voice_settings_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
        .join(".ritual")
        .join("voice_settings.json")
}

#[tauri::command]
fn get_voice_hotkey() -> Result<String, String> {
    let path = get_voice_settings_path();
    if !path.exists() {
        return Ok("cmd_shift_l".to_string());
    }
    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read voice settings: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse voice settings: {}", e))?;
    Ok(json["hotkey"].as_str().unwrap_or("cmd_shift_l").to_string())
}

#[tauri::command]
fn set_voice_hotkey(hotkey: String) -> Result<(), String> {
    let path = get_voice_settings_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let json = serde_json::json!({ "hotkey": hotkey });
    let contents = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("Failed to serialize voice settings: {}", e))?;
    fs::write(&path, contents).map_err(|e| format!("Failed to write voice settings: {}", e))?;
    println!("🎙️ Voice hotkey updated to: {}", hotkey);
    Ok(())
}

fn main() {
    // Create system tray menu with native timer widget access
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let show_widget = CustomMenuItem::new("show_widget".to_string(), "Show Focus Timer");
    let check_updates = CustomMenuItem::new("check_updates".to_string(), "Check for Updates");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show_widget)
        .add_item(check_updates)
        .add_item(quit);

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
    .plugin(tauri_plugin_context_menu::init())
    .manage(SidebarWindowState::default())
    .manage(desktop_runtime::DesktopShellState::default())
    // Only expose native macOS features - auth is handled by Clerk
    .invoke_handler(tauri::generate_handler![
      // Window management
      show_main_window,
      sidebar_set_width,
      sidebar_navigate,
      sidebar_get_main_state,
      // Native widget commands
      native_widget::create_native_timer_widget,
      native_widget::close_native_timer_widget,
      native_widget::write_auth_token_to_file,
      native_widget::write_turso_sync_config,
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
      // Local activity queries (for detailed view with full URLs/titles)
      watcher::get_detailed_activity,
      watcher::get_activity_timeline,
      // Sync queue commands for reliable backend sync
      watcher::get_sync_queue_count,
      watcher::get_pending_sync_items,
      watcher::mark_sync_item_complete,
      watcher::mark_sync_item_failed,
      watcher::get_event_for_sync,
      watcher::get_daily_summary,
      watcher::get_daily_summaries,
      // Database maintenance & diagnostics
      watcher::get_watcher_db_stats,
      watcher::cleanup_old_events,
      watcher::export_events,
      // Focus metrics
      watcher::get_focus_metrics,
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
      // Voice hotkey settings
      get_voice_hotkey,
      set_voice_hotkey,
      // Ritual Recorder commands for legacy OCR surfaces (disabled by default)
      recorder::check_screen_recording_permission,
      recorder::request_screen_recording_permission,
      recorder::check_ffmpeg_status,
      recorder::ensure_ffmpeg_installed,
      recorder::start_recorder,
      recorder::stop_recorder,
      recorder::get_recorder_status,
      recorder::get_available_monitors,
      recorder::get_recorder_storage_status,
      recorder::get_ocr_frames,
      recorder::search_ocr_text,
      recorder::get_video_chunks,
      recorder::run_recorder_maintenance,
      recorder::save_recorder_config_cmd,
      recorder::clear_recorder_config_cmd,
      recorder::extract_frame_image,
      recorder::clear_frame_cache,
      recorder::get_frame_cache_stats,
      // Desktop shell bootstrap commands
      get_desktop_shell_bootstrap_config,
      check_desktop_hosted_app_reachable,
      // Desktop runtime / updater commands
      desktop_runtime::get_desktop_runtime_info,
      desktop_runtime::desktop_frontend_ready,
      desktop_runtime::desktop_manual_update_check,
      desktop_runtime::desktop_install_update,
      // Ritual Database commands (unified libSQL with vector search)
      ritual_database::init_ritual_database,
      ritual_database::get_ritual_db_stats,
      ritual_database::init_embedding_service,
      ritual_database::get_embedding_stats,
      ritual_database::get_chunk_embedding_coverage,
      ritual_database::ensure_embedding_pipeline_ready,
      ritual_database::semantic_search,
      ritual_database::text_search,
      ritual_database::hybrid_search,
      ritual_database::process_embeddings,
      ritual_database::backfill_chunk_embeddings,
      ritual_database::start_chunk_embedding_backfill,
      ritual_database::get_chunk_embedding_backfill_status,
      ritual_database::check_migration_status,
      ritual_database::seed_memory_upload_outbox,
      ritual_database::get_memory_upload_outbox_stats,
      ritual_database::claim_memory_upload_outbox_batch,
      ritual_database::ack_memory_upload_outbox_batch,
      // Embedding worker commands
      ritual_database::start_embedding_worker,
      ritual_database::stop_embedding_worker,
      ritual_database::is_embedding_worker_running,
      // Segment commands
      ritual_database::get_segments_in_range,
      ritual_database::get_segment_at_time,
      ritual_database::get_frames_for_segment,
      ritual_database::create_segments,
      ritual_database::get_segment_stats
    ])
    .system_tray(system_tray)
    .on_system_tray_event(|_app, event| match event {
      SystemTrayEvent::LeftClick {
        position: _,
        size: _,
        ..
      } => {
        // Create native Swift timer widget from system tray
        println!("🖱️ System tray clicked - creating native Swift timer widget");
        native_widget::create_native_timer_widget();
      }
      SystemTrayEvent::MenuItemClick { id, .. } => {
        match id.as_str() {
          "quit" => {
            std::process::exit(0);
          }
          "show_widget" => {
            println!("📱 Show widget menu clicked");
            native_widget::create_native_timer_widget();
          }
          "check_updates" => {
            println!("⬇️ Check for updates requested from system tray");
            if let Some(window) = _app.get_window("main") {
              let _ = window.show();
              let _ = window.set_focus();
            }
            desktop_runtime::tray_check_for_updates(_app.app_handle());
          }
          _ => {}
        }
      }
      _ => {}
    })
    .setup(|app| {
      // Handle deep link URLs (ritual://)
      let handle = app.handle();
      
      // Get the app URL based on environment (Midday pattern)
      let ritual_env = configured_ritual_env();
      let app_origin = get_app_url();
      let mut app_url = with_query_param(&app_origin, &format!("ritual_desktop_env={}", ritual_env));
      let transparency_probe = env_flag_enabled("RITUAL_TRANSPARENCY_PROBE");
      let main_glass_enabled = transparency_probe || !env_flag_enabled("RITUAL_DISABLE_MAIN_GLASS");
      if main_glass_enabled {
        app_url = with_query_param(&app_url, "ritual_main_glass=1");
      }
      if transparency_probe {
        println!("🧪 Transparency probe mode enabled (RITUAL_TRANSPARENCY_PROBE=1)");
        println!("🧪 Probe checklist: transparent window + clear NSWindow + guarded WKWebView clear pass + vibrancy material");
        app_url = with_query_param(&app_url, "ritual_transparency_probe=1");
      }
      
      let window = if let Some(window) = app.get_window("main") {
        window
      } else {
        let mut builder = tauri::WindowBuilder::new(
          app,
          "main",
          desktop_shell_window_url()?,
        )
        .user_agent(DESKTOP_WEBVIEW_USER_AGENT)
        .title("")
        .inner_size(1150.0, 800.0)
        .min_inner_size(800.0, 450.0)
        .resizable(true)
        .decorations(true)
        .transparent(main_glass_enabled)
        .visible(true);

        #[cfg(target_os = "macos")]
        {
          builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
        }

        builder.build()
        .map_err(|e| std::io::Error::other(format!("Failed to create main window: {e}")))?
      };

      // Configure window after creation
      {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1150.0, height: 800.0 }));
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(target_os = "macos")]
        {
          if main_glass_enabled {
            println!("🪟 Main window glass enabled");
            configure_macos_window_transparency(&window);
            configure_macos_webview_transparency(&window);
          } else {
            println!("🪟 Main window glass disabled for stable production rendering");
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
            println!("✅ Detached sidebar mode enabled (two-window)");
            let _ = ensure_detached_sidebar_window(&app.handle(), &app_url, sidebar_state.get_width());
            let _ = window.emit("sidebar:width", sidebar_state.get_width());

            let app_handle_for_sync = app.handle();
            window.on_window_event(move |event| {
              match event {
                tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                  let state = app_handle_for_sync.state::<SidebarWindowState>();
                  let width = state.get_width();
                  let _ = sync_detached_sidebar_window(&app_handle_for_sync, width);
                  if let Some(main_window) = app_handle_for_sync.get_window("main") {
                    let _ = main_window.emit("sidebar:width", width);
                  }
                }
                tauri::WindowEvent::CloseRequested { .. } => {
                  if let Some(sidebar_window) = app_handle_for_sync.get_window("sidebar") {
                    let _ = sidebar_window.close();
                  }
                }
                _ => {}
              }
            });
          } else {
            sidebar_state.set_detached_enabled(false);
            if let Some(sidebar_window) = app.get_window("sidebar") {
              let _ = sidebar_window.close();
            }
          }
        }

        // Fallback timer: only show the window if desktop bootstrap never does.
        // The hosted bootstrap route should normally show the window itself.
        let window_clone = window.clone();
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_secs(10));
          
          // Check if window is still hidden
          if let Ok(is_visible) = window_clone.is_visible() {
            if !is_visible {
              println!("⏰ Fallback timer: showing window after 10s");
              let _ = window_clone.show();
              let _ = window_clone.set_focus();
            }
          }
        });
      }

      #[cfg(target_os = "macos")]
      {
        if env_flag_enabled("RITUAL_DISABLE_NOTCH_AUTOSTART") {
          println!("⏭️ Native notch auto-start disabled (RITUAL_DISABLE_NOTCH_AUTOSTART=1)");
        } else {
          println!("🔄 Auto-starting native notch widget (forcing refresh)...");
          native_widget::restart_native_timer_widget();
        }
      }

      load_persisted_turso_sync_config();
      
      // Initialize Ritual Database (unified libSQL with vector search)
      // This also handles migration from legacy databases
      match ritual_database::initialize_database() {
        Ok(()) => {
          println!("✅ Ritual unified database ready");
          if let Err(e) = ritual_database::log_startup_pipeline_snapshot() {
            eprintln!("⚠️ Failed to log startup pipeline snapshot: {}", e);
          }
          if env_flag_enabled("RITUAL_ENABLE_LOCAL_SEMANTIC_SEARCH") {
            if let Err(e) = local_search_bridge::start_local_search_bridge() {
              eprintln!("⚠️ Failed to start local search bridge: {}", e);
            }
            ritual_database::auto_start_embedding_worker();
          } else {
            println!("⏭️ Local semantic search bridge disabled (cloud-only chat mode)");
          }

          if env_flag_enabled("RITUAL_ENABLE_LOCAL_SEMANTIC_SEARCH")
            && env_flag_enabled("RITUAL_ENABLE_STARTUP_BACKFILL")
          {
              std::thread::spawn(|| {
                match ritual_database::ensure_embedding_pipeline_ready() {
                  Ok(status) => {
                  println!(
                    "[Ritual][startup] ensure_embedding_pipeline_ready initialized={} frame_pending={} chunk_pending={} worker_running={} worker_started={}",
                    status.initialized,
                    status.frames_without_embeddings,
                    status.pending_chunks,
                    status.worker_running,
                    status.worker_started
                  );
                  if let Some(init_error) = status.init_error {
                    eprintln!("[Ritual][startup] embedding init warning: {}", init_error);
                  }
                }
                Err(e) => {
                  eprintln!("[Ritual][startup] ensure_embedding_pipeline_ready failed: {}", e);
                }
              }
              });
          } else {
            println!(
              "[Ritual][startup] local semantic startup backfill disabled; cloud-only chat stays on backend memory retrieval"
            );
          }
        },
        Err(e) => println!("⚠️ Ritual database init deferred: {}", e),
      }
      
      // Auto-start Ritual Watcher if previously enabled
      if let Some(config) = read_watcher_config() {
        println!("🔄 Auto-starting Ritual Watcher...");
        
        // Check accessibility permission first
        if watcher::check_accessibility_permission() {
          // Start watcher synchronously (it spawns its own process)
          match watcher::start_watcher_sync(config) {
            Ok(status) => {
              println!("✅ Watcher auto-started successfully (PID: {:?})", status.pid);
            }
            Err(e) => {
              println!("⚠️ Failed to auto-start watcher: {}", e);
            }
          }
        } else {
          println!("⚠️ Watcher auto-start skipped: accessibility permission not granted");
        }
      }

      tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        // `tokio::time::interval` ticks immediately on first await; skip that
        // bootstrap tick so we don't restart a watcher that just started and
        // hasn't written its first healthy heartbeat/context window yet.
        interval.tick().await;
        loop {
          interval.tick().await;
          match watcher::check_and_restart_watcher_if_hung(60).await {
            Ok(true) => println!("🔄 Background watcher watchdog restarted Ritual Watcher"),
            Ok(false) => {}
            Err(e) => eprintln!("⚠️ Background watcher watchdog check failed: {}", e),
          }
        }
      });
      
      // Recorder remains available, but context capture is now the default active path.
      let recorder_autostart_enabled = matches!(
        std::env::var("RITUAL_ENABLE_RECORDER_AUTOSTART")
          .ok()
          .as_deref()
          .map(|value| value.trim().to_ascii_lowercase()),
        Some(ref value) if matches!(value.as_str(), "1" | "true" | "yes" | "on")
      );
      if recorder_autostart_enabled {
        if let Some(config) = recorder::read_recorder_config() {
          println!("🔄 Auto-starting Ritual Recorder...");

          // Check screen recording permission first
          if recorder::check_screen_recording_permission() {
            match recorder::start_recorder_sync(config) {
              Ok(status) => {
                println!("✅ Recorder auto-started successfully (PID: {:?})", status.pid);
              }
              Err(e) => {
                println!("⚠️ Failed to auto-start recorder: {}", e);
              }
            }
          } else {
            println!("⚠️ Recorder auto-start skipped: screen recording permission not granted");
          }
        }
      } else {
        println!("ℹ️ Recorder auto-start disabled; using watcher-owned context capture as the default path");
      }
      
      #[cfg(target_os = "macos")]
      {
        app.listen_global("open-url", move |event| {
          if let Some(payload) = event.payload() {
            println!("🔗 Deep link received: {}", payload);
            
            // Forward the deep link to the hosted frontend.
            if let Some(window) = handle.get_window("main") {
              let _ = window.show();
              let _ = window.set_focus();
              let callback_url = with_query_param(
                &build_desktop_shell_bootstrap_config().callback_url,
                &format!("deepLink={}", urlencoding::encode(payload)),
              );
              let callback_url_json = serde_json::to_string(&callback_url)
                .unwrap_or_else(|_| format!("\"{}\"", callback_url));
              let _ = window.eval(&format!(
                "window.location.href = {};",
                callback_url_json
              ));
            }
          }
        });
      }

      desktop_runtime::register_startup_update_check(app.handle());
      
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
}
