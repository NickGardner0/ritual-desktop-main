//! Ritual Watcher Tauri Commands
//!
//! Orchestrates the ritual-watcher sidecar process for computer activity tracking.

#[macro_use]
pub mod internal;
pub mod config;
pub mod diagnostics;
pub mod icons;
pub mod lifecycle;
pub mod permissions;
pub mod queries;

pub use config::{
    clear_watcher_config, get_saved_watcher_config, save_watcher_config, WatcherConfig,
};
pub use lifecycle::{get_watcher_lifecycle_snapshot, start_watcher_sync, WatcherLifecycleSnapshot};
pub use permissions::check_accessibility_permission;
