//! Native AppleScript Execution via NSAppleScript
//!
//! Provides Rust bindings to execute AppleScript natively without spawning
//! an osascript subprocess. This is ~10x faster than the subprocess approach.
//!
//! Uses objc2 for safe Objective-C interop.

#![cfg(target_os = "macos")]
#![allow(dead_code)]

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send_id};
use objc2_foundation::{NSDictionary, NSString};
use std::time::Instant;
use tracing::{debug, trace, warn};

/// Result of AppleScript execution
#[derive(Debug, Clone)]
pub struct AppleScriptResult {
    /// The string result from the script
    pub output: Option<String>,
    /// Error message if execution failed
    pub error: Option<String>,
    /// Execution time in milliseconds
    pub duration_ms: u64,
}

impl AppleScriptResult {
    pub fn success(output: String, duration_ms: u64) -> Self {
        Self {
            output: Some(output),
            error: None,
            duration_ms,
        }
    }

    pub fn error(error: String, duration_ms: u64) -> Self {
        Self {
            output: None,
            error: Some(error),
            duration_ms,
        }
    }

    pub fn empty(duration_ms: u64) -> Self {
        Self {
            output: None,
            error: None,
            duration_ms,
        }
    }

    pub fn is_success(&self) -> bool {
        self.error.is_none() && self.output.is_some()
    }
}

/// Execute an AppleScript string and return the result
///
/// This uses NSAppleScript directly instead of spawning osascript,
/// which is significantly faster (~10x improvement).
pub fn execute_applescript(script: &str) -> AppleScriptResult {
    let start = Instant::now();

    unsafe {
        // Create NSString from script source
        let script_source = NSString::from_str(script);

        // Create NSAppleScript instance
        let applescript_class = class!(NSAppleScript);
        let applescript: Option<Retained<AnyObject>> = msg_send_id![
            msg_send_id![applescript_class, alloc],
            initWithSource: &*script_source
        ];

        let applescript = match applescript {
            Some(script) => script,
            None => {
                let duration = start.elapsed().as_millis() as u64;
                return AppleScriptResult::error(
                    "Failed to create NSAppleScript".to_string(),
                    duration,
                );
            }
        };

        // Execute the script
        // NSAppleScript.executeAndReturnError returns NSAppleEventDescriptor
        let mut error_dict: *mut NSDictionary<NSString, AnyObject> = std::ptr::null_mut();
        let result: Option<Retained<AnyObject>> = msg_send_id![
            &*applescript,
            executeAndReturnError: &mut error_dict as *mut *mut NSDictionary<NSString, AnyObject>
        ];

        let duration = start.elapsed().as_millis() as u64;

        // Check for errors
        if !error_dict.is_null() {
            let error_dict_ref = &*error_dict;
            // Try to get error message
            let error_key = NSString::from_str("NSAppleScriptErrorMessage");
            let error_msg: Option<Retained<NSString>> =
                msg_send_id![error_dict_ref, objectForKey: &*error_key];

            let error_str = error_msg
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown AppleScript error".to_string());

            debug!("AppleScript error: {} ({}ms)", error_str, duration);
            return AppleScriptResult::error(error_str, duration);
        }

        // Extract string result from NSAppleEventDescriptor
        match result {
            Some(descriptor) => {
                // Try to get string value from descriptor
                let string_value: Option<Retained<NSString>> =
                    msg_send_id![&*descriptor, stringValue];

                match string_value {
                    Some(s) => {
                        let output = s.to_string();
                        trace!("AppleScript success: {} chars ({}ms)", output.len(), duration);
                        AppleScriptResult::success(output, duration)
                    }
                    None => {
                        // Descriptor exists but no string value
                        trace!("AppleScript returned non-string result ({}ms)", duration);
                        AppleScriptResult::empty(duration)
                    }
                }
            }
            None => {
                trace!("AppleScript returned nil ({}ms)", duration);
                AppleScriptResult::empty(duration)
            }
        }
    }
}

/// AppleScript to get Chrome tab info
pub const CHROME_TAB_SCRIPT: &str = r#"
tell application "Google Chrome"
    try
        set activeTab to active tab of front window
        set tabUrl to URL of activeTab
        set tabTitle to title of activeTab
        try
            set isIncognito to mode of front window is "incognito"
        on error
            set isIncognito to false
        end try
        return tabUrl & "|" & tabTitle & "|" & isIncognito
    on error errMsg
        return "ERROR|" & errMsg
    end try
