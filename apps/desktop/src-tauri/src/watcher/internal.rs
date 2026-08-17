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

pub(crate) struct WatcherController<P = Child> {
    pub process: Option<P>,
    pub device_id: Option<String>,
    pub state: WatcherControllerState,
    pub last_started_at: Option<Instant>,
    pub last_restart_reason: Option<String>,
    pub restart_count: u64,
    pub consecutive_unhealthy_checks: u64,
}

impl<P> Default for WatcherController<P> {
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

impl<P> WatcherController<P> {
    pub fn begin_start(&mut self, device_id: String) {
        self.device_id = Some(device_id);
        self.last_started_at = Some(Instant::now());
        self.state = WatcherControllerState::Starting;
    }

    pub fn finish_start(&mut self, process: P) {
        self.process = Some(process);
        self.state = WatcherControllerState::Running;
        self.consecutive_unhealthy_checks = 0;
    }

    pub fn fail_start(&mut self) {
        self.process = None;
        self.state = WatcherControllerState::Backoff;
    }

    pub fn finish_stop(&mut self, enabled: bool) {
        self.process = None;
        self.state = if enabled {
            WatcherControllerState::Stopped
        } else {
            WatcherControllerState::Disabled
        };
        self.consecutive_unhealthy_checks = 0;
    }

    pub fn record_unhealthy_check(&mut self) -> u64 {
        self.consecutive_unhealthy_checks = self.consecutive_unhealthy_checks.saturating_add(1);
        self.consecutive_unhealthy_checks
    }

    pub fn enter_backoff_for_restart(&mut self, reason: String) {
        self.state = WatcherControllerState::Backoff;
        self.consecutive_unhealthy_checks = 0;
        self.restart_count = self.restart_count.saturating_add(1);
        self.last_restart_reason = Some(reason);
    }
}

pub(crate) static WATCHER_CONTROLLER: Lazy<Mutex<WatcherController>> =
    Lazy::new(|| Mutex::new(WatcherController::default()));
pub(crate) static WATCHER_OPERATION_GATE: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::Duration;

    #[derive(Debug, PartialEq, Eq)]
    struct FakeProcess(u32);

    #[test]
    fn injected_process_transitions_cover_start_failure_stop_and_restart() {
        let mut controller = WatcherController::<FakeProcess>::default();
        assert_eq!(controller.state, WatcherControllerState::Stopped);

        controller.begin_start("device-1".to_string());
        assert_eq!(controller.state, WatcherControllerState::Starting);
        controller.finish_start(FakeProcess(42));
        assert_eq!(controller.state, WatcherControllerState::Running);
        assert_eq!(controller.process, Some(FakeProcess(42)));

        assert_eq!(controller.record_unhealthy_check(), 1);
        assert_eq!(controller.record_unhealthy_check(), 2);
        controller.enter_backoff_for_restart("heartbeat stale".to_string());
        assert_eq!(controller.state, WatcherControllerState::Backoff);
        assert_eq!(controller.restart_count, 1);
        assert_eq!(controller.consecutive_unhealthy_checks, 0);

        controller.fail_start();
        assert_eq!(controller.state, WatcherControllerState::Backoff);
        assert!(controller.process.is_none());
        controller.finish_stop(false);
        assert_eq!(controller.state, WatcherControllerState::Disabled);
    }

    #[test]
    fn operation_gate_serializes_concurrent_lifecycle_commands() {
        let gate = Arc::new(Mutex::new(()));
        let entered = Arc::new(Mutex::new(Vec::new()));
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();
        for id in 0..2 {
            let gate = Arc::clone(&gate);
            let entered = Arc::clone(&entered);
            let barrier = Arc::clone(&barrier);
            handles.push(thread::spawn(move || {
                barrier.wait();
                let _guard = gate.lock().expect("gate");
                entered.lock().expect("entered").push((id, "enter"));
                thread::sleep(Duration::from_millis(20));
                entered.lock().expect("entered").push((id, "exit"));
            }));
        }
        barrier.wait();
        for handle in handles {
            handle.join().expect("join lifecycle command");
        }
        let events = entered.lock().expect("events");
        assert_eq!(events.len(), 4);
        assert_eq!(events[0].0, events[1].0);
        assert_ne!(events[1].0, events[2].0);
        assert_eq!(events[2].0, events[3].0);
    }
}

macro_rules! watcher_info {
    ($($arg:tt)*) => {
        log::info!("[WATCHER] {}", format!($($arg)*))
    };
}
