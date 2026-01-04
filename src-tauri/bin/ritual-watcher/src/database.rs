//! Database operations for Ritual Watcher
//!
//! Uses SQLite for local storage of activity events.
//! Implements heartbeat/event merging pattern for efficiency.

#![allow(dead_code)] // Public API - methods used by Tauri commands

use rusqlite::{Connection, Result, params};
use std::sync::Mutex;
use tracing::info;

/// Database wrapper for thread-safe access
pub struct WatcherDatabase {
    conn: Mutex<Connection>,
}

impl WatcherDatabase {
    /// Create a new database connection and ensure tables exist
    pub fn new(path: &str) -> Result<Self> {
        // Expand ~ to home directory
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
        
        // Enable WAL mode for better concurrent access
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        
        let db = Self {
            conn: Mutex::new(conn),
        };
        
        // Order matters: create base tables first, then run migrations to add new columns
        db.ensure_base_tables()?;
        db.run_migrations()?;
        db.ensure_indexes()?;
        
        Ok(db)
    }

    /// Create base tables (without columns that may need migration)
    fn ensure_base_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute_batch(
            r#"
            -- Activity events table (base schema - migrations will add new columns)
            CREATE TABLE IF NOT EXISTS activity_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                ts_start INTEGER NOT NULL,
                ts_end INTEGER NOT NULL,
                app_bundle_id TEXT NOT NULL,
                app_name TEXT NOT NULL,
                window_title TEXT,
                window_title_hash TEXT,
                window_owner_pid INTEGER,
                is_afk INTEGER NOT NULL DEFAULT 0,
                source TEXT NOT NULL DEFAULT 'ritual_watcher_v2',
                created_at INTEGER NOT NULL
            );

