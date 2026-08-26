use crate::{desktop_runtime, native_widget, privacy_policy, ritual_database};
use chrono::Utc;
use libsql::{Builder, Connection, Database};
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};
use tracing::{debug, info, warn};

const CLOUD_SYNC_INTERVAL_SECS: u64 = 60;
const CLOUD_SYNC_BATCH_SIZE: i64 = 2000;
const CLOUD_SYNC_STARTUP_DELAY_SECS: u64 = 5;
const BACKGROUND_SYNC_BUDGET_SECS: u64 = 30;
const MANUAL_SYNC_BUDGET_SECS: u64 = 55;
const BACKGROUND_PROJECTION_INTERVAL_MS: i64 = 5 * 60 * 1000;

static CLOUD_SYNC_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static LAST_BACKGROUND_PROJECTION_AT_MS: AtomicI64 = AtomicI64::new(0);

#[derive(Debug, Clone, Default)]
struct CloudSyncProgress {
    uploaded_rollups: u64,
    superseded_raw_rows: u64,
    remote_watermark_ms: Option<i64>,
}

#[derive(Debug, Clone)]
struct ActivityRollupAck {
    rollup: crate::activity_rollups::ActivityDailyRollup,
    remote_watermark_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerActivitySyncOutcome {
    LocalRefreshed,
    CloudSynced,
    CloudPending,
    PrivacyBlocked,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerActivitySyncResult {
    pub outcome: ComputerActivitySyncOutcome,
    pub stage: desktop_runtime::DesktopComputerSyncStage,
    pub uploaded_rollups: u64,
    pub superseded_raw_rows: u64,
    pub pending_rollups: u64,
    pub pending_raw_rows: u64,
    pub local_watermark_ms: Option<i64>,
    pub remote_watermark_ms: Option<i64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

pub fn spawn_cloud_sync_worker<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(CLOUD_SYNC_STARTUP_DELAY_SECS)).await;

        let mut interval = tokio::time::interval(Duration::from_secs(CLOUD_SYNC_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            interval.tick().await;
            if let Err(error) = run_cloud_sync_pass(app.clone()).await {
                warn!(error = %error, "Desktop cloud sync pass failed");
            }
        }
    });
}

pub fn trigger_cloud_sync_now<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_cloud_sync_pass(app.clone()).await {
            warn!(error = %error, "Immediate desktop cloud sync pass failed");
        }
    });
}

async fn run_cloud_sync_pass<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<CloudSyncProgress, String> {
    if CLOUD_SYNC_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(CloudSyncProgress::default());
    }

    let started_at = Instant::now();
    let upload_result = match crate::activity_rollups::materialize_activity_rollups(
        None,
        None,
        Duration::from_secs(5),
    )
    .await
    {
        Ok(_) => {
            let remaining = Duration::from_secs(BACKGROUND_SYNC_BUDGET_SECS)
                .saturating_sub(started_at.elapsed());
            if remaining.is_zero() {
                Ok(CloudSyncProgress::default())
            } else {
                run_cloud_sync_pass_inner(app.clone(), remaining).await
            }
        }
        Err(error) => Err(error),
    };
    let result = match upload_result {
        Ok(progress) => run_background_replication_tail(app.clone(), started_at, progress).await,
        Err(error) => Err(error),
    };
    CLOUD_SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
    desktop_runtime::emit_runtime_state_changed(app);
    result
}

