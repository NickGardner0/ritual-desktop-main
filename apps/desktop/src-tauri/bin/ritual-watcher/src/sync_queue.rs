//! Sync Queue - Persistent queue for backend synchronization
//!
//! This module wraps ritual-db's sync operations to provide the same interface
//! as the original rusqlite-based implementation.

#![allow(dead_code)] // Public API - methods used by Tauri commands

use ritual_db::blocking::BlockingDatabase;
use std::thread;
use std::time::Duration;
use tracing::{debug, info, warn};

const DB_LOCK_RETRY_ATTEMPTS: usize = 20;
const DB_LOCK_RETRY_BASE_MS: u64 = 50;

/// Sync status for queued items
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SyncStatus {
    /// Pending sync - needs to be sent to backend
    Pending,
    /// Successfully synced
    Synced,
    /// Failed to sync - will retry
    Failed,
}

impl SyncStatus {
    fn as_str(&self) -> &'static str {
        match self {
            SyncStatus::Pending => "pending",
            SyncStatus::Synced => "synced",
            SyncStatus::Failed => "failed",
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "synced" => SyncStatus::Synced,
            "failed" => SyncStatus::Failed,
            _ => SyncStatus::Pending,
        }
    }
}

/// Sync queue entry types
#[derive(Debug, Clone)]
pub enum SyncEntry {
    /// Activity event needs full sync
    ActivityCreate { event_id: i64 },
    /// Activity event end time updated
    ActivityUpdate { event_id: i64, ts_end: u64 },
    /// AFK event
    AfkEvent { event_id: i64 },
}

/// Persistent sync queue backed by ritual-db (libSQL)
pub struct SyncQueue {
    db: BlockingDatabase,
}

impl SyncQueue {
    fn is_lock_error(message: &str) -> bool {
        let lower = message.to_lowercase();
        lower.contains("database is locked")
            || lower.contains("database busy")
            || lower.contains("busy timeout")
            || lower.contains("sql_busy")
            || lower.contains("database table is locked")
    }

    fn with_write_retry<T, F>(&self, op_name: &str, mut op: F) -> Result<T, String>
    where
        F: FnMut() -> Result<T, String>,
    {
        for attempt in 0..DB_LOCK_RETRY_ATTEMPTS {
            match op() {
                Ok(value) => return Ok(value),
                Err(err) => {
                    if !Self::is_lock_error(&err) || attempt + 1 >= DB_LOCK_RETRY_ATTEMPTS {
                        return Err(err);
                    }
                    let sleep_ms = DB_LOCK_RETRY_BASE_MS * (1_u64 << attempt.min(6));
                    warn!(
                        "[sync-queue] {} hit lock contention (attempt {}/{}), retrying in {}ms",
                        op_name,
                        attempt + 1,
                        DB_LOCK_RETRY_ATTEMPTS,
                        sleep_ms
                    );
                    thread::sleep(Duration::from_millis(sleep_ms));
                }
            }
        }
        Err(format!(
            "{} failed after {} retries due to lock contention",
            op_name, DB_LOCK_RETRY_ATTEMPTS
        ))
    }

    /// Create a new sync queue.
    pub fn new(path: &str) -> Result<Self, String> {
        info!(
            "Opening sync queue database (activity.db split): {}",
            path
        );
        let mut last_error: Option<String> = None;
        let mut db: Option<BlockingDatabase> = None;
        for attempt in 0..DB_LOCK_RETRY_ATTEMPTS {
            match BlockingDatabase::open_with_path(path) {
                Ok(opened) => {
                    db = Some(opened);
                    break;
                }
                Err(e) => {
                    let err = format!("Failed to open database: {}", e);
                    if !Self::is_lock_error(&err) || attempt + 1 >= DB_LOCK_RETRY_ATTEMPTS {
                        return Err(err);
                    }
                    let sleep_ms = DB_LOCK_RETRY_BASE_MS * (1_u64 << attempt.min(6));
                    warn!(
                        "[sync-queue] open hit lock contention (attempt {}/{}), retrying in {}ms",
                        attempt + 1,
                        DB_LOCK_RETRY_ATTEMPTS,
                        sleep_ms
                    );
                    last_error = Some(err);
                    thread::sleep(Duration::from_millis(sleep_ms));
                }
            }
        }
        let db = db.ok_or_else(|| {
            last_error.unwrap_or_else(|| "Failed to open sync queue database".to_string())
        })?;

        Ok(Self { db })
    }