            -- Heartbeat table for monitoring
            CREATE TABLE IF NOT EXISTS watcher_heartbeat (
                device_id TEXT PRIMARY KEY,
                last_seen_ts INTEGER NOT NULL
            );
            "#,
        )?;

        Ok(())
    }
    
    /// Create indexes (called after migrations ensure columns exist)
    /// 
    /// Indexes are optimized for common query patterns:
    /// - Daily/weekly analytics queries filtered by user+device+time range
    /// - Top apps/domains queries with grouping
    /// - Event merging queries (get last event by device)
    fn ensure_indexes(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        // Primary query indexes - optimized for time-range queries
        conn.execute_batch(
            r#"
            -- Single column indexes for basic queries
            CREATE INDEX IF NOT EXISTS idx_activity_events_ts_start 
            ON activity_events(ts_start);
            
            CREATE INDEX IF NOT EXISTS idx_activity_events_ts_end 
            ON activity_events(ts_end);

            -- Compound indexes for analytics queries (user+device+time)
            CREATE INDEX IF NOT EXISTS idx_activity_events_device_ts 
            ON activity_events(device_id, ts_start);
            
            CREATE INDEX IF NOT EXISTS idx_activity_events_device_ts_end 
            ON activity_events(device_id, ts_end DESC);

            CREATE INDEX IF NOT EXISTS idx_activity_events_user_device_ts 
            ON activity_events(user_id, device_id, ts_start);
            
            CREATE INDEX IF NOT EXISTS idx_activity_events_user_device_ts_end 
            ON activity_events(user_id, device_id, ts_end);
            
            -- App grouping queries
            CREATE INDEX IF NOT EXISTS idx_activity_events_app_ts 
            ON activity_events(user_id, device_id, app_bundle_id, ts_start);
            
            -- Covering index for event count and duration queries
            CREATE INDEX IF NOT EXISTS idx_activity_events_summary 
            ON activity_events(device_id, ts_start, ts_end, is_afk);
            "#,
        )?;
        
        // Create browser_domain index only if the column exists
        let has_browser_domain: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('activity_events') WHERE name='browser_domain'",
            [],
            |row| row.get::<_, i32>(0).map(|c| c > 0),
        )?;
        
        if has_browser_domain {
            conn.execute_batch(
                r#"
                CREATE INDEX IF NOT EXISTS idx_activity_events_domain 
                ON activity_events(browser_domain);
                
                CREATE INDEX IF NOT EXISTS idx_activity_events_domain_ts 
                ON activity_events(user_id, device_id, browser_domain, ts_start);
                "#
            )?;
        }
        
        // Create afk_events indexes if table exists
        let has_afk_table: bool = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='afk_events'",
            [],
            |row| row.get::<_, i32>(0).map(|c| c > 0),
        )?;
        
        if has_afk_table {
            conn.execute_batch(
                r#"
                CREATE INDEX IF NOT EXISTS idx_afk_events_device_ts 
                ON afk_events(device_id, ts_start);
                
                CREATE INDEX IF NOT EXISTS idx_afk_events_user_device_ts 
                ON afk_events(user_id, device_id, ts_start);
                "#
            )?;
        }
        
        Ok(())
    }
    
    /// Run database migrations for schema updates
    fn run_migrations(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        // Migration 1: Check if is_afk column exists (very old databases)
        let has_is_afk: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('activity_events') WHERE name='is_afk'",
            [],
            |row| row.get::<_, i32>(0).map(|c| c > 0),
        )?;
        
        if !has_is_afk {
            info!("Running migration: adding is_afk column");
            conn.execute(
                "ALTER TABLE activity_events ADD COLUMN is_afk INTEGER NOT NULL DEFAULT 0",
                []
            )?;
        }
        
        // Migration 2: Check if browser_url column exists
        let has_browser_url: bool = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('activity_events') WHERE name='browser_url'",
            [],
            |row| row.get::<_, i32>(0).map(|c| c > 0),
        )?;
        
        if !has_browser_url {
            info!("Running migration: adding browser tracking columns");
            conn.execute_batch(
                r#"
                ALTER TABLE activity_events ADD COLUMN browser_url TEXT;
                ALTER TABLE activity_events ADD COLUMN browser_domain TEXT;
                ALTER TABLE activity_events ADD COLUMN is_incognito INTEGER NOT NULL DEFAULT 0;
                "#
            )?;
        }
        
        // Migration 3: Check if afk_events table exists
        let has_afk_table: bool = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='afk_events'",
            [],
            |row| row.get::<_, i32>(0).map(|c| c > 0),
        )?;
        
        if !has_afk_table {
            info!("Running migration: creating afk_events table");
            conn.execute_batch(
                r#"
                CREATE TABLE afk_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    device_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    ts_start INTEGER NOT NULL,
                    ts_end INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                
                CREATE INDEX idx_afk_events_device_ts
                ON afk_events(device_id, ts_start);
                "#
            )?;
        }
        
        Ok(())
    }

    /// Insert a new activity event
    pub fn insert_activity_event(
        &self,
        device_id: &str,
        user_id: &str,
        ts_start: u64,
        ts_end: u64,
        app_bundle_id: &str,
        app_name: &str,
        window_title: Option<&str>,
        window_title_hash: Option<&str>,
        window_owner_pid: Option<i32>,
        is_afk: bool,
        browser_url: Option<&str>,
        browser_domain: Option<&str>,
        is_incognito: bool,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        conn.execute(
            r#"
            INSERT INTO activity_events (
                device_id, user_id, ts_start, ts_end,
                app_bundle_id, app_name, window_title, window_title_hash,
                window_owner_pid, is_afk, browser_url, browser_domain, is_incognito,
                source, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'ritual_watcher_v2', ?14)
            "#,
            params![
                device_id,
                user_id,
                ts_start as i64,
                ts_end as i64,
                app_bundle_id,
                app_name,
                window_title,
                window_title_hash,
                window_owner_pid,
                if is_afk { 1 } else { 0 },
                browser_url,
                browser_domain,
                if is_incognito { 1 } else { 0 },
                now,
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    /// Update the end time of an activity event (heartbeat pattern)
    pub fn update_event_end_time(&self, event_id: i64, ts_end: u64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE activity_events SET ts_end = ?1 WHERE id = ?2",
            params![ts_end as i64, event_id],
        )?;

        Ok(())
    }
    
    /// Get the last event for a device to check if we should merge
    pub fn get_last_event(&self, device_id: &str) -> Result<Option<LastEvent>> {
        let conn = self.conn.lock().unwrap();
        
        let result = conn.query_row(
            r#"
            SELECT id, ts_start, ts_end, app_bundle_id, window_title, window_title_hash,
                   browser_url, browser_domain, is_afk
            FROM activity_events
            WHERE device_id = ?1
            ORDER BY ts_end DESC
            LIMIT 1
            "#,
            params![device_id],
            |row| {
                Ok(LastEvent {
                    id: row.get(0)?,
                    ts_start: row.get::<_, i64>(1)? as u64,
                    ts_end: row.get::<_, i64>(2)? as u64,
                    app_bundle_id: row.get(3)?,
                    window_title: row.get(4)?,
                    window_title_hash: row.get(5)?,
                    browser_url: row.get(6)?,
                    browser_domain: row.get(7)?,
                    is_afk: row.get::<_, i64>(8)? != 0,
                })
            },
        );
        
        match result {
            Ok(event) => Ok(Some(event)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }
    
    /// Insert or update an AFK event
    pub fn upsert_afk_event(
        &self,
        device_id: &str,
        user_id: &str,
        ts_start: u64,
        ts_end: u64,
        status: &str,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        
        // Try to update the last event if it has the same status
        let updated = conn.execute(
            r#"
            UPDATE afk_events 
            SET ts_end = ?1
            WHERE id = (
                SELECT id FROM afk_events 
                WHERE device_id = ?2 AND status = ?3
                ORDER BY ts_end DESC LIMIT 1
            )
            "#,
            params![ts_end as i64, device_id, status],
        )?;
        
        if updated > 0 {
            // Return the updated row id
            let id: i64 = conn.query_row(
                "SELECT id FROM afk_events WHERE device_id = ?1 ORDER BY ts_end DESC LIMIT 1",
                params![device_id],
                |row| row.get(0),
            )?;
            return Ok(id);
        }
        
        // Insert new event
        conn.execute(
            r#"
            INSERT INTO afk_events (device_id, user_id, ts_start, ts_end, status, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![device_id, user_id, ts_start as i64, ts_end as i64, status, now],
        )?;
        
        Ok(conn.last_insert_rowid())
    }

    /// Update the heartbeat timestamp
    pub fn update_heartbeat(&self, device_id: &str, timestamp: u64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            r#"
            INSERT INTO watcher_heartbeat (device_id, last_seen_ts)
            VALUES (?1, ?2)
            ON CONFLICT(device_id) DO UPDATE SET last_seen_ts = ?2
            "#,
            params![device_id, timestamp as i64],
        )?;

        Ok(())
    }

    /// Get the last heartbeat timestamp for a device
    pub fn get_last_heartbeat(&self, device_id: &str) -> Result<Option<u64>> {
        let conn = self.conn.lock().unwrap();
        
        let result: Option<i64> = conn.query_row(
            "SELECT last_seen_ts FROM watcher_heartbeat WHERE device_id = ?1",
            params![device_id],
            |row| row.get(0),
        ).ok();

        Ok(result.map(|ts| ts as u64))
    }

    /// Get the count of events for a device
    pub fn get_event_count(&self, device_id: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM activity_events WHERE device_id = ?1",
            params![device_id],
            |row| row.get(0),
        )?;

        Ok(count)
    }

    /// Get recent events for debugging
    pub fn get_recent_events(&self, device_id: &str, limit: i64) -> Result<Vec<ActivityEvent>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT id, device_id, user_id, ts_start, ts_end,
                   app_bundle_id, app_name, window_title, window_title_hash,
                   window_owner_pid, is_afk, browser_url, browser_domain, is_incognito, created_at
            FROM activity_events
            WHERE device_id = ?1
            ORDER BY ts_start DESC
            LIMIT ?2
            "#,
        )?;

        let events = stmt.query_map(params![device_id, limit], |row| {
            Ok(ActivityEvent {
                id: row.get(0)?,
                device_id: row.get(1)?,
                user_id: row.get(2)?,
                ts_start: row.get::<_, i64>(3)? as u64,
                ts_end: row.get::<_, i64>(4)? as u64,
                app_bundle_id: row.get(5)?,
                app_name: row.get(6)?,
                window_title: row.get(7)?,
                window_title_hash: row.get(8)?,
                window_owner_pid: row.get(9)?,
                is_afk: row.get::<_, i64>(10)? != 0,
                browser_url: row.get(11)?,
                browser_domain: row.get(12)?,
                is_incognito: row.get::<_, i64>(13)? != 0,
                created_at: row.get::<_, i64>(14)? as u64,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

        Ok(events)
    }
    
    /// Get domain usage summary for a time range
    pub fn get_domain_summary(&self, device_id: &str, ts_start: u64, ts_end: u64) -> Result<Vec<DomainSummary>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT 
                browser_domain,
                COUNT(*) as event_count,
                SUM(ts_end - ts_start) as total_ms
            FROM activity_events
            WHERE device_id = ?1 
              AND ts_start >= ?2 
              AND ts_end <= ?3
              AND browser_domain IS NOT NULL
              AND browser_domain != ''
            GROUP BY browser_domain
            ORDER BY total_ms DESC
            "#,
        )?;
        
        let summaries = stmt.query_map(params![device_id, ts_start as i64, ts_end as i64], |row| {
            Ok(DomainSummary {
                domain: row.get(0)?,
                event_count: row.get(1)?,
                total_ms: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        
        Ok(summaries)
    }
    
    /// Get app usage summary for a time range
    pub fn get_app_summary(&self, device_id: &str, ts_start: u64, ts_end: u64) -> Result<Vec<AppSummary>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT 
                app_bundle_id,
                app_name,
                COUNT(*) as event_count,
                SUM(CASE WHEN ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as total_ms
            FROM activity_events
            WHERE device_id = ?1 
              AND ts_start >= ?2 
              AND ts_start < ?3
              AND is_afk = 0
            GROUP BY app_bundle_id
            ORDER BY total_ms DESC
            "#,
        )?;
        
        let summaries = stmt.query_map(params![device_id, ts_start as i64, ts_end as i64], |row| {
            Ok(AppSummary {
                bundle_id: row.get(0)?,
                app_name: row.get(1)?,
                event_count: row.get(2)?,
                total_ms: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>>>()?;
        
        Ok(summaries)
    }
    
    /// Get daily summary stats (active time, afk time, event count)
    pub fn get_daily_summary(&self, device_id: &str, ts_start: u64, ts_end: u64) -> Result<DailySummary> {
        let conn = self.conn.lock().unwrap();
        
        let result = conn.query_row(
            r#"
            SELECT 
                SUM(CASE WHEN is_afk = 0 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as active_ms,
                SUM(CASE WHEN is_afk = 1 AND ts_end > ts_start THEN ts_end - ts_start ELSE 0 END) as afk_ms,
                COUNT(*) as event_count,
                COUNT(DISTINCT app_bundle_id) as app_count,
                COUNT(DISTINCT browser_domain) as domain_count
            FROM activity_events
            WHERE device_id = ?1 
              AND ts_start >= ?2 
              AND ts_start < ?3
            "#,
            params![device_id, ts_start as i64, ts_end as i64],
            |row| {
                Ok(DailySummary {
                    active_ms: row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                    afk_ms: row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    event_count: row.get(2)?,
                    app_count: row.get(3)?,
                    domain_count: row.get(4)?,
                })
            },
        )?;
        
        Ok(result)
    }
}

impl WatcherDatabase {
    /// Delete events older than the specified number of days
    /// Returns the number of deleted events
    pub fn delete_old_events(&self, days: i64) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let cutoff_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64
            - (days * 24 * 60 * 60 * 1000);
        
        let deleted = conn.execute(
            "DELETE FROM activity_events WHERE ts_end < ?1",
            params![cutoff_ms],
        )?;
        
        // Also clean up old AFK events
        conn.execute(
            "DELETE FROM afk_events WHERE ts_end < ?1",
            params![cutoff_ms],
        )?;
        
        // Vacuum to reclaim space (only if we deleted significant data)
        if deleted > 100 {
            conn.execute_batch("VACUUM;")?;
        }
        
        Ok(deleted as i64)
    }
    
    /// Get database statistics for diagnostics
    pub fn get_db_stats(&self) -> Result<DbStats> {
        let conn = self.conn.lock().unwrap();
        
        let event_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM activity_events",
            [],
            |row| row.get(0),
        )?;
        
        let afk_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM afk_events",
            [],
            |row| row.get(0),
        ).unwrap_or(0);
        
        let oldest_event_ts: Option<i64> = conn.query_row(
            "SELECT MIN(ts_start) FROM activity_events",
            [],
            |row| row.get(0),
        ).ok();
        
        let newest_event_ts: Option<i64> = conn.query_row(
            "SELECT MAX(ts_end) FROM activity_events",
            [],
            |row| row.get(0),
        ).ok();
        
        // Get database file size
        let page_count: i64 = conn.query_row("PRAGMA page_count", [], |row| row.get(0))?;
        let page_size: i64 = conn.query_row("PRAGMA page_size", [], |row| row.get(0))?;
        let db_size_bytes = page_count * page_size;
        
        Ok(DbStats {
            event_count,
            afk_count,
            oldest_event_ts,
            newest_event_ts,
            db_size_bytes,
        })
    }
    
    /// Export events in a time range as JSON-compatible structs
    pub fn export_events(&self, device_id: &str, ts_start: u64, ts_end: u64) -> Result<Vec<ActivityEvent>> {
        let conn = self.conn.lock().unwrap();
        
        let mut stmt = conn.prepare(
            r#"
            SELECT id, device_id, user_id, ts_start, ts_end,
                   app_bundle_id, app_name, window_title, window_title_hash,
                   window_owner_pid, is_afk, browser_url, browser_domain, is_incognito, created_at
            FROM activity_events
            WHERE device_id = ?1 AND ts_start >= ?2 AND ts_end <= ?3
            ORDER BY ts_start ASC
            "#,
        )?;

        let events = stmt.query_map(params![device_id, ts_start as i64, ts_end as i64], |row| {
            Ok(ActivityEvent {
                id: row.get(0)?,
                device_id: row.get(1)?,
                user_id: row.get(2)?,
                ts_start: row.get::<_, i64>(3)? as u64,
                ts_end: row.get::<_, i64>(4)? as u64,
                app_bundle_id: row.get(5)?,
                app_name: row.get(6)?,
                window_title: row.get(7)?,
                window_title_hash: row.get(8)?,
                window_owner_pid: row.get(9)?,
                is_afk: row.get::<_, i64>(10)? != 0,
                browser_url: row.get(11)?,
                browser_domain: row.get(12)?,
                is_incognito: row.get::<_, i64>(13)? != 0,
                created_at: row.get::<_, i64>(14)? as u64,
            })
        })?
        .collect::<Result<Vec<_>>>()?;

        Ok(events)
    }
    
    /// Compute focus metrics for a time range
    pub fn get_focus_metrics(&self, device_id: &str, ts_start: u64, ts_end: u64) -> Result<FocusMetrics> {
        let conn = self.conn.lock().unwrap();
        
        // Get all events in range to compute context switches
        let mut stmt = conn.prepare(
            r#"
            SELECT ts_start, ts_end, app_bundle_id, is_afk
            FROM activity_events
            WHERE device_id = ?1 AND ts_start >= ?2 AND ts_start < ?3 AND is_afk = 0
            ORDER BY ts_start ASC
            "#,
        )?;
        
        let events: Vec<(u64, u64, String, bool)> = stmt.query_map(
            params![device_id, ts_start as i64, ts_end as i64],
            |row| {
                Ok((
                    row.get::<_, i64>(0)? as u64,
                    row.get::<_, i64>(1)? as u64,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)? != 0,
                ))
            }
        )?.collect::<Result<Vec<_>>>()?;
        
        if events.is_empty() {
            return Ok(FocusMetrics {
                context_switches: 0,
                longest_focus_session_ms: 0,
                focus_sessions_30min_plus: 0,
                fragmented_time_ms: 0,
                deep_work_time_ms: 0,
            });
        }
        
        let mut context_switches = 0;
        let mut longest_focus_session_ms: i64 = 0;
        let mut focus_sessions_30min_plus = 0;
        let mut fragmented_time_ms: i64 = 0;
        let mut deep_work_time_ms: i64 = 0;
        let mut last_app: Option<String> = None;
        
        for (start, end, app, _is_afk) in &events {
            let duration = (*end as i64) - (*start as i64);
            
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
}

/// Database statistics
#[derive(Debug)]
pub struct DbStats {
    pub event_count: i64,
    pub afk_count: i64,
    pub oldest_event_ts: Option<i64>,
    pub newest_event_ts: Option<i64>,
    pub db_size_bytes: i64,
}

/// Focus and productivity metrics
#[derive(Debug)]
pub struct FocusMetrics {
    pub context_switches: i64,
    pub longest_focus_session_ms: i64,
    pub focus_sessions_30min_plus: i64,
    pub fragmented_time_ms: i64,
    pub deep_work_time_ms: i64,
}

/// Daily summary statistics
#[derive(Debug)]
pub struct DailySummary {
    pub active_ms: i64,
    pub afk_ms: i64,
    pub event_count: i64,
    pub app_count: i64,
    pub domain_count: i64,
}

/// Last event info for heartbeat merging
#[derive(Debug)]
pub struct LastEvent {
    pub id: i64,
    pub ts_start: u64,
    pub ts_end: u64,
    pub app_bundle_id: String,
    pub window_title: Option<String>,
    pub window_title_hash: Option<String>,
    pub browser_url: Option<String>,
    pub browser_domain: Option<String>,
    pub is_afk: bool,
}

/// Activity event struct for queries
#[derive(Debug)]
pub struct ActivityEvent {
    pub id: i64,
    pub device_id: String,
    pub user_id: String,
    pub ts_start: u64,
    pub ts_end: u64,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub window_title_hash: Option<String>,
    pub window_owner_pid: Option<i32>,
    pub is_afk: bool,
    pub browser_url: Option<String>,
    pub browser_domain: Option<String>,
    pub is_incognito: bool,
    pub created_at: u64,
}

/// Domain usage summary
#[derive(Debug)]
pub struct DomainSummary {
    pub domain: String,
    pub event_count: i64,
    pub total_ms: i64,
}

/// App usage summary
#[derive(Debug)]
pub struct AppSummary {
    pub bundle_id: String,
    pub app_name: String,
    pub event_count: i64,
    pub total_ms: i64,
}
