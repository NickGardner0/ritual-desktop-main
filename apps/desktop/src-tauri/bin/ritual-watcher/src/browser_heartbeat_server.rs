//! Browser Extension Heartbeat Server
//!
//! A lightweight HTTP server that receives heartbeat events from the Ritual
//! browser extension. Runs on localhost:8766 in a dedicated thread.
//!
//! The server implements heartbeat merging: consecutive heartbeats for the same
//! URL/domain extend the current session rather than creating new events.
//! This keeps the activity_events table clean and efficient.
//!
//! Events are stored with source='browser_extension' to distinguish them from
//! events detected by the watcher's own window/AppleScript polling.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};

use crate::database::WatcherDatabase;

/// Default port for the browser heartbeat server
pub const DEFAULT_PORT: u16 = 8766;

/// Maximum time (ms) between heartbeats before a session is considered stale
const SESSION_TIMEOUT_MS: u64 = 45_000; // 45 seconds (extension sends every 20s)
/// Reject or clamp timestamps that are clearly invalid (clock skew / stale replay)
const MAX_CLIENT_CLOCK_SKEW_MS: u64 = 60_000; // 60s future skew
const MAX_BACKFILL_AGE_MS: u64 = 24 * 60 * 60 * 1000; // 24h

/// Heartbeat payload from the browser extension
#[derive(Debug, Clone, Deserialize)]
pub struct BrowserHeartbeat {
    /// Full URL of the active tab
    pub url: Option<String>,
    /// Domain extracted from URL (e.g., "youtube.com")
    pub domain: Option<String>,
    /// Page title
    pub title: Option<String>,
    /// Whether the tab is playing audio
    #[serde(default)]
    pub audible: bool,
    /// Whether the tab is in incognito/private mode
    #[serde(default)]
    pub incognito: bool,
    /// Number of open tabs
    #[serde(default)]
    pub tab_count: u32,
    /// Browser name (e.g., "chrome", "brave", "firefox")
    #[serde(default = "default_browser")]
    pub browser: String,
    /// Whether the browser window is currently focused
    #[serde(default = "default_true")]
    pub browser_focused: bool,
    /// Chrome idle state: "active", "idle", or "locked"
    #[serde(default = "default_active")]
    pub idle_state: String,
    /// Client-side event timestamp (Unix ms)
    #[serde(default)]
    pub timestamp_ms: Option<u64>,
}

fn default_browser() -> String {
    "chrome".to_string()
}
fn default_true() -> bool {
    true
}
fn default_active() -> String {
    "active".to_string()
}

/// Response to heartbeat requests
#[derive(Debug, Serialize)]
struct HeartbeatResponse {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<i64>,
}

/// Server status response
#[derive(Debug, Serialize)]
struct StatusResponse {
    status: String,
    version: String,
    uptime_seconds: u64,
    active_session: bool,
    total_heartbeats: u64,
    total_sessions: u64,
}

/// Current browser session state (for heartbeat merging)
struct BrowserSession {
    /// Database event ID for updating ts_end
    event_id: i64,
    /// Domain of the current session
    domain: Option<String>,
    /// URL of the current session (for change detection)
    url: Option<String>,
    /// Whether the tab is audible
    audible: bool,
    /// Last heartbeat timestamp (ms)
    last_heartbeat_ms: u64,
}

