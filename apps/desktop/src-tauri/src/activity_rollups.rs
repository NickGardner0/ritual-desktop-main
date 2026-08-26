use chrono::{Datelike, Local, NaiveDate, TimeZone, Utc};
use libsql::{Connection, TransactionBehavior};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Runtime};

use crate::watcher_activity::{
    build_app_summaries, build_domain_summaries, clip_interval, merge_intervals,
};

pub const ACTIVITY_ROLLUP_SOURCE_VERSION: &str = "computer_activity_rollup_v1";
const MAX_DIRTY_DAYS_PER_PASS: i64 = 512;
static MATERIALIZE_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivityAppRollupSummary {
    #[serde(rename = "bundle_id", alias = "app_bundle_id")]
    pub app_bundle_id: String,
    #[serde(rename = "name", alias = "app_name")]
    pub app_name: String,
    pub active_ms: i64,
    pub events_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivityDomainRollupSummary {
    pub domain: String,
    pub active_ms: i64,
    pub events_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivityDailyRollup {
    pub rollup_uid: String,
    pub user_id: String,
    pub device_id: String,
    pub date: String,
    pub total_active_ms: i64,
    pub total_afk_ms: i64,
    pub events_count: i64,
    pub active_intervals_json: String,
    pub afk_intervals_json: String,
    pub app_summaries_json: String,
    pub domain_summaries_json: String,
    pub source_event_watermark: i64,
    pub source_version: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityRollupMaterializationProgress {
    pub materialized_days: u64,
    pub pending_rollups: u64,
    pub queued_rollups: u64,
    pub pending_dirty_days: u64,
    pub pending_raw_rows: u64,
    pub local_watermark_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalComputerSummary {
    pub total_active_ms: i64,
    pub total_afk_ms: i64,
    pub total_hours: f64,
    pub total_events: i64,
    pub days_tracked: i64,
    pub unique_apps: i64,
    pub unique_domains: i64,
    pub avg_daily_hours: f64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalComputerDailyRow {
    pub day: String,
    pub active_hours: f64,
    pub active_ms: i64,
    pub afk_ms: i64,
    pub events_count: i64,
    pub apps_count: i64,
    pub domains_count: i64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalComputerAppRow {
    pub app_bundle_id: String,
    pub app_name: String,
    pub total_active_ms: i64,
    pub total_events: i64,
    pub days_used: i64,
    pub hours: f64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalComputerDomainRow {
    pub domain: String,
    pub total_active_ms: i64,
    pub total_events: i64,
    pub days_used: i64,
    pub hours: f64,
    pub minutes: f64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalComputerActivitySnapshot {
    pub summary: LocalComputerSummary,
    pub daily: Vec<LocalComputerDailyRow>,
    pub apps: Vec<LocalComputerAppRow>,
    pub domains: Vec<LocalComputerDomainRow>,
    pub source: String,
    pub state: String,
    pub scope: String,
    pub last_synced_at: Option<i64>,
    pub sync_pending: bool,
    pub empty_reason: Option<String>,
    pub pending_rollups: u64,
    pub local_watermark_ms: Option<i64>,
}

#[derive(Debug, Clone)]
struct DirtyDay {
    user_id: String,
    device_id: String,
    date: String,
    source_event_watermark: i64,
}

#[derive(Debug, Clone)]
struct CachedRollup {
    date: String,
    active_intervals_json: String,
    afk_intervals_json: String,
    events_count: i64,
    app_summaries_json: String,
    domain_summaries_json: String,
    updated_at: i64,
    origin: String,
    sync_status: String,
}

fn day_bounds(date: &str) -> Result<(i64, i64), String> {
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| format!("Invalid rollup date: {date}"))?;
    let next_day = day
        .succ_opt()
        .ok_or_else(|| format!("Rollup date is out of range: {date}"))?;
    let start = Local
        .with_ymd_and_hms(day.year(), day.month(), day.day(), 0, 0, 0)
        .earliest()
        .ok_or_else(|| format!("Unable to resolve local midnight for {date}"))?;
    let end = Local
        .with_ymd_and_hms(next_day.year(), next_day.month(), next_day.day(), 0, 0, 0)
        .earliest()
        .ok_or_else(|| format!("Unable to resolve next local midnight for {date}"))?;
    Ok((start.timestamp_millis(), end.timestamp_millis()))
}

fn rollup_uid(user_id: &str, device_id: &str, date: &str) -> String {
    let digest = Sha256::digest(
        format!("{ACTIVITY_ROLLUP_SOURCE_VERSION}:{user_id}:{device_id}:{date}").as_bytes(),
    );
    format!("activity_rollup_{digest:x}")
}

fn sum_intervals(intervals: &[(i64, i64)]) -> i64 {
    intervals
        .iter()
        .map(|(start, end)| end.saturating_sub(*start))
        .sum()
}

fn parse_intervals(value: &str) -> Vec<(i64, i64)> {
    serde_json::from_str::<Vec<(i64, i64)>>(value).unwrap_or_default()
}

fn active_identity() -> Result<(String, String), String> {
    let config = crate::watcher::get_saved_watcher_config()
        .ok_or_else(|| "Watcher configuration is not available".to_string())?;
    let user_id = config.user_id.trim().to_string();
    let device_id = config.device_id.trim().to_string();
    if user_id.is_empty() || device_id.is_empty() {
        return Err("Watcher user/device identity is not configured".to_string());
    }
    Ok((user_id, device_id))
}

async fn read_afk_intervals(
    conn: &Connection,
    user_id: &str,
    device_id: &str,
    start_ms: i64,
    end_ms: i64,
) -> Result<(Vec<(i64, i64)>, i64, i64), String> {
    let mut rows = conn
        .query(
            r#"
            SELECT ts_start, ts_end
            FROM afk_events
            WHERE user_id = ? AND device_id = ?
              AND ts_start < ? AND ts_end > ?
              AND LOWER(COALESCE(status, 'afk')) = 'afk'
            ORDER BY ts_start ASC
            "#,
            libsql::params![user_id, device_id, end_ms, start_ms],
        )
        .await
        .map_err(|error| format!("Failed reading AFK intervals: {error}"))?;
    let mut intervals = Vec::new();
    let mut count = 0_i64;
    let mut watermark = 0_i64;
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed iterating AFK intervals: {error}"))?
    {
        let start = row.get::<i64>(0).unwrap_or(0).max(start_ms);
        let raw_end = row.get::<i64>(1).unwrap_or(0);
        let end = raw_end.min(end_ms);
        if end > start {
            intervals.push((start, end));
            count += 1;
            watermark = watermark.max(raw_end);
        }
    }
    Ok((intervals, count, watermark))
}

async fn materialize_day(
    db: &ritual_db::RitualDatabase,
    dirty: &DirtyDay,
) -> Result<ActivityDailyRollup, String> {
    let (start_ms, end_ms) = day_bounds(&dirty.date)?;
    let events = db
        .get_events_in_range(&dirty.device_id, start_ms, end_ms)
        .await
        .map_err(|error| format!("Failed reading activity events for {}: {error}", dirty.date))?
        .into_iter()
        .filter(|event| event.user_id == dirty.user_id)
        .collect::<Vec<_>>();

    let mut active_intervals = Vec::new();
    let mut afk_intervals = Vec::new();
    let mut source_event_watermark = dirty.source_event_watermark;
    for event in &events {
        source_event_watermark = source_event_watermark.max(event.ts_end);
        let Some(interval) = clip_interval(event, start_ms, end_ms) else {
            continue;
        };
        if event.is_afk {
            afk_intervals.push(interval);
        } else {
            active_intervals.push(interval);
        }
    }

    let conn = db.connection().await;
    let (separate_afk_intervals, separate_afk_count, afk_watermark) =
        read_afk_intervals(&conn, &dirty.user_id, &dirty.device_id, start_ms, end_ms).await?;
    drop(conn);
    afk_intervals.extend(separate_afk_intervals);
    source_event_watermark = source_event_watermark.max(afk_watermark);

    let active_intervals = merge_intervals(active_intervals);
    let afk_intervals = merge_intervals(afk_intervals);
    let app_summaries = build_app_summaries(&events, start_ms, end_ms)
        .into_iter()
        .map(|summary| ActivityAppRollupSummary {
            app_bundle_id: summary.app_bundle_id,
            app_name: summary.app_name,
            active_ms: summary.total_duration_ms,
            events_count: summary.event_count,
        })
        .collect::<Vec<_>>();
    let domain_summaries = build_domain_summaries(&events, start_ms, end_ms)
        .into_iter()
        .map(|summary| ActivityDomainRollupSummary {
            domain: summary.domain,
            active_ms: summary.total_duration_ms,
            events_count: summary.event_count,
        })
        .collect::<Vec<_>>();
    let now = Utc::now().timestamp_millis();

    Ok(ActivityDailyRollup {
        rollup_uid: rollup_uid(&dirty.user_id, &dirty.device_id, &dirty.date),
        user_id: dirty.user_id.clone(),
        device_id: dirty.device_id.clone(),
        date: dirty.date.clone(),
        total_active_ms: sum_intervals(&active_intervals),
        total_afk_ms: sum_intervals(&afk_intervals),
        events_count: events.len() as i64 + separate_afk_count,
        active_intervals_json: serde_json::to_string(&active_intervals)
            .map_err(|error| format!("Failed serializing active intervals: {error}"))?,
        afk_intervals_json: serde_json::to_string(&afk_intervals)
            .map_err(|error| format!("Failed serializing AFK intervals: {error}"))?,
        app_summaries_json: serde_json::to_string(&app_summaries)
            .map_err(|error| format!("Failed serializing app summaries: {error}"))?,
        domain_summaries_json: serde_json::to_string(&domain_summaries)
            .map_err(|error| format!("Failed serializing domain summaries: {error}"))?,
        source_event_watermark,
        source_version: ACTIVITY_ROLLUP_SOURCE_VERSION.to_string(),
        created_at: now,
        updated_at: now,
    })
}

async fn persist_materialized_rollup(
    conn: &Connection,
    rollup: &ActivityDailyRollup,
) -> Result<(), String> {
    let payload_json = serde_json::to_string(rollup)
        .map_err(|error| format!("Failed serializing activity rollup payload: {error}"))?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .await
        .map_err(|error| format!("Failed opening rollup transaction: {error}"))?;
    tx.execute(
        r#"
        INSERT INTO daily_rollup_cache (
            date, device_id, user_id, total_active_ms, total_afk_ms, events_count,
            active_intervals_json, afk_intervals_json, app_summaries, domain_summaries,
            source_event_watermark, rollup_uid, source_version, sync_status, origin,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'local', ?, ?)
        ON CONFLICT(date, device_id) DO UPDATE SET
            user_id = excluded.user_id,
            total_active_ms = excluded.total_active_ms,
            total_afk_ms = excluded.total_afk_ms,
            events_count = excluded.events_count,
            active_intervals_json = excluded.active_intervals_json,
            afk_intervals_json = excluded.afk_intervals_json,
            app_summaries = excluded.app_summaries,
            domain_summaries = excluded.domain_summaries,
            source_event_watermark = excluded.source_event_watermark,
            rollup_uid = excluded.rollup_uid,
            source_version = excluded.source_version,
            sync_status = 'pending',
            origin = 'local',
            updated_at = excluded.updated_at
        "#,
        libsql::params![
            rollup.date.clone(),
            rollup.device_id.clone(),
            rollup.user_id.clone(),
            rollup.total_active_ms,
            rollup.total_afk_ms,
            rollup.events_count,
            rollup.active_intervals_json.clone(),
            rollup.afk_intervals_json.clone(),
            rollup.app_summaries_json.clone(),
            rollup.domain_summaries_json.clone(),
            rollup.source_event_watermark,
            rollup.rollup_uid.clone(),
            rollup.source_version.clone(),
            rollup.created_at,
            rollup.updated_at,
        ],
    )
    .await
    .map_err(|error| format!("Failed caching activity rollup: {error}"))?;
    tx.execute(
        r#"
        INSERT INTO cloud_sync_outbox (
            user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
            status, retry_count, next_retry_at, last_error, superseded_by_rollup_uid,
            created_at, updated_at
        ) VALUES (?, ?, 'activity_daily_rollup', ?, 'upsert', ?, 'pending', 0, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
            payload_json = excluded.payload_json,
            status = 'pending',
            retry_count = 0,
            next_retry_at = NULL,
            last_error = NULL,
            updated_at = excluded.updated_at
        "#,
        libsql::params![
            rollup.user_id.clone(),
            rollup.device_id.clone(),
            rollup.rollup_uid.clone(),
            payload_json,
            rollup.created_at,
            rollup.updated_at,
        ],
    )
    .await
    .map_err(|error| format!("Failed queuing activity rollup: {error}"))?;
    tx.execute(
        r#"
        DELETE FROM activity_rollup_dirty_days
        WHERE user_id = ? AND device_id = ? AND date = ?
          AND source_event_watermark <= ?
        "#,
        libsql::params![
            rollup.user_id.clone(),
            rollup.device_id.clone(),
            rollup.date.clone(),
            rollup.source_event_watermark,
        ],
    )
    .await
    .map_err(|error| format!("Failed acknowledging dirty activity day: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("Failed committing activity rollup: {error}"))
}

async fn read_dirty_days(
    conn: &Connection,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<DirtyDay>, String> {
    let mut rows = match (start_date, end_date) {
        (Some(start), Some(end)) => {
            conn.query(
                r#"
            SELECT user_id, device_id, date, source_event_watermark
            FROM activity_rollup_dirty_days
            WHERE date >= ? AND date <= ?
            ORDER BY date ASC, device_id ASC
            LIMIT ?
            "#,
                libsql::params![start, end, MAX_DIRTY_DAYS_PER_PASS],
            )
            .await
        }
        _ => {
            conn.query(
                r#"
            SELECT user_id, device_id, date, source_event_watermark
            FROM activity_rollup_dirty_days
            ORDER BY date ASC, device_id ASC
            LIMIT ?
            "#,
                libsql::params![MAX_DIRTY_DAYS_PER_PASS],
            )
            .await
        }
    }
    .map_err(|error| format!("Failed reading dirty activity days: {error}"))?;
    let mut dirty = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed iterating dirty activity days: {error}"))?
    {
        dirty.push(DirtyDay {
            user_id: row.get(0).unwrap_or_default(),
            device_id: row.get(1).unwrap_or_default(),
            date: row.get(2).unwrap_or_default(),
            source_event_watermark: row.get(3).unwrap_or(0),
        });
    }
    Ok(dirty)
}

async fn scalar_count(conn: &Connection, sql: &str) -> Result<u64, String> {
    let mut rows = conn
        .query(sql, ())
        .await
        .map_err(|error| format!("Failed reading rollup count: {error}"))?;
    Ok(rows
        .next()
        .await
        .map_err(|error| format!("Failed reading rollup count row: {error}"))?
        .and_then(|row| row.get::<i64>(0).ok())
        .unwrap_or(0)
        .max(0) as u64)
}

pub async fn read_pending_dirty_days(conn: &Connection) -> Result<u64, String> {
    scalar_count(conn, "SELECT COUNT(*) FROM activity_rollup_dirty_days").await
}

pub async fn read_rollup_backlog(conn: &Connection) -> Result<(u64, u64, Option<i64>), String> {
    let pending_rollups = scalar_count(
        conn,
        "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type = 'activity_daily_rollup' AND status IN ('pending','failed','uploading')",
    )
    .await?;
    let pending_raw_rows = scalar_count(
        conn,
        "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type IN ('activity_event','afk_event') AND status IN ('pending','failed','uploading')",
    )
    .await?;
    let mut rows = conn
        .query(
            "SELECT MAX(source_event_watermark) FROM daily_rollup_cache WHERE origin = 'local'",
            (),
        )
        .await
        .map_err(|error| format!("Failed reading local activity watermark: {error}"))?;
    let watermark = rows
        .next()
        .await
        .map_err(|error| format!("Failed reading local activity watermark row: {error}"))?
        .and_then(|row| row.get::<Option<i64>>(0).ok().flatten())
        .filter(|value| *value > 0);
    Ok((pending_rollups, pending_raw_rows, watermark))
}

pub async fn materialize_activity_rollups(
    start_date: Option<&str>,
    end_date: Option<&str>,
    budget: Duration,
) -> Result<ActivityRollupMaterializationProgress, String> {
    let _lock = MATERIALIZE_LOCK.lock().await;
    let started = Instant::now();
    let guard =
        crate::ritual_database::get_or_initialize_activity_db("activity_rollups:materialize")
            .await?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Activity database is not initialized".to_string())?;
    let conn = db.connection().await;
    let dirty_days = read_dirty_days(&conn, start_date, end_date).await?;
    drop(conn);

    let mut materialized_days = 0_u64;
    for dirty in dirty_days {
        if started.elapsed() >= budget {
            break;
        }
        let rollup = materialize_day(db, &dirty).await?;
        let conn = db.connection().await;
        persist_materialized_rollup(&conn, &rollup).await?;
        drop(conn);
        materialized_days += 1;
    }

    let conn = db.connection().await;
    let (queued_rollups, pending_raw_rows, local_watermark_ms) = read_rollup_backlog(&conn).await?;
    let pending_dirty_days = read_pending_dirty_days(&conn).await?;
    Ok(ActivityRollupMaterializationProgress {
        materialized_days,
        pending_rollups: queued_rollups.saturating_add(pending_dirty_days),
        queued_rollups,
        pending_dirty_days,
        pending_raw_rows,
        local_watermark_ms,
    })
}

async fn read_cached_rollups(
    conn: &Connection,
    user_id: &str,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<CachedRollup>, String> {
    let mut rows = conn
        .query(
            r#"
            SELECT date, active_intervals_json, afk_intervals_json,
                   events_count, app_summaries, domain_summaries,
                   updated_at, origin, sync_status
            FROM daily_rollup_cache
            WHERE user_id = ? AND date >= ? AND date <= ?
            ORDER BY date ASC, device_id ASC
            "#,
            libsql::params![user_id, start_date, end_date],
        )
        .await
        .map_err(|error| format!("Failed reading cached activity rollups: {error}"))?;
    let mut result = Vec::new();
    while let Some(row) = rows
        .next()
        .await
        .map_err(|error| format!("Failed iterating cached activity rollups: {error}"))?
    {
        result.push(CachedRollup {
            date: row.get(0).unwrap_or_default(),
            active_intervals_json: row.get(1).unwrap_or_else(|_| "[]".to_string()),
            afk_intervals_json: row.get(2).unwrap_or_else(|_| "[]".to_string()),
            events_count: row.get(3).unwrap_or(0),
            app_summaries_json: row.get(4).unwrap_or_else(|_| "[]".to_string()),
            domain_summaries_json: row.get(5).unwrap_or_else(|_| "[]".to_string()),
            updated_at: row.get(6).unwrap_or(0),
            origin: row.get(7).unwrap_or_else(|_| "local".to_string()),
            sync_status: row.get(8).unwrap_or_else(|_| "pending".to_string()),
        });
    }
    Ok(result)
}

fn parse_app_summaries(value: &str) -> Vec<ActivityAppRollupSummary> {
    serde_json::from_str(value).unwrap_or_default()
}

fn parse_domain_summaries(value: &str) -> Vec<ActivityDomainRollupSummary> {
    serde_json::from_str(value).unwrap_or_default()
}

fn build_local_snapshot(
    rollups: Vec<CachedRollup>,
    limit: usize,
    pending_rollups: u64,
    pending_dirty_days: u64,
    cloud_sync_enabled: bool,
    local_watermark_ms: Option<i64>,
) -> LocalComputerActivitySnapshot {
    struct DayBucket {
        active: Vec<(i64, i64)>,
        afk: Vec<(i64, i64)>,
        events: i64,
        apps: BTreeSet<String>,
        domains: BTreeSet<String>,
    }
    struct RankBucket {
        active_ms: i64,
        events: i64,
        days: BTreeSet<String>,
    }

    let mut days: BTreeMap<String, DayBucket> = BTreeMap::new();
    let mut apps: HashMap<(String, String), RankBucket> = HashMap::new();
    let mut domains: HashMap<String, RankBucket> = HashMap::new();
    let mut last_synced_at = None;
    let mut cloud_pending = cloud_sync_enabled && pending_rollups > pending_dirty_days;

    for rollup in &rollups {
        let day = days
            .entry(rollup.date.clone())
            .or_insert_with(|| DayBucket {
                active: Vec::new(),
                afk: Vec::new(),
                events: 0,
                apps: BTreeSet::new(),
                domains: BTreeSet::new(),
            });
        day.active
            .extend(parse_intervals(&rollup.active_intervals_json));
        day.afk.extend(parse_intervals(&rollup.afk_intervals_json));
        day.events += rollup.events_count.max(0);
        cloud_pending |=
            cloud_sync_enabled && rollup.origin == "local" && rollup.sync_status != "uploaded";
        if rollup.sync_status == "uploaded" || rollup.origin == "remote" {
            last_synced_at = Some(last_synced_at.unwrap_or(0).max(rollup.updated_at));
        }

        for summary in parse_app_summaries(&rollup.app_summaries_json) {
            day.apps.insert(summary.app_bundle_id.clone());
            let bucket = apps
                .entry((summary.app_bundle_id, summary.app_name))
                .or_insert_with(|| RankBucket {
                    active_ms: 0,
                    events: 0,
                    days: BTreeSet::new(),
                });
            bucket.active_ms += summary.active_ms.max(0);
            bucket.events += summary.events_count.max(0);
            bucket.days.insert(rollup.date.clone());
        }
        for summary in parse_domain_summaries(&rollup.domain_summaries_json) {
            let domain = summary.domain.trim().to_ascii_lowercase();
            if domain.is_empty() {
                continue;
            }
            day.domains.insert(domain.clone());
            let bucket = domains.entry(domain).or_insert_with(|| RankBucket {
                active_ms: 0,
                events: 0,
                days: BTreeSet::new(),
            });
            bucket.active_ms += summary.active_ms.max(0);
            bucket.events += summary.events_count.max(0);
            bucket.days.insert(rollup.date.clone());
        }
    }

    let daily = days
        .into_iter()
        .map(|(day, bucket)| {
            let active_ms = sum_intervals(&merge_intervals(bucket.active));
            let afk_ms = sum_intervals(&merge_intervals(bucket.afk));
            LocalComputerDailyRow {
                day,
                active_hours: active_ms as f64 / 3_600_000.0,
                active_ms,
                afk_ms,
                events_count: bucket.events,
                apps_count: bucket.apps.len() as i64,
                domains_count: bucket.domains.len() as i64,
                source: "local_rollups_v1".to_string(),
            }
        })
        .collect::<Vec<_>>();
    let total_active_ms = daily.iter().map(|row| row.active_ms).sum::<i64>();
    let total_afk_ms = daily.iter().map(|row| row.afk_ms).sum::<i64>();
    let total_events = daily.iter().map(|row| row.events_count).sum::<i64>();
    let days_tracked = daily.iter().filter(|row| row.active_ms > 0).count() as i64;
    let total_hours = total_active_ms as f64 / 3_600_000.0;

    let mut app_rows = apps.into_iter().collect::<Vec<_>>();
    app_rows.sort_by(|left, right| right.1.active_ms.cmp(&left.1.active_ms));
    let mut domain_rows = domains.into_iter().collect::<Vec<_>>();
    domain_rows.sort_by(|left, right| right.1.active_ms.cmp(&left.1.active_ms));
    let has_usable_data = total_active_ms > 0 || total_events > 0;
    // A bounded materialization pass can leave older dirty days behind. Keep the
    // valid local number visible, but advertise that it is still being completed
    // instead of presenting a partial all-time total as final.
    let materialization_pending = pending_dirty_days > 0;

    LocalComputerActivitySnapshot {
        summary: LocalComputerSummary {
            total_active_ms,
            total_afk_ms,
            total_hours,
            total_events,
            days_tracked,
            unique_apps: app_rows.len() as i64,
            unique_domains: domain_rows.len() as i64,
            avg_daily_hours: if days_tracked > 0 {
                total_hours / days_tracked as f64
            } else {
                0.0
            },
            source: "local_rollups_v1".to_string(),
        },
        daily,
        apps: app_rows
            .into_iter()
            .take(limit.max(1))
            .map(|((bundle_id, app_name), bucket)| LocalComputerAppRow {
                app_bundle_id: bundle_id,
                app_name,
                total_active_ms: bucket.active_ms,
                total_events: bucket.events,
                days_used: bucket.days.len() as i64,
                hours: bucket.active_ms as f64 / 3_600_000.0,
                source: "local_rollups_v1".to_string(),
            })
            .collect(),
        domains: domain_rows
            .into_iter()
            .take(limit.max(1))
            .map(|(domain, bucket)| LocalComputerDomainRow {
                domain,
                total_active_ms: bucket.active_ms,
                total_events: bucket.events,
                days_used: bucket.days.len() as i64,
                hours: bucket.active_ms as f64 / 3_600_000.0,
                minutes: bucket.active_ms as f64 / 60_000.0,
                source: "local_rollups_v1".to_string(),
            })
            .collect(),
        source: "local_rollups_v1".to_string(),
        state: if has_usable_data {
            "ready"
        } else if materialization_pending {
            "sync_pending"
        } else {
            "empty"
        }
        .to_string(),
        scope: if cloud_sync_enabled {
            "all_devices_local_replica"
        } else {
            "local_device"
        }
        .to_string(),
        last_synced_at,
        sync_pending: cloud_pending || materialization_pending,
        empty_reason: (!has_usable_data).then(|| {
            if materialization_pending {
                "local_rollup_materialization_pending".to_string()
            } else {
                "no_local_activity_rows".to_string()
            }
        }),
        pending_rollups: if cloud_sync_enabled {
            pending_rollups
        } else {
            pending_dirty_days
        },
        local_watermark_ms,
    }
}

#[tauri::command]
pub async fn get_local_computer_activity_snapshot<R: Runtime + 'static>(
    app: AppHandle<R>,
    start_date: String,
    end_date: String,
    limit: Option<usize>,
    origin: Option<String>,
) -> Result<LocalComputerActivitySnapshot, String> {
    let _ = origin;
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|_| "Invalid startDate".to_string())?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|_| "Invalid endDate".to_string())?;
    if end < start {
        return Err("endDate must be on or after startDate".to_string());
    }
    let (user_id, _) = active_identity()?;
    let progress = materialize_activity_rollups(
        Some(&start_date),
        Some(&end_date),
        Duration::from_millis(2_500),
    )
    .await?;
    let guard =
        crate::ritual_database::get_or_initialize_activity_db("activity_rollups:aggregate").await?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Activity database is not initialized".to_string())?;
    let conn = db.connection().await;
    let rollups = read_cached_rollups(&conn, &user_id, &start_date, &end_date).await?;
    let cloud_sync_enabled =
        crate::privacy_policy::plaintext_cloud_sync_allowed_for_app(&app).is_ok();
    Ok(build_local_snapshot(
        rollups,
        limit.unwrap_or(10).clamp(1, 100),
        progress.pending_rollups,
        progress.pending_dirty_days,
        cloud_sync_enabled,
        progress.local_watermark_ms,
    ))
}

pub async fn mark_rollup_uploaded(
    conn: &Connection,
    rollup_uid: &str,
    user_id: &str,
    device_id: &str,
    date: &str,
) -> Result<u64, String> {
    let (start_ms, end_ms) = day_bounds(date)?;
    let now = Utc::now().timestamp_millis();
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .await
        .map_err(|error| format!("Failed opening rollup acknowledgement transaction: {error}"))?;
    tx.execute(
        "UPDATE daily_rollup_cache SET sync_status = 'uploaded', updated_at = MAX(updated_at, ?) WHERE rollup_uid = ? AND origin = 'local'",
        libsql::params![now, rollup_uid],
    )
    .await
    .map_err(|error| format!("Failed acknowledging local rollup: {error}"))?;
    tx.execute(
        r#"
        UPDATE cloud_sync_outbox
        SET status = 'uploaded', last_error = NULL, next_retry_at = NULL, updated_at = ?
        WHERE entity_type = 'activity_daily_rollup' AND entity_uid = ?
        "#,
        libsql::params![now, rollup_uid],
    )
    .await
    .map_err(|error| format!("Failed acknowledging rollup outbox row: {error}"))?;
    let superseded = tx
        .execute(
            r#"
            UPDATE cloud_sync_outbox
            SET status = 'superseded',
                superseded_by_rollup_uid = ?,
                next_retry_at = NULL,
                last_error = 'superseded_by_activity_rollup',
                updated_at = ?
            WHERE user_id = ? AND device_id = ?
              AND entity_type IN ('activity_event', 'afk_event')
              AND status IN ('pending', 'failed', 'uploading')
              AND CAST(COALESCE(json_extract(payload_json, '$.ts_start'), 0) AS INTEGER) < ?
              AND CAST(COALESCE(
                    json_extract(payload_json, '$.ts_end'),
                    json_extract(payload_json, '$.ts_start'),
                    0
                  ) AS INTEGER) > ?
              AND NOT EXISTS (
                WITH RECURSIVE affected(day, last_day) AS (
                    SELECT
                        date(
                            CAST(COALESCE(json_extract(cloud_sync_outbox.payload_json, '$.ts_start'), 0) AS INTEGER) / 1000,
                            'unixepoch',
                            'localtime'
                        ),
                        date(
                            MAX(
                                CAST(COALESCE(json_extract(cloud_sync_outbox.payload_json, '$.ts_start'), 0) AS INTEGER),
                                CAST(COALESCE(
                                    json_extract(cloud_sync_outbox.payload_json, '$.ts_end'),
                                    json_extract(cloud_sync_outbox.payload_json, '$.ts_start'),
                                    0
                                ) AS INTEGER) - 1
                            ) / 1000,
                            'unixepoch',
                            'localtime'
                        )
                    UNION ALL
                    SELECT date(day, '+1 day'), last_day
                    FROM affected
                    WHERE day < last_day
                )
                SELECT 1
                FROM affected
                LEFT JOIN daily_rollup_cache AS acknowledged
                  ON acknowledged.user_id = cloud_sync_outbox.user_id
                 AND acknowledged.device_id = cloud_sync_outbox.device_id
                 AND acknowledged.date = affected.day
                 AND acknowledged.origin = 'local'
                WHERE acknowledged.rollup_uid IS NULL
                   OR acknowledged.sync_status != 'uploaded'
              )
            "#,
            libsql::params![rollup_uid, now, user_id, device_id, end_ms, start_ms],
        )
        .await
        .map_err(|error| format!("Failed superseding raw activity outbox rows: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("Failed committing rollup acknowledgement: {error}"))?;
    Ok(superseded)
}

pub async fn upsert_remote_rollup_cache(
    conn: &Connection,
    rollup: &ActivityDailyRollup,
    current_device_id: &str,
) -> Result<bool, String> {
    if rollup.device_id == current_device_id {
        let mut rows = conn
            .query(
                "SELECT source_event_watermark, updated_at, origin FROM daily_rollup_cache WHERE date = ? AND device_id = ?",
                libsql::params![rollup.date.clone(), rollup.device_id.clone()],
            )
            .await
            .map_err(|error| format!("Failed checking local rollup freshness: {error}"))?;
        if let Some(row) = rows
            .next()
            .await
            .map_err(|error| format!("Failed reading local rollup freshness: {error}"))?
        {
            let watermark = row.get::<i64>(0).unwrap_or(0);
            let updated_at = row.get::<i64>(1).unwrap_or(0);
            let origin = row.get::<String>(2).unwrap_or_default();
            if origin == "local"
                && (watermark >= rollup.source_event_watermark || updated_at > rollup.updated_at)
            {
                return Ok(false);
            }
        }
    }

    conn.execute(
        r#"
        INSERT INTO daily_rollup_cache (
            date, device_id, user_id, total_active_ms, total_afk_ms, events_count,
            active_intervals_json, afk_intervals_json, app_summaries, domain_summaries,
            source_event_watermark, rollup_uid, source_version, sync_status, origin,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', 'remote', ?, ?)
        ON CONFLICT(date, device_id) DO UPDATE SET
            user_id = excluded.user_id,
            total_active_ms = excluded.total_active_ms,
            total_afk_ms = excluded.total_afk_ms,
            events_count = excluded.events_count,
            active_intervals_json = excluded.active_intervals_json,
            afk_intervals_json = excluded.afk_intervals_json,
            app_summaries = excluded.app_summaries,
            domain_summaries = excluded.domain_summaries,
            source_event_watermark = excluded.source_event_watermark,
            rollup_uid = excluded.rollup_uid,
            source_version = excluded.source_version,
            sync_status = 'uploaded',
            origin = 'remote',
            updated_at = excluded.updated_at
        WHERE daily_rollup_cache.origin != 'local'
           OR daily_rollup_cache.source_event_watermark <= excluded.source_event_watermark
        "#,
        libsql::params![
            rollup.date.clone(),
            rollup.device_id.clone(),
            rollup.user_id.clone(),
            rollup.total_active_ms,
            rollup.total_afk_ms,
            rollup.events_count,
            rollup.active_intervals_json.clone(),
            rollup.afk_intervals_json.clone(),
            rollup.app_summaries_json.clone(),
            rollup.domain_summaries_json.clone(),
            rollup.source_event_watermark,
            rollup.rollup_uid.clone(),
            rollup.source_version.clone(),
            rollup.created_at,
            rollup.updated_at,
        ],
    )
    .await
    .map_err(|error| format!("Failed caching remote activity rollup: {error}"))?;
    Ok(true)
}

pub async fn read_remote_cursor(conn: &Connection, user_id: &str) -> Result<(i64, String), String> {
    let mut rows = conn
        .query(
            "SELECT updated_at, rollup_uid FROM activity_rollup_remote_cursor WHERE user_id = ?",
            libsql::params![user_id],
        )
        .await
        .map_err(|error| format!("Failed reading activity rollup cursor: {error}"))?;
    Ok(rows
        .next()
        .await
        .map_err(|error| format!("Failed reading activity rollup cursor row: {error}"))?
        .map(|row| {
            (
                row.get::<i64>(0).unwrap_or(0),
                row.get::<String>(1).unwrap_or_default(),
            )
        })
        .unwrap_or((0, String::new())))
}

pub async fn write_remote_cursor(
    conn: &Connection,
    user_id: &str,
    updated_at: i64,
    rollup_uid: &str,
) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO activity_rollup_remote_cursor (user_id, updated_at, rollup_uid, refreshed_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            updated_at = excluded.updated_at,
            rollup_uid = excluded.rollup_uid,
            refreshed_at = excluded.refreshed_at
        "#,
        libsql::params![
            user_id,
            updated_at,
            rollup_uid,
            Utc::now().timestamp_millis()
        ],
    )
    .await
    .map_err(|error| format!("Failed writing activity rollup cursor: {error}"))?;
    Ok(())
}

pub fn activity_rollup_from_json(payload_json: &str) -> Result<ActivityDailyRollup, String> {
    let value: Value = serde_json::from_str(payload_json)
        .map_err(|error| format!("Invalid activity rollup payload: {error}"))?;
    for forbidden in [
        "window_title",
        "window_title_hash",
        "browser_url",
        "ocr_text",
        "screenshot",
    ] {
        if value.get(forbidden).is_some() {
            return Err(format!(
                "Activity rollup contains forbidden field '{forbidden}'"
            ));
        }
    }
    let mut rollup: ActivityDailyRollup = serde_json::from_value(value)
        .map_err(|error| format!("Invalid activity rollup payload shape: {error}"))?;
    let active_intervals = serde_json::from_str::<Vec<(i64, i64)>>(&rollup.active_intervals_json)
        .map_err(|error| format!("Invalid active rollup intervals: {error}"))?;
    let afk_intervals = serde_json::from_str::<Vec<(i64, i64)>>(&rollup.afk_intervals_json)
        .map_err(|error| format!("Invalid AFK rollup intervals: {error}"))?;
    if active_intervals
        .iter()
        .chain(afk_intervals.iter())
        .any(|(start, end)| end <= start)
    {
        return Err("Activity rollup contains an invalid interval".to_string());
    }
    let app_summaries =
        serde_json::from_str::<Vec<ActivityAppRollupSummary>>(&rollup.app_summaries_json)
            .map_err(|error| format!("Invalid activity app summaries: {error}"))?;
    let mut domain_summaries =
        serde_json::from_str::<Vec<ActivityDomainRollupSummary>>(&rollup.domain_summaries_json)
            .map_err(|error| format!("Invalid activity domain summaries: {error}"))?;
    for summary in &mut domain_summaries {
        let domain = summary.domain.trim().to_ascii_lowercase();
        if domain.is_empty()
            || domain.len() > 253
            || domain
                .chars()
                .any(|character| character.is_whitespace() || "/?#@".contains(character))
        {
            return Err("Activity rollup contains a non-domain website value".to_string());
        }
        summary.domain = domain;
    }
    rollup.active_intervals_json = serde_json::to_string(&active_intervals)
        .map_err(|error| format!("Failed canonicalizing active intervals: {error}"))?;
    rollup.afk_intervals_json = serde_json::to_string(&afk_intervals)
        .map_err(|error| format!("Failed canonicalizing AFK intervals: {error}"))?;
    rollup.app_summaries_json = serde_json::to_string(&app_summaries)
        .map_err(|error| format!("Failed canonicalizing app summaries: {error}"))?;
    rollup.domain_summaries_json = serde_json::to_string(&domain_summaries)
        .map_err(|error| format!("Failed canonicalizing domain summaries: {error}"))?;
    Ok(rollup)
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_DB_LOCK: Lazy<tokio::sync::Mutex<()>> = Lazy::new(|| tokio::sync::Mutex::new(()));

    #[test]
    fn rollup_uid_is_idempotent() {
        assert_eq!(
            rollup_uid("user", "device", "2026-08-25"),
            rollup_uid("user", "device", "2026-08-25")
        );
    }

    #[test]
    fn interval_union_deoverlaps_devices() {
        let merged = merge_intervals(vec![(0, 10), (5, 20), (30, 40)]);
        assert_eq!(sum_intervals(&merged), 30);
    }

    #[test]
    fn hundred_thousand_interval_union_stays_within_all_time_budget() {
        let intervals = (0..100_000_i64)
            .map(|index| (index * 10, index * 10 + 15))
            .collect::<Vec<_>>();
        let started = Instant::now();
        let merged = merge_intervals(intervals);
        assert_eq!(merged, vec![(0, 1_000_005)]);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn rollup_payload_rejects_raw_titles() {
        assert!(activity_rollup_from_json(r#"{"window_title":"secret"}"#).is_err());
    }

    #[test]
    fn rollup_payload_rejects_nested_raw_fields_and_full_urls() {
        let base = ActivityDailyRollup {
            rollup_uid: "rollup".to_string(),
            user_id: "user".to_string(),
            device_id: "device".to_string(),
            date: "2026-08-25".to_string(),
            total_active_ms: 1,
            total_afk_ms: 0,
            events_count: 1,
            active_intervals_json: "[[1,2]]".to_string(),
            afk_intervals_json: "[]".to_string(),
            app_summaries_json: r#"[{"bundle_id":"app","name":"App","active_ms":1,"events_count":1,"window_title":"secret"}]"#.to_string(),
            domain_summaries_json: "[]".to_string(),
            source_event_watermark: 2,
            source_version: ACTIVITY_ROLLUP_SOURCE_VERSION.to_string(),
            created_at: 1,
            updated_at: 2,
        };
        assert!(activity_rollup_from_json(&serde_json::to_string(&base).unwrap()).is_err());

        let mut url = base;
        url.app_summaries_json = "[]".to_string();
        url.domain_summaries_json =
            r#"[{"domain":"https://example.com/private","active_ms":1,"events_count":1}]"#
                .to_string();
        assert!(activity_rollup_from_json(&serde_json::to_string(&url).unwrap()).is_err());
    }

    #[tokio::test]
    #[ignore = "requires an isolated libsql process before rusqlite initializes SQLite"]
    async fn cross_day_raw_row_waits_for_every_rollup_acknowledgement() {
        let _test_db_guard = TEST_DB_LOCK.lock().await;
        let temp = tempfile::tempdir().expect("temp directory");
        let config = ritual_db::DatabaseConfig::for_testing(temp.path());
        let db = ritual_db::RitualDatabase::open(&config)
            .await
            .expect("test database");
        let conn = db.connection().await;
        let start = Local
            .with_ymd_and_hms(2026, 8, 24, 23, 55, 0)
            .single()
            .expect("start time")
            .timestamp_millis();
        let end = Local
            .with_ymd_and_hms(2026, 8, 25, 0, 5, 0)
            .single()
            .expect("end time")
            .timestamp_millis();

        for (date, uid) in [
            ("2026-08-24", "rollup-first"),
            ("2026-08-25", "rollup-second"),
        ] {
            conn.execute(
                r#"
                INSERT INTO daily_rollup_cache (
                    date, device_id, user_id, rollup_uid, sync_status, origin, updated_at
                ) VALUES (?, 'device', 'user', ?, 'pending', 'local', 1)
                "#,
                libsql::params![date, uid],
            )
            .await
            .expect("insert rollup");
        }
        conn.execute(
            r#"
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, created_at, updated_at
            ) VALUES ('user', 'device', 'activity_event', 'raw-cross-day', 'upsert', ?, 'pending', 1, 1)
            "#,
            libsql::params![serde_json::json!({
                "ts_start": start,
                "ts_end": end,
            })
            .to_string()],
        )
        .await
        .expect("insert raw outbox row");

        assert_eq!(
            mark_rollup_uploaded(&conn, "rollup-first", "user", "device", "2026-08-24")
                .await
                .expect("first acknowledgement"),
            0
        );
        assert_eq!(
            mark_rollup_uploaded(&conn, "rollup-second", "user", "device", "2026-08-25")
                .await
                .expect("second acknowledgement"),
            1
        );

        let mut rows = conn
            .query(
                "SELECT status, superseded_by_rollup_uid FROM cloud_sync_outbox WHERE entity_uid = 'raw-cross-day'",
                (),
            )
            .await
            .expect("query raw row");
        let row = rows
            .next()
            .await
            .expect("read raw row")
            .expect("raw row exists");
        assert_eq!(row.get::<String>(0).unwrap(), "superseded");
        assert_eq!(row.get::<String>(1).unwrap(), "rollup-second");
    }

    #[tokio::test]
    #[ignore = "requires an isolated libsql process before rusqlite initializes SQLite"]
    async fn equal_watermark_remote_copy_never_replaces_current_device_local_rollup() {
        let _test_db_guard = TEST_DB_LOCK.lock().await;
        let temp = tempfile::tempdir().expect("temp directory");
        let config = ritual_db::DatabaseConfig::for_testing(temp.path());
        let db = ritual_db::RitualDatabase::open(&config)
            .await
            .expect("test database");
        let conn = db.connection().await;
        conn.execute(
            r#"
            INSERT INTO daily_rollup_cache (
                date, device_id, user_id, rollup_uid, source_event_watermark,
                sync_status, origin, updated_at
            ) VALUES ('2026-08-25', 'device', 'user', 'local-rollup', 100, 'pending', 'local', 10)
            "#,
            (),
        )
        .await
        .expect("insert local rollup");
        let remote = ActivityDailyRollup {
            rollup_uid: "remote-rollup".to_string(),
            user_id: "user".to_string(),
            device_id: "device".to_string(),
            date: "2026-08-25".to_string(),
            total_active_ms: 1,
            total_afk_ms: 0,
            events_count: 1,
            active_intervals_json: "[]".to_string(),
            afk_intervals_json: "[]".to_string(),
            app_summaries_json: "[]".to_string(),
            domain_summaries_json: "[]".to_string(),
            source_event_watermark: 100,
            source_version: ACTIVITY_ROLLUP_SOURCE_VERSION.to_string(),
            created_at: 10,
            updated_at: 20,
        };

        assert!(!upsert_remote_rollup_cache(&conn, &remote, "device")
            .await
            .expect("upsert decision"));
        let mut rows = conn
            .query(
                "SELECT rollup_uid, origin FROM daily_rollup_cache WHERE date = '2026-08-25' AND device_id = 'device'",
                (),
            )
            .await
            .expect("query local rollup");
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "local-rollup");
        assert_eq!(row.get::<String>(1).unwrap(), "local");
    }

    #[tokio::test]
    #[ignore = "requires an isolated libsql process before rusqlite initializes SQLite"]
    async fn thirty_thousand_legacy_rows_supersede_only_after_rollup_ack() {
        let _test_db_guard = TEST_DB_LOCK.lock().await;
        let temp = tempfile::tempdir().expect("temp directory");
        let config = ritual_db::DatabaseConfig::for_testing(temp.path());
        let db = ritual_db::RitualDatabase::open(&config)
            .await
            .expect("test database");
        let conn = db.connection().await;
        let (day_start, day_end) = day_bounds("2026-08-25").expect("day bounds");
        conn.execute(
            r#"
            INSERT INTO daily_rollup_cache (
                date, device_id, user_id, rollup_uid, source_event_watermark,
                sync_status, origin, updated_at
            ) VALUES ('2026-08-25', 'device', 'user', 'load-rollup', ?, 'pending', 'local', 1)
            "#,
            libsql::params![day_end - 1],
        )
        .await
        .expect("insert load rollup");
        conn.execute(
            r#"
            WITH digits(value) AS (
                VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)
            ), numbers(value) AS (
                SELECT a.value + 10*b.value + 100*c.value + 1000*d.value + 10000*e.value
                FROM digits a, digits b, digits c, digits d, digits e
            )
            INSERT INTO cloud_sync_outbox (
                user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                status, created_at, updated_at
            )
            SELECT
                'user',
                'device',
                'activity_event',
                printf('raw-load-%d', value),
                'upsert',
                json_object('ts_start', ?, 'ts_end', ?),
                'pending',
                1,
                1
            FROM numbers
            WHERE value < 30000
            "#,
            libsql::params![day_start + 1_000, day_start + 2_000],
        )
        .await
        .expect("insert legacy backlog");

        let started = Instant::now();
        assert_eq!(
            mark_rollup_uploaded(&conn, "load-rollup", "user", "device", "2026-08-25")
                .await
                .expect("acknowledge load rollup"),
            30_000
        );
        assert!(started.elapsed() < Duration::from_secs(10));
        let mut rows = conn
            .query(
                "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type = 'activity_event' AND status = 'superseded'",
                (),
            )
            .await
            .expect("query superseded backlog");
        assert_eq!(
            rows.next().await.unwrap().unwrap().get::<i64>(0).unwrap(),
            30_000
        );
    }
}
