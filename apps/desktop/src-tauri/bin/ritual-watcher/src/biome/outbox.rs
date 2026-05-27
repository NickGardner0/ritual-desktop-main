//! JSONL outbox for normalized Biome iPhone activity events.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;

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
}

impl BiomeActivityEvent {
    pub fn key(&self) -> String {
        self.event_uid.clone().unwrap_or_else(|| {
            format!(
                "{}:{}:{}:{}",
                self.device_id, self.app_bundle_id, self.ts_start, self.ts_end
            )
        })
    }
}

pub struct BiomeOutbox {
    path: PathBuf,
    inner: Mutex<Vec<BiomeActivityEvent>>,
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
            read_jsonl(&path).unwrap_or_default()
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
            if keys.insert(event.key()) {
                guard.push(event);
                added += 1;
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
        self.inner.lock().expect("biome outbox mutex poisoned").clone()
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

fn read_jsonl(path: &PathBuf) -> io::Result<Vec<BiomeActivityEvent>> {
    let raw = fs::read_to_string(path)?;
    let mut events = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let event = serde_json::from_str::<BiomeActivityEvent>(trimmed)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        events.push(event);
    }
    Ok(events)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn isolated_path() -> PathBuf {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let tmp = env::temp_dir()
            .join(format!("ritual-biome-outbox-test-{}-{}", std::process::id(), n));
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
        }
    }

    #[test]
    fn enqueue_many_persists_and_dedupes() {
        let path = isolated_path();
        let outbox = BiomeOutbox::load_from(path.clone()).unwrap();
        let added = outbox
            .enqueue_many(vec![event("a"), event("a"), event("b")])
            .unwrap();
        assert_eq!(added, 2);
        let reopened = BiomeOutbox::load_from(path).unwrap();
        assert_eq!(reopened.snapshot().len(), 2);
    }
}
