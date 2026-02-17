//! Ritual Watcher - macOS Computer Activity Tracker
//!
//! A privacy-focused activity tracker that monitors:
//! - Active application (bundle ID, app name)
//! - Window titles (with privacy controls)
//! - Browser URLs and domains (with privacy controls)
//! - Browser tab changes (with dedicated polling)
//! - AFK (away from keyboard) detection
//! - Screen lock/unlock and sleep/wake events
//! - Session timing with heartbeat merging
//!
//! Inspired by ActivityWatch's open-source implementation and Cronus's native modules.

#![allow(dead_code)] // Some fields are kept for future use and debugging

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use clap::Parser;
use sha2::{Digest, Sha256};
use tracing::{debug, error, info, warn};

mod afk;
mod browser;
mod browser_heartbeat_server;
mod config;
mod database;
pub mod icons;
mod macos;
mod sync_queue;

#[cfg(target_os = "macos")]
mod applescript_ffi;
#[cfg(target_os = "macos")]
mod browser_tracker;
#[cfg(target_os = "macos")]
mod notifications;
#[cfg(target_os = "macos")]
mod screen_events;
#[cfg(target_os = "macos")]
mod window_observer;

use afk::{AfkState, AfkWatcher};
use browser::{get_browser_info, is_browser};
use config::{TitleMode, UrlMode, WatcherConfig};
use database::WatcherDatabase;
use macos::get_active_window_info;
use sync_queue::SyncQueue;

#[cfg(target_os = "macos")]
use browser_tracker::{set_active_browser, BrowserTabTracker};
#[cfg(target_os = "macos")]
use screen_events::{ScreenEventListener, ScreenEventType};
#[cfg(target_os = "macos")]
use window_observer::{observe_app, WindowChangeListener};

/// Ritual Watcher CLI
#[derive(Parser, Debug)]
#[command(name = "ritual-watcher")]
#[command(about = "macOS computer activity tracker for Ritual")]
struct Args {
    /// Path to the SQLite database
    #[arg(short, long, default_value = "~/.ritual/watcher.db")]
    database: String,

    /// Device ID (UUID)
    #[arg(short = 'i', long)]
    device_id: String,

    /// User ID
    #[arg(short, long)]
    user_id: String,

    /// Poll interval in milliseconds
    #[arg(short, long, default_value = "2000")]
    poll_interval: u64,

    /// Title mode: off, full, truncate, hash
    #[arg(short, long, default_value = "off")]
    title_mode: String,

    /// Truncate length for title_mode=truncate
    #[arg(long, default_value = "80")]
    truncate_length: usize,

    /// Excluded bundle IDs (comma-separated)
    #[arg(short, long, default_value = "")]
    excluded: String,

    /// AFK timeout in seconds
    #[arg(long, default_value = "300")]
    afk_timeout: u64,

    /// URL mode: off, domain, full
    #[arg(long, default_value = "domain")]
    url_mode: String,

    /// Track incognito/private browsing
    #[arg(long, default_value = "false")]
    track_incognito: bool,

    /// Run in foreground (don't daemonize)
    #[arg(long)]
    foreground: bool,
}

/// Activity signature for detecting changes (used for event merging)
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ActivitySignature {
    bundle_id: String,
    title_normalized: String,
    domain: Option<String>,
    is_afk: bool,
}

/// Current session state - explicit state machine for activity tracking
///
/// State transitions:
/// - None → Active: First window detected
/// - Active → Active: Same signature within pulsetime (heartbeat merge)
/// - Active → None: App excluded, no window, permission lost
/// - Active → New Active: Signature changed, hard gap, or AFK state change
struct CurrentSession {
    /// Activity signature for detecting changes
    signature: ActivitySignature,
    /// Database event ID for updating ts_end
    event_id: Option<i64>,
    /// Session start time (first heartbeat)
    start_time: u64,
    /// Last heartbeat time (for gap detection)
    last_seen_ts: u64,
    /// App metadata for logging
    app_name: String,
    window_title: Option<String>,
    browser_url: Option<String>,
    browser_domain: Option<String>,
    is_incognito: bool,
    pid: Option<i32>,
}

/// Reasons for closing a session (for logging/debugging)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionCloseReason {
    SignatureChanged,
    HardGap,
    AfkStateChanged,
    AppExcluded,
    NoWindow,
    PermissionLost,
    Shutdown,
    SleepWake,
    ScreenLocked,
    BrowserTabChanged,
    BrowserExtensionActive,
}

