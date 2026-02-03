//! Database operations for Ritual Watcher
//!
//! This module wraps ritual-db's blocking API to provide the same interface
//! as the original rusqlite-based implementation.

#![allow(dead_code)] // Public API - methods used by Tauri commands

use ritual_db::blocking::BlockingDatabase;
use ritual_db::ActivityEvent;
use tracing::info;

/// Database wrapper for thread-safe access
pub struct WatcherDatabase {
    db: BlockingDatabase,
}

impl WatcherDatabase {
    /// Create a new database connection and ensure tables exist
    pub fn new(_path: &str) -> std::result::Result<Self, String> {
        // Note: path argument is ignored - we use the unified ritual.db
        // The path is kept for API compatibility
        info!("Opening Ritual database (unified libSQL)");
        
        let db = BlockingDatabase::open_default()
            .map_err(|e| format!("Failed to open database: {}", e))?;
        
        Ok(Self { db })
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
    ) -> std::result::Result<i64, String> {
        let mut event = ActivityEvent::new(
            device_id,
            user_id,
            ts_start as i64,
            ts_end as i64,
            app_bundle_id,
            app_name,
        );
        
        event.window_title = window_title.map(|s| s.to_string());
        event.window_title_hash = window_title_hash.map(|s| s.to_string());
        event.window_owner_pid = window_owner_pid;
        event.is_afk = is_afk;
        event.browser_url = browser_url.map(|s| s.to_string());
        event.browser_domain = browser_domain.map(|s| s.to_string());
        event.is_incognito = is_incognito;
        
        self.db.insert_activity_event(&event)
            .map_err(|e| e.to_string())
    }

    /// Update the end time of an activity event (heartbeat pattern)
    pub fn update_event_end_time(&self, event_id: i64, ts_end: u64) -> std::result::Result<(), String> {
        self.db.update_event_end_time(event_id, ts_end as i64)
            .map_err(|e| e.to_string())
    }
    