async fn run_cloud_sync_pass_inner<R: Runtime + 'static>(
    app: AppHandle<R>,
    budget: Duration,
) -> Result<CloudSyncProgress, String> {
    let started_at = Instant::now();
    let local_metrics = read_local_cloud_sync_metrics().await?;

    if let Err(reason) = privacy_policy::plaintext_cloud_sync_allowed_for_app(&app) {
        ritual_database::record_cloud_sync_runtime_state(
            local_metrics.latest_local_event_ts,
            ritual_database::database_runtime_state_snapshot().latest_cloud_sync_ts,
            local_metrics.backlog,
            Some(reason.clone()),
        );
        debug!(reason = %reason, backlog = local_metrics.backlog, "Desktop cloud sync blocked by privacy policy");
        return Ok(CloudSyncProgress::default());
    }

    let Some(config) = native_widget::load_turso_sync_config()? else {
        ritual_database::record_cloud_sync_runtime_state(
            local_metrics.latest_local_event_ts,
            ritual_database::database_runtime_state_snapshot().latest_cloud_sync_ts,
            local_metrics.backlog,
            None,
        );
        return Ok(CloudSyncProgress::default());
    };

    if !native_widget::turso_sync_config_is_fresh_enough(&config) {
        native_widget::set_turso_sync_env(None);
        desktop_runtime::request_token_refresh(&app);
        ritual_database::record_cloud_sync_runtime_state(
            local_metrics.latest_local_event_ts,
            ritual_database::database_runtime_state_snapshot().latest_cloud_sync_ts,
            local_metrics.backlog,
            Some("turso_sync_config_expired".to_string()),
        );
        return Ok(CloudSyncProgress::default());
    }

    if config.activity_schema_version < 2 {
        return Err("desktop_update_required: Turso activity schema v2 is unavailable".to_string());
    }

    let guard = ritual_database::get_or_initialize_activity_db("cloud_sync:outbox").await?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Activity database is not initialized".to_string())?;

    let pending = db
        .get_pending_sync(CLOUD_SYNC_BATCH_SIZE)
        .await
        .map_err(|error| format!("Failed to read cloud sync outbox: {error}"))?;

    if pending.is_empty() {
        ritual_database::record_cloud_sync_runtime_state(
            local_metrics.latest_local_event_ts,
            ritual_database::database_runtime_state_snapshot().latest_cloud_sync_ts,
            local_metrics.backlog,
            None,
        );
        return Ok(CloudSyncProgress::default());
    }

    let (_remote_db, remote_conn) = match open_remote_connection(&config).await {
        Ok(connection) => connection,
        Err(error) => {
            let claimed_ids = pending.iter().map(|item| item.id).collect::<Vec<_>>();
            db.release_sync_claims(&claimed_ids)
                .await
                .map_err(|release_error| {
                    format!(
                        "{error}; additionally failed releasing claimed sync rows: {release_error}"
                    )
                })?;
            return Err(error);
        }
    };

    let mut uploaded = 0usize;
    let mut uploaded_ids: Vec<i64> = Vec::new();
    let mut last_error: Option<String> = None;
    let mut auth_failure = false;
    let mut progress = CloudSyncProgress::default();

    let mut processed_count = 0_usize;
    for (index, item) in pending.iter().enumerate() {
        if started_at.elapsed() >= budget {
            break;
        }
        match upload_outbox_item(&remote_conn, &item).await {
            Ok(Some(ack)) => {
                let conn = db.connection().await;
                let superseded = crate::activity_rollups::mark_rollup_uploaded(
                    &conn,
                    &ack.rollup.rollup_uid,
                    &ack.rollup.user_id,
                    &ack.rollup.device_id,
                    &ack.rollup.date,
                )
                .await?;
                drop(conn);
                progress.uploaded_rollups += 1;
                progress.superseded_raw_rows += superseded;
                progress.remote_watermark_ms = Some(
                    progress
                        .remote_watermark_ms
                        .unwrap_or(0)
                        .max(ack.remote_watermark_ms),
                );
                uploaded += 1;
            }
            Ok(None) => {
                uploaded_ids.push(item.id);
                uploaded += 1;
            }
            Err(error) => {
                last_error = Some(error.clone());
                if looks_like_auth_error(&error) {
                    auth_failure = true;
                }
                if is_permanent_payload_error(&error) {
                    db.mark_sync_dead_letter(item.id, &truncate_sync_error(&error))
                        .await
                        .map_err(|ack_error| {
                            format!(
                                "Cloud sync row {} failed permanently with '{error}', and dead-lettering it also errored: {ack_error}",
                                item.id
                            )
                        })?;
                } else {
                    db.mark_sync_failed(item.id)
                        .await
                        .map_err(|ack_error| {
                            format!(
                                "Cloud sync row {} failed with '{error}', and marking it failed also errored: {ack_error}",
                                item.id
                            )
                        })?;
                }
            }
        }
        processed_count = index + 1;
        if auth_failure {
            break;
        }
    }

    if processed_count < pending.len() {
        let unprocessed_ids = pending[processed_count..]
            .iter()
            .map(|item| item.id)
            .collect::<Vec<_>>();
        db.release_sync_claims(&unprocessed_ids)
            .await
            .map_err(|error| format!("Failed releasing unprocessed cloud sync rows: {error}"))?;
    }

    if !uploaded_ids.is_empty() {
        db.mark_synced_many(&uploaded_ids)
            .await
            .map_err(|error| format!("Failed to ack uploaded cloud sync rows: {error}"))?;
    }

    let refreshed_metrics = read_local_cloud_sync_metrics().await?;
    let previous_cloud_sync_ts =
        ritual_database::database_runtime_state_snapshot().latest_cloud_sync_ts;
    ritual_database::record_cloud_sync_runtime_state(
        refreshed_metrics.latest_local_event_ts,
        if uploaded > 0 {
            Some(Utc::now().timestamp_millis())
        } else {
            previous_cloud_sync_ts
        },
        refreshed_metrics.backlog,
        last_error.clone(),
    );

    if uploaded > 0 {
        info!(
            uploaded,
            backlog = refreshed_metrics.backlog,
            "Desktop cloud sync uploaded activity rows"
        );
    } else if let Some(error) = last_error {
        debug!(error = %error, backlog = refreshed_metrics.backlog, "Desktop cloud sync made no progress");
    }

    if auth_failure {
        desktop_runtime::request_token_refresh(&app);
    }

    Ok(progress)
}

async fn open_remote_connection(
    config: &native_widget::TursoSyncConfig,
) -> Result<(Database, Connection), String> {
    let db = Builder::new_remote(config.sync_url.clone(), config.auth_token.clone())
        .build()
        .await
        .map_err(|error| format!("Failed to open remote Turso connection: {error}"))?;
    let conn = db
        .connect()
        .map_err(|error| format!("Failed to connect remote Turso database: {error}"))?;
    Ok((db, conn))
}

fn remote_rollup_from_row(row: &libsql::Row) -> crate::activity_rollups::ActivityDailyRollup {
    crate::activity_rollups::ActivityDailyRollup {
        rollup_uid: row.get(0).unwrap_or_default(),
        user_id: row.get(1).unwrap_or_default(),
        device_id: row.get(2).unwrap_or_default(),
        date: row.get(3).unwrap_or_default(),
        total_active_ms: row.get(4).unwrap_or(0),
        total_afk_ms: row.get(5).unwrap_or(0),
        events_count: row.get(6).unwrap_or(0),
        active_intervals_json: row.get(7).unwrap_or_else(|_| "[]".to_string()),
        afk_intervals_json: row.get(8).unwrap_or_else(|_| "[]".to_string()),
        app_summaries_json: row.get(9).unwrap_or_else(|_| "[]".to_string()),
        domain_summaries_json: row.get(10).unwrap_or_else(|_| "[]".to_string()),
        source_event_watermark: row.get(11).unwrap_or(0),
        source_version: row.get(12).unwrap_or_else(|_| {
            crate::activity_rollups::ACTIVITY_ROLLUP_SOURCE_VERSION.to_string()
        }),
        created_at: row.get(13).unwrap_or(0),
        updated_at: row.get(14).unwrap_or(0),
    }
}

async fn download_remote_activity_rollups(
    remote_conn: &Connection,
    user_id: &str,
    current_device_id: &str,
    budget: Duration,
) -> Result<Option<i64>, String> {
    let started_at = Instant::now();
    let guard =
        ritual_database::get_or_initialize_activity_db("cloud_sync:rollup_download").await?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Activity database is not initialized".to_string())?;
    let local_conn = db.connection().await;
    let (mut cursor_updated_at, mut cursor_uid) =
        crate::activity_rollups::read_remote_cursor(&local_conn, user_id).await?;
    let mut remote_watermark = None;

    loop {
        if started_at.elapsed() >= budget {
            break;
        }
        let mut rows = remote_conn
            .query(
                r#"
                SELECT rollup_uid, user_id, device_id, date,
                       total_active_ms, total_afk_ms, events_count,
                       active_intervals_json, afk_intervals_json,
                       app_summaries_json, domain_summaries_json,
                       source_event_watermark, source_version, created_at, updated_at
                FROM activity_daily_rollups
                WHERE user_id = ?
                  AND (updated_at > ? OR (updated_at = ? AND rollup_uid > ?))
                ORDER BY updated_at ASC, rollup_uid ASC
                LIMIT 500
                "#,
                libsql::params![
                    user_id,
                    cursor_updated_at,
                    cursor_updated_at,
                    cursor_uid.clone()
                ],
            )
            .await
            .map_err(|error| format!("Failed downloading remote activity rollups: {error}"))?;
        let mut batch = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|error| format!("Failed iterating remote activity rollups: {error}"))?
        {
            batch.push(remote_rollup_from_row(&row));
        }
        if batch.is_empty() {
            break;
        }

        for rollup in &batch {
            crate::activity_rollups::upsert_remote_rollup_cache(
                &local_conn,
                rollup,
                current_device_id,
            )
            .await?;
            cursor_updated_at = rollup.updated_at;
            cursor_uid = rollup.rollup_uid.clone();
            remote_watermark = Some(
                remote_watermark
                    .unwrap_or(0)
                    .max(rollup.source_event_watermark),
            );
        }
        crate::activity_rollups::write_remote_cursor(
            &local_conn,
            user_id,
            cursor_updated_at,
            &cursor_uid,
        )
        .await?;
        if batch.len() < 500 {
            break;
        }
    }
    Ok(remote_watermark)
}

