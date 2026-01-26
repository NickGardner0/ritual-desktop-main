// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native_widget;
mod watcher;

use tauri::{CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent, Manager};
use std::path::PathBuf;
use std::fs;

// ============================================================================
// AUTHENTICATION NOTE:
// OAuth (Google, Apple, X/Twitter) is handled by Clerk via web UI
// No Rust OAuth code needed - Clerk handles everything!
// ============================================================================

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
    
    fs::write(&config_path, json)
        .map_err(|e| format!("Failed to write config: {}", e))?;
    
    println!("💾 Watcher config saved for auto-start");
    Ok(())
}

/// Clear watcher config (disable auto-start) (called from frontend)
#[tauri::command]
fn clear_watcher_config_cmd() -> Result<(), String> {
    let config_path = get_watcher_config_path();
    if config_path.exists() {
        fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove config: {}", e))?;
        println!("🗑️ Watcher config cleared (auto-start disabled)");
    }
    Ok(())
}

fn main() {
  // Create system tray menu with native timer widget access
  let quit = CustomMenuItem::new("quit".to_string(), "Quit");
  let show_widget = CustomMenuItem::new("show_widget".to_string(), "Show Focus Timer");
  let tray_menu = SystemTrayMenu::new()
    .add_item(show_widget)
    .add_item(quit);
  
  let system_tray = SystemTray::new().with_menu(tray_menu);

  tauri::Builder::default()
    // Only expose native macOS features - auth is handled by Clerk
    .invoke_handler(tauri::generate_handler![
      native_widget::create_native_timer_widget,
      native_widget::close_native_timer_widget,
      native_widget::write_auth_token_to_file,
      native_widget::check_dashboard_refresh_trigger,
      native_widget::check_token_refresh_request,
      native_widget::show_native_microphone_permission_dialog,
      native_widget::check_native_microphone_permission,
      native_widget::start_native_speech_recognition,
      native_widget::stop_native_speech_recognition,
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
      // Database maintenance & diagnostics
      watcher::get_watcher_db_stats,
      watcher::cleanup_old_events,
      watcher::export_events,
      // Focus metrics
      watcher::get_focus_metrics,
      // Real-time status
      watcher::get_watcher_extended_status,
      // App icon extraction
      watcher::get_app_icon,
      watcher::get_app_icons_batch,
      // Watcher config persistence for auto-start
      save_watcher_config_cmd,
      clear_watcher_config_cmd
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
          _ => {}
        }
      }
      _ => {}
    })
    .setup(|app| {
      // Handle deep link URLs (ritual://)
      let handle = app.handle();
      
      // Configure window size but keep it hidden - frontend will show it when React is ready
      // This prevents the "tiny window flash" caused by showing before webview loads
      if let Some(window) = app.get_window("main") {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1200.0, height: 850.0 }));
        let _ = window.center();
        // Window stays hidden (visible: false in config) until frontend shows it
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
      
      #[cfg(target_os = "macos")]
      {
        app.listen_global("open-url", move |event| {
          if let Some(payload) = event.payload() {
            println!("🔗 Deep link received: {}", payload);
            
            // Forward the deep link to the frontend
            // In production, the app loads from tauri://localhost, so we use relative navigation
            if let Some(window) = handle.get_window("main") {
              let _ = window.eval(&format!(
                "window.location.href = '/auth/callback?deepLink={}';",
                payload
              ));
            }
          }
        });
      }
      
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
