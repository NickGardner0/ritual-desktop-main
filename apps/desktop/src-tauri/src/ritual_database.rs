//! Ritual Database Integration
//!
//! This module provides access to the unified libSQL database.
//! It wraps ritual-db and provides Tauri commands for:
//! - Database statistics
//! - Migration status
//!
//! The existing rusqlite code continues to work alongside this for backward compatibility.

use chrono::Utc;
use once_cell::sync::Lazy;
use rusqlite::{Connection as SqliteConnection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

use ritual_db::{
    blocking::BlockingDatabase,
    project_time::{ProjectTimeOps, ProjectTimeRecomputeResult, ProjectTimeRetentionResult},
    DatabaseConfig, RitualDatabase,
};

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
    Reloading,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseHandleRuntimeState {
    pub status: DatabaseConnectionState,
    pub db_path: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseRuntimeStateSnapshot {
    pub memory: DatabaseHandleRuntimeState,
    pub activity: DatabaseHandleRuntimeState,
    pub turso_sync_configured: bool,
    pub local_capture_ready: bool,
    pub cloud_sync_enabled: bool,
    pub latest_local_event_ts: Option<i64>,
    pub latest_cloud_sync_ts: Option<i64>,
    pub cloud_sync_backlog: i64,
    pub cloud_sync_last_error: Option<String>,
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

    None
}
/// Get the ritual database directory
fn get_ritual_dir() -> PathBuf {
    crate::app_paths::data_dir()
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
            },
            activity: DatabaseHandleRuntimeState {
                status: DatabaseConnectionState::Uninitialized,
                db_path: get_activity_db_path().display().to_string(),
                last_error: None,
            },
            turso_sync_configured: false,
            local_capture_ready: false,
            cloud_sync_enabled: false,
            latest_local_event_ts: None,
            latest_cloud_sync_ts: None,
            cloud_sync_backlog: 0,
            cloud_sync_last_error: None,
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
            "📓 activity.db state -> {:?} error={:?}",
            current.activity.status,
            current.activity.last_error
        );
    }
}

fn set_memory_runtime_state(status: DatabaseConnectionState, last_error: Option<String>) {
    mutate_runtime_state(|state| {
        state.turso_sync_configured = turso_sync_env_configured();
        state.cloud_sync_enabled = state.turso_sync_configured;
        state.memory.status = status;
        state.memory.last_error = last_error;
    });
}

fn set_activity_runtime_state(status: DatabaseConnectionState, last_error: Option<String>) {
    mutate_runtime_state(|state| {
        state.turso_sync_configured = turso_sync_env_configured();
        state.cloud_sync_enabled = state.turso_sync_configured;
        state.local_capture_ready = matches!(status, DatabaseConnectionState::ReadyLocal);
        state.activity.status = status;
        state.activity.last_error = last_error;
    });
}

pub fn record_cloud_sync_runtime_state(
    latest_local_event_ts: Option<i64>,
    latest_cloud_sync_ts: Option<i64>,
    cloud_sync_backlog: i64,
    cloud_sync_last_error: Option<String>,
) {
    mutate_runtime_state(|state| {
        state.cloud_sync_enabled = state.turso_sync_configured;
        state.latest_local_event_ts = latest_local_event_ts;
        state.latest_cloud_sync_ts = latest_cloud_sync_ts;
        state.cloud_sync_backlog = cloud_sync_backlog.max(0);
        state.cloud_sync_last_error = cloud_sync_last_error;
    });
}