impl std::fmt::Display for SessionCloseReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SessionCloseReason::SignatureChanged => write!(f, "activity changed"),
            SessionCloseReason::HardGap => write!(f, "hard gap (>60s)"),
            SessionCloseReason::AfkStateChanged => write!(f, "AFK state changed"),
            SessionCloseReason::AppExcluded => write!(f, "app excluded"),
            SessionCloseReason::NoWindow => write!(f, "no window detected"),
            SessionCloseReason::PermissionLost => write!(f, "permission lost"),
            SessionCloseReason::Shutdown => write!(f, "watcher shutdown"),
            SessionCloseReason::SleepWake => write!(f, "sleep/wake detected"),
            SessionCloseReason::ScreenLocked => write!(f, "screen locked"),
            SessionCloseReason::BrowserTabChanged => write!(f, "browser tab changed"),
            SessionCloseReason::BrowserExtensionActive => write!(f, "browser extension active"),
        }
    }
}

// Keep old struct name as alias for compatibility
type CurrentActivity = CurrentSession;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

fn hash_title(title: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(title.as_bytes());
    hex::encode(hasher.finalize())
}

fn truncate_title(title: &str, length: usize) -> String {
    if title.chars().count() > length {
        let mut truncated: String = title.chars().take(length).collect();
        truncated.push_str("...");
        truncated
    } else {
        title.to_string()
    }
}

fn normalize_title(title: &str, mode: &TitleMode, truncate_length: usize) -> String {
    match mode {
        TitleMode::Off => String::new(),
        TitleMode::Full => title.to_string(),
        TitleMode::Truncate => truncate_title(title, truncate_length),
        TitleMode::Hash => hash_title(title),
    }
}

fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("ritual_watcher=info".parse().unwrap()),
        )
        .init();

    let args = Args::parse();

    info!("🚀 Ritual Watcher v2 starting...");
    info!("   Device ID: {}", args.device_id);
    info!("   Poll interval: {}ms", args.poll_interval);
    info!("   Title mode: {}", args.title_mode);
    info!("   URL mode: {}", args.url_mode);
    info!("   AFK timeout: {}s", args.afk_timeout);

    // Parse configuration
    let config = WatcherConfig {
        database_path: shellexpand::tilde(&args.database).to_string(),
        device_id: args.device_id.clone(),
        user_id: args.user_id.clone(),
        poll_interval_ms: args.poll_interval,
        title_mode: match args.title_mode.as_str() {
            "full" => TitleMode::Full,
            "truncate" => TitleMode::Truncate,
            "hash" => TitleMode::Hash,
            _ => TitleMode::Off,
        },
        truncate_length: args.truncate_length,
        excluded_bundle_ids: args
            .excluded
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.trim().to_string())
            .collect(),
        afk_timeout_seconds: args.afk_timeout as f64,
        url_mode: match args.url_mode.as_str() {
            "full" => UrlMode::Full,
            "off" => UrlMode::Off,
            _ => UrlMode::DomainOnly,
        },
        track_incognito: args.track_incognito,
        pulsetime_seconds: (args.poll_interval as f64 / 1000.0) + 1.0,
    };

    // Initialize database
    let db = match WatcherDatabase::new(&config.database_path) {
        Ok(db) => {
            info!("✅ Database connected: {}", config.database_path);
            db
        }
        Err(e) => {
            error!("❌ Failed to connect to database: {}", e);
            std::process::exit(1);
        }
    };

    // Set up signal handling for graceful shutdown
    let running = Arc::new(AtomicBool::new(true));
    let r = running.clone();

    ctrlc::set_handler(move || {
        info!("🛑 Shutdown signal received, stopping watcher...");
        r.store(false, Ordering::SeqCst);
    })
    .expect("Error setting Ctrl-C handler");

    // Start browser heartbeat HTTP server for receiving events from the browser extension
    let browser_extension_last_seen = Arc::new(AtomicU64::new(0));
    let _browser_server_handle = browser_heartbeat_server::start_server(
        args.device_id.clone(),
        args.user_id.clone(),
        args.track_incognito,
        args.url_mode.clone(),
        browser_heartbeat_server::DEFAULT_PORT,
        browser_extension_last_seen.clone(),
    );

    // Main polling loop
    run_watcher_loop(&config, &db, running, browser_extension_last_seen);

    info!("👋 Ritual Watcher stopped");
}

/// Pump the main thread's run loop for the given duration instead of sleeping.
/// This allows macOS system events (like NSWorkspace app activation notifications)
/// to be processed, keeping NSWorkspace.frontmostApplication() up to date.
/// Without this, a command-line process gets stale data from frontmostApplication().
#[cfg(target_os = "macos")]
fn pump_run_loop(duration: Duration) {
    use core_foundation_sys::runloop::{kCFRunLoopDefaultMode, CFRunLoopRunInMode};
    unsafe {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, duration.as_secs_f64(), 0);
    }
}

