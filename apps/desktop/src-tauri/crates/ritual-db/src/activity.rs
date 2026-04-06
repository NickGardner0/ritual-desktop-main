//! Activity tracking database operations
//!
//! This module handles:
//! - Activity event CRUD operations
//! - AFK event management
//! - Heartbeat tracking
//! - Activity summaries and analytics

use libsql::Connection;
use tracing::debug;

use crate::error::{DatabaseError, Result};
use crate::types::{
    ActivityEvent, AppSummary, DailySummary, DomainSummary, 
    FocusMetrics, LastEvent,
};

/// Activity operations for the database
pub struct ActivityOps<'a> {
    conn: &'a Connection,
}

impl<'a> ActivityOps<'a> {
    /// Create a new ActivityOps with a connection reference
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }
    
    // ========================================================================
    // ACTIVITY EVENT OPERATIONS
    // ========================================================================
    
    /// Insert a new activity event and return its ID
    pub async fn insert_activity_event(&self, event: &ActivityEvent) -> Result<i64> {
        self.conn.execute(
            r#"
            INSERT INTO activity_events (
                device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                window_title, window_title_hash, window_owner_pid, is_afk,
                browser_url, browser_domain, is_incognito, source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
            libsql::params![
                event.device_id.clone(),
                event.user_id.clone(),
                event.ts_start,
                event.ts_end,
                event.app_bundle_id.clone(),
                event.app_name.clone(),
                event.window_title.clone(),
                event.window_title_hash.clone(),
                event.window_owner_pid,
                if event.is_afk { 1i64 } else { 0i64 },
                event.browser_url.clone(),
                event.browser_domain.clone(),
                if event.is_incognito { 1i64 } else { 0i64 },
                event.source.clone(),
                event.created_at,
            ]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        // Get the last inserted row ID
        let mut rows = self.conn.query("SELECT last_insert_rowid()", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let id = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        debug!("Inserted activity event with id {}", id);
        Ok(id)
    }
    
    /// Update the end time of an activity event (heartbeat pattern)
    pub async fn update_event_end_time(&self, event_id: i64, ts_end: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE activity_events SET ts_end = ? WHERE id = ?",
            libsql::params![ts_end, event_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Get the last event for a device (for heartbeat merging)
    pub async fn get_last_event(&self, device_id: &str) -> Result<Option<LastEvent>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, ts_start, ts_end, app_bundle_id, window_title, window_title_hash,
                   browser_url, browser_domain, is_afk
            FROM activity_events
            WHERE device_id = ?
            ORDER BY ts_end DESC
            LIMIT 1
            "#,
            libsql::params![device_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            Ok(Some(LastEvent {
                id: row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_start: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_end: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                app_bundle_id: row.get(3).map_err(|e| DatabaseError::Query(e.to_string()))?,
                window_title: row.get(4).ok(),
                window_title_hash: row.get(5).ok(),
                browser_url: row.get(6).ok(),
                browser_domain: row.get(7).ok(),
                is_afk: row.get::<i64>(8).unwrap_or(0) != 0,
            }))
        } else {
            Ok(None)
        }
    }
    
    /// Get an activity event by ID
    pub async fn get_activity_event(&self, id: i64) -> Result<Option<ActivityEvent>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                   window_title, window_title_hash, window_owner_pid, is_afk,
                   browser_url, browser_domain, is_incognito, source, created_at
            FROM activity_events
            WHERE id = ?
            "#,
            libsql::params![id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        self.row_to_activity_event(&mut rows).await
    }
    
    /// Get recent activity events for a device
    pub async fn get_recent_events(&self, device_id: &str, limit: i64) -> Result<Vec<ActivityEvent>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                   window_title, window_title_hash, window_owner_pid, is_afk,
                   browser_url, browser_domain, is_incognito, source, created_at
            FROM activity_events
            WHERE device_id = ?
            ORDER BY ts_start DESC
            LIMIT ?
            "#,
            libsql::params![device_id, limit]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        self.rows_to_activity_events(&mut rows).await
    }
    
    /// Get activity events in a time range
    pub async fn get_events_in_range(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<Vec<ActivityEvent>> {
        let mut rows = self.conn.query(
            r#"
            SELECT id, device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                   window_title, window_title_hash, window_owner_pid, is_afk,
                   browser_url, browser_domain, is_incognito, source, created_at
            FROM activity_events
            WHERE device_id = ? AND ts_end > ? AND ts_start < ?
            ORDER BY ts_start ASC
            "#,
            libsql::params![device_id, ts_start, ts_end]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        self.rows_to_activity_events(&mut rows).await
    }
    
    /// Get event count for a device
    pub async fn get_event_count(&self, device_id: &str) -> Result<i64> {
        let mut rows = self.conn.query(
            "SELECT COUNT(*) FROM activity_events WHERE device_id = ?",
            libsql::params![device_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let count = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        Ok(count)
    }
    
    /// Delete old events (retention policy)
    pub async fn delete_old_events(&self, days: i64) -> Result<i64> {
        let cutoff_ms = chrono::Utc::now().timestamp_millis() - (days * 24 * 60 * 60 * 1000);
        
        let result = self.conn.execute(
            "DELETE FROM activity_events WHERE ts_end < ?",
            libsql::params![cutoff_ms]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(result as i64)
    }

    /// Clamp stale browser-extension events so a broken open interval cannot span for hours.
    pub async fn clamp_stale_browser_extension_events(
        &self,
        device_id: &str,
        stale_before_ts: i64,
        max_span_ms: i64,
    ) -> Result<i64> {
        let result = self.conn.execute(
            r#"
            UPDATE activity_events
            SET ts_end = ts_start + ?
            WHERE device_id = ?
              AND source = 'browser_extension'
              AND ts_end > ts_start
              AND (ts_end - ts_start) > ?
              AND ts_end <= ?
            "#,
            libsql::params![max_span_ms, device_id, max_span_ms, stale_before_ts],
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(result as i64)
    }

    /// Delete duplicate/contained browser-extension events, keeping the longest row
    /// for a logical browser session start and breaking exact ties by earliest id.
    pub async fn delete_duplicate_browser_extension_events(
        &self,
        device_id: &str,
        lookback_ts: i64,
    ) -> Result<i64> {
        let result = self.conn.execute(
            r#"
            DELETE FROM activity_events
            WHERE id IN (
                SELECT victim.id
                FROM activity_events AS victim
                JOIN activity_events AS keeper
                  ON keeper.id != victim.id
                 AND keeper.device_id = victim.device_id
                 AND keeper.user_id = victim.user_id
                 AND keeper.source = 'browser_extension'
                 AND victim.source = 'browser_extension'
                 AND keeper.ts_start = victim.ts_start
                 AND COALESCE(keeper.app_bundle_id, '') = COALESCE(victim.app_bundle_id, '')
                 AND COALESCE(keeper.app_name, '') = COALESCE(victim.app_name, '')
                 AND COALESCE(keeper.browser_url, '') = COALESCE(victim.browser_url, '')
                 AND COALESCE(keeper.browser_domain, '') = COALESCE(victim.browser_domain, '')
                 AND COALESCE(keeper.is_incognito, 0) = COALESCE(victim.is_incognito, 0)
                 AND (
                    keeper.ts_end > victim.ts_end
                    OR (keeper.ts_end = victim.ts_end AND keeper.id < victim.id)
                 )
                WHERE victim.device_id = ?
                  AND victim.ts_start >= ?
            )
            "#,
            libsql::params![device_id, lookback_ts],
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(result as i64)
    }
    
    // ========================================================================
    // AFK EVENT OPERATIONS
    // ========================================================================
    
    /// Insert or update an AFK event
    pub async fn upsert_afk_event(
        &self,
        device_id: &str,
        user_id: &str,
        ts_start: i64,
        ts_end: i64,
        status: &str,
    ) -> Result<i64> {
        let now = chrono::Utc::now().timestamp_millis();
        
        // Try to update existing event with same status
        let updated = self.conn.execute(
            r#"
            UPDATE afk_events 
            SET ts_end = ?
            WHERE id = (
                SELECT id FROM afk_events 
                WHERE device_id = ? AND status = ?
                ORDER BY ts_end DESC LIMIT 1
            )
            "#,
            libsql::params![ts_end, device_id, status]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if updated > 0 {
            // Return the updated row id
            let mut rows = self.conn.query(
                "SELECT id FROM afk_events WHERE device_id = ? ORDER BY ts_end DESC LIMIT 1",
                libsql::params![device_id]
            ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
            
            let id = rows.next()
                .await
                .map_err(|e| DatabaseError::Query(e.to_string()))?
                .map(|row| row.get::<i64>(0).unwrap_or(0))
                .unwrap_or(0);
            
            return Ok(id);
        }
        
        // Insert new event
        self.conn.execute(
            "INSERT INTO afk_events (device_id, user_id, ts_start, ts_end, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            libsql::params![device_id, user_id, ts_start, ts_end, status, now]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut rows = self.conn.query("SELECT last_insert_rowid()", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let id = rows.next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        Ok(id)
    }
    
    /// Delete old AFK events
    pub async fn delete_old_afk_events(&self, days: i64) -> Result<i64> {
        let cutoff_ms = chrono::Utc::now().timestamp_millis() - (days * 24 * 60 * 60 * 1000);
        
        let result = self.conn.execute(
            "DELETE FROM afk_events WHERE ts_end < ?",
            libsql::params![cutoff_ms]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(result as i64)
    }
    
    /// Get database statistics (for diagnostics)
    pub async fn get_db_stats(&self) -> Result<crate::blocking::DbStats> {
        let event_count: i64 = self.conn
            .query("SELECT COUNT(*) FROM activity_events", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        let afk_count: i64 = self.conn
            .query("SELECT COUNT(*) FROM afk_events", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        let oldest_event_ts: Option<i64> = self.conn
            .query("SELECT MIN(ts_start) FROM activity_events", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<i64>(0).ok());
        
        let newest_event_ts: Option<i64> = self.conn
            .query("SELECT MAX(ts_end) FROM activity_events", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<i64>(0).ok());
        
        // Get database file size via PRAGMA
        let page_count: i64 = self.conn
            .query("PRAGMA page_count", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);
        
        let page_size: i64 = self.conn
            .query("PRAGMA page_size", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(4096);
        
        Ok(crate::blocking::DbStats {
            event_count,
            afk_count,
            oldest_event_ts,
            newest_event_ts,
            db_size_bytes: page_count * page_size,
        })
    }
    
    // ========================================================================
    // HEARTBEAT OPERATIONS
    // ========================================================================
    
    /// Update the heartbeat timestamp for a device
    pub async fn update_heartbeat(&self, device_id: &str, timestamp: i64) -> Result<()> {
        self.conn.execute(
            r#"
            INSERT INTO watcher_heartbeat (device_id, last_seen_ts)
            VALUES (?, ?)
            ON CONFLICT(device_id) DO UPDATE SET last_seen_ts = ?
            "#,
            libsql::params![device_id, timestamp, timestamp]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        Ok(())
    }
    
    /// Get the last heartbeat timestamp for a device
    pub async fn get_last_heartbeat(&self, device_id: &str) -> Result<Option<i64>> {
        let mut rows = self.conn.query(
            "SELECT last_seen_ts FROM watcher_heartbeat WHERE device_id = ?",
            libsql::params![device_id]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            Ok(Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?))
        } else {
            Ok(None)
        }
    }
    
    // ========================================================================
    // SUMMARY AND ANALYTICS OPERATIONS
    // ========================================================================
    
    /// Get app usage summary for a time range
    pub async fn get_app_summary(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<Vec<AppSummary>> {
        let mut rows = self.conn.query(
            r#"
            SELECT 
                app_bundle_id,
                app_name,
                COUNT(*) as event_count,
                SUM(CASE WHEN ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as total_ms
            FROM activity_events
            WHERE device_id = ? 
              AND ts_start >= ? 
              AND ts_start < ?
              AND is_afk = 0
            GROUP BY app_bundle_id
            ORDER BY total_ms DESC
            "#,
            libsql::params![device_id, ts_start, ts_end]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut summaries = Vec::new();
        
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            summaries.push(AppSummary {
                bundle_id: row.get(0).unwrap_or_default(),
                app_name: row.get(1).unwrap_or_default(),
                event_count: row.get(2).unwrap_or(0),
                total_ms: row.get(3).unwrap_or(0),
            });
        }
        
        Ok(summaries)
    }
    
    /// Get domain usage summary for a time range
    pub async fn get_domain_summary(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<Vec<DomainSummary>> {
        let mut rows = self.conn.query(
            r#"
            SELECT 
                browser_domain,
                COUNT(*) as event_count,
                SUM(ts_end - ts_start) as total_ms
            FROM activity_events
            WHERE device_id = ? 
              AND ts_start >= ? 
              AND ts_end <= ?
              AND browser_domain IS NOT NULL
              AND browser_domain != ''
            GROUP BY browser_domain
            ORDER BY total_ms DESC
            "#,
            libsql::params![device_id, ts_start, ts_end]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut summaries = Vec::new();
        
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            summaries.push(DomainSummary {
                domain: row.get(0).unwrap_or_default(),
                event_count: row.get(1).unwrap_or(0),
                total_ms: row.get(2).unwrap_or(0),
            });
        }
        
        Ok(summaries)
    }
    
    /// Get daily summary statistics
    pub async fn get_daily_summary(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<DailySummary> {
        let mut rows = self.conn.query(
            r#"
            SELECT 
                SUM(CASE WHEN is_afk = 0 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as active_ms,
                SUM(CASE WHEN is_afk = 1 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as afk_ms,
                COUNT(*) as event_count,
                COUNT(DISTINCT app_bundle_id) as app_count,
                COUNT(DISTINCT browser_domain) as domain_count
            FROM activity_events
            WHERE device_id = ? 
              AND ts_start >= ? 
              AND ts_start < ?
            "#,
            libsql::params![device_id, ts_start, ts_end]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            Ok(DailySummary {
                date: chrono::Utc::now().format("%Y-%m-%d").to_string(),
                device_id: device_id.to_string(),
                active_ms: row.get::<i64>(0).unwrap_or(0),
                afk_ms: row.get::<i64>(1).unwrap_or(0),
                event_count: row.get(2).unwrap_or(0),
                app_count: row.get(3).unwrap_or(0),
                domain_count: row.get(4).unwrap_or(0),
            })
        } else {
            Ok(DailySummary {
                date: chrono::Utc::now().format("%Y-%m-%d").to_string(),
                device_id: device_id.to_string(),
                active_ms: 0,
                afk_ms: 0,
                event_count: 0,
                app_count: 0,
                domain_count: 0,
            })
        }
    }
    
    /// Get focus and productivity metrics
    pub async fn get_focus_metrics(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<FocusMetrics> {
        let mut rows = self.conn.query(
            r#"
            SELECT ts_start, ts_end, app_bundle_id, is_afk
            FROM activity_events
            WHERE device_id = ? AND ts_start >= ? AND ts_start < ? AND is_afk = 0
            ORDER BY ts_start ASC
            "#,
            libsql::params![device_id, ts_start, ts_end]
        ).await.map_err(|e| DatabaseError::Query(e.to_string()))?;
        
        let mut events: Vec<(i64, i64, String)> = Vec::new();
        
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            events.push((
                row.get(0).unwrap_or(0),
                row.get(1).unwrap_or(0),
                row.get(2).unwrap_or_default(),
            ));
        }
        
        if events.is_empty() {
            return Ok(FocusMetrics {
                context_switches: 0,
                longest_focus_session_ms: 0,
                focus_sessions_30min_plus: 0,
                fragmented_time_ms: 0,
                deep_work_time_ms: 0,
            });
        }
        
        let mut context_switches = 0i64;
        let mut longest_focus_session_ms = 0i64;
        let mut focus_sessions_30min_plus = 0i64;
        let mut fragmented_time_ms = 0i64;
        let mut deep_work_time_ms = 0i64;
        let mut last_app: Option<String> = None;
        
        for (start, end, app) in &events {
            let duration = end - start;
            
            // Track context switches (app changes)
            if let Some(ref prev_app) = last_app {
                if prev_app != app {
                    context_switches += 1;
                }
            }
            last_app = Some(app.clone());
            
            // Track focus sessions
            if duration > longest_focus_session_ms {
                longest_focus_session_ms = duration;
            }
            
            // 30+ minute sessions
            if duration >= 30 * 60 * 1000 {
                focus_sessions_30min_plus += 1;
                deep_work_time_ms += duration;
            }
            
            // Fragmented time (< 2 minutes)
            if duration < 2 * 60 * 1000 {
                fragmented_time_ms += duration;
            }
        }
        
        Ok(FocusMetrics {
            context_switches,
            longest_focus_session_ms,
            focus_sessions_30min_plus,
            fragmented_time_ms,
            deep_work_time_ms,
        })
    }
    
    // ========================================================================
    // HELPER METHODS
    // ========================================================================
    
    /// Convert a single row to ActivityEvent
    async fn row_to_activity_event(&self, rows: &mut libsql::Rows) -> Result<Option<ActivityEvent>> {
        if let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            Ok(Some(ActivityEvent {
                id: Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?),
                device_id: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                user_id: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_start: row.get(3).map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_end: row.get(4).map_err(|e| DatabaseError::Query(e.to_string()))?,
                app_bundle_id: row.get(5).map_err(|e| DatabaseError::Query(e.to_string()))?,
                app_name: row.get(6).map_err(|e| DatabaseError::Query(e.to_string()))?,
                window_title: row.get(7).ok(),
                window_title_hash: row.get(8).ok(),
                window_owner_pid: row.get(9).ok(),
                is_afk: row.get::<i64>(10).unwrap_or(0) != 0,
                browser_url: row.get(11).ok(),
                browser_domain: row.get(12).ok(),
                is_incognito: row.get::<i64>(13).unwrap_or(0) != 0,
                source: row.get(14).unwrap_or_else(|_| "unknown".to_string()),
                created_at: row.get(15).unwrap_or(0),
            }))
        } else {
            Ok(None)
        }
    }
    
    /// Convert multiple rows to Vec<ActivityEvent>
    async fn rows_to_activity_events(&self, rows: &mut libsql::Rows) -> Result<Vec<ActivityEvent>> {
        let mut events = Vec::new();
        
        while let Some(row) = rows.next().await.map_err(|e| DatabaseError::Query(e.to_string()))? {
            events.push(ActivityEvent {
                id: Some(row.get(0).map_err(|e| DatabaseError::Query(e.to_string()))?),
                device_id: row.get(1).map_err(|e| DatabaseError::Query(e.to_string()))?,
                user_id: row.get(2).map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_start: row.get(3).map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_end: row.get(4).map_err(|e| DatabaseError::Query(e.to_string()))?,
                app_bundle_id: row.get(5).map_err(|e| DatabaseError::Query(e.to_string()))?,
                app_name: row.get(6).map_err(|e| DatabaseError::Query(e.to_string()))?,
                window_title: row.get(7).ok(),
                window_title_hash: row.get(8).ok(),
                window_owner_pid: row.get(9).ok(),
                is_afk: row.get::<i64>(10).unwrap_or(0) != 0,
                browser_url: row.get(11).ok(),
                browser_domain: row.get(12).ok(),
                is_incognito: row.get::<i64>(13).unwrap_or(0) != 0,
                source: row.get(14).unwrap_or_else(|_| "unknown".to_string()),
                created_at: row.get(15).unwrap_or(0),
            });
        }
        
        Ok(events)
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
    async fn test_insert_and_get_activity_event() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = ActivityOps::new(&conn);
        
        let event = ActivityEvent::new(
            "device1",
            "user1",
            1000,
            2000,
            "com.test.app",
            "Test App",
        );
        
        let id = ops.insert_activity_event(&event).await.unwrap();
        assert!(id > 0);
        
        let retrieved = ops.get_activity_event(id).await.unwrap();
        assert!(retrieved.is_some());
        
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.device_id, "device1");
        assert_eq!(retrieved.app_bundle_id, "com.test.app");
    }
    
    #[tokio::test]
    async fn test_update_event_end_time() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = ActivityOps::new(&conn);
        
        let event = ActivityEvent::new(
            "device1",
            "user1",
            1000,
            2000,
            "com.test.app",
            "Test App",
        );
        
        let id = ops.insert_activity_event(&event).await.unwrap();
        
        ops.update_event_end_time(id, 3000).await.unwrap();
        
        let retrieved = ops.get_activity_event(id).await.unwrap().unwrap();
        assert_eq!(retrieved.ts_end, 3000);
    }
    
    #[tokio::test]
    async fn test_get_last_event() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = ActivityOps::new(&conn);
        
        // No events initially
        let last = ops.get_last_event("device1").await.unwrap();
        assert!(last.is_none());
        
        // Insert an event
        let event = ActivityEvent::new(
            "device1",
            "user1",
            1000,
            2000,
            "com.test.app",
            "Test App",
        );
        ops.insert_activity_event(&event).await.unwrap();
        
        // Now should have last event
        let last = ops.get_last_event("device1").await.unwrap();
        assert!(last.is_some());
        assert_eq!(last.unwrap().app_bundle_id, "com.test.app");
    }
    
    #[tokio::test]
    async fn test_heartbeat() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = ActivityOps::new(&conn);
        
        // No heartbeat initially
        let hb = ops.get_last_heartbeat("device1").await.unwrap();
        assert!(hb.is_none());
        
        // Update heartbeat
        ops.update_heartbeat("device1", 1000).await.unwrap();
        
        let hb = ops.get_last_heartbeat("device1").await.unwrap();
        assert_eq!(hb, Some(1000));
        
        // Update again
        ops.update_heartbeat("device1", 2000).await.unwrap();
        
        let hb = ops.get_last_heartbeat("device1").await.unwrap();
        assert_eq!(hb, Some(2000));
    }
    
    #[tokio::test]
    async fn test_app_summary() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = ActivityOps::new(&conn);
        
        // Insert some events
        for i in 0..5 {
            let mut event = ActivityEvent::new(
                "device1",
                "user1",
                i * 1000,
                (i + 1) * 1000,
                "com.test.app",
                "Test App",
            );
            event.is_afk = false;
            ops.insert_activity_event(&event).await.unwrap();
        }
        
        let summary = ops.get_app_summary("device1", 0, 10000).await.unwrap();
        assert!(!summary.is_empty());
        assert_eq!(summary[0].bundle_id, "com.test.app");
        assert_eq!(summary[0].event_count, 5);
    }

    #[tokio::test]
    async fn test_clamp_stale_browser_extension_events() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = ActivityOps::new(&conn);

        let mut event = ActivityEvent::new(
            "device1",
            "user1",
            1_000,
            91_000,
            "com.google.Chrome",
            "Google Chrome",
        );
        event.source = "browser_extension".to_string();
        let id = ops.insert_activity_event(&event).await.unwrap();

        let clamped = ops
            .clamp_stale_browser_extension_events("device1", 120_000, 15_000)
            .await
            .unwrap();
        assert_eq!(clamped, 1);

        let repaired = ops.get_activity_event(id).await.unwrap().unwrap();
        assert_eq!(repaired.ts_end, 16_000);
    }

    #[tokio::test]
    async fn test_delete_duplicate_browser_extension_events() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = ActivityOps::new(&conn);

        let mut first = ActivityEvent::new(
            "device1",
            "user1",
            1_000,
            2_000,
            "com.google.Chrome",
            "Google Chrome",
        );
        first.source = "browser_extension".to_string();
        first.browser_domain = Some("example.com".to_string());
        first.window_title = Some("Example".to_string());
        ops.insert_activity_event(&first).await.unwrap();

        let mut duplicate = first.clone();
        duplicate.created_at += 1;
        ops.insert_activity_event(&duplicate).await.unwrap();

        let deleted = ops
            .delete_duplicate_browser_extension_events("device1", 0)
            .await
            .unwrap();
        assert_eq!(deleted, 1);
        assert_eq!(ops.get_event_count("device1").await.unwrap(), 1);
    }

    #[tokio::test]
    async fn test_delete_contained_browser_extension_events_keeps_longest_row() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = ActivityOps::new(&conn);

        let mut first = ActivityEvent::new(
            "device1",
            "user1",
            1_000,
            2_000,
            "com.google.Chrome",
            "Google Chrome",
        );
        first.source = "browser_extension".to_string();
        first.browser_domain = Some("example.com".to_string());
        first.browser_url = Some("https://example.com".to_string());
        ops.insert_activity_event(&first).await.unwrap();

        let mut longer = first.clone();
        longer.ts_end = 4_000;
        ops.insert_activity_event(&longer).await.unwrap();

        let deleted = ops
            .delete_duplicate_browser_extension_events("device1", 0)
            .await
            .unwrap();
        assert_eq!(deleted, 1);
        assert_eq!(ops.get_event_count("device1").await.unwrap(), 1);
        let kept = ops.get_activity_event(2).await.unwrap().unwrap();
        assert_eq!(kept.ts_start, 1_000);
        assert_eq!(kept.ts_end, 4_000);
    }
}