    /// Queue an activity event for full sync (new event)
    pub fn queue_activity_sync(&self, event_id: i64) -> Result<(), String> {
        self.with_write_retry("queue_activity_sync", || {
            self.db
                .queue_activity_sync(event_id)
                .map_err(|e| e.to_string())
        })?;
        debug!("Queued activity event {} for sync", event_id);
        Ok(())
    }

    /// Queue an activity update (end time extended)
    pub fn queue_activity_update(&self, event_id: i64, ts_end: u64) -> Result<(), String> {
        self.with_write_retry("queue_activity_update", || {
            self.db
                .queue_activity_update(event_id, ts_end as i64)
                .map_err(|e| e.to_string())
        })?;
        debug!(
            "Queued activity update for event {} (end: {})",
            event_id, ts_end
        );
        Ok(())
    }

    /// Get count of pending sync items
    pub fn pending_count(&self) -> Result<i64, String> {
        self.db.pending_sync_count().map_err(|e| e.to_string())
    }

    /// Get pending items for sync (oldest first, with limit)
    pub fn get_pending(&self, limit: i64) -> Result<Vec<QueuedItem>, String> {
        self.db
            .get_pending_sync(limit)
            .map(|items| {
                items
                    .into_iter()
                    .map(|i| QueuedItem {
                        id: i.id,
                        entry_type: i.entry_type,
                        event_id: i.event_id,
                        ts_end: i.ts_end.map(|v| v as u64),
                        retry_count: i.retry_count,
                    })
                    .collect()
            })
            .map_err(|e| e.to_string())
    }

    /// Mark an item as synced
    pub fn mark_synced(&self, queue_id: i64) -> Result<(), String> {
        self.with_write_retry("mark_synced", || {
            self.db.mark_synced(queue_id).map_err(|e| e.to_string())
        })
    }

    /// Mark an item as failed (will retry)
    pub fn mark_failed(&self, queue_id: i64) -> Result<(), String> {
        self.with_write_retry("mark_sync_failed", || {
            self.db
                .mark_sync_failed(queue_id)
                .map_err(|e| e.to_string())
        })
    }

    /// Reset failed items to pending (for retry)
    /// Note: This is now a no-op as ritual-db handles retries differently
    pub fn reset_failed(&self) -> Result<i64, String> {
        // ritual-db handles retry logic internally
        Ok(0)
    }

    /// Clean up old synced items (keep last 24 hours for debugging)
    /// Note: This is now a no-op as ritual-db handles cleanup differently
    pub fn cleanup_synced(&self) -> Result<i64, String> {
        // ritual-db handles cleanup internally
        Ok(0)
    }

    /// Update daily rollup cache
    /// Note: This is now a no-op as ritual-db handles rollups differently
    pub fn update_daily_rollup(
        &self,
        _date: &str,
        _device_id: &str,
        _user_id: &str,
        _total_active_ms: i64,
        _total_afk_ms: i64,
        _app_summaries: Option<&str>,
        _domain_summaries: Option<&str>,
    ) -> Result<(), String> {
        // ritual-db handles rollups internally
        Ok(())
    }

    /// Get daily rollup from cache
    /// Note: Returns None as ritual-db handles rollups differently
    pub fn get_daily_rollup(
        &self,
        _date: &str,
        _device_id: &str,
    ) -> Result<Option<DailyRollup>, String> {
        // ritual-db handles rollups internally
        Ok(None)
    }
}

/// Queued item for sync
#[derive(Debug)]
pub struct QueuedItem {
    pub id: i64,
    pub entry_type: String,
    pub event_id: i64,
    pub ts_end: Option<u64>,
    pub retry_count: i64,
}

/// Daily rollup data
#[derive(Debug)]
pub struct DailyRollup {
    pub date: String,
    pub device_id: String,
    pub user_id: String,
    pub total_active_ms: i64,
    pub total_afk_ms: i64,
    pub app_summaries: Option<String>,
    pub domain_summaries: Option<String>,
    pub updated_at: i64,
}