async fn local_projection_range() -> Result<Option<(String, String)>, String> {
    let guard =
        ritual_database::get_or_initialize_activity_db("cloud_sync:projection_range").await?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Activity database is not initialized".to_string())?;
    let conn = db.connection().await;
    let mut rows = conn
        .query(
            "SELECT MIN(date), MAX(date) FROM daily_rollup_cache WHERE origin = 'local'",
            (),
        )
        .await
        .map_err(|error| format!("Failed reading activity projection range: {error}"))?;
    Ok(rows
        .next()
        .await
        .map_err(|error| format!("Failed reading activity projection range row: {error}"))?
        .and_then(|row| {
            let start = row.get::<Option<String>>(0).ok().flatten()?;
            let end = row.get::<Option<String>>(1).ok().flatten()?;
            Some((start, end))
        }))
}

async fn project_computer_time_habit<R: Runtime + 'static>(
    app: &AppHandle<R>,
    budget: Duration,
) -> Result<(), String> {
    let Some((start_date, end_date)) = local_projection_range().await? else {
        return Ok(());
    };
    let auth = desktop_runtime::read_auth_state(app);
    let token = auth
        .token
        .ok_or_else(|| "authentication_required: desktop auth token is unavailable".to_string())?;
    let backend_base = auth
        .backend_base
        .ok_or_else(|| "backend_unavailable: backend URL is unavailable".to_string())?;
    let privacy = privacy_policy::read_privacy_state(app);
    let privacy_mode = privacy.mode.as_header_value().to_string();
    let cloud_consents = privacy.cloud_consents_header();
    if budget.is_zero() {
        return Err("projection_pending: manual sync time budget was exhausted".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(budget.min(Duration::from_secs(20)))
            .build()
            .map_err(|error| format!("projection_failed: {error}"))?;
        let response = client
            .post(format!("{backend_base}/api/watcher/sync-to-habit"))
            .bearer_auth(token)
            .header("X-Ritual-Privacy-Mode", privacy_mode)
            .header("X-Ritual-Cloud-Consents", cloud_consents)
            .query(&[
                ("start_date", start_date.as_str()),
                ("end_date", end_date.as_str()),
            ])
            .send()
            .map_err(|error| format!("projection_failed: {error}"))?;
        let status = response.status().as_u16();
        let body = response.text().unwrap_or_default();
        if status == 401 {
            return Err(
                "authentication_required: habit projection needs a fresh token".to_string(),
            );
        }
        if status == 403 {
            return Err(
                "privacy_blocked: habit projection was blocked by privacy policy".to_string(),
            );
        }
        if !(200..300).contains(&status) {
            return Err(format!("projection_failed: HTTP {status}"));
        }
        let payload: Value = serde_json::from_str(&body)
            .map_err(|error| format!("projection_failed: invalid response: {error}"))?;
        if payload.get("success").and_then(Value::as_bool) == Some(false) {
            let state = payload.get("state").and_then(Value::as_str).unwrap_or("");
            let reason = payload
                .get("reason")
                .and_then(Value::as_str)
                .or_else(|| payload.get("error").and_then(Value::as_str))
                .unwrap_or("backend projection failed");
            if state == "sync_pending" {
                return Err(format!("projection_pending: {reason}"));
            }
            if state == "unavailable" {
                return Err(format!("aggregation_unavailable: {reason}"));
            }
            return Err(format!("projection_failed: {}", reason));
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("projection_failed: task failed: {error}"))?
}

async fn run_background_replication_tail<R: Runtime + 'static>(
    app: AppHandle<R>,
    pass_started_at: Instant,
    mut progress: CloudSyncProgress,
) -> Result<CloudSyncProgress, String> {
    if privacy_policy::plaintext_cloud_sync_allowed_for_app(&app).is_err() {
        return Ok(progress);
    }
    let Some(config) = native_widget::load_turso_sync_config()? else {
        return Ok(progress);
    };
    if !native_widget::turso_sync_config_is_fresh_enough(&config)
        || config.activity_schema_version < 2
    {
        return Ok(progress);
    }

    let watcher_config = crate::watcher::get_saved_watcher_config();
    let user_id = watcher_config
        .as_ref()
        .map(|item| item.user_id.trim().to_string())
        .unwrap_or_default();
    let device_id = watcher_config
        .as_ref()
        .map(|item| item.device_id.trim().to_string())
        .unwrap_or_default();
    if user_id.is_empty() || device_id.is_empty() {
        return Ok(progress);
    }

    let total_budget = Duration::from_secs(BACKGROUND_SYNC_BUDGET_SECS);
    let connection_budget = total_budget
        .saturating_sub(pass_started_at.elapsed())
        .min(Duration::from_secs(3));
    if connection_budget.is_zero() {
        return Ok(progress);
    }
    let (_remote_db, remote_conn) =
        match tokio::time::timeout(connection_budget, open_remote_connection(&config)).await {
            Ok(result) => result?,
            Err(_) => return Ok(progress),
        };

    let download_budget = total_budget
        .saturating_sub(pass_started_at.elapsed())
        .min(Duration::from_secs(5));
    if !download_budget.is_zero() {
        if let Ok(result) = tokio::time::timeout(
            download_budget,
            download_remote_activity_rollups(&remote_conn, &user_id, &device_id, download_budget),
        )
        .await
        {
            let watermark = result?;
            if let Some(watermark) = watermark {
                progress.remote_watermark_ms =
                    Some(progress.remote_watermark_ms.unwrap_or(0).max(watermark));
            }
        }
    }

    let guard =
        ritual_database::get_or_initialize_activity_db("cloud_sync:background_metrics").await?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Activity database is not initialized".to_string())?;
    let conn = db.connection().await;
    let (queued_rollups, pending_raw_rows, local_watermark_ms) =
        crate::activity_rollups::read_rollup_backlog(&conn).await?;
    let pending_dirty_days = crate::activity_rollups::read_pending_dirty_days(&conn).await?;
    drop(conn);
    let pending_rollups = queued_rollups.saturating_add(pending_dirty_days);

    desktop_runtime::update_computer_sync_state(&app, |state| {
        state.stage = if pending_rollups > 0 {
            desktop_runtime::DesktopComputerSyncStage::Uploading
        } else {
            desktop_runtime::DesktopComputerSyncStage::Synced
        };
        state.pending_rollups = pending_rollups;
        state.pending_raw_rows = pending_raw_rows;
        state.uploaded_rollups = progress.uploaded_rollups;
        state.superseded_raw_rows = progress.superseded_raw_rows;
        state.local_watermark_ms = local_watermark_ms;
        state.remote_watermark_ms = progress.remote_watermark_ms;
        state.last_error_code = None;
        state.last_error_message = None;
    });

    let now = Utc::now().timestamp_millis();
    let last_projection = LAST_BACKGROUND_PROJECTION_AT_MS.load(Ordering::SeqCst);
    let projection_due = pending_rollups == 0
        && now.saturating_sub(last_projection) >= BACKGROUND_PROJECTION_INTERVAL_MS;
    let projection_budget = total_budget
        .saturating_sub(pass_started_at.elapsed())
        .min(Duration::from_secs(10));
    if projection_due && !projection_budget.is_zero() {
        LAST_BACKGROUND_PROJECTION_AT_MS.store(now, Ordering::SeqCst);
        desktop_runtime::update_computer_sync_state(&app, |state| {
            state.stage = desktop_runtime::DesktopComputerSyncStage::Projecting;
        });
        match project_computer_time_habit(&app, projection_budget).await {
            Ok(()) => {
                desktop_runtime::update_computer_sync_state(&app, |state| {
                    state.stage = desktop_runtime::DesktopComputerSyncStage::Synced;
                    state.last_error_code = None;
                    state.last_error_message = None;
                });
            }
            Err(error) => {
                let code = sync_error_code(&error);
                if code == "authentication_required" {
                    desktop_runtime::request_token_refresh(&app);
                }
                desktop_runtime::update_computer_sync_state(&app, |state| {
                    state.stage = if code == "privacy_blocked" {
                        desktop_runtime::DesktopComputerSyncStage::PrivacyBlocked
                    } else {
                        desktop_runtime::DesktopComputerSyncStage::Failed
                    };
                    state.last_error_code = Some(code);
                    state.last_error_message = Some(error);
                });
            }
        }
    }

    Ok(progress)
}

async fn run_manual_cloud_sync_pass<R: Runtime + 'static>(
    app: AppHandle<R>,
    budget: Duration,
) -> Result<CloudSyncProgress, String> {
    if CLOUD_SYNC_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(CloudSyncProgress::default());
    }
    let result = run_cloud_sync_pass_inner(app.clone(), budget).await;
    CLOUD_SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
    desktop_runtime::emit_runtime_state_changed(app);
    result
}

