//! Ritual Database Integration
//!
//! This module provides access to the unified libSQL database.
//! It wraps ritual-db and provides Tauri commands for:
//! - Database statistics
//! - Migration status
//! - Cloud-memory upload outbox management
//!
//! The existing rusqlite code continues to work alongside this for backward compatibility.

use chrono::Utc;
use once_cell::sync::Lazy;
use rusqlite::{Connection as SqliteConnection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

use ritual_db::{blocking::BlockingDatabase, DatabaseConfig, RitualDatabase};

macro_rules! db_info {
    ($($arg:tt)*) => {
        log::info!("[DB] {}", format!($($arg)*))
    };
}

macro_rules! db_error {
    ($($arg:tt)*) => {
        log::error!("[DB] {}", format!($($arg)*))
    };
}

/// Global database instance (lazy initialized)
pub(crate) static RITUAL_DB: Lazy<Arc<RwLock<Option<RitualDatabase>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

/// Activity database instance (watcher events + sync queue).
pub(crate) static ACTIVITY_DB: Lazy<Arc<RwLock<Option<RitualDatabase>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

/// Tokio runtime for async operations
pub(crate) static RUNTIME: Lazy<tokio::runtime::Runtime> = Lazy::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("Failed to create tokio runtime")
});

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseConnectionState {
    Uninitialized,
    ReadyLocal,
    ReadyReplica,
    DegradedLocal,
    FailedTransient,
    Reloading,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseHandleRuntimeState {
    pub status: DatabaseConnectionState,
    pub db_path: String,
    pub last_error: Option<String>,
    pub replica_fail_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRuntimeStateSnapshot {
    pub memory: DatabaseHandleRuntimeState,
    pub activity: DatabaseHandleRuntimeState,
    pub turso_sync_configured: bool,
    pub turso_circuit_breaker_active: bool,
    pub activity_db_reloads: u64,
    pub replica_failures: u64,
    pub circuit_breaker_trips: u64,
}

#[derive(Debug, Clone)]
struct ActiveIdentity {
    user_id: String,
    device_id: String,
}

fn resolve_active_identity() -> Option<ActiveIdentity> {
    if let Some(config) = crate::watcher::get_saved_watcher_config() {
        let user_id = config.user_id.trim();
        let device_id = config.device_id.trim();
        if !user_id.is_empty() && !device_id.is_empty() {
            return Some(ActiveIdentity {
                user_id: user_id.to_string(),
                device_id: device_id.to_string(),
            });
        }
    }

    if let Some(config) = crate::recorder::read_recorder_config() {
        let user_id = config.user_id.trim();
        let device_id = config.device_id.trim();
        if !user_id.is_empty() && !device_id.is_empty() {
            return Some(ActiveIdentity {
                user_id: user_id.to_string(),
                device_id: device_id.to_string(),
            });
        }
    }

    None
}
/// Get the ritual database directory
fn get_ritual_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual")
    } else {
        PathBuf::from("./.ritual")
    }
}

fn get_memory_db_path() -> PathBuf {
    get_ritual_dir().join("memory.db")
}

fn get_activity_db_path() -> PathBuf {
    get_ritual_dir().join("activity.db")
}

