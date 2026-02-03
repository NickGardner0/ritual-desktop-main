//! FFmpeg management module for Ritual Recorder
//!
//! Handles finding and auto-downloading FFmpeg if not installed.
//! Based on Screen Pipe's approach using ffmpeg_sidecar.

#![allow(dead_code)] // Some functions reserved for future use

use anyhow::{Context, Result};
use ffmpeg_sidecar::{
    command::ffmpeg_is_installed,
    download::{check_latest_version, download_ffmpeg_package, ffmpeg_download_url, unpack_ffmpeg},
    paths::sidecar_dir,
    version::ffmpeg_version,
};
use once_cell::sync::Lazy;
use std::path::PathBuf;
use tracing::{debug, info, warn};
use which::which;

#[cfg(not(windows))]
const EXECUTABLE_NAME: &str = "ffmpeg";

#[cfg(windows)]
const EXECUTABLE_NAME: &str = "ffmpeg.exe";

/// Cached FFmpeg path (computed once on first use)
static FFMPEG_PATH: Lazy<Option<PathBuf>> = Lazy::new(find_ffmpeg_path_internal);

/// Status of FFmpeg installation
#[derive(Debug, Clone)]
pub enum FfmpegStatus {
    /// FFmpeg is installed and ready
    Ready(PathBuf),
    /// FFmpeg is being downloaded
    Downloading,
    /// FFmpeg installation failed
    Failed(String),
    /// FFmpeg not found and not installed
    NotFound,
}

/// Get the cached FFmpeg path
pub fn find_ffmpeg_path() -> Option<PathBuf> {
    FFMPEG_PATH.as_ref().cloned()
}

/// Find FFmpeg, downloading if necessary
/// Returns the path to FFmpeg or an error if not found and download fails
pub fn ensure_ffmpeg() -> Result<PathBuf> {
    if let Some(path) = find_ffmpeg_path() {
        return Ok(path);
    }
    
    // Try to install
    info!("FFmpeg not found, attempting to download...");
    handle_ffmpeg_installation()?;
    
    // Try to find it again after installation
    if let Some(path) = find_ffmpeg_path_internal() {
        return Ok(path);
    }
    
    anyhow::bail!("FFmpeg installation failed. Please install manually: brew install ffmpeg")
}

/// Internal function to find FFmpeg path
fn find_ffmpeg_path_internal() -> Option<PathBuf> {
    debug!("Starting search for FFmpeg executable");

    // Check in the same folder as the executable (Linux first)
    #[cfg(target_os = "linux")]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_folder) = exe_path.parent() {
                debug!("Executable folder: {:?}", exe_folder);
                let ffmpeg_in_exe_folder = exe_folder.join(EXECUTABLE_NAME);
                if ffmpeg_in_exe_folder.exists() {
                    debug!("Found FFmpeg in executable folder: {:?}", ffmpeg_in_exe_folder);
                    return Some(ffmpeg_in_exe_folder);
                }

                let lib_folder = exe_folder.join("lib");
                let ffmpeg_in_lib = lib_folder.join(EXECUTABLE_NAME);
                if ffmpeg_in_lib.exists() {
                    debug!("Found FFmpeg in lib folder: {:?}", ffmpeg_in_lib);
                    return Some(ffmpeg_in_lib);
                }
            }
        }
    }

    // Check common Homebrew paths on macOS
    #[cfg(target_os = "macos")]
    {
        let homebrew_paths = [
            "/opt/homebrew/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
        ];
        for path in homebrew_paths {
            let p = PathBuf::from(path);
            if p.exists() {
                debug!("Found FFmpeg at Homebrew path: {:?}", p);
                return Some(p);
            }
        }
    }

    // Check if `ffmpeg` is in the PATH environment variable
    if let Ok(path) = which(EXECUTABLE_NAME) {
        debug!("Found FFmpeg in PATH: {:?}", path);
        return Some(path);
    }
    debug!("FFmpeg not found in PATH");

    // Check in $HOME/.local/bin on macOS
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let local_bin = home.join(".local").join("bin");
            debug!("Checking $HOME/.local/bin: {:?}", local_bin);
            let ffmpeg_in_local_bin = local_bin.join(EXECUTABLE_NAME);
            if ffmpeg_in_local_bin.exists() {
                debug!("Found FFmpeg in $HOME/.local/bin: {:?}", ffmpeg_in_local_bin);
                return Some(ffmpeg_in_local_bin);
            }
        }
    }

    // Check in current working directory
    if let Ok(cwd) = std::env::current_dir() {
        let ffmpeg_in_cwd = cwd.join(EXECUTABLE_NAME);
        if ffmpeg_in_cwd.is_file() && ffmpeg_in_cwd.exists() {
            debug!("Found FFmpeg in current working directory: {:?}", ffmpeg_in_cwd);
            return Some(ffmpeg_in_cwd);
        }
    }

    // Check in the same folder as the executable (non-Linux platforms)
    #[cfg(not(target_os = "linux"))]
    {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_folder) = exe_path.parent() {
                let ffmpeg_in_exe_folder = exe_folder.join(EXECUTABLE_NAME);
                if ffmpeg_in_exe_folder.exists() {
                    debug!("Found FFmpeg in executable folder: {:?}", ffmpeg_in_exe_folder);
                    return Some(ffmpeg_in_exe_folder);
                }

                // macOS app bundle Resources folder
                #[cfg(target_os = "macos")]
                {
                    let resources_folder = exe_folder.join("../Resources");
                    let ffmpeg_in_resources = resources_folder.join(EXECUTABLE_NAME);
                    if ffmpeg_in_resources.exists() {
                        debug!("Found FFmpeg in Resources folder: {:?}", ffmpeg_in_resources);
                        return Some(ffmpeg_in_resources);
                    }
                }
            }
        }
    }

    // Check sidecar directory (where ffmpeg_sidecar installs)
    if let Ok(sidecar) = sidecar_dir() {
        let ffmpeg_in_sidecar = sidecar.join(EXECUTABLE_NAME);
        if ffmpeg_in_sidecar.exists() {
            debug!("Found FFmpeg in sidecar directory: {:?}", ffmpeg_in_sidecar);
            return Some(ffmpeg_in_sidecar);
        }
    }

    debug!("FFmpeg not found in any location");
    None
}

