//! Window Title Change Observer using Accessibility API
//!
//! Uses AXObserver with kAXMainWindowChangedNotification and kAXTitleChangedNotification
//! to detect window title changes within the same application.
//!
//! Inspired by Cronus's activeWindowObserver.mm implementation.

#![cfg(target_os = "macos")]

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use core_foundation::base::{CFRelease, TCFType};
use core_foundation::runloop::{
    kCFRunLoopDefaultMode, CFRunLoopAddSource, CFRunLoopGetCurrent,
};
use core_foundation::string::CFString;
use tracing::{debug, info, trace, warn};

/// Window change event
#[derive(Debug, Clone)]
pub struct WindowChangeEvent {
    /// Process ID of the app
    pub pid: i32,
    /// New window title (if available)
    pub title: Option<String>,
    /// Timestamp when detected
    pub timestamp_ms: u64,
    /// Type of change
    pub change_type: WindowChangeType,
}

/// Type of window change
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowChangeType {
    /// Main window changed
    MainWindowChanged,
    /// Title of current window changed
    TitleChanged,
    /// Focused UI element changed
    FocusedUIElementChanged,
}

impl std::fmt::Display for WindowChangeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WindowChangeType::MainWindowChanged => write!(f, "main_window_changed"),
            WindowChangeType::TitleChanged => write!(f, "title_changed"),
            WindowChangeType::FocusedUIElementChanged => write!(f, "focused_ui_changed"),
        }
    }
}

// FFI types for Accessibility API
#[repr(C)]
struct __AXUIElement(std::ffi::c_void);
type AXUIElementRef = *mut __AXUIElement;

#[repr(C)]
struct __AXObserver(std::ffi::c_void);
type AXObserverRef = *mut __AXObserver;

type AXError = i32;
const K_AX_ERROR_SUCCESS: AXError = 0;

// Accessibility API functions
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: core_foundation::string::CFStringRef,
        value: *mut *const std::ffi::c_void,
    ) -> AXError;
    fn AXObserverCreate(
        application: i32,
        callback: extern "C" fn(AXObserverRef, AXUIElementRef, core_foundation::string::CFStringRef, *mut std::ffi::c_void),
        observer_out: *mut AXObserverRef,
    ) -> AXError;
    fn AXObserverGetRunLoopSource(
        observer: AXObserverRef,
    ) -> core_foundation::runloop::CFRunLoopSourceRef;
    fn AXObserverAddNotification(
        observer: AXObserverRef,
        element: AXUIElementRef,
        notification: core_foundation::string::CFStringRef,
        refcon: *mut std::ffi::c_void,
    ) -> AXError;
    fn AXObserverRemoveNotification(
        observer: AXObserverRef,
        element: AXUIElementRef,
        notification: core_foundation::string::CFStringRef,
    ) -> AXError;
    fn AXIsProcessTrusted() -> bool;
}

// Notification names
fn k_ax_main_window_changed_notification() -> CFString {
    CFString::new("AXMainWindowChangedNotification")
}

fn k_ax_title_changed_notification() -> CFString {
    CFString::new("AXTitleChangedNotification")
}

fn k_ax_focused_ui_element_changed_notification() -> CFString {
    CFString::new("AXFocusedUIElementChangedNotification")
}

/// Global state for window observer
struct WindowObserverState {
    /// Currently observed PID
    current_pid: Option<i32>,
    /// Current AXObserver (raw pointer, managed manually)
    observer: Option<AXObserverRef>,
    /// Current app element
    app_element: Option<AXUIElementRef>,
    /// Whether enabled
    enabled: bool,
}

impl Default for WindowObserverState {
    fn default() -> Self {
        Self {
            current_pid: None,
            observer: None,
            app_element: None,
            enabled: true,
        }
    }
}

// Safety: We manage the pointers carefully
unsafe impl Send for WindowObserverState {}

