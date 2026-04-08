//! Activity segment operations for sessionization
//!
//! This module handles:
//! - Creating activity segments from consecutive activity events
//! - Linking OCR frames to segments
//! - Querying segments for time ranges
//! - Segment-based analytics

use libsql::Connection;
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::error::{DatabaseError, Result};
use crate::types::OcrFrame;

/// Gap threshold for segment boundaries (60 seconds)
pub const SEGMENT_GAP_THRESHOLD_MS: i64 = 60_000;

/// Minimum segment duration to be meaningful (5 seconds)
pub const MIN_SEGMENT_DURATION_MS: i64 = 5_000;

/// Activity segment representing a continuous work session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivitySegment {
    pub id: Option<i64>,
    pub device_id: String,
    pub user_id: String,
    pub ts_start: i64,
    pub ts_end: i64,
    pub app_bundle_id: Option<String>,
    pub app_name: Option<String>,
    pub window_title_normalized: Option<String>,
    pub browser_domain: Option<String>,
    pub segment_kind: String,
    pub duration_ms: i64,
    pub frame_count: i64,
    pub key_topics: Option<String>,
    pub created_at: i64,
}

impl ActivitySegment {
    /// Create a new activity segment
    pub fn new(
        device_id: &str,
        user_id: &str,
        ts_start: i64,
        ts_end: i64,
        app_bundle_id: Option<&str>,
        app_name: Option<&str>,
    ) -> Self {
        Self {
            id: None,
            device_id: device_id.to_string(),
            user_id: user_id.to_string(),
            ts_start,
            ts_end,
            app_bundle_id: app_bundle_id.map(|s| s.to_string()),
            app_name: app_name.map(|s| s.to_string()),
            window_title_normalized: None,
            browser_domain: None,
            segment_kind: "work".to_string(),
            duration_ms: ts_end - ts_start,
            frame_count: 0,
            key_topics: None,
            created_at: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// Determine segment kind based on app and domain
    pub fn infer_kind(&mut self) {
        if let Some(ref domain) = self.browser_domain {
            // Web browsing
            let domain_lower = domain.to_lowercase();
            if domain_lower.contains("youtube")
                || domain_lower.contains("netflix")
                || domain_lower.contains("twitch")
            {
                self.segment_kind = "media".to_string();
            } else if domain_lower.contains("slack")
                || domain_lower.contains("discord")
                || domain_lower.contains("teams")
            {
                self.segment_kind = "communication".to_string();
            } else if domain_lower.contains("github")
                || domain_lower.contains("stackoverflow")
                || domain_lower.contains("docs")
            {
                self.segment_kind = "development".to_string();
            } else {
                self.segment_kind = "web".to_string();
            }
        } else if let Some(ref bundle_id) = self.app_bundle_id {
            let bundle_lower = bundle_id.to_lowercase();
            if bundle_lower.contains("xcode")
                || bundle_lower.contains("vscode")
                || bundle_lower.contains("cursor")
                || bundle_lower.contains("intellij")
            {
                self.segment_kind = "development".to_string();
            } else if bundle_lower.contains("slack")
                || bundle_lower.contains("discord")
                || bundle_lower.contains("messages")
                || bundle_lower.contains("mail")
            {
                self.segment_kind = "communication".to_string();
            } else if bundle_lower.contains("zoom")
                || bundle_lower.contains("meet")
                || bundle_lower.contains("teams")
            {
                self.segment_kind = "meeting".to_string();
            } else if bundle_lower.contains("spotify")
                || bundle_lower.contains("music")
                || bundle_lower.contains("vlc")
            {
                self.segment_kind = "media".to_string();
            } else {
                self.segment_kind = "work".to_string();
            }
        }
    }
}

/// Segment with associated frames
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentWithFrames {
    pub segment: ActivitySegment,
    pub frames: Vec<OcrFrame>,
}

/// Segment operations for the database
pub struct SegmentOps<'a> {
    conn: &'a Connection,
}

impl<'a> SegmentOps<'a> {
    /// Create a new SegmentOps with a connection reference
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    // ========================================================================
    // SEGMENT CRUD OPERATIONS
    // ========================================================================