    /// Get the last event for a device to check if we should merge
    pub fn get_last_event(&self, device_id: &str) -> std::result::Result<Option<WatcherLastEvent>, String> {
        match self.db.get_last_event(device_id) {
            Ok(Some(event)) => Ok(Some(WatcherLastEvent {
                id: event.id,
                ts_start: event.ts_start as u64,
                ts_end: event.ts_end as u64,
                app_bundle_id: event.app_bundle_id,
                window_title: event.window_title,
                window_title_hash: event.window_title_hash,
                browser_url: event.browser_url,
                browser_domain: event.browser_domain,
                is_afk: event.is_afk,
            })),
            Ok(None) => Ok(None),
            Err(e) => Err(e.to_string()),
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
    ) -> std::result::Result<i64, String> {
        self.db.upsert_afk_event(device_id, user_id, ts_start as i64, ts_end as i64, status)
            .map_err(|e| e.to_string())
    }

    /// Update the heartbeat timestamp
    pub fn update_heartbeat(&self, device_id: &str, timestamp: u64) -> std::result::Result<(), String> {
        self.db.update_heartbeat(device_id, timestamp as i64)
            .map_err(|e| e.to_string())
    }

    /// Get the count of events for a device
    pub fn get_event_count(&self, device_id: &str) -> std::result::Result<i64, String> {
        self.db.get_event_count(device_id)
            .map_err(|e| e.to_string())
    }

    /// Get recent events for debugging
    pub fn get_recent_events(&self, device_id: &str, limit: i64) -> std::result::Result<Vec<WatcherActivityEvent>, String> {
        self.db.get_recent_events(device_id, limit)
            .map(|events| events.into_iter().map(|e| WatcherActivityEvent::from(e)).collect())
            .map_err(|e| e.to_string())
    }
    
    /// Get domain usage summary for a time range
    pub fn get_domain_summary(&self, device_id: &str, ts_start: u64, ts_end: u64) -> std::result::Result<Vec<WatcherDomainSummary>, String> {
        self.db.get_domain_summary(device_id, ts_start as i64, ts_end as i64)
            .map(|summaries| summaries.into_iter().map(|s| WatcherDomainSummary {
                domain: s.domain,
                event_count: s.event_count,
                total_ms: s.total_ms,
            }).collect())
            .map_err(|e| e.to_string())
    }
    
    /// Get app usage summary for a time range
    pub fn get_app_summary(&self, device_id: &str, ts_start: u64, ts_end: u64) -> std::result::Result<Vec<WatcherAppSummary>, String> {
        self.db.get_app_summary(device_id, ts_start as i64, ts_end as i64)
            .map(|summaries| summaries.into_iter().map(|s| WatcherAppSummary {
                bundle_id: s.bundle_id,
                app_name: s.app_name,
                event_count: s.event_count,
                total_ms: s.total_ms,
            }).collect())
            .map_err(|e| e.to_string())
    }
    
    /// Get daily summary stats (active time, afk time, event count)
    pub fn get_daily_summary(&self, device_id: &str, ts_start: u64, ts_end: u64) -> std::result::Result<WatcherDailySummary, String> {
        self.db.get_daily_summary(device_id, ts_start as i64, ts_end as i64)
            .map(|s| WatcherDailySummary {
                active_ms: s.active_ms,
                afk_ms: s.afk_ms,
                event_count: s.event_count,
                app_count: s.app_count,
                domain_count: s.domain_count,
            })
            .map_err(|e| e.to_string())
    }
    
    /// Delete events older than the specified number of days
    pub fn delete_old_events(&self, days: i64) -> std::result::Result<i64, String> {
        self.db.delete_old_events(days)
            .map_err(|e| e.to_string())
    }
    
    /// Get database statistics for diagnostics
    pub fn get_db_stats(&self) -> std::result::Result<WatcherDbStats, String> {
        self.db.get_db_stats()
            .map(|s| WatcherDbStats {
                event_count: s.event_count,
                afk_count: s.afk_count,
                oldest_event_ts: s.oldest_event_ts,
                newest_event_ts: s.newest_event_ts,
                db_size_bytes: s.db_size_bytes,
            })
            .map_err(|e| e.to_string())
    }
    
    /// Export events in a time range as JSON-compatible structs
    pub fn export_events(&self, device_id: &str, ts_start: u64, ts_end: u64) -> std::result::Result<Vec<WatcherActivityEvent>, String> {
        self.db.get_events_in_range(device_id, ts_start as i64, ts_end as i64)
            .map(|events| events.into_iter().map(|e| WatcherActivityEvent::from(e)).collect())
            .map_err(|e| e.to_string())
    }
    
    /// Compute focus metrics for a time range
    pub fn get_focus_metrics(&self, device_id: &str, ts_start: u64, ts_end: u64) -> std::result::Result<WatcherFocusMetrics, String> {
        self.db.get_focus_metrics(device_id, ts_start as i64, ts_end as i64)
            .map(|m| WatcherFocusMetrics {
                context_switches: m.context_switches,
                longest_focus_session_ms: m.longest_focus_session_ms,
                focus_sessions_30min_plus: m.focus_sessions_30min_plus,
                fragmented_time_ms: m.fragmented_time_ms,
                deep_work_time_ms: m.deep_work_time_ms,
            })
            .map_err(|e| e.to_string())
    }
}

// ============================================================================
// COMPATIBILITY TYPES
// These match the original types expected by the main.rs
// ============================================================================

/// Database statistics
#[derive(Debug)]
pub struct WatcherDbStats {
    pub event_count: i64,
    pub afk_count: i64,
    pub oldest_event_ts: Option<i64>,
    pub newest_event_ts: Option<i64>,
    pub db_size_bytes: i64,
}

/// Focus and productivity metrics
#[derive(Debug)]
pub struct WatcherFocusMetrics {
    pub context_switches: i64,
    pub longest_focus_session_ms: i64,
    pub focus_sessions_30min_plus: i64,
    pub fragmented_time_ms: i64,
    pub deep_work_time_ms: i64,
}

/// Daily summary statistics
#[derive(Debug)]
pub struct WatcherDailySummary {
    pub active_ms: i64,
    pub afk_ms: i64,
    pub event_count: i64,
    pub app_count: i64,
    pub domain_count: i64,
}

/// Last event info for heartbeat merging
#[derive(Debug)]
pub struct WatcherLastEvent {
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
pub struct WatcherActivityEvent {
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

impl From<ActivityEvent> for WatcherActivityEvent {
    fn from(e: ActivityEvent) -> Self {
        Self {
            id: e.id.unwrap_or(0),
            device_id: e.device_id,
            user_id: e.user_id,
            ts_start: e.ts_start as u64,
            ts_end: e.ts_end as u64,
            app_bundle_id: e.app_bundle_id,
            app_name: e.app_name,
            window_title: e.window_title,
            window_title_hash: e.window_title_hash,
            window_owner_pid: e.window_owner_pid,
            is_afk: e.is_afk,
            browser_url: e.browser_url,
            browser_domain: e.browser_domain,
            is_incognito: e.is_incognito,
            created_at: e.created_at as u64,
        }
    }
}

/// Domain usage summary
#[derive(Debug)]
pub struct WatcherDomainSummary {
    pub domain: String,
    pub event_count: i64,
    pub total_ms: i64,
}

/// App usage summary
#[derive(Debug)]
pub struct WatcherAppSummary {
    pub bundle_id: String,
    pub app_name: String,
    pub event_count: i64,
    pub total_ms: i64,
}

// Note: LastEvent, ActivityEvent, etc. are now directly used from ritual_db
// The Watcher* types above are local compatibility types that can be converted
// to/from the ritual_db types as needed.
