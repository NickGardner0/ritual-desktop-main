//! Ritual Database Integration
//!
//! This module provides access to the unified libSQL database with vector search.
//! It wraps ritual-db and provides Tauri commands for:
//! - Semantic search across OCR content
//! - Database statistics
//! - Migration status
//! - Background embedding generation
//!
//! The existing rusqlite code continues to work alongside this for backward compatibility.

use chrono::Utc;
use once_cell::sync::Lazy;
use rusqlite::{Connection as SqliteConnection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use ritual_db::{
    blocking::BlockingDatabase,
    segments::ActivitySegment,
    vector::{EmbeddingWorker, VectorOps},
    DatabaseConfig, RitualDatabase, SearchOptions,
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

/// Flag to track if embedding worker is running
static EMBEDDING_WORKER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Flag to signal worker should stop
static EMBEDDING_WORKER_STOP: AtomicBool = AtomicBool::new(false);

/// Flag to track if chunk embedding backfill job is running
static CHUNK_BACKFILL_RUNNING: AtomicBool = AtomicBool::new(false);

/// Shared status for chunk embedding backfill job
static CHUNK_BACKFILL_STATUS: Lazy<Arc<RwLock<ChunkEmbeddingBackfillStatus>>> =
    Lazy::new(|| Arc::new(RwLock::new(ChunkEmbeddingBackfillStatus::default())));

fn normalize_hybrid_weights(fts_weight: f32, vector_weight: f32) -> (f32, f32) {
    let mut fts = if fts_weight.is_finite() && fts_weight >= 0.0 {
        fts_weight
    } else {
        0.0
    };
    let mut vector = if vector_weight.is_finite() && vector_weight >= 0.0 {
        vector_weight
    } else {
        0.0
    };

    let sum = fts + vector;
    if sum <= f32::EPSILON {
        // Safe fallback for degenerate/invalid inputs.
        return (0.3, 0.7);
    }

    fts /= sum;
    vector /= sum;
    (fts, vector)
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

fn activity_database_config_from_env() -> DatabaseConfig {
    match (
        std::env::var("TURSO_SYNC_URL")
            .ok()
            .filter(|s| !s.is_empty()),
        std::env::var("TURSO_AUTH_TOKEN")
            .ok()
            .filter(|s| !s.is_empty()),
    ) {
        (Some(url), Some(token)) => {
            db_info!("🔄 Turso sync enabled for activity.db → {}", url);
            DatabaseConfig::with_turso_sync(get_activity_db_path(), url, token)
        }
        _ => {
            db_info!("📂 Activity DB: local-only mode (no TURSO_SYNC_URL set)");
            DatabaseConfig::with_path(get_activity_db_path())
        }
    }
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

    // Ensure both split DBs have the expected schema before any copy.
    BlockingDatabase::open_with_path(&activity_db)
        .map_err(|e| format!("Failed to initialize activity.db schema: {}", e))?;
    BlockingDatabase::open_with_path(&memory_db)
        .map_err(|e| format!("Failed to initialize memory.db schema: {}", e))?;

    if !legacy_db.exists() || marker_path.exists() {
        return Ok(());
    }

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
            "search_chunks",
            "search_chunk_frames",
            "chunk_embeddings",
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
pub fn initialize_database() -> Result<(), String> {
    if let Err(err) = ensure_split_local_databases() {
        db_error!("⚠️ Split DB preparation failed: {}", err);
    }

    RUNTIME.block_on(async {
        let mut memory_guard = RITUAL_DB.write().await;
        let mut activity_guard = ACTIVITY_DB.write().await;

        if memory_guard.is_some() && activity_guard.is_some() {
            return Ok(()); // Already initialized
        }

        let memory_config = DatabaseConfig::with_path(get_memory_db_path());

        // Activity DB supports optional Turso cloud sync via env vars.
        // When set, the local activity.db becomes an embedded replica that
        // auto-syncs to Turso cloud, making screen data available to the
        // Railway production backend.
        let activity_config = activity_database_config_from_env();

        let memory_db = RitualDatabase::open(&memory_config).await.map_err(|e| {
            db_error!("❌ Failed to initialize memory database: {}", e);
            format!("Failed to initialize memory database: {}", e)
        })?;

        let activity_db = RitualDatabase::open(&activity_config).await.map_err(|e| {
            db_error!("❌ Failed to initialize activity database: {}", e);
            format!("Failed to initialize activity database: {}", e)
        })?;

        db_info!(
            "✅ Memory database initialized at {:?}",
            memory_config.db_path
        );
        db_info!(
            "✅ Activity database initialized at {:?}",
            activity_config.db_path
        );

        *memory_guard = Some(memory_db);
        *activity_guard = Some(activity_db);
        Ok(())
    })
}

pub fn reload_activity_database() -> Result<(), String> {
    if let Err(err) = ensure_split_local_databases() {
        db_error!(
            "⚠️ Split DB preparation failed before activity reload: {}",
            err
        );
    }

    RUNTIME.block_on(async {
        let activity_config = activity_database_config_from_env();
        let activity_db = RitualDatabase::open(&activity_config).await.map_err(|e| {
            db_error!("❌ Failed to reload activity database: {}", e);
            format!("Failed to reload activity database: {}", e)
        })?;

        let mut activity_guard = ACTIVITY_DB.write().await;
        let previous = activity_guard.take();
        *activity_guard = Some(activity_db);
        drop(previous);

        db_info!(
            "✅ Activity database reloaded at {:?}",
            activity_config.db_path
        );
        Ok(())
    })
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
pub fn init_ritual_database() -> Result<String, String> {
    initialize_database()?;
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

/// Semantic search result for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchResult {
    pub frame_id: i64,
    pub timestamp: i64,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub ocr_text: String,
    pub thumbnail_path: Option<String>,
    pub video_chunk_id: Option<i64>,
    pub frame_offset: Option<i64>,
    pub relevance_score: f32,
}

/// Semantic search options from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SemanticSearchOptions {
    pub query: String,
    pub limit: Option<usize>,
    pub min_relevance: Option<f32>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub app_filter: Option<Vec<String>>,
}

/// Initialize the embedding service for semantic search
#[tauri::command]
pub fn init_embedding_service() -> Result<String, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        db.init_embedding_service()
            .await
            .map_err(|e| format!("Failed to init embedding service: {}", e))?;

        Ok("Embedding service initialized".to_string())
    })
}

/// Get embedding statistics
#[tauri::command]
pub fn get_embedding_stats() -> Result<EmbeddingStatsResponse, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        let stats = db
            .get_embedding_stats()
            .await
            .map_err(|e| format!("Failed to get embedding stats: {}", e))?;

        Ok(EmbeddingStatsResponse {
            total_embeddings: stats.total_embeddings,
            frames_without_embeddings: stats.frames_without_embeddings,
            pending_chunks: stats.pending_chunks,
            embedding_dimension: stats.embedding_dimension,
            current_model: stats.current_model,
            worker_running: stats.worker_running,
            last_worker_run: stats.last_worker_run,
        })
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingStatsResponse {
    pub total_embeddings: i64,
    pub frames_without_embeddings: i64,
    pub pending_chunks: i64,
    pub embedding_dimension: i64,
    pub current_model: String,
    pub worker_running: bool,
    pub last_worker_run: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkEmbeddingCoverageResponse {
    pub total_chunks: i64,
    pub embedded_chunks: i64,
    pub pending_chunks: i64,
    pub coverage: f64,
    pub frames_without_embeddings: i64,
    pub worker_running: bool,
    pub last_worker_run: Option<i64>,
}

/// Get chunk embedding coverage stats for UI progress/health.
#[tauri::command]
pub fn get_chunk_embedding_coverage() -> Result<ChunkEmbeddingCoverageResponse, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;
        let vector_ops = VectorOps::new(&conn);

        let (total_chunks, embedded_chunks, pending_chunks) = vector_ops
            .get_chunk_embedding_counts()
            .await
            .map_err(|e| format!("Failed to get chunk embedding counts: {}", e))?;

        let stats = db
            .get_embedding_stats()
            .await
            .map_err(|e| format!("Failed to get embedding stats: {}", e))?;

        let coverage = if total_chunks > 0 {
            embedded_chunks as f64 / total_chunks as f64
        } else {
            1.0
        };

        Ok(ChunkEmbeddingCoverageResponse {
            total_chunks,
            embedded_chunks,
            pending_chunks,
            coverage,
            frames_without_embeddings: stats.frames_without_embeddings,
            worker_running: stats.worker_running || EMBEDDING_WORKER_RUNNING.load(Ordering::SeqCst),
            last_worker_run: stats.last_worker_run,
        })
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingPipelineReadyResponse {
    pub initialized: bool,
    pub init_error: Option<String>,
    pub total_embeddings: i64,
    pub frames_without_embeddings: i64,
    pub pending_chunks: i64,
    pub worker_running: bool,
    pub worker_started: bool,
}

async fn ensure_embedding_pipeline_ready_inner() -> Result<EmbeddingPipelineReadyResponse, String> {
    let guard = get_db().await?;
    let db = require_db_ref(guard.as_ref())?;

    let init_error = match db.init_embedding_service().await {
        Ok(()) => None,
        Err(e) => Some(format!("Failed to init embedding service: {}", e)),
    };

    let stats = db
        .get_embedding_stats()
        .await
        .map_err(|e| format!("Failed to get embedding stats: {}", e))?;

    let mut worker_running = EMBEDDING_WORKER_RUNNING.load(Ordering::SeqCst);
    let mut worker_started = false;
    // Keep the worker running continuously once the embedding stack is initialized.
    // Otherwise a startup-time zero backlog can leave future OCR/chunk work unprocessed.
    let should_start_worker = init_error.is_none() && !worker_running;

    drop(guard);

    if should_start_worker {
        match start_embedding_worker() {
            Ok(_) => {
                worker_running = true;
                worker_started = true;
            }
            Err(e) => {
                db_error!("⚠️ Failed to auto-start embedding worker: {}", e);
            }
        }
    }

    Ok(EmbeddingPipelineReadyResponse {
        initialized: init_error.is_none(),
        init_error,
        total_embeddings: stats.total_embeddings,
        frames_without_embeddings: stats.frames_without_embeddings,
        pending_chunks: stats.pending_chunks,
        worker_running,
        worker_started,
    })
}

/// Ensure embedding model is ready and worker is running when backlog exists.
#[tauri::command]
pub fn ensure_embedding_pipeline_ready() -> Result<EmbeddingPipelineReadyResponse, String> {
    RUNTIME.block_on(async { ensure_embedding_pipeline_ready_inner().await })
}

/// Emit a one-line startup snapshot for chunk rebuild + outbox upload readiness.
pub fn log_startup_pipeline_snapshot() -> Result<(), String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;

        let embedding_stats = db
            .get_embedding_stats()
            .await
            .map_err(|e| format!("Failed to get embedding stats for startup snapshot: {}", e))?;

        let search_chunks_total = {
            let mut rows = conn
                .query("SELECT COUNT(*) FROM search_chunks", ())
                .await
                .map_err(|e| format!("Failed to count search_chunks: {}", e))?;
            rows.next()
                .await
                .map_err(|e| format!("Failed reading search_chunks count row: {}", e))?
                .map(|row| row.get::<i64>(0).unwrap_or(0))
                .unwrap_or(0)
        };

        let ocr_max_ts = {
            let mut rows = conn
                .query("SELECT MAX(timestamp) FROM ocr_frames", ())
                .await
                .map_err(|e| format!("Failed to query ocr_frames max timestamp: {}", e))?;
            rows.next()
                .await
                .map_err(|e| format!("Failed reading ocr_frames max timestamp row: {}", e))?
                .and_then(|row| row.get::<Option<i64>>(0).ok().flatten())
        };

        let chunk_max_ts = {
            let mut rows = conn
                .query("SELECT MAX(chunk_end_ts) FROM search_chunks", ())
                .await
                .map_err(|e| format!("Failed to query search_chunks max timestamp: {}", e))?;
            rows.next()
                .await
                .map_err(|e| format!("Failed reading search_chunks max timestamp row: {}", e))?
                .and_then(|row| row.get::<Option<i64>>(0).ok().flatten())
        };

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

        let chunk_lag_s = match (ocr_max_ts, chunk_max_ts) {
            (Some(ocr_ts), Some(chunk_ts)) if ocr_ts > chunk_ts => (ocr_ts - chunk_ts) / 1000,
            _ => 0,
        };

        db_info!(
            "📈 Startup pipeline snapshot: chunks_total={}, chunk_pending_embed={}, frame_pending_embed={}, chunk_lag_s={}, outbox_pending={}, outbox_uploading={}, outbox_failed={}, outbox_uploaded={}",
            search_chunks_total,
            embedding_stats.pending_chunks,
            embedding_stats.frames_without_embeddings,
            chunk_lag_s,
            outbox_pending,
            outbox_uploading,
            outbox_failed,
            outbox_uploaded
        );
        eprintln!(
            "[Ritual][startup] chunks_total={} chunk_pending_embed={} frame_pending_embed={} chunk_lag_s={} outbox_pending={} outbox_uploading={} outbox_failed={} outbox_uploaded={}",
            search_chunks_total,
            embedding_stats.pending_chunks,
            embedding_stats.frames_without_embeddings,
            chunk_lag_s,
            outbox_pending,
            outbox_uploading,
            outbox_failed,
            outbox_uploaded
        );

        Ok(())
    })
}

