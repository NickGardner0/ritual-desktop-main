//! Database operations for Ritual Recorder
//!
//! This module wraps ritual-db's blocking API to provide the same interface
//! as the original rusqlite-based implementation.

#![allow(dead_code)] // Public API methods may not be used within this crate

use anyhow::Result;
use ritual_db::blocking::BlockingDatabase;
use ritual_db::{OcrFrame as RitualOcrFrame, VideoChunk as RitualVideoChunk, StorageTier as RitualStorageTier};
use tracing::info;

use crate::config::StorageTier;

/// Database manager for recorder data
pub struct RecorderDatabase {
    db: BlockingDatabase,
}

/// OCR frame record (local type for compatibility)
#[derive(Debug, Clone)]
pub struct OcrFrame {
    pub id: Option<i64>,
    pub timestamp: i64,
    pub activity_event_id: Option<i64>,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub ocr_text: String,
    pub ocr_confidence: f64,
    pub thumbnail_path: Option<String>,
    pub video_chunk_id: Option<i64>,
    pub frame_offset: Option<i64>,
    pub image_hash: String,
    pub storage_tier: StorageTier,
}

impl OcrFrame {
    /// Convert to ritual-db OcrFrame
    fn to_ritual(&self) -> RitualOcrFrame {
        let mut frame = RitualOcrFrame::new(
            self.timestamp,
            &self.app_bundle_id,
            &self.app_name,
            &self.ocr_text,
            &self.image_hash,
        );
        frame.id = self.id;
        frame.activity_event_id = self.activity_event_id;
        frame.window_title = self.window_title.clone();
        frame.ocr_confidence = self.ocr_confidence;
        frame.thumbnail_path = self.thumbnail_path.clone();
        frame.video_chunk_id = self.video_chunk_id;
        frame.frame_offset = self.frame_offset;
        frame.storage_tier = match self.storage_tier {
            StorageTier::Hot => RitualStorageTier::Hot,
            StorageTier::Warm => RitualStorageTier::Warm,
            StorageTier::Cold => RitualStorageTier::Cold,
        };
        frame
    }
    
    /// Convert from ritual-db OcrFrame
    fn from_ritual(frame: RitualOcrFrame) -> Self {
        Self {
            id: frame.id,
            timestamp: frame.timestamp,
            activity_event_id: frame.activity_event_id,
            app_bundle_id: frame.app_bundle_id,
            app_name: frame.app_name,
            window_title: frame.window_title,
            ocr_text: frame.ocr_text,
            ocr_confidence: frame.ocr_confidence,
            thumbnail_path: frame.thumbnail_path,
            video_chunk_id: frame.video_chunk_id,
            frame_offset: frame.frame_offset,
            image_hash: frame.image_hash,
            storage_tier: match frame.storage_tier {
                RitualStorageTier::Hot => StorageTier::Hot,
                RitualStorageTier::Warm => StorageTier::Warm,
                RitualStorageTier::Cold => StorageTier::Cold,
            },
        }
    }
}

/// Video chunk record (local type for compatibility)
#[derive(Debug, Clone)]
pub struct VideoChunk {
    pub id: Option<i64>,
    pub file_path: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub frame_count: i64,
    pub file_size_bytes: Option<i64>,
    pub monitor_id: u32,
    pub storage_tier: StorageTier,
}

impl VideoChunk {
    /// Convert to ritual-db VideoChunk
    fn to_ritual(&self) -> RitualVideoChunk {
        RitualVideoChunk {
            id: self.id,
            file_path: self.file_path.clone(),
            start_time: self.start_time,
            end_time: self.end_time,
            frame_count: self.frame_count,
            file_size_bytes: self.file_size_bytes,
            monitor_id: self.monitor_id,
            storage_tier: match self.storage_tier {
                StorageTier::Hot => RitualStorageTier::Hot,
                StorageTier::Warm => RitualStorageTier::Warm,
                StorageTier::Cold => RitualStorageTier::Cold,
            },
            created_at: None,
        }
    }
    
    /// Convert from ritual-db VideoChunk
    fn from_ritual(chunk: RitualVideoChunk) -> Self {
        Self {
            id: chunk.id,
            file_path: chunk.file_path,
            start_time: chunk.start_time,
            end_time: chunk.end_time,
            frame_count: chunk.frame_count,
            file_size_bytes: chunk.file_size_bytes,
            monitor_id: chunk.monitor_id,
            storage_tier: match chunk.storage_tier {
                RitualStorageTier::Hot => StorageTier::Hot,
                RitualStorageTier::Warm => StorageTier::Warm,
                RitualStorageTier::Cold => StorageTier::Cold,
            },
        }
    }
}

