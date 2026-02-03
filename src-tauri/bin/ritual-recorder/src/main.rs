//! Ritual Recorder - Screen recording with OCR for Ritual
//!
//! This is a separate binary that handles:
//! - Continuous screen capture
//! - OCR text extraction using Apple Vision
//! - Thumbnail generation for visual context
//! - Frame deduplication
//! - Tiered storage management
//!
//! Video encoding has been removed to save storage (~97% reduction).
//! Thumbnails + OCR text provide sufficient context for semantic search.
//!
//! Designed to run as a sidecar process alongside the main Ritual app.

mod capture;
mod config;
mod database;
mod dedup;
mod metrics;
mod ocr;
mod storage;
mod thumbnail;
#[cfg(target_os = "macos")]
mod vision_ffi;

// Video-related modules are no longer used
// mod ffmpeg;
// mod video;

use anyhow::Result;
use clap::Parser;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, error, info, warn};

use capture::ScreenCapture;
use config::RecorderConfig;
use database::{get_current_activity_from_watcher, OcrFrame, RecorderDatabase};
use dedup::FrameDeduplicator;
use metrics::RecorderMetrics;
use ocr::OcrProcessor;
use storage::StorageManager;
use thumbnail::ThumbnailGenerator;

/// CLI arguments for Ritual Recorder
#[derive(Parser, Debug)]
#[command(name = "ritual-recorder")]
#[command(about = "Screen recording with OCR for Ritual")]
#[command(version)]
pub struct Args {
    /// Path to the frames database
    #[arg(long, default_value = "~/.ritual/frames.db")]
    pub database: String,

    /// Path to the watcher database (for activity correlation)
    #[arg(long, default_value = "~/.ritual/watcher.db")]
    pub watcher_db: String,

    /// Directory for thumbnails
    #[arg(long, default_value = "~/.ritual/thumbnails")]
    pub thumbnail_dir: String,

    /// Capture interval in milliseconds
    #[arg(long, default_value = "1000")]
    pub capture_interval: u64,

    /// Monitor ID to capture (0 = primary)
    #[arg(long, default_value = "0")]
    pub monitor_id: u32,

    /// Disable frame deduplication
    #[arg(long)]
    pub disable_dedup: bool,

    /// Deduplication threshold (0.0-1.0, lower = more strict)
    #[arg(long, default_value = "0.02")]
    pub dedup_threshold: f64,

    /// Maximum seconds between frames even if identical
    #[arg(long, default_value = "60")]
    pub max_frame_gap: u64,

    /// Disable OCR text extraction
    #[arg(long)]
    pub disable_ocr: bool,

    /// OCR language code
    #[arg(long, default_value = "en-US")]
    pub ocr_language: String,

    /// Storage limit in GB (0 = unlimited)
    #[arg(long, default_value = "20")]
    pub storage_limit_gb: u64,

    /// Comma-separated list of excluded app bundle IDs
    #[arg(long, default_value = "")]
    pub excluded_apps: String,

    /// Run storage maintenance only
    #[arg(long)]
    pub maintenance: bool,

    /// List available monitors and exit
    #[arg(long)]
    pub list_monitors: bool,

    /// Show storage status and exit
    #[arg(long)]
    pub status: bool,

    /// Enable verbose debug logging
    #[arg(short, long)]
    pub verbose: bool,
}

fn main() {
    // Parse arguments
    let args = Args::parse();

    // Initialize logging
    let log_level = if args.verbose { "debug" } else { "info" };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| log_level.into()),
        )
        .with_target(false)
        .init();

    // Handle special commands
    if args.list_monitors {
        list_monitors();
        return;
    }

    // Create config from args
    let config = RecorderConfig::from_args(&args);

    if args.status {
        show_status(&config);
        return;
    }

    if args.maintenance {
        run_maintenance(&config);
        return;
    }

    // Set up signal handler
    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();

    ctrlc::set_handler(move || {
        info!("Received shutdown signal, stopping...");
        running_clone.store(false, Ordering::SeqCst);
    })
    .expect("Failed to set Ctrl+C handler");

    info!("Starting Ritual Recorder (no video encoding)");
    info!("  Database: {}", config.frames_db_path.display());
    info!("  Thumbnails: {}", config.thumbnail_dir.display());
    info!("  Capture interval: {}ms", config.capture_interval_ms);
    info!("  OCR: {}", if config.enable_ocr { "enabled" } else { "disabled" });
    info!("  Dedup: {}", if config.enable_dedup { "enabled" } else { "disabled" });

    // Run the main recorder loop
    if let Err(e) = run_recorder(&config, running) {
        error!("Recorder error: {}", e);
        std::process::exit(1);
    }

    info!("Ritual Recorder stopped");
}

