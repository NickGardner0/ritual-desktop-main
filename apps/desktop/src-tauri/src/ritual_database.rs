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
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock;

use ritual_db::{
    DatabaseConfig, RitualDatabase,
    SearchOptions,
    vector::EmbeddingWorker,
    segments::ActivitySegment,
};

/// Global database instance (lazy initialized)
pub(crate) static RITUAL_DB: Lazy<Arc<RwLock<Option<RitualDatabase>>>> = 
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

fn normalize_hybrid_weights(fts_weight: f32, vector_weight: f32) -> (f32, f32) {
    let mut fts = if fts_weight.is_finite() && fts_weight >= 0.0 { fts_weight } else { 0.0 };
    let mut vector = if vector_weight.is_finite() && vector_weight >= 0.0 { vector_weight } else { 0.0 };

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

/// Initialize the ritual database (call once at app startup)
pub fn initialize_database() -> Result<(), String> {
    RUNTIME.block_on(async {
        let mut db_guard = RITUAL_DB.write().await;
        
        if db_guard.is_some() {
            return Ok(()); // Already initialized
        }
        
        let config = DatabaseConfig::default();
        
        match RitualDatabase::open(&config).await {
            Ok(db) => {
                println!("✅ Ritual database initialized at {:?}", config.db_path);
                *db_guard = Some(db);
                Ok(())
            }
            Err(e) => {
                eprintln!("❌ Failed to initialize Ritual database: {}", e);
                Err(format!("Failed to initialize database: {}", e))
            }
        }
    })
}

/// Get database or return error
pub(crate) async fn get_db() -> Result<tokio::sync::RwLockReadGuard<'static, Option<RitualDatabase>>, String> {
    let guard = RITUAL_DB.read().await;
    if guard.is_none() {
        return Err("Database not initialized. Call initialize_database() first.".to_string());
    }
    Ok(guard)
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
        let db = guard.as_ref().unwrap();
        
        let stats = db.get_stats().await
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
        let db = guard.as_ref().unwrap();
        
        db.init_embedding_service().await
            .map_err(|e| format!("Failed to init embedding service: {}", e))?;
        
        Ok("Embedding service initialized".to_string())
    })
}

/// Get embedding statistics
#[tauri::command]
pub fn get_embedding_stats() -> Result<EmbeddingStatsResponse, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = guard.as_ref().unwrap();
        
        let stats = db.get_embedding_stats().await
            .map_err(|e| format!("Failed to get embedding stats: {}", e))?;
        
        Ok(EmbeddingStatsResponse {
            total_embeddings: stats.total_embeddings,
            frames_without_embeddings: stats.frames_without_embeddings,
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
    pub embedding_dimension: i64,
    pub current_model: String,
    pub worker_running: bool,
    pub last_worker_run: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingPipelineReadyResponse {
    pub initialized: bool,
    pub init_error: Option<String>,
    pub total_embeddings: i64,
    pub frames_without_embeddings: i64,
    pub worker_running: bool,
    pub worker_started: bool,
}

async fn ensure_embedding_pipeline_ready_inner() -> Result<EmbeddingPipelineReadyResponse, String> {
    let guard = get_db().await?;
    let db = guard.as_ref().unwrap();

    let init_error = match db.init_embedding_service().await {
        Ok(()) => None,
        Err(e) => Some(format!("Failed to init embedding service: {}", e)),
    };

    let stats = db.get_embedding_stats().await
        .map_err(|e| format!("Failed to get embedding stats: {}", e))?;

    let mut worker_running = EMBEDDING_WORKER_RUNNING.load(Ordering::SeqCst);
    let mut worker_started = false;
    let should_start_worker = init_error.is_none() && stats.frames_without_embeddings > 0 && !worker_running;

    drop(guard);

    if should_start_worker {
        match start_embedding_worker() {
            Ok(_) => {
                worker_running = true;
                worker_started = true;
            }
            Err(e) => {
                eprintln!("⚠️ Failed to auto-start embedding worker: {}", e);
            }
        }
    }

    Ok(EmbeddingPipelineReadyResponse {
        initialized: init_error.is_none(),
        init_error,
        total_embeddings: stats.total_embeddings,
        frames_without_embeddings: stats.frames_without_embeddings,
        worker_running,
        worker_started,
    })
}

/// Ensure embedding model is ready and worker is running when backlog exists.
#[tauri::command]
pub fn ensure_embedding_pipeline_ready() -> Result<EmbeddingPipelineReadyResponse, String> {
    RUNTIME.block_on(async { ensure_embedding_pipeline_ready_inner().await })
}

/// Perform semantic search on OCR content
#[tauri::command]
pub fn semantic_search(options: SemanticSearchOptions) -> Result<Vec<SemanticSearchResult>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = guard.as_ref().unwrap();
        
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
        let results = db.search_semantic(&options.query, search_opts).await
            .map_err(|e| format!("Search failed: {}", e))?;
        
        // Convert to response format
        let response: Vec<SemanticSearchResult> = results.into_iter().map(|r| {
            SemanticSearchResult {
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
            }
        }).collect();
        
        Ok(response)
    })
}