fn normalize_db_command_origin(origin: Option<&str>, fallback: &str) -> String {
    origin
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn log_db_command(command: &str, origin: &str, details: &str) {
    if details.is_empty() {
        db_info!("📥 command={} origin={}", command, origin);
    } else {
        db_info!("📥 command={} origin={} {}", command, origin, details);
    }
}

impl Default for DatabaseRuntimeStateSnapshot {
    fn default() -> Self {
        Self {
            memory: DatabaseHandleRuntimeState {
                status: DatabaseConnectionState::Uninitialized,
                db_path: get_memory_db_path().display().to_string(),
                last_error: None,
                replica_fail_reason: None,
            },
            activity: DatabaseHandleRuntimeState {
                status: DatabaseConnectionState::Uninitialized,
                db_path: get_activity_db_path().display().to_string(),
                last_error: None,
                replica_fail_reason: None,
            },
            turso_sync_configured: false,
            turso_circuit_breaker_active: false,
            activity_db_reloads: 0,
            replica_failures: 0,
            circuit_breaker_trips: 0,
        }
    }
}

static DB_RUNTIME_STATE: Lazy<Mutex<DatabaseRuntimeStateSnapshot>> =
    Lazy::new(|| Mutex::new(DatabaseRuntimeStateSnapshot::default()));

fn turso_sync_env_configured() -> bool {
    std::env::var("TURSO_SYNC_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .is_some()
        && std::env::var("TURSO_AUTH_TOKEN")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .is_some()
}

fn mutate_runtime_state<F>(mutator: F)
where
    F: FnOnce(&mut DatabaseRuntimeStateSnapshot),
{
    let mut guard = DB_RUNTIME_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let previous = guard.clone();
    mutator(&mut guard);
    let current = guard.clone();
    drop(guard);

    if previous.memory != current.memory {
        db_info!(
            "🧠 memory.db state -> {:?} error={:?}",
            current.memory.status,
            current.memory.last_error
        );
    }

    if previous.activity != current.activity {
        db_info!(
            "📓 activity.db state -> {:?} error={:?} replica_fail_reason={:?}",
            current.activity.status,
            current.activity.last_error,
            current.activity.replica_fail_reason
        );
    }

    if previous.turso_circuit_breaker_active != current.turso_circuit_breaker_active {
        db_info!(
            "🛑 activity.db Turso circuit breaker -> active={} reason={:?}",
            current.turso_circuit_breaker_active,
            current.activity.replica_fail_reason
        );
    }
}

fn set_memory_runtime_state(status: DatabaseConnectionState, last_error: Option<String>) {
    mutate_runtime_state(|state| {
        state.turso_sync_configured = turso_sync_env_configured();
        state.memory.status = status;
        state.memory.last_error = last_error;
        state.memory.replica_fail_reason = None;
    });
}

fn set_activity_runtime_state(
    status: DatabaseConnectionState,
    last_error: Option<String>,
    replica_fail_reason: Option<String>,
) {
    mutate_runtime_state(|state| {
        state.turso_sync_configured = turso_sync_env_configured();
        state.activity.status = status;
        state.activity.last_error = last_error;
        state.activity.replica_fail_reason = replica_fail_reason;
    });
}

fn set_activity_circuit_breaker(active: bool, reason: Option<String>) {
    mutate_runtime_state(|state| {
        state.turso_sync_configured = turso_sync_env_configured();
        if active && !state.turso_circuit_breaker_active {
            state.circuit_breaker_trips = state.circuit_breaker_trips.saturating_add(1);
        }
        state.turso_circuit_breaker_active = active;
        if reason.is_some() {
            state.activity.replica_fail_reason = reason;
        } else if !active {
            state.activity.replica_fail_reason = None;
        }
    });
}

fn increment_activity_reload_metric() {
    mutate_runtime_state(|state| {
        state.activity_db_reloads = state.activity_db_reloads.saturating_add(1);
    });
}

fn increment_replica_failure_metric() {
    mutate_runtime_state(|state| {
        state.replica_failures = state.replica_failures.saturating_add(1);
    });
}

fn activity_circuit_breaker_active() -> bool {
    DB_RUNTIME_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .turso_circuit_breaker_active
}

pub fn database_runtime_state_snapshot() -> DatabaseRuntimeStateSnapshot {
    DB_RUNTIME_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub fn reset_activity_replica_circuit_breaker() {
    set_activity_circuit_breaker(false, None);
}

const REPLICA_BOOTSTRAP_DEFERRED_REASON: &str = "replica_bootstrap_deferred";

fn classify_replica_failure(error: &str) -> &'static str {
    let normalized = error.to_ascii_lowercase();
    if normalized.contains("unauthorized") {
        "unauthorized"
    } else if normalized.contains("metadata file does not")
        || normalized.contains("db file does not")
    {
        "invalid_local_replica_state"
    } else if normalized.contains("sync error") {
        "sync_error"
    } else {
        "replica_open_failed"
    }
}

fn activity_replica_info_path() -> PathBuf {
    PathBuf::from(format!("{}-info", get_activity_db_path().display()))
}

pub fn should_defer_activity_replica_bootstrap() -> bool {
    turso_sync_env_configured()
        && !activity_circuit_breaker_active()
        && !activity_replica_info_path().exists()
}

pub fn defer_activity_replica_for_session() {
    set_activity_circuit_breaker(true, Some(REPLICA_BOOTSTRAP_DEFERRED_REASON.to_string()));
    set_activity_runtime_state(
        DatabaseConnectionState::DegradedLocal,
        None,
        Some(REPLICA_BOOTSTRAP_DEFERRED_REASON.to_string()),
    );
}

#[derive(Debug, Clone)]
struct QuarantinedReplicaArtifact {
    original: PathBuf,
    quarantined: PathBuf,
}

fn activity_replica_artifact_paths() -> Vec<PathBuf> {
    let db_path = get_activity_db_path();
    let db_path_string = db_path.display().to_string();

    vec![
        db_path,
        PathBuf::from(format!("{db_path_string}-shm")),
        PathBuf::from(format!("{db_path_string}-wal")),
        PathBuf::from(format!("{db_path_string}-info")),
    ]
}

fn quarantine_invalid_activity_replica_state() -> Result<Vec<QuarantinedReplicaArtifact>, String> {
    let ritual_dir = get_ritual_dir();
    let quarantine_dir = ritual_dir.join("quarantine").join(format!(
        "activity-replica-{}",
        Utc::now().timestamp_millis()
    ));
    let artifact_paths = activity_replica_artifact_paths();
    let existing_paths: Vec<PathBuf> = artifact_paths
        .into_iter()
        .filter(|path| path.exists())
        .collect();

    if existing_paths.is_empty() {
        return Ok(Vec::new());
    }

    std::fs::create_dir_all(&quarantine_dir).map_err(|e| {
        format!(
            "Failed to create activity replica quarantine dir {}: {}",
            quarantine_dir.display(),
            e
        )
    })?;

    let mut quarantined = Vec::with_capacity(existing_paths.len());
    for original in existing_paths {
        let file_name = original.file_name().ok_or_else(|| {
            format!(
                "Failed to determine file name for activity replica artifact {}",
                original.display()
            )
        })?;
        let target = quarantine_dir.join(file_name);
        std::fs::rename(&original, &target).map_err(|e| {
            format!(
                "Failed to quarantine activity replica artifact {} -> {}: {}",
                original.display(),
                target.display(),
                e
            )
        })?;
        quarantined.push(QuarantinedReplicaArtifact {
            original,
            quarantined: target,
        });
    }

    db_info!(
        "🧹 Quarantined {} activity replica artifact(s) at {}",
        quarantined.len(),
        quarantine_dir.display()
    );

    Ok(quarantined)
}

fn restore_quarantined_activity_replica_state(
    quarantined: &[QuarantinedReplicaArtifact],
) -> Result<(), String> {
    for artifact in quarantined.iter().rev() {
        if !artifact.quarantined.exists() {
            continue;
        }

        if artifact.original.exists() {
            if artifact.original.is_dir() {
                std::fs::remove_dir_all(&artifact.original).map_err(|e| {
                    format!(
                        "Failed to remove restored activity replica dir {}: {}",
                        artifact.original.display(),
                        e
                    )
                })?;
            } else {
                std::fs::remove_file(&artifact.original).map_err(|e| {
                    format!(
                        "Failed to remove restored activity replica file {}: {}",
                        artifact.original.display(),
                        e
                    )
                })?;
            }
        }

        std::fs::rename(&artifact.quarantined, &artifact.original).map_err(|e| {
            format!(
                "Failed to restore activity replica artifact {} -> {}: {}",
                artifact.quarantined.display(),
                artifact.original.display(),
                e
            )
        })?;
    }

    if let Some(parent) = quarantined
        .first()
        .and_then(|artifact| artifact.quarantined.parent())
    {
        let _ = std::fs::remove_dir(parent);
    }

    db_info!(
        "↩️ Restored {} quarantined activity replica artifact(s) for local fallback",
        quarantined.len()
    );

    Ok(())
}

async fn open_memory_database() -> Result<RitualDatabase, String> {
    let memory_config = DatabaseConfig::with_path(get_memory_db_path());
    RitualDatabase::open(&memory_config).await.map_err(|e| {
        db_error!("❌ Failed to initialize memory database: {}", e);
        format!("Failed to initialize memory database: {}", e)
    })
}

async fn open_local_activity_database(
    status: DatabaseConnectionState,
    last_error: Option<String>,
    fail_reason: Option<String>,
) -> Result<
    (
        RitualDatabase,
        DatabaseConnectionState,
        Option<String>,
        Option<String>,
    ),
    String,
> {
    let local_config = DatabaseConfig::with_path(get_activity_db_path());
    let db = RitualDatabase::open(&local_config).await.map_err(|e| {
        db_error!("❌ Failed to initialize local activity database: {}", e);
        format!("Failed to initialize local activity database: {}", e)
    })?;

    Ok((db, status, last_error, fail_reason))
}

async fn open_activity_database_with_fallback() -> Result<
    (
        RitualDatabase,
        DatabaseConnectionState,
        Option<String>,
        Option<String>,
    ),
    String,
> {
    let sync_configured = turso_sync_env_configured();
    let circuit_broken = activity_circuit_breaker_active();

    if !sync_configured || circuit_broken {
        let status = if circuit_broken {
            DatabaseConnectionState::DegradedLocal
        } else {
            DatabaseConnectionState::ReadyLocal
        };
        let reason = if circuit_broken {
            database_runtime_state_snapshot()
                .activity
                .replica_fail_reason
        } else {
            None
        };
        return open_local_activity_database(status, None, reason).await;
    }

    if should_defer_activity_replica_bootstrap() {
        db_info!(
            "⏭️ Deferring activity replica bootstrap for this session because activity.db-info is missing"
        );
        set_activity_circuit_breaker(true, Some(REPLICA_BOOTSTRAP_DEFERRED_REASON.to_string()));
        return open_local_activity_database(
            DatabaseConnectionState::DegradedLocal,
            None,
            Some(REPLICA_BOOTSTRAP_DEFERRED_REASON.to_string()),
        )
        .await;
    }

    let activity_config = DatabaseConfig::with_turso_sync(
        get_activity_db_path(),
        std::env::var("TURSO_SYNC_URL").unwrap_or_default(),
        std::env::var("TURSO_AUTH_TOKEN").unwrap_or_default(),
    );

    match RitualDatabase::open(&activity_config).await {
        Ok(db) => Ok((db, DatabaseConnectionState::ReadyReplica, None, None)),
        Err(replica_error) => {
            let initial_replica_error = replica_error.to_string();
            let mut replica_error = initial_replica_error.clone();
            let mut fail_reason = classify_replica_failure(&replica_error).to_string();
            increment_replica_failure_metric();

            if fail_reason == "invalid_local_replica_state" {
                db_info!(
                    "🧹 Attempting one-time activity replica recovery by quarantining inconsistent local files"
                );

                let quarantined = quarantine_invalid_activity_replica_state()?;
                if !quarantined.is_empty() {
                    match RitualDatabase::open(&activity_config).await {
                        Ok(db) => {
                            db_info!(
                                "✅ Activity replica recovered after quarantining inconsistent local state"
                            );
                            return Ok((db, DatabaseConnectionState::ReadyReplica, None, None));
                        }
                        Err(retry_error) => {
                            let retry_error = retry_error.to_string();
                            let retry_fail_reason =
                                classify_replica_failure(&retry_error).to_string();

                            if let Err(restore_error) =
                                restore_quarantined_activity_replica_state(&quarantined)
                            {
                                replica_error = format!(
                                    "{}; retry after quarantine failed: {}; restore failed: {}",
                                    initial_replica_error, retry_error, restore_error
                                );
                            } else {
                                replica_error = format!(
                                    "{}; retry after quarantine failed: {}",
                                    initial_replica_error, retry_error
                                );
                            }

                            fail_reason = retry_fail_reason;
                        }
                    }
                }
            }

            set_activity_circuit_breaker(true, Some(fail_reason.clone()));
            db_error!(
                "❌ Failed to initialize activity replica; falling back to local-only mode: {}",
                replica_error
            );

            let local_result = open_local_activity_database(
                DatabaseConnectionState::DegradedLocal,
                Some(replica_error),
                Some(fail_reason),
            )
            .await;

            local_result.map_err(|local_error| {
                db_error!(
                    "❌ Local-only activity fallback also failed: {}",
                    local_error
                );
                local_error
            })
        }
    }
}

fn initialize_schema_in_blocking_thread(
    db_path: PathBuf,
    label: &'static str,
) -> Result<(), String> {
    std::thread::Builder::new()
        .name(format!("ritual-db-init-{label}"))
        .spawn(move || BlockingDatabase::open_with_path(&db_path).map(|_| ()))
        .map_err(|e| format!("Failed to spawn {label} schema init thread: {e}"))?
        .join()
        .map_err(|_| format!("{label} schema init thread panicked"))?
        .map_err(|e| format!("Failed to initialize {label} schema: {e}"))
}

fn table_exists_in_schema(
    conn: &SqliteConnection,
    schema: &str,
    table: &str,
) -> Result<bool, String> {
    let sql = format!(
        "SELECT 1 FROM {}.sqlite_master WHERE type='table' AND name=?1 LIMIT 1",
        schema
    );
    let row = conn
        .query_row(&sql, [table], |_| Ok(1_i64))
        .optional()
        .map_err(|e| format!("Failed table check for {}.{}: {}", schema, table, e))?;
    Ok(row.is_some())
}

fn copy_table_if_exists(conn: &SqliteConnection, table: &str) -> Result<(), String> {
    if !table_exists_in_schema(conn, "legacy", table)? {
        return Ok(());
    }
    let sql = format!("INSERT OR IGNORE INTO {table} SELECT * FROM legacy.{table}");
    conn.execute_batch(&sql)
        .map_err(|e| format!("Failed copying table {}: {}", table, e))
}

fn ensure_split_local_databases() -> Result<(), String> {
    let ritual_dir = get_ritual_dir();
    std::fs::create_dir_all(&ritual_dir).map_err(|e| {
        format!(
            "Failed to create ritual directory {}: {}",
            ritual_dir.display(),
            e
        )
    })?;

    let legacy_db = ritual_dir.join("ritual.db");
    let activity_db = get_activity_db_path();
    let memory_db = get_memory_db_path();
    let marker_path = ritual_dir.join(".split_db_migration_v1.done");

    if !legacy_db.exists() || marker_path.exists() {
        return Ok(());
    }

    // Only bootstrap split-db schema when performing the one-time legacy migration.
    initialize_schema_in_blocking_thread(activity_db.clone(), "activity")?;
    initialize_schema_in_blocking_thread(memory_db.clone(), "memory")?;

    db_info!(
        "🔄 Migrating legacy local database {} into split files ({}, {})",
        legacy_db.display(),
        activity_db.display(),
        memory_db.display()
    );

    // Copy activity-oriented tables.
    {
        let conn = SqliteConnection::open_with_flags(
            &activity_db,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| format!("Failed opening activity.db for migration: {}", e))?;
        conn.execute_batch("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF;")
            .map_err(|e| format!("Failed configuring activity.db pragmas: {}", e))?;
        conn.execute(
            "ATTACH DATABASE ?1 AS legacy",
            [legacy_db.to_string_lossy().to_string()],
        )
        .map_err(|e| format!("Failed attaching legacy database to activity.db: {}", e))?;

        conn.execute_batch("BEGIN IMMEDIATE;")
            .map_err(|e| format!("Failed starting activity migration transaction: {}", e))?;
        for table in [
            "activity_events",
            "afk_events",
            "watcher_heartbeat",
            "sync_queue",
            "daily_rollup_cache",
            "activity_segments",
            "schema_migrations",
        ] {
            copy_table_if_exists(&conn, table)?;
        }
        conn.execute_batch("COMMIT; DETACH DATABASE legacy; PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("Failed finalizing activity migration: {}", e))?;
    }

    // Copy memory-oriented tables.
    {
        let conn = SqliteConnection::open_with_flags(
            &memory_db,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| format!("Failed opening memory.db for migration: {}", e))?;
        conn.execute_batch("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF;")
            .map_err(|e| format!("Failed configuring memory.db pragmas: {}", e))?;
        conn.execute(
            "ATTACH DATABASE ?1 AS legacy",
            [legacy_db.to_string_lossy().to_string()],
        )
        .map_err(|e| format!("Failed attaching legacy database to memory.db: {}", e))?;

        conn.execute_batch("BEGIN IMMEDIATE;")
            .map_err(|e| format!("Failed starting memory migration transaction: {}", e))?;
        for table in [
            "video_chunks",
            "recorder_stats",
            "pipeline_watermarks",
            "memory_upload_outbox",
            "capture_events_raw",
            "schema_migrations",
        ] {
            copy_table_if_exists(&conn, table)?;
        }

        // Preserve OCR content while clearing cross-file FK dependency.
        if table_exists_in_schema(&conn, "legacy", "ocr_frames")? {
            conn.execute_batch(
                r#"
                INSERT OR IGNORE INTO ocr_frames (
                    id, timestamp, activity_event_id, app_bundle_id, app_name, window_title,
                    ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
                    image_hash, storage_tier, created_at
                )
                SELECT
                    id, timestamp, NULL, app_bundle_id, app_name, window_title,
                    ocr_text, ocr_confidence, thumbnail_path, video_chunk_id, frame_offset,
                    image_hash, storage_tier, created_at
                FROM legacy.ocr_frames
                "#,
            )
            .map_err(|e| format!("Failed copying ocr_frames into memory.db: {}", e))?;
        }

        conn.execute_batch("COMMIT; DETACH DATABASE legacy; PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("Failed finalizing memory migration: {}", e))?;
    }

    std::fs::write(
        &marker_path,
        format!("migrated_at={}\n", Utc::now().timestamp_millis()),
    )
    .map_err(|e| format!("Failed writing split migration marker: {}", e))?;

    db_info!("✅ Split local DB migration complete -> activity.db + memory.db (legacy retained)");
    Ok(())
}

/// Initialize the ritual database (call once at app startup)
pub fn initialize_database_with_origin(origin: &str) -> Result<(), String> {
    let origin = normalize_db_command_origin(Some(origin), "native:initialize_database");
    if let Err(err) = ensure_split_local_databases() {
        db_error!("⚠️ Split DB preparation failed origin={}: {}", origin, err);
    }

    RUNTIME.block_on(async {
        let mut memory_guard = RITUAL_DB.write().await;
        let mut activity_guard = ACTIVITY_DB.write().await;

        if memory_guard.is_some() && activity_guard.is_some() {
            db_info!(
                "⏭️ initialize_database skipped origin={} memory_ready=true activity_ready=true",
                origin
            );
            return Ok(()); // Already initialized
        }

        db_info!(
            "🚀 initialize_database origin={} memory_ready={} activity_ready={}",
            origin,
            memory_guard.is_some(),
            activity_guard.is_some()
        );

        if memory_guard.is_none() {
            set_memory_runtime_state(DatabaseConnectionState::Reloading, None);
            db_info!("📂 Opening live memory.db handle origin={}", origin);
            let memory_db = open_memory_database().await?;
            *memory_guard = Some(memory_db);
            set_memory_runtime_state(DatabaseConnectionState::ReadyLocal, None);
            db_info!(
                "✅ Memory database initialized at {:?}",
                get_memory_db_path()
            );
        }

        if activity_guard.is_none() {
            set_activity_runtime_state(DatabaseConnectionState::Reloading, None, None);
            db_info!("📂 Opening live activity.db handle origin={}", origin);
            let (activity_db, status, fallback_error, fail_reason) =
                open_activity_database_with_fallback().await?;
            *activity_guard = Some(activity_db);
            set_activity_runtime_state(status, fallback_error, fail_reason);
            db_info!(
                "✅ Activity database initialized at {:?}",
                get_activity_db_path()
            );
        }

        Ok(())
    })
}

pub async fn reload_activity_database_async_with_origin(origin: &str) -> Result<(), String> {
    let origin = normalize_db_command_origin(Some(origin), "native:reload_activity_database");
    if let Err(err) = ensure_split_local_databases() {
        db_error!(
            "⚠️ Split DB preparation failed before activity reload origin={}: {}",
            origin,
            err
        );
    }

    db_info!("🔄 reload_activity_database origin={}", origin);
    let previous_state = database_runtime_state_snapshot().activity.clone();
    set_activity_runtime_state(DatabaseConnectionState::Reloading, None, None);
    db_info!("📂 Opening live activity.db handle origin={}", origin);

    let reload_result = open_activity_database_with_fallback().await;
    let (activity_db, status, fallback_error, fail_reason) = match reload_result {
        Ok(result) => result,
        Err(error) => {
            mutate_runtime_state(|state| {
                state.activity = DatabaseHandleRuntimeState {
                    last_error: Some(error.clone()),
                    ..previous_state.clone()
                };
            });
            return Err(error);
        }
    };

    let mut activity_guard = ACTIVITY_DB.write().await;
    let previous = activity_guard.take();
    *activity_guard = Some(activity_db);
    drop(previous);

    increment_activity_reload_metric();
    set_activity_runtime_state(status, fallback_error, fail_reason);
    db_info!(
        "✅ Activity database reloaded at {:?}",
        get_activity_db_path()
    );
    Ok(())
}

pub fn reload_activity_database_with_origin(origin: &str) -> Result<(), String> {
    RUNTIME.block_on(reload_activity_database_async_with_origin(origin))
}

/// Get database or return error
pub(crate) async fn get_db(
) -> Result<tokio::sync::RwLockReadGuard<'static, Option<RitualDatabase>>, String> {
    let guard = RITUAL_DB.read().await;
    if guard.is_none() {
        return Err("Database not initialized. Call initialize_database() first.".to_string());
    }
    Ok(guard)
}

/// Get activity database or return error.
pub(crate) async fn get_activity_db(
) -> Result<tokio::sync::RwLockReadGuard<'static, Option<RitualDatabase>>, String> {
    let guard = ACTIVITY_DB.read().await;
    if guard.is_none() {
        return Err(
            "Activity database not initialized. Call initialize_database() first.".to_string(),
        );
    }
    Ok(guard)
}

fn require_db_ref<'a>(db: Option<&'a RitualDatabase>) -> Result<&'a RitualDatabase, String> {
    db.ok_or_else(|| "Database not initialized. Call initialize_database() first.".to_string())
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Initialize the Ritual database
#[tauri::command]
pub fn init_ritual_database(origin: Option<String>) -> Result<String, String> {
    let origin =
        normalize_db_command_origin(origin.as_deref(), "tauri:init_ritual_database:unknown");
    log_db_command("init_ritual_database", &origin, "");
    initialize_database_with_origin(&format!("command:{origin}"))?;
    Ok("Database initialized successfully".to_string())
}

/// Get database statistics
#[tauri::command]
pub fn get_ritual_db_stats() -> Result<RitualDbStats, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        let stats = db
            .get_stats()
            .await
            .map_err(|e| format!("Failed to get stats: {}", e))?;

        Ok(RitualDbStats {
            activity_event_count: stats.activity_event_count,
            ocr_frame_count: stats.ocr_frame_count,
            embedding_count: stats.embedding_count,
            video_chunk_count: stats.video_chunk_count,
            sync_queue_pending: stats.sync_queue_pending,
            db_size_mb: stats.db_size_bytes as f64 / 1024.0 / 1024.0,
        })
    })
}