/// Shared state for the browser heartbeat server
struct ServerState {
    db: WatcherDatabase,
    device_id: String,
    user_id: String,
    current_session: Option<BrowserSession>,
    start_time: u64,
    total_heartbeats: u64,
    total_sessions: u64,
    track_incognito: bool,
    url_mode: String,
    last_extension_heartbeat_ms: Arc<AtomicU64>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

/// Map browser name to a macOS bundle ID
fn browser_bundle_id(browser: &str) -> &str {
    match browser.to_lowercase().as_str() {
        "chrome" => "com.google.Chrome",
        "brave" => "com.brave.Browser",
        "firefox" => "org.mozilla.firefox",
        "safari" => "com.apple.Safari",
        "edge" => "com.microsoft.edgemac",
        "arc" => "company.thebrowser.Browser",
        "vivaldi" => "com.vivaldi.Vivaldi",
        "opera" => "com.operasoftware.Opera",
        _ => "com.unknown.browser",
    }
}

/// Map browser name to a display name
fn browser_display_name(browser: &str) -> &str {
    match browser.to_lowercase().as_str() {
        "chrome" => "Google Chrome",
        "brave" => "Brave Browser",
        "firefox" => "Firefox",
        "safari" => "Safari",
        "edge" => "Microsoft Edge",
        "arc" => "Arc",
        "vivaldi" => "Vivaldi",
        "opera" => "Opera",
        _ => "Browser",
    }
}

/// Extract domain from a URL string
fn extract_domain(url: &str) -> Option<String> {
    // Try to parse as URL
    if let Some(start) = url.find("://") {
        let after_scheme = &url[start + 3..];
        let host = after_scheme.split('/').next().unwrap_or("");
        let host = host.split(':').next().unwrap_or(""); // Remove port
        let host = host.trim();
        if !host.is_empty() && host != "newtab" && host != "extensions" {
            // Strip www. prefix for cleaner display
            let domain = if host.starts_with("www.") {
                &host[4..]
            } else {
                host
            };
            return Some(domain.to_string());
        }
    }
    None
}

fn normalize_heartbeat_timestamp(client_ts: Option<u64>, received_at: u64) -> u64 {
    match client_ts {
        Some(ts)
            if ts >= received_at.saturating_sub(MAX_BACKFILL_AGE_MS)
                && ts <= received_at.saturating_add(MAX_CLIENT_CLOCK_SKEW_MS) =>
        {
            ts
        }
        _ => received_at,
    }
}

fn close_current_session(state: &mut ServerState, ts_end: u64, reason: &str) {
    if let Some(session) = state.current_session.take() {
        let final_ts = ts_end.max(session.last_heartbeat_ms);
        if let Err(e) = state.db.update_event_end_time(session.event_id, final_ts) {
            error!(
                "Failed to close browser session {}: {}",
                session.event_id, e
            );
        } else {
            debug!(
                "Closed browser session {} ({}) at {}",
                session.event_id, reason, final_ts
            );
        }
    }
}

fn should_merge_with_session(
    session: &BrowserSession,
    incoming_domain: &Option<String>,
    incoming_url: &Option<String>,
    url_mode: &str,
    event_ts: u64,
) -> bool {
    let same_domain = session.domain == *incoming_domain;
    let same_url = if url_mode == "full" {
        session.url == *incoming_url
    } else {
        true
    };
    let within_timeout = event_ts.saturating_sub(session.last_heartbeat_ms) < SESSION_TIMEOUT_MS;
    same_domain && same_url && within_timeout
}

fn is_session_stale(last_heartbeat_ms: u64, now: u64) -> bool {
    now.saturating_sub(last_heartbeat_ms) > SESSION_TIMEOUT_MS
}

/// Process a browser heartbeat
fn process_heartbeat(state: &mut ServerState, heartbeat: BrowserHeartbeat) -> HeartbeatResponse {
    let received_at = now_ms();
    let event_ts = normalize_heartbeat_timestamp(heartbeat.timestamp_ms, received_at);
    state
        .last_extension_heartbeat_ms
        .store(received_at, Ordering::Relaxed);
    state.total_heartbeats += 1;

    // Skip incognito if not configured to track
    if heartbeat.incognito && !state.track_incognito {
        debug!("Skipping incognito heartbeat");
        close_current_session(state, event_ts, "incognito filtered");
        return HeartbeatResponse {
            status: "skipped".to_string(),
            message: Some("Incognito tracking disabled".to_string()),
            session_id: None,
        };
    }

    // Skip if user is idle/locked
    if heartbeat.idle_state == "locked" || heartbeat.idle_state == "idle" {
        close_current_session(state, event_ts, "browser idle/locked");
        return HeartbeatResponse {
            status: "skipped".to_string(),
            message: Some(format!("User is {}", heartbeat.idle_state)),
            session_id: None,
        };
    }

    // Browser is in the background and not playing audio:
    // close the active browser session to avoid double-counting with native watcher app events.
    if !heartbeat.browser_focused && !heartbeat.audible {
        close_current_session(state, event_ts, "browser unfocused");
        return HeartbeatResponse {
            status: "skipped".to_string(),
            message: Some("Browser not focused".to_string()),
            session_id: None,
        };
    }

    // Determine the domain to track
    let domain = match state.url_mode.as_str() {
        "off" => None,
        "domain" => heartbeat
            .domain
            .clone()
            .or_else(|| heartbeat.url.as_ref().and_then(|u| extract_domain(u))),
        "full" | _ => heartbeat
            .domain
            .clone()
            .or_else(|| heartbeat.url.as_ref().and_then(|u| extract_domain(u))),
    };

    // Skip internal browser pages
    if let Some(ref url) = heartbeat.url {
        if url.starts_with("chrome://")
            || url.starts_with("chrome-extension://")
            || url.starts_with("about:")
            || url.starts_with("brave://")
            || url.starts_with("edge://")
            || url.starts_with("vivaldi://")
        {
            close_current_session(state, event_ts, "internal browser page");
            return HeartbeatResponse {
                status: "skipped".to_string(),
                message: Some("Internal browser page".to_string()),
                session_id: None,
            };
        }
    }

    // Check if we should merge with existing session or start a new one
    let should_merge = if let Some(ref session) = state.current_session {
        should_merge_with_session(session, &domain, &heartbeat.url, &state.url_mode, event_ts)
    } else {
        false
    };

    if should_merge {
        // Extend existing session
        let session = match state.current_session.as_mut() {
            Some(session) => session,
            None => {
                return HeartbeatResponse {
                    status: "error".to_string(),
                    message: Some("Session state changed unexpectedly".to_string()),
                    session_id: None,
                };
            }
        };
        session.last_heartbeat_ms = session.last_heartbeat_ms.max(event_ts);
        session.audible = heartbeat.audible;

        // Update end time in DB
        if let Err(e) = state
            .db
            .update_event_end_time(session.event_id, session.last_heartbeat_ms)
        {
            error!("Failed to update browser session end time: {}", e);
        }

        debug!(
            "Extended browser session {} (domain: {:?}, audible: {})",
            session.event_id, domain, heartbeat.audible
        );

        HeartbeatResponse {
            status: "merged".to_string(),
            message: None,
            session_id: Some(session.event_id),
        }
    } else {
        // Close any existing session
        close_current_session(state, event_ts, "session key changed");

        // Skip if no domain to track
        if domain.is_none() {
            return HeartbeatResponse {
                status: "skipped".to_string(),
                message: Some("No domain to track".to_string()),
                session_id: None,
            };
        }

        // Create new session
        let bundle_id = browser_bundle_id(&heartbeat.browser);
        let app_name = browser_display_name(&heartbeat.browser);
        let tracked_url = if state.url_mode == "full" {
            heartbeat.url.as_ref().map(|u| u.as_str())
        } else {
            None
        };
        let window_title = heartbeat.title.as_deref();

        match state.db.insert_activity_event_with_source(
            &state.device_id,
            &state.user_id,
            event_ts,
            event_ts,
            bundle_id,
            app_name,
            window_title,
            None,  // window_title_hash
            None,  // window_owner_pid
            false, // is_afk
            tracked_url,
            domain.as_deref(),
            heartbeat.incognito,
            Some("browser_extension"),
        ) {
            Ok(event_id) => {
                state.total_sessions += 1;
                info!(
                    "New browser session {} (domain: {:?}, audible: {}, browser: {})",
                    event_id, domain, heartbeat.audible, heartbeat.browser
                );

                state.current_session = Some(BrowserSession {
                    event_id,
                    domain: domain.clone(),
                    url: tracked_url.map(|s| s.to_string()),
                    audible: heartbeat.audible,
                    last_heartbeat_ms: event_ts,
                });

                HeartbeatResponse {
                    status: "created".to_string(),
                    message: None,
                    session_id: Some(event_id),
                }
            }
            Err(e) => {
                error!("Failed to create browser session: {}", e);
                HeartbeatResponse {
                    status: "error".to_string(),
                    message: Some(format!("Database error: {}", e)),
                    session_id: None,
                }
            }
        }
    }
}

/// Handle an HTTP request
fn handle_request(state: &Arc<Mutex<ServerState>>, request: tiny_http::Request) {
    let method = request.method().clone();
    let url = request.url().to_string();

    // CORS headers for browser extension
    let cors_headers = vec![
        tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        tiny_http::Header::from_bytes(
            &b"Access-Control-Allow-Methods"[..],
            &b"GET, POST, OPTIONS"[..],
        )
        .unwrap(),
        tiny_http::Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..])
            .unwrap(),
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
    ];

    // Handle CORS preflight
    if method == tiny_http::Method::Options {
        let response = tiny_http::Response::empty(200);
        let mut response = response.boxed();
        for header in cors_headers {
            response.add_header(header);
        }
        let _ = request.respond(response);
        return;
    }

    match (method, url.as_str()) {
        // Health check / status
        (tiny_http::Method::Get, "/api/status") => {
            let state_guard = state.lock().unwrap();
            let now = now_ms();
            let status = StatusResponse {
                status: "ok".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                uptime_seconds: now.saturating_sub(state_guard.start_time) / 1000,
                active_session: state_guard.current_session.is_some(),
                total_heartbeats: state_guard.total_heartbeats,
                total_sessions: state_guard.total_sessions,
            };

            let body = serde_json::to_string(&status).unwrap_or_default();
            let response = tiny_http::Response::from_string(body).with_status_code(200);
            let mut response = response.boxed();
            for header in cors_headers {
                response.add_header(header);
            }
            let _ = request.respond(response);
        }

        // Browser heartbeat
        (tiny_http::Method::Post, "/api/heartbeat") => {
            // Read body
            let mut body = String::new();
            let mut reader = request;
            if let Err(e) = reader.as_reader().read_to_string(&mut body) {
                error!("Failed to read heartbeat body: {}", e);
                let response = tiny_http::Response::from_string(
                    r#"{"status":"error","message":"Failed to read body"}"#,
                )
                .with_status_code(400);
                let mut response = response.boxed();
                for header in cors_headers {
                    response.add_header(header);
                }
                let _ = reader.respond(response);
                return;
            }

            // Parse heartbeat
            match serde_json::from_str::<BrowserHeartbeat>(&body) {
                Ok(heartbeat) => {
                    let mut state_guard = state.lock().unwrap();
                    let result = process_heartbeat(&mut state_guard, heartbeat);
                    drop(state_guard);

                    let response_body = serde_json::to_string(&result).unwrap_or_default();
                    let status_code = match result.status.as_str() {
                        "error" => 500,
                        _ => 200,
                    };
                    let response = tiny_http::Response::from_string(response_body)
                        .with_status_code(status_code);
                    let mut response = response.boxed();
                    for header in cors_headers {
                        response.add_header(header);
                    }
                    let _ = reader.respond(response);
                }
                Err(e) => {
                    warn!("Invalid heartbeat JSON: {}", e);
                    let response = tiny_http::Response::from_string(format!(
                        r#"{{"status":"error","message":"Invalid JSON: {}"}}"#,
                        e
                    ))
                    .with_status_code(400);
                    let mut response = response.boxed();
                    for header in cors_headers {
                        response.add_header(header);
                    }
                    let _ = reader.respond(response);
                }
            }
        }

        // 404 for unknown routes
        _ => {
            let response =
                tiny_http::Response::from_string(r#"{"status":"error","message":"Not found"}"#)
                    .with_status_code(404);
            let mut response = response.boxed();
            for header in cors_headers {
                response.add_header(header);
            }
            let _ = request.respond(response);
        }
    }
}

