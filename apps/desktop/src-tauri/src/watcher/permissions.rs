use std::process::Command;


#[tauri::command]
pub fn check_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Request accessibility permissions (macOS only)
#[tauri::command]
pub fn request_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        use core_foundation::base::TCFType;
        use core_foundation::boolean::CFBoolean;
        use core_foundation::dictionary::CFDictionary;
        use core_foundation::string::CFString;

        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
        }

        unsafe {
            let key = CFString::new("AXTrustedCheckOptionPrompt");
            let value = CFBoolean::true_value();

            let options = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);

            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as *const _)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Open System Preferences to Accessibility settings
#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn()
            .map_err(|e| format!("Failed to open settings: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Not supported on this platform".to_string())
    }
}

fn open_macos_privacy_pane(pane: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(format!(
                "x-apple.systempreferences:com.apple.preference.security?{}",
                pane
            ))
            .spawn()
            .map_err(|e| format!("Failed to open settings: {}", e))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pane;
        Err("Not supported on this platform".to_string())
    }
}

/// Open System Settings to Full Disk Access. macOS does not provide a programmatic
/// grant prompt for this permission, so onboarding can only deep-link the pane.
#[tauri::command]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    open_macos_privacy_pane("Privacy_AllFiles")
}

#[tauri::command]
pub fn open_microphone_settings() -> Result<(), String> {
    open_macos_privacy_pane("Privacy_Microphone")
}

#[tauri::command]
pub fn open_speech_recognition_settings() -> Result<(), String> {
    open_macos_privacy_pane("Privacy_SpeechRecognition")
}

#[tauri::command]
pub fn open_screen_recording_settings() -> Result<(), String> {
    open_macos_privacy_pane("Privacy_ScreenCapture")
}

#[tauri::command]
pub fn open_input_monitoring_settings() -> Result<(), String> {
    open_macos_privacy_pane("Privacy_ListenEvent")
}

#[tauri::command]
pub fn open_location_settings() -> Result<(), String> {
    open_macos_privacy_pane("Privacy_LocationServices")
}
