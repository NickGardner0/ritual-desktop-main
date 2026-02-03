//! Screen capture functionality for Ritual Recorder
//!
//! Uses xcap for cross-platform screen capture with support for:
//! - Multiple monitors
//! - Window-level capture
//! - Efficient RGBA buffer handling

#![allow(dead_code)] // Some fields/methods reserved for future use

use anyhow::{Context, Result};
use image::{DynamicImage, ImageBuffer};
use std::collections::HashSet;
use once_cell::sync::Lazy;
use tracing::{debug, trace};
use xcap::{Monitor, Window};

use crate::config::RecorderConfig;

/// Skip these system apps on macOS
#[cfg(target_os = "macos")]
static SKIP_APPS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    HashSet::from([
        "Window Server",
        "SystemUIServer",
        "ControlCenter",
        "Dock",
        "NotificationCenter",
        "loginwindow",
        "WindowManager",
        "Contexts",
        "Screenshot",
        "screencaptureui",
        "Spotlight",
    ])
});

/// Skip these window titles
#[cfg(target_os = "macos")]
static SKIP_TITLES: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    HashSet::from([
        "Item-0",
        "App Icon Window",
        "Dock",
        "NowPlaying",
        "Menu Bar",
        "Notification Center",
        "Control Center",
        "Mission Control",
        "Desktop",
        "Touch Bar",
        "Status Bar",
    ])
});

/// Result of capturing a screen frame
#[derive(Debug, Clone)]
pub struct CaptureResult {
    /// The captured image
    pub image: DynamicImage,
    /// Timestamp when capture occurred (Unix milliseconds)
    pub timestamp: i64,
    /// Frame number since recorder started
    pub frame_number: u64,
    /// Monitor ID that was captured
    pub monitor_id: u32,
    /// Resolution width
    pub width: u32,
    /// Resolution height
    pub height: u32,
    /// Focused window info if available
    pub focused_window: Option<WindowInfo>,
}

/// Information about a captured window
#[derive(Debug, Clone)]
pub struct WindowInfo {
    /// Application name
    pub app_name: String,
    /// Window title
    pub window_title: String,
    /// Process ID
    pub process_id: i32,
    /// App bundle ID (macOS)
    pub bundle_id: Option<String>,
    /// Is this window currently focused
    pub is_focused: bool,
}

/// Screen capture manager
pub struct ScreenCapture {
    /// Monitor to capture
    monitor: Monitor,
    /// Frame counter
    frame_count: u64,
    /// Config
    config: RecorderConfig,
}

impl ScreenCapture {
    /// Create a new screen capture instance
    pub fn new(config: &RecorderConfig) -> Result<Self> {
        let monitors = Monitor::all().context("Failed to enumerate monitors")?;
        
        if monitors.is_empty() {
            anyhow::bail!("No monitors found");
        }

        let monitor = if config.monitor_id == 0 {
            // Primary monitor (first one)
            monitors.into_iter().next().unwrap()
        } else {
            // Find by ID
            monitors
                .into_iter()
                .find(|m| m.id().ok() == Some(config.monitor_id))
                .context(format!("Monitor {} not found", config.monitor_id))?
        };

        debug!(
            "Initialized screen capture for monitor: {} ({}x{})",
            monitor.name().unwrap_or_else(|_| "Unknown".to_string()),
            monitor.width().unwrap_or(0),
            monitor.height().unwrap_or(0)
        );

        Ok(Self {
            monitor,
            frame_count: 0,
            config: config.clone(),
        })
    }

    /// Get the current monitor ID
    pub fn monitor_id(&self) -> u32 {
        self.monitor.id().unwrap_or(0)
    }

