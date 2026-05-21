fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("ritual_watcher=info".parse().unwrap()),
        )
        .init();
    let _sentry_guard = sentry_observability::init_sentry("ritual-watcher", "watcher");

    #[cfg(target_os = "macos")]
    configure_process_as_background_agent();

    let args = Args::parse();
    sentry_observability::set_watcher_context(&args.user_id, &args.device_id);

    info!("🚀 Ritual Watcher v2 starting...");
    info!("   Device ID: {}", args.device_id);
    info!("   Poll interval: {}ms", args.poll_interval);
    info!("   Title mode: {}", args.title_mode);
    info!("   URL mode: {}", args.url_mode);
    info!("   AFK timeout: {}s", args.afk_timeout);

    if let Some(pid) = args.ax_dump_pid {
        let active = get_active_window_info().ok().flatten();
        let bundle_id = active
            .as_ref()
            .and_then(|info| (info.pid == Some(pid)).then_some(info.bundle_id.as_str()));
        let window_title = active
            .as_ref()
            .and_then(|info| (info.pid == Some(pid)).then_some(info.window_title.as_deref()))
            .flatten();

        match dump_accessibility_context(
            pid,
            bundle_id,
            window_title,
            args.ax_dump_depth,
            args.ax_dump_max_children,
        ) {
            Ok(dump) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&dump).unwrap_or_else(|_| "{}".to_string())
                );
                return;
            }
            Err(err) => {
                error!("AX dump failed for pid {}: {}", pid, err);
                std::process::exit(1);
            }
        }
    }

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
        browser_heartbeat_port: args.browser_heartbeat_port,
        pulsetime_seconds: (args.poll_interval as f64 / 1000.0) + 1.0,
    };

    // Initialize activity database (watcher events + sync queue).
    let db = match WatcherDatabase::new(&config.database_path) {
        Ok(db) => {
            info!("✅ Activity database connected: {}", config.database_path);
            db
        }
        Err(e) => {
            error!("❌ Failed to connect to activity database: {}", e);
            std::process::exit(1);
        }
    };

    // Initialize memory database (OCR frames + chunks + embeddings pipeline).
    let memory_database_path = derive_memory_db_path(&config.database_path);
    let memory_db = match WatcherDatabase::new(&memory_database_path) {
        Ok(db) => {
            info!("✅ Memory database connected: {}", memory_database_path);
            db
        }
        Err(e) => {
            error!(
                "❌ Failed to connect to memory database {}: {}",
                memory_database_path, e
            );
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

    let browser_extension_last_seen = Arc::new(AtomicU64::new(0));

    // Main polling loop
    run_watcher_loop(
        &config,
        &db,
        &memory_db,
        &memory_database_path,
        running,
        browser_extension_last_seen,
    );

    info!("👋 Ritual Watcher stopped");
}

#[cfg(target_os = "macos")]
fn configure_process_as_background_agent() {
    let policy_mode = env::var("RITUAL_WATCHER_ACTIVATION_POLICY")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "accessory".to_string());

    if matches!(
        policy_mode.as_str(),
        "off" | "disabled" | "none" | "0" | "false" | "no"
    ) {
        info!("ℹ️ Watcher background-only activation policy disabled");
        return;
    }

    let (policy, policy_label) = match policy_mode.as_str() {
        "prohibited" => (NSApplicationActivationPolicy::Prohibited, "background-only"),
        _ => (
            NSApplicationActivationPolicy::Accessory,
            "accessory background",
        ),
    };

    // The watcher uses AppKit APIs for NSWorkspace notifications and run loop
    // pumping, but it should behave like a background helper and never claim its
    // own Dock icon.
    unsafe {
        let app: *mut AnyObject = objc2::msg_send![objc2::class!(NSApplication), sharedApplication];
        if app.is_null() {
            warn!("⚠️ NSApplication sharedApplication returned null for watcher background mode");
            return;
        }

        let changed: bool = objc2::msg_send![
            app,
            setActivationPolicy: policy
        ];
        if !changed {
            warn!(
                "⚠️ Failed to set watcher activation policy to {}",
                policy_label
            );
        } else {
            info!("✅ Watcher activation policy set to {}", policy_label);
        }
    }
}

