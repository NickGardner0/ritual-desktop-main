// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native_widget;
mod recorder;
mod watcher;
mod ritual_database;

use tauri::{CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent, Manager};
use std::path::PathBuf;
use std::fs;
use std::env;

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
// - Production: https://app.ritual.app (when deployed to Vercel)
//
// Set RITUAL_ENV environment variable to control which URL is used.
// Default is "development" for local dev workflow.
// ============================================================================

/// Get the app URL based on environment
/// This follows the Midday pattern where the desktop app loads from a hosted URL
fn get_app_url() -> String {
    // Check runtime env var first, then compile-time, then default to development
    let env = env::var("RITUAL_ENV")
        .unwrap_or_else(|_| {
            option_env!("RITUAL_ENV")
                .unwrap_or("development")
                .to_string()
        });

    println!("🌍 Ritual environment: {}", env);

    match env.as_str() {
        "development" | "dev" => {
            let url = "http://localhost:3000".to_string();
            println!("🌍 Using development URL: {}", url);
            url
        },
        "staging" => {
            // TODO: Update this when you have a staging environment
            let url = env::var("RITUAL_STAGING_URL")
                .unwrap_or_else(|_| "https://staging.ritual.app".to_string());
            println!("🌍 Using staging URL: {}", url);
            url
        },
        "production" | "prod" => {
            // TODO: Update this when you deploy to Vercel
            let url = env::var("RITUAL_PROD_URL")
                .unwrap_or_else(|_| "https://app.ritual.app".to_string());
            println!("🌍 Using production URL: {}", url);
            url
        },
        _ => {
            eprintln!("⚠️ Unknown environment: {}, defaulting to development", env);
            let url = "http://localhost:3000".to_string();
            println!("🌍 Using fallback development URL: {}", url);
            url
        }
    }
}

/// Show the main window (called from frontend when React is ready)
#[tauri::command]
fn show_main_window(window: tauri::Window) -> Result<(), String> {
    window.show().map_err(|e| format!("Failed to show window: {}", e))?;
    window.set_focus().map_err(|e| format!("Failed to focus window: {}", e))?;
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
      // Window management
      show_main_window,
      // Native widget commands
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
      clear_watcher_config_cmd,
      // Ritual Recorder commands for screen recording and OCR
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
      // Ritual Database commands (unified libSQL with vector search)
      ritual_database::init_ritual_database,
      ritual_database::get_ritual_db_stats,
      ritual_database::init_embedding_service,
      ritual_database::get_embedding_stats,
      ritual_database::semantic_search,
      ritual_database::text_search,
      ritual_database::hybrid_search,
      ritual_database::process_embeddings,
      ritual_database::check_migration_status,
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
          _ => {}
        }
      }
      _ => {}
    })
    .setup(|app| {
      // Handle deep link URLs (ritual://)
      let handle = app.handle();
      
      // Get the app URL based on environment (Midday pattern)
      let app_url = get_app_url();
      
      // Configure window and navigate to the correct URL
      if let Some(window) = app.get_window("main") {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1100.0, height: 800.0 }));
        let _ = window.center();
        
        // Navigate to the app URL (this overrides tauri.conf.json devPath/distDir)
        // This allows us to load from localhost in dev or hosted URL in production
        println!("🚀 Navigating to: {}", app_url);
        let _ = window.eval(&format!("window.location.replace('{}');", app_url));
        
        // Fallback timer: show window after 3 seconds if frontend hasn't shown it
        // This prevents the app from appearing stuck if there's a loading issue
        let window_clone = window.clone();
        std::thread::spawn(move || {
          std::thread::sleep(std::time::Duration::from_secs(3));
          
          // Check if window is still hidden
          if let Ok(is_visible) = window_clone.is_visible() {
            if !is_visible {
              println!("⏰ Fallback timer: showing window after 3s");
              let _ = window_clone.show();
              let _ = window_clone.set_focus();
            }
          }
        });
      }
      
      // Initialize Ritual Database (unified libSQL with vector search)
      // This also handles migration from legacy databases
      match ritual_database::initialize_database() {
        Ok(()) => {
          println!("✅ Ritual unified database ready");
          // Auto-start embedding worker if there are frames without embeddings
          ritual_database::auto_start_embedding_worker();
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
      
      // Auto-start Ritual Recorder if previously enabled
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
