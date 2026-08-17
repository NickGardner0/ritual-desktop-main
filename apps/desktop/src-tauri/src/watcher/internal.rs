use once_cell::sync::Lazy;
use std::process::Child;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WatcherControllerState {
    Disabled,
    Stopped,
    Starting,
    Running,
    Backoff,
}

pub(crate) struct WatcherController {
    pub process: Option<Child>,
    pub device_id: Option<String>,
    pub state: WatcherControllerState,
    pub last_started_at: Option<Instant>,
    pub last_restart_reason: Option<String>,
    pub restart_count: u64,
    pub consecutive_unhealthy_checks: u64,
}

impl Default for WatcherController {
    fn default() -> Self {
        Self {
            process: None,
            device_id: None,
            state: WatcherControllerState::Stopped,
            last_started_at: None,
            last_restart_reason: None,
            restart_count: 0,
            consecutive_unhealthy_checks: 0,
        }
    }
}

pub(crate) static WATCHER_CONTROLLER: Lazy<Mutex<WatcherController>> =
    Lazy::new(|| Mutex::new(WatcherController::default()));
pub(crate) static WATCHER_OPERATION_GATE: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

macro_rules! watcher_info {
    ($($arg:tt)*) => {
        log::info!("[WATCHER] {}", format!($($arg)*))
    };
}