/// Search response for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RitualDbStats {
    pub activity_event_count: i64,
    pub ocr_frame_count: i64,
    pub embedding_count: i64,
    pub video_chunk_count: i64,
    pub sync_queue_pending: i64,
    pub db_size_mb: f64,
}

/// Text search (full-text search, faster than semantic)
#[tauri::command]
pub fn text_search(query: String, limit: Option<usize>) -> Result<Vec<TextSearchResult>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        let results = db
            .search_ocr_text(&query, limit.unwrap_or(50))
            .await
            .map_err(|e| format!("Search failed: {}", e))?;

        let response: Vec<TextSearchResult> = results
            .into_iter()
            .map(|f| TextSearchResult {
                frame_id: f.id.unwrap_or(0),
                timestamp: f.timestamp,
                app_bundle_id: f.app_bundle_id,
                app_name: f.app_name,
                window_title: f.window_title,
                ocr_text: f.ocr_text,
                thumbnail_path: f.thumbnail_path,
                video_chunk_id: f.video_chunk_id,
                frame_offset: f.frame_offset,
            })
            .collect();

        Ok(response)
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextSearchResult {
    pub frame_id: i64,
    pub timestamp: i64,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub ocr_text: String,
    pub thumbnail_path: Option<String>,
    pub video_chunk_id: Option<i64>,
    pub frame_offset: Option<i64>,
}

