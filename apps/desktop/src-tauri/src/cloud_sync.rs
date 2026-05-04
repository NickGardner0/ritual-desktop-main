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
        "context_session" => upsert_context_session(conn, &payload).await,
        "context_snapshot" => upsert_context_snapshot(conn, &payload).await,
        "session_retrieval_doc" => upsert_session_retrieval_doc(conn, &payload).await,
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

async fn upsert_context_session(conn: &Connection, payload: &Value) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO context_sessions (
            session_uid,
            device_id,
            user_id,
            start_ts,
            end_ts,
            primary_app_bundle_id,
            primary_app_name,
            primary_domain,
            dominant_title,
            representative_text,
            coverage_score,
            snapshot_count,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_uid) DO UPDATE SET
            device_id = excluded.device_id,
            user_id = excluded.user_id,
            start_ts = CASE
                WHEN context_sessions.start_ts <= 0 OR excluded.start_ts < context_sessions.start_ts
                THEN excluded.start_ts
                ELSE context_sessions.start_ts
            END,
            end_ts = CASE
                WHEN excluded.end_ts > context_sessions.end_ts
                THEN excluded.end_ts
                ELSE context_sessions.end_ts
            END,
            primary_app_bundle_id = excluded.primary_app_bundle_id,
            primary_app_name = excluded.primary_app_name,
            primary_domain = excluded.primary_domain,
            dominant_title = excluded.dominant_title,
            representative_text = excluded.representative_text,
            coverage_score = excluded.coverage_score,
            snapshot_count = CASE
                WHEN excluded.snapshot_count > context_sessions.snapshot_count
                THEN excluded.snapshot_count
                ELSE context_sessions.snapshot_count
            END,
            created_at = CASE
                WHEN context_sessions.created_at <= 0 OR excluded.created_at < context_sessions.created_at
                THEN excluded.created_at
                ELSE context_sessions.created_at
            END,
            updated_at = CASE
                WHEN excluded.updated_at > context_sessions.updated_at
                THEN excluded.updated_at
                ELSE context_sessions.updated_at
            END
        "#,
        libsql::params![
            required_string(payload, "session_uid")?,
            required_string(payload, "device_id")?,
            required_string(payload, "user_id")?,
            required_i64(payload, "start_ts")?,
            required_i64(payload, "end_ts")?,
            optional_string(payload, "primary_app_bundle_id"),
            optional_string(payload, "primary_app_name"),
            optional_string(payload, "primary_domain"),
            optional_string(payload, "dominant_title"),
            optional_string(payload, "representative_text"),
            required_f64(payload, "coverage_score")?,
            required_i64(payload, "snapshot_count")?,
            required_i64(payload, "created_at")?,
            required_i64(payload, "updated_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting context_session: {error}"))?;
    Ok(())
}

async fn upsert_context_snapshot(conn: &Connection, payload: &Value) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO context_snapshots (
            device_id,
            user_id,
            activity_event_id,
            activity_event_uid,
            session_id,
            session_uid,
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
            capture_components_json,
            ax_richness_score,
            selected_text_present,
            document_path,
            ax_source,
            capture_trigger,
            trigger_to_snapshot_ms,
            ui_elements_json,
            dedup_key,
            is_sensitive_redacted,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dedup_key) DO UPDATE SET
            device_id = excluded.device_id,
            user_id = excluded.user_id,
            activity_event_id = excluded.activity_event_id,
            activity_event_uid = excluded.activity_event_uid,
            session_id = excluded.session_id,
            session_uid = excluded.session_uid,
            ts = excluded.ts,
            source_type = excluded.source_type,
            app_bundle_id = excluded.app_bundle_id,
            app_name = excluded.app_name,
            window_title = excluded.window_title,
            browser_url = excluded.browser_url,
            browser_domain = excluded.browser_domain,
            tab_title = excluded.tab_title,
            document_title = excluded.document_title,
            visible_text_raw = excluded.visible_text_raw,
            visible_text_norm = excluded.visible_text_norm,
            capture_quality = excluded.capture_quality,
            capture_components_json = excluded.capture_components_json,
            ax_richness_score = excluded.ax_richness_score,
            selected_text_present = excluded.selected_text_present,
            document_path = excluded.document_path,
            ax_source = excluded.ax_source,
            capture_trigger = excluded.capture_trigger,
            trigger_to_snapshot_ms = excluded.trigger_to_snapshot_ms,
            ui_elements_json = excluded.ui_elements_json,
            is_sensitive_redacted = excluded.is_sensitive_redacted,
            created_at = CASE
                WHEN context_snapshots.created_at <= 0 OR excluded.created_at < context_snapshots.created_at
                THEN excluded.created_at
                ELSE context_snapshots.created_at
            END,
            updated_at = CASE
                WHEN excluded.updated_at > context_snapshots.updated_at
                THEN excluded.updated_at
                ELSE context_snapshots.updated_at
            END
        "#,
        libsql::params![
            required_string(payload, "device_id")?,
            required_string(payload, "user_id")?,
            optional_i64(payload, "activity_event_id"),
            optional_string(payload, "activity_event_uid"),
            optional_i64(payload, "session_id"),
            optional_string(payload, "session_uid"),
            required_i64(payload, "ts")?,
            required_string(payload, "source_type")?,
            required_string(payload, "app_bundle_id")?,
            required_string(payload, "app_name")?,
            optional_string(payload, "window_title"),
            optional_string(payload, "browser_url"),
            optional_string(payload, "browser_domain"),
            optional_string(payload, "tab_title"),
            optional_string(payload, "document_title"),
            string_or_empty(payload, "visible_text_raw"),
            string_or_empty(payload, "visible_text_norm"),
            required_f64(payload, "capture_quality")?,
            optional_string(payload, "capture_components_json"),
            required_f64(payload, "ax_richness_score")?,
            bool_as_i64(payload.get("selected_text_present")),
            optional_string(payload, "document_path"),
            optional_string(payload, "ax_source"),
            optional_string(payload, "capture_trigger"),
            optional_i64(payload, "trigger_to_snapshot_ms"),
            optional_string(payload, "ui_elements_json"),
            required_string(payload, "dedup_key")?,
            bool_as_i64(payload.get("is_sensitive_redacted")),
            required_i64(payload, "created_at")?,
            required_i64(payload, "updated_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting context_snapshot: {error}"))?;
    Ok(())
}

