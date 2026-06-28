use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppIconResponse {
    pub bundle_id: String,
    pub icon_path: Option<String>,
    pub icon_base64: Option<String>,
}

fn get_app_icon_impl(bundle_id: String) -> Result<AppIconResponse, String> {
    let started_at = Instant::now();
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let cache_dir = home.join(".ritual").join("icons");

        // Ensure cache directory exists
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create icon cache: {}", e))?;

        // Create safe filename from bundle ID
        let safe_name = bundle_id.replace('.', "_").replace('/', "_");
        let cache_path = cache_dir.join(format!("{}.png", safe_name));

        // Check if already cached
        if cache_path.exists() {
            use base64::Engine;
            let icon_data = std::fs::read(&cache_path)
                .map_err(|e| format!("Failed to read cached icon: {}", e))?;
            let base64_data = base64::engine::general_purpose::STANDARD.encode(&icon_data);
            watcher_info!(
                "get_app_icon bundle_id={} cache_hit=true duration_ms={}",
                bundle_id,
                started_at.elapsed().as_millis()
            );

            return Ok(AppIconResponse {
                bundle_id,
                icon_path: Some(cache_path.to_string_lossy().to_string()),
                icon_base64: Some(base64_data),
            });
        }

        // Extract icon using macOS tools
        if let Some(icon_path) = extract_app_icon_macos(&bundle_id, &cache_path) {
            use base64::Engine;
            let icon_data =
                std::fs::read(&icon_path).map_err(|e| format!("Failed to read icon: {}", e))?;
            let base64_data = base64::engine::general_purpose::STANDARD.encode(&icon_data);
            watcher_info!(
                "get_app_icon bundle_id={} cache_hit=false extracted=true duration_ms={}",
                bundle_id,
                started_at.elapsed().as_millis()
            );

            return Ok(AppIconResponse {
                bundle_id,
                icon_path: Some(icon_path),
                icon_base64: Some(base64_data),
            });
        }

        watcher_info!(
            "get_app_icon bundle_id={} cache_hit=false extracted=false duration_ms={}",
            bundle_id,
            started_at.elapsed().as_millis()
        );
        Ok(AppIconResponse {
            bundle_id,
            icon_path: None,
            icon_base64: None,
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(AppIconResponse {
            bundle_id,
            icon_path: None,
            icon_base64: None,
        })
    }
}

/// Get app icon for a bundle ID
/// Extracts the icon from the app bundle and caches it
#[tauri::command]
pub async fn get_app_icon(bundle_id: String) -> Result<AppIconResponse, String> {
    tauri::async_runtime::spawn_blocking(move || get_app_icon_impl(bundle_id))
        .await
        .map_err(|e| format!("Failed to join get_app_icon task: {}", e))?
}

/// Get icons for multiple bundle IDs at once (batch operation)
#[tauri::command]
pub async fn get_app_icons_batch(bundle_ids: Vec<String>) -> Result<Vec<AppIconResponse>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        let mut results = Vec::new();
        let requested = bundle_ids.len();

        for bundle_id in bundle_ids {
            match get_app_icon_impl(bundle_id.clone()) {
                Ok(response) => results.push(response),
                Err(_) => results.push(AppIconResponse {
                    bundle_id,
                    icon_path: None,
                    icon_base64: None,
                }),
            }
        }

        watcher_info!(
            "get_app_icons_batch requested={} returned={} duration_ms={}",
            requested,
            results.len(),
            started_at.elapsed().as_millis()
        );

        Ok(results)
    })
    .await
    .map_err(|e| format!("Failed to join get_app_icons_batch task: {}", e))?
}

/// Extract app icon on macOS using system tools
#[cfg(target_os = "macos")]
fn extract_app_icon_macos(bundle_id: &str, output_path: &std::path::PathBuf) -> Option<String> {
    use std::process::Command;

    // Step 1: Find the app path from bundle ID using mdfind
    let app_path = {
        let output = Command::new("mdfind")
            .args([&format!("kMDItemCFBundleIdentifier == '{}'", bundle_id)])
            .output()
            .ok()?;

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout
                .lines()
                .find(|line| line.ends_with(".app"))
                .map(|s| s.to_string())
        } else {
            None
        }
    };

    let app_path = app_path.or_else(|| {
        // Fallback: check common locations
        let app_name = bundle_id.split('.').last()?;
        let locations = [
            "/Applications",
            "/System/Applications",
            "/System/Applications/Utilities",
        ];

        for loc in locations {
            let path = format!("{}/{}.app", loc, app_name);
            if std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
        None
    })?;

    // Step 2: Find the .icns file in the app bundle
    let icns_path = find_icns_file(&app_path)?;

    // Step 3: Convert .icns to .png using sips
    let output = Command::new("sips")
        .args([
            "-s",
            "format",
            "png",
            "-z",
            "64",
            "64",
            &icns_path,
            "--out",
            output_path.to_str()?,
        ])
        .output()
        .ok()?;

    if output.status.success() {
        Some(output_path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Find the .icns file inside an app bundle
#[cfg(target_os = "macos")]
fn find_icns_file(app_path: &str) -> Option<String> {
    use std::process::Command;

    let info_plist = format!("{}/Contents/Info.plist", app_path);
    let resources_path = format!("{}/Contents/Resources", app_path);

    // Try to get icon name from Info.plist
    let icon_name = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIconFile", &info_plist])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Some(if name.ends_with(".icns") {
                    name
                } else {
                    format!("{}.icns", name)
                })
            } else {
                None
            }
        })
        .unwrap_or_else(|| "AppIcon.icns".to_string());

    let icon_path = format!("{}/{}", resources_path, icon_name);

    if std::path::Path::new(&icon_path).exists() {
        return Some(icon_path);
    }

    // Fallback: find any .icns file
    std::fs::read_dir(&resources_path)
        .ok()?
        .filter_map(|e| e.ok())
        .find(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "icns")
                .unwrap_or(false)
        })
        .and_then(|e| e.path().to_str().map(|s| s.to_string()))
}
