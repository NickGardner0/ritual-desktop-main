use serde::{Deserialize, Serialize};
use std::time::Instant;

use super::internal::WATCHER_PROCESS;
use crate::ritual_database::ACTIVITY_DB;
use crate::watcher_activity::{
    build_app_summaries, build_domain_summaries, build_range_summary, clip_interval,
    DetailedActivityEvent, DetailedActivityResponse,
};
use tracing::instrument;

/// Returns events, app/domain summaries, and active/afk totals
#[tauri::command]
pub async fn get_detailed_activity(
    start_ts: i64,
    end_ts: i64,
    limit: Option<i64>,
    origin: Option<String>,
) -> Result<DetailedActivityResponse, String> {
    let started_at = Instant::now();
    let device_id = super::config::get_device_id_or_config().unwrap_or_default();
    let origin = origin
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("tauri:get_detailed_activity:unknown");

    let guard =
        crate::ritual_database::get_or_initialize_activity_db("watcher:get_detailed_activity")
            .await?;
    let db = super::config::require_db(guard.as_ref())?;

    // Get events in range
    let all_events = db
        .get_events_in_range(&device_id, start_ts, end_ts)
        .await
        .map_err(|e| format!("Failed to query events: {}", e))?;

    let mut clipped_events: Vec<DetailedActivityEvent> = all_events
        .iter()
        .filter_map(|event| {
            let (clipped_start, clipped_end) = clip_interval(event, start_ts, end_ts)?;
            Some(DetailedActivityEvent {
                id: event.id.unwrap_or(0),
                ts_start: clipped_start,
                ts_end: clipped_end,
                duration_ms: clipped_end.saturating_sub(clipped_start),
                app_bundle_id: event.app_bundle_id.clone(),
                app_name: event.app_name.clone(),
                window_title: event.window_title.clone(),
                browser_url: event.browser_url.clone(),
                browser_domain: event.browser_domain.clone(),
                is_afk: event.is_afk,
                is_incognito: event.is_incognito,
            })
        })
        .collect();

    clipped_events.sort_by(|a, b| b.ts_start.cmp(&a.ts_start));

    // Apply limit to the event list only. Aggregate summaries are computed from
    // the full local range so desktop metrics stay accurate.
    let limit_val = limit.unwrap_or(500) as usize;
    let events: Vec<DetailedActivityEvent> = clipped_events.into_iter().take(limit_val).collect();

    let apps = build_app_summaries(&all_events, start_ts, end_ts);
    let domains = build_domain_summaries(&all_events, start_ts, end_ts);
    let summary = build_range_summary(&all_events, start_ts, end_ts);

    watcher_info!(
        "get_detailed_activity origin={} start_ts={} end_ts={} limit={:?} total_events={} clipped_events={} apps={} domains={} duration_ms={}",
        origin,
        start_ts,
        end_ts,
        limit,
        all_events.len(),
        events.len(),
        apps.len(),
        domains.len(),
        started_at.elapsed().as_millis()
    );

    Ok(DetailedActivityResponse {
        events,
        apps,
        domains,
        total_active_ms: summary.active_ms,
        total_afk_ms: summary.afk_ms,
    })
}

// ============================================================
// DAILY SUMMARIES (internal, used by local_search_bridge)
// ============================================================

/// Daily summary for efficient syncing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailySummary {
    pub date: String,
    pub total_active_ms: i64,
    pub total_afk_ms: i64,
    pub total_hours: f64,
    pub app_count: i64,
    pub domain_count: i64,
    pub event_count: i64,
}