/// Perform semantic search on OCR content
#[tauri::command]
pub fn semantic_search(
    options: SemanticSearchOptions,
) -> Result<Vec<SemanticSearchResult>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        // Build search options
        let mut search_opts = SearchOptions::new(options.limit.unwrap_or(20));

        if let Some(min) = options.min_relevance {
            search_opts = search_opts.with_min_relevance(min);
        }

        // Handle partial time ranges - if only start_time is provided, search until now
        // If only end_time is provided, search from the beginning
        match (options.start_time, options.end_time) {
            (Some(start), Some(end)) => {
                search_opts = search_opts.with_time_range(start, end);
            }
            (Some(start), None) => {
                let now = Utc::now().timestamp_millis();
                search_opts = search_opts.with_time_range(start, now);
            }
            (None, Some(end)) => {
                search_opts = search_opts.with_time_range(0, end);
            }
            (None, None) => {
                // No time filter - search all data
            }
        }

        if let Some(apps) = options.app_filter {
            search_opts = search_opts.with_apps(apps);
        }

        // Perform search
        let results = db
            .search_semantic(&options.query, search_opts)
            .await
            .map_err(|e| format!("Search failed: {}", e))?;

        // Convert to response format
        let response: Vec<SemanticSearchResult> = results
            .into_iter()
            .map(|r| SemanticSearchResult {
                frame_id: r.frame.id.unwrap_or(0),
                timestamp: r.frame.timestamp,
                app_bundle_id: r.frame.app_bundle_id,
                app_name: r.frame.app_name,
                window_title: r.frame.window_title,
                ocr_text: r.frame.ocr_text,
                thumbnail_path: r.frame.thumbnail_path,
                video_chunk_id: r.frame.video_chunk_id,
                frame_offset: r.frame.frame_offset,
                relevance_score: r.relevance_score,
            })
            .collect();

        Ok(response)
    })
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

