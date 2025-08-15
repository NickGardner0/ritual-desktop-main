// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native_widget;

use tauri::{CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayEvent, Manager};

fn main() {
  // Create system tray menu
  let quit = CustomMenuItem::new("quit".to_string(), "Quit");
  let show_widget = CustomMenuItem::new("show_widget".to_string(), "Show Focus Timer");
  let tray_menu = SystemTrayMenu::new()
    .add_item(show_widget)
    .add_item(quit);
  
  let system_tray = SystemTray::new().with_menu(tray_menu);

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![native_widget::create_native_timer_widget, native_widget::close_native_timer_widget, native_widget::write_auth_token_to_file, native_widget::check_dashboard_refresh_trigger])
    .system_tray(system_tray)
    .on_system_tray_event(|app, event| match event {
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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn create_enhanced_widget(app: &tauri::AppHandle) {
  let window_label = format!("enhanced-widget-{}", chrono::Utc::now().timestamp_millis());
  
  println!("🔧 Creating enhanced Tauri widget with native-like styling...");
  
  let window_result = tauri::WindowBuilder::new(
    app,
    &window_label,
    tauri::WindowUrl::App("/widget".into())
  )
  .title("Focus Timer")
  .inner_size(320.0, 50.0)
  .min_inner_size(320.0, 50.0)
  .max_inner_size(320.0, 50.0)
  .resizable(false)
  .decorations(false)
  .always_on_top(true)
  .skip_taskbar(true)
  .center()
  .build();
  
  match window_result {
    Ok(_) => println!("✅ Enhanced timer widget created successfully!"),
    Err(e) => println!("❌ Failed to create enhanced widget: {}", e),
  }
}