/// Get daily summaries for an inclusive date range (YYYY-MM-DD).
/// Used by both the local HTTP bridge and direct Tauri fallback from the dashboard.
#[tauri::command]
pub async fn get_daily_summaries(
    start_date: String,
    end_date: String,
    origin: Option<String>,
) -> Result<Vec<DailySummary>, String> {
    let started_at = Instant::now();
    use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone};

    let device_id = super::config::get_device_id_or_config().unwrap_or_default();
    let origin = origin
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("tauri:get_daily_summaries:unknown");
    let start =
        NaiveDate::parse_from_str(&start_date, "%Y-%m-%d").map_err(|_| "Invalid start_date")?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d").map_err(|_| "Invalid end_date")?;

    if end < start {
        return Err("end_date must be on or after start_date".to_string());
    }

    let guard =
        crate::ritual_database::get_or_initialize_activity_db("watcher:get_daily_summaries")
            .await?;
    let db = super::config::require_db(guard.as_ref())?;
    let start_of_range = Local
        .with_ymd_and_hms(start.year(), start.month(), start.day(), 0, 0, 0)
        .single()
        .ok_or("Invalid start_date")?;
    let end_of_range = Local
        .with_ymd_and_hms(end.year(), end.month(), end.day(), 23, 59, 59)
        .single()
        .ok_or("Invalid end_date")?;
    let all_events = db
        .get_events_in_range(
            &device_id,
            start_of_range.timestamp_millis(),
            end_of_range.timestamp_millis(),
        )
        .await
        .map_err(|e| format!("Failed to get summary events: {}", e))?;
    let mut rows = Vec::new();
    let mut day = start;

    while day <= end {
        let start_of_day = Local
            .with_ymd_and_hms(day.year(), day.month(), day.day(), 0, 0, 0)
            .single()
            .ok_or("Invalid date")?;
        let end_of_day = Local
            .with_ymd_and_hms(day.year(), day.month(), day.day(), 23, 59, 59)
            .single()
            .ok_or("Invalid date")?;

        let summary = build_range_summary(
            &all_events,
            start_of_day.timestamp_millis(),
            end_of_day.timestamp_millis(),
        );

        rows.push(DailySummary {
            date: day.format("%Y-%m-%d").to_string(),
            total_active_ms: summary.active_ms,
            total_afk_ms: summary.afk_ms,
            total_hours: summary.active_ms as f64 / (1000.0 * 60.0 * 60.0),
            app_count: summary.app_count,
            domain_count: summary.domain_count,
            event_count: summary.event_count,
        });

        day += Duration::days(1);
    }

    watcher_info!(
        "get_daily_summaries origin={} start_date={} end_date={} source_events={} row_count={} duration_ms={}",
        origin,
        start_date,
        end_date,
        all_events.len(),
        rows.len(),
        started_at.elapsed().as_millis()
    );

    Ok(rows)
}

// ============================================================
// REAL-TIME STATUS COMMANDS
// ============================================================

/// Extended watcher status with more detail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatcherExtendedStatus {
    pub is_running: bool,
    pub pid: Option<u32>,
    pub device_id: Option<String>,
    pub last_heartbeat_ts: Option<i64>,
    pub is_paused: bool,
    pub seconds_since_heartbeat: Option<i64>,
    pub current_app: Option<String>,
    pub session_duration_seconds: Option<i64>,
}

/// Get extended watcher status including real-time info
#[tauri::command]
#[instrument]
pub async fn get_watcher_extended_status() -> Result<WatcherExtendedStatus, String> {
    let (is_running, pid) = {
        let mut process_guard = WATCHER_PROCESS.lock().map_err(|e| e.to_string())?;

        let running = process_guard
            .as_mut()
            .map(|child| child.try_wait().map(|s| s.is_none()).unwrap_or(false))
            .unwrap_or(false);

        let p = if running {
            process_guard.as_ref().map(|c| c.id())
        } else {
            None
        };
        (running, p)
    }; // Drop the MutexGuard before any .await

    let device_id = super::config::get_device_id_or_config();

    // Query real-time info from the unified database
    let (last_heartbeat_ts, current_app, session_duration_seconds) =
        if let Some(ref dev_id) = device_id {
            let guard = ACTIVITY_DB.read().await;
            if let Some(ref db) = *guard {
                // Get last heartbeat
                let heartbeat = db.get_last_heartbeat(dev_id).await.unwrap_or(None);

                // Get most recent event
                let recent_events = db.get_recent_events(dev_id, 1).await.unwrap_or_default();

                let (app, session_dur) = if let Some(event) = recent_events.first() {
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    // If event is recent (within 10 seconds), it's the current session
                    if now_ms - event.ts_end < 10_000 {
                        (
                            Some(event.app_name.clone()),
                            Some((event.ts_end - event.ts_start) / 1000),
                        )
                    } else {
                        (None, None)
                    }
                } else {
                    (None, None)
                };

                (heartbeat, app, session_dur)
            } else {
                (None, None, None)
            }
        } else {
            (None, None, None)
        };

    let now_ms = chrono::Utc::now().timestamp_millis();
    let seconds_since_heartbeat = last_heartbeat_ts.map(|ts| (now_ms - ts) / 1000);

    Ok(WatcherExtendedStatus {
        is_running,
        pid,
        device_id,
        last_heartbeat_ts,
        is_paused: false,
        seconds_since_heartbeat,
        current_app,
        session_duration_seconds,
    })
}