/// Emit a one-line startup snapshot for cloud-memory upload readiness.
pub fn log_startup_pipeline_snapshot() -> Result<(), String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;

        let (outbox_pending, outbox_uploading, outbox_failed, outbox_uploaded) = {
            let mut rows = conn
                .query(
                    r#"
                    SELECT
                        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
                        SUM(CASE WHEN status = 'uploading' THEN 1 ELSE 0 END) AS uploading_count,
                        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
                        SUM(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END) AS uploaded_count
                    FROM memory_upload_outbox
                    "#,
                    (),
                )
                .await
                .map_err(|e| format!("Failed to read memory_upload_outbox startup stats: {}", e))?;

            if let Some(row) = rows
                .next()
                .await
                .map_err(|e| format!("Failed reading memory_upload_outbox startup stats row: {}", e))?
            {
                (
                    row.get::<i64>(0).unwrap_or(0),
                    row.get::<i64>(1).unwrap_or(0),
                    row.get::<i64>(2).unwrap_or(0),
                    row.get::<i64>(3).unwrap_or(0),
                )
            } else {
                (0, 0, 0, 0)
            }
        };

        db_info!(
            "📈 Startup pipeline snapshot: outbox_pending={}, outbox_uploading={}, outbox_failed={}, outbox_uploaded={}",
            outbox_pending,
            outbox_uploading,
            outbox_failed,
            outbox_uploaded
        );
        eprintln!(
            "[Ritual][startup] outbox_pending={} outbox_uploading={} outbox_failed={} outbox_uploaded={}",
            outbox_pending,
            outbox_uploading,
            outbox_failed,
            outbox_uploaded
        );

        Ok(())
    })
}

