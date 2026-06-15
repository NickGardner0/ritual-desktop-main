use libsql::Connection;
use tracing::debug;

use crate::error::{DatabaseError, Result};

/// Create metadata and migration tracking tables
pub(super) async fn create_metadata_tables(conn: &Connection) -> Result<()> {
    debug!("Creating metadata tables");

    conn.execute_batch(
        r#"
        -- Schema version tracking
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL,
            description TEXT
        );
        "#,
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    Ok(())
}
