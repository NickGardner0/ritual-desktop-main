use libsql::Connection;
use tracing::debug;

use crate::error::{DatabaseError, Result};

/// Create activity tracking tables (from watcher)
pub(super) async fn create_activity_tables(conn: &Connection) -> Result<()> {
    debug!("Creating activity tables");

    conn.execute_batch(
        r#"
        -- Activity events table
        CREATE TABLE IF NOT EXISTS activity_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_uid TEXT NOT NULL DEFAULT '',
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
            browser_url TEXT,
            browser_domain TEXT,
            is_incognito INTEGER NOT NULL DEFAULT 0,
            biome_is_provisional INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'ritual_watcher_v2',
            created_at INTEGER NOT NULL
        );

        -- AFK events table
        CREATE TABLE IF NOT EXISTS afk_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            afk_uid TEXT NOT NULL DEFAULT '',
            device_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            ts_start INTEGER NOT NULL,
            ts_end INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        -- Heartbeat tracking for watcher liveness
        CREATE TABLE IF NOT EXISTS watcher_heartbeat (
            device_id TEXT PRIMARY KEY,
            last_seen_ts INTEGER NOT NULL
        );
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}
