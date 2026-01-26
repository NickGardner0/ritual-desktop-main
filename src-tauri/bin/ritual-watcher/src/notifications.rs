//! Event-driven app switching detection using NSWorkspace notifications
//!
//! This module provides immediate detection of app switches by listening to
//! NSWorkspace.didActivateApplicationNotification instead of relying solely on polling.
//!
//! Inspired by ActivityWatch's Swift implementation.

#![cfg(target_os = "macos")]

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use objc2::rc::Retained;
use objc2::{declare_class, msg_send_id, mutability, ClassType, DeclaredClass};
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSNotification, NSNotificationName, NSObject};
use tracing::{debug, info};

/// Event sent when an app switch is detected
#[derive(Debug, Clone)]
pub struct AppSwitchEvent {
    pub bundle_id: String,
    pub app_name: String,
    pub timestamp_ms: u64,
}

/// Global channel for sending app switch events
static APP_SWITCH_SENDER: OnceLock<Mutex<Option<Sender<AppSwitchEvent>>>> = OnceLock::new();

/// Set up the global sender for app switch events
fn set_app_switch_sender(sender: Sender<AppSwitchEvent>) {
    let sender_clone = sender.clone();
    let _ = APP_SWITCH_SENDER.get_or_init(|| Mutex::new(Some(sender)));
    if let Some(mutex) = APP_SWITCH_SENDER.get() {
        if let Ok(mut guard) = mutex.lock() {
            *guard = Some(sender_clone);
        }
    }
}

/// Send an app switch event through the global channel
fn send_app_switch_event(event: AppSwitchEvent) {
    if let Some(mutex) = APP_SWITCH_SENDER.get() {
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

// Declare a class to receive notifications
declare_class!(
    struct AppSwitchObserver;

    // SAFETY: This is a simple observer with no mutable state accessed from callbacks
    unsafe impl ClassType for AppSwitchObserver {
        type Super = NSObject;
        type Mutability = mutability::InteriorMutable;
        const NAME: &'static str = "RitualAppSwitchObserver";
    }

    impl DeclaredClass for AppSwitchObserver {}

    unsafe impl AppSwitchObserver {
        #[method(handleAppActivation:)]
        fn handle_app_activation(&self, notification: &NSNotification) {
            // Get the activated application from the notification
            unsafe {
                let workspace = NSWorkspace::sharedWorkspace();
                if let Some(app) = workspace.frontmostApplication() {
                    let bundle_id = app
                        .bundleIdentifier()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "unknown".to_string());
                    
                    let app_name = app
                        .localizedName()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "Unknown".to_string());
                    
                    debug!("🔔 App switch detected: {} ({})", app_name, bundle_id);
                    
                    send_app_switch_event(AppSwitchEvent {
                        bundle_id,
                        app_name,
                        timestamp_ms: now_ms(),
                    });
                }
            }
        }
    }
);

impl AppSwitchObserver {
    fn new() -> Retained<Self> {
        unsafe { msg_send_id![Self::alloc(), init] }
    }
}

/// Notification listener that runs on a background thread with its own run loop
pub struct NotificationListener {
    receiver: Receiver<AppSwitchEvent>,
    _thread_handle: thread::JoinHandle<()>,
}

impl NotificationListener {
    /// Create and start the notification listener
    /// 
    /// This spawns a background thread that:
    /// 1. Creates an NSWorkspace notification observer
    /// 2. Runs an NSRunLoop to receive notifications
    /// 3. Sends events through a channel to the main watcher loop
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        set_app_switch_sender(sender);

        let thread_handle = thread::spawn(|| {
            run_notification_loop();
        });

        // Give the notification thread a moment to set up
        thread::sleep(Duration::from_millis(100));

        info!("🔔 Event-driven app switch detection enabled");

        NotificationListener {
            receiver,
            _thread_handle: thread_handle,
        }
    }

    /// Try to receive an app switch event (non-blocking)
    pub fn try_recv(&self) -> Option<AppSwitchEvent> {
        self.receiver.try_recv().ok()
    }

    /// Receive with timeout
    pub fn recv_timeout(&self, timeout: Duration) -> Option<AppSwitchEvent> {
        self.receiver.recv_timeout(timeout).ok()
    }

    /// Drain all pending events
    pub fn drain(&self) -> Vec<AppSwitchEvent> {
        let mut events = Vec::new();
        while let Ok(event) = self.receiver.try_recv() {
            events.push(event);
        }
        events
    }
}

/// Run the notification loop on a background thread
fn run_notification_loop() {
    // Use autoreleasepool macro pattern for objc2
    unsafe {
        // Create our observer - must be retained for the lifetime of observation
        let observer = AppSwitchObserver::new();

        // Get the workspace notification center
        let workspace = NSWorkspace::sharedWorkspace();
        let notification_center = workspace.notificationCenter();

        // Register for didActivateApplicationNotification
        // The notification name is "NSWorkspaceDidActivateApplicationNotification"
        let notification_name =
            NSNotificationName::from_str("NSWorkspaceDidActivateApplicationNotification");

        // Add observer
        notification_center.addObserver_selector_name_object(
            &observer,
            objc2::sel!(handleAppActivation:),
            Some(&notification_name),
            None,
        );

        info!("🔔 Registered for NSWorkspaceDidActivateApplicationNotification");

        // Use CFRunLoop directly for more control
        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" {
            fn CFRunLoopRun();
        }

        // Run the run loop indefinitely to receive notifications
        // The thread will be terminated when the main process exits
        CFRunLoopRun();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_now_ms() {
        let ts = now_ms();
        assert!(ts > 0);
    }
}
