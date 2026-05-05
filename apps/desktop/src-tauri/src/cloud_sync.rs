use crate::{desktop_runtime, native_widget, ritual_database};
use chrono::Utc;
use libsql::{Builder, Connection, Database};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Runtime};
use tracing::{debug, info, warn};

const CLOUD_SYNC_INTERVAL_SECS: u64 = 60;
const CLOUD_SYNC_BATCH_SIZE: i64 = 500;
const CLOUD_SYNC_STARTUP_DELAY_SECS: u64 = 5;

static CLOUD_SYNC_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

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

async fn run_cloud_sync_pass<R: Runtime + 'static>(app: AppHandle<R>) -> Result<(), String> {
    if CLOUD_SYNC_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let result = run_cloud_sync_pass_inner(app.clone()).await;
    CLOUD_SYNC_IN_FLIGHT.store(false, Ordering::SeqCst);
    desktop_runtime::emit_runtime_state_changed(app);
    result
}

async fn run_cloud_sync_pass_inner<R: Runtime + 'static>(app: AppHandle<R>) -> Result<(), String> {
    let local_metrics = read_local_cloud_sync_metrics().await?;

    let Some(config) = native_widget::load_turso_sync_config()? else {
        ritual_database::record_cloud_sync_runtime_state(
            local_metrics.latest_local_event_ts,
            ritual_database::database_runtime_state_snapshot().latest_cloud_sync_ts,
            local_metrics.backlog,
            None,
        );
        return Ok(());
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
        return Ok(());
    }

    let guard = ritual_database::get_activity_db().await?;
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
        return Ok(());
    }

    let (_remote_db, remote_conn) = open_remote_connection(&config).await?;

    let mut uploaded = 0usize;
    let mut last_error: Option<String> = None;
    let mut auth_failure = false;

    for item in pending {
        match upload_outbox_item(&remote_conn, &item).await {
            Ok(()) => {
                db.mark_synced(item.id).await.map_err(|error| {
                    format!("Failed to ack uploaded cloud sync row {}: {error}", item.id)
                })?;
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
                if auth_failure {
                    break;
                }
            }
        }
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

    Ok(())
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

async fn upload_outbox_item(
    conn: &Connection,
    item: &ritual_db::QueuedSyncItem,
) -> Result<(), String> {
    let payload_json = item
        .payload_json
        .as_ref()
        .ok_or_else(|| format!("Missing payload_json for cloud sync row {}", item.id))?;
    let payload: Value = serde_json::from_str(payload_json)
        .map_err(|error| format!("Invalid cloud sync payload for row {}: {error}", item.id))?;

    match item.entry_type.as_str() {
        "activity_event" => upsert_activity_event(conn, &payload).await,
        "afk_event" => upsert_afk_event(conn, &payload).await,
        "project_time_session" => upsert_project_time_session(conn, &payload).await,
        "project_time_daily_rollup" => upsert_project_time_daily_rollup(conn, &payload).await,
        "project_classification_rule" => upsert_project_classification_rule(conn, &payload).await,
        other => Err(format!("Unsupported cloud sync entity_type '{other}'")),
    }
}

async fn upsert_activity_event(conn: &Connection, payload: &Value) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO activity_events (
            event_uid,
            device_id,
            user_id,
            ts_start,
            ts_end,
            app_bundle_id,
            app_name,
            window_title,
            window_title_hash,
            window_owner_pid,
            is_afk,
            browser_url,
            browser_domain,
            is_incognito,
            source,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_uid) DO UPDATE SET
            device_id = excluded.device_id,
            user_id = excluded.user_id,
            ts_start = CASE
                WHEN activity_events.ts_start <= 0 OR excluded.ts_start < activity_events.ts_start
                THEN excluded.ts_start
                ELSE activity_events.ts_start
            END,
            ts_end = CASE
                WHEN excluded.ts_end > activity_events.ts_end
                THEN excluded.ts_end
                ELSE activity_events.ts_end
            END,
            app_bundle_id = excluded.app_bundle_id,
            app_name = excluded.app_name,
            window_title = excluded.window_title,
            window_title_hash = excluded.window_title_hash,
            window_owner_pid = excluded.window_owner_pid,
            is_afk = excluded.is_afk,
            browser_url = excluded.browser_url,
            browser_domain = excluded.browser_domain,
            is_incognito = excluded.is_incognito,
            source = excluded.source,
            created_at = CASE
                WHEN activity_events.created_at <= 0 OR excluded.created_at < activity_events.created_at
                THEN excluded.created_at
                ELSE activity_events.created_at
            END
        "#,
        libsql::params![
            required_string(payload, "event_uid")?,
            required_string(payload, "device_id")?,
            required_string(payload, "user_id")?,
            required_i64(payload, "ts_start")?,
            required_i64(payload, "ts_end")?,
            required_string(payload, "app_bundle_id")?,
            required_string(payload, "app_name")?,
            optional_string(payload, "window_title"),
            optional_string(payload, "window_title_hash"),
            optional_i64(payload, "window_owner_pid"),
            bool_as_i64(payload.get("is_afk")),
            optional_string(payload, "browser_url"),
            optional_string(payload, "browser_domain"),
            bool_as_i64(payload.get("is_incognito")),
            required_string(payload, "source")?,
            required_i64(payload, "created_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting activity_event: {error}"))?;
    Ok(())
}

