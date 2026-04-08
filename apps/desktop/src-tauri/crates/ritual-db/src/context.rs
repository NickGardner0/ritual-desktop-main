//! Context snapshot and session database operations.

use libsql::Connection;

use crate::error::{DatabaseError, Result};
use crate::types::{ContextSession, ContextSnapshot, SessionRetrievalDoc};

const SESSION_GAP_MS: i64 = 5 * 60 * 1000;
const APP_CHANGE_GAP_MS: i64 = 15 * 1000;
const DOMAIN_CHANGE_GAP_MS: i64 = 20 * 1000;
const TITLE_CHANGE_GAP_MS: i64 = 20 * 1000;
const MAX_SESSION_DURATION_MS: i64 = 18 * 60 * 1000;
const RAW_TEXT_LIMIT: usize = 16_000;
const CONTEXTUAL_TEXT_LIMIT: usize = 24_000;

#[derive(Debug, Clone)]
pub struct ContextRecordOutcome {
    pub snapshot_id: i64,
    pub session_id: i64,
    pub inserted: bool,
}

pub struct ContextOps<'a> {
    conn: &'a Connection,
}

impl<'a> ContextOps<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub async fn record_context_snapshot(
        &self,
        snapshot: &ContextSnapshot,
    ) -> Result<ContextRecordOutcome> {
        if !snapshot.dedup_key.trim().is_empty() {
            let mut rows = self
                .conn
                .query(
                    r#"
                    SELECT id, COALESCE(session_id, 0)
                    FROM context_snapshots
                    WHERE dedup_key = ?
                    LIMIT 1
                    "#,
                    libsql::params![snapshot.dedup_key.clone()],
                )
                .await
                .map_err(|e| DatabaseError::Query(e.to_string()))?;
            if let Some(row) = rows
                .next()
                .await
                .map_err(|e| DatabaseError::Query(e.to_string()))?
            {
                let snapshot_id: i64 = row.get(0).unwrap_or(0);
                let session_id: i64 = row.get(1).unwrap_or(0);
                if snapshot_id > 0 && session_id > 0 {
                    return Ok(ContextRecordOutcome {
                        snapshot_id,
                        session_id,
                        inserted: false,
                    });
                }
            }
        }

        let last_snapshot = self
            .get_last_context_snapshot(&snapshot.device_id, &snapshot.user_id)
            .await?;
        let last_session = self
            .get_last_context_session(&snapshot.device_id, &snapshot.user_id)
            .await?;

        let session_id = match (last_snapshot.as_ref(), last_session.as_ref()) {
            (Some(previous_snapshot), Some(previous_session))
                if !should_start_new_session(previous_snapshot, previous_session, snapshot) =>
            {
                self.update_context_session(previous_session.id.unwrap_or_default(), snapshot)
                    .await?;
                previous_session.id.unwrap_or_default()
            }
            _ => self.insert_context_session(snapshot).await?,
        };

        let mut row = snapshot.clone();
        if let Some(activity_event_id) = row.activity_event_id {
            row.activity_event_uid = self.load_activity_event_uid(activity_event_id).await?;
        }
        row.session_id = Some(session_id);
        row.session_uid = self.load_context_session_uid(session_id).await?;

        self.conn
            .execute(
                r#"
                INSERT INTO context_snapshots (
                    device_id,
                    user_id,
                    activity_event_id,
                    activity_event_uid,
                    session_id,
                    session_uid,
                    ts,
                    source_type,
                    app_bundle_id,
                    app_name,
                    window_title,
                    browser_url,
                    browser_domain,
                    tab_title,
                    document_title,
                    visible_text_raw,
                    visible_text_norm,
                    capture_quality,
                    capture_components_json,
                    ax_richness_score,
                    selected_text_present,
                    document_path,
                    ax_source,
                    capture_trigger,
                    trigger_to_snapshot_ms,
                    ui_elements_json,
                    dedup_key,
                    is_sensitive_redacted,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
                libsql::params![
                    row.device_id,
                    row.user_id,
                    row.activity_event_id,
                    row.activity_event_uid,
                    row.session_id,
                    row.session_uid,
                    row.ts,
                    row.source_type,
                    row.app_bundle_id,
                    row.app_name,
                    row.window_title,
                    row.browser_url,
                    row.browser_domain,
                    row.tab_title,
                    row.document_title,
                    row.visible_text_raw,
                    row.visible_text_norm,
                    row.capture_quality,
                    row.capture_components_json,
                    row.ax_richness_score,
                    if row.selected_text_present { 1i64 } else { 0i64 },
                    row.document_path,
                    row.ax_source,
                    row.capture_trigger,
                    row.trigger_to_snapshot_ms,
                    row.ui_elements_json,
                    row.dedup_key,
                    if row.is_sensitive_redacted { 1i64 } else { 0i64 },
                    row.created_at,
                    row.updated_at,
                ],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let snapshot_id = self.last_insert_row_id().await?;
        self.refresh_session_rollup(session_id).await?;
        self.upsert_session_retrieval_doc(session_id).await?;

        Ok(ContextRecordOutcome {
            snapshot_id,
            session_id,
            inserted: true,
        })
    }

    pub async fn get_recent_context_snapshots(
        &self,
        start_ts: i64,
        end_ts: i64,
        limit: i64,
    ) -> Result<Vec<ContextSnapshot>> {
        let mut rows = self
            .conn
            .query(
                r#"
                SELECT
                    id,
                    device_id,
                    user_id,
                    activity_event_id,
                    activity_event_uid,
                    session_id,
                    session_uid,
                    ts,
                    source_type,
                    app_bundle_id,
                    app_name,
                    window_title,
                    browser_url,
                    browser_domain,
                    tab_title,
                    document_title,
                    visible_text_raw,
                    visible_text_norm,
                    capture_quality,
                    capture_components_json,
                    ax_richness_score,
                    selected_text_present,
                    document_path,
                    ax_source,
                    capture_trigger,
                    trigger_to_snapshot_ms,
                    ui_elements_json,
                    dedup_key,
                    is_sensitive_redacted,
                    created_at,
                    updated_at
                FROM context_snapshots
                WHERE ts >= ? AND ts <= ?
                ORDER BY ts DESC
                LIMIT ?
                "#,
                libsql::params![start_ts, end_ts, limit],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut snapshots = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            snapshots.push(row_to_context_snapshot(&row));
        }
        Ok(snapshots)
    }

    pub async fn get_session_retrieval_docs(
        &self,
        start_ts: i64,
        end_ts: i64,
        limit: i64,
    ) -> Result<Vec<SessionRetrievalDoc>> {
        let mut rows = self
            .conn
            .query(
                r#"
                SELECT
                    id,
                    session_id,
                    session_uid,
                    logical_chunk_id,
                    device_id,
                    user_id,
                    source_kind,
                    chunk_start_ts,
                    chunk_end_ts,
                    app_name,
                    browser_domain,
                    window_title,
                    document_title,
                    raw_visible_text,
                    contextual_retrieval_text,
                    capture_quality,
                    context_version,
                    session_position,
                    session_count,
                    created_at,
                    updated_at
                FROM session_retrieval_docs
                WHERE chunk_end_ts >= ? AND chunk_start_ts <= ?
                ORDER BY chunk_end_ts DESC
                LIMIT ?
                "#,
                libsql::params![start_ts, end_ts, limit],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut docs = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            docs.push(row_to_session_retrieval_doc(&row));
        }
        Ok(docs)
    }

    async fn last_insert_row_id(&self) -> Result<i64> {
        let mut rows = self
            .conn
            .query("SELECT last_insert_rowid()", ())
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        Ok(rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row.get::<i64>(0).unwrap_or(0))
            .unwrap_or(0))
    }

    async fn get_last_context_snapshot(
        &self,
        device_id: &str,
        user_id: &str,
    ) -> Result<Option<ContextSnapshot>> {
        let mut rows = self
            .conn
            .query(
                r#"
                SELECT
                    id,
                    device_id,
                    user_id,
                    activity_event_id,
                    activity_event_uid,
                    session_id,
                    session_uid,
                    ts,
                    source_type,
                    app_bundle_id,
                    app_name,
                    window_title,
                    browser_url,
                    browser_domain,
                    tab_title,
                    document_title,
                    visible_text_raw,
                    visible_text_norm,
                    capture_quality,
                    capture_components_json,
                    ax_richness_score,
                    selected_text_present,
                    document_path,
                    ax_source,
                    capture_trigger,
                    trigger_to_snapshot_ms,
                    ui_elements_json,
                    dedup_key,
                    is_sensitive_redacted,
                    created_at,
                    updated_at
                FROM context_snapshots
                WHERE device_id = ? AND user_id = ?
                ORDER BY ts DESC
                LIMIT 1
                "#,
                libsql::params![device_id.to_string(), user_id.to_string()],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        Ok(rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row_to_context_snapshot(&row)))
    }

    async fn get_last_context_session(
        &self,
        device_id: &str,
        user_id: &str,
    ) -> Result<Option<ContextSession>> {
        let mut rows = self
            .conn
            .query(
                r#"
                SELECT
                    id,
                    session_uid,
                    device_id,
                    user_id,
                    start_ts,
                    end_ts,
                    primary_app_bundle_id,
                    primary_app_name,
                    primary_domain,
                    dominant_title,
                    representative_text,
                    coverage_score,
                    snapshot_count,
                    created_at,
                    updated_at
                FROM context_sessions
                WHERE device_id = ? AND user_id = ?
                ORDER BY end_ts DESC
                LIMIT 1
                "#,
                libsql::params![device_id.to_string(), user_id.to_string()],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        Ok(rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row_to_context_session(&row)))
    }

    async fn insert_context_session(&self, snapshot: &ContextSnapshot) -> Result<i64> {
        let mut session = ContextSession::new(
            snapshot.device_id.clone(),
            snapshot.user_id.clone(),
            snapshot.ts,
            snapshot.ts,
        );
        session.primary_app_bundle_id = Some(snapshot.app_bundle_id.clone());
        session.primary_app_name = Some(snapshot.app_name.clone());
        session.primary_domain = snapshot.browser_domain.clone();
        session.dominant_title = dominant_title(snapshot);
        session.representative_text = representative_text(snapshot);
        session.coverage_score = snapshot.capture_quality;
        session.snapshot_count = 0;

        self.conn
            .execute(
                r#"
                INSERT INTO context_sessions (
                    session_uid,
                    device_id,
                    user_id,
                    start_ts,
                    end_ts,
                    primary_app_bundle_id,
                    primary_app_name,
                    primary_domain,
                    dominant_title,
                    representative_text,
                    coverage_score,
                    snapshot_count,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
                libsql::params![
                    session.session_uid,
                    session.device_id,
                    session.user_id,
                    session.start_ts,
                    session.end_ts,
                    session.primary_app_bundle_id,
                    session.primary_app_name,
                    session.primary_domain,
                    session.dominant_title,
                    session.representative_text,
                    session.coverage_score,
                    session.snapshot_count,
                    session.created_at,
                    session.updated_at,
                ],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        self.last_insert_row_id().await
    }

    async fn update_context_session(
        &self,
        session_id: i64,
        snapshot: &ContextSnapshot,
    ) -> Result<()> {
        if session_id <= 0 {
            return Ok(());
        }
        self.conn
            .execute(
                r#"
                UPDATE context_sessions
                SET end_ts = ?,
                    primary_app_bundle_id = COALESCE(primary_app_bundle_id, ?),
                    primary_app_name = COALESCE(primary_app_name, ?),
                    primary_domain = COALESCE(primary_domain, ?),
                    dominant_title = COALESCE(NULLIF(?, ''), dominant_title),
                    representative_text = COALESCE(NULLIF(?, ''), representative_text),
                    coverage_score = CASE
                        WHEN coverage_score <= 0 THEN ?
                        ELSE ((coverage_score * MAX(snapshot_count, 1)) + ?) / (MAX(snapshot_count, 1) + 1)
                    END,
                    updated_at = ?
                WHERE id = ?
                "#,
                libsql::params![
                    snapshot.ts,
                    snapshot.app_bundle_id.clone(),
                    snapshot.app_name.clone(),
                    snapshot.browser_domain.clone(),
                    dominant_title(snapshot).unwrap_or_default(),
                    representative_text(snapshot).unwrap_or_default(),
                    snapshot.capture_quality,
                    snapshot.capture_quality,
                    snapshot.updated_at,
                    session_id,
                ],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        Ok(())
    }

    async fn refresh_session_rollup(&self, session_id: i64) -> Result<()> {
        self.conn
            .execute(
                r#"
                UPDATE context_sessions
                SET
                    start_ts = COALESCE((SELECT MIN(ts) FROM context_snapshots WHERE session_id = ?), start_ts),
                    end_ts = COALESCE((SELECT MAX(ts) FROM context_snapshots WHERE session_id = ?), end_ts),
                    primary_app_bundle_id = COALESCE(
                        (
                            SELECT app_bundle_id
                            FROM context_snapshots
                            WHERE session_id = ? AND TRIM(COALESCE(app_bundle_id, '')) != ''
                            GROUP BY app_bundle_id
                            ORDER BY COUNT(*) DESC, MAX(ts) DESC
                            LIMIT 1
                        ),
                        primary_app_bundle_id
                    ),
                    primary_app_name = COALESCE(
                        (
                            SELECT app_name
                            FROM context_snapshots
                            WHERE session_id = ? AND TRIM(COALESCE(app_name, '')) != ''
                            GROUP BY app_name
                            ORDER BY COUNT(*) DESC, MAX(ts) DESC
                            LIMIT 1
                        ),
                        primary_app_name
                    ),
                    primary_domain = COALESCE(
                        (
                            SELECT browser_domain
                            FROM context_snapshots
                            WHERE session_id = ? AND TRIM(COALESCE(browser_domain, '')) != ''
                            GROUP BY browser_domain
                            ORDER BY COUNT(*) DESC, MAX(ts) DESC
                            LIMIT 1
                        ),
                        primary_domain
                    ),
                    dominant_title = COALESCE(
                        NULLIF((
                            SELECT derived_title
                            FROM (
                                SELECT
                                    COALESCE(
                                        NULLIF(TRIM(COALESCE(document_title, '')), ''),
                                        NULLIF(TRIM(COALESCE(tab_title, '')), ''),
                                        NULLIF(TRIM(COALESCE(window_title, '')), '')
                                    ) AS derived_title,
                                    COUNT(*) AS title_count,
                                    MAX(ts) AS last_seen_ts
                                FROM context_snapshots
                                WHERE session_id = ?
                                GROUP BY derived_title
                            )
                            WHERE TRIM(COALESCE(derived_title, '')) != ''
                            ORDER BY title_count DESC, last_seen_ts DESC
                            LIMIT 1
                        ), ''),
                        dominant_title
                    ),
                    snapshot_count = COALESCE((SELECT COUNT(*) FROM context_snapshots WHERE session_id = ?), snapshot_count),
                    representative_text = COALESCE(
                        NULLIF((
                            SELECT visible_text_raw
                            FROM context_snapshots
                            WHERE session_id = ? AND TRIM(COALESCE(visible_text_raw, '')) != ''
                            ORDER BY LENGTH(visible_text_raw) DESC, ts DESC
                            LIMIT 1
                        ), ''),
                        representative_text
                    ),
                    updated_at = ?
                WHERE id = ?
                "#,
                libsql::params![
                    session_id,
                    session_id,
                    session_id,
                    session_id,
                    session_id,
                    session_id,
                    session_id,
                    session_id,
                    chrono::Utc::now().timestamp_millis(),
                    session_id,
                ],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        Ok(())
    }

    async fn upsert_session_retrieval_doc(&self, session_id: i64) -> Result<()> {
        if session_id <= 0 {
            return Ok(());
        }
        let session = self.load_context_session(session_id).await?;
        let Some(session) = session else {
            return Ok(());
        };

        let raw_text = self.collect_session_raw_text(session_id).await?;
        let contextual_text = build_contextual_text(&session, &raw_text);
        let updated_at = chrono::Utc::now().timestamp_millis();
        let logical_chunk_id = format!("session-doc:{}", session.session_uid);

        let mut existing_rows = self
            .conn
            .query(
                r#"
                SELECT id
                FROM session_retrieval_docs
                WHERE session_id = ?
                LIMIT 1
                "#,
                libsql::params![session_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        if let Some(row) = existing_rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            let doc_id: i64 = row.get(0).unwrap_or(0);
            self.conn
                .execute(
                    r#"
                    UPDATE session_retrieval_docs
                    SET session_uid = ?,
                        logical_chunk_id = ?,
                        chunk_start_ts = ?,
                        chunk_end_ts = ?,
                        app_name = ?,
                        browser_domain = ?,
                        window_title = ?,
                        document_title = ?,
                        raw_visible_text = ?,
                        contextual_retrieval_text = ?,
                        capture_quality = ?,
                        session_count = ?,
                        updated_at = ?
                    WHERE id = ?
                    "#,
                    libsql::params![
                        session.session_uid.clone(),
                        logical_chunk_id.clone(),
                        session.start_ts,
                        session.end_ts,
                        session.primary_app_name.clone(),
                        session.primary_domain.clone(),
                        session.dominant_title.clone(),
                        session.dominant_title.clone(),
                        clip_text(&raw_text, RAW_TEXT_LIMIT),
                        clip_text(&contextual_text, CONTEXTUAL_TEXT_LIMIT),
                        session.coverage_score,
                        session.snapshot_count,
                        updated_at,
                        doc_id,
                    ],
                )
                .await
                .map_err(|e| DatabaseError::Query(e.to_string()))?;
        } else {
            self.conn
                .execute(
                    r#"
                    INSERT INTO session_retrieval_docs (
                        session_id,
                        session_uid,
                        logical_chunk_id,
                        device_id,
                        user_id,
                        source_kind,
                        chunk_start_ts,
                        chunk_end_ts,
                        app_name,
                        browser_domain,
                        window_title,
                        document_title,
                        raw_visible_text,
                        contextual_retrieval_text,
                        capture_quality,
                        context_version,
                        session_position,
                        session_count,
                        created_at,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, 'context_session', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
                    "#,
                    libsql::params![
                        session_id,
                        session.session_uid,
                        logical_chunk_id,
                        session.device_id,
                        session.user_id,
                        session.start_ts,
                        session.end_ts,
                        session.primary_app_name,
                        session.primary_domain,
                        session.dominant_title.clone(),
                        session.dominant_title,
                        clip_text(&raw_text, RAW_TEXT_LIMIT),
                        clip_text(&contextual_text, CONTEXTUAL_TEXT_LIMIT),
                        session.coverage_score,
                        session.snapshot_count,
                        updated_at,
                        updated_at,
                    ],
                )
                .await
                .map_err(|e| DatabaseError::Query(e.to_string()))?;
        }
        Ok(())
    }

    async fn load_context_session(&self, session_id: i64) -> Result<Option<ContextSession>> {
        let mut rows = self
            .conn
            .query(
                r#"
                SELECT
                    id,
                    session_uid,
                    device_id,
                    user_id,
                    start_ts,
                    end_ts,
                    primary_app_bundle_id,
                    primary_app_name,
                    primary_domain,
                    dominant_title,
                    representative_text,
                    coverage_score,
                    snapshot_count,
                    created_at,
                    updated_at
                FROM context_sessions
                WHERE id = ?
                LIMIT 1
                "#,
                libsql::params![session_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        Ok(rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .map(|row| row_to_context_session(&row)))
    }

    async fn load_context_session_uid(&self, session_id: i64) -> Result<Option<String>> {
        if session_id <= 0 {
            return Ok(None);
        }

        let mut rows = self
            .conn
            .query(
                "SELECT session_uid FROM context_sessions WHERE id = ? LIMIT 1",
                libsql::params![session_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<String>(0).ok())
            .filter(|value| !value.trim().is_empty()))
    }

    async fn load_activity_event_uid(&self, activity_event_id: i64) -> Result<Option<String>> {
        if activity_event_id <= 0 {
            return Ok(None);
        }

        let mut rows = self
            .conn
            .query(
                "SELECT event_uid FROM activity_events WHERE id = ? LIMIT 1",
                libsql::params![activity_event_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
            .and_then(|row| row.get::<String>(0).ok())
            .filter(|value| !value.trim().is_empty()))
    }

    async fn collect_session_raw_text(&self, session_id: i64) -> Result<String> {
        let mut rows = self
            .conn
            .query(
                r#"
                SELECT
                    COALESCE(NULLIF(visible_text_raw, ''), ''),
                    COALESCE(window_title, ''),
                    COALESCE(document_title, ''),
                    COALESCE(tab_title, ''),
                    COALESCE(app_name, ''),
                    COALESCE(browser_domain, ''),
                    COALESCE(source_type, '')
                FROM context_snapshots
                WHERE session_id = ?
                ORDER BY ts ASC
                "#,
                libsql::params![session_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut parts: Vec<String> = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            let raw: String = row.get(0).unwrap_or_default();
            let window: String = row.get(1).unwrap_or_default();
            let document: String = row.get(2).unwrap_or_default();
            let tab: String = row.get(3).unwrap_or_default();
            let app: String = row.get(4).unwrap_or_default();
            let browser_domain: String = row.get(5).unwrap_or_default();
            let source_type: String = row.get(6).unwrap_or_default();
            for candidate in build_snapshot_text_candidates(
                &raw,
                &document,
                &tab,
                &window,
                &app,
                &browser_domain,
                &source_type,
            ) {
                let trimmed = candidate.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if parts
                    .iter()
                    .any(|existing| normalize_text(existing) == normalize_text(trimmed))
                {
                    continue;
                }
                parts.push(trimmed.to_string());
                if parts.len() >= 12 {
                    break;
                }
            }
            if parts.len() >= 12 {
                break;
            }
        }
        Ok(parts.join("\n\n"))
    }
}

fn should_start_new_session(
    previous: &ContextSnapshot,
    previous_session: &ContextSession,
    current: &ContextSnapshot,
) -> bool {
    let gap = current.ts.saturating_sub(previous.ts);
    if gap > SESSION_GAP_MS {
        return true;
    }

    let session_duration = current.ts.saturating_sub(previous_session.start_ts);
    if session_duration > MAX_SESSION_DURATION_MS {
        return true;
    }

    if canonical_app(previous) != canonical_app(current) && gap > APP_CHANGE_GAP_MS {
        return true;
    }

    let previous_domain = canonical_domain(previous);
    let current_domain = canonical_domain(current);
    let previous_is_browser = !previous_domain.is_empty();
    let current_is_browser = !current_domain.is_empty();
    if previous_is_browser
        && current_is_browser
        && previous_domain != current_domain
        && gap > DOMAIN_CHANGE_GAP_MS
    {
        return true;
    }

    let previous_title = normalized_title_signature(previous);
    let current_title = normalized_title_signature(current);
    if !previous_title.is_empty()
        && !current_title.is_empty()
        && previous_title != current_title
        && gap > TITLE_CHANGE_GAP_MS
    {
        return true;
    }

    false
}

fn dominant_title(snapshot: &ContextSnapshot) -> Option<String> {
    for value in [
        snapshot.document_title.as_deref(),
        snapshot.tab_title.as_deref(),
        snapshot.window_title.as_deref(),
    ] {
        let candidate = value.unwrap_or("").trim();
        if !candidate.is_empty() {
            return Some(candidate.to_string());
        }
    }
    None
}

fn representative_text(snapshot: &ContextSnapshot) -> Option<String> {
    let raw = snapshot.visible_text_raw.trim();
    if !raw.is_empty() {
        return Some(clip_text(raw, 2500));
    }
    dominant_title(snapshot)
}

fn build_contextual_text(session: &ContextSession, raw_text: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut parent_context: Vec<String> = Vec::new();
    if let Some(app) = session.primary_app_name.as_deref() {
        if !app.trim().is_empty() {
            parts.push(format!("App: {}", app.trim()));
            parent_context.push(app.trim().to_string());
        }
    }
    if let Some(domain) = session.primary_domain.as_deref() {
        if !domain.trim().is_empty() {
            parts.push(format!("Domain: {}", domain.trim()));
            parent_context.push(domain.trim().to_string());
        }
    }
    if let Some(title) = session.dominant_title.as_deref() {
        if !title.trim().is_empty() {
            parts.push(format!("Title: {}", title.trim()));
            parent_context.push(title.trim().to_string());
        }
    }
    if !parent_context.is_empty() {
        parts.insert(0, format!("Context: {}", parent_context.join(" / ")));
    }
    parts.push(format!(
        "Time range: {} to {}",
        session.start_ts, session.end_ts
    ));
    if !raw_text.trim().is_empty() {
        parts.push(format!("Visible content: {}", raw_text.trim()));
    }

    // Extract structured artifacts from raw text for better search relevance
    let extracted = extract_contextual_artifacts(raw_text);
    if !extracted.files.is_empty() {
        parts.push(format!("Files: {}", extracted.files.join(", ")));
    }
    if !extracted.commands.is_empty() {
        parts.push(format!("Commands: {}", extracted.commands.join(", ")));
    }
    if !extracted.errors.is_empty() {
        parts.push(format!("Errors: {}", extracted.errors.join(", ")));
    }
    if !extracted.git_ops.is_empty() {
        parts.push(format!("Git: {}", extracted.git_ops.join(", ")));
    }

    parts.join(" | ")
}

struct ExtractedArtifacts {
    files: Vec<String>,
    commands: Vec<String>,
    errors: Vec<String>,
    git_ops: Vec<String>,
}

fn extract_contextual_artifacts(text: &str) -> ExtractedArtifacts {
    use std::collections::HashSet;

    let file_extensions = [
        ".rs", ".py", ".ts", ".tsx", ".js", ".jsx", ".md", ".toml", ".json", ".yaml", ".yml",
        ".sql", ".css", ".scss", ".html", ".sh", ".swift", ".go", ".rb", ".java", ".c", ".cpp",
        ".h",
    ];

    let command_prefixes = [
        "cargo ", "npm ", "pnpm ", "pytest ", "python ", "uv ", "git ", "bun ", "make ", "docker ",
        "brew ",
    ];

    let error_markers = [
        "fatal:",
        "error:",
        "panic:",
        "exception:",
        "failed:",
        "crash:",
        "traceback:",
        "abort:",
        "fatal ",
        "error ",
        "panic ",
    ];

    let git_ops = [
        "git push",
        "git pull",
        "git commit",
        "git merge",
        "git rebase",
        "git checkout",
        "git stash",
    ];

    let mut files: HashSet<String> = HashSet::new();
    let mut commands: HashSet<String> = HashSet::new();
    let mut errors: HashSet<String> = HashSet::new();
    let mut git: HashSet<String> = HashSet::new();

    let text_lower = text.to_lowercase();

    // Extract file references
    for word in text.split_whitespace() {
        let clean = word.trim_matches(|c: char| {
            !c.is_alphanumeric() && c != '.' && c != '/' && c != '_' && c != '-'
        });
        for ext in &file_extensions {
            if clean.ends_with(ext) && clean.len() > ext.len() + 1 && files.len() < 16 {
                files.insert(clean.to_string());
            }
        }
    }

    // Extract commands
    for prefix in &command_prefixes {
        for (idx, _) in text_lower.match_indices(prefix) {
            if commands.len() >= 8 {
                break;
            }
            let snippet: String = text[idx..]
                .chars()
                .take(60)
                .take_while(|c| *c != '\n')
                .collect();
            let trimmed = snippet.trim();
            if !trimmed.is_empty() {
                commands.insert(trimmed.to_string());
            }
        }
    }

    // Extract error markers
    for marker in &error_markers {
        for (idx, _) in text_lower.match_indices(marker) {
            if errors.len() >= 6 {
                break;
            }
            let snippet: String = text[idx..]
                .chars()
                .take(80)
                .take_while(|c| *c != '\n')
                .collect();
            let trimmed = snippet.trim();
            if !trimmed.is_empty() {
                errors.insert(trimmed.to_string());
            }
        }
    }

    // Extract git operations
    for op in &git_ops {
        if text_lower.contains(op) && git.len() < 6 {
            git.insert(op.to_string());
        }
    }

    ExtractedArtifacts {
        files: files.into_iter().collect(),
        commands: commands.into_iter().collect(),
        errors: errors.into_iter().collect(),
        git_ops: git.into_iter().collect(),
    }
}

fn clip_text(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }
    value.chars().take(limit).collect()
}

fn canonical_app(snapshot: &ContextSnapshot) -> String {
    let bundle = snapshot.app_bundle_id.trim();
    if !bundle.is_empty() {
        return bundle.to_lowercase();
    }
    snapshot.app_name.trim().to_lowercase()
}

fn canonical_domain(snapshot: &ContextSnapshot) -> String {
    snapshot
        .browser_domain
        .as_deref()
        .unwrap_or("")
        .trim()
        .trim_start_matches("www.")
        .to_lowercase()
}

fn normalize_text(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalized_title_signature(snapshot: &ContextSnapshot) -> String {
    let mut title = dominant_title(snapshot).unwrap_or_default();
    if title.is_empty() {
        return String::new();
    }
    for suffix in [
        " - google chrome - nick",
        " - google chrome",
        " - cursor",
        " - codex",
        " - ritual dashboard",
    ] {
        if title.to_lowercase().ends_with(suffix) {
            let new_len = title.len().saturating_sub(suffix.len());
            title.truncate(new_len);
        }
    }
    normalize_text(&title)
}

fn is_low_signal_snapshot_text(value: &str) -> bool {
    let normalized = normalize_text(value);
    if normalized.is_empty() {
        return true;
    }
    let low_signal_patterns = [
        "accessibility links",
        "add files and more",
        "address and search bar",
        "ask for follow up changes",
        "chat history",
        "dashboard ritual",
        "deep research",
        "favorites",
        "file explorer",
        "new chat",
        "posted in",
        "prediction markets",
        "quick look",
        "recents",
        "reddit the heart of the internet",
        "search chats",
        "skip to content",
        "subscribe",
        "to view keyboard shortcuts",
        "watch later",
        "youtube shorts",
    ];
    if normalized.split_whitespace().count() <= 3
        && !normalized.contains("activity breakdown")
        && !normalized.contains("context memory")
        && !normalized.contains("contribution graph")
        && !normalized.contains("clerk")
        && !normalized.contains("paper")
        && !normalized.contains("ritual")
        && !normalized.contains("v0")
        && !normalized.contains("watcher")
        && !normalized.contains("py")
        && !normalized.contains("tsx")
    {
        return true;
    }
    low_signal_patterns
        .iter()
        .any(|pattern| normalized.contains(pattern))
}

fn normalize_snapshot_candidate(value: &str, limit: usize) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if is_low_signal_snapshot_text(trimmed) {
        return None;
    }
    let clipped = clip_text(trimmed, limit);
    if normalize_text(&clipped).len() < 4 {
        return None;
    }
    Some(clipped)
}

fn build_snapshot_text_candidates(
    raw: &str,
    document: &str,
    tab: &str,
    window: &str,
    app: &str,
    browser_domain: &str,
    source_type: &str,
) -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(value) = normalize_snapshot_candidate(raw, 1400) {
        candidates.push(value);
    }
    if let Some(value) = normalize_snapshot_candidate(document, 220) {
        candidates.push(value);
    }
    if let Some(value) = normalize_snapshot_candidate(tab, 220) {
        candidates.push(value);
    }
    if let Some(value) = normalize_snapshot_candidate(window, 220) {
        candidates.push(value);
    }
    if !browser_domain.trim().is_empty() && source_type == "browser_extension" {
        candidates.push(browser_domain.trim().to_string());
    }
    if let Some(value) = normalize_snapshot_candidate(app, 80) {
        candidates.push(value);
    }
    candidates
}

fn row_to_context_snapshot(row: &libsql::Row) -> ContextSnapshot {
    ContextSnapshot {
        id: row.get(0).ok(),
        device_id: row.get(1).unwrap_or_default(),
        user_id: row.get(2).unwrap_or_default(),
        activity_event_id: row.get(3).ok(),
        activity_event_uid: row.get(4).ok(),
        session_id: row.get(5).ok(),
        session_uid: row.get(6).ok(),
        ts: row.get(7).unwrap_or(0),
        source_type: row.get(8).unwrap_or_default(),
        app_bundle_id: row.get(9).unwrap_or_default(),
        app_name: row.get(10).unwrap_or_default(),
        window_title: row.get(11).ok(),
        browser_url: row.get(12).ok(),
        browser_domain: row.get(13).ok(),
        tab_title: row.get(14).ok(),
        document_title: row.get(15).ok(),
        visible_text_raw: row.get(16).unwrap_or_default(),
        visible_text_norm: row.get(17).unwrap_or_default(),
        capture_quality: row.get(18).unwrap_or(0.0),
        capture_components_json: row.get(19).ok(),
        ax_richness_score: row.get(20).unwrap_or(0.0),
        selected_text_present: row.get::<i64>(21).unwrap_or(0) != 0,
        document_path: row.get(22).ok(),
        ax_source: row.get(23).ok(),
        capture_trigger: row.get(24).ok(),
        trigger_to_snapshot_ms: row.get(25).ok(),
        ui_elements_json: row.get(26).ok(),
        dedup_key: row.get(27).unwrap_or_default(),
        is_sensitive_redacted: row.get::<i64>(28).unwrap_or(0) != 0,
        created_at: row.get(29).unwrap_or(0),
        updated_at: row.get(30).unwrap_or(0),
    }
}

fn row_to_context_session(row: &libsql::Row) -> ContextSession {
    ContextSession {
        id: row.get(0).ok(),
        session_uid: row.get(1).unwrap_or_default(),
        device_id: row.get(2).unwrap_or_default(),
        user_id: row.get(3).unwrap_or_default(),
        start_ts: row.get(4).unwrap_or(0),
        end_ts: row.get(5).unwrap_or(0),
        primary_app_bundle_id: row.get(6).ok(),
        primary_app_name: row.get(7).ok(),
        primary_domain: row.get(8).ok(),
        dominant_title: row.get(9).ok(),
        representative_text: row.get(10).ok(),
        coverage_score: row.get(11).unwrap_or(0.0),
        snapshot_count: row.get(12).unwrap_or(0),
        created_at: row.get(13).unwrap_or(0),
        updated_at: row.get(14).unwrap_or(0),
    }
}

fn row_to_session_retrieval_doc(row: &libsql::Row) -> SessionRetrievalDoc {
    SessionRetrievalDoc {
        id: row.get(0).ok(),
        session_id: row.get(1).unwrap_or(0),
        session_uid: row.get(2).unwrap_or_default(),
        logical_chunk_id: row.get(3).unwrap_or_default(),
        device_id: row.get(4).unwrap_or_default(),
        user_id: row.get(5).unwrap_or_default(),
        source_kind: row.get(6).unwrap_or_default(),
        chunk_start_ts: row.get(7).unwrap_or(0),
        chunk_end_ts: row.get(8).unwrap_or(0),
        app_name: row.get(9).ok(),
        browser_domain: row.get(10).ok(),
        window_title: row.get(11).ok(),
        document_title: row.get(12).ok(),
        raw_visible_text: row.get(13).unwrap_or_default(),
        contextual_retrieval_text: row.get(14).unwrap_or_default(),
        capture_quality: row.get(15).unwrap_or(0.0),
        context_version: row.get(16).unwrap_or(1),
        session_position: row.get(17).unwrap_or(0),
        session_count: row.get(18).unwrap_or(1),
        created_at: row.get(19).unwrap_or(0),
        updated_at: row.get(20).unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DatabaseConfig, RitualDatabase};
    use tempfile::TempDir;

    fn make_snapshot(
        ts: i64,
        dedup_key: &str,
        app_bundle_id: &str,
        app_name: &str,
        browser_domain: Option<&str>,
        visible_text_raw: &str,
    ) -> ContextSnapshot {
        let mut snapshot = ContextSnapshot::new(
            "device-1".to_string(),
            "user-1".to_string(),
            ts,
            "browser_extension",
            app_bundle_id.to_string(),
            app_name.to_string(),
            dedup_key.to_string(),
        );
        snapshot.browser_domain = browser_domain.map(|value| value.to_string());
        snapshot.window_title = Some(format!("{} window", app_name));
        snapshot.document_title = Some(format!("{} document", app_name));
        snapshot.visible_text_raw = visible_text_raw.to_string();
        snapshot.visible_text_norm = visible_text_raw.to_lowercase();
        snapshot.capture_quality = 0.95;
        snapshot
    }

    async fn count_rows(db: &RitualDatabase, table: &str) -> i64 {
        let conn = db.connection().await;
        let query = format!("SELECT COUNT(*) FROM {}", table);
        let mut rows = conn.query(&query, ()).await.unwrap();
        rows.next().await.unwrap().unwrap().get(0).unwrap_or(0)
    }

    #[tokio::test]
    async fn duplicate_dedup_key_does_not_create_new_snapshot_or_session() {
        let temp_dir = TempDir::new().unwrap();
        let db = RitualDatabase::open(&DatabaseConfig::for_testing(temp_dir.path()))
            .await
            .unwrap();

        let first = make_snapshot(
            1_700_000_000_000,
            "dedup-same",
            "com.google.Chrome",
            "Google Chrome",
            Some("app.ritual.so"),
            "Ritual dashboard and active chat thread",
        );
        let second = make_snapshot(
            1_700_000_030_000,
            "dedup-same",
            "com.google.Chrome",
            "Google Chrome",
            Some("app.ritual.so"),
            "Ritual dashboard and active chat thread",
        );

        let first_outcome = db.record_context_snapshot(&first).await.unwrap();
        let second_outcome = db.record_context_snapshot(&second).await.unwrap();

        assert!(first_outcome.inserted);
        assert!(!second_outcome.inserted);
        assert_eq!(first_outcome.snapshot_id, second_outcome.snapshot_id);
        assert_eq!(first_outcome.session_id, second_outcome.session_id);
        assert_eq!(count_rows(&db, "context_snapshots").await, 1);
        assert_eq!(count_rows(&db, "context_sessions").await, 1);

        let docs = db
            .get_session_retrieval_docs(0, 1_700_000_100_000, 10)
            .await
            .unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].session_id, first_outcome.session_id);
        assert!(docs[0]
            .raw_visible_text
            .contains("Ritual dashboard and active chat thread"));
        assert!(docs[0]
            .contextual_retrieval_text
            .contains("Visible content: Ritual dashboard and active chat thread"));
        assert_eq!(docs[0].session_count, 1);
    }

    #[tokio::test]
    async fn app_change_after_two_minutes_starts_new_session() {
        let temp_dir = TempDir::new().unwrap();
        let db = RitualDatabase::open(&DatabaseConfig::for_testing(temp_dir.path()))
            .await
            .unwrap();

        let first = make_snapshot(
            1_700_000_000_000,
            "ctx-1",
            "com.todesktop.cursor",
            "Cursor",
            None,
            "Editing watcher search implementation",
        );
        let second = make_snapshot(
            1_700_000_190_000,
            "ctx-2",
            "com.apple.Terminal",
            "Terminal",
            None,
            "Running cargo test for ritual watcher",
        );

        let first_outcome = db.record_context_snapshot(&first).await.unwrap();
        let second_outcome = db.record_context_snapshot(&second).await.unwrap();

        assert_ne!(first_outcome.session_id, second_outcome.session_id);
        assert_eq!(count_rows(&db, "context_sessions").await, 2);
    }

    #[tokio::test]
    async fn browser_domain_change_after_ninety_seconds_starts_new_session() {
        let temp_dir = TempDir::new().unwrap();
        let db = RitualDatabase::open(&DatabaseConfig::for_testing(temp_dir.path()))
            .await
            .unwrap();

        let first = make_snapshot(
            1_700_000_000_000,
            "ctx-domain-1",
            "com.google.Chrome",
            "Google Chrome",
            Some("docs.rs"),
            "Reading Rust docs for libsql",
        );
        let second = make_snapshot(
            1_700_000_095_000,
            "ctx-domain-2",
            "com.google.Chrome",
            "Google Chrome",
            Some("github.com"),
            "Reviewing repository implementation details",
        );

        let first_outcome = db.record_context_snapshot(&first).await.unwrap();
        let second_outcome = db.record_context_snapshot(&second).await.unwrap();

        assert_ne!(first_outcome.session_id, second_outcome.session_id);

        let docs = db
            .get_session_retrieval_docs(0, 1_700_000_200_000, 10)
            .await
            .unwrap();
        assert_eq!(docs.len(), 2);
        assert!(docs
            .iter()
            .any(|doc| doc.browser_domain.as_deref() == Some("docs.rs")));
        assert!(docs
            .iter()
            .any(|doc| doc.browser_domain.as_deref() == Some("github.com")));
    }

    #[tokio::test]
    async fn browser_title_change_after_twenty_seconds_starts_new_session() {
        let temp_dir = TempDir::new().unwrap();
        let db = RitualDatabase::open(&DatabaseConfig::for_testing(temp_dir.path()))
            .await
            .unwrap();

        let mut first = make_snapshot(
            1_700_000_000_000,
            "ctx-title-1",
            "com.google.Chrome",
            "Google Chrome",
            Some("v0.app"),
            "Contribution graph design iteration",
        );
        first.window_title =
            Some("Contribution Graph Design - v0 by Vercel - Google Chrome - Nick".to_string());
        first.document_title = Some("Contribution Graph Design - v0 by Vercel".to_string());

        let mut second = make_snapshot(
            1_700_000_025_000,
            "ctx-title-2",
            "com.google.Chrome",
            "Google Chrome",
            Some("v0.app"),
            "Clerk sign in redesign work",
        );
        second.window_title =
            Some("Clerk Sign-In Redesign - v0 by Vercel - Google Chrome - Nick".to_string());
        second.document_title = Some("Clerk Sign-In Redesign - v0 by Vercel".to_string());

        let first_outcome = db.record_context_snapshot(&first).await.unwrap();
        let second_outcome = db.record_context_snapshot(&second).await.unwrap();

        assert_ne!(first_outcome.session_id, second_outcome.session_id);
    }

    #[tokio::test]
    async fn session_duration_cap_starts_new_session() {
        let temp_dir = TempDir::new().unwrap();
        let db = RitualDatabase::open(&DatabaseConfig::for_testing(temp_dir.path()))
            .await
            .unwrap();

        let first = make_snapshot(
            1_700_000_000_000,
            "ctx-duration-1",
            "com.google.Chrome",
            "Google Chrome",
            Some("paper.design"),
            "Paper MCP planning",
        );
        let second = make_snapshot(
            1_700_001_100_000,
            "ctx-duration-2",
            "com.google.Chrome",
            "Google Chrome",
            Some("paper.design"),
            "Paper MCP execution",
        );

        let first_outcome = db.record_context_snapshot(&first).await.unwrap();
        let second_outcome = db.record_context_snapshot(&second).await.unwrap();

        assert_ne!(first_outcome.session_id, second_outcome.session_id);
    }

    #[tokio::test]
    async fn session_rollup_recomputes_primary_domain_and_title_from_snapshots() {
        let temp_dir = TempDir::new().unwrap();
        let db = RitualDatabase::open(&DatabaseConfig::for_testing(temp_dir.path()))
            .await
            .unwrap();

        let mut first = make_snapshot(
            1_700_000_000_000,
            "ctx-rollup-1",
            "com.google.Chrome",
            "Google Chrome",
            None,
            "Short shell text",
        );
        first.window_title = Some("Google Chrome".to_string());
        first.document_title = None;

        let mut second = make_snapshot(
            1_700_000_010_000,
            "ctx-rollup-2",
            "com.google.Chrome",
            "Google Chrome",
            Some("paper.design"),
            "Paper MCP server integration docs and implementation notes",
        );
        second.window_title =
            Some("Paper MCP server integration - Google Chrome - Nick".to_string());
        second.document_title = Some("Paper MCP server integration".to_string());

        let first_outcome = db.record_context_snapshot(&first).await.unwrap();
        let second_outcome = db.record_context_snapshot(&second).await.unwrap();

        assert_eq!(first_outcome.session_id, second_outcome.session_id);

        let docs = db
            .get_session_retrieval_docs(0, 1_700_000_200_000, 10)
            .await
            .unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].browser_domain.as_deref(), Some("paper.design"));
        assert_eq!(
            docs[0].document_title.as_deref(),
            Some("Paper MCP server integration")
        );
        assert!(!docs[0]
            .raw_visible_text
            .to_lowercase()
            .contains("short shell text"));
    }
}