/// Pump the main thread's run loop for the given duration instead of sleeping.
/// This allows macOS system events (like NSWorkspace app activation notifications)
/// to be processed, keeping NSWorkspace.frontmostApplication() up to date.
/// Without this, a command-line process gets stale data from frontmostApplication().
#[cfg(target_os = "macos")]
fn pump_run_loop(duration: Duration) {
    use core_foundation_sys::runloop::{kCFRunLoopDefaultMode, CFRunLoopRunInMode};
    unsafe {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, duration.as_secs_f64(), 1);
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

fn scheduled_pump_duration(
    default_duration: Duration,
    now_ms: u64,
    follow_up_deadline_ms: Option<u64>,
) -> Duration {
    let mut duration = default_duration;
    if let Some(deadline_ms) = follow_up_deadline_ms {
        if deadline_ms <= now_ms {
            return Duration::from_millis(25);
        }
        let until_deadline = Duration::from_millis(deadline_ms.saturating_sub(now_ms));
        duration = duration.min(until_deadline);
    }
    duration
}

fn storage_title_fields(
    mode: &TitleMode,
    truncate_length: usize,
    window_title: Option<&String>,
) -> (Option<String>, Option<String>) {
    match mode {
        TitleMode::Off => (None, None),
        TitleMode::Full => (window_title.cloned(), None),
        TitleMode::Truncate => (
            window_title.map(|t| truncate_title(t, truncate_length)),
            None,
        ),
        TitleMode::Hash => (None, window_title.map(|t| hash_title(t))),
    }
}

fn env_flag(name: &str) -> Option<bool> {
    match env::var(name).ok()?.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn macos_feature_enabled(enable_var: &str, disable_var: &str) -> bool {
    if let Some(disabled) = env_flag(disable_var) {
        return !disabled;
    }
    env_flag(enable_var).unwrap_or(true)
}

#[cfg(target_os = "macos")]
fn macos_feature_opt_in(enable_var: &str, disable_var: &str) -> bool {
    if let Some(disabled) = env_flag(disable_var) {
        if disabled {
            return false;
        }
    }
    env_flag(enable_var).unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn event_driven_app_switch_enabled() -> bool {
    // Keep NSWorkspace activation notifications opt-in for now. The polling loop
    // still refreshes the active app/window every 2s, so capture richness stays
    // intact while we remove one of the remaining Objective-C callback surfaces.
    macos_feature_opt_in(
        "RITUAL_ENABLE_APP_SWITCH_NOTIFICATIONS",
        "RITUAL_DISABLE_APP_SWITCH_NOTIFICATIONS",
    )
}

#[cfg(not(target_os = "macos"))]
fn event_driven_app_switch_enabled() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn screen_event_detection_enabled() -> bool {
    // Screen lock/sleep notifications improve boundary precision but are not
    // required for OCR or activity capture. Keep them opt-in until the native
    // observer crash surface is fully eliminated.
    macos_feature_opt_in(
        "RITUAL_ENABLE_SCREEN_EVENT_NOTIFICATIONS",
        "RITUAL_DISABLE_SCREEN_EVENT_NOTIFICATIONS",
    )
}

#[cfg(not(target_os = "macos"))]
fn screen_event_detection_enabled() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn browser_tab_tracker_enabled() -> bool {
    matches!(
        env::var("RITUAL_ENABLE_BROWSER_TAB_TRACKER")
            .ok()
            .as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

#[cfg(not(target_os = "macos"))]
fn browser_tab_tracker_enabled() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn window_title_observer_enabled() -> bool {
    // The dedicated AX observer is a responsiveness enhancement, not the source
    // of truth for titles or OCR. Polling + CGWindow + focused AX text still
    // run without it, so default this to off for stability.
    macos_feature_opt_in(
        "RITUAL_ENABLE_WINDOW_TITLE_OBSERVER",
        "RITUAL_DISABLE_WINDOW_TITLE_OBSERVER",
    )
}

#[cfg(not(target_os = "macos"))]
fn window_title_observer_enabled() -> bool {
    false
}

fn deep_accessibility_capture_enabled() -> bool {
    matches!(
        env::var("RITUAL_ENABLE_DEEP_ACCESSIBILITY_CAPTURE")
            .ok()
            .as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

fn deep_accessibility_capture_disabled() -> bool {
    matches!(
        env::var("RITUAL_DISABLE_DEEP_ACCESSIBILITY_CAPTURE")
            .ok()
            .as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

fn deep_accessibility_high_risk_app_shell(bundle_id: &str, app_name: &str) -> bool {
    let bundle = bundle_id.to_ascii_lowercase();
    let name = app_name.to_ascii_lowercase();

    name == "ritual"
        || name == "codex"
        || name == "cursor"
        || name == "claude"
        || bundle == "com.ritual.desktop"
        || bundle.contains("codex")
        || bundle.contains("claude")
        || bundle.contains("cursor")
        || bundle.contains("slack")
        || bundle.contains("notion")
        || bundle.contains("todesktop")
}

fn window_title_observer_enabled_for_app(bundle_id: &str, app_name: &str) -> bool {
    if !window_title_observer_enabled() {
        return false;
    }

    // Keep the AX observer off the same desktop-shell apps we already treat as
    // high-risk for deep AX. The observer registers for focus/value/selected-
    // text AX notifications, and those callbacks can still surface Objective-C
    // exceptions even when deep capture itself is disabled.
    !deep_accessibility_high_risk_app_shell(bundle_id, app_name)
}

fn deep_accessibility_capture_enabled_for_app(bundle_id: &str, app_name: &str) -> bool {
    if deep_accessibility_capture_disabled() {
        return false;
    }
    if deep_accessibility_capture_enabled() {
        return true;
    }

    if deep_accessibility_high_risk_app_shell(bundle_id, app_name) {
        return false;
    }

    !is_browser(bundle_id)
}

fn ensure_session_event_persisted(
    session: &mut CurrentSession,
    config: &WatcherConfig,
    db: &WatcherDatabase,
    sync_queue: &Option<SyncQueue>,
    now: u64,
    main_db_lock_errors: &mut u64,
    context: &str,
) -> bool {
    if session.event_id.is_some() {
        return true;
    }

    let (stored_title, stored_hash) = storage_title_fields(
        &config.title_mode,
        config.truncate_length,
        session.window_title.as_ref(),
    );

    match db.insert_activity_event(
        &config.device_id,
        &config.user_id,
        session.start_time.min(now),
        now,
        &session.signature.bundle_id,
        &session.app_name,
        stored_title.as_deref(),
        stored_hash.as_deref(),
        session.pid,
        session.signature.is_afk,
        session.browser_url.as_deref(),
        session.browser_domain.as_deref(),
        session.is_incognito,
    ) {
        Ok(id) => {
            session.event_id = Some(id);
            if context == "create_new" {
                info!("Started tracking: {} (event {})", session.app_name, id);
            } else if context == "close_then_create" {
                debug!("Created new session {} for {}", id, session.app_name);
            } else {
                debug!(
                    "Recovered deferred session write: {} (event {}, context={})",
                    session.app_name, id, context
                );
            }
            if let Some(ref sq) = sync_queue {
                if let Err(e) = sq.queue_activity_sync(id) {
                    debug!("Failed to queue recovered session for sync: {}", e);
                }
            }
            true
        }
        Err(e) => {
            if is_db_lock_error(&e) {
                *main_db_lock_errors = main_db_lock_errors.saturating_add(1);
                debug!(
                    "Deferring session create due to lock contention: app={}, context={}",
                    session.app_name, context
                );
            } else {
                warn!(
                    "Failed to persist session activity (context={}, app={}): {}",
                    context, session.app_name, e
                );
            }
            false
        }
    }
}

fn close_session_with_lock_fallback(
    session: &mut CurrentSession,
    config: &WatcherConfig,
    db: &WatcherDatabase,
    sync_queue: &Option<SyncQueue>,
    now: u64,
    reason: SessionCloseReason,
    main_db_lock_errors: &mut u64,
    pending_main_end_update: &mut Option<(i64, u64)>,
    last_main_session_end_update_ms: &mut u64,
) {
    if session.event_id.is_none() {
        let _ = ensure_session_event_persisted(
            session,
            config,
            db,
            sync_queue,
            now,
            main_db_lock_errors,
            "close_before_drop",
        );
    }

    if let Some(event_id) = session.event_id {
        debug!(
            "Closing session {} ({}): {} [{:.1}s]",
            event_id,
            session.app_name,
            reason,
            (now - session.start_time) as f64 / 1000.0
        );
        if let Err(e) = db.update_event_end_time(event_id, now) {
            if is_db_lock_error(&e) {
                debug!(
                    "Deferring close for event {} due to lock contention; will retry",
                    event_id
                );
                *pending_main_end_update = Some((event_id, now));
            } else {
                error!("Failed to close event: {}", e);
            }
        } else {
            *last_main_session_end_update_ms = now;
            *pending_main_end_update = None;
        }
        if let Some(ref sq) = sync_queue {
            if let Err(e) = sq.queue_activity_sync(event_id) {
                debug!("Failed to queue for sync: {}", e);
            }
        }
    } else {
        debug!(
            "Dropping session without persisted event due to ongoing lock contention: {}",
            session.app_name
        );
    }
}
