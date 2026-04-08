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

use std::collections::HashSet;
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tracing::{debug, error, info, warn};

/// Default port for the browser heartbeat server
pub const DEFAULT_PORT: u16 = 8766;

/// Maximum time (ms) between heartbeats before a session is considered stale
const SESSION_TIMEOUT_MS: u64 = 45_000; // 45 seconds (extension sends every 20s)
/// Reject or clamp timestamps that are clearly invalid (clock skew / stale replay)
const MAX_CLIENT_CLOCK_SKEW_MS: u64 = 60_000; // 60s future skew
// Keep the accepted backfill window tight. The extension sends heartbeats every
// ~20s, so anything more than a couple of minutes old is more likely to be a
// resumed/stale tab timestamp than legitimate backfill.
const MAX_BACKFILL_AGE_MS: u64 = 2 * 60 * 1000; // 2 minutes
/// Throttle write frequency when merging many heartbeats into the same session.
/// We still keep the in-memory timestamp current and flush on close.
const MERGE_DB_FLUSH_INTERVAL_MS: u64 = 12_000;
/// Force-roll long-running browser sessions so a broken heartbeat stream cannot create
/// a single giant interval spanning hours.
const MAX_BROWSER_SESSION_MS: u64 = 15 * 60 * 1000;
/// Guard against rapid duplicate "create session" bursts from extension callbacks.
/// If the same domain/url arrives within this window, treat it as merge.
const DUPLICATE_CREATE_GUARD_MS: u64 = 5_000;
/// When a create attempt is deferred (typically lock contention), suppress
/// immediate retries for the same logical browser session key.
const PENDING_CREATE_GUARD_MS: u64 = 10_000;

fn browser_heartbeat_capture_enabled() -> bool {
    if matches!(
        env::var("RITUAL_DISABLE_BROWSER_HEARTBEAT_CAPTURE")
            .ok()
            .as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    ) {
        return false;
    }

    !matches!(
        env::var("RITUAL_ENABLE_BROWSER_HEARTBEAT_CAPTURE")
            .ok()
            .as_deref(),
        Some("0") | Some("false") | Some("FALSE") | Some("no") | Some("NO")
    )
}

/// Heartbeat payload from the browser extension
#[derive(Debug, Clone, Deserialize)]
pub struct BrowserHeartbeat {
    /// Full URL of the active tab
    pub url: Option<String>,
    /// Domain extracted from URL (e.g., "youtube.com")
    pub domain: Option<String>,
    /// Page title
    pub title: Option<String>,
    /// Document title extracted from the page itself.
    #[serde(default)]
    pub document_title: Option<String>,
    /// Normalized visible text from the active tab.
    #[serde(default)]
    pub visible_text_norm: Option<String>,
    /// Raw visible text from the active tab.
    #[serde(default)]
    pub visible_text_raw: Option<String>,
    /// Optional top headings/landmarks from the page.
    #[serde(default)]
    pub headings: Vec<String>,
    /// Optional page-level summary/description.
    #[serde(default)]
    pub meta_description: Option<String>,
    /// Selected text from the page when available.
    #[serde(default)]
    pub selection_text: Option<String>,
    /// Text from the focused element when available.
    #[serde(default)]
    pub focused_element_text: Option<String>,
    /// Labeled semantic blocks extracted by the extension.
    #[serde(default)]
    pub semantic_blocks: Vec<String>,
    /// Client-estimated capture quality in the range [0, 1].
    #[serde(default)]
    pub capture_quality: Option<f64>,
    /// Client dedup key for this snapshot.
    #[serde(default)]
    pub dedup_key: Option<String>,
    /// Whether any sensitive field was redacted before sending.
    #[serde(default)]
    pub is_sensitive_redacted: bool,
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
    deferred_writes: u64,
    duplicate_suppressed: u64,
    process_id: u32,
    listener_port: u16,
    last_extension_heartbeat_ms: u64,
}

/// Current browser session state (for heartbeat merging)
struct BrowserSession {
    /// Database event ID for updating ts_end
    event_id: i64,
    /// Session start timestamp (ms)
    session_start_ms: u64,
    /// Domain of the current session
    domain: Option<String>,
    /// URL of the current session (for change detection)
    url: Option<String>,
    /// Whether the tab is audible
    audible: bool,
    /// Last heartbeat timestamp (ms)
    last_heartbeat_ms: u64,
    /// Last time a heartbeat request was received by this server.
    /// Used for timeout/merge logic to avoid client clock skew issues.
    last_received_ms: u64,
    /// Last time we flushed ts_end to SQLite for this session
    last_db_flush_ms: u64,
}