/// Handle FFmpeg installation
fn handle_ffmpeg_installation() -> Result<()> {
    if ffmpeg_is_installed() {
        debug!("FFmpeg is already installed");
        return Ok(());
    }

    info!("🎬 Downloading FFmpeg (one-time setup)...");
    
    match check_latest_version() {
        Ok(version) => info!("Latest FFmpeg version available: {}", version),
        Err(e) => debug!("Skipping version check due to error: {}", e),
    }

    let download_url = ffmpeg_download_url()
        .context("Failed to get FFmpeg download URL")?;
    
    let destination = get_ffmpeg_install_dir()
        .context("Failed to determine installation directory")?;

    info!("📥 Downloading from: {:?}", download_url);
    info!("📁 Installing to: {:?}", destination);
    
    let archive_path = download_ffmpeg_package(download_url, &destination)
        .context("Failed to download FFmpeg package")?;
    
    debug!("Downloaded package: {:?}", archive_path);

    info!("📦 Extracting...");
    unpack_ffmpeg(&archive_path, &destination)
        .context("Failed to extract FFmpeg")?;

    match ffmpeg_version() {
        Ok(version) => info!("✅ FFmpeg {} installed successfully!", version),
        Err(_) => info!("✅ FFmpeg installed successfully!"),
    }
    
    Ok(())
}

/// Get the FFmpeg installation directory
#[cfg(target_os = "macos")]
fn get_ffmpeg_install_dir() -> Result<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("Couldn't find home directory"))?;
    
    let local_bin = home.join(".local").join("bin");

    // Create directory if it doesn't exist
    if !local_bin.exists() {
        debug!("Creating .local/bin directory");
        std::fs::create_dir_all(&local_bin)?;
    }

    // Set directory permissions to 755 (rwxr-xr-x)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&local_bin, std::fs::Permissions::from_mode(0o755))?;
    }

    // Update shell configs to add .local/bin to PATH
    let shell_configs = vec![
        home.join(".bashrc"),
        home.join(".bash_profile"),
        home.join(".zshrc"),
    ];

    for config in shell_configs {
        if config.exists() {
            if let Ok(content) = std::fs::read_to_string(&config) {
                if !content.contains(".local/bin") {
                    debug!("Adding .local/bin to PATH in {:?}", config);
                    let updated = format!("{}\nexport PATH=\"$HOME/.local/bin:$PATH\"\n", content);
                    if let Err(e) = std::fs::write(&config, updated) {
                        warn!("Failed to update {:?}: {}", config, e);
                    }
                }
            }
        }
    }

    Ok(local_bin)
}

/// Get the FFmpeg installation directory (non-macOS)
#[cfg(not(target_os = "macos"))]
fn get_ffmpeg_install_dir() -> Result<PathBuf> {
    sidecar_dir().map_err(|e| anyhow::anyhow!("Failed to get sidecar directory: {}", e))
}

/// Check if FFmpeg is available (without triggering download)
pub fn is_ffmpeg_available() -> bool {
    find_ffmpeg_path().is_some() || ffmpeg_is_installed()
}

/// Get FFmpeg version string
pub fn get_ffmpeg_version() -> Option<String> {
    ffmpeg_version().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_ffmpeg() {
        let result = find_ffmpeg_path();
        if let Some(path) = result {
            println!("FFmpeg found at: {:?}", path);
        } else {
            println!("FFmpeg not found (will be downloaded on first use)");
        }
    }

    #[test]
    fn test_is_available() {
        let available = is_ffmpeg_available();
        println!("FFmpeg available: {}", available);
    }
}
