//! Browser URL and tab tracking
//!
//! Uses osascript (JXA - JavaScript for Automation) to extract:
//! - Current URL from Safari, Chrome, Brave, Firefox, Arc
//! - Incognito/private browsing status
//! - Tab title
//!
//! Based on ActivityWatch's aw-watcher-window JXA implementation.

#![allow(dead_code)] // Public API - fields may be used for future features

use std::process::Command;
use tracing::{debug, warn};

/// Browser information extracted via JXA
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

/// JavaScript for Automation (JXA) script to extract browser info
/// Based on ActivityWatch's printAppStatus.jxa
const JXA_BROWSER_SCRIPT: &str = r#"
(function() {
    var seApp = Application("System Events");
    var frontProc = seApp.processes.whose({frontmost: true})[0];
    var appName = frontProc.displayedName();
    
    var url, title, incognito;
    
    try {
        switch(appName) {
            case "Safari":
                var safari = Application("Safari");
                if (safari.documents.length > 0) {
                    url = safari.documents[0].url();
                    title = safari.documents[0].name();
                }
                // Safari doesn't expose private browsing state via AppleScript
                incognito = false;
                break;
                
            case "Google Chrome":
            case "Google Chrome Canary":
            case "Chromium":
            case "Brave Browser":
            case "Microsoft Edge":
            case "Vivaldi":
            case "Opera":
                var browser = Application(appName);
                if (browser.windows.length > 0) {
                    var activeWindow = browser.windows[0];
                    var activeTab = activeWindow.activeTab();
                    url = activeTab.url();
                    title = activeTab.name();
                    incognito = (activeWindow.mode() === 'incognito');
                }
                break;
                
            case "Arc":
                var arc = Application("Arc");
                if (arc.windows.length > 0) {
                    var activeTab = arc.windows[0].activeTab();
                    url = activeTab.url();
                    title = activeTab.title();
                    // Arc doesn't have a simple incognito mode check
                    incognito = false;
                }
                break;
                
            case "Firefox":
            case "Firefox Developer Edition":
            case "Firefox Nightly":
                // Firefox doesn't expose URL via AppleScript
                // We can only get the window title
                var firefox = Application(appName);
                if (firefox.windows.length > 0) {
                    title = firefox.windows[0].name();
                }
                // Try to extract URL from title (many sites include domain in title)
                url = null;
                incognito = false;
                break;
                
            default:
                // Not a known browser
                return JSON.stringify({app: appName, url: null, title: null, incognito: false});
        }
    } catch(e) {
        // Error accessing browser - might be closed or permission denied
        return JSON.stringify({app: appName, url: null, title: null, incognito: false, error: e.toString()});
    }
    
    return JSON.stringify({
        app: appName,
        url: url || null,
        title: title || null,
        incognito: incognito || false
    });
})();
"#;

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
        // Could be about:, chrome://, file://, etc.
        if url.starts_with("about:") || url.starts_with("chrome://") || 
           url.starts_with("edge://") || url.starts_with("brave://") ||
           url.starts_with("file://") {
            return Some(url.split("://").next().unwrap_or("internal").to_string());
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

/// Get browser information using JXA/osascript
pub fn get_browser_info(bundle_id: &str) -> BrowserInfo {
    // Only try to get browser info for known browsers
    if !is_browser(bundle_id) {
        return BrowserInfo::default();
    }
    
    // Execute JXA script via osascript
    let output = match Command::new("osascript")
        .arg("-l")
        .arg("JavaScript")
        .arg("-e")
        .arg(JXA_BROWSER_SCRIPT)
        .output()
    {
        Ok(output) => output,
        Err(e) => {
            warn!("Failed to execute osascript: {}", e);
            return BrowserInfo::default();
        }
    };
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        debug!("osascript failed: {}", stderr);
        return BrowserInfo::default();
    }
    
    // Parse JSON output
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_str = stdout.trim();
    
    debug!("JXA output: {}", json_str);
    
    // Parse the JSON response
    match serde_json::from_str::<serde_json::Value>(json_str) {
        Ok(json) => {
            let url = json.get("url")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            
            let title = json.get("title")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            
            let is_incognito = json.get("incognito")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            
            let domain = url.as_ref().and_then(|u| extract_domain(u));
            
            BrowserInfo {
                url,
                title,
                is_incognito,
                domain,
            }
        }
        Err(e) => {
            debug!("Failed to parse JXA output: {}", e);
            BrowserInfo::default()
        }
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
    }
    
    #[test]
    fn test_is_browser() {
        assert!(is_browser("com.apple.Safari"));
        assert!(is_browser("com.google.Chrome"));
        assert!(is_browser("org.mozilla.firefox"));
        assert!(!is_browser("com.apple.finder"));
        assert!(!is_browser("com.spotify.client"));
    }
}