#[cfg(not(target_os = "macos"))]
fn pump_run_loop(duration: Duration) {
    std::thread::sleep(duration);
}

fn decide_session_action(
    current_session: Option<&CurrentSession>,
    new_signature: &ActivitySignature,
    afk_boundary_crossed: bool,
    now: u64,
    hard_gap_ms: u64,
    pulsetime_ms: u64,
    commit_interval_ms: u64,
    last_commit_time: u64,
) -> (SessionAction, Option<SessionCloseReason>) {
    match current_session {
        Some(session) => {
            if afk_boundary_crossed {
                (
                    SessionAction::Close,
                    Some(SessionCloseReason::AfkStateChanged),
                )
            } else if now.saturating_sub(session.last_seen_ts) > hard_gap_ms {
                (SessionAction::Close, Some(SessionCloseReason::HardGap))
            } else if session.signature != *new_signature {
                (
                    SessionAction::Close,
                    Some(SessionCloseReason::SignatureChanged),
                )
            } else {
                let within_pulsetime = now.saturating_sub(session.last_seen_ts) <= pulsetime_ms;
                if within_pulsetime {
                    let session_duration = now.saturating_sub(session.start_time);
                    let should_commit = session_duration > commit_interval_ms
                        && now.saturating_sub(last_commit_time) > commit_interval_ms;
                    (SessionAction::Merge { should_commit }, None)
                } else {
                    (SessionAction::Close, Some(SessionCloseReason::HardGap))
                }
            }
        }
        None => (SessionAction::CreateNew, None),
    }
}