static WINDOW_STATE: OnceLock<Arc<Mutex<WindowObserverState>>> = OnceLock::new();
static WINDOW_EVENT_SENDER: OnceLock<Mutex<Option<Sender<WindowChangeEvent>>>> = OnceLock::new();

fn get_window_state() -> Arc<Mutex<WindowObserverState>> {
    WINDOW_STATE
        .get_or_init(|| Arc::new(Mutex::new(WindowObserverState::default())))
        .clone()
}

fn set_window_event_sender(sender: Sender<WindowChangeEvent>) {
    let sender_clone = sender.clone();
    let _ = WINDOW_EVENT_SENDER.get_or_init(|| Mutex::new(Some(sender)));
    if let Some(mutex) = WINDOW_EVENT_SENDER.get() {
        if let Ok(mut guard) = mutex.lock() {
            *guard = Some(sender_clone);
        }
    }
}

fn send_window_event(event: WindowChangeEvent) {
    if let Some(mutex) = WINDOW_EVENT_SENDER.get() {
        if let Ok(guard) = mutex.lock() {
            if let Some(ref sender) = *guard {
                let _ = sender.send(event);
            }
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

/// Callback function for AXObserver notifications
extern "C" fn ax_observer_callback(
    _observer: AXObserverRef,
    element: AXUIElementRef,
    notification_name: core_foundation::string::CFStringRef,
    refcon: *mut std::ffi::c_void,
) {
    unsafe {
        let pid = refcon as i32;
        let notification = CFString::wrap_under_get_rule(notification_name);
        let notification_str = notification.to_string();

        let change_type = if notification_str.contains("MainWindow") {
            WindowChangeType::MainWindowChanged
        } else if notification_str.contains("Title") {
            WindowChangeType::TitleChanged
        } else {
            WindowChangeType::FocusedUIElementChanged
        };

        trace!(
            "🪟 AX notification: {} for PID {}",
            notification_str,
            pid
        );

        // Try to get the window title
        let title = get_window_title_for_element(element);

        send_window_event(WindowChangeEvent {
            pid,
            title,
            timestamp_ms: now_ms(),
            change_type,
        });
    }
}

/// Get window title from an AX element
unsafe fn get_window_title_for_element(element: AXUIElementRef) -> Option<String> {
    if element.is_null() {
        return None;
    }

    let title_attr = CFString::new("AXTitle");
    let mut title_value: *const std::ffi::c_void = std::ptr::null();

    let result = AXUIElementCopyAttributeValue(
        element,
        title_attr.as_concrete_TypeRef(),
        &mut title_value,
    );

    if result == K_AX_ERROR_SUCCESS && !title_value.is_null() {
        let title_cf = CFString::wrap_under_create_rule(title_value as _);
        Some(title_cf.to_string())
    } else {
        None
    }
}

/// Window change listener
pub struct WindowChangeListener {
    receiver: Receiver<WindowChangeEvent>,
}

impl WindowChangeListener {
    /// Create the window change listener
    ///
    /// Note: Unlike other listeners, this doesn't spawn a dedicated thread.
    /// Instead, the observers are registered on the main run loop when
    /// `observe_app` is called.
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        set_window_event_sender(sender);

        // Check accessibility permissions
        let has_ax_permission = unsafe { AXIsProcessTrusted() };
        if has_ax_permission {
            info!("🪟 Window title change observer ready (AX permissions granted)");
        } else {
            warn!("🪟 Window title observer disabled - Accessibility permission not granted");
        }

        WindowChangeListener { receiver }
    }

    /// Try to receive a window change event (non-blocking)
    pub fn try_recv(&self) -> Option<WindowChangeEvent> {
        self.receiver.try_recv().ok()
    }

    /// Drain all pending events
    pub fn drain(&self) -> Vec<WindowChangeEvent> {
        let mut events = Vec::new();
        while let Ok(event) = self.receiver.try_recv() {
            events.push(event);
        }
        events
    }

    /// Check if accessibility permission is granted
    pub fn has_permission() -> bool {
        unsafe { AXIsProcessTrusted() }
    }
}

/// Start observing window changes for a specific app
///
/// This should be called when the active app changes to set up observers
/// for window title changes within that app.
pub fn observe_app(pid: i32) {
    // Check permissions first
    let has_permission = unsafe { AXIsProcessTrusted() };
    if !has_permission {
        trace!("🪟 Skipping AX observer - no permission");
        return;
    }

    let state_arc = get_window_state();
    let mut state = match state_arc.lock() {
        Ok(s) => s,
        Err(_) => return,
    };

    if !state.enabled {
        return;
    }

    // If already observing this PID, do nothing
    if state.current_pid == Some(pid) {
        return;
    }

    // Clean up previous observer
    cleanup_observer(&mut state);

    // Create new observer
    unsafe {
        let app_element = AXUIElementCreateApplication(pid);
        if app_element.is_null() {
            warn!("🪟 Failed to create AX element for PID {}", pid);
            return;
        }

        let mut observer: AXObserverRef = std::ptr::null_mut();
        let create_result = AXObserverCreate(pid, ax_observer_callback, &mut observer);

        if create_result != K_AX_ERROR_SUCCESS || observer.is_null() {
            warn!(
                "🪟 Failed to create AX observer for PID {}: error {}",
                pid, create_result
            );
            CFRelease(app_element as _);
            return;
        }

        // Add notifications
        let refcon = pid as *mut std::ffi::c_void;

        // Main window changed
        let main_window_notif = k_ax_main_window_changed_notification();
        AXObserverAddNotification(
            observer,
            app_element,
            main_window_notif.as_concrete_TypeRef(),
            refcon,
        );

        // Title changed
        let title_notif = k_ax_title_changed_notification();
        AXObserverAddNotification(
            observer,
            app_element,
            title_notif.as_concrete_TypeRef(),
            refcon,
        );

        // Add to run loop
        let run_loop_source = AXObserverGetRunLoopSource(observer);
        if !run_loop_source.is_null() {
            CFRunLoopAddSource(CFRunLoopGetCurrent(), run_loop_source, kCFRunLoopDefaultMode);
        }

        debug!("🪟 Started observing window changes for PID {}", pid);

        state.current_pid = Some(pid);
        state.observer = Some(observer);
        state.app_element = Some(app_element);
    }
}

/// Stop observing the current app
pub fn stop_observing() {
    if let Ok(mut state) = get_window_state().lock() {
        cleanup_observer(&mut state);
    }
}

/// Clean up observer resources
fn cleanup_observer(state: &mut WindowObserverState) {
    unsafe {
        if let Some(observer) = state.observer.take() {
            if let Some(app_element) = state.app_element.take() {
                // Remove notifications
                let main_window_notif = k_ax_main_window_changed_notification();
                AXObserverRemoveNotification(
                    observer,
                    app_element,
                    main_window_notif.as_concrete_TypeRef(),
                );

                let title_notif = k_ax_title_changed_notification();
                AXObserverRemoveNotification(
                    observer,
                    app_element,
                    title_notif.as_concrete_TypeRef(),
                );

                CFRelease(app_element as _);
            }
            CFRelease(observer as _);
        }

        if let Some(pid) = state.current_pid.take() {
            debug!("🪟 Stopped observing window changes for PID {}", pid);
        }
    }
}

/// Enable or disable window observation
pub fn set_observation_enabled(enabled: bool) {
    if let Ok(mut state) = get_window_state().lock() {
        state.enabled = enabled;
        if !enabled {
            cleanup_observer(&mut state);
        }
        debug!(
            "🪟 Window observation {}",
            if enabled { "enabled" } else { "disabled" }
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_change_type_display() {
        assert_eq!(
            WindowChangeType::MainWindowChanged.to_string(),
            "main_window_changed"
        );
        assert_eq!(
            WindowChangeType::TitleChanged.to_string(),
            "title_changed"
        );
    }
}