impl RecorderDatabase {
    /// Create a new database connection and initialize schema
    /// Note: The path argument is ignored - we use the unified ritual.db
    pub fn new(db_path: &str) -> Result<Self> {
        info!("Opening Ritual database (unified libSQL) - ignoring path: {}", db_path);
        
        let db = BlockingDatabase::open_default()
            .map_err(|e| anyhow::anyhow!("Failed to open database: {}", e))?;
        
        Ok(Self { db })
    }

    // ========================================================================
    // VIDEO CHUNK OPERATIONS
    // ========================================================================

    /// Insert a new video chunk and return its ID
    pub fn insert_video_chunk(&self, chunk: &VideoChunk) -> Result<i64> {
        let ritual_chunk = chunk.to_ritual();
        self.db.insert_video_chunk(&ritual_chunk)
            .map_err(|e| anyhow::anyhow!("Failed to insert video chunk: {}", e))
    }

    /// Update video chunk end time and stats
    pub fn update_video_chunk(&self, chunk_id: i64, end_time: i64, frame_count: i64, file_size: Option<i64>) -> Result<()> {
        self.db.update_video_chunk(chunk_id, end_time, frame_count, file_size)
            .map_err(|e| anyhow::anyhow!("Failed to update video chunk: {}", e))
    }

    /// Get video chunk by ID
    pub fn get_video_chunk(&self, chunk_id: i64) -> Result<Option<VideoChunk>> {
        self.db.get_video_chunk(chunk_id)
            .map(|opt| opt.map(VideoChunk::from_ritual))
            .map_err(|e| anyhow::anyhow!("Failed to get video chunk: {}", e))
    }

    /// Get video chunks in a time range
    pub fn get_video_chunks_in_range(&self, start_ts: i64, end_ts: i64) -> Result<Vec<VideoChunk>> {
        self.db.get_video_chunks_in_range(start_ts, end_ts)
            .map(|chunks| chunks.into_iter().map(VideoChunk::from_ritual).collect())
            .map_err(|e| anyhow::anyhow!("Failed to get video chunks: {}", e))
    }

    // ========================================================================
    // OCR FRAME OPERATIONS
    // ========================================================================

    /// Insert a new OCR frame and return its ID
    pub fn insert_ocr_frame(&self, frame: &OcrFrame) -> Result<i64> {
        let ritual_frame = frame.to_ritual();
        self.db.insert_ocr_frame(&ritual_frame)
            .map_err(|e| anyhow::anyhow!("Failed to insert OCR frame: {}", e))
    }

    /// Get frames in a time range
    pub fn get_frames_in_range(&self, start_ts: i64, end_ts: i64, limit: Option<usize>) -> Result<Vec<OcrFrame>> {
        self.db.get_frames_in_range(start_ts, end_ts)
            .map(|frames| {
                let mut result: Vec<_> = frames.into_iter().map(OcrFrame::from_ritual).collect();
                if let Some(l) = limit {
                    result.truncate(l);
                }
                result
            })
            .map_err(|e| anyhow::anyhow!("Failed to get frames: {}", e))
    }

    /// Get the most recent image hash for deduplication
    pub fn get_last_frame_hash(&self) -> Result<Option<String>> {
        self.db.get_last_frame_hash()
            .map_err(|e| anyhow::anyhow!("Failed to get last frame hash: {}", e))
    }

    /// Search OCR text (FTS)
    pub fn search_ocr_text(&self, query: &str, _start_ts: i64, _end_ts: i64, limit: usize) -> Result<Vec<OcrFrame>> {
        self.db.search_ocr_text(query, limit)
            .map(|frames| frames.into_iter().map(OcrFrame::from_ritual).collect())
            .map_err(|e| anyhow::anyhow!("Failed to search OCR text: {}", e))
    }

    /// Get frames older than a timestamp (for cleanup)
    pub fn get_frames_older_than(&self, timestamp: i64) -> Result<Vec<OcrFrame>> {
        self.db.get_frames_older_than(timestamp)
            .map(|frames| frames.into_iter().map(OcrFrame::from_ritual).collect())
            .map_err(|e| anyhow::anyhow!("Failed to get old frames: {}", e))
    }