/// Start the browser heartbeat HTTP server in a background thread
pub fn start_server(
    device_id: String,
    user_id: String,
    track_incognito: bool,
    url_mode: String,
    port: u16,
    last_extension_heartbeat_ms: Arc<AtomicU64>,
) -> std::thread::JoinHandle<()> {
    info!("Starting browser heartbeat server on localhost:{}", port);

    std::thread::spawn(move || {
        // Wait for the main watcher to finish database initialization first.
        // Opening two connections simultaneously causes SQLite "database is locked"
        // errors during migration. The migration can take 3-4 seconds, so we wait
        // 10 seconds total to ensure the main watcher is fully initialized.
        std::thread::sleep(Duration::from_secs(10));

        // Open a separate database connection for the HTTP server thread
        let db = match WatcherDatabase::new("") {
            Ok(db) => db,
            Err(e) => {
                error!(
                    "Failed to open database for browser heartbeat server: {}",
                    e
                );
                return;
            }
        };

        let state = Arc::new(Mutex::new(ServerState {
            db,
            device_id,
            user_id,
            current_session: None,
            start_time: now_ms(),
            total_heartbeats: 0,
            total_sessions: 0,
            track_incognito,
            url_mode,
            last_extension_heartbeat_ms,
        }));

        // Bind to localhost only (security: don't expose to network)
        let addr = format!("127.0.0.1:{}", port);
        let server = match tiny_http::Server::http(&addr) {
            Ok(server) => {
                info!("Browser heartbeat server listening on {}", addr);
                server
            }
            Err(e) => {
                error!("Failed to bind browser heartbeat server to {}: {}", addr, e);
                // Try an alternate port
                let alt_addr = format!("127.0.0.1:{}", port + 1);
                match tiny_http::Server::http(&alt_addr) {
                    Ok(server) => {
                        info!(
                            "Browser heartbeat server listening on {} (alternate port)",
                            alt_addr
                        );
                        server
                    }
                    Err(e2) => {
                        error!("Failed to bind to alternate port {}: {}", alt_addr, e2);
                        return;
                    }
                }
            }
        };

        // Main server loop
        loop {
            match server.recv_timeout(Duration::from_secs(5)) {
                Ok(Some(request)) => {
                    handle_request(&state, request);
                }
                Ok(None) => {
                    // Timeout - check for stale sessions
                    let mut state_guard = state.lock().unwrap();
                    let stale = state_guard.current_session.as_ref().and_then(|session| {
                        let now = now_ms();
                        let elapsed = now.saturating_sub(session.last_heartbeat_ms);
                        if is_session_stale(session.last_heartbeat_ms, now) {
                            Some((session.event_id, session.last_heartbeat_ms, elapsed))
                        } else {
                            None
                        }
                    });

                    if let Some((event_id, last_heartbeat_ms, elapsed)) = stale {
                        debug!(
                            "Closing stale browser session {} (no heartbeat for {}s)",
                            event_id,
                            elapsed / 1000
                        );
                        close_current_session(&mut state_guard, last_heartbeat_ms, "stale timeout");
                    }
                }
                Err(e) => {
                    error!("Browser heartbeat server error: {}", e);
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_session(
        domain: Option<&str>,
        url: Option<&str>,
        last_heartbeat_ms: u64,
    ) -> BrowserSession {
        BrowserSession {
            event_id: 1,
            domain: domain.map(|d| d.to_string()),
            url: url.map(|u| u.to_string()),
            audible: false,
            last_heartbeat_ms,
        }
    }

    #[test]
    fn timestamp_normalization_accepts_recent_client_timestamps() {
        let received_at: u64 = 1_000_000;
        let client_ts = Some(received_at - 5_000);
        assert_eq!(
            normalize_heartbeat_timestamp(client_ts, received_at),
            received_at - 5_000
        );
    }

    #[test]
    fn timestamp_normalization_clamps_stale_replay() {
        let received_at: u64 = MAX_BACKFILL_AGE_MS + 1_000;
        let client_ts = Some(1);
        assert_eq!(
            normalize_heartbeat_timestamp(client_ts, received_at),
            received_at
        );
    }

    #[test]
    fn timestamp_normalization_clamps_future_clock_skew() {
        let received_at: u64 = 1_000_000;
        let client_ts = Some(received_at + MAX_CLIENT_CLOCK_SKEW_MS + 1);
        assert_eq!(
            normalize_heartbeat_timestamp(client_ts, received_at),
            received_at
        );
    }

    #[test]
    fn tab_churn_merges_in_domain_mode() {
        let session = mk_session(Some("example.com"), Some("https://example.com/a"), 1_000);
        let incoming_domain = Some("example.com".to_string());
        let incoming_url = Some("https://example.com/b".to_string());

        assert!(should_merge_with_session(
            &session,
            &incoming_domain,
            &incoming_url,
            "domain",
            20_000
        ));
    }

    #[test]
    fn tab_churn_splits_in_full_url_mode() {
        let session = mk_session(Some("example.com"), Some("https://example.com/a"), 1_000);
        let incoming_domain = Some("example.com".to_string());
        let incoming_url = Some("https://example.com/b".to_string());

        assert!(!should_merge_with_session(
            &session,
            &incoming_domain,
            &incoming_url,
            "full",
            20_000
        ));
    }

    #[test]
    fn sleep_wake_like_gap_marks_session_stale() {
        assert!(is_session_stale(1_000, 1_000 + SESSION_TIMEOUT_MS + 1));
        assert!(!is_session_stale(1_000, 1_000 + SESSION_TIMEOUT_MS - 1));
    }
}
