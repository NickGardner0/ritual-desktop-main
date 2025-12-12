// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native_widget;

use tauri::{CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent, Manager};

// ============================================================================
// AUTHENTICATION NOTE:
// OAuth (Google, Apple, X/Twitter) is handled by Clerk via web UI
// No Rust OAuth code needed - Clerk handles everything!
// ============================================================================

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
      native_widget::stop_native_speech_recognition
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
      
      // Force window size to override macOS state restoration
      if let Some(window) = app.get_window("main") {
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: 1100, height: 800 }));
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