end tell
"#;

/// AppleScript to get Safari tab info
pub const SAFARI_TAB_SCRIPT: &str = r#"
tell application "Safari"
    try
        set currentTab to current tab of front window
        set tabUrl to URL of currentTab
        set tabTitle to name of currentTab
        return tabUrl & "|" & tabTitle & "|false"
    on error errMsg
        return "ERROR|" & errMsg
    end try
end tell
"#;

/// AppleScript to get Arc tab info
pub const ARC_TAB_SCRIPT: &str = r#"
tell application "Arc"
    try
        set activeTab to active tab of front window
        set tabUrl to URL of activeTab
        set tabTitle to title of activeTab
        return tabUrl & "|" & tabTitle & "|false"
    on error errMsg
        return "ERROR|" & errMsg
    end try
end tell
"#;

/// AppleScript to get Brave tab info
pub const BRAVE_TAB_SCRIPT: &str = r#"
tell application "Brave Browser"
    try
        set activeTab to active tab of front window
        set tabUrl to URL of activeTab
        set tabTitle to title of activeTab
        try
            set isIncognito to mode of front window is "incognito"
        on error
            set isIncognito to false
        end try
        return tabUrl & "|" & tabTitle & "|" & isIncognito
    on error errMsg
        return "ERROR|" & errMsg
    end try
end tell
"#;

/// AppleScript to get Edge tab info
pub const EDGE_TAB_SCRIPT: &str = r#"
tell application "Microsoft Edge"
    try
        set activeTab to active tab of front window
        set tabUrl to URL of activeTab
        set tabTitle to title of activeTab
        try
            set isIncognito to mode of front window is "incognito"
        on error
            set isIncognito to false
        end try
        return tabUrl & "|" & tabTitle & "|" & isIncognito
    on error errMsg
        return "ERROR|" & errMsg
    end try
end tell
"#;

/// AppleScript to get Firefox window title (Firefox doesn't expose URL via AppleScript)
pub const FIREFOX_TAB_SCRIPT: &str = r#"
tell application "Firefox"
    try
        set windowTitle to name of front window
        return "|" & windowTitle & "|false"
    on error errMsg
        return "ERROR|" & errMsg
    end try
end tell
"#;

/// AppleScript to get Vivaldi tab info
pub const VIVALDI_TAB_SCRIPT: &str = r#"
tell application "Vivaldi"
    try
        set activeTab to active tab of front window
        set tabUrl to URL of activeTab
        set tabTitle to title of activeTab
        return tabUrl & "|" & tabTitle & "|false"
    on error errMsg
        return "ERROR|" & errMsg
    end try
end tell
"#;

/// AppleScript to get Opera tab info  
pub const OPERA_TAB_SCRIPT: &str = r#"
tell application "Opera"
    try
        set activeTab to active tab of front window
        set tabUrl to URL of activeTab
        set tabTitle to title of activeTab
        return tabUrl & "|" & tabTitle & "|false"
    on error errMsg
        return "ERROR|" & errMsg
    end try
end tell
"#;

/// Get the appropriate AppleScript for a browser bundle ID
pub fn get_browser_script(bundle_id: &str) -> Option<&'static str> {
    match bundle_id {
        "com.google.Chrome" | "com.google.Chrome.canary" => Some(CHROME_TAB_SCRIPT),
        "com.apple.Safari" => Some(SAFARI_TAB_SCRIPT),
        "company.thebrowser.Browser" => Some(ARC_TAB_SCRIPT),
        "com.brave.Browser" => Some(BRAVE_TAB_SCRIPT),
        "com.microsoft.edgemac" => Some(EDGE_TAB_SCRIPT),
        "org.mozilla.firefox" | "org.mozilla.firefoxdeveloperedition" | "org.mozilla.nightly" => {
            Some(FIREFOX_TAB_SCRIPT)
        }
        "com.vivaldi.Vivaldi" => Some(VIVALDI_TAB_SCRIPT),
        "com.operasoftware.Opera" => Some(OPERA_TAB_SCRIPT),
        "org.chromium.Chromium" => Some(CHROME_TAB_SCRIPT), // Chromium uses Chrome's AppleScript
        _ => None,
    }
}