/// Database write commands sent to the watcher's single-writer loop.
pub enum BrowserDbCommand {
    InsertBrowserActivityEvent {
        device_id: String,
        user_id: String,
        ts_start: u64,
        ts_end: u64,
        app_bundle_id: String,
        app_name: String,
        window_title: Option<String>,
        browser_url: Option<String>,
        browser_domain: Option<String>,
        is_incognito: bool,
        response: Sender<Result<i64, String>>,
    },
    UpdateEventEndTime {
        event_id: i64,
        ts_end: u64,
        response: Sender<Result<(), String>>,
    },
    InsertContextSnapshot {
        device_id: String,
        user_id: String,
        activity_event_id: Option<i64>,
        ts: u64,
        source_type: String,
        app_bundle_id: String,
        app_name: String,
        window_title: Option<String>,
        browser_url: Option<String>,
        browser_domain: Option<String>,
        tab_title: Option<String>,
        document_title: Option<String>,
        visible_text_raw: String,
        visible_text_norm: String,
        capture_quality: f64,
        dedup_key: String,
        capture_components_json: Option<String>,
        ui_elements_json: Option<String>,
        is_sensitive_redacted: bool,
        response: Sender<Result<i64, String>>,
    },
}

/// Shared state for the browser heartbeat server
struct ServerState {
    db_write_tx: Sender<BrowserDbCommand>,
    device_id: String,
    user_id: String,
    listener_port: u16,
    current_session: Option<BrowserSession>,
    start_time: u64,
    total_heartbeats: u64,
    total_sessions: u64,
    track_incognito: bool,
    url_mode: String,
    last_extension_heartbeat_ms: Arc<AtomicU64>,
    pending_create_domain: Option<String>,
    pending_create_url: Option<String>,
    pending_create_received_ms: u64,
    deferred_writes: u64,
    duplicate_suppressed: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

fn is_lock_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("database is locked")
        || lower.contains("database busy")
        || lower.contains("busy timeout")
        || lower.contains("sql_busy")
        || lower.contains("database table is locked")
        || lower.contains("sqlite failure")
        || lower.contains("timed out waiting")
}

fn normalize_domain_for_tracking(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let normalized = raw.trim().to_lowercase();
        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    })
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
    close_current_session_internal(state, ts_end, reason, false);
}

fn close_current_session_clamped(state: &mut ServerState, ts_end: u64, reason: &str) {
    close_current_session_internal(state, ts_end, reason, true);
}

