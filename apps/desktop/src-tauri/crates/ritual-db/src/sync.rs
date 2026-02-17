//! Sync queue database operations
//!
//! This module handles:
//! - Queuing activity events for backend sync
//! - Managing sync status (pending, synced, failed)
//! - Retry logic for failed syncs
//! - Daily rollup caching

use libsql::Connection;
use tracing::{debug, info};

use crate::error::{DatabaseError, Result};
use crate::types::{DailyRollup, QueuedSyncItem, SyncStatus};

/// Sync queue operations for the database
pub struct SyncOps<'a> {
    conn: &'a Connection,
}

impl<'a> SyncOps<'a> {
    /// Create a new SyncOps with a connection reference
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
    
    /// Get current timestamp in milliseconds
    fn now_ms() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }
    
    // ========================================================================
    // SYNC QUEUE OPERATIONS
    // ========================================================================
    
    /// Queue an activity event for full sync (new event)
    pub async fn queue_activity_sync(&self, event_id: i64) -> Result<()> {
        let now = Self::now_ms();
        
        // Check if this event is already queued as pending
        let mut rows = self.conn.query(
            "SELECT id FROM sync_queue WHERE event_id = ? AND entry_type = 'activity_create' AND status = 'pending'",
            libsql::params![event_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))?.is_some() {
            debug!("Event {} already queued for sync", event_id);
            return Ok(());
        }
        
        self.conn.execute(
            "INSERT INTO sync_queue (entry_type, event_id, status, created_at, updated_at) VALUES ('activity_create', ?, 'pending', ?, ?)",
            libsql::params![event_id, now, now]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        debug!("Queued activity event {} for sync", event_id);
        Ok(())
    }
    
    /// Queue an activity update (end time extended)
    pub async fn queue_activity_update(&self, event_id: i64, ts_end: i64) -> Result<()> {
        let now = Self::now_ms();
        
        // Check if there's already a pending update for this event
        let mut rows = self.conn.query(
            "SELECT id FROM sync_queue WHERE event_id = ? AND entry_type = 'activity_update' AND status = 'pending'",
            libsql::params![event_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            // Update existing entry with new end time
            let id: i64 = row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?;
            
            self.conn.execute(
                "UPDATE sync_queue SET ts_end = ?, updated_at = ? WHERE id = ?",
                libsql::params![ts_end, now, id]
            ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
            
            debug!("Updated pending sync for event {} with new end time", event_id);
        } else {
            // Create new update entry
            self.conn.execute(
                "INSERT INTO sync_queue (entry_type, event_id, ts_end, status, created_at, updated_at) VALUES ('activity_update', ?, ?, 'pending', ?, ?)",
                libsql::params![event_id, ts_end, now, now]
            ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
            
            debug!("Queued activity update for event {} (end: {})", event_id, ts_end);
        }
        
        Ok(())
    }
    
    /// Get count of pending sync items
    pub async fn pending_count(&self) -> Result<i64> {
        let mut rows = self.conn.query(
            "SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'",
            ()
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let count = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        Ok(count)
    }
    
    /// Get pending items for sync (oldest first, with limit)
    pub async fn get_pending(&self, limit: i64) -> Result<Vec<QueuedSyncItem>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, entry_type, event_id, ts_end, retry_count, status, created_at, updated_at
            FROM sync_queue
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT ?
            "#,
            libsql::params![limit]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut items = Vec::new();
        
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let status_str: String = row.get(5).unwrap_or_else(|_| "pending".to_string());
            
            items.push(QueuedSyncItem {
                id: row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?,
                entry_type: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                event_id: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_end: row.get(3).ok(),
                retry_count: row.get(4).unwrap_or(0),
                status: SyncStatus::from_str(&status_str),
                created_at: row.get(6).unwrap_or(0),
                updated_at: row.get(7).unwrap_or(0),
            });
        }
        
        Ok(items)
    }
    
    /// Get a specific sync item by ID
    pub async fn get_sync_item(&self, id: i64) -> Result<Option<QueuedSyncItem>> {
        let mut rows = self.conn.query(
            "SELECT id, entry_type, event_id, ts_end, retry_count, status, created_at, updated_at FROM sync_queue WHERE id = ?",
            libsql::params![id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            let status_str: String = row.get(5).unwrap_or_else(|_| "pending".to_string());
            
            Ok(Some(QueuedSyncItem {
                id: row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?,
                entry_type: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                event_id: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_end: row.get(3).ok(),
                retry_count: row.get(4).unwrap_or(0),
                status: SyncStatus::from_str(&status_str),
                created_at: row.get(6).unwrap_or(0),
                updated_at: row.get(7).unwrap_or(0),
            }))
        } else {
            Ok(None)
        }
    }
    
    /// Mark an item as synced
    pub async fn mark_synced(&self, queue_id: i64) -> Result<()> {
        let now = Self::now_ms();
        
        self.conn.execute(
            "UPDATE sync_queue SET status = 'synced', updated_at = ? WHERE id = ?",
            libsql::params![now, queue_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Mark an item as failed (will retry)
    pub async fn mark_failed(&self, queue_id: i64) -> Result<()> {
        let now = Self::now_ms();
        
        self.conn.execute(
            "UPDATE sync_queue SET status = 'failed', retry_count = retry_count + 1, updated_at = ? WHERE id = ?",
            libsql::params![now, queue_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Reset failed items to pending (for retry)
    /// Only retries items that haven't exceeded max retries
    pub async fn reset_failed(&self, max_retries: i64) -> Result<i64> {
        let now = Self::now_ms();
        
        let result = self.conn.execute(
            "UPDATE sync_queue SET status = 'pending', updated_at = ? WHERE status = 'failed' AND retry_count < ?",
            libsql::params![now, max_retries]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if result > 0 {
            info!("Reset {} failed sync items for retry", result);
        }
        
        Ok(result as i64)
    }
    
    /// Clean up old synced items (keep last N hours for debugging)
    pub async fn cleanup_synced(&self, hours: i64) -> Result<i64> {
        let cutoff = Self::now_ms() - (hours * 60 * 60 * 1000);
        
        let result = self.conn.execute(
            "DELETE FROM sync_queue WHERE status = 'synced' AND updated_at < ?",
            libsql::params![cutoff]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if result > 0 {
            debug!("Cleaned up {} old synced items", result);
        }
        
        Ok(result as i64)
    }
    
    /// Delete permanently failed items (exceeded max retries)
    pub async fn cleanup_failed(&self, max_retries: i64) -> Result<i64> {
        let result = self.conn.execute(
            "DELETE FROM sync_queue WHERE status = 'failed' AND retry_count >= ?",
            libsql::params![max_retries]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if result > 0 {
            info!("Cleaned up {} permanently failed sync items", result);
        }
        
        Ok(result as i64)
    }
    
    // ========================================================================
    // DAILY ROLLUP CACHE OPERATIONS
    // ========================================================================
    
    /// Update daily rollup cache
    pub async fn update_daily_rollup(
        &self,
        date: &str,
        device_id: &str,
        user_id: &str,
        total_active_ms: i64,
        total_afk_ms: i64,
        app_summaries: Option<&str>,
        domain_summaries: Option<&str>,
    ) -> Result<()> {
        let now = Self::now_ms();
        
        self.conn.execute(
            r#"
            INSERT INTO daily_rollup_cache (date, device_id, user_id, total_active_ms, total_afk_ms, app_summaries, domain_summaries, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, device_id) DO UPDATE SET
                total_active_ms = ?,
                total_afk_ms = ?,
                app_summaries = ?,
                domain_summaries = ?,
                updated_at = ?
            "#,
            libsql::params![
                date, device_id, user_id, total_active_ms, total_afk_ms, 
                app_summaries, domain_summaries, now,
                total_active_ms, total_afk_ms, app_summaries, domain_summaries, now
            ]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Get daily rollup from cache
    pub async fn get_daily_rollup(&self, date: &str, device_id: &str) -> Result<Option<DailyRollup>> {
        let mut rows = self.conn.query(
            "SELECT date, device_id, user_id, total_active_ms, total_afk_ms, app_summaries, domain_summaries, updated_at FROM daily_rollup_cache WHERE date = ? AND device_id = ?",
            libsql::params![date, device_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            Ok(Some(DailyRollup {
                date: row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?,
                device_id: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                user_id: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                total_active_ms: row.get(3).unwrap_or(0),
                total_afk_ms: row.get(4).unwrap_or(0),
                app_summaries: row.get(5).ok(),
                domain_summaries: row.get(6).ok(),
                updated_at: row.get(7).unwrap_or(0),
            }))
        } else {
            Ok(None)
        }
    }
    
    /// Get all rollups for a date range
    pub async fn get_rollups_in_range(
        &self,
        device_id: &str,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<DailyRollup>> {
        let mut rows = self.conn.query(
            r#"
            SELECT date, device_id, user_id, total_active_ms, total_afk_ms, app_summaries, domain_summaries, updated_at 
            FROM daily_rollup_cache 
            WHERE device_id = ? AND date >= ? AND date <= ?
            ORDER BY date ASC
            "#,
            libsql::params![device_id, start_date, end_date]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut rollups = Vec::new();
        
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            rollups.push(DailyRollup {
                date: row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?,
                device_id: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                user_id: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                total_active_ms: row.get(3).unwrap_or(0),
                total_afk_ms: row.get(4).unwrap_or(0),
                app_summaries: row.get(5).ok(),
                domain_summaries: row.get(6).ok(),
                updated_at: row.get(7).unwrap_or(0),
            });
        }
        
        Ok(rollups)
    }
    
    /// Delete old rollup cache entries
    pub async fn cleanup_old_rollups(&self, days_to_keep: i64) -> Result<i64> {
        let cutoff_date = chrono::Utc::now()
            .checked_sub_signed(chrono::Duration::days(days_to_keep))
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        
        let result = self.conn.execute(
            "DELETE FROM daily_rollup_cache WHERE date < ?",
            libsql::params![cutoff_date]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(result as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use libsql::Builder;
    use tempfile::TempDir;
    
    async fn create_test_db() -> (libsql::Database, Connection, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        
        let db = Builder::new_local(db_path.to_str().unwrap())
            .build()
            .await
            .unwrap();
        
        let conn = db.connect().unwrap();
        
        // Initialize schema
        crate::schema::initialize_schema(&conn).await.unwrap();
        
        (db, conn, temp_dir)
    }
    
    #[tokio::test]
    async fn test_queue_activity_sync() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);
        
        // Initially no pending items
        assert_eq!(ops.pending_count().await.unwrap(), 0);
        
        // Queue an event
        ops.queue_activity_sync(1).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 1);
        
        // Duplicate should not increase count
        ops.queue_activity_sync(1).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 1);
        
        // Different event should increase
        ops.queue_activity_sync(2).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 2);
    }
    
    #[tokio::test]
    async fn test_queue_activity_update() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);
        
        // Queue an update
        ops.queue_activity_update(1, 2000).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 1);
        
        // Update the same event - should update existing entry
        ops.queue_activity_update(1, 3000).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 1);
        
        // Get pending and verify ts_end was updated
        let pending = ops.get_pending(10).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].ts_end, Some(3000));
    }
    
    #[tokio::test]
    async fn test_mark_synced_and_failed() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);
        
        // Queue events
        ops.queue_activity_sync(1).await.unwrap();
        ops.queue_activity_sync(2).await.unwrap();
        
        let pending = ops.get_pending(10).await.unwrap();
        assert_eq!(pending.len(), 2);
        
        // Mark first as synced
        ops.mark_synced(pending[0].id).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 1);
        
        // Mark second as failed
        ops.mark_failed(pending[1].id).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 0);
        
        // Check item was marked failed
        let item = ops.get_sync_item(pending[1].id).await.unwrap().unwrap();
        assert_eq!(item.status, SyncStatus::Failed);
        assert_eq!(item.retry_count, 1);
    }
    
    #[tokio::test]
    async fn test_reset_failed() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);
        
        // Queue and fail an event
        ops.queue_activity_sync(1).await.unwrap();
        let pending = ops.get_pending(10).await.unwrap();
        ops.mark_failed(pending[0].id).await.unwrap();
        
        // No pending now
        assert_eq!(ops.pending_count().await.unwrap(), 0);
        
        // Reset failed
        let reset = ops.reset_failed(5).await.unwrap();
        assert_eq!(reset, 1);
        
        // Should be pending again
        assert_eq!(ops.pending_count().await.unwrap(), 1);
    }
    
    #[tokio::test]
    async fn test_daily_rollup() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);
        
        // No rollup initially
        let rollup = ops.get_daily_rollup("2024-01-01", "device1").await.unwrap();
        assert!(rollup.is_none());
        
        // Create rollup
        ops.update_daily_rollup(
            "2024-01-01",
            "device1",
            "user1",
            3600000,
            1800000,
            Some(r#"[{"app": "VSCode", "ms": 3600000}]"#),
            None,
        ).await.unwrap();
        
        // Get rollup
        let rollup = ops.get_daily_rollup("2024-01-01", "device1").await.unwrap();
        assert!(rollup.is_some());
        let rollup = rollup.unwrap();
        assert_eq!(rollup.total_active_ms, 3600000);
        assert_eq!(rollup.total_afk_ms, 1800000);
        
        // Update rollup
        ops.update_daily_rollup(
            "2024-01-01",
            "device1",
            "user1",
            7200000,
            3600000,
            None,
            None,
        ).await.unwrap();
        
        let rollup = ops.get_daily_rollup("2024-01-01", "device1").await.unwrap().unwrap();
        assert_eq!(rollup.total_active_ms, 7200000);
    }
}
