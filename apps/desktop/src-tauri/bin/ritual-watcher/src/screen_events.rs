//! Screen Lock/Unlock and Sleep/Wake Detection
//!
//! Listens for macOS system events:
//! - com.apple.screenIsLocked / com.apple.screenIsUnlocked (distributed notifications)
//! - NSWorkspaceWillSleepNotification / NSWorkspaceDidWakeNotification (workspace notifications)
//!
//! Inspired by Cronus's sleepAndLockObserver.mm implementation.

#![cfg(target_os = "macos")]

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use objc2::rc::Retained;
use objc2::{declare_class, msg_send_id, mutability, ClassType, DeclaredClass};
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSNotification, NSNotificationCenter, NSNotificationName, NSObject};
use tracing::{debug, info};

/// Types of screen events
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScreenEventType {
    /// Screen was locked
    ScreenLocked,
    /// Screen was unlocked
    ScreenUnlocked,
    /// System is going to sleep
    WillSleep,
    /// System woke from sleep
    DidWake,
}

impl std::fmt::Display for ScreenEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScreenEventType::ScreenLocked => write!(f, "screen_locked"),
            ScreenEventType::ScreenUnlocked => write!(f, "screen_unlocked"),
            ScreenEventType::WillSleep => write!(f, "will_sleep"),
            ScreenEventType::DidWake => write!(f, "did_wake"),
        }
    }
}

/// Event sent when a screen state change is detected
#[derive(Debug, Clone)]
pub struct ScreenEvent {
    pub event_type: ScreenEventType,
    pub timestamp_ms: u64,
}

/// Global channel for sending screen events
static SCREEN_EVENT_SENDER: OnceLock<Mutex<Option<Sender<ScreenEvent>>>> = OnceLock::new();

/// Set up the global sender for screen events
fn set_screen_event_sender(sender: Sender<ScreenEvent>) {
    let sender_clone = sender.clone();
    let _ = SCREEN_EVENT_SENDER.get_or_init(|| Mutex::new(Some(sender)));
    if let Some(mutex) = SCREEN_EVENT_SENDER.get() {
        if let Ok(mut guard) = mutex.lock() {
            *guard = Some(sender_clone);
        }
    }
}

/// Send a screen event through the global channel
fn send_screen_event(event: ScreenEvent) {
    if let Some(mutex) = SCREEN_EVENT_SENDER.get() {
        if let Ok(guard) = mutex.lock() {
            if let Some(ref sender) = *guard {
                let _ = sender.send(event);
            }
        }
    }
}

/// Get current timestamp in milliseconds
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

// Declare a class to receive screen lock/unlock notifications via distributed notification center
declare_class!(
    struct ScreenLockObserver;

    unsafe impl ClassType for ScreenLockObserver {
        type Super = NSObject;
        type Mutability = mutability::InteriorMutable;
        const NAME: &'static str = "RitualScreenLockObserver";
    }

    impl DeclaredClass for ScreenLockObserver {}

    unsafe impl ScreenLockObserver {
        #[method(handleScreenLocked:)]
        fn handle_screen_locked(&self, _notification: &NSNotification) {
            debug!("🔒 Screen locked detected");
            send_screen_event(ScreenEvent {
                event_type: ScreenEventType::ScreenLocked,
                timestamp_ms: now_ms(),
            });
        }

        #[method(handleScreenUnlocked:)]
        fn handle_screen_unlocked(&self, _notification: &NSNotification) {
            debug!("🔓 Screen unlocked detected");
            send_screen_event(ScreenEvent {
                event_type: ScreenEventType::ScreenUnlocked,
                timestamp_ms: now_ms(),
            });
        }

        #[method(handleWillSleep:)]
        fn handle_will_sleep(&self, _notification: &NSNotification) {
            debug!("💤 System will sleep");
            send_screen_event(ScreenEvent {
                event_type: ScreenEventType::WillSleep,
                timestamp_ms: now_ms(),
            });
        }

        #[method(handleDidWake:)]
        fn handle_did_wake(&self, _notification: &NSNotification) {
            debug!("⏰ System did wake");
            send_screen_event(ScreenEvent {
                event_type: ScreenEventType::DidWake,
                timestamp_ms: now_ms(),
            });
        }
    }
);

