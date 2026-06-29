use once_cell::sync::Lazy;
use std::process::Child;
use std::sync::atomic::AtomicU64;
use std::sync::Mutex;
use std::time::Instant;

/// Global state for the watcher process
pub(crate) static WATCHER_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

/// Stored device ID from the most recent watcher start
pub(crate) static DEVICE_ID: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));
pub(crate) static WATCHER_LAST_STARTED_AT: Lazy<Mutex<Option<Instant>>> =
    Lazy::new(|| Mutex::new(None));
pub(crate) static WATCHER_LAST_RESTART_REASON: Lazy<Mutex<Option<String>>> =
    Lazy::new(|| Mutex::new(None));
pub(crate) static WATCHER_RESTART_COUNT: AtomicU64 = AtomicU64::new(0);
pub(crate) static WATCHER_CONSECUTIVE_UNHEALTHY_CHECKS: AtomicU64 = AtomicU64::new(0);

macro_rules! watcher_info {
    ($($arg:tt)*) => {
        log::info!("[WATCHER] {}", format!($($arg)*))
    };
}
