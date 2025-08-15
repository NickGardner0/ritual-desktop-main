// FFI bindings for Swift TimerWidget (temporarily disabled)
// extern "C" {
//     fn launch_floating_timer();
// }

#[tauri::command]
pub fn create_native_timer_widget() {
    println!("🚀 Creating native Swift timer widget...");
    
    // Launch the native Swift widget as a separate process
    use std::process::Command;
    
    match Command::new("target/release/NativeTimerWidget")
        .spawn() 
    {
        Ok(_) => {
            println!("✅ Native Swift timer widget launched successfully!");
        }
        Err(e) => {
            println!("❌ Failed to launch native Swift widget: {}", e);
            println!("🔄 Make sure the widget was built successfully");
        }
    }
}

#[tauri::command] 
pub fn close_native_timer_widget() {
    println!("🔴 Close native Swift timer widget requested (disabled)");
    // TODO: Add close function to Swift and call it here
}

#[tauri::command]
pub async fn write_auth_token_to_file(token: String) -> Result<String, String> {
    println!("🔐 Writing auth token to file for native widget...");
    
    use std::fs;
    use std::env;
    
    let temp_dir = env::temp_dir();
    let token_file = temp_dir.join("ritual_auth_token.txt");
    
    match fs::write(&token_file, &token) {
        Ok(_) => {
            println!("✅ Auth token written to: {:?}", token_file);
            println!("🔐 Token preview: {}...", &token[..std::cmp::min(20, token.len())]);
            Ok(format!("Token written to: {:?}", token_file))
        }
        Err(e) => {
            println!("❌ Failed to write token file: {}", e);
            Err(format!("Failed to write token file: {}", e))
        }
    }
}

#[tauri::command]
pub async fn check_dashboard_refresh_trigger() -> Result<f64, String> {
    use std::fs;
    use std::env;
    
    let temp_dir = env::temp_dir();
    let trigger_file = temp_dir.join("ritual_timer_updated.txt");
    
    match fs::read_to_string(&trigger_file) {
        Ok(timestamp_str) => {
            match timestamp_str.trim().parse::<f64>() {
                Ok(timestamp) => Ok(timestamp),
                Err(_) => Ok(0.0), // Invalid timestamp, return 0
            }
        }
        Err(_) => Ok(0.0), // File doesn't exist or can't be read, return 0
    }
}