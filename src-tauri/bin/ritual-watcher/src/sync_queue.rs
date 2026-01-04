//! Sync Queue - Persistent queue for backend synchronization
//!
//! Ensures activity events are reliably synced to the backend,
//! even if the backend is temporarily unavailable.
//! Based on ActivityWatch's persistqueue pattern.

#![allow(dead_code)] // Public API - methods used by Tauri commands

use rusqlite::{Connection, Result, params};
use std::sync::Mutex;
use tracing::{debug, info};

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
    ActivityCreate {
        event_id: i64,
    },
    /// Activity event end time updated
    ActivityUpdate {
        event_id: i64,
        ts_end: u64,
    },
    /// AFK event
    AfkEvent {
        event_id: i64,
    },
}

/// Persistent sync queue backed by SQLite
pub struct SyncQueue {
    conn: Mutex<Connection>,
}

impl SyncQueue {
    /// Create a new sync queue
    pub fn new(path: &str) -> Result<Self> {
        let expanded_path = shellexpand::tilde(path).to_string();
        
        // Ensure parent directory exists
        if let Some(parent) = std::path::Path::new(&expanded_path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                rusqlite::Error::InvalidPath(
                    std::path::PathBuf::from(format!("Failed to create directory: {}", e))
                )
            })?;
        }
        
        let conn = Connection::open(&expanded_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        
        let queue = Self {
            conn: Mutex::new(conn),
        };
        
        queue.ensure_tables()?;
        
        Ok(queue)
    }
    
    /// Create queue tables
    fn ensure_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute_batch(
            r#"
            -- Sync queue for activity events
            CREATE TABLE IF NOT EXISTS sync_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_type TEXT NOT NULL,
                event_id INTEGER NOT NULL,
                ts_end INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                retry_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            
            -- Index for finding pending items
            CREATE INDEX IF NOT EXISTS idx_sync_queue_status 
            ON sync_queue(status, created_at);
            
            -- Index for finding by event_id (deduplication)
            CREATE INDEX IF NOT EXISTS idx_sync_queue_event 
            ON sync_queue(event_id, entry_type);
            
            -- Rollup cache for efficient daily summaries
            CREATE TABLE IF NOT EXISTS daily_rollup_cache (
                date TEXT NOT NULL,
                device_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                total_active_ms INTEGER NOT NULL DEFAULT 0,
                total_afk_ms INTEGER NOT NULL DEFAULT 0,
                app_summaries TEXT,  -- JSON: [{bundle_id, app_name, total_ms}]
                domain_summaries TEXT, -- JSON: [{domain, total_ms}]
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (date, device_id)
            );
            "#,
        )?;
        
        Ok(())
    }
    
    /// Get current timestamp in milliseconds
    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
    }
    
    /// Queue an activity event for full sync (new event)
    pub fn queue_activity_sync(&self, event_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Self::now_ms();
        
        // Check if this event is already queued as pending
        let existing: Option<i64> = conn.query_row(
            "SELECT id FROM sync_queue WHERE event_id = ?1 AND entry_type = 'activity_create' AND status = 'pending'",
            params![event_id],
            |row| row.get(0),
        ).ok();
        
        if existing.is_some() {
            debug!("Event {} already queued for sync", event_id);
            return Ok(());
        }
        
        conn.execute(
            r#"
            INSERT INTO sync_queue (entry_type, event_id, status, created_at, updated_at)
            VALUES ('activity_create', ?1, 'pending', ?2, ?2)
            "#,
            params![event_id, now],
        )?;
        
        debug!("Queued activity event {} for sync", event_id);
        
        Ok(())
    }
    
    /// Queue an activity update (end time extended)
    pub fn queue_activity_update(&self, event_id: i64, ts_end: u64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Self::now_ms();
        
        // Check if there's already a pending update for this event
        let existing: Option<i64> = conn.query_row(
            "SELECT id FROM sync_queue WHERE event_id = ?1 AND entry_type = 'activity_update' AND status = 'pending'",
            params![event_id],
            |row| row.get(0),
        ).ok();
        
        if let Some(id) = existing {
            // Update existing entry with new end time
            conn.execute(
                "UPDATE sync_queue SET ts_end = ?1, updated_at = ?2 WHERE id = ?3",
                params![ts_end as i64, now, id],
            )?;
            debug!("Updated pending sync for event {} with new end time", event_id);
        } else {
            // Create new update entry
            conn.execute(
                r#"
                INSERT INTO sync_queue (entry_type, event_id, ts_end, status, created_at, updated_at)
                VALUES ('activity_update', ?1, ?2, 'pending', ?3, ?3)
                "#,
                params![event_id, ts_end as i64, now],
            )?;
            debug!("Queued activity update for event {} (end: {})", event_id, ts_end);
        }
        
        Ok(())
    }
    
    /// Get count of pending sync items
    pub fn pending_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )?;
        
        Ok(count)
    }
    
    /// Get pending items for sync (oldest first, with limit)
    pub fn get_pending(&self, limit: i64) -> Result<Vec<QueuedItem>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT id, entry_type, event_id, ts_end, retry_count
            FROM sync_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ?1
            "#,
        )?;
        
        let items = stmt.query_map(params![limit], |row| {
            Ok(QueuedItem {
                id: row.get(0)?,
                entry_type: row.get(1)?,
                event_id: row.get(2)?,
                ts_end: row.get::<_, Option<i64>>(3)?.map(|v| v as u64),
                retry_count: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        
        Ok(items)
    }
    
    /// Mark an item as synced
    pub fn mark_synced(&self, queue_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Self::now_ms();
        
        conn.execute(
            "UPDATE sync_queue SET status = 'synced', updated_at = ?1 WHERE id = ?2",
            params![now, queue_id],
        )?;
        
        Ok(())
    }
    
    /// Mark an item as failed (will retry)
    pub fn mark_failed(&self, queue_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Self::now_ms();
        
        conn.execute(
            "UPDATE sync_queue SET status = 'failed', retry_count = retry_count + 1, updated_at = ?1 WHERE id = ?2",
            params![now, queue_id],
        )?;
        
        Ok(())
    }
    
    /// Reset failed items to pending (for retry)
    pub fn reset_failed(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = Self::now_ms();
        
        // Only retry items that haven't been retried too many times
        let count = conn.execute(
            "UPDATE sync_queue SET status = 'pending', updated_at = ?1 WHERE status = 'failed' AND retry_count < 5",
            params![now],
        )?;
        
        if count > 0 {
            info!("Reset {} failed sync items for retry", count);
        }
        
        Ok(count as i64)
    }
    
    /// Clean up old synced items (keep last 24 hours for debugging)
    pub fn cleanup_synced(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let cutoff = Self::now_ms() - (24 * 60 * 60 * 1000); // 24 hours ago
        
        let count = conn.execute(
            "DELETE FROM sync_queue WHERE status = 'synced' AND updated_at < ?1",
            params![cutoff],
        )?;
        
        if count > 0 {
            debug!("Cleaned up {} old synced items", count);
        }
        
        Ok(count as i64)
    }
    
    /// Update daily rollup cache
    pub fn update_daily_rollup(
        &self,
        date: &str,
        device_id: &str,
        user_id: &str,
        total_active_ms: i64,
        total_afk_ms: i64,
        app_summaries: Option<&str>,
        domain_summaries: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Self::now_ms();
        
        conn.execute(
            r#"
            INSERT INTO daily_rollup_cache (date, device_id, user_id, total_active_ms, total_afk_ms, app_summaries, domain_summaries, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(date, device_id) DO UPDATE SET
                total_active_ms = ?4,
                total_afk_ms = ?5,
                app_summaries = ?6,
                domain_summaries = ?7,
                updated_at = ?8
            "#,
            params![date, device_id, user_id, total_active_ms, total_afk_ms, app_summaries, domain_summaries, now],
        )?;
        
        Ok(())
    }
    
    /// Get daily rollup from cache
    pub fn get_daily_rollup(&self, date: &str, device_id: &str) -> Result<Option<DailyRollup>> {
        let conn = self.conn.lock().unwrap();
        
        let result = conn.query_row(
            r#"
            SELECT date, device_id, user_id, total_active_ms, total_afk_ms, app_summaries, domain_summaries, updated_at
            FROM daily_rollup_cache
            WHERE date = ?1 AND device_id = ?2
            "#,
            params![date, device_id],
            |row| {
                Ok(DailyRollup {
                    date: row.get(0)?,
                    device_id: row.get(1)?,
                    user_id: row.get(2)?,
                    total_active_ms: row.get(3)?,
                    total_afk_ms: row.get(4)?,
                    app_summaries: row.get(5)?,
                    domain_summaries: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        );
        
        match result {
            Ok(rollup) => Ok(Some(rollup)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_sync_queue_create() {
        let queue = SyncQueue::new("/tmp/test_sync_queue.db").unwrap();
        assert_eq!(queue.pending_count().unwrap(), 0);
    }
    
    #[test]
    fn test_queue_activity() {
        let queue = SyncQueue::new("/tmp/test_sync_queue2.db").unwrap();
        queue.queue_activity_sync(1).unwrap();
        assert_eq!(queue.pending_count().unwrap(), 1);
        
        // Duplicate should not increase count
        queue.queue_activity_sync(1).unwrap();
        assert_eq!(queue.pending_count().unwrap(), 1);
    }
}

