//! AFK (Away From Keyboard) Detection
//!
//! Uses macOS CoreGraphics to detect time since last user input.
//! Based on ActivityWatch's aw-watcher-afk implementation.

#![allow(dead_code)] // Public API - methods may be used externally

use tracing::debug;

/// AFK detection state
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AfkState {
    /// User is active (recently provided input)
    Active,
    /// User is AFK (no input for timeout duration)
    Afk,
}

/// Get seconds since last user input (keyboard or mouse)
#[cfg(target_os = "macos")]
pub fn seconds_since_last_input() -> f64 {
    // Link to CoreGraphics function directly
    // CGEventSourceStateID::HIDSystemState = 1
    // kCGAnyInputEventType = ~0 (all input types)
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(
            stateID: u32,
            eventType: u32,
        ) -> f64;
    }
    
    const HID_SYSTEM_STATE: u32 = 1;
    const ANY_INPUT_EVENT: u32 = !0u32;
    
    unsafe {
        CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, ANY_INPUT_EVENT)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn seconds_since_last_input() -> f64 {
    // On non-macOS platforms, always return 0 (assume active)
    0.0
}

/// AFK watcher that tracks user activity state
pub struct AfkWatcher {
    /// Timeout in seconds before considering user AFK
    timeout_seconds: f64,
    /// Current AFK state
    current_state: AfkState,
    /// Timestamp when user became AFK (if currently AFK)
    afk_since: Option<u64>,
}

impl AfkWatcher {
    /// Create a new AFK watcher with the specified timeout
    pub fn new(timeout_seconds: f64) -> Self {
        Self {
            timeout_seconds,
            current_state: AfkState::Active,
            afk_since: None,
        }
    }
    
    /// Check current AFK status and return state change if any
    /// Returns (current_state, state_changed, seconds_since_input)
    pub fn check(&mut self, now_ms: u64) -> (AfkState, bool, f64) {
        let seconds_since_input = seconds_since_last_input();
        let was_afk = self.current_state == AfkState::Afk;
        let is_now_afk = seconds_since_input >= self.timeout_seconds;
        
        let state_changed = was_afk != is_now_afk;
        
        if state_changed {
            if is_now_afk {
                debug!(
                    "User became AFK (no input for {:.1}s, timeout: {}s)",
                    seconds_since_input, self.timeout_seconds
                );
                self.current_state = AfkState::Afk;
                self.afk_since = Some(now_ms - (seconds_since_input * 1000.0) as u64);
            } else {
                debug!(
                    "User returned from AFK (input detected, was away for {:.1}s)",
                    seconds_since_input
                );
                self.current_state = AfkState::Active;
                self.afk_since = None;
            }
        }
        
        (self.current_state, state_changed, seconds_since_input)
    }
    
    /// Get the current state
    pub fn state(&self) -> AfkState {
        self.current_state
    }
    
    /// Get when the user became AFK (if currently AFK)
    pub fn afk_since(&self) -> Option<u64> {
        self.afk_since
    }
    
    /// Check if user is currently AFK
    pub fn is_afk(&self) -> bool {
        self.current_state == AfkState::Afk
    }
    
    /// Get the timeout in seconds
    pub fn timeout(&self) -> f64 {
        self.timeout_seconds
    }
    
    /// Set a new timeout
    pub fn set_timeout(&mut self, timeout_seconds: f64) {
        self.timeout_seconds = timeout_seconds;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_afk_watcher_initial_state() {
        let watcher = AfkWatcher::new(300.0);
        assert_eq!(watcher.state(), AfkState::Active);
        assert!(!watcher.is_afk());
        assert!(watcher.afk_since().is_none());
    }
    
    #[test]
    fn test_afk_watcher_timeout() {
        let watcher = AfkWatcher::new(300.0);
        assert_eq!(watcher.timeout(), 300.0);
    }
}