fn sync_error_code(error: &str) -> String {
    error
        .split_once(':')
        .map(|(code, _)| code.trim().to_string())
        .filter(|code| !code.is_empty() && !code.contains(' '))
        .unwrap_or_else(|| "computer_sync_failed".to_string())
}

fn update_sync_runtime<R: Runtime>(app: &AppHandle<R>, result: &ComputerActivitySyncResult) {
    desktop_runtime::update_computer_sync_state(app, |state| {
        state.stage = result.stage.clone();
        state.pending_rollups = result.pending_rollups;
        state.pending_raw_rows = result.pending_raw_rows;
        state.uploaded_rollups = result.uploaded_rollups;
        state.superseded_raw_rows = result.superseded_raw_rows;
        state.local_watermark_ms = result.local_watermark_ms;
        state.remote_watermark_ms = result.remote_watermark_ms;
        state.last_error_code = result.error_code.clone();
        state.last_error_message = result.error_message.clone();
    });
}

fn local_sync_result(
    outcome: ComputerActivitySyncOutcome,
    stage: desktop_runtime::DesktopComputerSyncStage,
    progress: &crate::activity_rollups::ActivityRollupMaterializationProgress,
    error: Option<(String, String)>,
) -> ComputerActivitySyncResult {
    ComputerActivitySyncResult {
        outcome,
        stage,
        uploaded_rollups: 0,
        superseded_raw_rows: 0,
        pending_rollups: progress.pending_rollups,
        pending_raw_rows: progress.pending_raw_rows,
        local_watermark_ms: progress.local_watermark_ms,
        remote_watermark_ms: None,
        error_code: error.as_ref().map(|item| item.0.clone()),
        error_message: error.map(|item| item.1),
    }
}