fn run_watcher_loop(
    config: &WatcherConfig,
    db: &WatcherDatabase,
    running: Arc<AtomicBool>,
    browser_extension_last_seen: Arc<AtomicU64>,
) {
    let poll_interval = Duration::from_millis(config.poll_interval_ms);
    let excluded: HashSet<String> = config.excluded_bundle_ids.iter().cloned().collect();

    // On macOS, pump the main thread's run loop instead of sleeping.
    // This is critical: without a running run loop, NSWorkspace.frontmostApplication()
    // returns stale/cached data because system events that update workspace state
    // (like app activations) are never delivered to this process.
    info!("✅ Using run loop pumping for accurate app detection");
    let pulsetime_ms = (config.pulsetime_seconds * 1000.0) as u64;

    // Hard gap threshold: if time since last heartbeat exceeds this, always close the event
    // This catches sleep, lock screen, CPU hangs, etc.
    let hard_gap_ms: u64 = 60_000; // 60 seconds

    // Commit interval: how often to consider committing long-running events
    // This prevents a single event from growing indefinitely
    let commit_interval_ms: u64 = 30_000; // 30 seconds - commit long sessions periodically

    // Sleep/wake detection threshold: if wall clock jumped forward significantly
    let sleep_wake_threshold_ms: u64 = 5 * 60 * 1000; // 5 minutes
                                                      // If extension heartbeats are recent, use extension as browser source-of-truth.
    let browser_extension_recent_ms: u64 = 90_000; // 90 seconds

    let mut current_session: Option<CurrentSession> = None;
    let mut afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
    let mut last_commit_time = now_ms();
    let mut last_poll_time = now_ms();
    let mut was_afk = false; // Track AFK state for boundary detection
    let mut last_notified_bundle: Option<String> = None; // Track last notification to avoid duplicates
    let mut loop_iteration: u64 = 0; // Track loop iterations for diagnostics
    let mut last_status_log = now_ms(); // Periodic status logging

    // Initialize sync queue for backend reliability
    let sync_queue =
        match SyncQueue::new(&config.database_path.replace("watcher.db", "sync_queue.db")) {
            Ok(sq) => {
                info!("✅ Sync queue initialized");
                Some(sq)
            }
            Err(e) => {
                warn!(
                    "⚠️ Could not initialize sync queue: {} - events won't be synced to backend",
                    e
                );
                None
            }
        };

    // Initialize event-driven notification listener (macOS)
    // This provides immediate app switch detection instead of waiting for next poll
    #[cfg(target_os = "macos")]
    let notification_listener = {
        use notifications::NotificationListener;
        Some(NotificationListener::new())
    };
    #[cfg(not(target_os = "macos"))]
    let notification_listener: Option<()> = None;

    // Initialize screen event listener for lock/unlock and sleep/wake detection
    #[cfg(target_os = "macos")]
    let screen_event_listener = Some(ScreenEventListener::new());
    #[cfg(not(target_os = "macos"))]
    let screen_event_listener: Option<()> = None;

    // Initialize browser tab tracker (polls every 10 seconds)
    #[cfg(target_os = "macos")]
    let browser_tab_tracker = Some(BrowserTabTracker::new(10));
    #[cfg(not(target_os = "macos"))]
    let browser_tab_tracker: Option<()> = None;

    // Initialize window change listener for title changes within same app
    #[cfg(target_os = "macos")]
    let window_change_listener = Some(WindowChangeListener::new());
    #[cfg(not(target_os = "macos"))]
    let window_change_listener: Option<()> = None;

    // Track screen lock state
    let mut is_screen_locked = false;

    info!("📡 Starting activity monitoring with heartbeat merging...");
    info!("   Pulsetime: {:.1}s", config.pulsetime_seconds);
    info!("   Hard gap threshold: {:.0}s", hard_gap_ms as f64 / 1000.0);
    info!(
        "   Commit interval: {:.0}s",
        commit_interval_ms as f64 / 1000.0
    );
    info!("   AFK timeout: {:.0}s", config.afk_timeout_seconds);
    #[cfg(target_os = "macos")]
    {
        info!("   Event-driven detection: enabled");
        info!("   Screen lock detection: enabled");
        info!("   Browser tab polling: 10s interval");
        info!(
            "   Window title observer: {}",
            if WindowChangeListener::has_permission() {
                "enabled"
            } else {
                "disabled (no AX permission)"
            }
        );
    }

    // Helper closure to close current session
    let close_session = |session: &CurrentSession,
                         db: &WatcherDatabase,
                         sync_queue: &Option<SyncQueue>,
                         now: u64,
                         reason: SessionCloseReason| {
        if let Some(event_id) = session.event_id {
            debug!(
                "Closing session {} ({}): {} [{:.1}s]",
                event_id,
                session.app_name,
                reason,
                (now - session.start_time) as f64 / 1000.0
            );
            if let Err(e) = db.update_event_end_time(event_id, now) {
                error!("Failed to close event: {}", e);
            }
            // Queue for sync
            if let Some(ref sq) = sync_queue {
                if let Err(e) = sq.queue_activity_sync(event_id) {
                    debug!("Failed to queue for sync: {}", e);
                }
            }
        }
    };

    while running.load(Ordering::SeqCst) {
        let now = now_ms();
        let browser_extension_active = now
            .saturating_sub(browser_extension_last_seen.load(Ordering::Relaxed))
            <= browser_extension_recent_ms;

        // ===== EVENT-DRIVEN APP SWITCH DETECTION =====
        // Check for notification events first - these indicate immediate app switches
        // This is much more responsive than waiting for the next poll cycle
        #[cfg(target_os = "macos")]
        let _notification_triggered = {
            let mut triggered = false;
            if let Some(ref listener) = notification_listener {
                // Drain all pending notifications
                let events = listener.drain();
                for event in events {
                    // Only process if this is a different app than we last saw via notification
                    // This prevents duplicate processing when both notification and poll fire
                    if last_notified_bundle.as_ref() != Some(&event.bundle_id) {
                        debug!(
                            "🔔 Processing notification: {} at {}ms",
                            event.app_name, event.timestamp_ms
                        );
                        last_notified_bundle = Some(event.bundle_id.clone());
                        triggered = true;
                    }
                }
            }
            triggered
        };
        #[cfg(not(target_os = "macos"))]
        let _notification_triggered = false;

        // ===== SCREEN LOCK/UNLOCK AND SLEEP/WAKE EVENTS =====
        #[cfg(target_os = "macos")]
        {
            if let Some(ref listener) = screen_event_listener {
                for event in listener.drain() {
                    match event.event_type {
                        ScreenEventType::ScreenLocked => {
                            info!("🔒 Screen locked - closing current session");
                            is_screen_locked = true;
                            if let Some(ref session) = current_session {
                                close_session(
                                    session,
                                    db,
                                    &sync_queue,
                                    event.timestamp_ms,
                                    SessionCloseReason::ScreenLocked,
                                );
                            }
                            current_session = None;
                        }
                        ScreenEventType::ScreenUnlocked => {
                            info!("🔓 Screen unlocked");
                            is_screen_locked = false;
                            // Reset AFK state after unlock
                            afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
                            was_afk = false;
                        }
                        ScreenEventType::WillSleep => {
                            info!("💤 System going to sleep - closing current session");
                            if let Some(ref session) = current_session {
                                close_session(
                                    session,
                                    db,
                                    &sync_queue,
                                    event.timestamp_ms,
                                    SessionCloseReason::SleepWake,
                                );
                            }
                            current_session = None;
                        }
                        ScreenEventType::DidWake => {
                            info!("⏰ System woke from sleep");
                            // Reset AFK state after wake
                            afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
                            was_afk = false;
                            last_notified_bundle = None;
                        }
                    }
                }
            }
        }

        // ===== BROWSER TAB CHANGE EVENTS =====
        // Process tab changes detected by the background browser tracker
        // Store pending tab events for processing after AFK detection
        #[cfg(target_os = "macos")]
        let pending_tab_events: Vec<_> = {
            if let Some(ref tracker) = browser_tab_tracker {
                tracker.drain()
            } else {
                Vec::new()
            }
        };
        #[cfg(not(target_os = "macos"))]
        let pending_tab_events: Vec<()> = Vec::new();

        // ===== WINDOW TITLE CHANGE EVENTS =====
        #[cfg(target_os = "macos")]
        {
            if let Some(ref listener) = window_change_listener {
                for event in listener.drain() {
                    if !is_screen_locked {
                        debug!(
                            "🪟 Window change detected: PID {} - {:?} ({})",
                            event.pid,
                            event.title.as_ref().map(|s| if s.len() > 40 {
                                format!("{}...", &s[..40])
                            } else {
                                s.clone()
                            }),
                            event.change_type
                        );
                        // Window title changes are captured but we don't force session close
                        // The signature comparison in the main logic will handle this
                    }
                }
            }
        }

        // ===== SLEEP/WAKE DETECTION (FALLBACK) =====
        // If wall clock jumped forward significantly, we likely woke from sleep
        // This is a fallback for cases where the explicit notifications didn't fire
        let time_since_last_poll = now.saturating_sub(last_poll_time);
        if time_since_last_poll > sleep_wake_threshold_ms {
            info!(
                "⏰ Sleep/wake detected via gap: {:.1}s",
                time_since_last_poll as f64 / 1000.0
            );
            // Close current session at the last known time
            if let Some(ref session) = current_session {
                close_session(
                    session,
                    db,
                    &sync_queue,
                    last_poll_time,
                    SessionCloseReason::SleepWake,
                );
                current_session = None;
            }
            // Reset AFK state after wake
            afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
            was_afk = false;
            last_notified_bundle = None;
        }
        last_poll_time = now;

        // ===== SKIP PROCESSING IF SCREEN IS LOCKED =====
        if is_screen_locked {
            pump_run_loop(poll_interval);
            continue;
        }

        // ===== AFK DETECTION =====
        let (afk_state, afk_changed, seconds_idle) = afk_watcher.check(now);
        let is_afk = afk_state == AfkState::Afk;

        // Record AFK state changes to afk_events table
        if afk_changed {
            let status = if is_afk { "afk" } else { "not-afk" };
            if let Err(e) =
                db.upsert_afk_event(&config.device_id, &config.user_id, now, now, status)
            {
                error!("Failed to record AFK event: {}", e);
            }
        }

        // ===== AFK BOUNDARY SPLITTING =====
        // When AFK state changes, force close current session and start fresh
        // This creates clean boundaries between "active" and "afk" time
        let afk_boundary_crossed = was_afk != is_afk;
        was_afk = is_afk;

        // ===== PROCESS PENDING BROWSER TAB EVENTS =====
        #[cfg(target_os = "macos")]
        {
            for tab_event in pending_tab_events {
                if !is_screen_locked && !is_afk {
                    debug!(
                        "🌐 Browser tab change: {} -> {:?} (domain: {:?})",
                        tab_event.bundle_id,
                        tab_event.url.as_ref().map(|s| if s.len() > 50 {
                            format!("{}...", &s[..50])
                        } else {
                            s.clone()
                        }),
                        tab_event.domain
                    );

                    // If we have a current session for this browser, check if domain changed
                    if let Some(ref session) = current_session {
                        if session.signature.bundle_id == tab_event.bundle_id {
                            // Same browser - check if domain changed (significant change)
                            let domain_changed = session.browser_domain != tab_event.domain;
                            if domain_changed {
                                // Close current session - the next poll will create a new one with updated info
                                close_session(
                                    session,
                                    db,
                                    &sync_queue,
                                    tab_event.timestamp_ms,
                                    SessionCloseReason::BrowserTabChanged,
                                );
                                current_session = None;
                            }
                        }
                    }
                }
            }
        }

        // ===== APP SWITCH SETTLING DELAY =====
        // After an app switch notification, wait 100ms before querying window info.
        // This gives macOS time to fully update the window list and focus state,
        // preventing stale window titles from being attributed to the new app.
        #[cfg(target_os = "macos")]
        if _notification_triggered {
            std::thread::sleep(Duration::from_millis(100));
        }

        // ===== GET ACTIVE WINDOW INFO =====
        match get_active_window_info() {
            Ok(Some(info)) => {
                debug!(
                    "Active: {} ({}) - {:?} [AFK: {}, idle: {:.1}s]",
                    info.app_name, info.bundle_id, info.window_title, is_afk, seconds_idle
                );

                // Avoid duplicate browser accounting: if extension heartbeats are active,
                // let the extension own browser sessions and skip native browser polling.
                if browser_extension_active && is_browser(&info.bundle_id) {
                    debug!(
                        "Skipping native browser tracking for {} (extension active)",
                        info.bundle_id
                    );
                    if let Some(ref session) = current_session {
                        close_session(
                            session,
                            db,
                            &sync_queue,
                            now,
                            SessionCloseReason::BrowserExtensionActive,
                        );
                    }
                    current_session = None;
                    #[cfg(target_os = "macos")]
                    {
                        set_active_browser(None);
                    }
                    pump_run_loop(poll_interval);
                    continue;
                }

                // ===== UPDATE BROWSER TRACKER =====
                // Notify the browser tracker which app is active so it knows when to poll
                #[cfg(target_os = "macos")]
                {
                    set_active_browser(Some(info.bundle_id.clone()));
                }

                // ===== UPDATE WINDOW OBSERVER =====
                // Set up AX observer for this app's window title changes
                #[cfg(target_os = "macos")]
                {
                    if let Some(pid) = info.pid {
                        observe_app(pid);
                    }
                }

                // ===== EXCLUDED APP CHECK =====
                if excluded.contains(&info.bundle_id) {
                    debug!("Skipping excluded app: {}", info.bundle_id);
                    if let Some(ref session) = current_session {
                        close_session(
                            session,
                            db,
                            &sync_queue,
                            now,
                            SessionCloseReason::AppExcluded,
                        );
                    }
                    current_session = None;
                    pump_run_loop(poll_interval);
                    continue;
                }

                // ===== BROWSER INFO =====
                let browser_info = if is_browser(&info.bundle_id) && !is_afk {
                    let bi = get_browser_info(&info.bundle_id);
                    if bi.is_incognito && !config.track_incognito {
                        debug!("Skipping incognito browser activity");
                        browser::BrowserInfo::default()
                    } else {
                        bi
                    }
                } else {
                    browser::BrowserInfo::default()
                };

                // Apply URL privacy mode
                let (tracked_url, tracked_domain) = match &config.url_mode {
                    UrlMode::Off => (None, None),
                    UrlMode::DomainOnly => (None, browser_info.domain.clone()),
                    UrlMode::Full => (browser_info.url.clone(), browser_info.domain.clone()),
                };

                // Normalize title based on privacy mode
                let title_normalized = info
                    .window_title
                    .as_ref()
                    .map(|t| normalize_title(t, &config.title_mode, config.truncate_length))
                    .unwrap_or_default();

                // ===== ACTIVITY SIGNATURE =====
                let new_signature = ActivitySignature {
                    bundle_id: info.bundle_id.clone(),
                    title_normalized: title_normalized.clone(),
                    domain: tracked_domain.clone(),
                    is_afk,
                };

                // ===== STATE MACHINE: DETERMINE ACTION =====
                // Priority of close reasons (highest to lowest):
                // 1. AFK boundary crossed → always split
                // 2. Hard gap (>60s since last heartbeat) → always split
                // 3. Signature changed → split
                // 4. Same signature + within pulsetime → merge (heartbeat)

                let (action, close_reason) = decide_session_action(
                    current_session.as_ref(),
                    &new_signature,
                    afk_boundary_crossed,
                    now,
                    hard_gap_ms,
                    pulsetime_ms,
                    commit_interval_ms,
                    last_commit_time,
                );

                // ===== EXECUTE ACTION =====
                match action {
                    SessionAction::Merge { should_commit } => {
                        // Update end time (heartbeat)
                        if let Some(ref mut session) = current_session {
                            session.last_seen_ts = now;
                            if let Some(event_id) = session.event_id {
                                if let Err(e) = db.update_event_end_time(event_id, now) {
                                    error!("Failed to update event end time: {}", e);
                                }

                                // Periodic sync for long sessions
                                if should_commit {
                                    if let Some(ref sq) = sync_queue {
                                        if let Err(e) = sq.queue_activity_update(event_id, now) {
                                            debug!("Failed to queue activity for sync: {}", e);
                                        }
                                    }
                                    last_commit_time = now;
                                }
                            }
                        }
                    }
                    SessionAction::Close => {
                        // Close previous session
                        if let Some(ref session) = current_session {
                            if let Some(reason) = close_reason {
                                close_session(session, db, &sync_queue, now, reason);
                            }
                        }

                        // Create new session
                        let (stored_title, stored_hash) = match &config.title_mode {
                            TitleMode::Off => (None, None),
                            TitleMode::Full => (info.window_title.clone(), None),
                            TitleMode::Truncate => (
                                info.window_title
                                    .as_ref()
                                    .map(|t| truncate_title(t, config.truncate_length)),
                                None,
                            ),
                            TitleMode::Hash => {
                                (None, info.window_title.as_ref().map(|t| hash_title(t)))
                            }
                        };

                        let event_id = match db.insert_activity_event(
                            &config.device_id,
                            &config.user_id,
                            now,
                            now,
                            &info.bundle_id,
                            &info.app_name,
                            stored_title.as_deref(),
                            stored_hash.as_deref(),
                            info.pid,
                            is_afk,
                            tracked_url.as_deref(),
                            tracked_domain.as_deref(),
                            browser_info.is_incognito,
                        ) {
                            Ok(id) => {
                                debug!(
                                    "Created new session {} for {} (domain: {:?})",
                                    id, info.app_name, tracked_domain
                                );
                                Some(id)
                            }
                            Err(e) => {
                                error!("Failed to insert activity event: {}", e);
                                None
                            }
                        };

                        last_commit_time = now;
                        current_session = Some(CurrentSession {
                            signature: new_signature,
                            event_id,
                            start_time: now,
                            last_seen_ts: now,
                            app_name: info.app_name,
                            window_title: info.window_title,
                            browser_url: tracked_url,
                            browser_domain: tracked_domain,
                            is_incognito: browser_info.is_incognito,
                            pid: info.pid,
                        });
                    }
                    SessionAction::CreateNew => {
                        // First event - create new session
                        let (stored_title, stored_hash) = match &config.title_mode {
                            TitleMode::Off => (None, None),
                            TitleMode::Full => (info.window_title.clone(), None),
                            TitleMode::Truncate => (
                                info.window_title
                                    .as_ref()
                                    .map(|t| truncate_title(t, config.truncate_length)),
                                None,
                            ),
                            TitleMode::Hash => {
                                (None, info.window_title.as_ref().map(|t| hash_title(t)))
                            }
                        };

                        let event_id = match db.insert_activity_event(
                            &config.device_id,
                            &config.user_id,
                            now,
                            now,
                            &info.bundle_id,
                            &info.app_name,
                            stored_title.as_deref(),
                            stored_hash.as_deref(),
                            info.pid,
                            is_afk,
                            tracked_url.as_deref(),
                            tracked_domain.as_deref(),
                            browser_info.is_incognito,
                        ) {
                            Ok(id) => {
                                info!("Started tracking: {} (event {})", info.app_name, id);
                                Some(id)
                            }
                            Err(e) => {
                                error!("Failed to insert activity event: {}", e);
                                None
                            }
                        };

                        last_commit_time = now;
                        current_session = Some(CurrentSession {
                            signature: new_signature,
                            event_id,
                            start_time: now,
                            last_seen_ts: now,
                            app_name: info.app_name,
                            window_title: info.window_title,
                            browser_url: tracked_url,
                            browser_domain: tracked_domain,
                            is_incognito: browser_info.is_incognito,
                            pid: info.pid,
                        });
                    }
                }
            }
            Ok(None) => {
                debug!("No active window detected");
                if let Some(ref session) = current_session {
                    close_session(session, db, &sync_queue, now, SessionCloseReason::NoWindow);
                }
                current_session = None;
            }
            Err(e) => {
                // Permission may have been revoked
                warn!(
                    "Failed to get active window info: {} (permission revoked?)",
                    e
                );
                if let Some(ref session) = current_session {
                    close_session(
                        session,
                        db,
                        &sync_queue,
                        now,
                        SessionCloseReason::PermissionLost,
                    );
                }
                current_session = None;
            }
        }

        // Update heartbeat
        if let Err(e) = db.update_heartbeat(&config.device_id, now) {
            error!("Failed to update heartbeat: {}", e);
        }

        // Increment loop counter
        loop_iteration += 1;

        // Periodic status logging (every 5 minutes) to help diagnose hangs
        let status_interval_ms: u64 = 5 * 60 * 1000; // 5 minutes
        if now.saturating_sub(last_status_log) > status_interval_ms {
            let session_info = current_session
                .as_ref()
                .map(|s| {
                    format!(
                        "{} ({:.1}s)",
                        s.app_name,
                        (now - s.start_time) as f64 / 1000.0
                    )
                })
                .unwrap_or_else(|| "none".to_string());
            info!(
                "📊 Watcher status: {} iterations, current session: {}, AFK: {}, extension: {}",
                loop_iteration,
                session_info,
                if was_afk { "yes" } else { "no" },
                if browser_extension_active {
                    "active"
                } else {
                    "inactive"
                },
            );
            last_status_log = now;
        }

        pump_run_loop(poll_interval);
    }

    // ===== SHUTDOWN: Close final session =====
    if let Some(ref session) = current_session {
        close_session(
            session,
            db,
            &sync_queue,
            now_ms(),
            SessionCloseReason::Shutdown,
        );
    }

    info!("📊 Watcher statistics:");
    if let Ok(count) = db.get_event_count(&config.device_id) {
        info!("   Total events recorded: {}", count);
    }
    if let Ok(stats) = db.get_db_stats() {
        info!(
            "   Database size: {:.2} MB",
            stats.db_size_bytes as f64 / 1024.0 / 1024.0
        );
    }

    // Report sync queue status
    if let Some(ref sq) = sync_queue {
        if let Ok(pending) = sq.pending_count() {
            info!("   Pending sync items: {}", pending);
        }
    }
}