async fn upsert_session_retrieval_doc(conn: &Connection, payload: &Value) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO session_retrieval_docs (
            session_id,
            session_uid,
            logical_chunk_id,
            device_id,
            user_id,
            source_kind,
            chunk_start_ts,
            chunk_end_ts,
            app_name,
            browser_domain,
            window_title,
            document_title,
            raw_visible_text,
            contextual_retrieval_text,
            capture_quality,
            context_version,
            session_position,
            session_count,
            embedded_at,
            provider_doc_id,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(logical_chunk_id) DO UPDATE SET
            session_id = excluded.session_id,
            session_uid = excluded.session_uid,
            device_id = excluded.device_id,
            user_id = excluded.user_id,
            source_kind = excluded.source_kind,
            chunk_start_ts = excluded.chunk_start_ts,
            chunk_end_ts = excluded.chunk_end_ts,
            app_name = excluded.app_name,
            browser_domain = excluded.browser_domain,
            window_title = excluded.window_title,
            document_title = excluded.document_title,
            raw_visible_text = excluded.raw_visible_text,
            contextual_retrieval_text = excluded.contextual_retrieval_text,
            capture_quality = excluded.capture_quality,
            context_version = excluded.context_version,
            session_position = excluded.session_position,
            session_count = excluded.session_count,
            embedded_at = COALESCE(excluded.embedded_at, session_retrieval_docs.embedded_at),
            provider_doc_id = COALESCE(excluded.provider_doc_id, session_retrieval_docs.provider_doc_id),
            created_at = CASE
                WHEN session_retrieval_docs.created_at <= 0 OR excluded.created_at < session_retrieval_docs.created_at
                THEN excluded.created_at
                ELSE session_retrieval_docs.created_at
            END,
            updated_at = CASE
                WHEN excluded.updated_at > session_retrieval_docs.updated_at
                THEN excluded.updated_at
                ELSE session_retrieval_docs.updated_at
            END
        "#,
        libsql::params![
            required_i64(payload, "session_id")?,
            required_string(payload, "session_uid")?,
            required_string(payload, "logical_chunk_id")?,
            required_string(payload, "device_id")?,
            required_string(payload, "user_id")?,
            required_string(payload, "source_kind")?,
            required_i64(payload, "chunk_start_ts")?,
            required_i64(payload, "chunk_end_ts")?,
            optional_string(payload, "app_name"),
            optional_string(payload, "browser_domain"),
            optional_string(payload, "window_title"),
            optional_string(payload, "document_title"),
            required_string(payload, "raw_visible_text")?,
            required_string(payload, "contextual_retrieval_text")?,
            required_f64(payload, "capture_quality")?,
            required_i64(payload, "context_version")?,
            required_i64(payload, "session_position")?,
            required_i64(payload, "session_count")?,
            optional_i64(payload, "embedded_at"),
            optional_string(payload, "provider_doc_id"),
            required_i64(payload, "created_at")?,
            required_i64(payload, "updated_at")?,
        ],
    )
    .await
    .map_err(|error| format!("Failed upserting session_retrieval_doc: {error}"))?;
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
