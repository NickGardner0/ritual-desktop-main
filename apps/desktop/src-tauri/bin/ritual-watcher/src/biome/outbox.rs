//! JSONL outbox for normalized Biome iPhone activity events.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_OUTBOX_EVENTS: usize = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BiomeActivityEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_uid: Option<String>,
    pub device_id: String,
    pub app_bundle_id: String,
    pub app_name: String,
    pub ts_start: i64,
    pub ts_end: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_domain: Option<String>,
    #[serde(default)]
    pub is_incognito: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_build: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transition_reason: Option<String>,
    #[serde(default)]
    pub biome_is_provisional: bool,
}

impl BiomeActivityEvent {
    pub fn key(&self) -> String {
        format!(
            "biome:{}:{}:{}",
            self.device_id, self.app_bundle_id, self.ts_start
        )
    }

    fn merge_from(&mut self, incoming: BiomeActivityEvent) -> bool {
        let mut changed = false;
        if incoming.ts_end > self.ts_end {
            self.ts_end = incoming.ts_end;
            changed = true;
        }
        if self.biome_is_provisional && !incoming.biome_is_provisional {
            self.biome_is_provisional = false;
            changed = true;
        }
        if self.window_title.is_none() && incoming.window_title.is_some() {
            self.window_title = incoming.window_title;
            changed = true;
        }
        if self.browser_url.is_none() && incoming.browser_url.is_some() {
            self.browser_url = incoming.browser_url;
            changed = true;
        }
        if self.browser_domain.is_none() && incoming.browser_domain.is_some() {
            self.browser_domain = incoming.browser_domain;
            changed = true;
        }
        if self.transition_reason.is_none() && incoming.transition_reason.is_some() {
            self.transition_reason = incoming.transition_reason;
            changed = true;
        }
        if self.source_file.is_none() && incoming.source_file.is_some() {
            self.source_file = incoming.source_file;
            changed = true;
        }
        changed
    }
}

pub struct BiomeOutbox {
    path: PathBuf,
    inner: Mutex<Vec<BiomeActivityEvent>>,
}

struct JsonlRead {
    events: Vec<BiomeActivityEvent>,
    malformed_lines: Vec<String>,
}

impl BiomeOutbox {
    pub fn load() -> io::Result<Self> {
        Self::load_from(outbox_path())
    }

    pub fn load_from(path: PathBuf) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let events = if path.exists() {
            let read = read_jsonl(&path)?;
            let raw_event_count = read.events.len();
            let events = dedupe_events(read.events);
            if !read.malformed_lines.is_empty() {
                quarantine_malformed(&path, &read.malformed_lines)?;
            }
            if !read.malformed_lines.is_empty() || events.len() != raw_event_count {
                write_jsonl(&path, &events)?;
            }
            events
        } else {
            Vec::new()
        };
        Ok(Self {
            path,
            inner: Mutex::new(events),
        })
    }

    pub fn enqueue_many(&self, events: Vec<BiomeActivityEvent>) -> io::Result<usize> {
        if events.is_empty() {
            return Ok(0);
        }
        let mut guard = self.inner.lock().expect("biome outbox mutex poisoned");
        let mut keys: HashSet<String> = guard.iter().map(BiomeActivityEvent::key).collect();
        let mut added = 0usize;
        for event in events {
            let key = event.key();
            if keys.insert(key.clone()) {
                guard.push(event);
                added += 1;
            } else if let Some(existing) = guard.iter_mut().find(|candidate| candidate.key() == key)
            {
                existing.merge_from(event);
            }
        }
        if guard.len() > MAX_OUTBOX_EVENTS {
            let overflow = guard.len() - MAX_OUTBOX_EVENTS;
            guard.drain(0..overflow);
        }
        write_jsonl(&self.path, &guard)?;
        Ok(added)
    }

    pub fn snapshot(&self) -> Vec<BiomeActivityEvent> {
        self.inner
            .lock()
            .expect("biome outbox mutex poisoned")
            .clone()
    }
}

pub fn outbox_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Ritual")
        .join("biome_iphone_events.jsonl")
}

