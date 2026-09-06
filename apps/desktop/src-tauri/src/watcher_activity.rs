use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub(crate) const MAX_SINGLE_ACTIVITY_EVENT_MS: i64 = 15 * 60 * 1000;

/// Detailed activity event from local database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetailedActivityEvent {
    pub id: i64,
    pub ts_start: i64,
    pub ts_end: i64,
    pub duration_ms: i64,
    pub app_bundle_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub browser_url: Option<String>,
    pub browser_domain: Option<String>,
    pub is_afk: bool,
    pub is_incognito: bool,
}

impl From<ritual_db::ActivityEvent> for DetailedActivityEvent {
    fn from(e: ritual_db::ActivityEvent) -> Self {
        Self {
            id: e.id.unwrap_or(0),
            ts_start: e.ts_start,
            ts_end: e.ts_end,
            duration_ms: e.ts_end.saturating_sub(e.ts_start),
            app_bundle_id: e.app_bundle_id,
            app_name: e.app_name,
            window_title: e.window_title,
            browser_url: e.browser_url,
            browser_domain: e.browser_domain,
            is_afk: e.is_afk,
            is_incognito: e.is_incognito,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct RangeSummary {
    pub active_ms: i64,
    pub afk_ms: i64,
    pub app_count: i64,
    pub domain_count: i64,
    pub event_count: i64,
}

pub(crate) fn clip_interval(
    event: &ritual_db::ActivityEvent,
    range_start: i64,
    range_end: i64,
) -> Option<(i64, i64)> {
    let event_end = if event.ts_end.saturating_sub(event.ts_start) > MAX_SINGLE_ACTIVITY_EVENT_MS {
        event.ts_start.saturating_add(MAX_SINGLE_ACTIVITY_EVENT_MS)
    } else {
        event.ts_end
    };
    let start = event.ts_start.max(range_start);
    let end = event_end.min(range_end);
    if end > start {
        Some((start, end))
    } else {
        None
    }
}

pub(crate) fn merge_intervals(mut intervals: Vec<(i64, i64)>) -> Vec<(i64, i64)> {
    if intervals.is_empty() {
        return Vec::new();
    }

    intervals.sort_by_key(|(start, _)| *start);
    let mut merged: Vec<(i64, i64)> = Vec::with_capacity(intervals.len());
    let mut current = intervals[0];

    for (start, end) in intervals.into_iter().skip(1) {
        if start <= current.1 {
            current.1 = current.1.max(end);
        } else {
            merged.push(current);
            current = (start, end);
        }
    }

    merged.push(current);
    merged
}

pub(crate) fn total_interval_ms(intervals: Vec<(i64, i64)>) -> i64 {
    merge_intervals(intervals)
        .into_iter()
        .map(|(start, end)| end.saturating_sub(start))
        .sum()
}

pub(crate) fn build_range_summary(
    events: &[ritual_db::ActivityEvent],
    range_start: i64,
    range_end: i64,
) -> RangeSummary {
    let mut active_intervals = Vec::new();
    let mut afk_intervals = Vec::new();
    let mut app_keys = HashSet::new();
    let mut domains = HashSet::new();
    let mut event_count = 0_i64;

    for event in events {
        let Some((start, end)) = clip_interval(event, range_start, range_end) else {
            continue;
        };

        event_count += 1;

        if event.is_afk {
            afk_intervals.push((start, end));
            continue;
        }

        active_intervals.push((start, end));

        let app_key = if event.app_bundle_id.is_empty() {
            event.app_name.clone()
        } else {
            event.app_bundle_id.clone()
        };
        if !app_key.is_empty() {
            app_keys.insert(app_key);
        }

        if let Some(domain) = event.browser_domain.as_ref() {
            if !domain.is_empty() && !event.is_incognito {
                domains.insert(domain.clone());
            }
        }
    }

    RangeSummary {
        active_ms: total_interval_ms(active_intervals),
        afk_ms: total_interval_ms(afk_intervals),
        app_count: app_keys.len() as i64,
        domain_count: domains.len() as i64,
        event_count,
    }
}

pub(crate) fn build_app_summaries(
    events: &[ritual_db::ActivityEvent],
    range_start: i64,
    range_end: i64,
) -> Vec<AppActivitySummary> {
    let mut grouped: HashMap<String, (String, Vec<(i64, i64)>, i64)> = HashMap::new();

    for event in events {
        if event.is_afk {
            continue;
        }
        let Some((start, end)) = clip_interval(event, range_start, range_end) else {
            continue;
        };

        let key = if event.app_bundle_id.is_empty() {
            event.app_name.clone()
        } else {
            event.app_bundle_id.clone()
        };
        if key.is_empty() {
            continue;
        }

        let entry = grouped
            .entry(key.clone())
            .or_insert_with(|| (event.app_name.clone(), Vec::new(), 0));
        if entry.0.is_empty() {
            entry.0 = event.app_name.clone();
        }
        entry.1.push((start, end));
        entry.2 += 1;
    }

    let mut rows: Vec<AppActivitySummary> = grouped
        .into_iter()
        .map(
            |(key, (app_name, intervals, event_count))| AppActivitySummary {
                app_bundle_id: key,
                app_name,
                total_duration_ms: total_interval_ms(intervals),
                event_count,
            },
        )
        .filter(|row| row.total_duration_ms > 0)
        .collect();

    rows.sort_by(|a, b| {
        b.total_duration_ms
            .cmp(&a.total_duration_ms)
            .then_with(|| a.app_name.cmp(&b.app_name))
    });
    rows
}

pub(crate) fn build_domain_summaries(
    events: &[ritual_db::ActivityEvent],
    range_start: i64,
    range_end: i64,
) -> Vec<DomainActivitySummary> {
    let mut grouped: HashMap<String, (Vec<(i64, i64)>, i64)> = HashMap::new();

    for event in events {
        if event.is_afk || event.is_incognito {
            continue;
        }
        let Some(domain) = event.browser_domain.as_ref() else {
            continue;
        };
        if domain.is_empty() {
            continue;
        }
        let Some((start, end)) = clip_interval(event, range_start, range_end) else {
            continue;
        };

        let entry = grouped
            .entry(domain.clone())
            .or_insert_with(|| (Vec::new(), 0));
        entry.0.push((start, end));
        entry.1 += 1;
    }

    let mut rows: Vec<DomainActivitySummary> = grouped
        .into_iter()
        .map(|(domain, (intervals, event_count))| DomainActivitySummary {
            domain,
            total_duration_ms: total_interval_ms(intervals),
            event_count,
        })
        .filter(|row| row.total_duration_ms > 0)
        .collect();

    rows.sort_by(|a, b| {
        b.total_duration_ms
            .cmp(&a.total_duration_ms)
            .then_with(|| a.domain.cmp(&b.domain))
    });
    rows
}

/// Summary of activity by app
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppActivitySummary {
    pub app_bundle_id: String,
    pub app_name: String,
    pub total_duration_ms: i64,
    pub event_count: i64,
}

/// Summary of activity by domain
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainActivitySummary {
    pub domain: String,
    pub total_duration_ms: i64,
    pub event_count: i64,
}

/// Response for detailed activity query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetailedActivityResponse {
    pub events: Vec<DetailedActivityEvent>,
    pub apps: Vec<AppActivitySummary>,
    pub domains: Vec<DomainActivitySummary>,
    pub total_active_ms: i64,
    pub total_afk_ms: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_event(ts_start: i64, ts_end: i64, is_afk: bool) -> ritual_db::ActivityEvent {
        ritual_db::ActivityEvent {
            id: None,
            event_uid: format!("event-{ts_start}-{ts_end}-{is_afk}"),
            device_id: "device".to_string(),
            user_id: "user".to_string(),
            ts_start,
            ts_end,
            app_bundle_id: "com.test.app".to_string(),
            app_name: "Test App".to_string(),
            window_title: None,
            window_title_hash: None,
            window_owner_pid: None,
            is_afk,
            browser_url: None,
            browser_domain: Some("example.com".to_string()),
            is_incognito: false,
            source: "ritual_watcher_v2".to_string(),
            created_at: 0,
        }
    }

    #[test]
    fn range_summary_clamps_abnormally_long_events() {
        let events = vec![test_event(0, 8 * 60 * 60 * 1000, false)];

        let summary = build_range_summary(&events, 0, 24 * 60 * 60 * 1000);

        assert_eq!(summary.active_ms, MAX_SINGLE_ACTIVITY_EVENT_MS);
        assert_eq!(summary.event_count, 1);
    }

    #[test]
    fn range_summary_does_not_count_range_after_clamped_event_end() {
        let events = vec![test_event(0, 8 * 60 * 60 * 1000, false)];

        let summary = build_range_summary(&events, 60 * 60 * 1000, 2 * 60 * 60 * 1000);

        assert_eq!(summary.active_ms, 0);
        assert_eq!(summary.event_count, 0);
    }

    #[test]
    fn range_summary_deoverlaps_active_intervals() {
        let events = vec![
            test_event(0, 10 * 60 * 1000, false),
            test_event(5 * 60 * 1000, 20 * 60 * 1000, false),
        ];

        let summary = build_range_summary(&events, 0, 60 * 60 * 1000);

        assert_eq!(summary.active_ms, 20 * 60 * 1000);
        assert_eq!(summary.event_count, 2);
    }
}