async fn sync_computer_activity_now_inner<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<ComputerActivitySyncResult, String> {
    let started_at = Instant::now();
    desktop_runtime::update_computer_sync_state(&app, |state| {
        state.stage = desktop_runtime::DesktopComputerSyncStage::Materializing;
        state.last_error_code = None;
        state.last_error_message = None;
    });
    desktop_runtime::emit_runtime_state_changed(app.clone());

    let materialized = match crate::activity_rollups::materialize_activity_rollups(
        None,
        None,
        Duration::from_secs(15),
    )
    .await
    {
        Ok(progress) => progress,
        Err(error) => {
            let result = local_sync_result(
                ComputerActivitySyncOutcome::Failed,
                desktop_runtime::DesktopComputerSyncStage::Failed,
                &Default::default(),
                Some(("local_rollup_failed".to_string(), error)),
            );
            update_sync_runtime(&app, &result);
            desktop_runtime::emit_runtime_state_changed(app);
            return Ok(result);
        }
    };

    let privacy = privacy_policy::read_privacy_state(&app);
    if let Err(reason) = privacy_policy::plaintext_cloud_sync_allowed(&privacy) {
        let (outcome, stage, error) = match privacy.mode {
            privacy_policy::PrivacyMode::LocalOnly | privacy_policy::PrivacyMode::PrivateSync => (
                ComputerActivitySyncOutcome::LocalRefreshed,
                desktop_runtime::DesktopComputerSyncStage::LocalReady,
                None,
            ),
            privacy_policy::PrivacyMode::CloudIntelligence => (
                ComputerActivitySyncOutcome::PrivacyBlocked,
                desktop_runtime::DesktopComputerSyncStage::PrivacyBlocked,
                Some(("privacy_blocked".to_string(), reason)),
            ),
        };
        let result = local_sync_result(outcome, stage, &materialized, error);
        update_sync_runtime(&app, &result);
        desktop_runtime::emit_runtime_state_changed(app);
        return Ok(result);
    }

    desktop_runtime::update_computer_sync_state(&app, |state| {
        state.stage = desktop_runtime::DesktopComputerSyncStage::ObtainingConfig;
    });
    desktop_runtime::emit_runtime_state_changed(app.clone());
    let needs_config = native_widget::load_turso_sync_config()?
        .map(|config| {
            !native_widget::turso_sync_config_is_fresh_enough(&config)
                || config.activity_schema_version < 2
        })
        .unwrap_or(true);
    if needs_config {
        let generation = app
            .state::<desktop_runtime::DesktopShellState>()
            .auth_generation
            .load(Ordering::SeqCst);
        if let Err(error) = desktop_runtime::turso_sync::refresh_turso_sync_config_with_trigger(
            app.clone(),
            generation,
            false,
        )
        .await
        {
            let code = sync_error_code(&error);
            let stage = if code == "privacy_blocked" {
                desktop_runtime::DesktopComputerSyncStage::PrivacyBlocked
            } else {
                desktop_runtime::DesktopComputerSyncStage::Failed
            };
            let outcome = if code == "privacy_blocked" {
                ComputerActivitySyncOutcome::PrivacyBlocked
            } else {
                ComputerActivitySyncOutcome::Failed
            };
            let result = local_sync_result(outcome, stage, &materialized, Some((code, error)));
            update_sync_runtime(&app, &result);
            desktop_runtime::emit_runtime_state_changed(app);
            return Ok(result);
        }
    }

    let Some(config) = native_widget::load_turso_sync_config()? else {
        let result = local_sync_result(
            ComputerActivitySyncOutcome::CloudPending,
            desktop_runtime::DesktopComputerSyncStage::ObtainingConfig,
            &materialized,
            Some((
                "cloud_config_pending".to_string(),
                "Cloud credentials are not ready yet".to_string(),
            )),
        );
        update_sync_runtime(&app, &result);
        desktop_runtime::emit_runtime_state_changed(app);
        return Ok(result);
    };

    desktop_runtime::update_computer_sync_state(&app, |state| {
        state.stage = desktop_runtime::DesktopComputerSyncStage::Uploading;
    });
    desktop_runtime::emit_runtime_state_changed(app.clone());
    let remaining =
        Duration::from_secs(MANUAL_SYNC_BUDGET_SECS).saturating_sub(started_at.elapsed());
    let upload_budget = remaining.min(Duration::from_secs(30));
    let progress = match run_manual_cloud_sync_pass(app.clone(), upload_budget).await {
        Ok(progress) => progress,
        Err(error) => {
            let code = sync_error_code(&error);
            if code == "authentication_required" {
                desktop_runtime::request_token_refresh(&app);
            }
            let result = ComputerActivitySyncResult {
                outcome: ComputerActivitySyncOutcome::Failed,
                stage: desktop_runtime::DesktopComputerSyncStage::Failed,
                uploaded_rollups: 0,
                superseded_raw_rows: 0,
                pending_rollups: materialized.pending_rollups,
                pending_raw_rows: materialized.pending_raw_rows,
                local_watermark_ms: materialized.local_watermark_ms,
                remote_watermark_ms: None,
                error_code: Some(code),
                error_message: Some(error),
            };
            update_sync_runtime(&app, &result);
            desktop_runtime::emit_runtime_state_changed(app);
            return Ok(result);
        }
    };

    desktop_runtime::update_computer_sync_state(&app, |state| {
        state.stage = desktop_runtime::DesktopComputerSyncStage::Downloading;
    });
    desktop_runtime::emit_runtime_state_changed(app.clone());
    let watcher_config = crate::watcher::get_saved_watcher_config();
    let user_id = watcher_config
        .as_ref()
        .map(|item| item.user_id.trim().to_string())
        .unwrap_or_default();
    let device_id = watcher_config
        .as_ref()
        .map(|item| item.device_id.trim().to_string())
        .unwrap_or_default();
    let download_budget = Duration::from_secs(MANUAL_SYNC_BUDGET_SECS)
        .saturating_sub(started_at.elapsed())
        .min(Duration::from_secs(5));
    let download_watermark = if !user_id.is_empty()
        && !device_id.is_empty()
        && !download_budget.is_zero()
    {
        let (_remote_db, remote_conn) = open_remote_connection(&config).await?;
        match tokio::time::timeout(
            download_budget,
            download_remote_activity_rollups(&remote_conn, &user_id, &device_id, download_budget),
        )
        .await
        {
            Ok(result) => result?,
            Err(_) => None,
        }
    } else {
        None
    };

    desktop_runtime::update_computer_sync_state(&app, |state| {
        state.stage = desktop_runtime::DesktopComputerSyncStage::Verifying;
    });
    desktop_runtime::emit_runtime_state_changed(app.clone());

    let guard = ritual_database::get_or_initialize_activity_db("cloud_sync:manual_metrics").await?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Activity database is not initialized".to_string())?;
    let conn = db.connection().await;
    let (queued_rollups, pending_raw_rows, local_watermark_ms) =
        crate::activity_rollups::read_rollup_backlog(&conn).await?;
    let pending_dirty_days = crate::activity_rollups::read_pending_dirty_days(&conn).await?;
    let pending_rollups = queued_rollups.saturating_add(pending_dirty_days);
    drop(conn);
    let remote_watermark_ms = progress.remote_watermark_ms.or(download_watermark);

    if pending_rollups > 0 {
        let result = ComputerActivitySyncResult {
            outcome: ComputerActivitySyncOutcome::CloudPending,
            stage: desktop_runtime::DesktopComputerSyncStage::Uploading,
            uploaded_rollups: progress.uploaded_rollups,
            superseded_raw_rows: progress.superseded_raw_rows,
            pending_rollups,
            pending_raw_rows,
            local_watermark_ms,
            remote_watermark_ms,
            error_code: None,
            error_message: None,
        };
        update_sync_runtime(&app, &result);
        desktop_runtime::emit_runtime_state_changed(app);
        return Ok(result);
    }

    desktop_runtime::update_computer_sync_state(&app, |state| {
        state.stage = desktop_runtime::DesktopComputerSyncStage::Projecting;
    });
    let projection_budget =
        Duration::from_secs(MANUAL_SYNC_BUDGET_SECS).saturating_sub(started_at.elapsed());
    if projection_budget.is_zero() {
        let result = ComputerActivitySyncResult {
            outcome: ComputerActivitySyncOutcome::CloudPending,
            stage: desktop_runtime::DesktopComputerSyncStage::Projecting,
            uploaded_rollups: progress.uploaded_rollups,
            superseded_raw_rows: progress.superseded_raw_rows,
            pending_rollups,
            pending_raw_rows,
            local_watermark_ms,
            remote_watermark_ms,
            error_code: Some("projection_pending".to_string()),
            error_message: Some(
                "Rollups are synced; habit projection will finish on the next sync".to_string(),
            ),
        };
        update_sync_runtime(&app, &result);
        desktop_runtime::emit_runtime_state_changed(app);
        return Ok(result);
    }
    if let Err(error) = project_computer_time_habit(&app, projection_budget).await {
        let code = sync_error_code(&error);
        if code == "authentication_required" {
            desktop_runtime::request_token_refresh(&app);
        }
        let result = ComputerActivitySyncResult {
            outcome: if code == "privacy_blocked" {
                ComputerActivitySyncOutcome::PrivacyBlocked
            } else if code == "projection_pending" {
                ComputerActivitySyncOutcome::CloudPending
            } else {
                ComputerActivitySyncOutcome::Failed
            },
            stage: if code == "privacy_blocked" {
                desktop_runtime::DesktopComputerSyncStage::PrivacyBlocked
            } else if code == "projection_pending" {
                desktop_runtime::DesktopComputerSyncStage::Projecting
            } else {
                desktop_runtime::DesktopComputerSyncStage::Failed
            },
            uploaded_rollups: progress.uploaded_rollups,
            superseded_raw_rows: progress.superseded_raw_rows,
            pending_rollups,
            pending_raw_rows,
            local_watermark_ms,
            remote_watermark_ms,
            error_code: Some(code),
            error_message: Some(error),
        };
        update_sync_runtime(&app, &result);
        desktop_runtime::emit_runtime_state_changed(app);
        return Ok(result);
    }

    let result = ComputerActivitySyncResult {
        outcome: ComputerActivitySyncOutcome::CloudSynced,
        stage: desktop_runtime::DesktopComputerSyncStage::Synced,
        uploaded_rollups: progress.uploaded_rollups,
        superseded_raw_rows: progress.superseded_raw_rows,
        pending_rollups,
        pending_raw_rows,
        local_watermark_ms,
        remote_watermark_ms,
        error_code: None,
        error_message: None,
    };
    update_sync_runtime(&app, &result);
    desktop_runtime::emit_runtime_state_changed(app);
    Ok(result)
}