fn close_current_session_internal(
    state: &mut ServerState,
    ts_end: u64,
    reason: &str,
    clamp_to_target: bool,
) {
    if let Some(session) = state.current_session.take() {
        let final_ts = if clamp_to_target {
            ts_end
        } else {
            ts_end.max(session.last_heartbeat_ms)
        };
        if let Err(e) = queue_update_event_end_time(&state.db_write_tx, session.event_id, final_ts)
        {
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

fn queue_update_event_end_time(
    db_write_tx: &Sender<BrowserDbCommand>,
    event_id: i64,
    ts_end: u64,
) -> Result<(), String> {
    let (response_tx, response_rx) = mpsc::channel();
    db_write_tx
        .send(BrowserDbCommand::UpdateEventEndTime {
            event_id,
            ts_end,
            response: response_tx,
        })
        .map_err(|e| format!("failed to send update_event_end_time command: {}", e))?;

    response_rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|e| format!("timed out waiting for update_event_end_time: {}", e))?
}

#[allow(clippy::too_many_arguments)]
fn queue_insert_context_snapshot(
    db_write_tx: &Sender<BrowserDbCommand>,
    device_id: String,
    user_id: String,
    activity_event_id: Option<i64>,
    ts: u64,
    app_bundle_id: String,
    app_name: String,
    window_title: Option<String>,
    browser_url: Option<String>,
    browser_domain: Option<String>,
    tab_title: Option<String>,
    document_title: Option<String>,
    visible_text_raw: String,
    visible_text_norm: String,
    capture_quality: f64,
    dedup_key: String,
    capture_components_json: Option<String>,
    ui_elements_json: Option<String>,
    is_sensitive_redacted: bool,
) -> Result<i64, String> {
    let (response_tx, response_rx) = mpsc::channel();
    db_write_tx
        .send(BrowserDbCommand::InsertContextSnapshot {
            device_id,
            user_id,
            activity_event_id,
            ts,
            source_type: "browser_extension".to_string(),
            app_bundle_id,
            app_name,
            window_title,
            browser_url,
            browser_domain,
            tab_title,
            document_title,
            visible_text_raw,
            visible_text_norm,
            capture_quality,
            dedup_key,
            capture_components_json,
            ui_elements_json,
            is_sensitive_redacted,
            response: response_tx,
        })
        .map_err(|e| format!("failed to send insert_context_snapshot command: {}", e))?;

    response_rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|e| format!("timed out waiting for insert_context_snapshot: {}", e))?
}

fn push_unique_fragment(
    fragments: &mut Vec<String>,
    seen: &mut HashSet<String>,
    raw_value: &str,
    max_chars: usize,
) {
    let trimmed = raw_value.trim();
    if trimmed.is_empty() {
        return;
    }
    let normalized = trimmed.chars().take(max_chars).collect::<String>();
    let key = normalized.to_lowercase();
    if seen.insert(key) {
        fragments.push(normalized);
    }
}

fn browser_capture_components_json(heartbeat: &BrowserHeartbeat) -> Option<String> {
    let mut components = vec!["browser_tab".to_string()];
    if heartbeat
        .document_title
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        // no-op
    } else {
        components.push("document_title".to_string());
    }
    if heartbeat
        .visible_text_raw
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
        && heartbeat
            .visible_text_norm
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        // no-op
    } else {
        components.push("visible_text".to_string());
    }
    if heartbeat
        .meta_description
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        // no-op
    } else {
        components.push("meta_description".to_string());
    }
    if heartbeat
        .selection_text
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        // no-op
    } else {
        components.push("selection_text".to_string());
    }
    if heartbeat
        .focused_element_text
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        // no-op
    } else {
        components.push("focused_element_text".to_string());
    }
    if !heartbeat.headings.is_empty() {
        components.push("headings".to_string());
    }
    if !heartbeat.semantic_blocks.is_empty() {
        components.push("semantic_blocks".to_string());
    }
    serde_json::to_string(&components).ok()
}

fn browser_ui_elements_json(heartbeat: &BrowserHeartbeat) -> Option<String> {
    let headings = heartbeat
        .headings
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let semantic_blocks = heartbeat
        .semantic_blocks
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let meta_description = heartbeat
        .meta_description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let selection_text = heartbeat
        .selection_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let focused_element_text = heartbeat
        .focused_element_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if headings.is_empty()
        && semantic_blocks.is_empty()
        && meta_description.is_none()
        && selection_text.is_none()
        && focused_element_text.is_none()
    {
        return None;
    }

    serde_json::to_string(&serde_json::json!({
        "meta_description": meta_description,
        "selection_text": selection_text,
        "focused_element_text": focused_element_text,
        "headings": headings,
        "semantic_blocks": semantic_blocks,
    }))
    .ok()
}

fn sanitized_visible_text(heartbeat: &BrowserHeartbeat) -> (String, String) {
    let mut fragments = Vec::new();
    let mut seen = HashSet::new();

    push_unique_fragment(
        &mut fragments,
        &mut seen,
        heartbeat.visible_text_raw.as_deref().unwrap_or(""),
        12_000,
    );

    if let Some(meta_description) = heartbeat.meta_description.as_deref() {
        push_unique_fragment(
            &mut fragments,
            &mut seen,
            &format!("Page summary: {meta_description}"),
            800,
        );
    }
    if let Some(selection_text) = heartbeat.selection_text.as_deref() {
        push_unique_fragment(
            &mut fragments,
            &mut seen,
            &format!("Selected text: {selection_text}"),
            1_400,
        );
    }
    if let Some(focused_element_text) = heartbeat.focused_element_text.as_deref() {
        push_unique_fragment(
            &mut fragments,
            &mut seen,
            &format!("Focused element: {focused_element_text}"),
            1_800,
        );
    }
    for heading in heartbeat.headings.iter().take(12) {
        push_unique_fragment(
            &mut fragments,
            &mut seen,
            &format!("Heading: {heading}"),
            260,
        );
    }
    for block in heartbeat.semantic_blocks.iter().take(16) {
        push_unique_fragment(&mut fragments, &mut seen, block, 420);
    }

    let raw_text = fragments.join(" | ");
    let norm_text = if !raw_text.is_empty() {
        raw_text.to_lowercase()
    } else {
        heartbeat
            .visible_text_norm
            .as_deref()
            .unwrap_or("")
            .trim()
            .to_string()
    };
    (raw_text, norm_text)
}

