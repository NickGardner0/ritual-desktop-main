// FFI bindings for Swift components
#[cfg(target_os = "macos")]
extern "C" {
    fn show_microphone_permission_dialog() -> bool;
    fn check_microphone_permission() -> bool;
    fn start_speech_recognition() -> bool;
    fn stop_speech_recognition() -> bool;
}

#[tauri::command]
pub fn create_native_timer_widget() {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    println!("🚀 Creating native Swift timer widget...");

    // Candidate executable paths (depending on current working directory)
    let candidates: [PathBuf; 2] = [
        Path::new("src-tauri/target/release/NativeTimerWidget").to_path_buf(),
        Path::new("target/release/NativeTimerWidget").to_path_buf(),
    ];

    let mut exec_path: Option<PathBuf> = candidates.iter().find(|p| p.exists()).cloned();

    println!("🔍 Current working directory: {:?}", std::env::current_dir().unwrap_or_default());
    if exec_path.is_none() {
        println!("⚠️  Native widget executable not found. Attempting to build via build_widget.sh...");

        // Locate build script for both possible CWDs
        let script_candidates = [
            Path::new("native-timer/build_widget.sh").to_path_buf(),
            Path::new("src-tauri/native-timer/build_widget.sh").to_path_buf(),
        ];
        let script_path = script_candidates
            .iter()
            .find(|p| p.exists())
            .cloned();

        if let Some(script) = script_path {
            // Ensure executable permission and run
            let _ = Command::new("bash")
                .arg("-c")
                .arg(format!("chmod +x '{}' && '{}'", script.display(), script.display()))
                .status();

            // Re-check for executable after build
            exec_path = candidates.iter().find(|p| p.exists()).cloned();
        } else {
            println!("❌ Could not find build script 'native-timer/build_widget.sh'.");
        }
    }

    match exec_path {
        Some(path) => {
            println!("🔍 Using widget executable at: {:?}", path);
            match Command::new(&path).spawn() {
                Ok(_) => println!("✅ Native Swift timer widget launched successfully!"),
                Err(e) => {
                    println!("❌ Failed to launch native Swift widget: {}", e);
                    println!("🔧 Attempting to build widget and retry launch...");

                    // Try to build, then retry once
                    let script_candidates = [
                        Path::new("native-timer/build_widget.sh").to_path_buf(),
                        Path::new("src-tauri/native-timer/build_widget.sh").to_path_buf(),
                    ];
                    if let Some(script) = script_candidates.iter().find(|p| p.exists()).cloned() {
                        let _ = Command::new("bash")
                            .arg("-c")
                            .arg(format!("chmod +x '{}' && '{}'", script.display(), script.display()))
                            .status();

                        let retry_candidates = [
                            Path::new("src-tauri/target/release/NativeTimerWidget").to_path_buf(),
                            Path::new("target/release/NativeTimerWidget").to_path_buf(),
                        ];
                        if let Some(retry_path) = retry_candidates.iter().find(|p| p.exists()).cloned() {
                            println!("🔁 Retrying launch using: {:?}", retry_path);
                            match Command::new(&retry_path).spawn() {
                                Ok(_) => println!("✅ Native Swift timer widget launched successfully after build!"),
                                Err(e2) => {
                                    println!("❌ Retry launch failed: {}", e2);
                                    println!("🔄 If the problem persists, try running the build script manually: 'bash native-timer/build_widget.sh' (from src-tauri)");
                                }
                            }
                        } else {
                            println!("❌ Build step did not produce the expected executable.");
                        }
                    } else {
                        println!("❌ Could not find build script to attempt auto-build on failure.");
                    }
                }
            }
        }
        None => {
            println!("❌ Failed to locate or build the native widget executable.");
            println!("🔄 Ensure Xcode Command Line Tools are installed and run 'bash native-timer/build_widget.sh' from 'src-tauri/'.");
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

#[tauri::command]
pub async fn check_token_refresh_request() -> Result<f64, String> {
    use std::fs;
    use std::env;
    
    let temp_dir = env::temp_dir();
    let request_file = temp_dir.join("ritual_refresh_token_request.txt");
    
    match fs::read_to_string(&request_file) {
        Ok(timestamp_str) => {
            match timestamp_str.trim().parse::<f64>() {
                Ok(timestamp) => {
                    // Delete the request file after reading
                    let _ = fs::remove_file(&request_file);
                    Ok(timestamp)
                }
                Err(_) => Ok(0.0),
            }
        }
        Err(_) => Ok(0.0),
    }
}

#[tauri::command]
pub async fn show_native_microphone_permission_dialog() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        println!("🎤 Showing native macOS microphone permission dialog...");
        
        unsafe {
            let granted = show_microphone_permission_dialog();
            println!("🎤 Microphone permission result: {}", granted);
            Ok(granted)
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        println!("🎤 Native microphone permission dialog not available on this platform");
        Ok(false)
    }
}

#[tauri::command]
pub async fn check_native_microphone_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        println!("🎤 Checking native microphone permission...");
        
        unsafe {
            let has_permission = check_microphone_permission();
            println!("🎤 Current microphone permission: {}", has_permission);
            Ok(has_permission)
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        println!("🎤 Native microphone permission check not available on this platform");
        Ok(false)
    }
}


#[tauri::command]
pub async fn start_native_speech_recognition() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        println!("🎤 Starting native speech recognition...");
        
        unsafe {
            let success = start_speech_recognition();
            if success {
                println!("✅ Native speech recognition started successfully");
                Ok(())
            } else {
                println!("❌ Failed to start native speech recognition");
                Err("Failed to start speech recognition".to_string())
            }
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        println!("🎤 Native speech recognition not available on this platform");
        Err("Speech recognition not supported on this platform".to_string())
    }
}

#[tauri::command]
pub async fn stop_native_speech_recognition() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        println!("🎤 Stopping native speech recognition...");
        
        unsafe {
            let success = stop_speech_recognition();
            if success {
                println!("✅ Native speech recognition stopped successfully");
                Ok(())
            } else {
                println!("❌ Failed to stop native speech recognition");
                Err("Failed to stop speech recognition".to_string())
            }
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        println!("🎤 Native speech recognition not available on this platform");
        Err("Speech recognition not supported on this platform".to_string())
    }
}