/// Check migration status for both legacy and split local databases.
#[tauri::command]
pub fn check_migration_status() -> Result<MigrationStatus, String> {
    let ritual_dir = get_ritual_dir();
    let legacy_ritual_db_path = ritual_dir.join("ritual.db");
    let activity_db_path = ritual_dir.join("activity.db");
    let memory_db_path = ritual_dir.join("memory.db");
    let watcher_db_path = ritual_dir.join("watcher.db");
    let frames_db_path = ritual_dir.join("frames.db");

    // Check for migrated backups
    let watcher_migrated = ritual_dir.join("watcher.db.migrated").exists();
    let frames_migrated = ritual_dir.join("frames.db.migrated").exists();

    Ok(MigrationStatus {
        ritual_db_exists: legacy_ritual_db_path.exists(),
        activity_db_exists: activity_db_path.exists(),
        memory_db_exists: memory_db_path.exists(),
        legacy_watcher_db_exists: watcher_db_path.exists(),
        legacy_frames_db_exists: frames_db_path.exists(),
        watcher_migrated,
        frames_migrated,
        is_fully_migrated: activity_db_path.exists() && memory_db_path.exists(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationStatus {
    pub ritual_db_exists: bool,
    pub activity_db_exists: bool,
    pub memory_db_exists: bool,
    pub legacy_watcher_db_exists: bool,
    pub legacy_frames_db_exists: bool,
    pub watcher_migrated: bool,
    pub frames_migrated: bool,
    pub is_fully_migrated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryUploadOutboxSeedResult {
    pub inserted: i64,
    pub scanned_limit: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryUploadOutboxStats {
    pub pending: i64,
    pub uploading: i64,
    pub failed: i64,
    pub uploaded: i64,
    pub total: i64,
    pub oldest_pending_created_at: Option<i64>,
    pub newest_uploaded_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryUploadOutboxItem {
    pub id: i64,
    pub user_id: String,
    pub device_id: String,
    pub chunk_id: i64,
    pub logical_chunk_id: Option<String>,
    pub content_hash: Option<String>,
    pub payload_json: String,
    pub retry_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryUploadOutboxAckResult {
    pub updated: i64,
    pub failed_updates: i64,
}

/// Seed upload outbox rows from session_retrieval_docs for cloud ingestion.
#[tauri::command]
pub fn seed_memory_upload_outbox(
    limit: Option<usize>,
    origin: Option<String>,
) -> Result<MemoryUploadOutboxSeedResult, String> {
    RUNTIME.block_on(async {
        let origin = normalize_db_command_origin(
            origin.as_deref(),
            "tauri:seed_memory_upload_outbox:unknown",
        );
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;
        let now = Utc::now().timestamp_millis();
        let fresh_cutoff = now.saturating_sub(2 * 60 * 60 * 1000);
        let safe_limit = limit.unwrap_or(500).clamp(1, 10_000) as i64;
        log_db_command(
            "seed_memory_upload_outbox",
            &origin,
            &format!("limit={safe_limit}"),
        );
        let active_identity = resolve_active_identity().ok_or_else(|| {
            "Cannot seed memory upload outbox without an active Ritual user/device identity."
                .to_string()
        })?;
        let mut inserted: i64 = 0;

        let mut session_doc_rows = conn
            .query(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_retrieval_docs' LIMIT 1",
                (),
            )
            .await
            .map_err(|e| format!("Failed to check session_retrieval_docs existence: {}", e))?;
        let has_session_retrieval_docs = session_doc_rows
            .next()
            .await
            .map_err(|e| format!("Failed reading session_retrieval_docs existence: {}", e))?
            .is_some();

        if has_session_retrieval_docs {
            inserted += conn.execute(
                r#"
                INSERT INTO memory_upload_outbox
                (user_id, device_id, chunk_id, logical_chunk_id, content_hash, payload_json, status, retry_count, next_retry_at, last_error, created_at, updated_at)
                SELECT
                    COALESCE(NULLIF(src.user_id, ''), ?),
                    COALESCE(NULLIF(src.device_id, ''), ?),
                    -src.session_id,
                    printf('context-session-%d', src.session_id),
                    printf('context-session-%d-%d-%d-%d', src.session_id, src.chunk_start_ts, src.chunk_end_ts, COALESCE(src.updated_at, 0)),
                    json_object(
                        'chunk_id', printf('context-session-%d', src.session_id),
                        'logical_chunk_id', printf('context-session-%d', src.session_id),
                        'chunk_start_ts', src.chunk_start_ts,
                        'chunk_end_ts', src.chunk_end_ts,
                        'source_kind', COALESCE(NULLIF(src.source_kind, ''), 'context_session'),
                        'session_id', CAST(src.session_id AS TEXT),
                        'app_name', COALESCE(src.app_name, ''),
                        'window_title', COALESCE(src.window_title, ''),
                        'document_title', COALESCE(src.document_title, ''),
                        'browser_domain', COALESCE(src.browser_domain, ''),
                        'raw_visible_text', COALESCE(src.raw_visible_text, ''),
                        'contextual_retrieval_text', COALESCE(src.contextual_retrieval_text, ''),
                        'text_compact', COALESCE(src.contextual_retrieval_text, ''),
                        'context_version', COALESCE(src.context_version, 1),
                        'session_key', CAST(src.session_id AS TEXT),
                        'session_position', COALESCE(src.session_position, 0),
                        'session_count', COALESCE(src.session_count, 1),
                        'quality_score', COALESCE(src.capture_quality, 0.0),
                        'capture_quality', COALESCE(src.capture_quality, 0.0),
                        'source_frame_ids', json('[]'),
                        'content_hash', printf('context-session-%d-%d-%d-%d', src.session_id, src.chunk_start_ts, src.chunk_end_ts, COALESCE(src.updated_at, 0))
                    ),
                    'pending',
                    0,
                    NULL,
                    NULL,
                    ?,
                    ?
                FROM (
                    SELECT
                        session_id,
                        device_id,
                        user_id,
                        chunk_start_ts,
                        chunk_end_ts,
                        'context_session' AS source_kind,
                        app_name,
                        window_title,
                        document_title,
                        browser_domain,
                        raw_visible_text,
                        contextual_retrieval_text,
                        capture_quality,
                        context_version,
                        session_position,
                        session_count,
                        updated_at
                    FROM session_retrieval_docs
                    WHERE TRIM(COALESCE(contextual_retrieval_text, '')) != ''
                    ORDER BY
                        CASE
                            WHEN chunk_end_ts >= ? THEN 0
                            ELSE 1
                        END ASC,
                        chunk_end_ts DESC
                    LIMIT ?
                ) AS src
                WHERE 1=1
                ON CONFLICT(user_id, device_id, logical_chunk_id) DO UPDATE SET
                    chunk_id = excluded.chunk_id,
                    content_hash = excluded.content_hash,
                    payload_json = excluded.payload_json,
                    status = CASE
                        WHEN COALESCE(memory_upload_outbox.content_hash, '') != COALESCE(excluded.content_hash, '')
                        THEN 'pending'
                        ELSE memory_upload_outbox.status
                    END,
                    retry_count = CASE
                        WHEN COALESCE(memory_upload_outbox.content_hash, '') != COALESCE(excluded.content_hash, '')
                        THEN 0
                        ELSE memory_upload_outbox.retry_count
                    END,
                    next_retry_at = CASE
                        WHEN COALESCE(memory_upload_outbox.content_hash, '') != COALESCE(excluded.content_hash, '')
                        THEN NULL
                        ELSE memory_upload_outbox.next_retry_at
                    END,
                    last_error = CASE
                        WHEN COALESCE(memory_upload_outbox.content_hash, '') != COALESCE(excluded.content_hash, '')
                        THEN NULL
                        ELSE memory_upload_outbox.last_error
                    END,
                    updated_at = CASE
                        WHEN COALESCE(memory_upload_outbox.content_hash, '') != COALESCE(excluded.content_hash, '')
                        THEN excluded.updated_at
                        ELSE memory_upload_outbox.updated_at
                    END
                "#,
                libsql::params![
                    active_identity.user_id.clone(),
                    active_identity.device_id.clone(),
                    now,
                    now,
                    fresh_cutoff,
                    safe_limit
                ],
            ).await.map_err(|e| format!("Failed to seed context session docs into memory upload outbox: {}", e))? as i64;
        }

        Ok(MemoryUploadOutboxSeedResult {
            inserted: inserted as i64,
            scanned_limit: safe_limit,
        })
    })
}

/// Get upload outbox health/status for UI and diagnostics.
#[tauri::command]
pub fn get_memory_upload_outbox_stats(
    origin: Option<String>,
) -> Result<MemoryUploadOutboxStats, String> {
    RUNTIME.block_on(async {
        let origin = normalize_db_command_origin(
            origin.as_deref(),
            "tauri:get_memory_upload_outbox_stats:unknown",
        );
        log_db_command("get_memory_upload_outbox_stats", &origin, "");
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;

        let mut rows = conn
            .query(
                r#"
                SELECT
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
                    SUM(CASE WHEN status = 'uploading' THEN 1 ELSE 0 END) AS uploading_count,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
                    SUM(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END) AS uploaded_count,
                    COUNT(*) AS total_count,
                    MIN(CASE WHEN status IN ('pending','failed') THEN created_at ELSE NULL END) AS oldest_pending_created_at,
                    MAX(CASE WHEN status = 'uploaded' THEN updated_at ELSE NULL END) AS newest_uploaded_at
                FROM memory_upload_outbox
                "#,
                (),
            )
            .await
            .map_err(|e| format!("Failed to read memory upload outbox stats: {}", e))?;

        let row = rows
            .next()
            .await
            .map_err(|e| format!("Failed to read memory upload outbox stats row: {}", e))?;
        let row = row.ok_or_else(|| "Outbox stats row missing".to_string())?;

        Ok(MemoryUploadOutboxStats {
            pending: row.get::<i64>(0).unwrap_or(0),
            uploading: row.get::<i64>(1).unwrap_or(0),
            failed: row.get::<i64>(2).unwrap_or(0),
            uploaded: row.get::<i64>(3).unwrap_or(0),
            total: row.get::<i64>(4).unwrap_or(0),
            oldest_pending_created_at: row.get::<Option<i64>>(5).ok().flatten(),
            newest_uploaded_at: row.get::<Option<i64>>(6).ok().flatten(),
        })
    })
}

/// Claim a batch of outbox rows for upload processing.
#[tauri::command]
pub fn claim_memory_upload_outbox_batch(
    limit: Option<usize>,
    origin: Option<String>,
) -> Result<Vec<MemoryUploadOutboxItem>, String> {
    RUNTIME.block_on(async {
        let origin = normalize_db_command_origin(
            origin.as_deref(),
            "tauri:claim_memory_upload_outbox_batch:unknown",
        );
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;
        let now = Utc::now().timestamp_millis();
        let stale_uploading_cutoff = now.saturating_sub(5 * 60 * 1000);
        let reclaim_next_retry_at = now.saturating_add(15_000);
        let safe_limit = limit.unwrap_or(100).clamp(1, 1000);
        log_db_command(
            "claim_memory_upload_outbox_batch",
            &origin,
            &format!("limit={safe_limit}"),
        );

        // Recover rows left in uploading by interrupted desktop sessions/network failures.
        let _ = conn
            .execute(
                r#"
                UPDATE memory_upload_outbox
                SET status='failed',
                    retry_count=COALESCE(retry_count, 0) + 1,
                    next_retry_at=?,
                    last_error='stale_uploading_reclaimed',
                    updated_at=?
                WHERE status='uploading'
                  AND COALESCE(updated_at, 0) <= ?
                "#,
                libsql::params![reclaim_next_retry_at, now, stale_uploading_cutoff],
            )
            .await
            .map_err(|e| format!("Failed to reclaim stale uploading rows: {}", e))?;

        let mut rows = conn
            .query(
                r#"
            SELECT id, user_id, device_id, chunk_id, logical_chunk_id, content_hash, payload_json, retry_count
            FROM memory_upload_outbox
            WHERE status IN ('pending', 'failed')
              AND COALESCE(next_retry_at, 0) <= ?
            -- Freshness-first claim order so recent user queries can ground quickly.
            -- Pending rows are preferred over retries, then newest chunk_end_ts first.
            ORDER BY
                CASE status WHEN 'pending' THEN 0 ELSE 1 END ASC,
                CASE
                    WHEN status = 'pending'
                    THEN COALESCE(CAST(json_extract(payload_json, '$.chunk_end_ts') AS INTEGER), 0)
                    ELSE 0
                END DESC,
                COALESCE(next_retry_at, 0) ASC,
                created_at ASC
            LIMIT ?
            "#,
                libsql::params![now, safe_limit as i64],
            )
            .await
            .map_err(|e| format!("Failed to query memory upload outbox batch: {}", e))?;

        let mut items: Vec<MemoryUploadOutboxItem> = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| format!("Failed reading outbox row: {}", e))?
        {
            let id = row.get::<i64>(0).unwrap_or(0);
            if id <= 0 {
                continue;
            }
            let claimed = conn.execute(
                r#"
                UPDATE memory_upload_outbox
                SET status='uploading',
                    updated_at=?
                WHERE id=?
                  AND status IN ('pending', 'failed')
                  AND COALESCE(next_retry_at, 0) <= ?
                "#,
                libsql::params![now, id, now],
            ).await
            .map_err(|e| format!("Failed to mark outbox row uploading: {}", e))?;
            if claimed <= 0 {
                continue;
            }

            let user_id = row.get::<String>(1).unwrap_or_default();
            let device_id = row.get::<String>(2).unwrap_or_default();
            if user_id.trim().is_empty() || device_id.trim().is_empty() {
                let reason = if user_id.trim().is_empty() {
                    "missing_user_id"
                } else {
                    "missing_device_id"
                };
                let _ = conn
                    .execute(
                        r#"
                        UPDATE memory_upload_outbox
                        SET status='failed',
                            retry_count=COALESCE(retry_count, 0) + 1,
                            last_error=?,
                            updated_at=?
                        WHERE id=?
                        "#,
                        libsql::params![reason, now, id],
                    )
                    .await;
                continue;
            }

            items.push(MemoryUploadOutboxItem {
                id,
                user_id,
                device_id,
                chunk_id: row.get::<i64>(3).unwrap_or(0),
                logical_chunk_id: row.get::<Option<String>>(4).ok().flatten(),
                content_hash: row.get::<Option<String>>(5).ok().flatten(),
                payload_json: row.get::<String>(6).unwrap_or_default(),
                retry_count: row.get::<i64>(7).unwrap_or(0),
            });
        }

        Ok(items)
    })
}

/// Acknowledge upload results for outbox rows (success/failure with retry backoff).
#[tauri::command]
pub fn ack_memory_upload_outbox_batch(
    ids: Vec<i64>,
    success: bool,
    error_message: Option<String>,
    origin: Option<String>,
) -> Result<MemoryUploadOutboxAckResult, String> {
    RUNTIME.block_on(async {
        let origin = normalize_db_command_origin(
            origin.as_deref(),
            "tauri:ack_memory_upload_outbox_batch:unknown",
        );
        log_db_command(
            "ack_memory_upload_outbox_batch",
            &origin,
            &format!("success={} ids={}", success, ids.len()),
        );
        if ids.is_empty() {
            return Ok(MemoryUploadOutboxAckResult {
                updated: 0,
                failed_updates: 0,
            });
        }

        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;
        let now = Utc::now().timestamp_millis();

        let mut updated = 0i64;
        let mut failed_updates = 0i64;

        for id in ids {
            if id <= 0 {
                continue;
            }

            let update_result = if success {
                conn.execute(
                    r#"
                    UPDATE memory_upload_outbox
                    SET status='uploaded',
                        last_error=NULL,
                        next_retry_at=NULL,
                        updated_at=?
                    WHERE id=?
                      AND status='uploading'
                    "#,
                    libsql::params![now, id],
                )
                .await
            } else {
                let mut retry_rows = conn
                    .query(
                        "SELECT retry_count FROM memory_upload_outbox WHERE id=?",
                        libsql::params![id],
                    )
                    .await
                    .map_err(|e| {
                        format!("Failed loading retry_count for outbox row {}: {}", id, e)
                    })?;
                let retry_count = retry_rows
                    .next()
                    .await
                    .map_err(|e| {
                        format!("Failed reading retry_count for outbox row {}: {}", id, e)
                    })?
                    .and_then(|row| row.get::<i64>(0).ok())
                    .unwrap_or(0)
                    + 1;
                let capped_retry = retry_count.clamp(1, 8);
                let delay_ms = 15_000_i64.saturating_mul(1_i64 << (capped_retry - 1));
                let next_retry_at = now.saturating_add(delay_ms);

                conn.execute(
                    r#"
                    UPDATE memory_upload_outbox
                    SET status='failed',
                        retry_count=?,
                        next_retry_at=?,
                        last_error=?,
                        updated_at=?
                    WHERE id=?
                      AND status='uploading'
                    "#,
                    libsql::params![
                        retry_count,
                        next_retry_at,
                        error_message
                            .clone()
                            .unwrap_or_else(|| "upload failed".to_string()),
                        now,
                        id
                    ],
                )
                .await
            };

            match update_result {
                Ok(_) => updated += 1,
                Err(_) => failed_updates += 1,
            }
        }

        Ok(MemoryUploadOutboxAckResult {
            updated,
            failed_updates,
        })
    })
}
