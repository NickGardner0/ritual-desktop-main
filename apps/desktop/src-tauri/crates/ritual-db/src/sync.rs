//! Sync queue database operations
//!
//! This module handles:
//! - Queuing activity events for backend sync
//! - Managing sync status (pending, synced, failed)
//! - Retry logic for failed syncs
//! - Daily rollup caching

use libsql::Connection;
use serde_json::Value;
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
        let queued = self.force_activity_event_pending(event_id).await?;
        if queued > 0 {
            debug!("Queued activity event {} for cloud sync", event_id);
        }
        Ok(())
    }

    /// Queue an activity update (end time extended)
    pub async fn queue_activity_update(&self, event_id: i64, ts_end: i64) -> Result<()> {
        let queued = self.force_activity_event_pending(event_id).await?;
        if queued > 0 {
            debug!(
                "Queued activity update for event {} (end: {})",
                event_id, ts_end
            );
        }
        Ok(())
    }

    /// Get count of pending sync items
    pub async fn pending_count(&self) -> Result<i64> {
        let mut rows = self
            .conn
            .query(
                "SELECT COUNT(*) FROM cloud_sync_outbox WHERE status = 'pending'",
                (),
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let count = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);

        Ok(count)
    }

    /// Get pending items for sync (oldest first, with limit)
    pub async fn get_pending(&self, limit: i64) -> Result<Vec<QueuedSyncItem>> {
        let now = Self::now_ms();
        let stale_uploading_cutoff = now.saturating_sub(5 * 60 * 1000);
        let reclaim_next_retry_at = now.saturating_add(15_000);

        self.suppress_legacy_raw_memory_items(now).await?;

        let _ = self
            .conn
            .execute(
                r#"
                UPDATE cloud_sync_outbox
                SET status = 'failed',
                    retry_count = COALESCE(retry_count, 0) + 1,
                    next_retry_at = ?,
                    last_error = 'stale_uploading_reclaimed',
                    updated_at = ?
                WHERE status = 'uploading'
                  AND COALESCE(updated_at, 0) <= ?
                "#,
                libsql::params![reclaim_next_retry_at, now, stale_uploading_cutoff],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut rows = self
            .conn
            .query(
                r#"
            SELECT
                id,
                user_id,
                device_id,
                entity_type,
                entity_uid,
                op_kind,
                payload_json,
                retry_count,
                status,
                created_at,
                updated_at
            FROM cloud_sync_outbox
            WHERE status IN ('pending', 'failed')
              AND COALESCE(next_retry_at, 0) <= ?
              AND entity_type NOT IN ('context_session', 'context_snapshot', 'session_retrieval_doc')
            ORDER BY
                CASE status WHEN 'pending' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
                created_at ASC,
                id ASC
            LIMIT ?
            "#,
                libsql::params![now, limit],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut items = Vec::new();

        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            let id = row
                .get::<i64>(0)
                .map_err(|e| DatabaseError::Query(e.to_string()))?;
            let status_str: String = row.get(8).unwrap_or_else(|_| "pending".to_string());
            let claim_result = self
                .conn
                .execute(
                    r#"
                    UPDATE cloud_sync_outbox
                    SET status = 'uploading',
                        updated_at = ?
                    WHERE id = ?
                      AND status IN ('pending', 'failed')
                      AND COALESCE(next_retry_at, 0) <= ?
                    "#,
                    libsql::params![now, id, now],
                )
                .await
                .map_err(|e| DatabaseError::Query(e.to_string()))?;
            if claim_result <= 0 {
                continue;
            }

            items.push(queued_item_from_cloud_sync_row(&row, &status_str));
        }

        Ok(items)
    }

    /// Get a specific sync item by ID
    pub async fn get_sync_item(&self, id: i64) -> Result<Option<QueuedSyncItem>> {
        let mut rows = self
            .conn
            .query(
                r#"
            SELECT
                id,
                user_id,
                device_id,
                entity_type,
                entity_uid,
                op_kind,
                payload_json,
                retry_count,
                status,
                created_at,
                updated_at
            FROM cloud_sync_outbox
            WHERE id = ?
            "#,
                libsql::params![id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        if let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            let status_str: String = row.get(8).unwrap_or_else(|_| "pending".to_string());
            Ok(Some(queued_item_from_cloud_sync_row(&row, &status_str)))
        } else {
            Ok(None)
        }
    }

    /// Mark an item as synced
    pub async fn mark_synced(&self, queue_id: i64) -> Result<()> {
        let now = Self::now_ms();

        self.conn
            .execute(
                "UPDATE cloud_sync_outbox SET status = 'uploaded', last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?",
                libsql::params![now, queue_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(())
    }

    /// Mark an item as failed (will retry)
    pub async fn mark_failed(&self, queue_id: i64) -> Result<()> {
        let now = Self::now_ms();
        let mut rows = self
            .conn
            .query(
                "SELECT retry_count FROM cloud_sync_outbox WHERE id = ?",
                libsql::params![queue_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        let retry_count = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<i64>(0).ok())
            .unwrap_or(0)
            + 1;
        let capped_retry = retry_count.clamp(1, 8);
        let delay_ms = 15_000_i64.saturating_mul(1_i64 << (capped_retry - 1));
        let next_retry_at = now.saturating_add(delay_ms);

        self.conn.execute(
            "UPDATE cloud_sync_outbox SET status = 'failed', retry_count = ?, next_retry_at = ?, last_error = 'cloud_sync_failed', updated_at = ? WHERE id = ?",
            libsql::params![retry_count, next_retry_at, now, queue_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(())
    }

    /// Mark an item as permanently invalid so it cannot block later uploads.
    pub async fn mark_dead_letter(&self, queue_id: i64, last_error: &str) -> Result<()> {
        let now = Self::now_ms();
        let last_error: String = last_error.chars().take(500).collect();

        self.conn.execute(
            "UPDATE cloud_sync_outbox SET status = 'dead_letter', next_retry_at = NULL, last_error = ?, updated_at = ? WHERE id = ?",
            libsql::params![last_error, now, queue_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(())
    }

    /// Reset failed items to pending (for retry)
    /// Only retries items that haven't exceeded max retries
    pub async fn reset_failed(&self, max_retries: i64) -> Result<i64> {
        let now = Self::now_ms();

        let result = self.conn.execute(
            "UPDATE cloud_sync_outbox SET status = 'pending', next_retry_at = NULL, updated_at = ? WHERE status = 'failed' AND retry_count < ?",
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

        let result = self
            .conn
            .execute(
                "DELETE FROM cloud_sync_outbox WHERE status = 'uploaded' AND updated_at < ?",
                libsql::params![cutoff],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        if result > 0 {
            debug!("Cleaned up {} old synced items", result);
        }

        Ok(result as i64)
    }

    /// Delete permanently failed items (exceeded max retries)
    pub async fn cleanup_failed(&self, max_retries: i64) -> Result<i64> {
        let result = self
            .conn
            .execute(
                "DELETE FROM cloud_sync_outbox WHERE status = 'failed' AND retry_count >= ?",
                libsql::params![max_retries],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

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
    pub async fn get_daily_rollup(
        &self,
        date: &str,
        device_id: &str,
    ) -> Result<Option<DailyRollup>> {
        let mut rows = self.conn.query(
            "SELECT date, device_id, user_id, total_active_ms, total_afk_ms, app_summaries, domain_summaries, updated_at FROM daily_rollup_cache WHERE date = ? AND device_id = ?",
            libsql::params![date, device_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        if let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            Ok(Some(DailyRollup {
                date: row
                    .get(0)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                device_id: row
                    .get(1)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                user_id: row
                    .get(2)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
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

        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            rollups.push(DailyRollup {
                date: row
                    .get(0)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                device_id: row
                    .get(1)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                user_id: row
                    .get(2)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
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

        let result = self
            .conn
            .execute(
                "DELETE FROM daily_rollup_cache WHERE date < ?",
                libsql::params![cutoff_date],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(result as i64)
    }
}

fn queued_item_from_cloud_sync_row(row: &libsql::Row, status_str: &str) -> QueuedSyncItem {
    let payload_json = row.get::<String>(6).ok();
    let payload = payload_json
        .as_ref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok());

    QueuedSyncItem {
        id: row.get(0).unwrap_or(0),
        user_id: row.get::<String>(1).ok(),
        device_id: row.get::<String>(2).ok(),
        entry_type: row.get(3).unwrap_or_else(|_| "unknown".to_string()),
        entity_uid: row.get::<String>(4).ok(),
        op_kind: row.get::<String>(5).ok(),
        payload_json,
        event_id: payload
            .as_ref()
            .and_then(|value| value.get("id"))
            .and_then(json_i64)
            .unwrap_or(0),
        ts_end: payload
            .as_ref()
            .and_then(|value| value.get("ts_end"))
            .and_then(json_i64),
        retry_count: row.get(7).unwrap_or(0),
        status: SyncStatus::from_str(status_str),
        created_at: row.get(9).unwrap_or(0),
        updated_at: row.get(10).unwrap_or(0),
    }
}

fn json_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|v| i64::try_from(v).ok()))
        .or_else(|| value.as_str().and_then(|v| v.parse::<i64>().ok()))
}

impl<'a> SyncOps<'a> {
    async fn suppress_legacy_raw_memory_items(&self, now: i64) -> Result<()> {
        self.conn
            .execute(
                r#"
                UPDATE cloud_sync_outbox
                SET status = 'dead_letter',
                    next_retry_at = NULL,
                    last_error = 'raw_memory_cloud_sync_disabled',
                    updated_at = ?
                WHERE entity_type IN ('context_session', 'context_snapshot', 'session_retrieval_doc')
                  AND status IN ('pending', 'failed', 'uploading')
                "#,
                libsql::params![now],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(())
    }

    async fn force_activity_event_pending(&self, event_id: i64) -> Result<u64> {
        let now = Self::now_ms();
        self.conn
            .execute(
                r#"
                INSERT INTO cloud_sync_outbox (
                    user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                    status, retry_count, next_retry_at, last_error, created_at, updated_at
                )
                SELECT
                    user_id,
                    device_id,
                    'activity_event',
                    event_uid,
                    'upsert',
                    json_object(
                        'id', id,
                        'event_uid', event_uid,
                        'device_id', device_id,
                        'user_id', user_id,
                        'ts_start', ts_start,
                        'ts_end', ts_end,
                        'app_bundle_id', app_bundle_id,
                        'app_name', app_name,
                        'window_title', window_title,
                        'window_title_hash', window_title_hash,
                        'window_owner_pid', window_owner_pid,
                        'is_afk', is_afk,
                        'browser_url', browser_url,
                        'browser_domain', browser_domain,
                        'is_incognito', is_incognito,
                        'source', source,
                        'created_at', created_at
                    ),
                    'pending',
                    0,
                    NULL,
                    NULL,
                    COALESCE(created_at, ?),
                    ?
                FROM activity_events
                WHERE id = ?
                  AND TRIM(COALESCE(event_uid, '')) != ''
                ON CONFLICT(entity_type, entity_uid, op_kind) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    status = 'pending',
                    retry_count = 0,
                    next_retry_at = NULL,
                    last_error = NULL,
                    updated_at = excluded.updated_at
                "#,
                libsql::params![now, now, event_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))
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

    async fn insert_activity_event(conn: &Connection, id: i64, event_uid: &str, ts_end: i64) {
        conn.execute(
            r#"
            INSERT INTO activity_events (
                id,
                event_uid,
                device_id,
                user_id,
                ts_start,
                ts_end,
                app_bundle_id,
                app_name,
                source,
                created_at
            ) VALUES (?, ?, 'device-1', 'user-1', 1000, ?, 'com.test.app', 'Test App', 'test', 1000)
            "#,
            libsql::params![id, event_uid, ts_end],
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_queue_activity_sync() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);

        // Initially no pending items
        assert_eq!(ops.pending_count().await.unwrap(), 0);

        insert_activity_event(&conn, 1, "event-1", 1500).await;
        assert_eq!(ops.pending_count().await.unwrap(), 1);

        // Explicitly forcing the same event should not duplicate the trigger-created row.
        ops.queue_activity_sync(1).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 1);

        // Duplicate should not increase count
        ops.queue_activity_sync(1).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 1);

        insert_activity_event(&conn, 2, "event-2", 2500).await;
        assert_eq!(ops.pending_count().await.unwrap(), 2);

        // Explicitly forcing a second event also should not duplicate it.
        ops.queue_activity_sync(2).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 2);
    }

    #[tokio::test]
    async fn test_queue_activity_update() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);

        insert_activity_event(&conn, 1, "event-1", 1500).await;

        conn.execute("UPDATE activity_events SET ts_end = 2000 WHERE id = 1", ())
            .await
            .unwrap();
        // Queue an update
        ops.queue_activity_update(1, 2000).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 1);

        conn.execute("UPDATE activity_events SET ts_end = 3000 WHERE id = 1", ())
            .await
            .unwrap();
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

        insert_activity_event(&conn, 1, "event-1", 1500).await;
        insert_activity_event(&conn, 2, "event-2", 2500).await;

        // Queue events
        ops.queue_activity_sync(1).await.unwrap();
        ops.queue_activity_sync(2).await.unwrap();

        let pending = ops.get_pending(10).await.unwrap();
        assert_eq!(pending.len(), 2);
        assert_eq!(ops.pending_count().await.unwrap(), 0);

        // Mark first as synced
        ops.mark_synced(pending[0].id).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 0);

        // Mark second as failed
        ops.mark_failed(pending[1].id).await.unwrap();
        assert_eq!(ops.pending_count().await.unwrap(), 0);

        // Check item was marked failed
        let item = ops.get_sync_item(pending[1].id).await.unwrap().unwrap();
        assert_eq!(item.status, SyncStatus::Failed);
        assert_eq!(item.retry_count, 1);
    }

    #[tokio::test]
    async fn test_pending_items_are_prioritized_before_retryable_failures() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);

        insert_activity_event(&conn, 1, "event-1", 1500).await;
        insert_activity_event(&conn, 2, "event-2", 2500).await;

        ops.queue_activity_sync(1).await.unwrap();
        let first = ops.get_pending(1).await.unwrap();
        ops.mark_failed(first[0].id).await.unwrap();
        conn.execute(
            "UPDATE cloud_sync_outbox SET next_retry_at = 0 WHERE id = ?",
            libsql::params![first[0].id],
        )
        .await
        .unwrap();

        ops.queue_activity_sync(2).await.unwrap();
        let pending = ops.get_pending(1).await.unwrap();

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].entity_uid.as_deref(), Some("event-2"));
    }

    #[tokio::test]
    async fn test_dead_letter_items_are_not_retried() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);

        insert_activity_event(&conn, 1, "event-1", 1500).await;
        ops.queue_activity_sync(1).await.unwrap();
        let pending = ops.get_pending(1).await.unwrap();
        ops.mark_dead_letter(pending[0].id, "invalid payload")
            .await
            .unwrap();

        let item = ops.get_sync_item(pending[0].id).await.unwrap().unwrap();
        assert_eq!(item.status, SyncStatus::DeadLetter);
        assert!(ops.get_pending(10).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_reset_failed() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SyncOps::new(&conn);

        insert_activity_event(&conn, 1, "event-1", 1500).await;

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
        )
        .await
        .unwrap();

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
        )
        .await
        .unwrap();

        let rollup = ops
            .get_daily_rollup("2024-01-01", "device1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(rollup.total_active_ms, 7200000);
    }
}
