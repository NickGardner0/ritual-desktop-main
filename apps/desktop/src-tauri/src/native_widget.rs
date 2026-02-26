// FFI bindings for Swift components
#[cfg(target_os = "macos")]
extern "C" {
    fn show_microphone_permission_dialog() -> bool;
    fn check_microphone_permission() -> bool;
    fn start_speech_recognition() -> bool;
    fn stop_speech_recognition() -> bool;
}

fn native_widget_process_running() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        match Command::new("pgrep")
            .args(["-x", "NativeTimerWidget"])
            .output()
        {
            Ok(output) => output.status.success() && !output.stdout.is_empty(),
            Err(e) => {
                eprintln!("⚠️ Could not check NativeTimerWidget process state via pgrep: {}", e);
                false
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn terminate_native_widget_processes() {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        use std::time::Duration;

        match Command::new("pkill").args(["-x", "NativeTimerWidget"]).status() {
            Ok(status) => {
                if status.success() {
                    println!("🛑 Terminated existing NativeTimerWidget process");
                }
            }
            Err(e) => {
                eprintln!("⚠️ Could not terminate NativeTimerWidget via pkill: {}", e);
            }
        }

        std::thread::sleep(Duration::from_millis(140));
    }
}

fn build_native_timer_widget_if_possible() {
    use std::path::Path;
    use std::process::Command;

    // Locate build script for both possible CWDs.
    let script_candidates = [
        Path::new("native-timer/build_widget.sh").to_path_buf(),
        Path::new("src-tauri/native-timer/build_widget.sh").to_path_buf(),
    ];
    let script_path = script_candidates.iter().find(|p| p.exists()).cloned();

    if let Some(script) = script_path {
        let _ = Command::new("bash")
            .arg("-c")
            .arg(format!(
                "chmod +x '{}' && '{}'",
                script.display(),
                script.display()
            ))
            .status();
    } else {
        println!("❌ Could not find build script 'native-timer/build_widget.sh'.");
    }
}

fn native_widget_needs_rebuild(exec_path: &std::path::Path) -> bool {
    use std::fs;
    use std::path::Path;

    let binary_metadata = match fs::metadata(exec_path) {
        Ok(metadata) => metadata,
        Err(_) => return true,
    };

    let binary_modified = match binary_metadata.modified() {
        Ok(mtime) => mtime,
        Err(_) => return true,
    };

    // Candidate Swift source paths depending on current working directory.
    let source_candidates = [
        Path::new("native-timer/Package.swift"),
        Path::new("native-timer/TimerWidgetApp.swift"),
        Path::new("native-timer/MicrophonePermission.swift"),
        Path::new("native-timer/SpeechRecognition.swift"),
        Path::new("native-timer/Notch/NotchController.swift"),
        Path::new("native-timer/Notch/NotchTimerView.swift"),
        Path::new("native-timer/Notch/NotchHabitPicker.swift"),
        Path::new("native-timer/Notch/NotchVoiceViews.swift"),
        Path::new("native-timer/Stores/TimerSessionStore.swift"),
        Path::new("native-timer/Hotkeys/ModifierEventTap.swift"),
        Path::new("native-timer/Hotkeys/GlobalHotkey.swift"),
        Path::new("native-timer/Permissions/AccessibilityPermission.swift"),
        Path::new("native-timer/Speech/SpeechEngine.swift"),
        Path::new("native-timer/Speech/VoicePermissions.swift"),
        Path::new("src-tauri/native-timer/Package.swift"),
        Path::new("src-tauri/native-timer/TimerWidgetApp.swift"),
        Path::new("src-tauri/native-timer/MicrophonePermission.swift"),
        Path::new("src-tauri/native-timer/SpeechRecognition.swift"),
        Path::new("src-tauri/native-timer/Notch/NotchController.swift"),
        Path::new("src-tauri/native-timer/Notch/NotchTimerView.swift"),
        Path::new("src-tauri/native-timer/Notch/NotchHabitPicker.swift"),
        Path::new("src-tauri/native-timer/Notch/NotchVoiceViews.swift"),
        Path::new("src-tauri/native-timer/Stores/TimerSessionStore.swift"),
        Path::new("src-tauri/native-timer/Hotkeys/ModifierEventTap.swift"),
        Path::new("src-tauri/native-timer/Hotkeys/GlobalHotkey.swift"),
        Path::new("src-tauri/native-timer/Permissions/AccessibilityPermission.swift"),
        Path::new("src-tauri/native-timer/Speech/SpeechEngine.swift"),
        Path::new("src-tauri/native-timer/Speech/VoicePermissions.swift"),
    ];

    for source in source_candidates {
        if !source.exists() {
            continue;
        }

        match fs::metadata(source).and_then(|metadata| metadata.modified()) {
            Ok(source_modified) => {
                if source_modified > binary_modified {
                    println!(
                        "🔨 Native widget rebuild required: {:?} is newer than binary",
                        source
                    );
                    return true;
                }
            }
            Err(_) => return true,
        }
    }

    false
}

fn launch_native_timer_widget(force_restart: bool) {
    use std::path::{Path, PathBuf};
    use std::process::Command;

    println!("🚀 Creating native Swift timer widget...");

    if force_restart {
        terminate_native_widget_processes();
    } else if native_widget_process_running() {
        println!("ℹ️ Native Swift timer widget already running; skipping duplicate launch");
        return;
    }

    // Prefer the .app bundle launched via `open` so macOS Launch Services
    // registers the bundle identity (required for permission dialogs to
    // list the app in System Settings).  Fall back to the bare binary.
    let app_bundle_candidates: [PathBuf; 2] = [
        Path::new("src-tauri/target/release/NativeTimerWidget.app").to_path_buf(),
        Path::new("target/release/NativeTimerWidget.app").to_path_buf(),
    ];
    let bare_candidates: [PathBuf; 2] = [
        Path::new("src-tauri/target/release/NativeTimerWidget").to_path_buf(),
        Path::new("target/release/NativeTimerWidget").to_path_buf(),
    ];

    let parent_pid = std::process::id().to_string();

    let find_app_bundle = || -> Option<PathBuf> {
        app_bundle_candidates.iter().find(|p| p.exists()).cloned()
    };
    let find_bare = || -> Option<PathBuf> {
        bare_candidates.iter().find(|p| p.exists()).cloned()
    };
    let find_any_binary = || -> Option<PathBuf> {
        // For rebuild-check we need the actual binary, not the .app dir
        let bin_inside_app: Vec<PathBuf> = app_bundle_candidates
            .iter()
            .map(|p| p.join("Contents/MacOS/NativeTimerWidget"))
            .collect();
        bin_inside_app
            .iter()
            .find(|p| p.exists())
            .cloned()
            .or_else(|| bare_candidates.iter().find(|p| p.exists()).cloned())
    };

    println!("🔍 Current working directory: {:?}", std::env::current_dir().unwrap_or_default());

    // Check if a build exists; if not, or if stale, rebuild.
    match find_any_binary() {
        None => {
            println!("⚠️ Native widget executable not found. Attempting to build via build_widget.sh...");
            build_native_timer_widget_if_possible();
        }
        Some(bin) => {
            if native_widget_needs_rebuild(&bin) {
                println!("🔄 Rebuilding native widget to pick up latest Swift changes...");
                build_native_timer_widget_if_possible();
            }
        }
    }

    // Launch: prefer .app bundle via `open` (absolute path required), fall back to bare binary.
    if let Some(bundle_path) = find_app_bundle() {
        let abs_bundle = std::fs::canonicalize(&bundle_path).unwrap_or(bundle_path);
        let bundle_str = abs_bundle.to_string_lossy().to_string();
        println!("🔍 Launching widget via `open -n -a {}`", bundle_str);
        match Command::new("open")
            .args([
                "-n",
                "-a",
                &bundle_str,
                "--args",
                &format!("--parent-pid={}", parent_pid),
            ])
            .output()
        {
            Ok(output) if output.status.success() => {
                println!("✅ Native Swift timer widget launched successfully!");
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                println!("⚠️ `open` exited with {}: {}", output.status, stderr.trim());
                println!("⚠️ Falling back to direct binary exec");
                launch_bare_binary(find_bare(), &parent_pid);
            }
            Err(e) => {
                println!("⚠️ `open` failed ({}), falling back to direct exec", e);
                launch_bare_binary(find_bare(), &parent_pid);
            }
        }
    } else if let Some(bare_path) = find_bare() {
        println!("🔍 No .app bundle found, using bare binary: {:?}", bare_path);
        launch_bare_binary(Some(bare_path), &parent_pid);
    } else {
        println!("❌ No widget executable found. Trying build + retry...");
        build_native_timer_widget_if_possible();
        if let Some(bundle_path) = find_app_bundle() {
            let abs_bundle = std::fs::canonicalize(&bundle_path).unwrap_or(bundle_path);
            let bundle_str = abs_bundle.to_string_lossy().to_string();
            let _ = Command::new("open")
                .args(["-n", "-a", &bundle_str, "--args", &format!("--parent-pid={}", parent_pid)])
                .output();
        } else {
            launch_bare_binary(find_bare(), &parent_pid);
        }
    }
}

fn launch_bare_binary(path: Option<std::path::PathBuf>, parent_pid: &str) {
    use std::process::Command;

    match path {
        Some(p) => {
            println!("🔍 Using bare widget binary at: {:?}", p);
            match Command::new(&p)
                .env("RITUAL_PARENT_PID", parent_pid)
                .spawn()
            {
                Ok(_) => println!("✅ Native Swift timer widget launched (bare binary)!"),
                Err(e) => {
                    println!("❌ Failed to launch native Swift widget: {}", e);
                    println!("🔄 If the problem persists, try: 'bash native-timer/build_widget.sh' from 'src-tauri/'.");
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
pub fn create_native_timer_widget() {
    launch_native_timer_widget(false);
}

pub fn restart_native_timer_widget() {
    launch_native_timer_widget(true);
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
