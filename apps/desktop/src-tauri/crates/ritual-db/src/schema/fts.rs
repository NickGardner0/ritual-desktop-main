use libsql::Connection;
use tracing::{debug, info};

use crate::error::{DatabaseError, Result};

/// Create FTS5 tables and triggers for full-text search
pub(super) async fn create_fts_tables(conn: &Connection) -> Result<()> {
    debug!("Creating FTS tables");

    // Create FTS virtual table
    conn.execute(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS ocr_frames_fts USING fts5(
            ocr_text,
            app_name,
            window_title,
            content='ocr_frames',
            content_rowid='id'
        )
        "#,
        (),
    )
    .await
    .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    // Create triggers to keep FTS in sync
    // Note: These may fail if triggers already exist, which is fine
    let _ = conn
        .execute(
            r#"
        CREATE TRIGGER IF NOT EXISTS ocr_frames_ai AFTER INSERT ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(rowid, ocr_text, app_name, window_title)
            VALUES (new.id, new.ocr_text, new.app_name, new.window_title);
        END
        "#,
            (),
        )
        .await;

    let _ = conn
        .execute(
            r#"
        CREATE TRIGGER IF NOT EXISTS ocr_frames_ad AFTER DELETE ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(ocr_frames_fts, rowid, ocr_text, app_name, window_title)
            VALUES ('delete', old.id, old.ocr_text, old.app_name, old.window_title);
        END
        "#,
            (),
        )
        .await;

    let _ = conn
        .execute(
            r#"
        CREATE TRIGGER IF NOT EXISTS ocr_frames_au AFTER UPDATE ON ocr_frames BEGIN
            INSERT INTO ocr_frames_fts(ocr_frames_fts, rowid, ocr_text, app_name, window_title)
            VALUES ('delete', old.id, old.ocr_text, old.app_name, old.window_title);
            INSERT INTO ocr_frames_fts(rowid, ocr_text, app_name, window_title)
            VALUES (new.id, new.ocr_text, new.app_name, new.window_title);
        END
        "#,
            (),
        )
        .await;

    // Existing databases may already have rows in ocr_frames before FTS triggers existed.
    // Rebuild once when the FTS index is empty so historical rows become searchable.
    backfill_fts_if_needed(conn).await?;

    Ok(())
}

async fn backfill_fts_if_needed(conn: &Connection) -> Result<()> {
    let frame_count = count_rows(conn, "ocr_frames").await?;
    if frame_count == 0 {
        return Ok(());
    }

    if needs_fts_rebuild(conn).await? {
        info!(
            frame_count = frame_count,
            "FTS index appears stale, rebuilding index from ocr_frames"
        );
        conn.execute(
            "INSERT INTO ocr_frames_fts(ocr_frames_fts) VALUES('rebuild')",
            (),
        )
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?;
    }

    Ok(())
}

async fn needs_fts_rebuild(conn: &Connection) -> Result<bool> {
    let mut probe_rows = conn.query(
        "SELECT id, ocr_text FROM ocr_frames WHERE ocr_text IS NOT NULL AND ocr_text != '' LIMIT 1",
        ()
    ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;

    if let Some(row) = probe_rows
        .next()
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?
    {
        let row_id: i64 = row.get(0).unwrap_or(0);
        let text: String = row.get(1).unwrap_or_default();
        if let Some(token) = extract_probe_token(&text) {
            let mut match_rows = conn.query(
                "SELECT 1 FROM ocr_frames_fts WHERE rowid = ? AND ocr_frames_fts MATCH ? LIMIT 1",
                libsql::params![row_id, token]
            ).await.map_err(|e| DatabaseError::Schema(e.to_string()))?;

            return Ok(match_rows
                .next()
                .await
                .map_err(|e| DatabaseError::Schema(e.to_string()))?
                .is_none());
        }
    }

    Ok(count_rows(conn, "ocr_frames_fts").await? == 0)
}

fn extract_probe_token(text: &str) -> Option<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .find(|token| token.len() >= 3)
        .map(|token| token.to_lowercase())
}

async fn count_rows(conn: &Connection, table: &str) -> Result<i64> {
    let sql = format!("SELECT COUNT(*) FROM {}", table);
    let mut rows = conn
        .query(&sql, ())
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?;

    let count = rows
        .next()
        .await
        .map_err(|e| DatabaseError::Schema(e.to_string()))?
        .map(|row| row.get::<i64>(0).unwrap_or(0))
        .unwrap_or(0);

    Ok(count)
}
