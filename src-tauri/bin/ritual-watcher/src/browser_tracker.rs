//! Browser Tab Change Tracker
//!
//! Polls browser tabs at regular intervals (default 10s) to detect tab switches
//! within the same browser session. This catches URL/title changes that would
//! otherwise be missed by the main polling loop.
//!
//! Inspired by Cronus's browserTabTracking.mm implementation.

#![cfg(target_os = "macos")]

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use tracing::{debug, info, trace};

use crate::applescript_ffi::get_native_browser_info;
use crate::browser::is_browser;

/// Browser tab change event
#[derive(Debug, Clone)]
pub struct BrowserTabEvent {
    /// Bundle ID of the browser
    pub bundle_id: String,
    /// New URL (if changed or newly detected)
    pub url: Option<String>,
    /// New title (if changed or newly detected)
    pub title: Option<String>,
    /// Domain extracted from URL
    pub domain: Option<String>,
    /// Whether in incognito mode
    pub is_incognito: bool,
    /// Timestamp when detected
    pub timestamp_ms: u64,
    /// Whether URL changed
    pub url_changed: bool,
    /// Whether title changed
    pub title_changed: bool,
}

/// Internal state for tracking browser tabs
struct BrowserTabState {
    /// Currently active browser bundle ID (if any)
    active_browser: Option<String>,
    /// Last known URL
    last_url: Option<String>,
    /// Last known title
    last_title: Option<String>,
    /// Whether tracking is enabled
    enabled: bool,
    /// Last poll time
    last_poll: Instant,
}

impl Default for BrowserTabState {
    fn default() -> Self {
        Self {
            active_browser: None,
            last_url: None,
            last_title: None,
            enabled: true,
            last_poll: Instant::now(),
        }
    }
}

/// Global state for browser tracking
static BROWSER_STATE: OnceLock<Arc<Mutex<BrowserTabState>>> = OnceLock::new();
static TAB_EVENT_SENDER: OnceLock<Mutex<Option<Sender<BrowserTabEvent>>>> = OnceLock::new();

fn get_browser_state() -> Arc<Mutex<BrowserTabState>> {
    BROWSER_STATE
        .get_or_init(|| Arc::new(Mutex::new(BrowserTabState::default())))
        .clone()
}

fn set_tab_event_sender(sender: Sender<BrowserTabEvent>) {
    let sender_clone = sender.clone();
    let _ = TAB_EVENT_SENDER.get_or_init(|| Mutex::new(Some(sender)));
    if let Some(mutex) = TAB_EVENT_SENDER.get() {
        if let Ok(mut guard) = mutex.lock() {
            *guard = Some(sender_clone);
        }
    }
}