pub fn database_runtime_state_snapshot() -> DatabaseRuntimeStateSnapshot {
    DB_RUNTIME_STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

async fn open_memory_database() -> Result<RitualDatabase, String> {
    let memory_config = DatabaseConfig::with_path(get_memory_db_path());
    RitualDatabase::open(&memory_config).await.map_err(|e| {
        db_error!("❌ Failed to initialize memory database: {}", e);
        format!("Failed to initialize memory database: {}", e)
    })
}

async fn open_activity_database() -> Result<RitualDatabase, String> {
    let local_config = DatabaseConfig::with_path(get_activity_db_path());
    RitualDatabase::open(&local_config).await.map_err(|e| {
        db_error!("❌ Failed to initialize local activity database: {}", e);
        format!("Failed to initialize local activity database: {}", e)
    })
}

fn prepare_activity_database_files(origin: &str) {
    if let Err(err) = ensure_split_local_databases() {
        db_error!("⚠️ Split DB preparation failed origin={}: {}", origin, err);
    }
}

pub fn import_historical_activity_with_origin(origin: &str) {
    if let Err(err) = ensure_historical_activity_import() {
        db_error!(
            "⚠️ Historical activity import failed origin={}: {}",
            origin,
            err
        );
    }
}

async fn initialize_activity_database_inner(origin: String) -> Result<(), String> {
    let activity_ready = ACTIVITY_DB.read().await.is_some();
    if activity_ready {
        db_info!(
            "⏭️ initialize_activity_database skipped origin={} activity_ready=true",
            origin
        );
        return Ok(());
    }

    set_activity_runtime_state(DatabaseConnectionState::Reloading, None);
    db_info!("📂 Opening live activity.db handle origin={}", origin);

    match open_activity_database().await {
        Ok(activity_db) => {
            let mut activity_guard = ACTIVITY_DB.write().await;
            if activity_guard.is_none() {
                *activity_guard = Some(activity_db);
            }
            set_activity_runtime_state(DatabaseConnectionState::ReadyLocal, None);
            db_info!(
                "✅ Activity database initialized independently at {:?}",
                get_activity_db_path()
            );
            Ok(())
        }
        Err(error) => {
            set_activity_runtime_state(DatabaseConnectionState::Uninitialized, Some(error.clone()));
            Err(error)
        }
    }
}

pub fn initialize_activity_database_with_origin(origin: &str) -> Result<(), String> {
    let origin = normalize_db_command_origin(Some(origin), "native:initialize_activity_database");
    prepare_activity_database_files(&origin);
    RUNTIME.block_on(initialize_activity_database_inner(origin))
}

async fn initialize_memory_database_inner(origin: String) -> Result<(), String> {
    let memory_ready = RITUAL_DB.read().await.is_some();
    if memory_ready {
        db_info!(
            "⏭️ initialize_memory_database skipped origin={} memory_ready=true",
            origin
        );
        return Ok(());
    }

    set_memory_runtime_state(DatabaseConnectionState::Reloading, None);
    db_info!("📂 Opening live memory.db handle origin={}", origin);

    match open_memory_database().await {
        Ok(memory_db) => {
            let mut memory_guard = RITUAL_DB.write().await;
            if memory_guard.is_none() {
                *memory_guard = Some(memory_db);
            }
            set_memory_runtime_state(DatabaseConnectionState::ReadyLocal, None);
            db_info!(
                "✅ Memory database initialized at {:?}",
                get_memory_db_path()
            );
            Ok(())
        }
        Err(error) => {
            set_memory_runtime_state(DatabaseConnectionState::Uninitialized, Some(error.clone()));
            Err(error)
        }
    }
}

pub fn initialize_memory_database_with_origin(origin: &str) -> Result<(), String> {
    let origin = normalize_db_command_origin(Some(origin), "native:initialize_memory_database");
    if let Err(err) = ensure_split_local_databases() {
        db_error!("⚠️ Split DB preparation failed origin={}: {}", origin, err);
    }
    RUNTIME.block_on(initialize_memory_database_inner(origin))
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

fn column_exists_in_schema(
    conn: &SqliteConnection,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<bool, String> {
    let sql = format!("PRAGMA {schema}.table_info({table})");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("Failed preparing column check for {schema}.{table}: {e}"))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("Failed column check for {schema}.{table}: {e}"))?;

    while let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed reading column check row for {schema}.{table}: {e}"))?
    {
        let name: String = row
            .get(1)
            .map_err(|e| format!("Failed reading column name for {schema}.{table}: {e}"))?;
        if name == column {
            return Ok(true);
        }
    }

    Ok(false)
}

fn copy_table_if_exists(conn: &SqliteConnection, table: &str) -> Result<(), String> {
    if !table_exists_in_schema(conn, "legacy", table)? {
        return Ok(());
    }
    let sql = format!("INSERT OR IGNORE INTO {table} SELECT * FROM legacy.{table}");
    conn.execute_batch(&sql)
        .map_err(|e| format!("Failed copying table {}: {}", table, e))
}

fn source_column_expr(
    conn: &SqliteConnection,
    column: &str,
    fallback: &str,
) -> Result<String, String> {
    if column_exists_in_schema(conn, "historical", "activity_events", column)? {
        Ok(format!("COALESCE({column}, {fallback})"))
    } else {
        Ok(fallback.to_string())
    }
}

fn source_event_uid_expr(conn: &SqliteConnection) -> Result<String, String> {
    let fallback = r#"
        printf(
            'legacy-import:%s:%s:%lld:%lld:%s:%s:%lld',
            COALESCE(device_id, ''),
            COALESCE(user_id, ''),
            COALESCE(ts_start, 0),
            COALESCE(ts_end, 0),
            COALESCE(app_bundle_id, ''),
            COALESCE(window_title_hash, ''),
            COALESCE(is_afk, 0)
        )
    "#;

    if column_exists_in_schema(conn, "historical", "activity_events", "event_uid")? {
        Ok(format!(
            "CASE WHEN TRIM(COALESCE(event_uid, '')) != '' THEN event_uid ELSE {fallback} END"
        ))
    } else {
        Ok(fallback.to_string())
    }
}

fn import_historical_activity_events_from_source(
    conn: &SqliteConnection,
    source_path: &Path,
) -> Result<usize, String> {
    if !source_path.exists() {
        return Ok(0);
    }

    conn.execute(
        "ATTACH DATABASE ?1 AS historical",
        [source_path.to_string_lossy().to_string()],
    )
    .map_err(|e| {
        format!(
            "Failed attaching historical activity database {}: {}",
            source_path.display(),
            e
        )
    })?;

    let import_result = (|| -> Result<usize, String> {
        if !table_exists_in_schema(conn, "historical", "activity_events")? {
            return Ok(0);
        }

        let event_uid_expr = source_event_uid_expr(conn)?;
        let device_id_expr = source_column_expr(conn, "device_id", "''")?;
        let user_id_expr = source_column_expr(conn, "user_id", "''")?;
        let app_bundle_id_expr = source_column_expr(conn, "app_bundle_id", "''")?;
        let app_name_expr = source_column_expr(conn, "app_name", "''")?;
        let window_title_expr = source_column_expr(conn, "window_title", "NULL")?;
        let window_title_hash_expr = source_column_expr(conn, "window_title_hash", "NULL")?;
        let window_owner_pid_expr = source_column_expr(conn, "window_owner_pid", "NULL")?;
        let is_afk_expr = source_column_expr(conn, "is_afk", "0")?;
        let browser_url_expr = source_column_expr(conn, "browser_url", "NULL")?;
        let browser_domain_expr = source_column_expr(conn, "browser_domain", "NULL")?;
        let is_incognito_expr = source_column_expr(conn, "is_incognito", "0")?;
        let source_expr = source_column_expr(conn, "source", "'historical_activity_import'")?;
        let created_at_expr = source_column_expr(conn, "created_at", "COALESCE(ts_start, 0)")?;

        let sql = format!(
            r#"
            INSERT OR IGNORE INTO main.activity_events (
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
            )
            SELECT
                src.event_uid,
                src.device_id,
                src.user_id,
                src.ts_start,
                src.ts_end,
                src.app_bundle_id,
                src.app_name,
                src.window_title,
                src.window_title_hash,
                src.window_owner_pid,
                src.is_afk,
                src.browser_url,
                src.browser_domain,
                src.is_incognito,
                src.source,
                src.created_at
            FROM (
                SELECT
                    {event_uid_expr} AS event_uid,
                    {device_id_expr} AS device_id,
                    {user_id_expr} AS user_id,
                    COALESCE(ts_start, 0) AS ts_start,
                    COALESCE(ts_end, 0) AS ts_end,
                    {app_bundle_id_expr} AS app_bundle_id,
                    {app_name_expr} AS app_name,
                    {window_title_expr} AS window_title,
                    {window_title_hash_expr} AS window_title_hash,
                    {window_owner_pid_expr} AS window_owner_pid,
                    {is_afk_expr} AS is_afk,
                    {browser_url_expr} AS browser_url,
                    {browser_domain_expr} AS browser_domain,
                    {is_incognito_expr} AS is_incognito,
                    {source_expr} AS source,
                    {created_at_expr} AS created_at
                FROM historical.activity_events
                WHERE COALESCE(ts_end, 0) > COALESCE(ts_start, 0)
            ) AS src
            WHERE NOT EXISTS (
                SELECT 1
                FROM main.activity_events AS existing
                WHERE (
                    TRIM(COALESCE(src.event_uid, '')) != ''
                    AND existing.event_uid = src.event_uid
                )
                OR (
                    existing.device_id = src.device_id
                    AND existing.user_id = src.user_id
                    AND existing.ts_start = src.ts_start
                    AND existing.ts_end = src.ts_end
                    AND existing.app_bundle_id = src.app_bundle_id
                    AND COALESCE(existing.window_title_hash, '') = COALESCE(src.window_title_hash, '')
                    AND COALESCE(existing.browser_domain, '') = COALESCE(src.browser_domain, '')
                    AND COALESCE(existing.is_afk, 0) = COALESCE(src.is_afk, 0)
                )
            )
            "#
        );

        conn.execute(&sql, [])
            .map_err(|e| format!("Failed importing historical activity events: {e}"))
    })();

    let detach_result = conn.execute_batch("DETACH DATABASE historical;");
    if let Err(error) = detach_result {
        db_error!(
            "⚠️ Failed detaching historical activity database {}: {}",
            source_path.display(),
            error
        );
    }

    import_result
}

fn ensure_historical_activity_import() -> Result<(), String> {
    if std::env::var("RITUAL_DISABLE_HISTORICAL_ACTIVITY_IMPORT")
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
    {
        return Ok(());
    }

    let ritual_dir = get_ritual_dir();
    let marker_path = ritual_dir.join(".activity_history_import_v1.done");
    if marker_path.exists() {
        return Ok(());
    }

    let recovered_db = ritual_dir.join("activity.recovered.db");
    let replica_db = ritual_dir.join("activity.replica-renamed.db");
    let source_path = if recovered_db.exists() {
        recovered_db
    } else if replica_db.exists() {
        replica_db
    } else {
        return Ok(());
    };

    let activity_db = get_activity_db_path();
    initialize_schema_in_blocking_thread(activity_db.clone(), "activity-history-import")?;

    let conn = SqliteConnection::open_with_flags(
        &activity_db,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Failed opening activity.db for historical import: {}", e))?;
    conn.execute_batch("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;")
        .map_err(|e| format!("Failed starting historical activity import: {}", e))?;

    let import_result = import_historical_activity_events_from_source(&conn, &source_path);
    match import_result {
        Ok(imported_rows) => {
            conn.execute_batch("COMMIT; PRAGMA foreign_keys=ON;")
                .map_err(|e| format!("Failed finalizing historical activity import: {}", e))?;
            std::fs::write(
                &marker_path,
                format!(
                    "imported_at={}\nsource={}\ninserted_rows={}\n",
                    Utc::now().timestamp_millis(),
                    source_path.display(),
                    imported_rows
                ),
            )
            .map_err(|e| format!("Failed writing historical activity import marker: {}", e))?;

            db_info!(
                "✅ Historical activity import complete source={} inserted_rows={}",
                source_path.display(),
                imported_rows
            );
            Ok(())
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK; PRAGMA foreign_keys=ON;");
            Err(error)
        }
    }
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
        for table in ["video_chunks", "recorder_stats", "schema_migrations"] {
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
    if let Err(err) = ensure_historical_activity_import() {
        db_error!(
            "⚠️ Historical activity import failed origin={}: {}",
            origin,
            err
        );
    }

    RUNTIME.block_on(async {
        let memory_ready = RITUAL_DB.read().await.is_some();
        let activity_ready = ACTIVITY_DB.read().await.is_some();

        if memory_ready && activity_ready {
            db_info!(
                "⏭️ initialize_database skipped origin={} memory_ready=true activity_ready=true",
                origin
            );
            return Ok(()); // Already initialized
        }

        db_info!(
            "🚀 initialize_database origin={} memory_ready={} activity_ready={}",
            origin,
            memory_ready,
            activity_ready
        );

        if !memory_ready {
            set_memory_runtime_state(DatabaseConnectionState::Reloading, None);
            db_info!("📂 Opening live memory.db handle origin={}", origin);
        }

        if !activity_ready {
            set_activity_runtime_state(DatabaseConnectionState::Reloading, None);
            db_info!("📂 Opening live activity.db handle origin={}", origin);
        }

        let mut first_error: Option<String> = None;

        if !activity_ready {
            if let Err(error) =
                initialize_activity_database_inner(format!("{origin}:activity")).await
            {
                first_error = Some(error);
            }
        }

        if !memory_ready {
            if let Err(error) = initialize_memory_database_inner(format!("{origin}:memory")).await {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }

        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    })
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

pub(crate) async fn get_or_initialize_activity_db(
    origin: &str,
) -> Result<tokio::sync::RwLockReadGuard<'static, Option<RitualDatabase>>, String> {
    {
        let guard = ACTIVITY_DB.read().await;
        if guard.is_some() {
            return Ok(guard);
        }
    }

    let init_origin = origin.to_string();
    let init_result =
        tokio::task::spawn_blocking(move || initialize_activity_database_with_origin(&init_origin))
            .await
            .map_err(|error| format!("Activity database init task failed: {error}"))?;
    init_result?;
    get_activity_db().await
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTimeAttributionHealth {
    pub latest_session_ts: Option<i64>,
    pub session_count: i64,
    pub rollup_count: i64,
    pub unclassified_session_count: i64,
    pub latest_rollup_updated_at: Option<i64>,
}

fn project_time_range_start(days_back: Option<i64>) -> i64 {
    let days = days_back.unwrap_or(3).clamp(1, 90);
    Utc::now()
        .timestamp_millis()
        .saturating_sub(days * 24 * 60 * 60 * 1000)
}

async fn project_time_incremental_range_start(conn: &libsql::Connection) -> Result<i64, String> {
    let now = Utc::now().timestamp_millis();
    let fallback = now.saturating_sub(3 * 24 * 60 * 60 * 1000);
    let mut rows = conn
        .query("SELECT MAX(end_ts) FROM project_time_sessions", ())
        .await
        .map_err(|e| format!("Failed to read project-time watermark: {}", e))?;
    let latest = rows
        .next()
        .await
        .map_err(|e| format!("Failed reading project-time watermark row: {}", e))?
        .and_then(|row| row.get::<Option<i64>>(0).ok().flatten())
        .unwrap_or(0);
    if latest <= 0 {
        return Ok(fallback);
    }
    Ok(latest.saturating_sub(10 * 60 * 1000).max(fallback))
}

pub fn run_project_time_attribution_once(
    days_back: Option<i64>,
    origin: Option<String>,
) -> Result<ProjectTimeRecomputeResult, String> {
    RUNTIME.block_on(async {
        let origin = normalize_db_command_origin(
            origin.as_deref(),
            "tauri:run_project_time_attribution_once:unknown",
        );
        log_db_command("run_project_time_attribution_once", &origin, "");
        let active_identity = resolve_active_identity().ok_or_else(|| {
            "Cannot run project-time attribution without an active Ritual user/device identity."
                .to_string()
        })?;
        let guard = get_activity_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;
        let start_ts = match days_back {
            Some(_) => project_time_range_start(days_back),
            None => project_time_incremental_range_start(&conn).await?,
        };
        let end_ts = Utc::now().timestamp_millis().saturating_add(60_000);
        ProjectTimeOps::new(&conn)
            .recompute_range(
                start_ts,
                end_ts,
                Some(&active_identity.user_id),
                Some(&active_identity.device_id),
            )
            .await
            .map_err(|e| format!("Failed to recompute project-time attribution: {}", e))
    })
}

pub fn run_project_time_retention_once(
    retention_days: Option<i64>,
    origin: Option<String>,
) -> Result<ProjectTimeRetentionResult, String> {
    RUNTIME.block_on(async {
        let origin = normalize_db_command_origin(
            origin.as_deref(),
            "tauri:run_project_time_retention_once:unknown",
        );
        log_db_command("run_project_time_retention_once", &origin, "");
        let guard = get_activity_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;
        ProjectTimeOps::new(&conn)
            .run_retention(retention_days)
            .await
            .map_err(|e| format!("Failed to run project-time retention: {}", e))
    })
}

#[tauri::command]
pub fn get_project_time_attribution_health(
    origin: Option<String>,
) -> Result<ProjectTimeAttributionHealth, String> {
    RUNTIME.block_on(async {
        let origin = normalize_db_command_origin(
            origin.as_deref(),
            "tauri:get_project_time_attribution_health:unknown",
        );
        log_db_command("get_project_time_attribution_health", &origin, "");
        let guard = get_activity_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;
        let mut rows = conn
            .query(
                r#"
                SELECT
                    (SELECT MAX(end_ts) FROM project_time_sessions),
                    (SELECT COUNT(*) FROM project_time_sessions),
                    (SELECT COUNT(*) FROM project_time_daily_rollups),
                    (SELECT COUNT(*) FROM project_time_sessions WHERE project_key = 'unclassified'),
                    (SELECT MAX(updated_at) FROM project_time_daily_rollups)
                "#,
                (),
            )
            .await
            .map_err(|e| format!("Failed to read project-time health: {}", e))?;
        let row = rows
            .next()
            .await
            .map_err(|e| format!("Failed reading project-time health row: {}", e))?
            .ok_or_else(|| "Project-time health row missing".to_string())?;

        Ok(ProjectTimeAttributionHealth {
            latest_session_ts: row.get::<Option<i64>>(0).ok().flatten(),
            session_count: row.get::<i64>(1).unwrap_or(0),
            rollup_count: row.get::<i64>(2).unwrap_or(0),
            unclassified_session_count: row.get::<i64>(3).unwrap_or(0),
            latest_rollup_updated_at: row.get::<Option<i64>>(4).ok().flatten(),
        })
    })
}

pub fn spawn_project_time_attribution_worker() {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(20)).await;
        loop {
            match tauri::async_runtime::spawn_blocking(|| {
                let attribution = run_project_time_attribution_once(
                    None,
                    Some("worker:project_time_attribution".to_string()),
                );
                let retention = run_project_time_retention_once(
                    Some(30),
                    Some("worker:project_time_retention".to_string()),
                );
                (attribution, retention)
            })
            .await
            {
                Ok((Ok(result), Ok(retention))) => {
                    db_info!(
                        "🧭 project-time attribution sessions={} rollups={} delta_ms={} retention_deleted={} raw_snapshots={}",
                        result.sessions_written,
                        result.rollups_written,
                        result.active_ms_delta,
                        retention.local_evidence_deleted,
                        retention.context_snapshots_deleted
                    );
                }
                Ok((Err(error), _)) => {
                    db_error!("Project-time attribution worker failed: {}", error);
                }
                Ok((_, Err(error))) => {
                    db_error!("Project-time retention worker failed: {}", error);
                }
                Err(error) => {
                    db_error!("Project-time worker task join failed: {}", error);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });
}