/// Text search (full-text search, faster than semantic)
#[tauri::command]
pub fn text_search(query: String, limit: Option<usize>) -> Result<Vec<TextSearchResult>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = guard.as_ref().unwrap();
        
        let results = db.search_ocr_text(&query, limit.unwrap_or(50)).await
            .map_err(|e| format!("Search failed: {}", e))?;
        
        let response: Vec<TextSearchResult> = results.into_iter().map(|f| {
            TextSearchResult {
                frame_id: f.id.unwrap_or(0),
                timestamp: f.timestamp,
                app_bundle_id: f.app_bundle_id,
                app_name: f.app_name,
                window_title: f.window_title,
                ocr_text: f.ocr_text,
                thumbnail_path: f.thumbnail_path,
                video_chunk_id: f.video_chunk_id,
                frame_offset: f.frame_offset,
            }
        }).collect();
        
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
        let db = guard.as_ref().unwrap();
        
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
        let results = db.search_hybrid(&options.query, search_opts, fts_weight, vector_weight).await
            .map_err(|e| format!("Hybrid search failed: {}", e))?;
        
        // Convert to response format
        let response: Vec<HybridSearchResult> = results.into_iter().map(|r| {
            HybridSearchResult {
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
            }
        }).collect();
        
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
        let db = guard.as_ref().unwrap();
        
        // Ensure embedding service is initialized
        db.init_embedding_service().await
            .map_err(|e| format!("Failed to init embedding service: {}", e))?;
        
        // Get frames without embeddings count first
        let stats_before = db.get_embedding_stats().await
            .map_err(|e| format!("Failed to get stats: {}", e))?;
        
        if stats_before.frames_without_embeddings == 0 {
            return Ok(ProcessEmbeddingsResult {
                processed: 0,
                remaining: 0,
                failed: 0,
                message: "All frames have embeddings".to_string(),
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
            remaining: stats_after.frames_without_embeddings,
            failed: result.failed as i64,
            message: format!(
                "Processed {} embeddings ({} failed), {} remaining",
                result.processed, result.failed, stats_after.frames_without_embeddings
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
        println!("🔄 Starting background embedding worker...");
        
        let worker = EmbeddingWorker::new(50, 30); // batch=50, sleep=30s
        
        loop {
            // Check if we should stop
            if EMBEDDING_WORKER_STOP.load(Ordering::SeqCst) {
                println!("🛑 Embedding worker stopping...");
                break;
            }
            
            // Try to process a batch - all in one scope for clean borrow handling
            let processed = async {
                let db_guard = RITUAL_DB.read().await;
                let db = match db_guard.as_ref() {
                    Some(db) => db,
                    None => return false,
                };
                
                // Ensure embedding service is initialized
                if let Err(e) = db.init_embedding_service().await {
                    eprintln!("⚠️ Failed to init embedding service: {}", e);
                    return false;
                }
                
                // Get connection and service
                let conn = db.connection().await;
                let service_opt = db.embedding_service().await;
                let service_guard = match service_opt {
                    Some(guard) => guard,
                    None => return false,
                };
                let service = match service_guard.as_ref() {
                    Some(s) => s,
                    None => return false,
                };
                
                // Process a batch
                match worker.process_batch(&conn, service).await {
                    Ok(result) => {
                        if result.processed > 0 || result.failed > 0 {
                            println!(
                                "📊 Embedding worker: {} processed, {} failed, {} skipped",
                                result.processed, result.failed, result.skipped
                            );
                        }
                        true
                    }
                    Err(e) => {
                        eprintln!("⚠️ Embedding worker error: {}", e);
                        false
                    }
                }
            }.await;
            
            // Sleep between batches (all locks released by now)
            let _ = processed; // Suppress unused warning
            tokio::time::sleep(worker.sleep_duration()).await;
        }
        
        EMBEDDING_WORKER_STOP.store(false, Ordering::SeqCst);
        EMBEDDING_WORKER_RUNNING.store(false, Ordering::SeqCst);
        println!("✅ Embedding worker stopped");
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
                if status.frames_without_embeddings > 0 {
                    println!(
                        "📊 Embedding pipeline ready: {} pending, worker_running={}, worker_started={}",
                        status.frames_without_embeddings,
                        status.worker_running,
                        status.worker_started
                    );
                }
                if let Some(error) = status.init_error {
                    eprintln!("⚠️ Embedding model init error during auto-start: {}", error);
                }
            }
            Err(e) => {
                eprintln!("⚠️ Failed to ensure embedding pipeline readiness: {}", e);
            }
        }
    });
}