/// Hybrid search options from frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSearchOptions {
    pub query: String,
    pub limit: Option<usize>,
    pub min_relevance: Option<f32>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub app_filter: Option<Vec<String>>,
    pub fts_weight: Option<f32>,
    pub vector_weight: Option<f32>,
}

/// Hybrid search result for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridSearchResult {
    pub frame_id: i64,
    pub timestamp: i64,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub ocr_text: String,
    pub thumbnail_path: Option<String>,
    pub video_chunk_id: Option<i64>,
    pub frame_offset: Option<i64>,
    pub fts_matched: bool,
    pub vector_distance: f32,
    pub combined_score: f32,
}

/// Hybrid search combining FTS and vector similarity (recommended)
#[tauri::command]
pub fn hybrid_search(options: HybridSearchOptions) -> Result<Vec<HybridSearchResult>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        // Build search options
        let mut search_opts = SearchOptions::new(options.limit.unwrap_or(20));

        if let Some(min) = options.min_relevance {
            search_opts = search_opts.with_min_relevance(min);
        }

        // Handle partial time ranges - if only start_time is provided, search until now
        // If only end_time is provided, search from the beginning
        match (options.start_time, options.end_time) {
            (Some(start), Some(end)) => {
                search_opts = search_opts.with_time_range(start, end);
            }
            (Some(start), None) => {
                let now = Utc::now().timestamp_millis();
                search_opts = search_opts.with_time_range(start, now);
            }
            (None, Some(end)) => {
                search_opts = search_opts.with_time_range(0, end);
            }
            (None, None) => {
                // No time filter - search all data
            }
        }

        if let Some(apps) = options.app_filter {
            search_opts = search_opts.with_apps(apps);
        }

        let (fts_weight, vector_weight) = normalize_hybrid_weights(
            options.fts_weight.unwrap_or(0.3),
            options.vector_weight.unwrap_or(0.7),
        );

        // Perform hybrid search
        let results = db
            .search_hybrid(&options.query, search_opts, fts_weight, vector_weight)
            .await
            .map_err(|e| format!("Hybrid search failed: {}", e))?;

        // Convert to response format
        let response: Vec<HybridSearchResult> = results
            .into_iter()
            .map(|r| HybridSearchResult {
                frame_id: r.frame.id.unwrap_or(0),
                timestamp: r.frame.timestamp,
                app_bundle_id: r.frame.app_bundle_id,
                app_name: r.frame.app_name,
                window_title: r.frame.window_title,
                ocr_text: r.frame.ocr_text,
                thumbnail_path: r.frame.thumbnail_path,
                video_chunk_id: r.frame.video_chunk_id,
                frame_offset: r.frame.frame_offset,
                fts_matched: r.fts_matched,
                vector_distance: r.vector_distance,
                combined_score: r.combined_score,
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

/// Process embeddings for frames that don't have them yet
#[tauri::command]
pub fn process_embeddings(batch_size: Option<usize>) -> Result<ProcessEmbeddingsResult, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        
        // Ensure embedding service is initialized
        db.init_embedding_service().await
            .map_err(|e| format!("Failed to init embedding service: {}", e))?;
        
        // Get embedding backlog counts first
        let stats_before = db.get_embedding_stats().await
            .map_err(|e| format!("Failed to get stats: {}", e))?;
        
        if stats_before.frames_without_embeddings == 0 && stats_before.pending_chunks == 0 {
            return Ok(ProcessEmbeddingsResult {
                processed: 0,
                remaining: 0,
                failed: 0,
                message: "All frame and chunk embeddings are up to date".to_string(),
            });
        }
        
        // Create embedding worker and process a batch
        let worker = EmbeddingWorker::new(batch_size.unwrap_or(50), 0);
        
        // Get connection and embedding service
        let conn = db.connection().await;
        let service_guard = db.embedding_service().await
            .ok_or_else(|| "Embedding service not initialized".to_string())?;
        let service = service_guard.as_ref()
            .ok_or_else(|| "Embedding service not available".to_string())?;
        
        // Process the batch
        let result = worker.process_batch(&conn, service).await
            .map_err(|e| format!("Failed to process embeddings: {}", e))?;
        
        // Get updated stats
        let stats_after = db.get_embedding_stats().await
            .map_err(|e| format!("Failed to get stats: {}", e))?;
        
        Ok(ProcessEmbeddingsResult {
            processed: result.processed as i64,
            remaining: stats_after.frames_without_embeddings + stats_after.pending_chunks,
            failed: result.failed as i64,
            message: format!(
                "Processed {} frame embeddings ({} failed), {} remaining backlog entries (frames + chunks)",
                result.processed,
                result.failed,
                stats_after.frames_without_embeddings + stats_after.pending_chunks
            ),
        })
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessEmbeddingsResult {
    pub processed: i64,
    pub remaining: i64,
    pub failed: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackfillChunkEmbeddingsResult {
    pub success: bool,
    pub lookback_days: i64,
    pub batch_size: i64,
    pub max_batches: i64,
    pub batches_run: i64,
    pub chunks_rebuilt: i64,
    pub queue_seeded: i64,
    pub chunk_embeddings_processed: i64,
    pub chunk_embeddings_failed: i64,
    pub chunk_embeddings_skipped: i64,
    pub total_chunks_before: i64,
    pub total_chunks_after: i64,
    pub embedded_chunks_before: i64,
    pub embedded_chunks_after: i64,
    pub pending_chunks_before: i64,
    pub pending_chunks_after: i64,
    pub coverage_before: f64,
    pub coverage_after: f64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChunkEmbeddingBackfillStatus {
    pub running: bool,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub last_message: Option<String>,
    pub last_error: Option<String>,
    pub last_result: Option<BackfillChunkEmbeddingsResult>,
}

async fn run_backfill_chunk_embeddings_inner(
    batch_size: Option<usize>,
    max_batches: Option<usize>,
    lookback_days: Option<i64>,
) -> Result<BackfillChunkEmbeddingsResult, String> {
    let guard = get_db().await?;
    let db = require_db_ref(guard.as_ref())?;

    db.init_embedding_service()
        .await
        .map_err(|e| format!("Failed to init embedding service: {}", e))?;

    let conn = db.connection().await;
    let vector_ops = VectorOps::new(&conn);
    let service_guard = db
        .embedding_service()
        .await
        .ok_or_else(|| "Embedding service not initialized".to_string())?;
    let service = service_guard
        .as_ref()
        .ok_or_else(|| "Embedding service not available".to_string())?;

    let safe_batch_size = batch_size.unwrap_or(128).clamp(16, 512);
    let safe_max_batches = max_batches.unwrap_or(60).clamp(1, 2000);
    let safe_lookback_days = lookback_days.unwrap_or(3650).clamp(1, 3650);
    let lookback_ms = safe_lookback_days
        .saturating_mul(24)
        .saturating_mul(60)
        .saturating_mul(60)
        .saturating_mul(1000);
    let reconcile_lookback_ms = lookback_ms.min(7 * 24 * 60 * 60 * 1000);
    let historical_frame_batch = safe_batch_size.saturating_mul(16).clamp(256, 2000);

    let (total_chunks_before, embedded_chunks_before, pending_chunks_before) = vector_ops
        .get_chunk_embedding_counts()
        .await
        .map_err(|e| format!("Failed to read chunk embedding counts: {}", e))?;

    let mut chunks_rebuilt = vector_ops
        .rebuild_recent_search_chunks(reconcile_lookback_ms)
        .await
        .map_err(|e| format!("Failed to rebuild chunks: {}", e))?
        as i64;
    let mut queue_seeded = vector_ops
        .ensure_chunk_embedding_queue()
        .await
        .map_err(|e| format!("Failed to seed chunk queue: {}", e))?
        as i64;

    let mut batches_run = 0i64;
    let mut total_processed = 0i64;
    let mut total_failed = 0i64;
    let mut total_skipped = 0i64;

    while (batches_run as usize) < safe_max_batches {
        let rebuilt_oldest = vector_ops
            .rebuild_oldest_missing_search_chunks(historical_frame_batch)
            .await
            .map_err(|e| format!("Failed to rebuild oldest missing chunks: {}", e))?
            as i64;
        chunks_rebuilt += rebuilt_oldest;

        queue_seeded += vector_ops
            .ensure_chunk_embedding_queue()
            .await
            .map_err(|e| format!("Failed to seed chunk queue: {}", e))?
            as i64;

        let (processed, failed, skipped) = vector_ops
            .embed_pending_chunks(
                service,
                safe_batch_size
                    .saturating_mul(4)
                    .clamp(safe_batch_size, 1024),
            )
            .await
            .map_err(|e| format!("Failed to embed pending chunks: {}", e))?;

        batches_run += 1;
        total_processed += processed as i64;
        total_failed += failed as i64;
        total_skipped += skipped as i64;

        let (_, _, pending_now) = vector_ops
            .get_chunk_embedding_counts()
            .await
            .map_err(|e| format!("Failed to read chunk embedding counts: {}", e))?;
        if pending_now <= 0 && rebuilt_oldest <= 0 {
            break;
        }
        if rebuilt_oldest <= 0 && processed == 0 && failed == 0 && skipped == 0 {
            break;
        }
    }

    let (total_chunks_after, embedded_chunks_after, pending_chunks_after) = vector_ops
        .get_chunk_embedding_counts()
        .await
        .map_err(|e| format!("Failed to read chunk embedding counts: {}", e))?;

    let coverage_before = if total_chunks_before > 0 {
        embedded_chunks_before as f64 / total_chunks_before as f64
    } else {
        1.0
    };
    let coverage_after = if total_chunks_after > 0 {
        embedded_chunks_after as f64 / total_chunks_after as f64
    } else {
        1.0
    };

    Ok(BackfillChunkEmbeddingsResult {
        success: true,
        lookback_days: safe_lookback_days,
        batch_size: safe_batch_size as i64,
        max_batches: safe_max_batches as i64,
        batches_run,
        chunks_rebuilt,
        queue_seeded,
        chunk_embeddings_processed: total_processed,
        chunk_embeddings_failed: total_failed,
        chunk_embeddings_skipped: total_skipped,
        total_chunks_before,
        total_chunks_after,
        embedded_chunks_before,
        embedded_chunks_after,
        pending_chunks_before,
        pending_chunks_after,
        coverage_before,
        coverage_after,
        message: format!(
            "Chunk backfill complete: rebuilt {}, queued {}, processed {}, failed {}, pending {} -> {} (coverage {:.1}% -> {:.1}%).",
            chunks_rebuilt,
            queue_seeded,
            total_processed,
            total_failed,
            pending_chunks_before,
            pending_chunks_after,
            coverage_before * 100.0,
            coverage_after * 100.0,
        ),
    })
}

/// Backfill chunk embeddings with a durable queue + batched embedding path.
#[tauri::command]
pub fn backfill_chunk_embeddings(
    batch_size: Option<usize>,
    max_batches: Option<usize>,
    lookback_days: Option<i64>,
) -> Result<BackfillChunkEmbeddingsResult, String> {
    RUNTIME.block_on(async {
        run_backfill_chunk_embeddings_inner(batch_size, max_batches, lookback_days).await
    })
}

/// Start chunk embedding backfill in the background (non-blocking for UI).
#[tauri::command]
pub fn start_chunk_embedding_backfill(
    batch_size: Option<usize>,
    max_batches: Option<usize>,
    lookback_days: Option<i64>,
) -> Result<String, String> {
    if CHUNK_BACKFILL_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok("Chunk embedding backfill already running".to_string());
    }

    RUNTIME.spawn(async move {
        {
            let mut status = CHUNK_BACKFILL_STATUS.write().await;
            status.running = true;
            status.started_at = Some(Utc::now().timestamp_millis());
            status.finished_at = None;
            status.last_message = Some("Chunk embedding backfill started".to_string());
            status.last_error = None;
            status.last_result = None;
        }

        let run_result =
            run_backfill_chunk_embeddings_inner(batch_size, max_batches, lookback_days).await;
        let finished_at = Utc::now().timestamp_millis();

        {
            let mut status = CHUNK_BACKFILL_STATUS.write().await;
            status.running = false;
            status.finished_at = Some(finished_at);
            match run_result {
                Ok(result) => {
                    status.last_message = Some(result.message.clone());
                    status.last_error = None;
                    status.last_result = Some(result);
                }
                Err(e) => {
                    status.last_message = Some("Chunk embedding backfill failed".to_string());
                    status.last_error = Some(e);
                    status.last_result = None;
                }
            }
        }

        CHUNK_BACKFILL_RUNNING.store(false, Ordering::SeqCst);
    });

    Ok("Chunk embedding backfill started".to_string())
}

/// Get current status of the background chunk embedding backfill.
#[tauri::command]
pub fn get_chunk_embedding_backfill_status() -> Result<ChunkEmbeddingBackfillStatus, String> {
    RUNTIME.block_on(async {
        let mut status = CHUNK_BACKFILL_STATUS.read().await.clone();
        status.running = CHUNK_BACKFILL_RUNNING.load(Ordering::SeqCst);
        Ok(status)
    })
}

/// Start the background embedding worker
#[tauri::command]
pub fn start_embedding_worker() -> Result<String, String> {
    if EMBEDDING_WORKER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok("Embedding worker already running".to_string());
    }

    // Reset stop flag
    EMBEDDING_WORKER_STOP.store(false, Ordering::SeqCst);

    // Spawn the worker on the runtime
    RUNTIME.spawn(async move {
        db_info!("🔄 Starting background embedding worker...");
        let mut init_fail_streak: u32 = 0;

        loop {
            // Check if we should stop
            if EMBEDDING_WORKER_STOP.load(Ordering::SeqCst) {
                db_info!("🛑 Embedding worker stopping...");
                break;
            }
            
            // Try to process a batch - all in one scope for clean borrow handling
            let (processed, sleep_duration, selected_batch_size, pending_frames, pending_chunks) = async {
                let db_guard = RITUAL_DB.read().await;
                let db = match db_guard.as_ref() {
                    Some(db) => db,
                    None => {
                        return (
                            false,
                            std::time::Duration::from_secs(30),
                            50usize,
                            0i64,
                            0i64,
                        )
                    }
                };
                
                // Keep chunking alive even if embedding model init is temporarily failing.
                // This prevents OCR->chunk freshness from stalling behind local model issues.
                let conn = db.connection().await;
                let vector_ops = VectorOps::new(&conn);
                match vector_ops.rebuild_incremental_search_chunks().await {
                    Ok(inserted) => {
                        if inserted > 0 {
                            db_info!("🧩 Incremental chunk rebuild inserted {} chunks", inserted);
                        }
                    }
                    Err(e) => {
                        let err_text = e.to_string();
                        if err_text.to_ascii_lowercase().contains("database is locked") {
                            db_info!("⏳ Incremental chunk rebuild skipped due to active writer lock");
                        } else {
                            db_error!("⚠️ Incremental chunk rebuild failed: {}", e);
                            eprintln!("[Ritual][worker] incremental chunk rebuild failed: {}", e);
                        }
                    }
                }

                match vector_ops.rebuild_oldest_missing_search_chunks(250).await {
                    Ok(inserted) => {
                        if inserted > 0 {
                            db_info!("🧱 Historical chunk rebuild inserted {} chunks", inserted);
                        }
                    }
                    Err(e) => {
                        let err_text = e.to_string();
                        if err_text.to_ascii_lowercase().contains("database is locked") {
                            db_info!("⏳ Historical chunk rebuild skipped due to active writer lock");
                        } else {
                            db_error!("⚠️ Historical chunk rebuild failed: {}", e);
                            eprintln!("[Ritual][worker] historical chunk rebuild failed: {}", e);
                        }
                    }
                }

                if let Err(e) = vector_ops.ensure_chunk_embedding_queue().await {
                    db_error!("⚠️ Failed to seed chunk embedding queue: {}", e);
                    eprintln!("[Ritual][worker] chunk queue seed failed: {}", e);
                }

                // Ensure embedding service is initialized
                if let Err(e) = db.init_embedding_service().await {
                    db_error!("⚠️ Failed to init embedding service: {}", e);
                    init_fail_streak = init_fail_streak.saturating_add(1);
                    if init_fail_streak <= 3 || init_fail_streak % 10 == 0 {
                        eprintln!(
                            "[Ritual][worker] embedding service init failed (streak={}): {}",
                            init_fail_streak,
                            e
                        );
                    }
                    return (
                        false,
                        std::time::Duration::from_secs(5),
                        50usize,
                        0i64,
                        0i64,
                    );
                }
                init_fail_streak = 0;
                
                let (pending_frames, pending_chunks) = match db.get_embedding_stats().await {
                    Ok(stats) => (stats.frames_without_embeddings, stats.pending_chunks),
                    Err(_) => (0, 0),
                };
                let (batch_size, sleep_duration) = if pending_chunks > 1_000 {
                    (256usize, std::time::Duration::from_millis(250))
                } else if pending_chunks > 250 {
                    (192usize, std::time::Duration::from_secs(1))
                } else if pending_chunks > 0 {
                    (128usize, std::time::Duration::from_secs(3))
                } else if pending_frames > 1_000 {
                    (64usize, std::time::Duration::from_secs(5))
                } else if pending_frames > 0 {
                    (48usize, std::time::Duration::from_secs(15))
                } else {
                    (32usize, std::time::Duration::from_secs(30))
                };
                let worker = EmbeddingWorker::new(batch_size, 30);

                // Get service
                let service_opt = db.embedding_service().await;
                let service_guard = match service_opt {
                    Some(guard) => guard,
                    None => {
                        eprintln!("[Ritual][worker] embedding service unavailable after init");
                        return (
                            false,
                            sleep_duration,
                            batch_size,
                            pending_frames,
                            pending_chunks,
                        )
                    }
                };
                let service = match service_guard.as_ref() {
                    Some(s) => s,
                    None => {
                        eprintln!("[Ritual][worker] embedding service guard empty");
                        return (
                            false,
                            sleep_duration,
                            batch_size,
                            pending_frames,
                            pending_chunks,
                        )
                    }
                };
                
                // Process a batch
                match worker.process_batch(&conn, service).await {
                    Ok(result) => {
                        if result.processed > 0 || result.failed > 0 {
                            db_info!(
                                "📊 Embedding worker: {} processed, {} failed, {} skipped",
                                result.processed, result.failed, result.skipped
                            );
                        }
                        (
                            true,
                            sleep_duration,
                            batch_size,
                            pending_frames,
                            pending_chunks,
                        )
                    }
                    Err(e) => {
                        db_error!("⚠️ Embedding worker error: {}", e);
                        (
                            false,
                            sleep_duration,
                            batch_size,
                            pending_frames,
                            pending_chunks,
                        )
                    }
                }
            }.await;
            
            // Sleep between batches (all locks released by now)
            let _ = processed; // suppress unused warning in release without debug logging
            if selected_batch_size > 50 || pending_chunks > 0 {
                log::debug!(
                    "[DB] Embedding worker cadence: batch={}, sleep_ms={}, pending_frames={}, pending_chunks={}",
                    selected_batch_size,
                    sleep_duration.as_millis(),
                    pending_frames,
                    pending_chunks
                );
            }
            tokio::time::sleep(sleep_duration).await;
        }
        
        EMBEDDING_WORKER_STOP.store(false, Ordering::SeqCst);
        EMBEDDING_WORKER_RUNNING.store(false, Ordering::SeqCst);
        db_info!("✅ Embedding worker stopped");
    });

    Ok("Embedding worker started".to_string())
}

/// Stop the background embedding worker
#[tauri::command]
pub fn stop_embedding_worker() -> Result<String, String> {
    if !EMBEDDING_WORKER_RUNNING.load(Ordering::SeqCst) {
        return Ok("Embedding worker not running".to_string());
    }

    EMBEDDING_WORKER_STOP.store(true, Ordering::SeqCst);
    Ok("Stop signal sent to embedding worker".to_string())
}

/// Check if embedding worker is running
#[tauri::command]
pub fn is_embedding_worker_running() -> bool {
    EMBEDDING_WORKER_RUNNING.load(Ordering::SeqCst)
}

/// Auto-start embedding worker if there are frames without embeddings
pub fn auto_start_embedding_worker() {
    RUNTIME.spawn(async {
        // Wait a bit for database to be ready
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        match ensure_embedding_pipeline_ready_inner().await {
            Ok(status) => {
                if status.frames_without_embeddings > 0 || status.pending_chunks > 0 {
                    db_info!(
                        "📊 Embedding pipeline ready: frame_pending={}, chunk_pending={}, worker_running={}, worker_started={}",
                        status.frames_without_embeddings,
                        status.pending_chunks,
                        status.worker_running,
                        status.worker_started
                    );
                }
                if let Some(error) = status.init_error {
                    db_error!("⚠️ Embedding model init error during auto-start: {}", error);
                }
            }
            Err(e) => {
                db_error!("⚠️ Failed to ensure embedding pipeline readiness: {}", e);
            }
        }
    });
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

/// Seed upload outbox rows from local search_chunks for cloud ingestion.
#[tauri::command]
pub fn seed_memory_upload_outbox(
    limit: Option<usize>,
) -> Result<MemoryUploadOutboxSeedResult, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;
        let now = Utc::now().timestamp_millis();
        let fresh_cutoff = now.saturating_sub(2 * 60 * 60 * 1000);
        let safe_limit = limit.unwrap_or(500).clamp(1, 10_000) as i64;
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
                    COALESCE(NULLIF(src.user_id, ''), 'local-user'),
                    COALESCE(NULLIF(src.device_id, ''), 'local-device'),
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
                libsql::params![now, now, fresh_cutoff, safe_limit],
            ).await.map_err(|e| format!("Failed to seed context session docs into memory upload outbox: {}", e))? as i64;
        }

        inserted += conn.execute(
            r#"
            INSERT INTO memory_upload_outbox
            (user_id, device_id, chunk_id, logical_chunk_id, content_hash, payload_json, status, retry_count, next_retry_at, last_error, created_at, updated_at)
            SELECT
                COALESCE(NULLIF(src.user_id, ''), 'local-user'),
                COALESCE(NULLIF(src.device_id, ''), 'local-device'),
                src.id,
                COALESCE(NULLIF(src.logical_chunk_id, ''), printf('local-search-chunk-%d', src.id)),
                COALESCE(NULLIF(src.content_hash, ''), printf('legacy-%d-%d-%d', src.id, src.chunk_start_ts, src.chunk_end_ts)),
                json_object(
                    'chunk_id', COALESCE(NULLIF(src.logical_chunk_id, ''), printf('local-search-chunk-%d', src.id)),
                    'logical_chunk_id', COALESCE(NULLIF(src.logical_chunk_id, ''), printf('local-search-chunk-%d', src.id)),
                    'chunk_start_ts', src.chunk_start_ts,
                    'chunk_end_ts', src.chunk_end_ts,
                    'source_kind', 'legacy_ocr_chunk',
                    'session_id', COALESCE(src.session_key, ''),
                    'app_name', COALESCE(src.app_name, ''),
                    'window_title', COALESCE(src.window_title_norm, ''),
                    'document_title', '',
                    'browser_domain', COALESCE(src.browser_domain, ''),
                    'raw_visible_text', COALESCE(src.raw_text_compact, ''),
                    'contextual_retrieval_text', COALESCE(src.contextual_text_compact, COALESCE(src.text_compact, '')),
                    'raw_text_compact', COALESCE(src.raw_text_compact, ''),
                    'contextual_text_compact', COALESCE(src.contextual_text_compact, COALESCE(src.text_compact, '')),
                    'text_compact', COALESCE(src.text_compact, ''),
                    'context_version', COALESCE(src.context_version, 1),
                    'session_key', COALESCE(src.session_key, ''),
                    'session_position', COALESCE(src.session_position, 0),
                    'session_count', COALESCE(src.session_chunk_count, 1),
                    'session_chunk_count', COALESCE(src.session_chunk_count, 1),
                    'quality_score', COALESCE(src.quality_score, 0.0),
                    'capture_quality', COALESCE(src.quality_score, 0.0),
                    'source_frame_ids', json('[]'),
                    'content_hash', COALESCE(NULLIF(src.content_hash, ''), printf('legacy-%d-%d-%d', src.id, src.chunk_start_ts, src.chunk_end_ts))
                ),
                'pending',
                0,
                NULL,
                NULL,
                ?,
                ?
            FROM (
                SELECT s.*
                FROM search_chunks s
                WHERE COALESCE(
                        NULLIF(TRIM(s.contextual_text_compact), ''),
                        NULLIF(TRIM(s.text_compact), '')
                      ) != ''
                ORDER BY
                    CASE
                        WHEN s.chunk_end_ts >= ? THEN 0
                        ELSE 1
                    END ASC,
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM memory_upload_outbox o
                            WHERE o.user_id = COALESCE(NULLIF(s.user_id, ''), 'local-user')
                              AND o.device_id = COALESCE(NULLIF(s.device_id, ''), 'local-device')
                              AND o.logical_chunk_id = COALESCE(NULLIF(s.logical_chunk_id, ''), printf('local-search-chunk-%d', s.id))
                        ) THEN 1
                        ELSE 0
                    END ASC,
                    s.chunk_end_ts DESC
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
            libsql::params![now, now, fresh_cutoff, safe_limit],
        ).await.map_err(|e| format!("Failed to seed memory upload outbox: {}", e))? as i64;

        Ok(MemoryUploadOutboxSeedResult {
            inserted: inserted as i64,
            scanned_limit: safe_limit,
        })
    })
}