async fn upsert_afk_event(conn: &Connection, payload: &Value) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO afk_events (
            afk_uid,
            device_id,
            user_id,
            ts_start,
            ts_end,
            status,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(afk_uid) DO UPDATE SET
            device_id = excluded.device_id,
            user_id = excluded.user_id,
            ts_start = CASE
                WHEN afk_events.ts_start <= 0 OR excluded.ts_start < afk_events.ts_start
                THEN excluded.ts_start
                ELSE afk_events.ts_start
            END,
            ts_end = CASE
                WHEN excluded.ts_end > afk_events.ts_end
                THEN excluded.ts_end
                ELSE afk_events.ts_end
            END,
            status = excluded.status,
            created_at = CASE
                WHEN afk_events.created_at <= 0 OR excluded.created_at < afk_events.created_at
                THEN excluded.created_at
                ELSE afk_events.created_at
            END
        "#,
        libsql::params![
            required_string(payload, "afk_uid")?,
            required_string(payload, "device_id")?,
            required_string(payload, "user_id")?,
            required_i64(payload, "ts_start")?,
            required_i64(payload, "ts_end")?,
            required_string(payload, "status")?,
            required_i64(payload, "created_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting afk_event: {error}"))?;
    Ok(())
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
            optional_string(payload, "summary_text").unwrap_or_default().chars().take(500).collect::<String>(),
            required_i64(payload, "created_at")?,
            required_i64(payload, "updated_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting project_time_session: {error}"))?;
    Ok(())
}

async fn upsert_project_time_daily_rollup(conn: &Connection, payload: &Value) -> Result<(), String> {
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
            optional_string(payload, "summary_text").unwrap_or_default().chars().take(500).collect::<String>(),
            required_string(payload, "source_version")?,
            required_i64(payload, "created_at")?,
            required_i64(payload, "updated_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting project_time_daily_rollup: {error}"))?;
    Ok(())
}

async fn upsert_project_classification_rule(conn: &Connection, payload: &Value) -> Result<(), String> {
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
        || lowered.contains("403")
        || lowered.contains("unauthorized")
        || lowered.contains("forbidden")
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
        Err(format!("Project-time cloud payload contains forbidden raw memory field '{key}'"))
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
    let guard = ritual_database::get_activity_db().await?;
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

fn optional_i64(payload: &Value, key: &str) -> Option<i64> {
    payload.get(key).and_then(json_i64)
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