fn send_tab_event(event: BrowserTabEvent) {
    if let Some(mutex) = TAB_EVENT_SENDER.get() {
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

/// Browser tab tracker that polls tabs at regular intervals
pub struct BrowserTabTracker {
    receiver: Receiver<BrowserTabEvent>,
    _thread_handle: thread::JoinHandle<()>,
    poll_interval_secs: u64,
}

impl BrowserTabTracker {
    /// Create and start the browser tab tracker
    ///
    /// # Arguments
    /// * `poll_interval_secs` - How often to poll browser tabs (default: 10 seconds)
    pub fn new(poll_interval_secs: u64) -> Self {
        let (sender, receiver) = mpsc::channel();
        set_tab_event_sender(sender);

        let interval = poll_interval_secs;
        let thread_handle = thread::spawn(move || {
            run_browser_poll_loop(interval);
        });

        info!(
            "🌐 Browser tab tracking enabled ({}s interval)",
            poll_interval_secs
        );

        BrowserTabTracker {
            receiver,
            _thread_handle: thread_handle,
            poll_interval_secs,
        }
    }

    /// Try to receive a tab event (non-blocking)
    pub fn try_recv(&self) -> Option<BrowserTabEvent> {
        self.receiver.try_recv().ok()
    }

    /// Drain all pending events
    pub fn drain(&self) -> Vec<BrowserTabEvent> {
        let mut events = Vec::new();
        while let Ok(event) = self.receiver.try_recv() {
            events.push(event);
        }
        events
    }

    /// Get the poll interval
    pub fn poll_interval(&self) -> u64 {
        self.poll_interval_secs
    }
}

/// Notify the tracker that a browser became active
pub fn set_active_browser(bundle_id: Option<String>) {
    if let Ok(mut state) = get_browser_state().lock() {
        let was_browser = state.active_browser.is_some();
        let is_browser_now = bundle_id
            .as_ref()
            .map(|id| is_browser(id))
            .unwrap_or(false);

        if is_browser_now {
            let new_bundle = bundle_id.clone();
            if state.active_browser != new_bundle {
                debug!(
                    "🌐 Browser activated: {:?} -> {:?}",
                    state.active_browser, new_bundle
                );
                // Clear last known state when switching browsers
                state.last_url = None;
                state.last_title = None;
                state.active_browser = new_bundle;
            }
        } else if was_browser {
            debug!("🌐 Browser deactivated: {:?}", state.active_browser);
            state.active_browser = None;
            state.last_url = None;
            state.last_title = None;
        }
    }
}

/// Check if browser tab tracking is currently active
pub fn is_tracking_active() -> bool {
    get_browser_state()
        .lock()
        .map(|s| s.active_browser.is_some() && s.enabled)
        .unwrap_or(false)
}

/// Enable or disable browser tab tracking
pub fn set_tracking_enabled(enabled: bool) {
    if let Ok(mut state) = get_browser_state().lock() {
        state.enabled = enabled;
        debug!("🌐 Browser tab tracking {}", if enabled { "enabled" } else { "disabled" });
    }
}

/// Run the browser tab polling loop
fn run_browser_poll_loop(interval_secs: u64) {
    let poll_interval = Duration::from_secs(interval_secs);

    loop {
        thread::sleep(poll_interval);

        // Check if we have an active browser
        let (bundle_id, last_url, last_title) = {
            let state_arc = get_browser_state();
            let state = match state_arc.lock() {
                Ok(s) => s,
                Err(_) => continue,
            };

            if !state.enabled {
                continue;
            }

            match &state.active_browser {
                Some(id) => (
                    id.clone(),
                    state.last_url.clone(),
                    state.last_title.clone(),
                ),
                None => continue,
            }
        };

        // Poll the browser
        trace!("🌐 Polling browser tabs for {}", bundle_id);
        let info = get_native_browser_info(&bundle_id);

        // Check for changes
        let url_changed = info.url != last_url && info.url.is_some();
        let title_changed = info.title != last_title && info.title.is_some();

        if url_changed || title_changed {
            debug!(
                "🌐 Browser tab change detected in {}:",
                bundle_id
            );
            if url_changed {
                debug!(
                    "   URL: {:?} -> {:?}",
                    last_url.as_ref().map(|s| truncate(s, 50)),
                    info.url.as_ref().map(|s| truncate(s, 50))
                );
            }
            if title_changed {
                debug!(
                    "   Title: {:?} -> {:?}",
                    last_title.as_ref().map(|s| truncate(s, 30)),
                    info.title.as_ref().map(|s| truncate(s, 30))
                );
            }

            // Update state
            if let Ok(mut state) = get_browser_state().lock() {
                state.last_url = info.url.clone();
                state.last_title = info.title.clone();
                state.last_poll = Instant::now();
            }

            // Send event
            send_tab_event(BrowserTabEvent {
                bundle_id,
                url: info.url,
                title: info.title,
                domain: info.domain,
                is_incognito: info.is_incognito,
                timestamp_ms: now_ms(),
                url_changed,
                title_changed,
            });
        } else {
            trace!(
                "🌐 No browser tab change (url={:?}, title={:?})",
                info.url.as_ref().map(|s| truncate(s, 30)),
                info.title.as_ref().map(|s| truncate(s, 20))
            );
        }
    }
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() > max_len {
        format!("{}...", &s[..max_len])
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_browser_state_default() {
        let state = BrowserTabState::default();
        assert!(state.active_browser.is_none());
        assert!(state.last_url.is_none());
        assert!(state.enabled);
    }

    #[test]
    fn test_truncate() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello world", 5), "hello...");
    }
}
