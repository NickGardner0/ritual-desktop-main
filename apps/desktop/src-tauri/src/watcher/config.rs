use std::path::PathBuf;
use std::process::Command;

use super::internal::WATCHER_CONTROLLER;
use serde::{Deserialize, Serialize};

pub(crate) fn apply_turso_sync_env(command: &mut Command) {
    set_command_env_default(command, "RITUAL_DISABLE_APP_SWITCH_NOTIFICATIONS", "1");
    set_command_env_default(command, "RITUAL_DISABLE_SCREEN_EVENT_NOTIFICATIONS", "1");
    set_command_env_default(command, "RITUAL_DISABLE_WINDOW_TITLE_OBSERVER", "1");
}

pub(crate) fn set_command_env_default(command: &mut Command, key: &str, default_value: &str) {
    match std::env::var(key) {
        Ok(value) => {
            command.env(key, value);
        }
        Err(_) => {
            command.env(key, default_value);
        }
    }
}

pub(crate) fn require_db<'a, T>(db: Option<&'a T>) -> Result<&'a T, String> {
    db.ok_or_else(|| "Database not initialized. Call initialize_database() first.".to_string())
}

/// Get the current device_id (set when watcher starts)
pub(crate) fn get_device_id() -> Option<String> {
    WATCHER_CONTROLLER
        .lock()
        .ok()
        .and_then(|controller| controller.device_id.clone())
}

/// Get device_id or try to read it from the config file
pub(crate) fn get_device_id_or_config() -> Option<String> {
    // First try the in-memory stored device_id
    if let Some(id) = get_device_id() {
        return Some(id);
    }

    // Fallback: read from config file
    let home = dirs::home_dir()?;
    let config_path = home.join(".ritual").join("watcher_config.json");
    if config_path.exists() {
        std::fs::read_to_string(&config_path)
            .ok()
            .and_then(|s| serde_json::from_str::<WatcherConfig>(&s).ok())
            .map(|c| c.device_id)
    } else {
        None
    }
}

pub(crate) fn watcher_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    Ok(home.join(".ritual").join("watcher_config.json"))
}

pub(crate) fn load_saved_watcher_config() -> Option<WatcherConfig> {
    let config_path = watcher_config_path().ok()?;
    if !config_path.exists() {
        return None;
    }
    std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<WatcherConfig>(&contents).ok())
}

pub fn get_saved_watcher_config() -> Option<WatcherConfig> {
    load_saved_watcher_config()
}

pub fn save_watcher_config(config: &WatcherConfig) -> Result<(), String> {
    let config_path = watcher_config_path()?;
    if let Some(parent) = config_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;
    watcher_info!("💾 Watcher config saved for auto-start");
    Ok(())
}

pub fn clear_watcher_config() -> Result<(), String> {
    let config_path = watcher_config_path()?;
    if config_path.exists() {
        std::fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove config: {}", e))?;
    }
    Ok(())
}

/// Watcher configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherConfig {
    pub device_id: String,
    pub user_id: String,
    pub poll_interval_ms: u64,
    pub title_mode: String, // off, full, truncate, hash
    pub truncate_length: usize,
    pub excluded_bundle_ids: Vec<String>,
    // V2: New configuration options
    #[serde(default = "default_afk_timeout")]
    pub afk_timeout_seconds: u64,
    #[serde(default = "default_url_mode")]
    pub url_mode: String, // off, domain, full
    #[serde(default)]
    pub track_incognito: bool,
    #[serde(default = "default_browser_heartbeat_port")]
    pub browser_heartbeat_port: u16,
}

fn default_afk_timeout() -> u64 {
    900
} // 15 minutes - better for coding/reading
fn default_url_mode() -> String {
    "domain".to_string()
}

pub(crate) fn default_browser_heartbeat_port() -> u16 {
    8766
}

pub(crate) const REQUIRED_WATCHER_HELP_FLAGS: [&str; 2] = ["--afk-timeout", "--url-mode"];
pub(crate) const EXTENSION_HEARTBEAT_LIVE_THRESHOLD_SECONDS: i64 = 90;
pub(crate) const WATCHER_HEARTBEAT_ENDPOINTS: [(&str, &str, u16); 2] = [
    ("http://127.0.0.1:8766", "127.0.0.1", 8766),
    ("http://127.0.0.1:8767", "127.0.0.1", 8767),
];
