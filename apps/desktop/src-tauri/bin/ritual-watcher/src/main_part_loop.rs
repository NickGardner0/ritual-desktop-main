fn run_watcher_loop(
    config: &WatcherConfig,
    db: &WatcherDatabase,
    memory_db: &WatcherDatabase,
    memory_database_path: &str,
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
    let mut last_notification_event_ms: Option<u64> = None; // Debounce noisy app-switch notifications
    let mut loop_iteration: u64 = 0; // Track loop iterations for diagnostics
    let mut last_status_log = now_ms(); // Periodic status logging
    let mut last_main_session_end_update_ms: u64 = 0;
    let coalesce_end_update_ms: u64 = 2_000;
    let heartbeat_write_interval_ms: u64 = 15_000;
    let mut last_heartbeat_write_ms: u64 = 0;
    let mut heartbeat_write_pending = false;
    let mut pending_main_end_update: Option<(i64, u64)> = None;
    let mut pending_main_end_retry_not_before_ms: u64 = 0;
    let mut pending_main_end_retry_delay_ms: u64 = 250;
    let mut main_db_lock_errors: u64 = 0;
    let mut spool_ingested_total: u64 = 0;
    let mut spool_invalid_total: u64 = 0;
    let mut browser_server_started = false;
    let mut _browser_server_handle: Option<std::thread::JoinHandle<()>> = None;
    let (browser_db_tx, browser_db_rx): (Sender<BrowserDbCommand>, Receiver<BrowserDbCommand>) =
        mpsc::channel();
    let spool_dir = recorder_spool_dir(memory_database_path);
    if let Err(err) = fs::create_dir_all(&spool_dir) {
        warn!(
            "Failed to ensure recorder spool dir {}: {}",
            spool_dir.display(),
            err
        );
    } else {
        info!("📥 Recorder spool ingest enabled: {}", spool_dir.display());
    }

    // Initialize sync queue for backend reliability (with runtime retry if startup is locked).
    let mut sync_queue = match SyncQueue::new(&config.database_path) {
        Ok(sq) => {
            info!("✅ Sync queue initialized");
            Some(sq)
        }
        Err(e) => {
            warn!(
                "⚠️ Could not initialize sync queue at startup: {} - will retry in background",
                e
            );
            None
        }
    };
    let mut sync_queue_retry_not_before_ms: u64 = 0;
    let mut sync_queue_retry_delay_ms: u64 = 1_000;

    // Initialize event-driven notification listener (macOS)
    // This provides immediate app switch detection instead of waiting for next poll
    #[cfg(target_os = "macos")]
    let notification_listener = if event_driven_app_switch_enabled() {
        use notifications::NotificationListener;
        Some(NotificationListener::new())
    } else {
        info!("ℹ️ Event-driven app switch detection disabled; using polling only");
        None
    };
    #[cfg(not(target_os = "macos"))]
    let notification_listener: Option<()> = None;

    // Initialize screen event listener for lock/unlock and sleep/wake detection
    #[cfg(target_os = "macos")]
    let screen_event_listener = if screen_event_detection_enabled() {
        Some(ScreenEventListener::new())
    } else {
        info!("ℹ️ Screen event detection disabled");
        None
    };
    #[cfg(not(target_os = "macos"))]
    let screen_event_listener: Option<()> = None;

    // Initialize browser tab tracker (polls every 10 seconds)
    #[cfg(target_os = "macos")]
    let browser_tab_tracker = if browser_tab_tracker_enabled() {
        Some(BrowserTabTracker::new(10))
    } else {
        info!("ℹ️ Browser tab tracker disabled");
        None
    };
    #[cfg(not(target_os = "macos"))]
    let browser_tab_tracker: Option<()> = None;

    // Initialize window change listener for title changes within same app
    #[cfg(target_os = "macos")]
    let window_change_listener = if window_title_observer_enabled() {
        Some(WindowChangeListener::new())
    } else {
        info!("ℹ️ Window title observer disabled");
        None
    };
    #[cfg(not(target_os = "macos"))]
    let window_change_listener: Option<()> = None;
    #[cfg(target_os = "macos")]
    let mut last_window_change_event: Option<WindowChangeEvent> = None;
    #[cfg(target_os = "macos")]
    let mut pending_follow_up_capture_ms: Option<u64> = None;
    #[cfg(target_os = "macos")]
    let mut recent_window_event_debounce_ms: HashMap<String, u64> = HashMap::new();

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
        info!(
            "   Event-driven detection: {}",
            if event_driven_app_switch_enabled() {
                "enabled"
            } else {
                "disabled (polling only)"
            }
        );
        info!(
            "   Screen lock detection: {}",
            if screen_event_detection_enabled() {
                "enabled"
            } else {
                "disabled"
            }
        );
        info!(
            "   Browser tab polling: {}",
            if browser_tab_tracker_enabled() {
                "10s interval"
            } else {
                "disabled"
            }
        );
        info!(
            "   Window title observer: {}",
            if window_title_observer_enabled() && WindowChangeListener::has_permission() {
                "enabled (safe apps only)"
            } else if window_title_observer_enabled() {
                "disabled (no AX permission)"
            } else {
                "disabled"
            }
        );
        info!(
            "   Deep accessibility capture: {}",
            if deep_accessibility_capture_disabled() {
                "disabled"
            } else if deep_accessibility_capture_enabled() {
                "enabled"
            } else {
                "enabled (non-browser apps, excluding high-risk app shells)"
            }
        );
    }

    let stale_browser_cutoff_ms = now_ms().saturating_sub(90_000);
    let browser_duplicate_lookback_ms = now_ms().saturating_sub(14 * 24 * 60 * 60 * 1000);
    match db.clamp_stale_browser_extension_events(
        &config.device_id,
        stale_browser_cutoff_ms,
        15 * 60 * 1000,
    ) {
        Ok(repaired) if repaired > 0 => {
            info!(
                "🧹 Repaired {} stale browser-extension activity rows on startup",
                repaired
            );
        }
        Ok(_) => {}
        Err(err) => warn!("Failed stale browser session repair on startup: {}", err),
    }
    match db
        .delete_duplicate_browser_extension_events(&config.device_id, browser_duplicate_lookback_ms)
    {
        Ok(deleted) if deleted > 0 => {
            info!(
                "🧹 Removed {} duplicate browser-extension activity rows on startup",
                deleted
            );
        }
        Ok(_) => {}
        Err(err) => warn!(
            "Failed duplicate browser session cleanup on startup: {}",
            err
        ),
    }

    while running.load(Ordering::SeqCst) {
        let loop_now = now_ms();
        if sync_queue.is_none() && loop_now >= sync_queue_retry_not_before_ms {
            match SyncQueue::new(&config.database_path) {
                Ok(sq) => {
                    info!("✅ Sync queue initialized (retry)");
                    sync_queue = Some(sq);
                    sync_queue_retry_not_before_ms = 0;
                    sync_queue_retry_delay_ms = 1_000;
                }
                Err(e) => {
                    if is_db_lock_error(&e) {
                        debug!(
                            "Sync queue init lock contention; retrying in {}ms",
                            sync_queue_retry_delay_ms
                        );
                    } else {
                        warn!(
                            "Sync queue init retry failed: {} (retry in {}ms)",
                            e, sync_queue_retry_delay_ms
                        );
                    }
                    sync_queue_retry_not_before_ms =
                        loop_now.saturating_add(sync_queue_retry_delay_ms);
                    sync_queue_retry_delay_ms =
                        (sync_queue_retry_delay_ms.saturating_mul(2)).min(30_000);
                }
            }
        }

        process_browser_db_commands(db, &sync_queue, &browser_db_rx);
        let (spool_ingested, spool_invalid) =
            drain_recorder_spool(memory_db, &spool_dir, RECORDER_SPOOL_MAX_FILES_PER_TICK);
        spool_ingested_total = spool_ingested_total.saturating_add(spool_ingested as u64);
        spool_invalid_total = spool_invalid_total.saturating_add(spool_invalid as u64);

        let now = now_ms();
        if let Some((event_id, ts_end)) = pending_main_end_update {
            if now >= pending_main_end_retry_not_before_ms {
                match db.update_event_end_time(event_id, ts_end) {
                    Ok(()) => {
                        pending_main_end_update = None;
                        last_main_session_end_update_ms = now;
                        pending_main_end_retry_delay_ms = 250;
                        pending_main_end_retry_not_before_ms = 0;
                    }
                    Err(e) => {
                        if is_db_lock_error(&e) {
                            main_db_lock_errors = main_db_lock_errors.saturating_add(1);
                            pending_main_end_retry_not_before_ms =
                                now.saturating_add(pending_main_end_retry_delay_ms);
                            pending_main_end_retry_delay_ms =
                                (pending_main_end_retry_delay_ms.saturating_mul(2)).min(4_000);
                        } else {
                            warn!(
                                "Pending end-time update for event {} failed: {}",
                                event_id, e
                            );
                            pending_main_end_update = None;
                            pending_main_end_retry_delay_ms = 250;
                            pending_main_end_retry_not_before_ms = 0;
                        }
                    }
                }
            }
        }

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
                    let should_process = last_notification_event_ms
                        .map(|previous| event.timestamp_ms.saturating_sub(previous) >= 300)
                        .unwrap_or(true);
                    if !should_process {
                        continue;
                    }
                    debug!("🔔 Processing app-switch notification at {}ms", event.timestamp_ms);
                    last_notification_event_ms = Some(event.timestamp_ms);
                    triggered = true;
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
                            if let Some(ref mut session) = current_session {
                                close_session_with_lock_fallback(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    event.timestamp_ms,
                                    SessionCloseReason::ScreenLocked,
                                    &mut main_db_lock_errors,
                                    &mut pending_main_end_update,
                                    &mut last_main_session_end_update_ms,
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
                            if let Some(ref mut session) = current_session {
                                close_session_with_lock_fallback(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    event.timestamp_ms,
                                    SessionCloseReason::SleepWake,
                                    &mut main_db_lock_errors,
                                    &mut pending_main_end_update,
                                    &mut last_main_session_end_update_ms,
                                );
                            }
                            current_session = None;
                        }
                        ScreenEventType::DidWake => {
                            info!("⏰ System woke from sleep");
                            // Reset AFK state after wake
                            afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
                            was_afk = false;
                            last_notification_event_ms = None;
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
                        let event_key = format!(
                            "{}:{}:{}",
                            event.pid,
                            event.change_type,
                            event.title.as_deref().unwrap_or("")
                        );
                        let should_process = recent_window_event_debounce_ms
                            .get(&event_key)
                            .map(|previous| event.timestamp_ms.saturating_sub(*previous) >= 300)
                            .unwrap_or(true);
                        if !should_process {
                            continue;
                        }
                        recent_window_event_debounce_ms.insert(event_key, event.timestamp_ms);
                        recent_window_event_debounce_ms
                            .retain(|_, ts| event.timestamp_ms.saturating_sub(*ts) <= 30_000);
                        last_window_change_event = Some(event.clone());
                        if matches!(
                            event.change_type,
                            window_observer::WindowChangeType::FocusedUIElementChanged
                                | window_observer::WindowChangeType::SelectedTextChanged
                                | window_observer::WindowChangeType::ValueChanged
                                | window_observer::WindowChangeType::MainWindowChanged
                        ) {
                            pending_follow_up_capture_ms =
                                Some(event.timestamp_ms.saturating_add(350));
                        }
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
            if let Some(ref mut session) = current_session {
                close_session_with_lock_fallback(
                    session,
                    config,
                    db,
                    &sync_queue,
                    last_poll_time,
                    SessionCloseReason::SleepWake,
                    &mut main_db_lock_errors,
                    &mut pending_main_end_update,
                    &mut last_main_session_end_update_ms,
                );
                current_session = None;
            }
            // Reset AFK state after wake
            afk_watcher = AfkWatcher::new(config.afk_timeout_seconds);
            was_afk = false;
            last_notification_event_ms = None;
        }
        last_poll_time = now;

        // ===== SKIP PROCESSING IF SCREEN IS LOCKED =====
        if is_screen_locked {
            #[cfg(target_os = "macos")]
            let sleep_duration =
                scheduled_pump_duration(poll_interval, now, pending_follow_up_capture_ms);
            #[cfg(not(target_os = "macos"))]
            let sleep_duration = poll_interval;
            pump_run_loop(sleep_duration);
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
                    if let Some(ref mut session) = current_session {
                        if session.signature.bundle_id == tab_event.bundle_id {
                            // Same browser - check if domain changed (significant change)
                            let domain_changed = session.browser_domain != tab_event.domain;
                            if domain_changed {
                                // Close current session - the next poll will create a new one with updated info
                                close_session_with_lock_fallback(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    tab_event.timestamp_ms,
                                    SessionCloseReason::BrowserTabChanged,
                                    &mut main_db_lock_errors,
                                    &mut pending_main_end_update,
                                    &mut last_main_session_end_update_ms,
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
                    if let Some(ref mut session) = current_session {
                        close_session_with_lock_fallback(
                            session,
                            config,
                            db,
                            &sync_queue,
                            now,
                            SessionCloseReason::BrowserExtensionActive,
                            &mut main_db_lock_errors,
                            &mut pending_main_end_update,
                            &mut last_main_session_end_update_ms,
                        );
                    }
                    current_session = None;
                    #[cfg(target_os = "macos")]
                    {
                        if browser_tab_tracker_enabled() {
                            set_active_browser(None);
                        }
                    }
                    #[cfg(target_os = "macos")]
                    let sleep_duration =
                        scheduled_pump_duration(poll_interval, now, pending_follow_up_capture_ms);
                    #[cfg(not(target_os = "macos"))]
                    let sleep_duration = poll_interval;
                    pump_run_loop(sleep_duration);
                    continue;
                }

                // ===== UPDATE BROWSER TRACKER =====
                // Notify the browser tracker which app is active so it knows when to poll
                #[cfg(target_os = "macos")]
                {
                    if browser_tab_tracker_enabled() {
                        set_active_browser(Some(info.bundle_id.clone()));
                    }
                }

                // ===== UPDATE WINDOW OBSERVER =====
                // Set up AX observer for this app's window title changes
                #[cfg(target_os = "macos")]
                {
                    if window_title_observer_enabled_for_app(&info.bundle_id, &info.app_name) {
                        if let Some(pid) = info.pid {
                            observe_app(pid);
                        }
                    } else if window_title_observer_enabled() {
                        window_observer::stop_observing();
                    }
                }

                // ===== EXCLUDED APP CHECK =====
                if excluded.contains(&info.bundle_id) {
                    debug!("Skipping excluded app: {}", info.bundle_id);
                    if let Some(ref mut session) = current_session {
                        close_session_with_lock_fallback(
                            session,
                            config,
                            db,
                            &sync_queue,
                            now,
                            SessionCloseReason::AppExcluded,
                            &mut main_db_lock_errors,
                            &mut pending_main_end_update,
                            &mut last_main_session_end_update_ms,
                        );
                    }
                    current_session = None;
                    #[cfg(target_os = "macos")]
                    let sleep_duration =
                        scheduled_pump_duration(poll_interval, now, pending_follow_up_capture_ms);
                    #[cfg(not(target_os = "macos"))]
                    let sleep_duration = poll_interval;
                    pump_run_loop(sleep_duration);
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
                let focused_text_info = if deep_accessibility_capture_enabled_for_app(
                    &info.bundle_id,
                    &info.app_name,
                ) {
                    info.pid
                        .map(|pid| {
                            get_focused_text_info(
                                pid,
                                Some(info.bundle_id.as_str()),
                                info.window_title.as_deref(),
                            )
                        })
                        .unwrap_or_default()
                } else {
                    macos::FocusedTextInfo::default()
                };
                let capture_bundle_id = info.bundle_id.clone();
                let capture_app_name = info.app_name.clone();
                let capture_window_title = info.window_title.clone();
                let capture_document_title = if is_browser(&capture_bundle_id) {
                    info.window_title.clone()
                } else {
                    None
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
                            if session.event_id.is_none() {
                                let _ = ensure_session_event_persisted(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    now,
                                    &mut main_db_lock_errors,
                                    "merge_retry",
                                );
                            }
                            if let Some(event_id) = session.event_id {
                                let due_for_end_update = now
                                    .saturating_sub(last_main_session_end_update_ms)
                                    >= coalesce_end_update_ms;
                                if due_for_end_update || should_commit {
                                    if let Err(e) = db.update_event_end_time(event_id, now) {
                                        if is_db_lock_error(&e) {
                                            pending_main_end_update = Some((event_id, now));
                                            pending_main_end_retry_not_before_ms =
                                                now.saturating_add(125);
                                            main_db_lock_errors =
                                                main_db_lock_errors.saturating_add(1);
                                        } else {
                                            error!("Failed to update event end time: {}", e);
                                        }
                                    } else {
                                        last_main_session_end_update_ms = now;
                                        pending_main_end_update = None;
                                    }
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
                        if let Some(ref mut session) = current_session {
                            if let Some(reason) = close_reason {
                                close_session_with_lock_fallback(
                                    session,
                                    config,
                                    db,
                                    &sync_queue,
                                    now,
                                    reason,
                                    &mut main_db_lock_errors,
                                    &mut pending_main_end_update,
                                    &mut last_main_session_end_update_ms,
                                );
                            }
                        }

                        last_commit_time = now;
                        last_main_session_end_update_ms = now;
                        let mut new_session = CurrentSession {
                            signature: new_signature,
                            event_id: None,
                            start_time: now,
                            last_seen_ts: now,
                            app_name: info.app_name,
                            window_title: info.window_title,
                            browser_url: tracked_url.clone(),
                            browser_domain: tracked_domain.clone(),
                            is_incognito: browser_info.is_incognito,
                            pid: info.pid,
                        };
                        let _ = ensure_session_event_persisted(
                            &mut new_session,
                            config,
                            db,
                            &sync_queue,
                            now,
                            &mut main_db_lock_errors,
                            "close_then_create",
                        );
                        current_session = Some(new_session);
                    }
                    SessionAction::CreateNew => {
                        last_commit_time = now;
                        last_main_session_end_update_ms = now;
                        let mut new_session = CurrentSession {
                            signature: new_signature,
                            event_id: None,
                            start_time: now,
                            last_seen_ts: now,
                            app_name: info.app_name,
                            window_title: info.window_title,
                            browser_url: tracked_url.clone(),
                            browser_domain: tracked_domain.clone(),
                            is_incognito: browser_info.is_incognito,
                            pid: info.pid,
                        };
                        let _ = ensure_session_event_persisted(
                            &mut new_session,
                            config,
                            db,
                            &sync_queue,
                            now,
                            &mut main_db_lock_errors,
                            "create_new",
                        );
                        current_session = Some(new_session);
                    }
                }

                if !is_afk {
                    let activity_event_id = current_session
                        .as_ref()
                        .and_then(|session| session.event_id);
                    #[cfg(target_os = "macos")]
                    let delayed_follow_up = pending_follow_up_capture_ms
                        .map(|deadline_ms| now >= deadline_ms)
                        .unwrap_or(false);
                    #[cfg(target_os = "macos")]
                    if delayed_follow_up {
                        pending_follow_up_capture_ms = None;
                    }
                    #[cfg(target_os = "macos")]
                    let capture_trigger = derive_native_capture_trigger(
                        info.pid,
                        now,
                        last_window_change_event.as_ref(),
                        delayed_follow_up,
                    );
                    #[cfg(not(target_os = "macos"))]
                    let capture_trigger = derive_native_capture_trigger(info.pid, now, None, false);
                    record_native_context_snapshot(
                        db,
                        config,
                        now,
                        activity_event_id,
                        &capture_bundle_id,
                        &capture_app_name,
                        capture_window_title,
                        #[cfg(target_os = "macos")]
                        info.bounds,
                        tracked_url,
                        tracked_domain,
                        capture_document_title,
                        &focused_text_info,
                        &capture_trigger,
                    );
                }
            }
            Ok(None) => {
                debug!("No active window detected");
                if let Some(ref mut session) = current_session {
                    close_session_with_lock_fallback(
                        session,
                        config,
                        db,
                        &sync_queue,
                        now,
                        SessionCloseReason::NoWindow,
                        &mut main_db_lock_errors,
                        &mut pending_main_end_update,
                        &mut last_main_session_end_update_ms,
                    );
                }
                current_session = None;
            }
            Err(e) => {
                // Permission may have been revoked
                warn!(
                    "Failed to get active window info: {} (permission revoked?)",
                    e
                );
                if let Some(ref mut session) = current_session {
                    close_session_with_lock_fallback(
                        session,
                        config,
                        db,
                        &sync_queue,
                        now,
                        SessionCloseReason::PermissionLost,
                        &mut main_db_lock_errors,
                        &mut pending_main_end_update,
                        &mut last_main_session_end_update_ms,
                    );
                }
                current_session = None;
            }
        }

        // Update heartbeat (coalesced to reduce write contention with recorder).
        let heartbeat_due = heartbeat_write_pending
            || now.saturating_sub(last_heartbeat_write_ms) >= heartbeat_write_interval_ms;
        if heartbeat_due {
            match db.update_heartbeat(&config.device_id, now) {
                Ok(()) => {
                    heartbeat_write_pending = false;
                    last_heartbeat_write_ms = now;
                    if !browser_server_started {
                        let url_mode = match &config.url_mode {
                            UrlMode::Off => "off",
                            UrlMode::DomainOnly => "domain",
                            UrlMode::Full => "full",
                        }
                        .to_string();
                        _browser_server_handle = Some(browser_heartbeat_server::start_server(
                            config.device_id.clone(),
                            config.user_id.clone(),
                            config.track_incognito,
                            url_mode,
                            config.browser_heartbeat_port,
                            browser_extension_last_seen.clone(),
                            browser_db_tx.clone(),
                        ));
                        browser_server_started = true;
                        info!(
                            "✅ Browser heartbeat server started after first successful heartbeat write"
                        );
                    }
                }
                Err(e) => {
                    if is_db_lock_error(&e) {
                        heartbeat_write_pending = true;
                        main_db_lock_errors = main_db_lock_errors.saturating_add(1);
                    } else {
                        error!("Failed to update heartbeat: {}", e);
                    }
                }
            }
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
                "📊 Watcher status: {} iterations, current session: {}, AFK: {}, extension: {}, db_locks(main={}, browser={}), recorder_spool(ingested={}, invalid={})",
                loop_iteration,
                session_info,
                if was_afk { "yes" } else { "no" },
                if browser_extension_active {
                    "active"
                } else {
                    "inactive"
                },
                main_db_lock_errors,
                BROWSER_DB_LOCK_ERRORS.load(Ordering::Relaxed),
                spool_ingested_total,
                spool_invalid_total,
            );
            last_status_log = now;
        }

        #[cfg(target_os = "macos")]
        let sleep_duration =
            scheduled_pump_duration(poll_interval, now, pending_follow_up_capture_ms);
        #[cfg(not(target_os = "macos"))]
        let sleep_duration = poll_interval;
        pump_run_loop(sleep_duration);
    }

    // ===== SHUTDOWN: Close final session =====
    process_browser_db_commands(db, &sync_queue, &browser_db_rx);

    if let Some(ref mut session) = current_session {
        close_session_with_lock_fallback(
            session,
            config,
            db,
            &sync_queue,
            now_ms(),
            SessionCloseReason::Shutdown,
            &mut main_db_lock_errors,
            &mut pending_main_end_update,
            &mut last_main_session_end_update_ms,
        );
    }

    if let Some((event_id, ts_end)) = pending_main_end_update {
        if let Err(e) = db.update_event_end_time(event_id, ts_end) {
            if !is_db_lock_error(&e) {
                warn!(
                    "Final pending end-time update for event {} failed: {}",
                    event_id, e
                );
            }
        }
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