#[tauri::command]
pub async fn sync_computer_activity_now<R: Runtime + 'static>(
    app: AppHandle<R>,
) -> Result<ComputerActivitySyncResult, String> {
    match sync_computer_activity_now_inner(app.clone()).await {
        Ok(result) => Ok(result),
        Err(error) => {
            let code = sync_error_code(&error);
            if code == "authentication_required" {
                desktop_runtime::request_token_refresh(&app);
            }
            let current = desktop_runtime::read_computer_sync_state(&app);
            let privacy_blocked = code == "privacy_blocked";
            let result = ComputerActivitySyncResult {
                outcome: if privacy_blocked {
                    ComputerActivitySyncOutcome::PrivacyBlocked
                } else {
                    ComputerActivitySyncOutcome::Failed
                },
                stage: if privacy_blocked {
                    desktop_runtime::DesktopComputerSyncStage::PrivacyBlocked
                } else {
                    desktop_runtime::DesktopComputerSyncStage::Failed
                },
                uploaded_rollups: current.uploaded_rollups,
                superseded_raw_rows: current.superseded_raw_rows,
                pending_rollups: current.pending_rollups,
                pending_raw_rows: current.pending_raw_rows,
                local_watermark_ms: current.local_watermark_ms,
                remote_watermark_ms: current.remote_watermark_ms,
                error_code: Some(code),
                error_message: Some(error),
            };
            update_sync_runtime(&app, &result);
            desktop_runtime::emit_runtime_state_changed(app);
            Ok(result)
        }
    }
}

async fn upload_outbox_item(
    conn: &Connection,
    item: &ritual_db::QueuedSyncItem,
) -> Result<Option<ActivityRollupAck>, String> {
    let payload_json = item
        .payload_json
        .as_ref()
        .ok_or_else(|| format!("Missing payload_json for cloud sync row {}", item.id))?;
    let payload: Value = serde_json::from_str(payload_json)
        .map_err(|error| format!("Invalid cloud sync payload for row {}: {error}", item.id))?;

    match item.entry_type.as_str() {
        "activity_daily_rollup" => upload_activity_daily_rollup(conn, payload_json)
            .await
            .map(Some),
        "project_time_session" => upsert_project_time_session(conn, &payload)
            .await
            .map(|_| None),
        "project_time_daily_rollup" => upsert_project_time_daily_rollup(conn, &payload)
            .await
            .map(|_| None),
        "project_classification_rule" => upsert_project_classification_rule(conn, &payload)
            .await
            .map(|_| None),
        "activity_event" | "afk_event" => {
            Err("Raw activity rows are superseded by activity_daily_rollup".to_string())
        }
        other => Err(format!("Unsupported cloud sync entity_type '{other}'")),
    }
}

