use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt;

const RESIDENT_PREFERENCES_SCHEMA_VERSION: u8 = 1;
const RESIDENT_PREFERENCES_FILE: &str = "resident-preferences.json";
pub const RESIDENT_TRAY_ID: &str = "ritual-resident";

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoginPromptState {
    #[default]
    NotRequired,
    Required,
    Accepted,
    Dismissed,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ResidentPreferences {
    pub schema_version: u8,
    pub tracking_enabled: bool,
    pub launch_at_login: bool,
    pub show_menu_bar: bool,
    pub login_prompt_state: LoginPromptState,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
}

impl Default for ResidentPreferences {
    fn default() -> Self {
        Self {
            schema_version: RESIDENT_PREFERENCES_SCHEMA_VERSION,
            tracking_enabled: false,
            launch_at_login: false,
            show_menu_bar: false,
            login_prompt_state: LoginPromptState::NotRequired,
            last_error_code: None,
            last_error_message: None,
        }
    }
}

pub struct ResidentRuntimeStore {
    preferences: Mutex<ResidentPreferences>,
    pub(crate) background_launch: bool,
    pub(crate) quitting: AtomicBool,
}

impl ResidentRuntimeStore {
    pub fn load(background_launch: bool) -> Self {
        let preferences_file_exists = preferences_path().exists();
        let (mut preferences, preferences_loaded_cleanly) = match load_preferences() {
            Ok(preferences) => (preferences, true),
            Err(error) => {
                let mut preferences = ResidentPreferences::default();
                preferences.last_error_code = Some("resident_preferences_corrupt".to_string());
                preferences.last_error_message = Some(error);
                (preferences, false)
            }
        };
        let watcher_was_enabled = (!preferences_file_exists && preferences_loaded_cleanly)
            .then(crate::watcher::load_watcher_preference)
            .and_then(Result::ok)
            .is_some_and(|preference| {
                preference.state == crate::watcher::WatcherPreferenceState::Enabled
            });

        // A watcher enabled before resident-runtime v1 gets a one-time login
        // item invitation. New opt-ins are registered by the typed transition.
        if apply_existing_tracking_migration(&mut preferences, watcher_was_enabled) {
            let _ = write_preferences(&preferences);
        }

        Self {
            preferences: Mutex::new(preferences),
            background_launch,
            quitting: AtomicBool::new(false),
        }
    }

    pub fn read(&self) -> ResidentPreferences {
        self.preferences
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn update(&self, mutate: impl FnOnce(&mut ResidentPreferences)) -> Result<(), String> {
        let next = {
            let mut current = self
                .preferences
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            mutate(&mut current);
            current.clone()
        };
        write_preferences(&next)
    }

    pub fn record_legacy_tracking_intent(&self, enabled: bool) -> Result<(), String> {
        self.update(|preferences| {
            preferences.tracking_enabled = enabled;
            if enabled
                && !preferences.launch_at_login
                && preferences.login_prompt_state == LoginPromptState::NotRequired
            {
                preferences.login_prompt_state = LoginPromptState::Required;
            }
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentRuntimeState {
    pub background_launch: bool,
    pub tracking_enabled: bool,
    pub watcher_running: bool,
    pub launch_at_login: bool,
    pub launch_at_login_registered: bool,
    pub show_menu_bar: bool,
    pub window_visible: bool,
    pub login_prompt_state: LoginPromptState,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetComputerTrackingInput {
    pub enabled: bool,
    pub config: Option<crate::watcher::WatcherConfig>,
}

fn preferences_path() -> PathBuf {
    crate::app_paths::auxiliary_data_dir().join(RESIDENT_PREFERENCES_FILE)
}

fn load_preferences() -> Result<ResidentPreferences, String> {
    let path = preferences_path();
    if !path.exists() {
        return Ok(ResidentPreferences::default());
    }
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read resident preferences: {error}"))?;
    parse_preferences(&contents)
}

fn parse_preferences(contents: &str) -> Result<ResidentPreferences, String> {
    let preferences: ResidentPreferences = serde_json::from_str(contents)
        .map_err(|error| format!("Failed to parse resident preferences: {error}"))?;
    if preferences.schema_version != RESIDENT_PREFERENCES_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported resident preferences schema version: {}",
            preferences.schema_version
        ));
    }
    Ok(preferences)
}

fn apply_existing_tracking_migration(
    preferences: &mut ResidentPreferences,
    watcher_was_enabled: bool,
) -> bool {
    if !watcher_was_enabled {
        return false;
    }
    let previous = preferences.clone();
    preferences.tracking_enabled = true;
    if !preferences.launch_at_login
        && preferences.login_prompt_state == LoginPromptState::NotRequired
    {
        preferences.login_prompt_state = LoginPromptState::Required;
    }
    *preferences != previous
}

fn write_preferences(preferences: &ResidentPreferences) -> Result<(), String> {
    let path = preferences_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create resident preferences directory: {error}"))?;
    }
    let encoded = serde_json::to_string_pretty(preferences)
        .map_err(|error| format!("Failed to serialize resident preferences: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, encoded)
        .map_err(|error| format!("Failed to write resident preferences: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Failed to protect resident preferences: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Failed to replace resident preferences: {error}"))
}

fn retained_watcher_config() -> Option<crate::watcher::WatcherConfig> {
    crate::watcher::load_watcher_preference()
        .ok()
        .and_then(|preference| preference.config)
}

fn should_enable_launch_for_tracking_opt_in(preferences: &ResidentPreferences) -> bool {
    !preferences.tracking_enabled && preferences.login_prompt_state == LoginPromptState::NotRequired
}

pub fn set_tray_visibility<R: Runtime>(app: &AppHandle<R>, visible: bool) -> Result<(), String> {
    let tray = app
        .tray_by_id(RESIDENT_TRAY_ID)
        .ok_or_else(|| "resident_tray_unavailable".to_string())?;
    tray.set_visible(visible)
        .map_err(|error| format!("menu_bar_visibility_failed: {error}"))
}

pub fn refresh_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let preferences = app.state::<ResidentRuntimeStore>().read();
    let open = MenuItemBuilder::with_id("open_ritual", "Open Ritual")
        .build(app)
        .map_err(|error| format!("menu_bar_menu_failed: {error}"))?;
    let toggle_tracking = MenuItemBuilder::with_id(
        "toggle_tracking",
        if preferences.tracking_enabled {
            "Pause Tracking"
        } else {
            "Resume Tracking"
        },
    )
    .build(app)
    .map_err(|error| format!("menu_bar_menu_failed: {error}"))?;
    let launch_at_login = CheckMenuItemBuilder::with_id("launch_at_login", "Launch at Login")
        .checked(preferences.launch_at_login)
        .build(app)
        .map_err(|error| format!("menu_bar_menu_failed: {error}"))?;
    let check_updates = MenuItemBuilder::with_id("check_updates", "Check for Updates")
        .build(app)
        .map_err(|error| format!("menu_bar_menu_failed: {error}"))?;
    let quit = MenuItemBuilder::with_id("quit", "Quit Ritual Completely")
        .build(app)
        .map_err(|error| format!("menu_bar_menu_failed: {error}"))?;
    let menu = MenuBuilder::new(app)
        .items(&[
            &open,
            &toggle_tracking,
            &launch_at_login,
            &check_updates,
            &quit,
        ])
        .build()
        .map_err(|error| format!("menu_bar_menu_failed: {error}"))?;
    app.tray_by_id(RESIDENT_TRAY_ID)
        .ok_or_else(|| "resident_tray_unavailable".to_string())?
        .set_menu(Some(menu))
        .map_err(|error| format!("menu_bar_menu_failed: {error}"))
}

fn set_launch_at_login_registration<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    }
    .map_err(|error| format!("launch_at_login_failed: {error}"))
}

async fn build_state<R: Runtime>(app: &AppHandle<R>) -> ResidentRuntimeState {
    let store = app.state::<ResidentRuntimeStore>();
    let preferences = store.read();
    let watcher = crate::watcher::get_watcher_lifecycle_snapshot().await;
    let launch_at_login_registered = app
        .autolaunch()
        .is_enabled()
        .unwrap_or(preferences.launch_at_login);
    let window_visible = app
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    ResidentRuntimeState {
        background_launch: store.background_launch,
        tracking_enabled: preferences.tracking_enabled,
        watcher_running: watcher.is_running,
        launch_at_login: preferences.launch_at_login,
        launch_at_login_registered,
        show_menu_bar: preferences.show_menu_bar,
        window_visible,
        login_prompt_state: preferences.login_prompt_state,
        last_error_code: preferences.last_error_code,
        last_error_message: preferences.last_error_message,
    }
}

#[tauri::command]
pub async fn desktop_get_resident_runtime_state<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ResidentRuntimeState, String> {
    Ok(build_state(&app).await)
}

#[tauri::command]
pub async fn desktop_set_launch_at_login<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<ResidentRuntimeState, String> {
    let result = set_launch_at_login_registration(&app, enabled);
    let store = app.state::<ResidentRuntimeStore>();
    store.update(|preferences| match &result {
        Ok(()) => {
            preferences.launch_at_login = enabled;
            preferences.login_prompt_state = if enabled {
                LoginPromptState::Accepted
            } else {
                LoginPromptState::Dismissed
            };
            preferences.last_error_code = None;
            preferences.last_error_message = None;
        }
        Err(error) => {
            preferences.last_error_code = Some("launch_at_login_failed".to_string());
            preferences.last_error_message = Some(error.clone());
        }
    })?;
    refresh_tray_menu(&app)?;
    crate::desktop_runtime::emit_runtime_state_changed(app.clone());
    Ok(build_state(&app).await)
}

#[tauri::command]
pub async fn desktop_set_menu_bar_visibility<R: Runtime>(
    app: AppHandle<R>,
    visible: bool,
) -> Result<ResidentRuntimeState, String> {
    app.state::<ResidentRuntimeStore>().update(|preferences| {
        preferences.show_menu_bar = visible;
        preferences.last_error_code = None;
        preferences.last_error_message = None;
    })?;
    refresh_tray_menu(&app)?;
    set_tray_visibility(&app, visible)?;
    crate::desktop_runtime::emit_runtime_state_changed(app.clone());
    Ok(build_state(&app).await)
}

#[tauri::command]
pub async fn desktop_set_computer_tracking<R: Runtime + 'static>(
    app: AppHandle<R>,
    input: SetComputerTrackingInput,
) -> Result<ResidentRuntimeState, String> {
    if input.enabled {
        let should_enable_launch =
            should_enable_launch_for_tracking_opt_in(&app.state::<ResidentRuntimeStore>().read());
        let config = input
            .config
            .or_else(retained_watcher_config)
            .ok_or_else(|| "watcher_config_required".to_string())?;
        crate::watcher::lifecycle::start_watcher(app.clone(), config).await?;

        let launch_result =
            should_enable_launch.then(|| set_launch_at_login_registration(&app, true));
        app.state::<ResidentRuntimeStore>().update(|preferences| {
            preferences.tracking_enabled = true;
            match launch_result.as_ref() {
                Some(Ok(())) => {
                    preferences.launch_at_login = true;
                    preferences.login_prompt_state = LoginPromptState::Accepted;
                    preferences.last_error_code = None;
                    preferences.last_error_message = None;
                }
                Some(Err(error)) => {
                    preferences.login_prompt_state = LoginPromptState::Required;
                    preferences.last_error_code = Some("launch_at_login_failed".to_string());
                    preferences.last_error_message = Some(error.clone());
                }
                None => {}
            }
        })?;
        crate::cloud_sync::trigger_cloud_sync_now(app.clone());
    } else {
        crate::watcher::lifecycle::stop_watcher().await?;
        // This marks the watcher preference disabled while retaining its full
        // configuration, so a later Resume never asks the user to reconfigure.
        crate::watcher::clear_watcher_config()?;
        app.state::<ResidentRuntimeStore>().update(|preferences| {
            preferences.tracking_enabled = false;
            preferences.last_error_code = None;
            preferences.last_error_message = None;
        })?;
    }

    refresh_tray_menu(&app)?;
    crate::desktop_runtime::emit_runtime_state_changed(app.clone());
    Ok(build_state(&app).await)
}

#[tauri::command]
pub fn desktop_quit_completely<R: Runtime>(app: AppHandle<R>) {
    app.state::<ResidentRuntimeStore>()
        .quitting
        .store(true, Ordering::SeqCst);
    app.exit(0);
}

pub fn mark_quitting<R: Runtime>(app: &AppHandle<R>) {
    app.state::<ResidentRuntimeStore>()
        .quitting
        .store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resident_preferences_are_private_and_default_to_quiet_local_behavior() {
        let preferences = ResidentPreferences::default();
        assert!(!preferences.tracking_enabled);
        assert!(!preferences.launch_at_login);
        assert!(!preferences.show_menu_bar);
        assert_eq!(
            preferences.login_prompt_state,
            LoginPromptState::NotRequired
        );
    }

    #[test]
    fn login_prompt_states_use_stable_snake_case_values() {
        assert_eq!(
            serde_json::to_string(&LoginPromptState::Required).unwrap(),
            "\"required\""
        );
    }

    #[test]
    fn existing_enabled_watcher_requires_login_opt_in_without_enabling_it() {
        let mut preferences = ResidentPreferences::default();
        assert!(apply_existing_tracking_migration(&mut preferences, true));
        assert!(preferences.tracking_enabled);
        assert!(!preferences.launch_at_login);
        assert_eq!(preferences.login_prompt_state, LoginPromptState::Required);
        assert!(!should_enable_launch_for_tracking_opt_in(&preferences));
    }

    #[test]
    fn launch_at_login_is_automatic_only_for_a_new_tracking_opt_in() {
        let preferences = ResidentPreferences::default();
        assert!(should_enable_launch_for_tracking_opt_in(&preferences));

        let mut paused = preferences;
        paused.login_prompt_state = LoginPromptState::Dismissed;
        assert!(!should_enable_launch_for_tracking_opt_in(&paused));

        let mut already_tracking = ResidentPreferences::default();
        already_tracking.tracking_enabled = true;
        assert!(!should_enable_launch_for_tracking_opt_in(&already_tracking));
    }

    #[test]
    fn corrupt_preferences_fail_closed() {
        assert!(parse_preferences("not-json").is_err());
        let mut future = ResidentPreferences::default();
        future.schema_version = RESIDENT_PREFERENCES_SCHEMA_VERSION + 1;
        assert!(parse_preferences(&serde_json::to_string(&future).unwrap()).is_err());
    }
}