/// List available monitors
fn list_monitors() {
    match capture::get_all_monitors() {
        Ok(monitors) => {
            println!("Available monitors:");
            for monitor in monitors {
                println!("  {}", monitor);
            }
        }
        Err(e) => {
            eprintln!("Failed to enumerate monitors: {}", e);
            std::process::exit(1);
        }
    }
}

/// Show storage status
fn show_status(config: &RecorderConfig) {
    let storage_manager = StorageManager::new(config);
    match storage_manager.get_status() {
        Ok(status) => {
            println!("{}", status);
        }
        Err(e) => {
            eprintln!("Failed to get storage status: {}", e);
            std::process::exit(1);
        }
    }
}

/// Run storage maintenance
fn run_maintenance(config: &RecorderConfig) {
    info!("Running storage maintenance...");

    let db = match RecorderDatabase::new(config.frames_db_path.to_str().unwrap()) {
        Ok(db) => db,
        Err(e) => {
            error!("Failed to open database: {}", e);
            std::process::exit(1);
        }
    };

    let storage_manager = StorageManager::new(config);
    match storage_manager.run_maintenance(&db) {
        Ok(result) => {
            info!("Maintenance complete:");
            info!("  Deleted: {} frames", result.deleted_count);
            info!("  Bytes freed: {:.2} MB", result.bytes_freed as f64 / (1024.0 * 1024.0));
        }
        Err(e) => {
            error!("Maintenance failed: {}", e);
            std::process::exit(1);
        }
    }
}