#[allow(clippy::too_many_arguments)]
fn queue_insert_browser_activity_event(
    db_write_tx: &Sender<BrowserDbCommand>,
    device_id: String,
    user_id: String,
    ts_start: u64,
    ts_end: u64,
    app_bundle_id: String,
    app_name: String,
    window_title: Option<String>,
    browser_url: Option<String>,
    browser_domain: Option<String>,
    is_incognito: bool,
) -> Result<i64, String> {
    let (response_tx, response_rx) = mpsc::channel();
    db_write_tx
        .send(BrowserDbCommand::InsertBrowserActivityEvent {
            device_id,
            user_id,
            ts_start,
            ts_end,
            app_bundle_id,
            app_name,
            window_title,
            browser_url,
            browser_domain,
            is_incognito,
            response: response_tx,
        })
        .map_err(|e| format!("failed to send insert_activity_event command: {}", e))?;

    response_rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|e| format!("timed out waiting for insert_activity_event: {}", e))?
}

fn should_merge_with_session(
    session: &BrowserSession,
    incoming_domain: &Option<String>,
    incoming_url: &Option<String>,
    url_mode: &str,
    received_at: u64,
) -> bool {
    let same_domain = session.domain == *incoming_domain;
    let same_url = if url_mode == "full" {
        session.url == *incoming_url
    } else {
        true
    };
    let within_timeout = received_at.saturating_sub(session.last_received_ms) < SESSION_TIMEOUT_MS;
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
    let domain = normalize_domain_for_tracking(match state.url_mode.as_str() {
        "off" => None,
        "domain" => heartbeat
            .domain
            .clone()
            .or_else(|| heartbeat.url.as_ref().and_then(|u| extract_domain(u))),
        "full" | _ => heartbeat
            .domain
            .clone()
            .or_else(|| heartbeat.url.as_ref().and_then(|u| extract_domain(u))),
    });

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

    let forced_rollover_ts = state.current_session.as_ref().and_then(|session| {
        let session_span_ms = event_ts.saturating_sub(session.session_start_ms);
        (session_span_ms >= MAX_BROWSER_SESSION_MS).then_some(
            session
                .session_start_ms
                .saturating_add(MAX_BROWSER_SESSION_MS),
        )
    });
    if let Some(forced_end) = forced_rollover_ts {
        close_current_session_clamped(state, forced_end, "max browser session span reached");
    }

    // Check if we should merge with existing session or start a new one
    let should_merge = state
        .current_session
        .as_ref()
        .map(|session| {
            should_merge_with_session(
                session,
                &domain,
                &heartbeat.url,
                &state.url_mode,
                received_at,
            )
        })
        .unwrap_or(false);

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
        session.last_received_ms = received_at;
        session.last_heartbeat_ms = session.last_heartbeat_ms.max(event_ts);
        session.audible = heartbeat.audible;

        // Throttle DB writes to reduce lock contention under high heartbeat volume.
        let due_for_flush = session
            .last_heartbeat_ms
            .saturating_sub(session.last_db_flush_ms)
            >= MERGE_DB_FLUSH_INTERVAL_MS;
        if due_for_flush {
            if let Err(e) = queue_update_event_end_time(
                &state.db_write_tx,
                session.event_id,
                session.last_heartbeat_ms,
            ) {
                if is_lock_error(&e) {
                    state.deferred_writes = state.deferred_writes.saturating_add(1);
                    debug!(
                        "Deferred browser session {} ts_end flush due to lock contention",
                        session.event_id
                    );
                } else {
                    error!("Failed to update browser session end time: {}", e);
                }
            } else {
                session.last_db_flush_ms = session.last_heartbeat_ms;
            }
        }

        state.pending_create_domain = None;
        state.pending_create_url = None;
        state.pending_create_received_ms = 0;

        debug!(
            "Extended browser session {} (domain: {:?}, audible: {})",
            session.event_id, domain, heartbeat.audible
        );
        let (visible_text_raw, visible_text_norm) = sanitized_visible_text(&heartbeat);
        let dedup_key = heartbeat.dedup_key.clone().unwrap_or_else(|| {
            format!(
                "browser:{}:{}:{}",
                domain.clone().unwrap_or_default(),
                heartbeat.title.clone().unwrap_or_default(),
                event_ts / 120_000
            )
        });
        let capture_components_json = browser_capture_components_json(&heartbeat);
        let ui_elements_json = browser_ui_elements_json(&heartbeat);
        if let Err(err) = queue_insert_context_snapshot(
            &state.db_write_tx,
            state.device_id.clone(),
            state.user_id.clone(),
            Some(session.event_id),
            event_ts,
            browser_bundle_id(&heartbeat.browser).to_string(),
            browser_display_name(&heartbeat.browser).to_string(),
            heartbeat.title.clone(),
            if state.url_mode == "full" {
                heartbeat.url.clone()
            } else {
                None
            },
            domain.clone(),
            heartbeat.title.clone(),
            heartbeat.document_title.clone(),
            visible_text_raw,
            visible_text_norm,
            heartbeat.capture_quality.unwrap_or(
                if heartbeat
                    .visible_text_norm
                    .as_deref()
                    .unwrap_or("")
                    .is_empty()
                {
                    0.35
                } else {
                    0.95
                },
            ),
            dedup_key,
            capture_components_json,
            ui_elements_json,
            heartbeat.is_sensitive_redacted,
        ) {
            debug!("Failed to persist browser context snapshot: {}", err);
        }

        HeartbeatResponse {
            status: "merged".to_string(),
            message: None,
            session_id: Some(session.event_id),
        }
    } else {
        // Fallback duplicate guard: even if the strict merge predicate fails due to
        // subtle extension payload variance, do not create a second session when the
        // same logical tab/domain arrives almost immediately.
        if let Some(session) = state.current_session.as_mut() {
            let same_domain = session.domain == domain;
            let within_guard =
                received_at.saturating_sub(session.last_received_ms) <= DUPLICATE_CREATE_GUARD_MS;
            // Domain-level duplicate suppression: rapid same-domain heartbeats should
            // not create a second session even if URL/title jitter occurs.
            if same_domain && within_guard {
                session.last_received_ms = received_at;
                session.last_heartbeat_ms = session.last_heartbeat_ms.max(event_ts);
                session.audible = heartbeat.audible;
                state.duplicate_suppressed = state.duplicate_suppressed.saturating_add(1);
                return HeartbeatResponse {
                    status: "merged".to_string(),
                    message: Some("duplicate_guard".to_string()),
                    session_id: Some(session.event_id),
                };
            }
        }

        let same_pending_create_domain = state.pending_create_domain == domain;
        let pending_create_within_guard = state.pending_create_received_ms > 0
            && received_at.saturating_sub(state.pending_create_received_ms)
                <= PENDING_CREATE_GUARD_MS;
        if same_pending_create_domain && pending_create_within_guard {
            state.duplicate_suppressed = state.duplicate_suppressed.saturating_add(1);
            return HeartbeatResponse {
                status: "deferred".to_string(),
                message: Some("pending_create_guard".to_string()),
                session_id: None,
            };
        }

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

        match queue_insert_browser_activity_event(
            &state.db_write_tx,
            state.device_id.clone(),
            state.user_id.clone(),
            event_ts,
            event_ts,
            bundle_id.to_string(),
            app_name.to_string(),
            window_title.map(|v| v.to_string()),
            tracked_url.map(|v| v.to_string()),
            domain.clone(),
            heartbeat.incognito,
        ) {
            Ok(event_id) => {
                state.total_sessions += 1;
                state.pending_create_domain = None;
                state.pending_create_url = None;
                state.pending_create_received_ms = 0;
                info!(
                    "New browser session {} (domain: {:?}, audible: {}, browser: {})",
                    event_id, domain, heartbeat.audible, heartbeat.browser
                );

                state.current_session = Some(BrowserSession {
                    event_id,
                    session_start_ms: event_ts,
                    domain: domain.clone(),
                    url: tracked_url.map(|s| s.to_string()),
                    audible: heartbeat.audible,
                    last_heartbeat_ms: event_ts,
                    last_received_ms: received_at,
                    last_db_flush_ms: event_ts,
                });
                let (visible_text_raw, visible_text_norm) = sanitized_visible_text(&heartbeat);
                let dedup_key = heartbeat.dedup_key.clone().unwrap_or_else(|| {
                    format!(
                        "browser:{}:{}:{}",
                        domain.clone().unwrap_or_default(),
                        heartbeat.title.clone().unwrap_or_default(),
                        event_ts / 120_000
                    )
                });
                let capture_components_json = browser_capture_components_json(&heartbeat);
                let ui_elements_json = browser_ui_elements_json(&heartbeat);
                if let Err(err) = queue_insert_context_snapshot(
                    &state.db_write_tx,
                    state.device_id.clone(),
                    state.user_id.clone(),
                    Some(event_id),
                    event_ts,
                    bundle_id.to_string(),
                    app_name.to_string(),
                    heartbeat.title.clone(),
                    tracked_url.map(|value| value.to_string()),
                    domain.clone(),
                    heartbeat.title.clone(),
                    heartbeat.document_title.clone(),
                    visible_text_raw,
                    visible_text_norm,
                    heartbeat.capture_quality.unwrap_or(
                        if heartbeat
                            .visible_text_norm
                            .as_deref()
                            .unwrap_or("")
                            .is_empty()
                        {
                            0.35
                        } else {
                            0.95
                        },
                    ),
                    dedup_key,
                    capture_components_json,
                    ui_elements_json,
                    heartbeat.is_sensitive_redacted,
                ) {
                    debug!("Failed to persist browser context snapshot: {}", err);
                }

                HeartbeatResponse {
                    status: "created".to_string(),
                    message: None,
                    session_id: Some(event_id),
                }
            }
            Err(e) => {
                if is_lock_error(&e) {
                    state.deferred_writes = state.deferred_writes.saturating_add(1);
                    state.pending_create_domain = domain.clone();
                    state.pending_create_url = tracked_url.map(|v| v.to_string());
                    state.pending_create_received_ms = received_at;
                    warn!(
                        "Deferred browser session creation due to lock contention: {}",
                        e
                    );
                    HeartbeatResponse {
                        status: "deferred".to_string(),
                        message: Some("lock_contention".to_string()),
                        session_id: None,
                    }
                } else {
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
                deferred_writes: state_guard.deferred_writes,
                duplicate_suppressed: state_guard.duplicate_suppressed,
                process_id: std::process::id(),
                listener_port: state_guard.listener_port,
                last_extension_heartbeat_ms: state_guard
                    .last_extension_heartbeat_ms
                    .load(Ordering::Relaxed),
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
            if !browser_heartbeat_capture_enabled() {
                let response = tiny_http::Response::from_string(
                    r#"{"status":"disabled","message":"Browser heartbeat capture disabled"}"#,
                )
                .with_status_code(200);
                let mut response = response.boxed();
                for header in cors_headers {
                    response.add_header(header);
                }
                let _ = request.respond(response);
                return;
            }

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
    db_write_tx: Sender<BrowserDbCommand>,
) -> std::thread::JoinHandle<()> {
    info!("Starting browser heartbeat server on localhost:{}", port);
    if !browser_heartbeat_capture_enabled() {
        info!("Browser heartbeat capture disabled; server running in no-op mode");
    }

    std::thread::spawn(move || {
        let mut listener_port = port;
        let state = Arc::new(Mutex::new(ServerState {
            db_write_tx,
            device_id,
            user_id,
            listener_port,
            current_session: None,
            start_time: now_ms(),
            total_heartbeats: 0,
            total_sessions: 0,
            track_incognito,
            url_mode,
            last_extension_heartbeat_ms,
            pending_create_domain: None,
            pending_create_url: None,
            pending_create_received_ms: 0,
            deferred_writes: 0,
            duplicate_suppressed: 0,
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
                        listener_port = port + 1;
                        if let Ok(mut state_guard) = state.lock() {
                            state_guard.listener_port = listener_port;
                        }
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
                        let elapsed = now.saturating_sub(session.last_received_ms);
                        if is_session_stale(session.last_received_ms, now) {
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
            session_start_ms: last_heartbeat_ms.saturating_sub(1_000),
            domain: domain.map(|d| d.to_string()),
            url: url.map(|u| u.to_string()),
            audible: false,
            last_heartbeat_ms,
            last_received_ms: last_heartbeat_ms,
            last_db_flush_ms: last_heartbeat_ms,
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
    fn timestamp_normalization_rejects_old_extension_heartbeat() {
        let received_at: u64 = 1_000_000;
        let client_ts = Some(received_at - MAX_BACKFILL_AGE_MS - 1);
        assert_eq!(normalize_heartbeat_timestamp(client_ts, received_at), received_at);
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