/// Parsed browser tab information
#[derive(Debug, Clone, Default)]
pub struct NativeBrowserInfo {
    pub url: Option<String>,
    pub title: Option<String>,
    pub is_incognito: bool,
    pub domain: Option<String>,
    pub duration_ms: u64,
}

/// Extract domain from URL
fn extract_domain(url: &str) -> Option<String> {
    let url = url.trim();

    if !url.starts_with("http://") && !url.starts_with("https://") {
        if url.starts_with("about:")
            || url.starts_with("chrome://")
            || url.starts_with("edge://")
            || url.starts_with("brave://")
            || url.starts_with("file://")
        {
            return Some(url.split("://").next().unwrap_or("internal").to_string());
        }
        return None;
    }

    let without_protocol = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");

    let host = without_protocol
        .split('/')
        .next()
        .unwrap_or(without_protocol)
        .split('?')
        .next()
        .unwrap_or(without_protocol)
        .split('#')
        .next()
        .unwrap_or(without_protocol);

    let domain = host.split(':').next().unwrap_or(host);
    let clean_domain = domain.trim_start_matches("www.");

    if clean_domain.is_empty() {
        None
    } else {
        Some(clean_domain.to_string())
    }
}

/// Get browser tab info using native AppleScript execution
pub fn get_native_browser_info(bundle_id: &str) -> NativeBrowserInfo {
    let script = match get_browser_script(bundle_id) {
        Some(s) => s,
        None => {
            return NativeBrowserInfo::default();
        }
    };

    let result = execute_applescript(script);

    if let Some(error) = &result.error {
        debug!("Browser AppleScript error for {}: {}", bundle_id, error);
        return NativeBrowserInfo {
            duration_ms: result.duration_ms,
            ..Default::default()
        };
    }

    let output = match &result.output {
        Some(s) => s,
        None => {
            return NativeBrowserInfo {
                duration_ms: result.duration_ms,
                ..Default::default()
            };
        }
    };

    // Check for error response
    if output.starts_with("ERROR|") {
        let error_msg = output.trim_start_matches("ERROR|");
        debug!("Browser script error for {}: {}", bundle_id, error_msg);
        return NativeBrowserInfo {
            duration_ms: result.duration_ms,
            ..Default::default()
        };
    }

    // Parse the pipe-delimited response: url|title|isIncognito
    let parts: Vec<&str> = output.split('|').collect();
    if parts.len() < 3 {
        warn!(
            "Invalid browser script response for {}: {}",
            bundle_id, output
        );
        return NativeBrowserInfo {
            duration_ms: result.duration_ms,
            ..Default::default()
        };
    }

    let url = if parts[0].is_empty() {
        None
    } else {
        Some(parts[0].to_string())
    };
    let title = if parts[1].is_empty() {
        None
    } else {
        Some(parts[1].to_string())
    };
    let is_incognito = parts[2].to_lowercase() == "true";
    let domain = url.as_ref().and_then(|u| extract_domain(u));

    trace!(
        "Native browser info for {}: url={:?}, title={:?}, incognito={}, domain={:?} ({}ms)",
        bundle_id,
        url.as_ref().map(|s| if s.len() > 50 {
            format!("{}...", &s[..50])
        } else {
            s.clone()
        }),
        title.as_ref().map(|s| if s.len() > 30 {
            format!("{}...", &s[..30])
        } else {
            s.clone()
        }),
        is_incognito,
        domain,
        result.duration_ms
    );

    NativeBrowserInfo {
        url,
        title,
        is_incognito,
        domain,
        duration_ms: result.duration_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_domain() {
        assert_eq!(
            extract_domain("https://github.com/user/repo"),
            Some("github.com".to_string())
        );
        assert_eq!(
            extract_domain("https://www.twitter.com/home"),
            Some("twitter.com".to_string())
        );
        assert_eq!(
            extract_domain("http://localhost:3000/path"),
            Some("localhost".to_string())
        );
        assert_eq!(
            extract_domain("chrome://settings"),
            Some("chrome".to_string())
        );
    }

    #[test]
    fn test_get_browser_script() {
        assert!(get_browser_script("com.google.Chrome").is_some());
        assert!(get_browser_script("com.apple.Safari").is_some());
        assert!(get_browser_script("company.thebrowser.Browser").is_some());
        assert!(get_browser_script("com.apple.finder").is_none());
    }
}