impl ScreenLockObserver {
    fn new() -> Retained<Self> {
        unsafe { msg_send_id![Self::alloc(), init] }
    }
}

/// Screen event listener that runs on a background thread
pub struct ScreenEventListener {
    receiver: Receiver<ScreenEvent>,
    _thread_handle: thread::JoinHandle<()>,
}

impl ScreenEventListener {
    /// Create and start the screen event listener
    ///
    /// This spawns a background thread that:
    /// 1. Creates observers for screen lock/unlock (distributed notifications)
    /// 2. Creates observers for sleep/wake (workspace notifications)
    /// 3. Runs an NSRunLoop to receive notifications
    /// 4. Sends events through a channel to the main watcher loop
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        set_screen_event_sender(sender);

        let thread_handle = thread::spawn(|| {
            run_screen_event_loop();
        });

        // Give the thread a moment to set up
        thread::sleep(Duration::from_millis(100));

        info!("🔒 Screen lock/unlock and sleep/wake detection enabled");

        ScreenEventListener {
            receiver,
            _thread_handle: thread_handle,
        }
    }

    /// Try to receive a screen event (non-blocking)
    pub fn try_recv(&self) -> Option<ScreenEvent> {
        self.receiver.try_recv().ok()
    }

    /// Drain all pending events
    pub fn drain(&self) -> Vec<ScreenEvent> {
        let mut events = Vec::new();
        while let Ok(event) = self.receiver.try_recv() {
            events.push(event);
        }
        events
    }
}

/// Run the screen event loop on a background thread
fn run_screen_event_loop() {
    unsafe {
        // Create our observer
        let observer = ScreenLockObserver::new();

        // Get the distributed notification center for screen lock/unlock
        // NSDistributedNotificationCenter is used for system-wide notifications
        let distributed_center_class =
            objc2::runtime::AnyClass::get("NSDistributedNotificationCenter")
                .expect("NSDistributedNotificationCenter class not found");

        let distributed_center: Retained<NSNotificationCenter> =
            msg_send_id![distributed_center_class, defaultCenter];

        // Register for screen lock notification
        let lock_name = NSNotificationName::from_str("com.apple.screenIsLocked");
        distributed_center.addObserver_selector_name_object(
            &observer,
            objc2::sel!(handleScreenLocked:),
            Some(&lock_name),
            None,
        );

        // Register for screen unlock notification
        let unlock_name = NSNotificationName::from_str("com.apple.screenIsUnlocked");
        distributed_center.addObserver_selector_name_object(
            &observer,
            objc2::sel!(handleScreenUnlocked:),
            Some(&unlock_name),
            None,
        );

        info!("🔒 Registered for screen lock/unlock notifications");

        // Get the workspace notification center for sleep/wake
        let workspace = NSWorkspace::sharedWorkspace();
        let workspace_center = workspace.notificationCenter();

        // Register for will sleep notification
        let sleep_name = NSNotificationName::from_str("NSWorkspaceWillSleepNotification");
        workspace_center.addObserver_selector_name_object(
            &observer,
            objc2::sel!(handleWillSleep:),
            Some(&sleep_name),
            None,
        );

        // Register for did wake notification
        let wake_name = NSNotificationName::from_str("NSWorkspaceDidWakeNotification");
        workspace_center.addObserver_selector_name_object(
            &observer,
            objc2::sel!(handleDidWake:),
            Some(&wake_name),
            None,
        );

        info!("💤 Registered for sleep/wake notifications");

        // Run the run loop indefinitely
        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" {
            fn CFRunLoopRun();
        }

        CFRunLoopRun();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_screen_event_type_display() {
        assert_eq!(ScreenEventType::ScreenLocked.to_string(), "screen_locked");
        assert_eq!(
            ScreenEventType::ScreenUnlocked.to_string(),
            "screen_unlocked"
        );
        assert_eq!(ScreenEventType::WillSleep.to_string(), "will_sleep");
        assert_eq!(ScreenEventType::DidWake.to_string(), "did_wake");
    }
}
