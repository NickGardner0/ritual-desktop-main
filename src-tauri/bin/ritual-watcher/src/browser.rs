//! Browser URL and tab tracking
//!
//! Uses native NSAppleScript via objc2 bindings for fast browser info extraction.
//! Falls back to osascript (JXA) if native fails.
//!
//! Supported browsers:
//! - Safari, Chrome, Brave, Firefox, Arc, Edge, Vivaldi, Opera
//!
//! Based on ActivityWatch's aw-watcher-window and improved with native bindings.

#![allow(dead_code)] // Public API - fields may be used for future features

use tracing::trace;

#[cfg(target_os = "macos")]
use crate::applescript_ffi::get_native_browser_info;

/// Browser information extracted via AppleScript
#[derive(Debug, Clone, Default)]
pub struct BrowserInfo {
    /// The URL of the active tab (if accessible)
    pub url: Option<String>,
    /// The title of the active tab
    pub title: Option<String>,
    /// Whether the browser is in incognito/private mode
    pub is_incognito: bool,
    /// The domain extracted from the URL
    pub domain: Option<String>,
}

/// Known browser bundle IDs
const BROWSER_BUNDLE_IDS: &[&str] = &[
    "com.apple.Safari",
    "com.google.Chrome",
    "com.google.Chrome.canary",
    "org.chromium.Chromium",
    "com.brave.Browser",
    "com.microsoft.edgemac",
    "com.vivaldi.Vivaldi",
    "com.operasoftware.Opera",
    "company.thebrowser.Browser", // Arc
    "org.mozilla.firefox",
    "org.mozilla.firefoxdeveloperedition",
    "org.mozilla.nightly",
];

/// Check if the given bundle ID is a known browser
pub fn is_browser(bundle_id: &str) -> bool {
    BROWSER_BUNDLE_IDS.iter().any(|&b| b == bundle_id)
}

/// Extract the domain from a URL
fn extract_domain(url: &str) -> Option<String> {
    // Handle common URL formats
    let url = url.trim();
    
    // Skip non-http(s) URLs
    if !url.starts_with("http://") && !url.starts_with("https://") {
        // Could be about:, chrome://, file://, arc://, etc.
        if url.starts_with("about:") || url.starts_with("chrome://") || 
           url.starts_with("edge://") || url.starts_with("brave://") ||
           url.starts_with("arc://") || url.starts_with("vivaldi://") ||
           url.starts_with("file://") {
            // Handle both "scheme://" and "scheme:" (e.g., about:blank)
            let scheme = url.split("://").next()
                .and_then(|s| s.split(':').next())
                .unwrap_or("internal");
            return Some(scheme.to_string());
        }
        return None;
    }
    
    // Extract domain from URL
    let without_protocol = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    
    // Get the host part (before any path, query, or fragment)
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
    
    // Remove port if present
    let domain = host.split(':').next().unwrap_or(host);
    
    // Remove www. prefix for cleaner display
    let clean_domain = domain.trim_start_matches("www.");
    
    if clean_domain.is_empty() {
        None
    } else {
        Some(clean_domain.to_string())
    }
}

/// Get browser information using native NSAppleScript
///
/// This is ~10x faster than the old osascript subprocess approach.
pub fn get_browser_info(bundle_id: &str) -> BrowserInfo {
    // Only try to get browser info for known browsers
    if !is_browser(bundle_id) {
        return BrowserInfo::default();
    }

    #[cfg(target_os = "macos")]
    {
        let native_info = get_native_browser_info(bundle_id);
        
        trace!(
            "Native browser info for {}: url={}, title={}, incognito={} ({}ms)",
            bundle_id,
            native_info.url.is_some(),
            native_info.title.is_some(),
            native_info.is_incognito,
            native_info.duration_ms
        );

        BrowserInfo {
            url: native_info.url,
            title: native_info.title,
            is_incognito: native_info.is_incognito,
            domain: native_info.domain,
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        debug!("Browser info extraction not supported on this platform");
        BrowserInfo::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_extract_domain() {
        assert_eq!(extract_domain("https://github.com/user/repo"), Some("github.com".to_string()));
        assert_eq!(extract_domain("https://www.twitter.com/home"), Some("twitter.com".to_string()));
        assert_eq!(extract_domain("http://localhost:3000/path"), Some("localhost".to_string()));
        assert_eq!(extract_domain("chrome://settings"), Some("chrome".to_string()));
        assert_eq!(extract_domain("about:blank"), Some("about".to_string()));
        assert_eq!(extract_domain("arc://boost/123"), Some("arc".to_string()));
        assert_eq!(extract_domain("vivaldi://settings"), Some("vivaldi".to_string()));
    }
    
    #[test]
    fn test_is_browser() {
        assert!(is_browser("com.apple.Safari"));
        assert!(is_browser("com.google.Chrome"));
        assert!(is_browser("org.mozilla.firefox"));
        assert!(is_browser("company.thebrowser.Browser")); // Arc
        assert!(is_browser("com.brave.Browser"));
        assert!(is_browser("com.microsoft.edgemac"));
        assert!(is_browser("com.vivaldi.Vivaldi"));
        assert!(is_browser("com.operasoftware.Opera"));
        assert!(!is_browser("com.apple.finder"));
        assert!(!is_browser("com.spotify.client"));
    }
}