    /// Insert a new activity segment
    pub async fn insert_segment(&self, segment: &ActivitySegment) -> Result<i64> {
        self.conn
            .execute(
                r#"
            INSERT INTO activity_segments (
                device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                window_title_normalized, browser_domain, segment_kind, duration_ms,
                frame_count, key_topics, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
                libsql::params![
                    segment.device_id.clone(),
                    segment.user_id.clone(),
                    segment.ts_start,
                    segment.ts_end,
                    segment.app_bundle_id.clone(),
                    segment.app_name.clone(),
                    segment.window_title_normalized.clone(),
                    segment.browser_domain.clone(),
                    segment.segment_kind.clone(),
                    segment.duration_ms,
                    segment.frame_count,
                    segment.key_topics.clone(),
                    segment.created_at,
                ],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut rows = self
            .conn
            .query("SELECT last_insert_rowid()", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let id = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0);

        debug!("Inserted activity segment with id {}", id);
        Ok(id)
    }

    /// Get a segment by ID
    pub async fn get_segment(&self, id: i64) -> Result<Option<ActivitySegment>> {
        let mut rows = self
            .conn
            .query(
                r#"
            SELECT id, device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                   window_title_normalized, browser_domain, segment_kind, duration_ms,
                   frame_count, key_topics, created_at
            FROM activity_segments
            WHERE id = ?
            "#,
                libsql::params![id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        self.row_to_segment(&mut rows).await
    }

    /// Get segments in a time range
    pub async fn get_segments_in_range(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<Vec<ActivitySegment>> {
        let mut rows = self
            .conn
            .query(
                r#"
            SELECT id, device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                   window_title_normalized, browser_domain, segment_kind, duration_ms,
                   frame_count, key_topics, created_at
            FROM activity_segments
            WHERE device_id = ? AND ts_start >= ? AND ts_start < ?
            ORDER BY ts_start ASC
            "#,
                libsql::params![device_id, ts_start, ts_end],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        self.rows_to_segments(&mut rows).await
    }

    /// Get the segment containing a specific timestamp
    pub async fn get_segment_at_time(
        &self,
        device_id: &str,
        timestamp: i64,
    ) -> Result<Option<ActivitySegment>> {
        let mut rows = self
            .conn
            .query(
                r#"
            SELECT id, device_id, user_id, ts_start, ts_end, app_bundle_id, app_name,
                   window_title_normalized, browser_domain, segment_kind, duration_ms,
                   frame_count, key_topics, created_at
            FROM activity_segments
            WHERE device_id = ? AND ts_start <= ? AND ts_end >= ?
            ORDER BY ts_start DESC
            LIMIT 1
            "#,
                libsql::params![device_id, timestamp, timestamp],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        self.row_to_segment(&mut rows).await
    }

    /// Update segment frame count
    pub async fn update_segment_frame_count(
        &self,
        segment_id: i64,
        frame_count: i64,
    ) -> Result<()> {
        self.conn
            .execute(
                "UPDATE activity_segments SET frame_count = ? WHERE id = ?",
                libsql::params![frame_count, segment_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(())
    }

    /// Delete segments older than a certain number of days
    pub async fn delete_old_segments(&self, days: i64) -> Result<i64> {
        let cutoff_ms = chrono::Utc::now().timestamp_millis() - (days * 24 * 60 * 60 * 1000);

        let result = self
            .conn
            .execute(
                "DELETE FROM activity_segments WHERE ts_end < ?",
                libsql::params![cutoff_ms],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(result as i64)
    }

    // ========================================================================
    // SEGMENT-FRAME LINKING
    // ========================================================================

    /// Link a frame to a segment
    pub async fn link_frame_to_segment(&self, segment_id: i64, frame_id: i64) -> Result<()> {
        self.conn
            .execute(
                "INSERT OR IGNORE INTO segment_frames (segment_id, frame_id) VALUES (?, ?)",
                libsql::params![segment_id, frame_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(())
    }

    /// Get frames for a segment
    pub async fn get_frames_for_segment(&self, segment_id: i64) -> Result<Vec<OcrFrame>> {
        let mut rows = self
            .conn
            .query(
                r#"
            SELECT f.id, f.timestamp, f.activity_event_id, f.app_bundle_id, f.app_name,
                   f.window_title, f.ocr_text, f.ocr_confidence, f.thumbnail_path,
                   f.video_chunk_id, f.frame_offset, f.image_hash, f.storage_tier, f.created_at
            FROM ocr_frames f
            JOIN segment_frames sf ON f.id = sf.frame_id
            WHERE sf.segment_id = ?
            ORDER BY f.timestamp ASC
            "#,
                libsql::params![segment_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        crate::recorder::rows_to_ocr_frames(&mut rows).await
    }

    /// Link frames to segment by timestamp overlap
    pub async fn link_frames_by_timestamp(
        &self,
        segment_id: i64,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<i64> {
        let result = self
            .conn
            .execute(
                r#"
            INSERT OR IGNORE INTO segment_frames (segment_id, frame_id)
            SELECT ?, id FROM ocr_frames 
            WHERE timestamp >= ? AND timestamp <= ?
            "#,
                libsql::params![segment_id, ts_start, ts_end],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(result as i64)
    }

    // ========================================================================
    // SESSIONIZATION
    // ========================================================================

    /// Create segments from activity events in a time range
    ///
    /// This groups consecutive events by app/window into segments.
    pub async fn create_segments_from_events(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
        gap_threshold_ms: i64,
    ) -> Result<Vec<i64>> {
        use crate::activity::ActivityOps;

        let activity_ops = ActivityOps::new(self.conn);

        // Get activity events in range
        let events = activity_ops
            .get_events_in_range(device_id, ts_start, ts_end)
            .await?;

        if events.is_empty() {
            return Ok(Vec::new());
        }

        info!("Creating segments from {} activity events", events.len());

        let mut segment_ids = Vec::new();
        let mut current_segment: Option<ActivitySegment> = None;

        for event in &events {
            // Skip AFK events
            if event.is_afk {
                // If we have a current segment, save it before the AFK
                if let Some(mut seg) = current_segment.take() {
                    seg.duration_ms = seg.ts_end - seg.ts_start;
                    if seg.duration_ms >= MIN_SEGMENT_DURATION_MS {
                        seg.infer_kind();
                        let id = self.insert_segment(&seg).await?;
                        // Link frames
                        let frame_count = self
                            .link_frames_by_timestamp(id, seg.ts_start, seg.ts_end)
                            .await?;
                        self.update_segment_frame_count(id, frame_count).await?;
                        segment_ids.push(id);
                    }
                }
                continue;
            }

            let should_start_new = match &current_segment {
                None => true,
                Some(seg) => {
                    // Start new segment if:
                    // 1. Gap between events exceeds threshold
                    // 2. App changed
                    let gap = event.ts_start - seg.ts_end;
                    let app_changed = seg.app_bundle_id.as_deref() != Some(&event.app_bundle_id);

                    gap > gap_threshold_ms || app_changed
                }
            };

            if should_start_new {
                // Save current segment if exists
                if let Some(mut seg) = current_segment.take() {
                    seg.duration_ms = seg.ts_end - seg.ts_start;
                    if seg.duration_ms >= MIN_SEGMENT_DURATION_MS {
                        seg.infer_kind();
                        let id = self.insert_segment(&seg).await?;
                        // Link frames
                        let frame_count = self
                            .link_frames_by_timestamp(id, seg.ts_start, seg.ts_end)
                            .await?;
                        self.update_segment_frame_count(id, frame_count).await?;
                        segment_ids.push(id);
                    }
                }

                // Start new segment
                let mut new_seg = ActivitySegment::new(
                    device_id,
                    &event.user_id,
                    event.ts_start,
                    event.ts_end,
                    Some(&event.app_bundle_id),
                    Some(&event.app_name),
                );
                new_seg.window_title_normalized = event.window_title.clone();
                new_seg.browser_domain = event.browser_domain.clone();
                current_segment = Some(new_seg);
            } else {
                // Extend current segment
                if let Some(ref mut seg) = current_segment {
                    seg.ts_end = event.ts_end;
                    // Update window title if changed (use most recent)
                    if event.window_title.is_some() {
                        seg.window_title_normalized = event.window_title.clone();
                    }
                    if event.browser_domain.is_some() {
                        seg.browser_domain = event.browser_domain.clone();
                    }
                }
            }
        }

        // Save final segment
        if let Some(mut seg) = current_segment.take() {
            seg.duration_ms = seg.ts_end - seg.ts_start;
            if seg.duration_ms >= MIN_SEGMENT_DURATION_MS {
                seg.infer_kind();
                let id = self.insert_segment(&seg).await?;
                let frame_count = self
                    .link_frames_by_timestamp(id, seg.ts_start, seg.ts_end)
                    .await?;
                self.update_segment_frame_count(id, frame_count).await?;
                segment_ids.push(id);
            }
        }

        info!("Created {} segments", segment_ids.len());
        Ok(segment_ids)
    }

    /// Get segment statistics
    pub async fn get_segment_stats(
        &self,
        device_id: &str,
        ts_start: i64,
        ts_end: i64,
    ) -> Result<SegmentStats> {
        let mut rows = self
            .conn
            .query(
                r#"
            SELECT 
                COUNT(*) as total_segments,
                SUM(duration_ms) as total_duration,
                SUM(frame_count) as total_frames,
                COUNT(DISTINCT app_bundle_id) as unique_apps,
                COUNT(DISTINCT segment_kind) as unique_kinds
            FROM activity_segments
            WHERE device_id = ? AND ts_start >= ? AND ts_start < ?
            "#,
                libsql::params![device_id, ts_start, ts_end],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        if let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            Ok(SegmentStats {
                total_segments: row.get(0).unwrap_or(0),
                total_duration_ms: row.get(1).unwrap_or(0),
                total_frames: row.get(2).unwrap_or(0),
                unique_apps: row.get(3).unwrap_or(0),
                unique_kinds: row.get(4).unwrap_or(0),
            })
        } else {
            Ok(SegmentStats::default())
        }
    }

    // ========================================================================
    // HELPER METHODS
    // ========================================================================

    async fn row_to_segment(&self, rows: &mut libsql::Rows) -> Result<Option<ActivitySegment>> {
        if let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            Ok(Some(ActivitySegment {
                id: Some(
                    row.get(0)
                        .map_err(|e| DatabaseError::Query(e.to_string()))?,
                ),
                device_id: row
                    .get(1)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                user_id: row
                    .get(2)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_start: row
                    .get(3)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_end: row
                    .get(4)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                app_bundle_id: row.get(5).ok(),
                app_name: row.get(6).ok(),
                window_title_normalized: row.get(7).ok(),
                browser_domain: row.get(8).ok(),
                segment_kind: row.get(9).unwrap_or_else(|_| "work".to_string()),
                duration_ms: row.get(10).unwrap_or(0),
                frame_count: row.get(11).unwrap_or(0),
                key_topics: row.get(12).ok(),
                created_at: row.get(13).unwrap_or(0),
            }))
        } else {
            Ok(None)
        }
    }

    async fn rows_to_segments(&self, rows: &mut libsql::Rows) -> Result<Vec<ActivitySegment>> {
        let mut segments = Vec::new();

        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            segments.push(ActivitySegment {
                id: Some(
                    row.get(0)
                        .map_err(|e| DatabaseError::Query(e.to_string()))?,
                ),
                device_id: row
                    .get(1)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                user_id: row
                    .get(2)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_start: row
                    .get(3)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                ts_end: row
                    .get(4)
                    .map_err(|e| DatabaseError::Query(e.to_string()))?,
                app_bundle_id: row.get(5).ok(),
                app_name: row.get(6).ok(),
                window_title_normalized: row.get(7).ok(),
                browser_domain: row.get(8).ok(),
                segment_kind: row.get(9).unwrap_or_else(|_| "work".to_string()),
                duration_ms: row.get(10).unwrap_or(0),
                frame_count: row.get(11).unwrap_or(0),
                key_topics: row.get(12).ok(),
                created_at: row.get(13).unwrap_or(0),
            });
        }

        Ok(segments)
    }
}

/// Segment statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SegmentStats {
    pub total_segments: i64,
    pub total_duration_ms: i64,
    pub total_frames: i64,
    pub unique_apps: i64,
    pub unique_kinds: i64,
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
        crate::schema::initialize_schema(&conn).await.unwrap();

        (db, conn, temp_dir)
    }

    #[tokio::test]
    async fn test_insert_and_get_segment() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SegmentOps::new(&conn);

        let segment = ActivitySegment::new(
            "device1",
            "user1",
            1000,
            60000,
            Some("com.test.app"),
            Some("Test App"),
        );

        let id = ops.insert_segment(&segment).await.unwrap();
        assert!(id > 0);

        let retrieved = ops.get_segment(id).await.unwrap();
        assert!(retrieved.is_some());

        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.device_id, "device1");
        assert_eq!(retrieved.app_bundle_id, Some("com.test.app".to_string()));
    }

    #[tokio::test]
    async fn test_segment_at_time() {
        let (_db, conn, _temp) = create_test_db().await;
        let ops = SegmentOps::new(&conn);

        let segment = ActivitySegment::new(
            "device1",
            "user1",
            1000,
            60000,
            Some("com.test.app"),
            Some("Test App"),
        );

        ops.insert_segment(&segment).await.unwrap();

        // Should find segment at timestamp 30000
        let found = ops.get_segment_at_time("device1", 30000).await.unwrap();
        assert!(found.is_some());

        // Should not find segment at timestamp 100000
        let not_found = ops.get_segment_at_time("device1", 100000).await.unwrap();
        assert!(not_found.is_none());
    }

    #[tokio::test]
    async fn test_infer_kind() {
        let mut segment = ActivitySegment::new(
            "device1",
            "user1",
            1000,
            60000,
            Some("com.apple.dt.Xcode"),
            Some("Xcode"),
        );

        segment.infer_kind();
        assert_eq!(segment.segment_kind, "development");

        let mut segment2 = ActivitySegment::new(
            "device1",
            "user1",
            1000,
            60000,
            Some("com.tinyspeck.slackmacgap"),
            Some("Slack"),
        );

        segment2.infer_kind();
        assert_eq!(segment2.segment_kind, "communication");
    }
}
