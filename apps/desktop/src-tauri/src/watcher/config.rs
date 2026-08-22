use std::path::PathBuf;
use std::process::Command;

use super::internal::DEVICE_ID;
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
    DEVICE_ID.lock().ok().and_then(|g| g.clone())
}

/// Get device_id or try to read it from the config file
pub(crate) fn get_device_id_or_config() -> Option<String> {
    // First try the in-memory stored device_id
    if let Some(id) = get_device_id() {
        return Some(id);
    }

    // A disabled preference retains the last device id so exact-process cleanup
    // can still remove an orphan without re-enabling tracking.
    load_watcher_preference()
        .ok()
        .and_then(|preference| preference.config)
        .map(|config| config.device_id)
}

pub(crate) fn watcher_config_path() -> Result<PathBuf, String> {
    Ok(crate::app_paths::data_dir().join("watcher_config.json"))
}

pub(crate) fn load_saved_watcher_config() -> Option<WatcherConfig> {
    let preference = load_watcher_preference().ok()?;
    (preference.state == WatcherPreferenceState::Enabled)
        .then_some(preference.config)
        .flatten()
}

pub fn get_saved_watcher_config() -> Option<WatcherConfig> {
    load_saved_watcher_config()
}

pub fn save_watcher_config(config: &WatcherConfig) -> Result<(), String> {
    write_watcher_preference(&WatcherPreference::enabled(config.clone()))?;
    watcher_info!("💾 Watcher config saved for auto-start");
    Ok(())
}

pub fn clear_watcher_config() -> Result<(), String> {
    let config = load_watcher_preference()
        .ok()
        .and_then(|preference| preference.config);
    write_watcher_preference(&WatcherPreference {
        schema_version: WATCHER_PREFERENCE_SCHEMA_VERSION,
        state: WatcherPreferenceState::DisabledByUser,
        config,
    })
}

pub(crate) const WATCHER_PREFERENCE_SCHEMA_VERSION: u8 = 2;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WatcherPreferenceState {
    NeverEnabled,
    Enabled,
    DisabledByUser,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WatcherPreference {
    pub schema_version: u8,
    pub state: WatcherPreferenceState,
    pub config: Option<WatcherConfig>,
}

impl WatcherPreference {
    fn enabled(config: WatcherConfig) -> Self {
        Self {
            schema_version: WATCHER_PREFERENCE_SCHEMA_VERSION,
            state: WatcherPreferenceState::Enabled,
            config: Some(config),
        }
    }

    pub(crate) fn never_enabled() -> Self {
        Self {
            schema_version: WATCHER_PREFERENCE_SCHEMA_VERSION,
            state: WatcherPreferenceState::NeverEnabled,
            config: None,
        }
    }
}

fn parse_watcher_preference(contents: &str) -> Result<(WatcherPreference, bool), String> {
    if let Ok(preference) = serde_json::from_str::<WatcherPreference>(contents) {
        if preference.schema_version != WATCHER_PREFERENCE_SCHEMA_VERSION {
            return Err(format!(
                "Unsupported watcher preference schema version: {}",
                preference.schema_version
            ));
        }
        if preference.state == WatcherPreferenceState::Enabled && preference.config.is_none() {
            return Err("Enabled watcher preference is missing its configuration".to_string());
        }
        return Ok((preference, false));
    }

    serde_json::from_str::<WatcherConfig>(contents)
        .map(|config| (WatcherPreference::enabled(config), true))
        .map_err(|error| format!("Failed to parse watcher preference: {error}"))
}

fn write_watcher_preference(preference: &WatcherPreference) -> Result<(), String> {
    let config_path = watcher_config_path()?;
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create watcher config directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(preference)
        .map_err(|error| format!("Failed to serialize watcher preference: {error}"))?;
    let temporary_path = config_path.with_extension("json.tmp");
    std::fs::write(&temporary_path, json)
        .map_err(|error| format!("Failed to write watcher preference: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temporary_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to protect watcher preference: {error}"))?;
    }
    std::fs::rename(&temporary_path, &config_path)
        .map_err(|error| format!("Failed to replace watcher preference: {error}"))
}

pub(crate) fn load_watcher_preference() -> Result<WatcherPreference, String> {
    let config_path = watcher_config_path()?;
    if !config_path.exists() {
        return Ok(WatcherPreference::never_enabled());
    }
    let contents = std::fs::read_to_string(&config_path)
        .map_err(|error| format!("Failed to read watcher preference: {error}"))?;
    let (preference, migrated_legacy) = parse_watcher_preference(&contents)?;
    if migrated_legacy {
        write_watcher_preference(&preference)?;
        watcher_info!("💾 Migrated watcher preference to schema v2");
    }
    Ok(preference)
}

/// Watcher configuration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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

#[cfg(test)]
mod tests {
    use super::{
        parse_watcher_preference, WatcherConfig, WatcherPreferenceState,
        WATCHER_PREFERENCE_SCHEMA_VERSION,
    };

    fn fixture_config() -> WatcherConfig {
        WatcherConfig {
            device_id: "device-test".to_string(),
            user_id: "user-test".to_string(),
            poll_interval_ms: 1_000,
            title_mode: "full".to_string(),
            truncate_length: 80,
            excluded_bundle_ids: vec![],
            afk_timeout_seconds: 900,
            url_mode: "domain".to_string(),
            track_incognito: false,
            browser_heartbeat_port: 8766,
        }
    }

    #[test]
    fn legacy_config_migrates_to_enabled_v2_preference() {
        let contents = serde_json::to_string(&fixture_config()).expect("serialize config");
        let (preference, migrated) = parse_watcher_preference(&contents).expect("parse legacy");
        assert!(migrated);
        assert_eq!(preference.schema_version, WATCHER_PREFERENCE_SCHEMA_VERSION);
        assert_eq!(preference.state, WatcherPreferenceState::Enabled);
        assert_eq!(preference.config, Some(fixture_config()));
    }

    #[test]
    fn v2_never_enabled_is_distinct_from_disabled_by_user() {
        for state in [
            WatcherPreferenceState::NeverEnabled,
            WatcherPreferenceState::DisabledByUser,
        ] {
            let contents = serde_json::json!({
                "schema_version": WATCHER_PREFERENCE_SCHEMA_VERSION,
                "state": state,
                "config": null,
            })
            .to_string();
            let (preference, migrated) = parse_watcher_preference(&contents).expect("parse v2");
            assert!(!migrated);
            assert_eq!(preference.state, state);
        }
    }

    #[test]
    fn enabled_v2_requires_configuration() {
        let contents = serde_json::json!({
            "schema_version": WATCHER_PREFERENCE_SCHEMA_VERSION,
            "state": "enabled",
            "config": null,
        })
        .to_string();
        assert!(parse_watcher_preference(&contents).is_err());
    }
}
