//! Ritual Watcher - macOS Computer Activity Tracker
//!
//! A privacy-focused activity tracker that monitors:
//! - Active application (bundle ID, app name)
//! - Window titles (with privacy controls)
//! - Browser URLs and domains (with privacy controls)
//! - AFK (away from keyboard) detection
//! - Session timing with heartbeat merging
//!
//! Inspired by ActivityWatch's open-source implementation.

#![allow(dead_code)] // Some fields are kept for future use and debugging

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use clap::Parser;
use sha2::{Sha256, Digest};
use tracing::{debug, error, info, warn};

mod macos;
mod database;
mod config;
mod browser;
mod afk;
mod sync_queue;
pub mod icons;
#[cfg(target_os = "macos")]
mod notifications;

use database::WatcherDatabase;
use config::{WatcherConfig, TitleMode, UrlMode};
use macos::get_active_window_info;
use browser::{get_browser_info, is_browser};
use afk::{AfkWatcher, AfkState};
use sync_queue::SyncQueue;

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
#[derive(Debug, Clone, Copy)]
enum SessionCloseReason {
    SignatureChanged,
    HardGap,
    AfkStateChanged,
    AppExcluded,
    NoWindow,
    PermissionLost,
    Shutdown,
    SleepWake,
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
    if title.len() > length {
        format!("{}...", &title[..length])
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
                .add_directive("ritual_watcher=info".parse().unwrap())
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
        excluded_bundle_ids: args.excluded
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

    // Main polling loop
    run_watcher_loop(&config, &db, running);

    info!("👋 Ritual Watcher stopped");
}

fn run_watcher_loop(config: &WatcherConfig, db: &WatcherDatabase, running: Arc<AtomicBool>) {
    let poll_interval = Duration::from_millis(config.poll_interval_ms);
    let excluded: HashSet<String> = config.excluded_bundle_ids.iter().cloned().collect();
    let pulsetime_ms = (config.pulsetime_seconds * 1000.0) as u64;
    
    // Hard gap threshold: if time since last heartbeat exceeds this, always close the event
    // This catches sleep, lock screen, CPU hangs, etc.
    let hard_gap_ms: u64 = 60_000; // 60 seconds
    
    // Commit interval: how often to consider committing long-running events
    // This prevents a single event from growing indefinitely
    let commit_interval_ms: u64 = 30_000; // 30 seconds - commit long sessions periodically
    
    // Sleep/wake detection threshold: if wall clock jumped forward significantly
    let sleep_wake_threshold_ms: u64 = 5 * 60 * 1000; // 5 minutes

    let mut current_session: Option<CurrentSession> = None;
    let mut afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
    let mut last_commit_time = now_ms();
    let mut last_poll_time = now_ms();
    let mut was_afk = false; // Track AFK state for boundary detection
    let mut last_notified_bundle: Option<String> = None; // Track last notification to avoid duplicates
    
    // Initialize sync queue for backend reliability
    let sync_queue = match SyncQueue::new(&config.database_path.replace("watcher.db", "sync_queue.db")) {
        Ok(sq) => {
            info!("✅ Sync queue initialized");
            Some(sq)
        }
        Err(e) => {
            warn!("⚠️ Could not initialize sync queue: {} - events won't be synced to backend", e);
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

    info!("📡 Starting activity monitoring with heartbeat merging...");
    info!("   Pulsetime: {:.1}s", config.pulsetime_seconds);
    info!("   Hard gap threshold: {:.0}s", hard_gap_ms as f64 / 1000.0);
    info!("   Commit interval: {:.0}s", commit_interval_ms as f64 / 1000.0);
    info!("   AFK timeout: {:.0}s", config.afk_timeout_seconds);
    #[cfg(target_os = "macos")]
    info!("   Event-driven detection: enabled");
    
    // Helper closure to close current session
    let close_session = |session: &CurrentSession, db: &WatcherDatabase, sync_queue: &Option<SyncQueue>, now: u64, reason: SessionCloseReason| {
        if let Some(event_id) = session.event_id {
            debug!("Closing session {} ({}): {} [{:.1}s]", 
                   event_id, 
                   session.app_name, 
                   reason,
                   (now - session.start_time) as f64 / 1000.0);
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
                        debug!("🔔 Processing notification: {} at {}ms", event.app_name, event.timestamp_ms);
                        last_notified_bundle = Some(event.bundle_id.clone());
                        triggered = true;
                    }
                }
            }
            triggered
        };
        #[cfg(not(target_os = "macos"))]
        let _notification_triggered = false;
        
        // ===== SLEEP/WAKE DETECTION =====
        // If wall clock jumped forward significantly, we likely woke from sleep
        let time_since_last_poll = now.saturating_sub(last_poll_time);
        if time_since_last_poll > sleep_wake_threshold_ms {
            info!("⏰ Sleep/wake detected: {:.1}s gap", time_since_last_poll as f64 / 1000.0);
            // Close current session at the last known time
            if let Some(ref session) = current_session {
                close_session(session, db, &sync_queue, last_poll_time, SessionCloseReason::SleepWake);
                current_session = None;
            }
            // Reset AFK state after wake
            afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
            was_afk = false;
            last_notified_bundle = None;
        }
        last_poll_time = now;
        
        // ===== AFK DETECTION =====
        let (afk_state, afk_changed, seconds_idle) = afk_watcher.check(now);
        let is_afk = afk_state == AfkState::Afk;
        
        // Record AFK state changes to afk_events table
        if afk_changed {
            let status = if is_afk { "afk" } else { "not-afk" };
            if let Err(e) = db.upsert_afk_event(
                &config.device_id,
                &config.user_id,
                now,
                now,
                status,
            ) {
                error!("Failed to record AFK event: {}", e);
            }
        }
        
        // ===== AFK BOUNDARY SPLITTING =====
        // When AFK state changes, force close current session and start fresh
        // This creates clean boundaries between "active" and "afk" time
        let afk_boundary_crossed = was_afk != is_afk;
        was_afk = is_afk;

        // ===== GET ACTIVE WINDOW INFO =====
        match get_active_window_info() {
            Ok(Some(info)) => {
                debug!(
                    "Active: {} ({}) - {:?} [AFK: {}, idle: {:.1}s]",
                    info.app_name, info.bundle_id, info.window_title, is_afk, seconds_idle
                );

                // ===== EXCLUDED APP CHECK =====
                if excluded.contains(&info.bundle_id) {
                    debug!("Skipping excluded app: {}", info.bundle_id);
                    if let Some(ref session) = current_session {
                        close_session(session, db, &sync_queue, now, SessionCloseReason::AppExcluded);
                    }
                    current_session = None;
                    std::thread::sleep(poll_interval);
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
                
                let (action, close_reason) = match &current_session {
                    Some(session) => {
                        // Check for AFK boundary
                        if afk_boundary_crossed {
                            (SessionAction::Close, Some(SessionCloseReason::AfkStateChanged))
                        }
                        // Check for hard gap (catches sleep/hangs that didn't trigger wake detection)
                        else if now.saturating_sub(session.last_seen_ts) > hard_gap_ms {
                            (SessionAction::Close, Some(SessionCloseReason::HardGap))
                        }
                        // Check if signature changed
                        else if session.signature != new_signature {
                            (SessionAction::Close, Some(SessionCloseReason::SignatureChanged))
                        }
                        // Same signature - can we merge?
                        else {
                            // Check pulsetime window
                            let within_pulsetime = now.saturating_sub(session.last_seen_ts) <= pulsetime_ms;
                            if within_pulsetime {
                                // Check if we should commit (session getting long)
                                let session_duration = now.saturating_sub(session.start_time);
                                let should_commit = session_duration > commit_interval_ms && 
                                                   now.saturating_sub(last_commit_time) > commit_interval_ms;
                                (SessionAction::Merge { should_commit }, None)
                            } else {
                                // Outside pulsetime but same activity - close and create new
                                (SessionAction::Close, Some(SessionCloseReason::HardGap))
                            }
                        }
                    }
                    None => (SessionAction::CreateNew, None),
                };

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
                            TitleMode::Hash => (
                                None,
                                info.window_title.as_ref().map(|t| hash_title(t)),
                            ),
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
                            TitleMode::Hash => (
                                None,
                                info.window_title.as_ref().map(|t| hash_title(t)),
                            ),
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
                warn!("Failed to get active window info: {} (permission revoked?)", e);
                if let Some(ref session) = current_session {
                    close_session(session, db, &sync_queue, now, SessionCloseReason::PermissionLost);
                }
                current_session = None;
            }
        }

        // Update heartbeat
        if let Err(e) = db.update_heartbeat(&config.device_id, now) {
            error!("Failed to update heartbeat: {}", e);
        }

        std::thread::sleep(poll_interval);
    }

    // ===== SHUTDOWN: Close final session =====
    if let Some(ref session) = current_session {
        close_session(session, db, &sync_queue, now_ms(), SessionCloseReason::Shutdown);
    }
    
    info!("📊 Watcher statistics:");
    if let Ok(count) = db.get_event_count(&config.device_id) {
        info!("   Total events recorded: {}", count);
    }
    if let Ok(stats) = db.get_db_stats() {
        info!("   Database size: {:.2} MB", stats.db_size_bytes as f64 / 1024.0 / 1024.0);
    }
    
    // Report sync queue status
    if let Some(ref sq) = sync_queue {
        if let Ok(pending) = sq.pending_count() {
            info!("   Pending sync items: {}", pending);
        }
    }
}

/// Actions the state machine can take
enum SessionAction {
    /// Merge heartbeat into existing session
    Merge { should_commit: bool },
    /// Close current session and create new one
    Close,
    /// Create first session (no existing session)
    CreateNew,
}
