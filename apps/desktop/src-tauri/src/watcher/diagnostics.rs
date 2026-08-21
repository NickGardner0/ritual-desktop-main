use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::Ordering;
use std::time::Duration;

use super::config::{
    default_browser_heartbeat_port, load_saved_watcher_config,
    EXTENSION_HEARTBEAT_LIVE_THRESHOLD_SECONDS, WATCHER_HEARTBEAT_ENDPOINTS,
};
use super::internal::{
    WATCHER_CONSECUTIVE_UNHEALTHY_CHECKS, WATCHER_LAST_RESTART_REASON, WATCHER_LAST_STARTED_AT,
    WATCHER_PROCESS, WATCHER_RESTART_COUNT,
};
use super::lifecycle::{read_local_watcher_freshness, start_watcher_sync, stop_watcher};
use super::permissions::check_accessibility_permission;
use crate::ritual_database::ACTIVITY_DB;
use tracing::instrument;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserExtensionDiagnostics {
    pub extension_installed: bool,
    pub watcher_reachable: bool,
    pub heartbeat_live: bool,
    pub watcher_server_url: Option<String>,
    pub current_listener_port: Option<u16>,
    pub watcher_pid: Option<u32>,
    pub duplicate_watcher_detected: bool,
    pub browser_heartbeat_port_mismatch: bool,
    pub last_browser_extension_heartbeat_ts: Option<i64>,
    pub seconds_since_browser_extension_heartbeat: Option<i64>,
    pub context_enabled: bool,
    pub context_quality: String,
    pub recent_context_snapshot_count: i64,
    pub recent_browser_snapshot_count: i64,
    pub recent_accessibility_snapshot_count: i64,
    pub recent_deep_accessibility_snapshot_count: i64,
    pub recent_metadata_fallback_count: i64,
    pub recent_event_triggered_snapshot_count: i64,
    pub recent_polling_snapshot_count: i64,
    pub recent_vision_fallback_snapshot_count: i64,
    pub last_context_snapshot_ts: Option<i64>,
    pub last_native_context_snapshot_ts: Option<i64>,
    pub seconds_since_context_snapshot: Option<i64>,
    pub native_capture_quality: String,
    pub ax_observer_live: bool,
    pub vision_fallback_apps: Vec<String>,
    pub vision_fallback_rate: f64,
    pub context_note: String,
    pub detection_note: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct WatcherHeartbeatStatusResponse {
    pub(crate) uptime_seconds: u64,
    pub(crate) total_heartbeats: u64,
    #[serde(default)]
    pub(crate) process_id: Option<u32>,
    #[serde(default)]
    pub(crate) listener_port: Option<u16>,
    #[serde(default)]
    pub(crate) last_extension_heartbeat_ms: Option<u64>,
}

#[derive(Debug, Clone)]
pub(crate) struct WatcherHeartbeatEndpointStatus {
    pub(crate) server_url: String,
    pub(crate) port: u16,
    pub(crate) status: WatcherHeartbeatStatusResponse,
}

pub(crate) fn watcher_server_statuses() -> Vec<WatcherHeartbeatEndpointStatus> {
    let mut statuses = Vec::new();
    for (url, host, port) in WATCHER_HEARTBEAT_ENDPOINTS {
        if let Some(status) = fetch_watcher_server_status(url, host, port) {
            statuses.push(status);
        }
    }
    statuses
}

fn fetch_watcher_server_status(
    url: &str,
    host: &str,
    port: u16,
) -> Option<WatcherHeartbeatEndpointStatus> {
    let address = format!("{host}:{port}");
    let socket_addr = address.to_socket_addrs().ok()?.next()?;
    let mut stream = TcpStream::connect_timeout(&socket_addr, Duration::from_millis(250)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));

    let request =
        format!("GET /api/status HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;

    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    let body = response.split("\r\n\r\n").nth(1)?.trim();
    let status: WatcherHeartbeatStatusResponse = serde_json::from_str(body).ok()?;

    Some(WatcherHeartbeatEndpointStatus {
        server_url: url.to_string(),
        port,
        status,
    })
}

#[tauri::command]
pub async fn get_browser_extension_diagnostics() -> Result<BrowserExtensionDiagnostics, String> {
    let server_statuses = watcher_server_statuses();
    let watcher_reachable = !server_statuses.is_empty();
    let preferred_status = server_statuses
        .iter()
        .find(|status| status.port == default_browser_heartbeat_port())
        .or_else(|| server_statuses.first());
    let watcher_server_url = preferred_status.map(|status| status.server_url.clone());
    let current_listener_port = preferred_status
        .and_then(|status| status.status.listener_port)
        .or_else(|| preferred_status.map(|status| status.port));
    let managed_watcher_pid = {
        let mut guard = WATCHER_PROCESS
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.as_mut().and_then(|child| {
            child
                .try_wait()
                .ok()
                .and_then(|state| state.is_none().then_some(child.id()))
        })
    };
    let watcher_pid = preferred_status
        .and_then(|status| status.status.process_id)
        .or(managed_watcher_pid);
    let unique_pids: HashSet<u32> = server_statuses
        .iter()
        .filter_map(|status| status.status.process_id)
        .collect();
    let unique_ports: HashSet<u16> = server_statuses
        .iter()
        .filter_map(|status| status.status.listener_port.or(Some(status.port)))
        .collect();
    let duplicate_watcher_detected = unique_pids.len() > 1
        || unique_ports.len() > 1
        || managed_watcher_pid
            .map(|pid| {
                server_statuses
                    .iter()
                    .filter_map(|status| status.status.process_id)
                    .any(|server_pid| server_pid != pid)
            })
            .unwrap_or(false);
    let device_id = super::config::get_device_id_or_config();

    let mut last_browser_extension_heartbeat_ts: Option<i64> = preferred_status
        .and_then(|status| status.status.last_extension_heartbeat_ms)
        .map(|value| value as i64);
    let mut recent_context_snapshot_count = 0i64;
    let mut recent_browser_snapshot_count = 0i64;
    let mut recent_accessibility_snapshot_count = 0i64;
    let mut recent_deep_accessibility_snapshot_count = 0i64;
    let mut recent_metadata_fallback_count = 0i64;
    let mut recent_event_triggered_snapshot_count = 0i64;
    let mut recent_polling_snapshot_count = 0i64;
    let mut recent_vision_fallback_snapshot_count = 0i64;
    let mut last_context_snapshot_ts: Option<i64> = None;
    let mut last_native_context_snapshot_ts: Option<i64> = None;
    let mut native_capture_quality_score = 0.0f64;
    let mut native_capture_quality_count = 0i64;
    let mut vision_fallback_apps = HashSet::new();
    let now_ms = chrono::Utc::now().timestamp_millis();
    let recent_window_start = now_ms - (10 * 60 * 1000);

    if let Some(ref dev_id) = device_id {
        let guard = ACTIVITY_DB.read().await;
        if let Some(ref db) = *guard {
            // Pull a bounded set of recent events and derive the latest extension heartbeat.
            let recent_events = db.get_recent_events(dev_id, 500).await.unwrap_or_default();

            for event in recent_events {
                if event.source.contains("browser_extension") {
                    last_browser_extension_heartbeat_ts = Some(
                        last_browser_extension_heartbeat_ts
                            .map(|existing| existing.max(event.ts_end))
                            .unwrap_or(event.ts_end),
                    );
                }
            }

            if let Ok(snapshots) = db
                .get_recent_context_snapshots(recent_window_start, now_ms, 500)
                .await
            {
                for snapshot in snapshots {
                    recent_context_snapshot_count += 1;
                    last_context_snapshot_ts = Some(
                        last_context_snapshot_ts
                            .map(|existing| existing.max(snapshot.ts))
                            .unwrap_or(snapshot.ts),
                    );
                    let is_native = !matches!(snapshot.source_type.as_str(), "browser_extension");
                    if is_native {
                        last_native_context_snapshot_ts = Some(
                            last_native_context_snapshot_ts
                                .map(|existing| existing.max(snapshot.ts))
                                .unwrap_or(snapshot.ts),
                        );
                        native_capture_quality_score += snapshot.capture_quality;
                        native_capture_quality_count += 1;
                    }
                    match snapshot.source_type.as_str() {
                        "browser_extension" => recent_browser_snapshot_count += 1,
                        "macos_accessibility" => recent_accessibility_snapshot_count += 1,
                        "macos_accessibility_deep" => {
                            recent_accessibility_snapshot_count += 1;
                            recent_deep_accessibility_snapshot_count += 1;
                        }
                        "window_metadata_fallback" => recent_metadata_fallback_count += 1,
                        "vision_ui_fallback" => {
                            recent_vision_fallback_snapshot_count += 1;
                            recent_accessibility_snapshot_count += 1;
                            if !snapshot.app_name.trim().is_empty() {
                                vision_fallback_apps.insert(snapshot.app_name.clone());
                            }
                        }
                        _ => {}
                    }
                    match snapshot.capture_trigger.as_deref() {
                        Some("ax_event") => recent_event_triggered_snapshot_count += 1,
                        Some("polling") | Some("idle_fallback") => {
                            recent_polling_snapshot_count += 1
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    let seconds_since_browser_extension_heartbeat =
        last_browser_extension_heartbeat_ts.map(|ts| (now_ms - ts) / 1000);
    let seconds_since_context_snapshot = last_context_snapshot_ts.map(|ts| (now_ms - ts) / 1000);
    let avg_native_capture_quality = if native_capture_quality_count > 0 {
        native_capture_quality_score / native_capture_quality_count as f64
    } else {
        0.0
    };
    let native_capture_quality =
        if recent_deep_accessibility_snapshot_count >= 4 && avg_native_capture_quality >= 0.8 {
            "high".to_string()
        } else if recent_accessibility_snapshot_count > 0 && avg_native_capture_quality >= 0.55 {
            "medium".to_string()
        } else if last_native_context_snapshot_ts.is_some() {
            "degraded".to_string()
        } else {
            "unavailable".to_string()
        };
    let ax_observer_live = recent_event_triggered_snapshot_count > 0
        || (recent_accessibility_snapshot_count > 0
            && seconds_since_context_snapshot
                .map(|seconds| seconds <= 120)
                .unwrap_or(false));

    let extension_installed = last_browser_extension_heartbeat_ts.is_some();
    let heartbeat_live = watcher_reachable
        && seconds_since_browser_extension_heartbeat
            .map(|seconds| seconds <= EXTENSION_HEARTBEAT_LIVE_THRESHOLD_SECONDS)
            .unwrap_or(false);
    let high_fidelity_count = recent_browser_snapshot_count + recent_accessibility_snapshot_count;
    let context_enabled = watcher_reachable
        && recent_context_snapshot_count >= 3
        && high_fidelity_count >= 1
        && seconds_since_context_snapshot
            .map(|seconds| seconds <= 120)
            .unwrap_or(false);
    let context_quality = if context_enabled && high_fidelity_count >= 6 {
        "high".to_string()
    } else if context_enabled {
        "medium".to_string()
    } else if recent_context_snapshot_count > 0 {
        "degraded".to_string()
    } else {
        "unavailable".to_string()
    };
    let browser_heartbeat_port_mismatch = duplicate_watcher_detected
        || current_listener_port
            .map(|port| port != default_browser_heartbeat_port())
            .unwrap_or(false);
    let vision_fallback_rate = if recent_context_snapshot_count > 0 {
        recent_vision_fallback_snapshot_count as f64 / recent_context_snapshot_count as f64
    } else {
        0.0
    };

    let detection_note = if duplicate_watcher_detected {
        let ports = server_statuses
            .iter()
            .map(|status| {
                status
                    .status
                    .listener_port
                    .unwrap_or(status.port)
                    .to_string()
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "Duplicate watcher listeners detected on {}. Browser/native capture may be split until only one watcher owns {}.",
            ports,
            default_browser_heartbeat_port()
        )
    } else if browser_heartbeat_port_mismatch {
        format!(
            "Watcher heartbeat server is reachable on port {} instead of the expected {}.",
            current_listener_port.unwrap_or_default(),
            default_browser_heartbeat_port()
        )
    } else if extension_installed {
        "Detected via browser_extension heartbeat events".to_string()
    } else if watcher_reachable {
        "Watcher is reachable, but no extension heartbeat has been observed yet".to_string()
    } else {
        "Watcher heartbeat server is not reachable".to_string()
    };
    let context_note = if context_enabled {
        format!(
            "Recent context capture is active (browser={}, accessibility={}, deep={}, fallback={}, vision={}, event_triggered={}).",
            recent_browser_snapshot_count,
            recent_accessibility_snapshot_count,
            recent_deep_accessibility_snapshot_count,
            recent_metadata_fallback_count,
            recent_vision_fallback_snapshot_count,
            recent_event_triggered_snapshot_count
        )
    } else if recent_context_snapshot_count > 0 {
        format!(
            "Context snapshots exist, but coverage is degraded (browser={}, accessibility={}, deep={}, fallback={}, vision={}, event_triggered={}).",
            recent_browser_snapshot_count,
            recent_accessibility_snapshot_count,
            recent_deep_accessibility_snapshot_count,
            recent_metadata_fallback_count,
            recent_vision_fallback_snapshot_count,
            recent_event_triggered_snapshot_count
        )
    } else {
        "No recent context snapshots were detected.".to_string()
    };

    Ok(BrowserExtensionDiagnostics {
        extension_installed,
        watcher_reachable,
        heartbeat_live,
        watcher_server_url,
        current_listener_port,
        watcher_pid,
        duplicate_watcher_detected,
        browser_heartbeat_port_mismatch,
        last_browser_extension_heartbeat_ts,
        seconds_since_browser_extension_heartbeat,
        context_enabled,
        context_quality,
        recent_context_snapshot_count,
        recent_browser_snapshot_count,
        recent_accessibility_snapshot_count,
        recent_deep_accessibility_snapshot_count,
        recent_metadata_fallback_count,
        recent_event_triggered_snapshot_count,
        recent_polling_snapshot_count,
        recent_vision_fallback_snapshot_count,
        last_context_snapshot_ts,
        last_native_context_snapshot_ts,
        seconds_since_context_snapshot,
        native_capture_quality,
        ax_observer_live,
        vision_fallback_apps: vision_fallback_apps.into_iter().collect(),
        vision_fallback_rate,
        context_note,
        detection_note,
    })
}

/// Check watcher health and auto-restart if hung
/// Returns true if watcher was restarted, false if it was healthy
#[instrument(fields(max_stale_seconds = max_stale_seconds))]
pub async fn check_and_restart_watcher_if_hung(max_stale_seconds: i64) -> Result<bool, String> {
    if load_saved_watcher_config().is_none() {
        return Ok(false);
    }

    if !check_accessibility_permission() {
        return Ok(false);
    }

    let status = super::queries::get_watcher_extended_status().await?;
    let diagnostics = get_browser_extension_diagnostics().await.ok();
    let watcher_reachable = diagnostics
        .as_ref()
        .map(|diag| diag.watcher_reachable)
        .unwrap_or(false);
    let context_fresh_from_diag = diagnostics
        .as_ref()
        .and_then(|diag| diag.seconds_since_context_snapshot)
        .map(|seconds| seconds <= max_stale_seconds)
        .unwrap_or(false);
    let heartbeat_fresh_from_diag = status
        .seconds_since_heartbeat
        .map(|seconds| seconds <= max_stale_seconds)
        .unwrap_or(false);
    let local_freshness = super::config::get_device_id_or_config()
        .as_deref()
        .and_then(read_local_watcher_freshness);
    let now_ms = chrono::Utc::now().timestamp_millis();
    let heartbeat_fresh_from_sqlite = local_freshness
        .and_then(|freshness| freshness.last_heartbeat_ts)
        .map(|ts| now_ms.saturating_sub(ts) <= max_stale_seconds * 1000)
        .unwrap_or(false);
    let context_fresh_from_sqlite = local_freshness
        .and_then(|freshness| freshness.last_context_snapshot_ts)
        .map(|ts| now_ms.saturating_sub(ts) <= max_stale_seconds * 1000)
        .unwrap_or(false);
    let activity_fresh_from_sqlite = local_freshness
        .and_then(|freshness| freshness.last_activity_ts)
        .map(|ts| now_ms.saturating_sub(ts) <= max_stale_seconds * 1000)
        .unwrap_or(false);
    let heartbeat_fresh = heartbeat_fresh_from_diag || heartbeat_fresh_from_sqlite;
    let context_fresh = context_fresh_from_diag || context_fresh_from_sqlite;
    let context_stale = !context_fresh;
    let heartbeat_stale = !heartbeat_fresh;
    let has_fresh_local_activity = heartbeat_fresh || context_fresh || activity_fresh_from_sqlite;
    let startup_grace_active = WATCHER_LAST_STARTED_AT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .map(|started_at| {
            started_at.elapsed() < Duration::from_secs((max_stale_seconds.max(60) * 2) as u64)
        })
        .unwrap_or(false);
    if startup_grace_active && (status.is_running || watcher_reachable || has_fresh_local_activity)
    {
        return Ok(false);
    }
    let should_restart = (!status.is_running && !watcher_reachable)
        || (status.is_running && !has_fresh_local_activity);

    if !should_restart {
        WATCHER_CONSECUTIVE_UNHEALTHY_CHECKS.store(0, Ordering::Relaxed);
        return Ok(false);
    }

    let unhealthy_checks = WATCHER_CONSECUTIVE_UNHEALTHY_CHECKS.fetch_add(1, Ordering::Relaxed) + 1;
    if unhealthy_checks < 3 {
        watcher_info!(
            "⚠️ Watcher health check degraded (is_running={}, watcher_reachable={}, heartbeat_stale={}, context_stale={}, fresh_local_activity={}, startup_grace_active={}, unhealthy_checks={}); waiting for confirmation before restart",
            status.is_running,
            watcher_reachable,
            heartbeat_stale,
            context_stale,
            has_fresh_local_activity,
            startup_grace_active,
            unhealthy_checks
        );
        return Ok(false);
    }

    if should_restart {
        WATCHER_CONSECUTIVE_UNHEALTHY_CHECKS.store(0, Ordering::Relaxed);
        watcher_info!(
            "⚠️ Watcher unhealthy or missing (is_running={}, watcher_reachable={}, heartbeat_stale={}, context_stale={}, fresh_local_activity={}, startup_grace_active={}, unhealthy_checks={})",
            status.is_running,
            watcher_reachable,
            heartbeat_stale,
            context_stale,
            has_fresh_local_activity,
            startup_grace_active,
            unhealthy_checks
        );

        if let Err(e) = stop_watcher().await {
            watcher_info!("   Failed to stop unhealthy watcher: {}", e);
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        if let Some(config) = load_saved_watcher_config() {
            let restart_reason = format!(
                "heartbeat_stale={} context_stale={} watcher_reachable={}",
                heartbeat_stale, context_stale, watcher_reachable
            );
            WATCHER_RESTART_COUNT.fetch_add(1, Ordering::Relaxed);
            if let Ok(mut guard) = WATCHER_LAST_RESTART_REASON.lock() {
                *guard = Some(restart_reason);
            }
            match start_watcher_sync(config) {
                Ok(_) => {
                    watcher_info!("✅ Watcher auto-restarted after health-check failure");
                    return Ok(true);
                }
                Err(e) => {
                    return Err(format!("Failed to restart watcher: {}", e));
                }
            }
        } else {
            return Err("No watcher config found for restart".to_string());
        }
    }

    Ok(false)
}
