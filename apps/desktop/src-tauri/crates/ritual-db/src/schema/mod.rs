//! Database schema definitions for Ritual

mod activity;
mod fts;
mod memory;
mod metadata;
mod migrations;
mod recorder;
mod sync;
pub mod vault;

pub use migrations::{get_schema_version, needs_schema_update};

use libsql::Connection;
use tracing::{debug, info};

use crate::error::Result;

pub const SCHEMA_VERSION: i32 = 10;

pub async fn initialize_schema(conn: &Connection) -> Result<()> {
    info!("Initializing Ritual database schema v{}", SCHEMA_VERSION);

    metadata::create_metadata_tables(conn).await?;
    let schema_needs_update = needs_schema_update(conn).await?;
    activity::create_activity_tables(conn).await?;
    recorder::create_recorder_tables(conn).await?;
    sync::create_sync_tables(conn).await?;
    memory::create_memory_pipeline_tables(conn).await?;

    if schema_needs_update {
        migrations::apply_migrations(conn).await?;
    } else {
        debug!(
            "Schema v{} already recorded; skipping migration backfills",
            SCHEMA_VERSION
        );
    }

    sync::create_indexes(conn).await?;
    sync::create_cloud_sync_triggers(conn).await?;
    sync::suppress_legacy_raw_memory_cloud_sync(conn).await?;
    fts::create_fts_tables(conn).await?;
    migrations::record_schema_version(conn, SCHEMA_VERSION).await?;

    info!("Schema initialization complete");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use libsql::Builder;
    use tempfile::TempDir;

    async fn create_test_db() -> (Connection, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");

        let db = Builder::new_local(db_path.to_str().unwrap())
            .build()
            .await
            .unwrap();

        let conn = db.connect().unwrap();
        (conn, temp_dir)
    }

    #[tokio::test]
    async fn test_schema_initialization() {
        let (conn, _temp) = create_test_db().await;

        initialize_schema(&conn).await.unwrap();

        // Verify tables exist
        let mut rows = conn
            .query(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
                (),
            )
            .await
            .unwrap();

        let mut tables = Vec::new();
        while let Some(row) = rows.next().await.unwrap() {
            let name: String = row.get(0).unwrap();
            tables.push(name);
        }

        assert!(tables.contains(&"activity_events".to_string()));
        assert!(tables.contains(&"ocr_frames".to_string()));
        assert!(tables.contains(&"video_chunks".to_string()));
        assert!(tables.contains(&"sync_queue".to_string()));
        assert!(!tables.contains(&"ocr_embeddings".to_string()));
        assert!(!tables.contains(&"memory_upload_outbox".to_string()));
        assert!(!tables.contains(&"session_retrieval_docs".to_string()));
    }

    #[tokio::test]
    async fn test_schema_version() {
        let (conn, _temp) = create_test_db().await;

        initialize_schema(&conn).await.unwrap();

        let version = get_schema_version(&conn).await.unwrap();
        assert_eq!(version, Some(SCHEMA_VERSION));
    }

    #[tokio::test]
    async fn test_schema_idempotent() {
        let (conn, _temp) = create_test_db().await;

        // Initialize twice - should not fail
        initialize_schema(&conn).await.unwrap();
        initialize_schema(&conn).await.unwrap();

        let version = get_schema_version(&conn).await.unwrap();
        assert_eq!(version, Some(SCHEMA_VERSION));
    }

    #[tokio::test]
    async fn test_schema_suppresses_legacy_raw_memory_cloud_sync() {
        let (conn, _temp) = create_test_db().await;

        initialize_schema(&conn).await.unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE memory_upload_outbox (id INTEGER PRIMARY KEY);
            CREATE TABLE session_retrieval_docs (id INTEGER PRIMARY KEY);
            CREATE TABLE embedding_worker_state (id INTEGER PRIMARY KEY);
            INSERT INTO memory_upload_outbox (id) VALUES (1);
            INSERT INTO session_retrieval_docs (id) VALUES (1);
            INSERT INTO embedding_worker_state (id) VALUES (1);
            "#,
        )
        .await
        .unwrap();

        for (entity_type, entity_uid, status) in [
            ("context_session", "legacy-session-1", "pending"),
            ("context_snapshot", "legacy-snapshot-1", "failed"),
            ("session_retrieval_doc", "legacy-doc-1", "uploading"),
            ("context_snapshot", "legacy-snapshot-2", "uploaded"),
            ("activity_event", "activity-1", "pending"),
        ] {
            conn.execute(
                r#"
                INSERT INTO cloud_sync_outbox (
                    user_id, device_id, entity_type, entity_uid, op_kind, payload_json,
                    status, retry_count, next_retry_at, last_error, created_at, updated_at
                ) VALUES ('user', 'device', ?, ?, 'upsert', '{}', ?, 0, NULL, NULL, 1, 1)
                "#,
                libsql::params![entity_type, entity_uid, status],
            )
            .await
            .unwrap();
        }

        initialize_schema(&conn).await.unwrap();

        let raw_active = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type IN ('context_session', 'context_snapshot', 'session_retrieval_doc') AND status IN ('pending', 'failed', 'uploading')",
        )
        .await;
        assert_eq!(raw_active, 0);

        let raw_uploaded = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type IN ('context_session', 'context_snapshot', 'session_retrieval_doc') AND status = 'uploaded'",
        )
        .await;
        assert_eq!(raw_uploaded, 0);

        let raw_dead_letter = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type IN ('context_session', 'context_snapshot', 'session_retrieval_doc') AND status = 'dead_letter' AND last_error = 'raw_memory_cloud_sync_disabled'",
        )
        .await;
        assert_eq!(raw_dead_letter, 3);

        let activity_pending = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type = 'activity_event' AND status = 'pending'",
        )
        .await;
        assert_eq!(activity_pending, 1);

        let legacy_tables = count_matching_rows(
            &conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('memory_upload_outbox', 'session_retrieval_docs', 'embedding_worker_state')",
        )
        .await;
        assert_eq!(legacy_tables, 3);
    }

    #[tokio::test]
    async fn test_fts_backfill_rebuilds_index_for_existing_frames() {
        let (conn, _temp) = create_test_db().await;
        initialize_schema(&conn).await.unwrap();

        conn.execute(
            r#"
            INSERT INTO ocr_frames (
                timestamp, app_bundle_id, app_name, ocr_text, image_hash
            ) VALUES (?, ?, ?, ?, ?)
            "#,
            libsql::params![
                1234i64,
                "com.test.app",
                "Test App",
                "backfill search term",
                "hash-backfill"
            ],
        )
        .await
        .unwrap();

        // Simulate a legacy DB with missing FTS index content.
        conn.execute(
            "INSERT INTO ocr_frames_fts(ocr_frames_fts) VALUES('delete-all')",
            (),
        )
        .await
        .unwrap();

        // Re-running initialization should trigger backfill rebuild.
        initialize_schema(&conn).await.unwrap();

        let mut rows = conn
            .query(
                "SELECT COUNT(*) FROM ocr_frames_fts WHERE ocr_frames_fts MATCH ?",
                libsql::params!["backfill"],
            )
            .await
            .unwrap();
        let matched = rows
            .next()
            .await
            .unwrap()
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);

        assert_eq!(matched, 1);
    }

    async fn count_matching_rows(conn: &Connection, sql: &str) -> i64 {
        let mut rows = conn.query(sql, ()).await.unwrap();
        rows.next()
            .await
            .unwrap()
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0)
    }
}