/// Get upload outbox health/status for UI and diagnostics.
#[tauri::command]
pub fn get_memory_upload_outbox_stats() -> Result<MemoryUploadOutboxStats, String> {
    RUNTIME.block_on(async {
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
) -> Result<Vec<MemoryUploadOutboxItem>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;
        let conn = db.connection().await;
        let now = Utc::now().timestamp_millis();
        let stale_uploading_cutoff = now.saturating_sub(5 * 60 * 1000);
        let reclaim_next_retry_at = now.saturating_add(15_000);
        let safe_limit = limit.unwrap_or(100).clamp(1, 1000);

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

            items.push(MemoryUploadOutboxItem {
                id,
                user_id: row
                    .get::<String>(1)
                    .unwrap_or_else(|_| "local-user".to_string()),
                device_id: row
                    .get::<String>(2)
                    .unwrap_or_else(|_| "local-device".to_string()),
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
) -> Result<MemoryUploadOutboxAckResult, String> {
    RUNTIME.block_on(async {
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

// ============================================================================
// SEGMENT COMMANDS
// ============================================================================

/// Get segments in a time range
#[tauri::command]
pub fn get_segments_in_range(
    device_id: String,
    ts_start: i64,
    ts_end: i64,
) -> Result<Vec<SegmentResponse>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        let segments = db
            .get_segments_in_range(&device_id, ts_start, ts_end)
            .await
            .map_err(|e| format!("Failed to get segments: {}", e))?;

        Ok(segments.into_iter().map(segment_to_response).collect())
    })
}

/// Get the segment at a specific timestamp
#[tauri::command]
pub fn get_segment_at_time(
    device_id: String,
    timestamp: i64,
) -> Result<Option<SegmentResponse>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        let segment = db
            .get_segment_at_time(&device_id, timestamp)
            .await
            .map_err(|e| format!("Failed to get segment: {}", e))?;

        Ok(segment.map(segment_to_response))
    })
}