    /// Get oldest frames (for storage limit enforcement)
    pub fn get_oldest_frames(&self, limit: usize) -> Result<Vec<OcrFrame>> {
        self.db.get_oldest_frames(limit)
            .map(|frames| frames.into_iter().map(OcrFrame::from_ritual).collect())
            .map_err(|e| anyhow::anyhow!("Failed to get oldest frames: {}", e))
    }

    /// Delete an OCR frame by ID
    pub fn delete_ocr_frame(&self, frame_id: i64) -> Result<()> {
        self.db.delete_ocr_frame(frame_id)
            .map_err(|e| anyhow::anyhow!("Failed to delete OCR frame: {}", e))
    }

    // ========================================================================
    // STORAGE MANAGEMENT
    // ========================================================================

    /// Get total storage used by video chunks
    pub fn get_total_video_size(&self) -> Result<i64> {
        // Use recorder stats from ritual-db
        self.db.get_recorder_stats()
            .map(|stats| stats.total_storage_bytes)
            .map_err(|e| anyhow::anyhow!("Failed to get storage stats: {}", e))
    }

    /// Get total frame count
    pub fn get_total_frame_count(&self) -> Result<i64> {
        self.db.get_recorder_stats()
            .map(|stats| stats.total_frames)
            .map_err(|e| anyhow::anyhow!("Failed to get frame count: {}", e))
    }

    /// Get total video chunk count
    pub fn get_video_chunk_count(&self) -> Result<i64> {
        self.db.get_recorder_stats()
            .map(|stats| stats.total_video_chunks)
            .map_err(|e| anyhow::anyhow!("Failed to get chunk count: {}", e))
    }

    /// Get video chunks older than a timestamp for a specific tier
    pub fn get_chunks_older_than(&self, timestamp: i64, tier: &str) -> Result<Vec<VideoChunk>> {
        self.db.get_chunks_older_than(timestamp, tier)
            .map(|chunks| chunks.into_iter().map(VideoChunk::from_ritual).collect())
            .map_err(|e| anyhow::anyhow!("Failed to get chunks older than: {}", e))
    }

    /// Update storage tier for a video chunk
    pub fn update_chunk_tier(&self, chunk_id: i64, new_tier: StorageTier) -> Result<()> {
        let ritual_tier = match new_tier {
            StorageTier::Hot => RitualStorageTier::Hot,
            StorageTier::Warm => RitualStorageTier::Warm,
            StorageTier::Cold => RitualStorageTier::Cold,
        };
        self.db.update_chunk_tier(chunk_id, ritual_tier)
            .map_err(|e| anyhow::anyhow!("Failed to update chunk tier: {}", e))
    }

    /// Delete a video chunk and its associated frames
    pub fn delete_video_chunk(&self, chunk_id: i64) -> Result<()> {
        self.db.delete_video_chunk(chunk_id)
            .map_err(|e| anyhow::anyhow!("Failed to delete video chunk: {}", e))
    }

    // ========================================================================
    // ACTIVITY CONTEXT (for linking frames to watcher events)
    // ========================================================================

    /// Get current activity context for associating with OCR frames
    pub fn get_current_activity(&self) -> Result<Option<ActivityContext>> {
        self.db.get_current_activity()
            .map(|opt| opt.map(|ctx| ActivityContext {
                event_id: ctx.event_id,
                bundle_id: ctx.bundle_id,
                app_name: ctx.app_name,
                window_title: ctx.window_title,
            }))
            .map_err(|e| anyhow::anyhow!("Failed to get current activity: {}", e))
    }
}

/// Activity context for linking frames to watcher events
#[derive(Debug, Clone)]
pub struct ActivityContext {
    pub event_id: i64,
    pub bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
}

/// Get current activity from the unified database
/// Note: The path argument is ignored since we use the unified ritual.db
pub fn get_current_activity_from_watcher(_watcher_db_path: &str) -> anyhow::Result<Option<ActivityContext>> {
    // Open a fresh connection to get current activity
    // This is used by the recorder to correlate frames with watcher activity
    let db = BlockingDatabase::open_default()
        .map_err(|e| anyhow::anyhow!("Failed to open database: {}", e))?;
    
    db.get_current_activity()
        .map(|opt| opt.map(|ctx| ActivityContext {
            event_id: ctx.event_id,
            bundle_id: ctx.bundle_id,
            app_name: ctx.app_name,
            window_title: ctx.window_title,
        }))
        .map_err(|e| anyhow::anyhow!("Failed to get current activity: {}", e))
}
