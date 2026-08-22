//! App Icon Extraction for macOS
//!
//! Extracts application icons using NSWorkspace and caches them as PNG files.
//! Similar approach to Cronus (cronushq.com) for displaying app icons.

#![allow(dead_code)]

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tracing::{debug, info, warn};

/// Cache directory for app icons
fn get_icon_cache_dir() -> PathBuf {
    crate::paths::data_dir().join("icons")
}

/// Ensure icon cache directory exists
pub fn ensure_icon_cache() -> std::io::Result<PathBuf> {
    let cache_dir = get_icon_cache_dir();
    fs::create_dir_all(&cache_dir)?;
    Ok(cache_dir)
}

/// Get the cached icon path for a bundle ID
pub fn get_cached_icon_path(bundle_id: &str) -> PathBuf {
    let safe_name = bundle_id.replace('.', "_").replace('/', "_");
    get_icon_cache_dir().join(format!("{}.png", safe_name))
}

/// Check if we have a cached icon for this bundle ID
pub fn has_cached_icon(bundle_id: &str) -> bool {
    get_cached_icon_path(bundle_id).exists()
}

/// Extract and cache an app icon for a given bundle ID
/// Returns the path to the cached PNG icon
pub fn extract_app_icon(bundle_id: &str) -> Option<PathBuf> {
    // Check cache first
    let cache_path = get_cached_icon_path(bundle_id);
    if cache_path.exists() {
        debug!("Using cached icon for {}", bundle_id);
        return Some(cache_path);
    }

    // Ensure cache directory exists
    if let Err(e) = ensure_icon_cache() {
        warn!("Failed to create icon cache directory: {}", e);
        return None;
    }

    // Use AppleScript to extract the icon
    // This is more reliable than direct objc calls for icon extraction
    extract_icon_via_applescript(bundle_id, &cache_path)
}

/// Extract icon using AppleScript/shell commands
/// This approach is more reliable and doesn't require complex objc image handling
fn extract_icon_via_applescript(bundle_id: &str, output_path: &PathBuf) -> Option<PathBuf> {
    // First, get the app path from bundle ID
    let app_path = get_app_path_from_bundle_id(bundle_id)?;

    // Use sips (built into macOS) to extract and convert the icon
    // The icon is in AppName.app/Contents/Resources/*.icns
    let icns_path = find_icns_in_app(&app_path)?;

    // Convert .icns to .png using sips
    let output = Command::new("sips")
        .args([
            "-s",
            "format",
            "png",
            "-z",
            "64",
            "64", // Resize to 64x64
            &icns_path,
            "--out",
            output_path.to_str()?,
        ])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            info!("Extracted icon for {} to {:?}", bundle_id, output_path);
            Some(output_path.clone())
        }
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            debug!("sips failed for {}: {}", bundle_id, stderr);
            None
        }
        Err(e) => {
            warn!("Failed to run sips for {}: {}", bundle_id, e);
            None
        }
    }
}

/// Get the application path from a bundle identifier
fn get_app_path_from_bundle_id(bundle_id: &str) -> Option<String> {
    // Use mdfind to locate the app by bundle ID
    let output = Command::new("mdfind")
        .args([&format!("kMDItemCFBundleIdentifier == '{}'", bundle_id)])
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let paths: Vec<&str> = stdout.lines().collect();

        // Find the first .app bundle
        for path in paths {
            if path.ends_with(".app") {
                return Some(path.to_string());
            }
        }
    }

    // Fallback: try common locations
    let common_locations = [
        "/Applications",
        "/System/Applications",
        "/System/Applications/Utilities",
        &format!("{}/Applications", std::env::var("HOME").unwrap_or_default()),
    ];

    for location in common_locations {
        // Try to find by app name derived from bundle ID
        let app_name_guess = bundle_id.split('.').last().unwrap_or(bundle_id);

        let potential_path = format!("{}/{}.app", location, app_name_guess);
        if std::path::Path::new(&potential_path).exists() {
            return Some(potential_path);
        }
    }

    debug!("Could not find app path for bundle ID: {}", bundle_id);
    None
}

/// Find the .icns file inside an app bundle
fn find_icns_in_app(app_path: &str) -> Option<String> {
    let resources_path = format!("{}/Contents/Resources", app_path);

    // Read the Info.plist to get the icon file name
    let info_plist = format!("{}/Contents/Info.plist", app_path);

    // Try to read CFBundleIconFile from plist
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIconFile", &info_plist])
        .output()
        .ok()?;

    let icon_name = if output.status.success() {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if name.ends_with(".icns") {
            name
        } else {
            format!("{}.icns", name)
        }
    } else {
        // Default icon name
        "AppIcon.icns".to_string()
    };

    let icon_path = format!("{}/{}", resources_path, icon_name);

    if std::path::Path::new(&icon_path).exists() {
        return Some(icon_path);
    }

    // Fallback: find any .icns file in Resources
    if let Ok(entries) = fs::read_dir(&resources_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "icns").unwrap_or(false) {
                return path.to_str().map(|s| s.to_string());
            }
        }
    }

    debug!("No .icns file found in {}", resources_path);
    None
}

/// Extract icons for multiple bundle IDs (batch operation)
pub fn extract_icons_batch(bundle_ids: &[&str]) -> Vec<(String, Option<PathBuf>)> {
    bundle_ids
        .iter()
        .map(|id| (id.to_string(), extract_app_icon(id)))
        .collect()
}

/// Get icon as base64 encoded PNG (for frontend use)
pub fn get_icon_base64(bundle_id: &str) -> Option<String> {
    use base64::Engine;
    let icon_path = extract_app_icon(bundle_id)?;
    let icon_data = fs::read(&icon_path).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(&icon_data))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_icon_cache_path() {
        let path = get_cached_icon_path("com.apple.Safari");
        assert!(path.to_str().unwrap().contains("com_apple_Safari.png"));
    }

    #[test]
    fn test_extract_safari_icon() {
        // This test requires macOS
        if cfg!(target_os = "macos") {
            let result = extract_app_icon("com.apple.Safari");
            println!("Safari icon result: {:?}", result);
            // Safari should exist on all Macs
            assert!(result.is_some());
        }
    }
}