async fn upload_activity_daily_rollup(
    conn: &Connection,
    payload_json: &str,
) -> Result<ActivityRollupAck, String> {
    let rollup = crate::activity_rollups::activity_rollup_from_json(payload_json)?;
    conn.execute(
        r#"
        INSERT INTO activity_daily_rollups (
            rollup_uid, user_id, device_id, date,
            total_active_ms, total_afk_ms, events_count,
            active_intervals_json, afk_intervals_json,
            app_summaries_json, domain_summaries_json,
            source_event_watermark, source_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, device_id, date) DO UPDATE SET
            rollup_uid = excluded.rollup_uid,
            total_active_ms = excluded.total_active_ms,
            total_afk_ms = excluded.total_afk_ms,
            events_count = excluded.events_count,
            active_intervals_json = excluded.active_intervals_json,
            afk_intervals_json = excluded.afk_intervals_json,
            app_summaries_json = excluded.app_summaries_json,
            domain_summaries_json = excluded.domain_summaries_json,
            source_event_watermark = excluded.source_event_watermark,
            source_version = excluded.source_version,
            updated_at = CASE
                WHEN excluded.updated_at > activity_daily_rollups.updated_at
                THEN excluded.updated_at
                ELSE activity_daily_rollups.updated_at
            END
        WHERE excluded.source_event_watermark >= activity_daily_rollups.source_event_watermark
        "#,
        libsql::params![
            rollup.rollup_uid.clone(),
            rollup.user_id.clone(),
            rollup.device_id.clone(),
            rollup.date.clone(),
            rollup.total_active_ms,
            rollup.total_afk_ms,
            rollup.events_count,
            rollup.active_intervals_json.clone(),
            rollup.afk_intervals_json.clone(),
            rollup.app_summaries_json.clone(),
            rollup.domain_summaries_json.clone(),
            rollup.source_event_watermark,
            rollup.source_version.clone(),
            rollup.created_at,
            rollup.updated_at,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting activity_daily_rollup: {error}"))?;

    let mut rows = conn
        .query(
            r#"
            SELECT source_event_watermark
            FROM activity_daily_rollups
            WHERE user_id = ? AND device_id = ? AND date = ?
            "#,
            libsql::params![
                rollup.user_id.clone(),
                rollup.device_id.clone(),
                rollup.date.clone()
            ],
        )
        .await
        .map_err(|error| format!("Failed verifying remote activity rollup: {error}"))?;
    let remote_watermark_ms = rows
        .next()
        .await
        .map_err(|error| format!("Failed reading remote activity rollup watermark: {error}"))?
        .and_then(|row| row.get::<i64>(0).ok())
        .ok_or_else(|| "Remote activity rollup acknowledgement is missing".to_string())?;
    if remote_watermark_ms < rollup.source_event_watermark {
        return Err("Remote activity rollup watermark did not advance".to_string());
    }

    Ok(ActivityRollupAck {
        rollup,
        remote_watermark_ms,
    })
}

async fn upsert_project_time_session(conn: &Connection, payload: &Value) -> Result<(), String> {
    ensure_no_raw_memory_fields(payload)?;
    conn.execute(
        r#"
        INSERT INTO project_time_sessions (
            session_uid, user_id, device_id, date, timezone,
            start_ts, end_ts, active_ms, afk_ms,
            project_key, project_name, task_key, task_name,
            classification_source, confidence, status,
            apps_json, domains_json, artifacts_json, summary_text,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_uid) DO UPDATE SET
            user_id = excluded.user_id,
            device_id = excluded.device_id,
            date = excluded.date,
            timezone = excluded.timezone,
            start_ts = excluded.start_ts,
            end_ts = excluded.end_ts,
            active_ms = excluded.active_ms,
            afk_ms = excluded.afk_ms,
            project_key = excluded.project_key,
            project_name = excluded.project_name,
            task_key = excluded.task_key,
            task_name = excluded.task_name,
            classification_source = excluded.classification_source,
            confidence = excluded.confidence,
            status = excluded.status,
            apps_json = excluded.apps_json,
            domains_json = excluded.domains_json,
            artifacts_json = excluded.artifacts_json,
            summary_text = excluded.summary_text,
            updated_at = CASE
                WHEN excluded.updated_at > project_time_sessions.updated_at
                THEN excluded.updated_at
                ELSE project_time_sessions.updated_at
            END
        "#,
        libsql::params![
            required_string(payload, "session_uid")?,
            required_string(payload, "user_id")?,
            required_string(payload, "device_id")?,
            required_string(payload, "date")?,
            required_string(payload, "timezone")?,
            required_i64(payload, "start_ts")?,
            required_i64(payload, "end_ts")?,
            required_i64(payload, "active_ms")?,
            required_i64(payload, "afk_ms")?,
            required_string(payload, "project_key")?,
            required_string(payload, "project_name")?,
            required_string(payload, "task_key")?,
            required_string(payload, "task_name")?,
            required_string(payload, "classification_source")?,
            required_f64(payload, "confidence")?,
            required_string(payload, "status")?,
            string_or_empty(payload, "apps_json"),
            string_or_empty(payload, "domains_json"),
            string_or_empty(payload, "artifacts_json"),
            optional_string(payload, "summary_text")
                .unwrap_or_default()
                .chars()
                .take(500)
                .collect::<String>(),
            required_i64(payload, "created_at")?,
            required_i64(payload, "updated_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting project_time_session: {error}"))?;
    Ok(())
}

async fn upsert_project_time_daily_rollup(
    conn: &Connection,
    payload: &Value,
) -> Result<(), String> {
    ensure_no_raw_memory_fields(payload)?;
    conn.execute(
        r#"
        INSERT INTO project_time_daily_rollups (
            rollup_uid, user_id, device_id, date, timezone,
            project_key, project_name, task_key, task_name,
            active_ms, session_count, confidence_avg,
            top_apps_json, top_domains_json, summary_text,
            source_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(rollup_uid) DO UPDATE SET
            user_id = excluded.user_id,
            device_id = excluded.device_id,
            date = excluded.date,
            timezone = excluded.timezone,
            project_key = excluded.project_key,
            project_name = excluded.project_name,
            task_key = excluded.task_key,
            task_name = excluded.task_name,
            active_ms = excluded.active_ms,
            session_count = excluded.session_count,
            confidence_avg = excluded.confidence_avg,
            top_apps_json = excluded.top_apps_json,
            top_domains_json = excluded.top_domains_json,
            summary_text = excluded.summary_text,
            source_version = excluded.source_version,
            updated_at = CASE
                WHEN excluded.updated_at > project_time_daily_rollups.updated_at
                THEN excluded.updated_at
                ELSE project_time_daily_rollups.updated_at
            END
        "#,
        libsql::params![
            required_string(payload, "rollup_uid")?,
            required_string(payload, "user_id")?,
            required_string(payload, "device_id")?,
            required_string(payload, "date")?,
            required_string(payload, "timezone")?,
            required_string(payload, "project_key")?,
            required_string(payload, "project_name")?,
            required_string(payload, "task_key")?,
            required_string(payload, "task_name")?,
            required_i64(payload, "active_ms")?,
            required_i64(payload, "session_count")?,
            required_f64(payload, "confidence_avg")?,
            string_or_empty(payload, "top_apps_json"),
            string_or_empty(payload, "top_domains_json"),
            optional_string(payload, "summary_text")
                .unwrap_or_default()
                .chars()
                .take(500)
                .collect::<String>(),
            required_string(payload, "source_version")?,
            required_i64(payload, "created_at")?,
            required_i64(payload, "updated_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting project_time_daily_rollup: {error}"))?;
    Ok(())
}

async fn upsert_project_classification_rule(
    conn: &Connection,
    payload: &Value,
) -> Result<(), String> {
    ensure_no_raw_memory_fields(payload)?;
    conn.execute(
        r#"
        INSERT INTO project_classification_rules (
            rule_uid, user_id, matcher_app_bundle_id, matcher_domain,
            matcher_title_pattern, matcher_artifact_pattern, matcher_keyword_pattern,
            project_key, project_name, task_key, task_name,
            priority, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(rule_uid) DO UPDATE SET
            user_id = excluded.user_id,
            matcher_app_bundle_id = excluded.matcher_app_bundle_id,
            matcher_domain = excluded.matcher_domain,
            matcher_title_pattern = excluded.matcher_title_pattern,
            matcher_artifact_pattern = excluded.matcher_artifact_pattern,
            matcher_keyword_pattern = excluded.matcher_keyword_pattern,
            project_key = excluded.project_key,
            project_name = excluded.project_name,
            task_key = excluded.task_key,
            task_name = excluded.task_name,
            priority = excluded.priority,
            enabled = excluded.enabled,
            updated_at = CASE
                WHEN excluded.updated_at > project_classification_rules.updated_at
                THEN excluded.updated_at
                ELSE project_classification_rules.updated_at
            END
        "#,
        libsql::params![
            required_string(payload, "rule_uid")?,
            required_string(payload, "user_id")?,
            optional_string(payload, "matcher_app_bundle_id"),
            optional_string(payload, "matcher_domain"),
            optional_string(payload, "matcher_title_pattern"),
            optional_string(payload, "matcher_artifact_pattern"),
            optional_string(payload, "matcher_keyword_pattern"),
            required_string(payload, "project_key")?,
            required_string(payload, "project_name")?,
            required_string(payload, "task_key")?,
            required_string(payload, "task_name")?,
            required_i64(payload, "priority")?,
            bool_as_i64(payload.get("enabled")),
            required_i64(payload, "created_at")?,
            required_i64(payload, "updated_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting project_classification_rule: {error}"))?;
    Ok(())
}

fn looks_like_auth_error(error: &str) -> bool {
    let lowered = error.to_ascii_lowercase();
    lowered.contains("401")
        || lowered.contains("unauthorized")
        || lowered.contains("token expired")
        || lowered.contains("invalid jwt")
}

fn is_permanent_payload_error(error: &str) -> bool {
    let lowered = error.to_ascii_lowercase();
    lowered.contains("invalid cloud sync payload")
        || lowered.contains("missing payload_json")
        || lowered.contains("missing required")
        || lowered.contains("unsupported cloud sync entity_type")
}

fn truncate_sync_error(error: &str) -> String {
    const MAX_ERROR_LEN: usize = 500;
    error.chars().take(MAX_ERROR_LEN).collect()
}

fn ensure_no_raw_memory_fields(payload: &Value) -> Result<(), String> {
    const FORBIDDEN_KEYS: &[&str] = &[
        "visible_text_raw",
        "raw_visible_text",
        "contextual_retrieval_text",
        "ocr_text",
        "thumbnail_path",
        "screenshot_path",
        "embedding",
        "segment_embedding",
    ];

    fn visit(value: &Value, forbidden: &[&str]) -> Option<String> {
        match value {
            Value::Object(map) => {
                for (key, nested) in map {
                    if forbidden.iter().any(|item| item == key) {
                        return Some(key.clone());
                    }
                    if let Some(found) = visit(nested, forbidden) {
                        return Some(found);
                    }
                }
                None
            }
            Value::Array(items) => items.iter().find_map(|item| visit(item, forbidden)),
            _ => None,
        }
    }

    if let Some(key) = visit(payload, FORBIDDEN_KEYS) {
        Err(format!(
            "Project-time cloud payload contains forbidden raw memory field '{key}'"
        ))
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
struct LocalCloudSyncMetrics {
    latest_local_event_ts: Option<i64>,
    backlog: i64,
}

async fn read_local_cloud_sync_metrics() -> Result<LocalCloudSyncMetrics, String> {
    let guard = ritual_database::get_or_initialize_activity_db("cloud_sync:metrics").await?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Activity database is not initialized".to_string())?;
    let conn = db.connection().await;

    let mut event_rows = conn
        .query("SELECT MAX(ts_end) FROM activity_events", ())
        .await
        .map_err(|error| {
            format!("Failed reading latest local activity event timestamp: {error}")
        })?;
    let latest_local_event_ts = event_rows
        .next()
        .await
        .map_err(|error| format!("Failed reading latest local activity event row: {error}"))?
        .and_then(|row| row.get::<Option<i64>>(0).ok().flatten());

    let mut backlog_rows = conn
        .query(
            "SELECT COUNT(*) FROM cloud_sync_outbox WHERE status IN ('pending', 'failed', 'uploading')",
            (),
        )
        .await
        .map_err(|error| format!("Failed reading cloud sync backlog: {error}"))?;
    let backlog = backlog_rows
        .next()
        .await
        .map_err(|error| format!("Failed reading cloud sync backlog row: {error}"))?
        .and_then(|row| row.get::<i64>(0).ok())
        .unwrap_or(0);

    Ok(LocalCloudSyncMetrics {
        latest_local_event_ts,
        backlog,
    })
}

fn required_string(payload: &Value, key: &str) -> Result<String, String> {
    payload
        .get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("Missing required string field '{key}'"))
}

fn optional_string(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
}

fn string_or_empty(payload: &Value, key: &str) -> String {
    optional_string(payload, key).unwrap_or_default()
}

fn required_i64(payload: &Value, key: &str) -> Result<i64, String> {
    payload
        .get(key)
        .and_then(json_i64)
        .ok_or_else(|| format!("Missing required integer field '{key}'"))
}

fn required_f64(payload: &Value, key: &str) -> Result<f64, String> {
    payload
        .get(key)
        .and_then(json_f64)
        .ok_or_else(|| format!("Missing required numeric field '{key}'"))
}

fn json_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|item| i64::try_from(item).ok()))
        .or_else(|| value.as_str().and_then(|item| item.parse::<i64>().ok()))
}

fn json_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|item| item as f64))
        .or_else(|| value.as_u64().map(|item| item as f64))
        .or_else(|| value.as_str().and_then(|item| item.parse::<f64>().ok()))
}

fn bool_as_i64(value: Option<&Value>) -> i64 {
    value
        .and_then(|item| {
            item.as_bool()
                .map(|flag| if flag { 1 } else { 0 })
                .or_else(|| json_i64(item))
        })
        .unwrap_or(0)
}