fn read_jsonl(path: &PathBuf) -> io::Result<JsonlRead> {
    let raw = fs::read_to_string(path)?;
    let mut events = Vec::new();
    let mut malformed_lines = Vec::new();
    for (index, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<BiomeActivityEvent>(trimmed) {
            Ok(event) => events.push(event),
            Err(error) => malformed_lines.push(format!(
                "{{\"line\":{},\"error\":{},\"raw\":{}}}",
                index + 1,
                serde_json::to_string(&error.to_string())
                    .unwrap_or_else(|_| "\"parse error\"".to_string()),
                serde_json::to_string(trimmed).unwrap_or_else(|_| "\"\"".to_string())
            )),
        }
    }
    Ok(JsonlRead {
        events,
        malformed_lines,
    })
}

fn write_jsonl(path: &PathBuf, events: &[BiomeActivityEvent]) -> io::Result<()> {
    let mut body = String::new();
    for event in events {
        let line = serde_json::to_string(event)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        body.push_str(&line);
        body.push('\n');
    }
    let tmp = path.with_extension("jsonl.tmp");
    fs::write(&tmp, body)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn dedupe_events(events: Vec<BiomeActivityEvent>) -> Vec<BiomeActivityEvent> {
    let mut output: Vec<BiomeActivityEvent> = Vec::new();
    for event in events {
        let key = event.key();
        if let Some(existing) = output.iter_mut().find(|candidate| candidate.key() == key) {
            existing.merge_from(event);
        } else {
            output.push(event);
        }
    }
    output
}

fn quarantine_malformed(path: &PathBuf, malformed_lines: &[String]) -> io::Result<()> {
    if malformed_lines.is_empty() {
        return Ok(());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("biome_iphone_events.jsonl");
    let quarantine = path.with_file_name(format!("{file_name}.malformed.{stamp}.jsonl"));
    let mut body = malformed_lines.join("\n");
    body.push('\n');
    fs::write(quarantine, body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn isolated_path() -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let tmp = env::temp_dir().join(format!(
            "ritual-biome-outbox-test-{}-{}",
            std::process::id(),
            n
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("create test dir");
        tmp.join("biome_iphone_events.jsonl")
    }

    fn event(id: &str) -> BiomeActivityEvent {
        BiomeActivityEvent {
            event_uid: Some(id.to_string()),
            device_id: "iphone".to_string(),
            app_bundle_id: "com.apple.MobileSMS".to_string(),
            app_name: "Messages".to_string(),
            ts_start: 100,
            ts_end: 200,
            window_title: Some("Messages".to_string()),
            browser_url: None,
            browser_domain: None,
            is_incognito: false,
            source_file: Some("iphone/file".to_string()),
            app_version: None,
            app_build: None,
            transition_reason: None,
            biome_is_provisional: false,
        }
    }

    #[test]
    fn enqueue_many_persists_and_dedupes() {
        let path = isolated_path();
        let outbox = BiomeOutbox::load_from(path.clone()).unwrap();
        let added = outbox
            .enqueue_many(vec![event("a"), event("a"), event("b")])
            .unwrap();
        assert_eq!(added, 1);
        let reopened = BiomeOutbox::load_from(path).unwrap();
        assert_eq!(reopened.snapshot().len(), 1);
    }

    #[test]
    fn enqueue_many_extends_existing_stable_key() {
        let path = isolated_path();
        let outbox = BiomeOutbox::load_from(path.clone()).unwrap();
        let mut first = event("old-style-a");
        first.ts_end = 200;
        first.biome_is_provisional = true;
        let mut second = event("old-style-b");
        second.ts_end = 400;
        second.biome_is_provisional = false;

        let added = outbox.enqueue_many(vec![first, second]).unwrap();
        assert_eq!(added, 1);

        let snapshot = outbox.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].ts_end, 400);
        assert!(!snapshot[0].biome_is_provisional);
    }

    #[test]
    fn load_from_quarantines_malformed_rows_without_dropping_valid_events() {
        let path = isolated_path();
        let first = serde_json::to_string(&event("first")).unwrap();
        let second = serde_json::to_string(&event("second")).unwrap();
        fs::write(&path, format!("{first}\n{{bad-json\n{second}\n")).unwrap();

        let outbox = BiomeOutbox::load_from(path.clone()).unwrap();

        assert_eq!(outbox.snapshot().len(), 1);
        let rewritten = fs::read_to_string(&path).unwrap();
        assert!(rewritten.contains("Messages"));
        assert!(!rewritten.contains("bad-json"));
        let quarantine_count = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".malformed.")
            })
            .count();
        assert_eq!(quarantine_count, 1);
    }
}
