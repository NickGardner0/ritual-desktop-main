fn process_browser_db_commands(
    db: &WatcherDatabase,
    sync_queue: &Option<SyncQueue>,
    browser_db_rx: &Receiver<BrowserDbCommand>,
) {
    loop {
        match browser_db_rx.try_recv() {
            Ok(BrowserDbCommand::InsertBrowserActivityEvent {
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
                response,
            }) => {
                let result = db.insert_activity_event_with_source(
                    &device_id,
                    &user_id,
                    ts_start,
                    ts_end,
                    &app_bundle_id,
                    &app_name,
                    window_title.as_deref(),
                    None,
                    None,
                    false,
                    browser_url.as_deref(),
                    browser_domain.as_deref(),
                    is_incognito,
                    Some("browser_extension"),
                );
                match result {
                    Ok(event_id) => {
                        if let Some(ref sq) = sync_queue {
                            if let Err(e) = sq.queue_activity_sync(event_id) {
                                debug!("Failed to queue browser insert for sync: {}", e);
                            }
                        }
                        let _ = response.send(Ok(event_id));
                    }
                    Err(err) => {
                        if is_db_lock_error(&err) {
                            BROWSER_DB_LOCK_ERRORS.fetch_add(1, Ordering::Relaxed);
                        }
                        let _ = response.send(Err(err));
                    }
                }
            }
            Ok(BrowserDbCommand::UpdateEventEndTime {
                event_id,
                ts_end,
                response,
            }) => {
                match db.update_event_end_time(event_id, ts_end) {
                    Ok(()) => {
                        if let Some(ref sq) = sync_queue {
                            if let Err(e) = sq.queue_activity_update(event_id, ts_end) {
                                debug!("Failed to queue browser update for sync: {}", e);
                            }
                        }
                        let _ = response.send(Ok(()));
                    }
                    Err(err) => {
                        if is_db_lock_error(&err) {
                            BROWSER_DB_LOCK_ERRORS.fetch_add(1, Ordering::Relaxed);
                            // Best effort: browser heartbeats will keep retrying and close flush
                            // paths will write the latest ts_end eventually.
                            let _ = response.send(Ok(()));
                        } else {
                            let _ = response.send(Err(err));
                        }
                    }
                }
            }
            Ok(BrowserDbCommand::InsertContextSnapshot {
                device_id,
                user_id,
                activity_event_id,
                ts,
                source_type,
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
                response,
            }) => {
                let mut snapshot = RitualContextSnapshot::new(
                    device_id,
                    user_id,
                    ts as i64,
                    source_type,
                    app_bundle_id,
                    app_name,
                    dedup_key,
                );
                snapshot.activity_event_id = activity_event_id;
                snapshot.window_title = window_title;
                snapshot.browser_url = browser_url;
                snapshot.browser_domain = browser_domain;
                snapshot.tab_title = tab_title;
                snapshot.document_title = document_title;
                snapshot.visible_text_raw = visible_text_raw;
                snapshot.visible_text_norm = visible_text_norm;
                snapshot.capture_quality = capture_quality;
                snapshot.capture_trigger = Some("browser_heartbeat".to_string());
                snapshot.capture_components_json = capture_components_json.or_else(|| {
                    serde_json::to_string(&vec!["document_title", "browser_tab", "visible_text"])
                        .ok()
                });
                snapshot.ui_elements_json = ui_elements_json;
                snapshot.is_sensitive_redacted = is_sensitive_redacted;

                match db.record_context_snapshot(&snapshot) {
                    Ok(snapshot_id) => {
                        let _ = response.send(Ok(snapshot_id));
                    }
                    Err(err) => {
                        if is_db_lock_error(&err) {
                            BROWSER_DB_LOCK_ERRORS.fetch_add(1, Ordering::Relaxed);
                        }
                        let _ = response.send(Err(err));
                    }
                }
            }
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => {
                warn!("Browser DB command channel disconnected");
                break;
            }
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

    #[cfg(target_os = "macos")]
    #[test]
    fn detects_screen_capture_denial_signals() {
        assert!(screen_capture_denied_reason(
            "Error capturing screenshot: The user declined TCCs for application, window, display capture"
        ));
        assert!(screen_capture_denied_reason(
            "Grant access to this application in Privacy & Security settings"
        ));
        assert!(!screen_capture_denied_reason(
            "screencapture exited with status 1"
        ));
    }
}