/// Actions the state machine can take
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionAction {
    /// Merge heartbeat into existing session
    Merge { should_commit: bool },
    /// Close current session and create new one
    Close,
    /// Create first session (no existing session)
    CreateNew,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(bundle_id: &str, title: &str, domain: Option<&str>, is_afk: bool) -> ActivitySignature {
        ActivitySignature {
            bundle_id: bundle_id.to_string(),
            title_normalized: title.to_string(),
            domain: domain.map(|d| d.to_string()),
            is_afk,
        }
    }

    fn mk_session(
        signature: ActivitySignature,
        start_time: u64,
        last_seen_ts: u64,
    ) -> CurrentSession {
        CurrentSession {
            signature,
            event_id: Some(1),
            start_time,
            last_seen_ts,
            app_name: "App".to_string(),
            window_title: None,
            browser_url: None,
            browser_domain: None,
            is_incognito: false,
            pid: None,
        }
    }

    #[test]
    fn rapid_app_switch_forces_close_with_signature_reason() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 1_500);
        let new_sig = sig("com.browser", "tab-b", Some("example.com"), false);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            false,
            2_000,
            60_000,
            3_000,
            30_000,
            1_000,
        );

        assert_eq!(action, SessionAction::Close);
        assert_eq!(reason, Some(SessionCloseReason::SignatureChanged));
    }

    #[test]
    fn sleep_wake_gap_forces_hard_gap_split() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 2_000);
        let new_sig = sig("com.editor", "file-a", None, false);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            false,
            80_500,
            60_000,
            3_000,
            30_000,
            1_000,
        );

        assert_eq!(action, SessionAction::Close);
        assert_eq!(reason, Some(SessionCloseReason::HardGap));
    }

    #[test]
    fn same_signature_within_pulsetime_merges() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 2_000);
        let new_sig = sig("com.editor", "file-a", None, false);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            false,
            4_000,
            60_000,
            3_000,
            30_000,
            1_000,
        );

        assert_eq!(
            action,
            SessionAction::Merge {
                should_commit: false
            }
        );
        assert_eq!(reason, None);
    }

    #[test]
    fn long_running_session_requests_periodic_commit() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 35_000);
        let new_sig = sig("com.editor", "file-a", None, false);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            false,
            70_100,
            60_000,
            40_000,
            30_000,
            35_000,
        );

        assert_eq!(
            action,
            SessionAction::Merge {
                should_commit: true
            }
        );
        assert_eq!(reason, None);
    }

    #[test]
    fn afk_boundary_always_splits_session() {
        let current = mk_session(sig("com.editor", "file-a", None, false), 1_000, 2_000);
        let new_sig = sig("com.editor", "file-a", None, true);

        let (action, reason) = decide_session_action(
            Some(&current),
            &new_sig,
            true,
            2_100,
            60_000,
            3_000,
            30_000,
            1_000,
        );

        assert_eq!(action, SessionAction::Close);
        assert_eq!(reason, Some(SessionCloseReason::AfkStateChanged));
    }
}
