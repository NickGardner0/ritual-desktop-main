//! Storage management module for Ritual Recorder
//!
//! Simplified storage management for thumbnails + OCR data.
//! Video encoding has been removed to save storage.

#![allow(dead_code)] // Some structs/methods reserved for future use

use anyhow::Result;
use chrono::Utc;
use std::path::PathBuf;
use tracing::{debug, info, warn};

use crate::config::RecorderConfig;
use crate::database::RecorderDatabase;

/// Storage manager for thumbnail and OCR data retention
pub struct StorageManager {
    /// Thumbnail directory
    thumbnail_dir: PathBuf,
    /// Storage limit in bytes (0 = unlimited)
    storage_limit_bytes: u64,
    /// Data retention in days
    retention_days: u64,
}

impl StorageManager {
    /// Create a new storage manager from config
    pub fn new(config: &RecorderConfig) -> Self {
        Self {
            thumbnail_dir: config.thumbnail_dir.clone(),
            storage_limit_bytes: config.storage_limit_gb * 1024 * 1024 * 1024,
            retention_days: config.retention_days,
        }
    }

    /// Run storage maintenance
    ///
    /// This includes:
    /// 1. Delete expired data beyond retention period
    /// 2. Enforce storage limits if set
    pub fn run_maintenance(&self, db: &RecorderDatabase) -> Result<MaintenanceResult> {
        let mut result = MaintenanceResult::default();
        let now_ms = Utc::now().timestamp_millis();

        // Calculate retention cutoff timestamp
        let retention_cutoff = now_ms - (self.retention_days as i64 * 24 * 60 * 60 * 1000);

        // 1. Delete expired OCR frames and their thumbnails
        let expired_frames = db.get_frames_older_than(retention_cutoff)?;
        for frame in expired_frames {
            // Delete thumbnail file if it exists
            if let Some(ref thumb_path) = frame.thumbnail_path {
                let path = PathBuf::from(thumb_path);
                if path.exists() {
                    if let Ok(metadata) = path.metadata() {
                        result.bytes_freed += metadata.len();
                    }
                    if let Err(e) = std::fs::remove_file(&path) {
                        debug!("Failed to delete thumbnail {}: {}", thumb_path, e);
                    }
                }
            }

            // Delete frame from database
            if let Some(frame_id) = frame.id {
                if let Err(e) = db.delete_ocr_frame(frame_id) {
                    debug!("Failed to delete frame {}: {}", frame_id, e);
                } else {
                    result.deleted_count += 1;
                }
            }
        }

        // 2. Enforce storage limit if set
        if self.storage_limit_bytes > 0 {
            let current_usage = self.calculate_total_storage()?;
            if current_usage > self.storage_limit_bytes {
                let to_free = current_usage - self.storage_limit_bytes;
                let freed = self.enforce_storage_limit(db, to_free)?;
                result.bytes_freed += freed;
            }
        }

        if result.deleted_count > 0 || result.bytes_freed > 0 {
            info!(
                "Storage maintenance complete: {} frames deleted, {:.2} MB freed",
                result.deleted_count,
                result.bytes_freed as f64 / (1024.0 * 1024.0)
            );
        }

        Ok(result)
    }

    /// Enforce storage limit by deleting oldest data
    fn enforce_storage_limit(&self, db: &RecorderDatabase, to_free: u64) -> Result<u64> {
        warn!(
            "Storage limit exceeded, need to free {:.2} MB",
            to_free as f64 / (1024.0 * 1024.0)
        );

        let mut freed = 0u64;

        // Get oldest frames and delete them
        let oldest_frames = db.get_oldest_frames(1000)?; // Get 1000 oldest frames
        for frame in oldest_frames {
            if freed >= to_free {
                break;
            }

            // Delete thumbnail file if it exists
            if let Some(ref thumb_path) = frame.thumbnail_path {
                let path = PathBuf::from(thumb_path);
                if path.exists() {
                    if let Ok(metadata) = path.metadata() {
                        freed += metadata.len();
                    }
                    let _ = std::fs::remove_file(&path);
                }
            }

            // Delete frame from database
            if let Some(frame_id) = frame.id {
                let _ = db.delete_ocr_frame(frame_id);
            }
        }

        info!(
            "Freed {:.2} MB to enforce storage limit",
            freed as f64 / (1024.0 * 1024.0)
        );

        Ok(freed)
    }

    /// Calculate total storage usage (thumbnails only now)
    pub fn calculate_total_storage(&self) -> Result<u64> {
        let mut total = 0u64;

        // Thumbnail directory
        if self.thumbnail_dir.exists() {
            total += dir_size(&self.thumbnail_dir)?;
        }

        Ok(total)
    }

    /// Get storage status
    pub fn get_status(&self) -> Result<StorageStatus> {
        let thumbnail_size = if self.thumbnail_dir.exists() {
            dir_size(&self.thumbnail_dir)?
        } else {
            0
        };

        let total = thumbnail_size;
        let percentage = if self.storage_limit_bytes > 0 {
            (total as f64 / self.storage_limit_bytes as f64 * 100.0) as u8
        } else {
            0
        };

        Ok(StorageStatus {
            thumbnail_bytes: thumbnail_size,
            total_bytes: total,
            limit_bytes: self.storage_limit_bytes,
            usage_percentage: percentage,
        })
    }
}

/// Calculate directory size recursively
fn dir_size(path: &PathBuf) -> Result<u64> {
    let mut size = 0u64;

    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;

        if metadata.is_file() {
            size += metadata.len();
        } else if metadata.is_dir() {
            size += dir_size(&entry.path())?;
        }
    }

    Ok(size)
}

/// Result of maintenance operation
#[derive(Debug, Default)]
pub struct MaintenanceResult {
    pub deleted_count: usize,
    pub bytes_freed: u64,
}

/// Storage status
#[derive(Debug, Clone)]
pub struct StorageStatus {
    pub thumbnail_bytes: u64,
    pub total_bytes: u64,
    pub limit_bytes: u64,
    pub usage_percentage: u8,
}

impl std::fmt::Display for StorageStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let thumb_mb = self.thumbnail_bytes as f64 / (1024.0 * 1024.0);
        let limit_gb = self.limit_bytes as f64 / (1024.0 * 1024.0 * 1024.0);

        write!(f, "Storage: {:.1} MB thumbnails", thumb_mb)?;

        if self.limit_bytes > 0 {
            write!(
                f,
                " | {}% of {:.1} GB limit",
                self.usage_percentage, limit_gb
            )?;
        }

        Ok(())
    }
}