/// Get frames for a segment
#[tauri::command]
pub fn get_frames_for_segment(segment_id: i64) -> Result<Vec<TextSearchResult>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        let frames = db
            .get_frames_for_segment(segment_id)
            .await
            .map_err(|e| format!("Failed to get frames: {}", e))?;

        Ok(frames
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
            .collect())
    })
}

/// Create segments from activity events in a time range
#[tauri::command]
pub fn create_segments(
    device_id: String,
    ts_start: i64,
    ts_end: i64,
) -> Result<CreateSegmentsResult, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        let segment_ids = db
            .create_segments(&device_id, ts_start, ts_end)
            .await
            .map_err(|e| format!("Failed to create segments: {}", e))?;

        Ok(CreateSegmentsResult {
            created: segment_ids.len() as i64,
            segment_ids,
        })
    })
}

/// Get segment statistics
#[tauri::command]
pub fn get_segment_stats(
    device_id: String,
    ts_start: i64,
    ts_end: i64,
) -> Result<SegmentStatsResponse, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = require_db_ref(guard.as_ref())?;

        let stats = db
            .get_segment_stats(&device_id, ts_start, ts_end)
            .await
            .map_err(|e| format!("Failed to get segment stats: {}", e))?;

        Ok(SegmentStatsResponse {
            total_segments: stats.total_segments,
            total_duration_ms: stats.total_duration_ms,
            total_frames: stats.total_frames,
            unique_apps: stats.unique_apps,
            unique_kinds: stats.unique_kinds,
        })
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentResponse {
    pub id: i64,
    pub device_id: String,
    pub user_id: String,
    pub ts_start: i64,
    pub ts_end: i64,
    pub app_bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title_normalized: Option<String>,
    pub browser_domain: Option<String>,
    pub segment_kind: String,
    pub duration_ms: i64,
    pub frame_count: i64,
    pub key_topics: Option<String>,
}

fn segment_to_response(seg: ActivitySegment) -> SegmentResponse {
    SegmentResponse {
        id: seg.id.unwrap_or(0),
        device_id: seg.device_id,
        user_id: seg.user_id,
        ts_start: seg.ts_start,
        ts_end: seg.ts_end,
        app_bundle_id: seg.app_bundle_id,
        app_name: seg.app_name,
        window_title_normalized: seg.window_title_normalized,
        browser_domain: seg.browser_domain,
        segment_kind: seg.segment_kind,
        duration_ms: seg.duration_ms,
        frame_count: seg.frame_count,
        key_topics: seg.key_topics,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSegmentsResult {
    pub created: i64,
    pub segment_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentStatsResponse {
    pub total_segments: i64,
    pub total_duration_ms: i64,
    pub total_frames: i64,
    pub unique_apps: i64,
    pub unique_kinds: i64,
}