    /// Capture the current screen
    pub fn capture(&mut self) -> Result<CaptureResult> {
        let timestamp = chrono::Utc::now().timestamp_millis();
        self.frame_count += 1;

        trace!("Capturing frame {} at timestamp {}", self.frame_count, timestamp);

        // Capture the monitor
        let buffer = self.monitor
            .capture_image()
            .context("Failed to capture screen")?;

        let width = buffer.width();
        let height = buffer.height();

        // Convert to DynamicImage
        let image = DynamicImage::ImageRgba8(
            ImageBuffer::from_raw(width, height, buffer.into_raw())
                .context("Failed to create image buffer")?
        );

        // Get focused window info
        let focused_window = self.get_focused_window();

        Ok(CaptureResult {
            image,
            timestamp,
            frame_number: self.frame_count,
            monitor_id: self.monitor.id().unwrap_or(0),
            width,
            height,
            focused_window,
        })
    }

    /// Get information about the currently focused window
    fn get_focused_window(&self) -> Option<WindowInfo> {
        let windows = match Window::all() {
            Ok(w) => w,
            Err(e) => {
                trace!("Failed to get windows: {}", e);
                return None;
            }
        };

        for window in windows {
            let is_focused = match window.is_focused() {
                Ok(f) => f,
                Err(_) => continue,
            };

            if !is_focused {
                continue;
            }

            let app_name = match window.app_name() {
                Ok(name) => name,
                Err(_) => continue,
            };

            let window_title = match window.title() {
                Ok(title) => title,
                Err(_) => continue,
            };

            // Skip system windows
            #[cfg(target_os = "macos")]
            {
                if SKIP_APPS.contains(app_name.as_str()) {
                    continue;
                }
                if SKIP_TITLES.contains(window_title.as_str()) {
                    continue;
                }
            }

            let process_id = window.pid().map(|p| p as i32).unwrap_or(-1);

            // Get bundle ID on macOS
            #[cfg(target_os = "macos")]
            let bundle_id = get_bundle_id_for_app(&app_name);

            #[cfg(not(target_os = "macos"))]
            let bundle_id = None;

            return Some(WindowInfo {
                app_name,
                window_title,
                process_id,
                bundle_id,
                is_focused: true,
            });
        }

        None
    }

    /// Check if the current focused app should be recorded
    pub fn should_record(&self) -> bool {
        if let Some(ref window) = self.get_focused_window() {
            // Check excluded apps
            if let Some(ref bundle_id) = window.bundle_id {
                if self.config.is_app_excluded(bundle_id) {
                    debug!("Skipping excluded app: {}", bundle_id);
                    return false;
                }
            }

            // Check excluded titles
            if self.config.is_title_excluded(&window.window_title) {
                debug!("Skipping excluded title: {}", window.window_title);
                return false;
            }
        }

        true
    }

    /// Get current frame count
    pub fn frame_count(&self) -> u64 {
        self.frame_count
    }
}

/// Get bundle ID for an app on macOS
#[cfg(target_os = "macos")]
fn get_bundle_id_for_app(app_name: &str) -> Option<String> {
    use std::process::Command;

    // Use mdfind to get bundle ID
    let output = Command::new("osascript")
        .arg("-e")
        .arg(format!(
            "tell application \"System Events\" to get bundle identifier of (first application process whose name is \"{}\")",
            app_name
        ))
        .output()
        .ok()?;

    if output.status.success() {
        let bundle_id = String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_string();
        if !bundle_id.is_empty() && bundle_id != "missing value" {
            return Some(bundle_id);
        }
    }

    None
}

/// Get list of all available monitors
pub fn get_all_monitors() -> Result<Vec<MonitorInfo>> {
    let monitors = Monitor::all().context("Failed to enumerate monitors")?;
    
    Ok(monitors
        .into_iter()
        .map(|m| MonitorInfo {
            id: m.id().unwrap_or(0),
            name: m.name().unwrap_or_else(|_| "Unknown".to_string()),
            width: m.width().unwrap_or(0),
            height: m.height().unwrap_or(0),
            is_primary: m.is_primary().unwrap_or(false),
        })
        .collect())
}

/// Monitor information
#[derive(Debug, Clone)]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

impl std::fmt::Display for MonitorInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Monitor {} - {} ({}x{}{})",
            self.id,
            self.name,
            self.width,
            self.height,
            if self.is_primary { ", primary" } else { "" }
        )
    }
}
