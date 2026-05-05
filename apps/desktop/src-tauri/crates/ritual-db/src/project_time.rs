//! Local-first project/task time attribution.
//!
//! This module converts raw watcher activity into compact project/task sessions
//! and daily rollups. Raw OCR/accessibility evidence stays local and is used
//! only for classification/explainability under retention.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{DateTime, Local, Utc};
use libsql::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{DatabaseError, Result};

const ATTRIBUTION_VERSION: &str = "project_time_v1";
const SESSION_GAP_MS: i64 = 5 * 60 * 1000;
const MIN_CONFIDENCE: f64 = 0.45;
const DEFAULT_RETENTION_DAYS: i64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTimeSession {
    pub session_uid: String,
    pub user_id: String,
    pub device_id: String,
    pub date: String,
    pub timezone: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub active_ms: i64,
    pub afk_ms: i64,
    pub project_key: String,
    pub project_name: String,
    pub task_key: String,
    pub task_name: String,
    pub classification_source: String,
    pub confidence: f64,
    pub status: String,
    pub apps_json: String,
    pub domains_json: String,
    pub artifacts_json: String,
    pub summary_text: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTimeRecomputeResult {
    pub sessions_written: i64,
    pub rollups_written: i64,
    pub active_ms_from_events: i64,
    pub active_ms_attributed: i64,
    pub active_ms_delta: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTimeRetentionResult {
    pub retention_days: i64,
    pub cutoff_ms: i64,
    pub context_snapshots_deleted: i64,
    pub ocr_frames_deleted: i64,
    pub video_chunks_deleted: i64,
    pub local_evidence_deleted: i64,
}

#[derive(Debug, Clone)]
struct ActivityRow {
    id: i64,
    user_id: String,
    device_id: String,
    ts_start: i64,
    ts_end: i64,
    app_bundle_id: String,
    app_name: String,
    window_title: Option<String>,
    browser_domain: Option<String>,
    is_afk: bool,
}

#[derive(Debug, Clone)]
struct ClassificationRule {
    matcher_app_bundle_id: Option<String>,
    matcher_domain: Option<String>,
    matcher_title_pattern: Option<String>,
    matcher_artifact_pattern: Option<String>,
    matcher_keyword_pattern: Option<String>,
    project_key: String,
    project_name: String,
    task_key: String,
    task_name: String,
}

#[derive(Debug, Clone, PartialEq)]
struct Classification {
    project_key: String,
    project_name: String,
    task_key: String,
    task_name: String,
    source: String,
    confidence: f64,
}

#[derive(Debug, Clone)]
struct SessionBuilder {
    user_id: String,
    device_id: String,
    start_ts: i64,
    end_ts: i64,
    active_ms: i64,
    classification: Classification,
    app_counts: BTreeMap<String, i64>,
    domain_counts: BTreeMap<String, i64>,
    artifacts: BTreeSet<String>,
    event_ids: Vec<i64>,
}

#[derive(Debug, Clone)]
struct RollupBuilder {
    user_id: String,
    device_id: String,
    date: String,
    project_key: String,
    project_name: String,
    task_key: String,
    task_name: String,
    active_ms: i64,
    session_count: i64,
    confidence_sum: f64,
    app_counts: BTreeMap<String, i64>,
    domain_counts: BTreeMap<String, i64>,
}

pub struct ProjectTimeOps<'a> {
    conn: &'a Connection,
}

impl<'a> ProjectTimeOps<'a> {
    pub fn new(conn: &'a Connection) -> Self {
        Self { conn }
    }

    pub async fn recompute_range(
        &self,
        start_ts: i64,
        end_ts: i64,
        user_id: Option<&str>,
        device_id: Option<&str>,
    ) -> Result<ProjectTimeRecomputeResult> {
        let rules = self.load_rules(user_id).await?;
        let events = self
            .load_activity_events(start_ts, end_ts, user_id, device_id)
            .await?;
        let active_ms_from_events = events
            .iter()
            .filter(|event| !event.is_afk)
            .map(|event| clipped_duration(event.ts_start, event.ts_end, start_ts, end_ts))
            .sum::<i64>();

        self.delete_existing_range(start_ts, end_ts, user_id, device_id)
            .await?;

        let sessions = build_sessions(&events, &rules, start_ts, end_ts);
        let now = now_ms();
        let mut sessions_written = 0i64;
        for session in &sessions {
            self.insert_session(session, now).await?;
            self.insert_local_evidence(session, now).await?;
            sessions_written += 1;
        }

        let rollups = build_rollups(&sessions);
        let mut rollups_written = 0i64;
        for rollup in rollups.values() {
            self.insert_rollup(rollup, now).await?;
            rollups_written += 1;
        }

        let active_ms_attributed = sessions.iter().map(|session| session.active_ms).sum::<i64>();
        Ok(ProjectTimeRecomputeResult {
            sessions_written,
            rollups_written,
            active_ms_from_events,
            active_ms_attributed,
            active_ms_delta: active_ms_attributed - active_ms_from_events,
        })
    }

    pub async fn run_retention(&self, retention_days: Option<i64>) -> Result<ProjectTimeRetentionResult> {
        let days = retention_days.unwrap_or(DEFAULT_RETENTION_DAYS).max(1);
        let cutoff_ms = now_ms().saturating_sub(days * 24 * 60 * 60 * 1000);

        let local_evidence_deleted = self
            .conn
            .execute(
                "DELETE FROM project_time_session_evidence_local WHERE timestamp < ?",
                libsql::params![cutoff_ms],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))? as i64;

        let context_snapshots_deleted = self
            .conn
            .execute(
                "DELETE FROM context_snapshots WHERE ts < ?",
                libsql::params![cutoff_ms],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))? as i64;

        let _ = self
            .conn
            .execute(
                r#"
                DELETE FROM segment_frames
                WHERE frame_id IN (SELECT id FROM ocr_frames WHERE timestamp < ?)
                "#,
                libsql::params![cutoff_ms],
            )
            .await;

        let ocr_frames_deleted = self
            .conn
            .execute(
                "DELETE FROM ocr_frames WHERE timestamp < ?",
                libsql::params![cutoff_ms],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))? as i64;

        let video_chunks_deleted = self
            .conn
            .execute(
                "DELETE FROM video_chunks WHERE COALESCE(end_time, start_time) < ?",
                libsql::params![cutoff_ms],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))? as i64;

        Ok(ProjectTimeRetentionResult {
            retention_days: days,
            cutoff_ms,
            context_snapshots_deleted,
            ocr_frames_deleted,
            video_chunks_deleted,
            local_evidence_deleted,
        })
    }

    async fn load_rules(&self, user_id: Option<&str>) -> Result<Vec<ClassificationRule>> {
        let mut rows = self
            .conn
            .query(
                r#"
                SELECT matcher_app_bundle_id, matcher_domain, matcher_title_pattern,
                       matcher_artifact_pattern, matcher_keyword_pattern,
                       project_key, project_name, task_key, task_name
                FROM project_classification_rules
                WHERE enabled = 1
                  AND (? IS NULL OR user_id = ?)
                ORDER BY priority ASC, updated_at DESC
                "#,
                libsql::params![user_id, user_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut rules = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            rules.push(ClassificationRule {
                matcher_app_bundle_id: optional_lower(row.get::<Option<String>>(0).ok().flatten()),
                matcher_domain: optional_lower(row.get::<Option<String>>(1).ok().flatten()),
                matcher_title_pattern: optional_lower(row.get::<Option<String>>(2).ok().flatten()),
                matcher_artifact_pattern: optional_lower(row.get::<Option<String>>(3).ok().flatten()),
                matcher_keyword_pattern: optional_lower(row.get::<Option<String>>(4).ok().flatten()),
                project_key: row.get(5).unwrap_or_else(|_| "unclassified".to_string()),
                project_name: row.get(6).unwrap_or_else(|_| "Unclassified".to_string()),
                task_key: row.get(7).unwrap_or_else(|_| "general".to_string()),
                task_name: row.get(8).unwrap_or_else(|_| "General".to_string()),
            });
        }
        Ok(rules)
    }

    async fn load_activity_events(
        &self,
        start_ts: i64,
        end_ts: i64,
        user_id: Option<&str>,
        device_id: Option<&str>,
    ) -> Result<Vec<ActivityRow>> {
        let mut rows = self
            .conn
            .query(
                r#"
                SELECT id, user_id, device_id, ts_start, ts_end,
                       app_bundle_id, app_name, window_title, browser_domain, is_afk
                FROM activity_events
                WHERE ts_end > ?
                  AND ts_start < ?
                  AND (? IS NULL OR user_id = ?)
                  AND (? IS NULL OR device_id = ?)
                ORDER BY ts_start ASC, id ASC
                "#,
                libsql::params![start_ts, end_ts, user_id, user_id, device_id, device_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        let mut events = Vec::new();
        while let Some(row) = rows
            .next()
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?
        {
            events.push(ActivityRow {
                id: row.get(0).unwrap_or(0),
                user_id: row.get(1).unwrap_or_default(),
                device_id: row.get(2).unwrap_or_default(),
                ts_start: row.get(3).unwrap_or(0),
                ts_end: row.get(4).unwrap_or(0),
                app_bundle_id: row.get(5).unwrap_or_default(),
                app_name: row.get(6).unwrap_or_default(),
                window_title: row.get::<Option<String>>(7).ok().flatten(),
                browser_domain: row.get::<Option<String>>(8).ok().flatten(),
                is_afk: row.get::<i64>(9).unwrap_or(0) != 0,
            });
        }
        Ok(events)
    }

    async fn delete_existing_range(
        &self,
        start_ts: i64,
        end_ts: i64,
        user_id: Option<&str>,
        device_id: Option<&str>,
    ) -> Result<()> {
        let start_date = local_date(start_ts);
        let end_date = local_date(end_ts.saturating_sub(1).max(start_ts));
        self.conn
            .execute(
                r#"
                DELETE FROM project_time_session_evidence_local
                WHERE timestamp >= ?
                  AND timestamp < ?
                  AND (? IS NULL OR user_id = ?)
                  AND (? IS NULL OR device_id = ?)
                "#,
                libsql::params![start_ts, end_ts, user_id, user_id, device_id, device_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        self.conn
            .execute(
                r#"
                DELETE FROM project_time_sessions
                WHERE end_ts > ?
                  AND start_ts < ?
                  AND (? IS NULL OR user_id = ?)
                  AND (? IS NULL OR device_id = ?)
                "#,
                libsql::params![start_ts, end_ts, user_id, user_id, device_id, device_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        self.conn
            .execute(
                r#"
                DELETE FROM project_time_daily_rollups
                WHERE date >= ?
                  AND date <= ?
                  AND (? IS NULL OR user_id = ?)
                  AND (? IS NULL OR device_id = ?)
                "#,
                libsql::params![start_date, end_date, user_id, user_id, device_id, device_id],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;

        Ok(())
    }

    async fn insert_session(&self, session: &SessionBuilder, now: i64) -> Result<()> {
        let date = local_date(session.start_ts);
        let session_uid = session_uid(session);
        self.conn
            .execute(
                r#"
                INSERT INTO project_time_sessions (
                    session_uid, user_id, device_id, date, timezone,
                    start_ts, end_ts, active_ms, afk_ms,
                    project_key, project_name, task_key, task_name,
                    classification_source, confidence, status,
                    apps_json, domains_json, artifacts_json, summary_text,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_uid) DO UPDATE SET
                    date = excluded.date,
                    timezone = excluded.timezone,
                    start_ts = excluded.start_ts,
                    end_ts = excluded.end_ts,
                    active_ms = excluded.active_ms,
                    afk_ms = excluded.afk_ms,
                    project_key = excluded.project_key,
                    project_name = excluded.project_name,
                    task_key = excluded.task_key,
                    task_name = excluded.task_name,
                    classification_source = excluded.classification_source,
                    confidence = excluded.confidence,
                    status = excluded.status,
                    apps_json = excluded.apps_json,
                    domains_json = excluded.domains_json,
                    artifacts_json = excluded.artifacts_json,
                    summary_text = excluded.summary_text,
                    updated_at = excluded.updated_at
                "#,
                libsql::params![
                    session_uid,
                    session.user_id.clone(),
                    session.device_id.clone(),
                    date,
                    "local",
                    session.start_ts,
                    session.end_ts,
                    session.active_ms,
                    session.classification.project_key.clone(),
                    session.classification.project_name.clone(),
                    session.classification.task_key.clone(),
                    session.classification.task_name.clone(),
                    session.classification.source.clone(),
                    session.classification.confidence,
                    counts_json(&session.app_counts),
                    counts_json(&session.domain_counts),
                    string_set_json(&session.artifacts),
                    summary_text(session),
                    now,
                    now,
                ],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        Ok(())
    }

    async fn insert_local_evidence(&self, session: &SessionBuilder, now: i64) -> Result<()> {
        let uid = session_uid(session);
        for event_id in &session.event_ids {
            self.conn
                .execute(
                    r#"
                    INSERT INTO project_time_session_evidence_local (
                        session_uid, user_id, device_id, evidence_kind,
                        activity_event_id, excerpt, timestamp, score, created_at
                    ) VALUES (?, ?, ?, 'activity_event', ?, ?, ?, ?, ?)
                    "#,
                    libsql::params![
                        uid.clone(),
                        session.user_id.clone(),
                        session.device_id.clone(),
                        *event_id,
                        summary_text(session),
                        session.start_ts,
                        session.classification.confidence,
                        now,
                    ],
                )
                .await
                .map_err(|e| DatabaseError::Query(e.to_string()))?;
        }
        Ok(())
    }

    async fn insert_rollup(&self, rollup: &RollupBuilder, now: i64) -> Result<()> {
        let rollup_uid = format!(
            "project-rollup:{}:{}:{}:{}",
            rollup.device_id, rollup.date, rollup.project_key, rollup.task_key
        );
        let confidence_avg = if rollup.session_count > 0 {
            rollup.confidence_sum / rollup.session_count as f64
        } else {
            0.0
        };
        let summary = format!(
            "{} / {}: {}",
            rollup.project_name,
            rollup.task_name,
            format_duration(rollup.active_ms)
        );

        self.conn
            .execute(
                r#"
                INSERT INTO project_time_daily_rollups (
                    rollup_uid, user_id, device_id, date, timezone,
                    project_key, project_name, task_key, task_name,
                    active_ms, session_count, confidence_avg,
                    top_apps_json, top_domains_json, summary_text,
                    source_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(rollup_uid) DO UPDATE SET
                    active_ms = excluded.active_ms,
                    session_count = excluded.session_count,
                    confidence_avg = excluded.confidence_avg,
                    top_apps_json = excluded.top_apps_json,
                    top_domains_json = excluded.top_domains_json,
                    summary_text = excluded.summary_text,
                    source_version = excluded.source_version,
                    updated_at = excluded.updated_at
                "#,
                libsql::params![
                    rollup_uid,
                    rollup.user_id.clone(),
                    rollup.device_id.clone(),
                    rollup.date.clone(),
                    rollup.project_key.clone(),
                    rollup.project_name.clone(),
                    rollup.task_key.clone(),
                    rollup.task_name.clone(),
                    rollup.active_ms,
                    rollup.session_count,
                    confidence_avg,
                    counts_json(&rollup.app_counts),
                    counts_json(&rollup.domain_counts),
                    summary,
                    ATTRIBUTION_VERSION,
                    now,
                    now,
                ],
            )
            .await
            .map_err(|e| DatabaseError::Query(e.to_string()))?;
        Ok(())
    }
}

fn build_sessions(
    events: &[ActivityRow],
    rules: &[ClassificationRule],
    range_start_ts: i64,
    range_end_ts: i64,
) -> Vec<SessionBuilder> {
    let mut sessions = Vec::new();
    let mut current: Option<SessionBuilder> = None;

    for event in events {
        if event.is_afk {
            if let Some(session) = current.take() {
                sessions.push(session);
            }
            continue;
        }

        let active_ms = clipped_duration(event.ts_start, event.ts_end, range_start_ts, range_end_ts);
        if active_ms <= 0 {
            continue;
        }

        let classification = classify_event(event, rules);
        let event_start = event.ts_start.max(range_start_ts);
        let event_end = event.ts_end.min(range_end_ts);

        let should_merge = current
            .as_ref()
            .map(|session| {
                event_start.saturating_sub(session.end_ts) <= SESSION_GAP_MS
                    && session.classification.project_key == classification.project_key
                    && session.classification.task_key == classification.task_key
            })
            .unwrap_or(false);

        if should_merge {
            if let Some(session) = current.as_mut() {
                session.end_ts = session.end_ts.max(event_end);
                session.active_ms += active_ms;
                add_count(&mut session.app_counts, &event.app_name, active_ms);
                if let Some(domain) = &event.browser_domain {
                    add_count(&mut session.domain_counts, domain, active_ms);
                }
                add_artifacts(&mut session.artifacts, event);
                session.event_ids.push(event.id);
            }
            continue;
        }

        if let Some(session) = current.take() {
            sessions.push(session);
        }

        let mut app_counts = BTreeMap::new();
        add_count(&mut app_counts, &event.app_name, active_ms);
        let mut domain_counts = BTreeMap::new();
        if let Some(domain) = &event.browser_domain {
            add_count(&mut domain_counts, domain, active_ms);
        }
        let mut artifacts = BTreeSet::new();
        add_artifacts(&mut artifacts, event);

        current = Some(SessionBuilder {
            user_id: event.user_id.clone(),
            device_id: event.device_id.clone(),
            start_ts: event_start,
            end_ts: event_end,
            active_ms,
            classification,
            app_counts,
            domain_counts,
            artifacts,
            event_ids: vec![event.id],
        });
    }

    if let Some(session) = current {
        sessions.push(session);
    }
    sessions
}

fn build_rollups(sessions: &[SessionBuilder]) -> BTreeMap<String, RollupBuilder> {
    let mut rollups = BTreeMap::new();
    for session in sessions {
        let date = local_date(session.start_ts);
        let key = format!(
            "{}:{}:{}:{}",
            session.device_id, date, session.classification.project_key, session.classification.task_key
        );
        let rollup = rollups.entry(key).or_insert_with(|| RollupBuilder {
            user_id: session.user_id.clone(),
            device_id: session.device_id.clone(),
            date,
            project_key: session.classification.project_key.clone(),
            project_name: session.classification.project_name.clone(),
            task_key: session.classification.task_key.clone(),
            task_name: session.classification.task_name.clone(),
            active_ms: 0,
            session_count: 0,
            confidence_sum: 0.0,
            app_counts: BTreeMap::new(),
            domain_counts: BTreeMap::new(),
        });
        rollup.active_ms += session.active_ms;
        rollup.session_count += 1;
        rollup.confidence_sum += session.classification.confidence;
        merge_counts(&mut rollup.app_counts, &session.app_counts);
        merge_counts(&mut rollup.domain_counts, &session.domain_counts);
    }
    rollups
}

fn classify_event(event: &ActivityRow, rules: &[ClassificationRule]) -> Classification {
    for rule in rules {
        if rule_matches(rule, event) {
            return Classification {
                project_key: rule.project_key.clone(),
                project_name: rule.project_name.clone(),
                task_key: rule.task_key.clone(),
                task_name: rule.task_name.clone(),
                source: "user_rule".to_string(),
                confidence: 0.98,
            };
        }
    }

    let app_lower = event.app_bundle_id.to_ascii_lowercase();
    let app_name_lower = event.app_name.to_ascii_lowercase();
    let title = event.window_title.clone().unwrap_or_default();
    let title_lower = title.to_ascii_lowercase();
    let domain = event.browser_domain.clone().unwrap_or_default();
    let domain_lower = domain.to_ascii_lowercase();

    let mut classification = if is_development_app(&app_lower, &app_name_lower) {
        classify_development_event(event, &title)
    } else if is_communication_app_or_domain(&app_lower, &app_name_lower, &domain_lower) {
        named_classification("communication", "Communication", "messages", "Messages", "known_category", 0.82)
    } else if is_research_domain(&domain_lower) {
        named_classification("research", "Research", &slug_or_general(&domain), &domain_or_general(&domain), "domain_category", 0.78)
    } else if is_admin_domain(&domain_lower) || title_lower.contains("settings") || title_lower.contains("billing") {
        named_classification("admin", "Admin", &slug_or_general(&domain), &domain_or_general(&domain), "domain_category", 0.7)
    } else if !domain_lower.is_empty() {
        named_classification(&slug_or_general(&domain), &domain_or_general(&domain), "web", "Web", "domain", 0.58)
    } else if !event.app_name.trim().is_empty() {
        named_classification(
            &slug_or_general(&event.app_name),
            event.app_name.trim(),
            "general",
            "General",
            "app",
            0.52,
        )
    } else {
        unclassified()
    };

    if classification.confidence < MIN_CONFIDENCE {
        classification = unclassified();
    }
    classification
}

fn rule_matches(rule: &ClassificationRule, event: &ActivityRow) -> bool {
    let app = event.app_bundle_id.to_ascii_lowercase();
    let domain = event.browser_domain.clone().unwrap_or_default().to_ascii_lowercase();
    let title = event.window_title.clone().unwrap_or_default().to_ascii_lowercase();
    let haystack = format!("{app} {domain} {title}");

    matcher_matches(&rule.matcher_app_bundle_id, &app)
        && matcher_matches(&rule.matcher_domain, &domain)
        && matcher_matches(&rule.matcher_title_pattern, &title)
        && matcher_matches(&rule.matcher_artifact_pattern, &title)
        && matcher_matches(&rule.matcher_keyword_pattern, &haystack)
}

fn matcher_matches(matcher: &Option<String>, value: &str) -> bool {
    matcher
        .as_ref()
        .map(|needle| !needle.trim().is_empty() && value.contains(needle.trim()))
        .unwrap_or(true)
}

fn classify_development_event(event: &ActivityRow, title: &str) -> Classification {
    let normalized = title
        .replace('\u{2014}', "-")
        .replace('\u{2013}', "-")
        .replace(" | ", " - ");
    let parts = normalized
        .split(" - ")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    let project = parts
        .iter()
        .rev()
        .find(|part| looks_like_project_name(part))
        .copied()
        .or_else(|| parts.get(1).copied())
        .unwrap_or(event.app_name.trim());
    let task = parts
        .first()
        .copied()
        .filter(|part| !looks_like_project_name(part) || looks_like_artifact_name(part))
        .unwrap_or("Development");

    let project_name = title_case_project(project);
    let task_name = clean_label(task);
    named_classification(
        &slug_or_general(&project_name),
        &project_name,
        &slug_or_general(&task_name),
        &task_name,
        "development_signal",
        0.86,
    )
}

fn unclassified() -> Classification {
    named_classification("unclassified", "Unclassified", "general", "General", "unclassified", 0.25)
}

fn named_classification(
    project_key: &str,
    project_name: &str,
    task_key: &str,
    task_name: &str,
    source: &str,
    confidence: f64,
) -> Classification {
    Classification {
        project_key: slug_or_general(project_key),
        project_name: clean_label(project_name),
        task_key: slug_or_general(task_key),
        task_name: clean_label(task_name),
        source: source.to_string(),
        confidence,
    }
}

fn is_development_app(bundle: &str, app: &str) -> bool {
    bundle.contains("cursor")
        || bundle.contains("vscode")
        || bundle.contains("visual-studio-code")
        || bundle.contains("xcode")
        || bundle.contains("intellij")
        || bundle.contains("jetbrains")
        || app.contains("terminal")
        || app.contains("cursor")
        || app.contains("code")
}

fn is_communication_app_or_domain(bundle: &str, app: &str, domain: &str) -> bool {
    bundle.contains("slack")
        || bundle.contains("mail")
        || bundle.contains("messages")
        || bundle.contains("zoom")
        || app.contains("slack")
        || app.contains("mail")
        || app.contains("messages")
        || domain.contains("gmail")
        || domain.contains("mail.google")
        || domain.contains("slack")
        || domain.contains("linear.app")
}

fn is_research_domain(domain: &str) -> bool {
    domain.contains("docs.")
        || domain.contains("developer.")
        || domain.contains("stackoverflow")
        || domain.contains("arxiv")
        || domain.contains("wikipedia")
        || domain.contains("github.com")
}

fn is_admin_domain(domain: &str) -> bool {
    domain.contains("clerk")
        || domain.contains("railway")
        || domain.contains("vercel")
        || domain.contains("turso")
        || domain.contains("stripe")
        || domain.contains("console.")
}

fn looks_like_project_name(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.contains("ritual")
        || value.contains("desktop")
        || value.contains("backend")
        || value.contains("dashboard")
        || value.contains("sync")
        || value.contains("app")
        || value.contains("repo")
        || value.contains('/')
        || value.contains('_')
        || value.contains('-')
}

fn looks_like_artifact_name(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.contains('.')
        && value
            .rsplit('.')
            .next()
            .map(|ext| (1..=8).contains(&ext.len()) && ext.chars().all(|ch| ch.is_ascii_alphanumeric()))
            .unwrap_or(false)
}

fn add_artifacts(artifacts: &mut BTreeSet<String>, event: &ActivityRow) {
    if let Some(title) = &event.window_title {
        for token in title.split_whitespace() {
            let trimmed = token.trim_matches(|ch: char| !ch.is_alphanumeric() && ch != '.' && ch != '_' && ch != '-');
            if trimmed.contains('.') && trimmed.len() <= 80 {
                artifacts.insert(trimmed.to_string());
            }
        }
    }
}

fn add_count(map: &mut BTreeMap<String, i64>, key: &str, amount: i64) {
    let key = key.trim();
    if key.is_empty() {
        return;
    }
    *map.entry(key.to_string()).or_insert(0) += amount;
}

fn merge_counts(target: &mut BTreeMap<String, i64>, source: &BTreeMap<String, i64>) {
    for (key, amount) in source {
        add_count(target, key, *amount);
    }
}

fn counts_json(counts: &BTreeMap<String, i64>) -> String {
    let rows = counts
        .iter()
        .map(|(name, active_ms)| json!({ "name": name, "active_ms": active_ms }))
        .collect::<Vec<_>>();
    serde_json::to_string(&rows).unwrap_or_else(|_| "[]".to_string())
}

fn string_set_json(values: &BTreeSet<String>) -> String {
    serde_json::to_string(&values.iter().take(20).collect::<Vec<_>>())
        .unwrap_or_else(|_| "[]".to_string())
}

fn summary_text(session: &SessionBuilder) -> String {
    let app = session
        .app_counts
        .iter()
        .max_by_key(|(_, amount)| **amount)
        .map(|(name, _)| name.as_str())
        .unwrap_or("computer");
    let summary = format!(
        "{} / {} in {} for {}",
        session.classification.project_name,
        session.classification.task_name,
        app,
        format_duration(session.active_ms)
    );
    summary.chars().take(500).collect()
}

fn session_uid(session: &SessionBuilder) -> String {
    format!(
        "project-session:{}:{}:{}:{}:{}",
        session.device_id,
        session.start_ts,
        session.end_ts,
        session.classification.project_key,
        session.classification.task_key
    )
}

fn clipped_duration(start: i64, end: i64, range_start: i64, range_end: i64) -> i64 {
    end.min(range_end).saturating_sub(start.max(range_start)).max(0)
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn local_date(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ts)
        .unwrap_or_else(Utc::now)
        .with_timezone(&Local)
        .format("%Y-%m-%d")
        .to_string()
}

fn optional_lower(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

fn slug_or_general(value: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        "general".to_string()
    } else {
        slug
    }
}

fn clean_label(value: &str) -> String {
    let cleaned = value
        .trim()
        .trim_matches('-')
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    if cleaned.is_empty() {
        "General".to_string()
    } else {
        cleaned
    }
}

fn title_case_project(value: &str) -> String {
    let cleaned = clean_label(value);
    if cleaned.eq_ignore_ascii_case("ritual-desktop-main") || cleaned.eq_ignore_ascii_case("ritual desktop main") {
        return "Ritual Desktop".to_string();
    }
    cleaned
        .replace('-', " ")
        .replace('_', " ")
        .split_whitespace()
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn domain_or_general(domain: &str) -> String {
    let domain = domain.trim();
    if domain.is_empty() {
        "General".to_string()
    } else {
        domain.to_string()
    }
}

fn format_duration(ms: i64) -> String {
    let minutes = (ms as f64 / 60_000.0).round() as i64;
    if minutes < 60 {
        format!("{minutes}m")
    } else {
        let hours = minutes / 60;
        let rem = minutes % 60;
        if rem == 0 {
            format!("{hours}h")
        } else {
            format!("{hours}h {rem}m")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema;
    use libsql::Builder;
    use tempfile::TempDir;

    async fn test_conn() -> (libsql::Database, Connection, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("project_time.db");
        let db = Builder::new_local(db_path.to_str().unwrap())
            .build()
            .await
            .unwrap();
        let conn = db.connect().unwrap();
        schema::initialize_schema(&conn).await.unwrap();
        (db, conn, temp_dir)
    }

    async fn insert_event(conn: &Connection, id: i64, start: i64, end: i64, app: &str, title: &str) {
        conn.execute(
            r#"
            INSERT INTO activity_events (
                id, event_uid, device_id, user_id, ts_start, ts_end,
                app_bundle_id, app_name, window_title, is_afk, source, created_at
            ) VALUES (?, ?, 'device-1', 'user-1', ?, ?, 'com.todesktop.230313mzl4w4u92', ?, ?, 0, 'test', ?)
            "#,
            libsql::params![id, format!("event-{id}"), start, end, app, title, start],
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn recompute_preserves_active_time_and_writes_rollups() {
        let (_db, conn, _temp) = test_conn().await;
        insert_event(&conn, 1, 1_700_000_000_000, 1_700_000_600_000, "Cursor", "project_time.rs - ritual-desktop-main - Modified").await;
        insert_event(&conn, 2, 1_700_000_610_000, 1_700_001_000_000, "Cursor", "cloud_sync.rs - ritual-desktop-main - Modified").await;

        let result = ProjectTimeOps::new(&conn)
            .recompute_range(1_700_000_000_000, 1_700_002_000_000, Some("user-1"), Some("device-1"))
            .await
            .unwrap();

        assert_eq!(result.active_ms_from_events, 990_000);
        assert_eq!(result.active_ms_attributed, 990_000);
        assert_eq!(result.active_ms_delta, 0);
        assert_eq!(result.sessions_written, 2);
        assert!(result.rollups_written >= 1);
    }

    #[tokio::test]
    async fn user_rules_override_inferred_labels() {
        let (_db, conn, _temp) = test_conn().await;
        conn.execute(
            r#"
            INSERT INTO project_classification_rules (
                rule_uid, user_id, matcher_domain, project_key, project_name,
                task_key, task_name, priority, enabled, created_at, updated_at
            ) VALUES ('rule-1', 'user-1', 'github.com', 'ritual', 'Ritual', 'review', 'Code Review', 1, 1, 1, 1)
            "#,
            (),
        )
        .await
        .unwrap();
        conn.execute(
            r#"
            INSERT INTO activity_events (
                id, event_uid, device_id, user_id, ts_start, ts_end,
                app_bundle_id, app_name, window_title, browser_domain, is_afk, source, created_at
            ) VALUES (1, 'event-1', 'device-1', 'user-1', 1000, 2000, 'com.apple.Safari', 'Safari', 'Pull request', 'github.com', 0, 'test', 1000)
            "#,
            (),
        )
        .await
        .unwrap();

        ProjectTimeOps::new(&conn)
            .recompute_range(0, 3000, Some("user-1"), Some("device-1"))
            .await
            .unwrap();

        let mut rows = conn
            .query("SELECT project_name, task_name FROM project_time_sessions", ())
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<String>(0).unwrap(), "Ritual");
        assert_eq!(row.get::<String>(1).unwrap(), "Code Review");
    }

    #[tokio::test]
    async fn raw_context_rows_do_not_enqueue_cloud_sync() {
        let (_db, conn, _temp) = test_conn().await;
        conn.execute(
            r#"
            INSERT INTO context_snapshots (
                device_id, user_id, ts, source_type, app_bundle_id, app_name,
                visible_text_raw, visible_text_norm, capture_quality,
                ax_richness_score, dedup_key, created_at, updated_at
            ) VALUES ('device-1', 'user-1', 1000, 'ax', 'app', 'App', 'raw', 'raw', 1.0, 1.0, 'dedup-1', 1000, 1000)
            "#,
            (),
        )
        .await
        .unwrap();
        let mut rows = conn
            .query(
                "SELECT COUNT(*) FROM cloud_sync_outbox WHERE entity_type = 'context_snapshot'",
                (),
            )
            .await
            .unwrap();
        let row = rows.next().await.unwrap().unwrap();
        assert_eq!(row.get::<i64>(0).unwrap(), 0);
    }
}