/// Main recorder loop
/// 
/// Captures screens, runs OCR, generates thumbnails, and stores data.
/// Video encoding has been removed - thumbnails + OCR provide sufficient context.
fn run_recorder(config: &RecorderConfig, running: Arc<AtomicBool>) -> Result<()> {
    // Ensure directories exist
    config.ensure_directories()?;

    // Initialize components
    let db = RecorderDatabase::new(config.frames_db_path.to_str().unwrap())?;
    let mut screen_capture = ScreenCapture::new(config)?;
    let mut deduplicator = if config.enable_dedup {
        Some(FrameDeduplicator::new(
            config.dedup_threshold,
            config.max_frame_gap_secs,
        ))
    } else {
        None
    };
    let ocr_processor = if config.enable_ocr {
        Some(OcrProcessor::new(&config.ocr_language))
    } else {
        None
    };
    let thumbnail_generator = ThumbnailGenerator::new(config.thumbnail_dir.clone());
    thumbnail_generator.ensure_directory()?;

    // Storage manager for periodic maintenance
    let storage_manager = StorageManager::new(config);
    let mut last_maintenance = Instant::now();
    let maintenance_interval = Duration::from_secs(3600); // Every hour

    // Performance metrics
    let metrics = Arc::new(RecorderMetrics::new());
    let start_time = Instant::now();
    
    // Track last OCR text for multi-signal deduplication
    let mut last_ocr_text: Option<String> = None;
    let mut last_stats = start_time;

    info!("Recorder initialized (no video encoding), starting capture loop");

    // Main capture loop
    while running.load(Ordering::SeqCst) {
        let loop_start = Instant::now();

        // Check if we should record
        if !screen_capture.should_record() {
            std::thread::sleep(config.capture_interval());
            continue;
        }

        // Capture screen (timed)
        let capture_start = Instant::now();
        let capture_result = match screen_capture.capture() {
            Ok(result) => result,
            Err(e) => {
                warn!("Screen capture failed: {}", e);
                std::thread::sleep(config.capture_interval());
                continue;
            }
        };
        metrics.record_capture_time(capture_start.elapsed());
        metrics.inc_captured();

        // Extract window context for multi-signal deduplication
        let (window_title, app_bundle_id) = if let Some(ref win) = capture_result.focused_window {
            (
                Some(win.window_title.as_str()),
                win.bundle_id.as_deref(),
            )
        } else {
            (None, None)
        };

        // Check deduplication with multi-signal detection (timed)
        // Note: OCR text from previous frame is used since OCR runs after dedup
        let dedup_start = Instant::now();
        let (should_store, image_hash) = if let Some(ref mut dedup) = deduplicator {
            dedup.should_store_with_context(
                &capture_result.image,
                capture_result.timestamp,
                window_title,
                app_bundle_id,
                last_ocr_text.as_deref(),
            )
        } else {
            (true, "".to_string())
        };
        metrics.record_dedup_time(dedup_start.elapsed());

        if !should_store {
            metrics.inc_deduped();
            debug!("Frame {} deduplicated", capture_result.frame_number);
        } else {
            metrics.inc_stored();

            // Run OCR if enabled (timed)
            let ocr_start = Instant::now();
            let ocr_result = if let Some(ref processor) = ocr_processor {
                let result = processor.process(&capture_result.image);
                // Track OCR outcome
                if result.text.is_empty() && ocr_start.elapsed().as_millis() as u64 >= 5000 {
                    metrics.inc_ocr_timeout();
                } else if result.text.is_empty() {
                    // Could be blank screen or circuit breaker open
                    if processor.stats().circuit_open {
                        metrics.inc_ocr_skipped();
                    } else {
                        metrics.inc_ocr_success(); // Empty but valid
                    }
                } else {
                    metrics.inc_ocr_success();
                }
                result
            } else {
                metrics.inc_ocr_skipped();
                ocr::OcrResult::empty()
            };
            metrics.record_ocr_time(ocr_start.elapsed());

            // Get activity context from watcher
            let activity = get_current_activity_from_watcher(
                config.watcher_db_path.to_str().unwrap()
            ).ok().flatten();

            // Generate thumbnail for EVERY stored frame (timed)
            let thumb_start = Instant::now();
            let thumbnail_path = match thumbnail_generator.generate(&capture_result.image, capture_result.timestamp) {
                Ok(result) => Some(result.path),
                Err(e) => {
                    warn!("Thumbnail generation failed: {}", e);
                    None
                }
            };
            metrics.record_thumbnail_time(thumb_start.elapsed());

            // Store OCR frame in database (no video_chunk_id or frame_offset)
            let (bundle_id, app_name, window_title, activity_id) = if let Some(ref win) = capture_result.focused_window {
                (
                    win.bundle_id.clone().unwrap_or_default(),
                    win.app_name.clone(),
                    Some(win.window_title.clone()),
                    activity.map(|a| a.event_id),
                )
            } else if let Some(ref act) = activity {
                (
                    act.bundle_id.clone(),
                    act.app_name.clone(),
                    act.window_title.clone(),
                    Some(act.event_id),
                )
            } else {
                (String::new(), String::new(), None, None)
            };

            let ocr_frame = OcrFrame {
                id: None,
                timestamp: capture_result.timestamp,
                activity_event_id: activity_id,
                app_bundle_id: bundle_id,
                app_name,
                window_title,
                ocr_text: ocr_result.text,
                ocr_confidence: ocr_result.confidence,
                thumbnail_path,
                video_chunk_id: None,  // No video encoding
                frame_offset: None,    // No video encoding
                image_hash,
                storage_tier: config::StorageTier::Hot,
            };

            let db_start = Instant::now();
            db.insert_ocr_frame(&ocr_frame)?;
            metrics.record_db_insert_time(db_start.elapsed());
            
            // Update last OCR text for multi-signal deduplication on next frame
            if !ocr_frame.ocr_text.is_empty() {
                last_ocr_text = Some(ocr_frame.ocr_text.clone());
            }

            debug!(
                "Frame {} stored: OCR {} chars, confidence {:.2}, thumbnail: {}",
                capture_result.frame_number,
                ocr_frame.ocr_text.len(),
                ocr_frame.ocr_confidence,
                ocr_frame.thumbnail_path.is_some()
            );
        }

        // Log stats periodically (every 60 seconds)
        if last_stats.elapsed() >= Duration::from_secs(60) {
            let elapsed = start_time.elapsed().as_secs_f64();
            
            // Log comprehensive metrics summary
            metrics.log_summary(elapsed);

            // Log storage status (thumbnails only now)
            if let Ok(status) = storage_manager.get_status() {
                info!("{}", status);
            }

            last_stats = Instant::now();
        }

        // Run maintenance periodically
        if last_maintenance.elapsed() >= maintenance_interval {
            info!("Running scheduled storage maintenance");
            if let Err(e) = storage_manager.run_maintenance(&db) {
                error!("Storage maintenance failed: {}", e);
            }
            last_maintenance = Instant::now();
        }

        // Sleep for remaining interval
        let elapsed = loop_start.elapsed();
        if elapsed < config.capture_interval() {
            std::thread::sleep(config.capture_interval() - elapsed);
        }
    }

    // Final stats with full timing breakdown
    let total_elapsed = start_time.elapsed().as_secs_f64();
    metrics.log_final_summary(total_elapsed);

    Ok(())
}