/// Check if the ritual.db exists and has been migrated
#[tauri::command]
pub fn check_migration_status() -> Result<MigrationStatus, String> {
    let ritual_dir = get_ritual_dir();
    let ritual_db_path = ritual_dir.join("ritual.db");
    let watcher_db_path = ritual_dir.join("watcher.db");
    let frames_db_path = ritual_dir.join("frames.db");
    
    // Check for migrated backups
    let watcher_migrated = ritual_dir.join("watcher.db.migrated").exists();
    let frames_migrated = ritual_dir.join("frames.db.migrated").exists();
    
    Ok(MigrationStatus {
        ritual_db_exists: ritual_db_path.exists(),
        legacy_watcher_db_exists: watcher_db_path.exists(),
        legacy_frames_db_exists: frames_db_path.exists(),
        watcher_migrated,
        frames_migrated,
        is_fully_migrated: watcher_migrated && frames_migrated,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationStatus {
    pub ritual_db_exists: bool,
    pub legacy_watcher_db_exists: bool,
    pub legacy_frames_db_exists: bool,
    pub watcher_migrated: bool,
    pub frames_migrated: bool,
    pub is_fully_migrated: bool,
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
        let db = guard.as_ref().unwrap();
        
        let segments = db.get_segments_in_range(&device_id, ts_start, ts_end).await
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
        let db = guard.as_ref().unwrap();
        
        let segment = db.get_segment_at_time(&device_id, timestamp).await
            .map_err(|e| format!("Failed to get segment: {}", e))?;
        
        Ok(segment.map(segment_to_response))
    })
}

/// Get frames for a segment
#[tauri::command]
pub fn get_frames_for_segment(segment_id: i64) -> Result<Vec<TextSearchResult>, String> {
    RUNTIME.block_on(async {
        let guard = get_db().await?;
        let db = guard.as_ref().unwrap();
        
        let frames = db.get_frames_for_segment(segment_id).await
            .map_err(|e| format!("Failed to get frames: {}", e))?;
        
        Ok(frames.into_iter().map(|f| TextSearchResult {
            frame_id: f.id.unwrap_or(0),
            timestamp: f.timestamp,
            app_bundle_id: f.app_bundle_id,
            app_name: f.app_name,
            window_title: f.window_title,
            ocr_text: f.ocr_text,
            thumbnail_path: f.thumbnail_path,
            video_chunk_id: f.video_chunk_id,
            frame_offset: f.frame_offset,
        }).collect())
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
        let db = guard.as_ref().unwrap();
        
        let segment_ids = db.create_segments(&device_id, ts_start, ts_end).await
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
        let db = guard.as_ref().unwrap();
        
        let stats = db.get_segment_stats(&device_id, ts_start, ts_end).await
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
