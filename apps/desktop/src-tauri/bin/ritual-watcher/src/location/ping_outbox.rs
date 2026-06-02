//! Disk-backed outbox of LocationPing JSON objects.
//!
//! Writes to `~/Library/Application Support/Ritual/location_outbox.json`.
//! Uses a simple JSON-array format that can be appended to atomically by
//! reading-modifying-writing the whole file (good enough for a few hundred
//! pings per day; we're not log-shipping at TB scale).
//!
//! Drainage is the responsibility of a separate process (the main Tauri
//! app), which reads the file, batches the contents to
//! POST /api/user/location-pings, and truncates on success.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;

/// Mirrors `services/location/models.LocationPing` on the backend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocationPing {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub horizontal_accuracy_m: Option<f64>,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bssid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssid: Option<String>,
    pub client_ts: i64,
    pub client_event_id: String,
}

const MAX_OUTBOX_PINGS: usize = 2_000;

pub struct PingOutbox {
    path: PathBuf,
    inner: Mutex<Vec<LocationPing>>,
}

impl PingOutbox {
    /// Open (or create) the outbox at the standard path.
    pub fn load() -> io::Result<Self> {
        Self::load_from(outbox_path())
    }

    /// Open (or create) the outbox at an explicit path. Test-friendly.
    pub fn load_from(path: PathBuf) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let pings = if path.exists() {
            match fs::read_to_string(&path) {
                Ok(s) if !s.trim().is_empty() => {
                    serde_json::from_str::<Vec<LocationPing>>(&s).unwrap_or_default()
                }
                _ => Vec::new(),
            }
        } else {
            Vec::new()
        };
        Ok(Self {
            path,
            inner: Mutex::new(pings),
        })
    }

    /// Append a single ping. Persists to disk immediately.
    pub fn enqueue(&self, ping: LocationPing) -> io::Result<()> {
        let mut guard = self.inner.lock().expect("ping outbox mutex poisoned");
        guard.push(ping);
        if guard.len() > MAX_OUTBOX_PINGS {
            let overflow = guard.len() - MAX_OUTBOX_PINGS;
            guard.drain(0..overflow); // drop oldest
        }
        let json = serde_json::to_string(&*guard)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        write_atomic(&self.path, &json)
    }

    /// Read a snapshot of pending pings (used by a follow-up drainer process).
    pub fn snapshot(&self) -> Vec<LocationPing> {
        self.inner.lock().expect("ping outbox mutex poisoned").clone()
    }

    /// Remove specified pings by client_event_id. Called after successful POST.
    pub fn drain(&self, submitted_event_ids: &[String]) -> io::Result<()> {
        let mut guard = self.inner.lock().expect("ping outbox mutex poisoned");
        let submitted: std::collections::HashSet<&str> =
            submitted_event_ids.iter().map(String::as_str).collect();
        guard.retain(|p| !submitted.contains(p.client_event_id.as_str()));
        let json = serde_json::to_string(&*guard)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        write_atomic(&self.path, &json)
    }

    pub fn count(&self) -> usize {
        self.inner.lock().expect("ping outbox mutex poisoned").len()
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

fn outbox_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("Ritual")
        .join("location_outbox.json")
}

/// Atomic file write: write to .tmp then rename.
fn write_atomic(path: &PathBuf, contents: &str) -> io::Result<()> {
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, contents)?;
    fs::rename(&tmp_path, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Build a PingOutbox rooted at a unique tmp dir per test. We avoid
    /// `env::set_var("HOME", ...)` because that's process-global and would
    /// race across parallel tests. Instead, we construct the outbox manually
    /// with an explicit path.
    fn isolated_outbox() -> PingOutbox {
        let n = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let tmp = env::temp_dir()
            .join(format!("ritual-loc-test-{}-{}", std::process::id(), n));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("create test dir");
        let path = tmp.join("location_outbox.json");
        PingOutbox {
            path,
            inner: Mutex::new(Vec::new()),
        }
    }

    fn make_ping(id: &str, ts: i64) -> LocationPing {
        LocationPing {
            lat: Some(40.7),
            lon: Some(-74.0),
            horizontal_accuracy_m: Some(20.0),
            source: "mac_one_shot".into(),
            device_id: Some("test-device".into()),
            bssid: Some("aa:bb:cc:dd:ee:ff".into()),
            ssid: Some("TestNet".into()),
            client_ts: ts,
            client_event_id: id.into(),
        }
    }

    #[test]
    fn enqueue_persists() {
        let outbox = isolated_outbox();
        outbox.enqueue(make_ping("a", 1)).unwrap();
        outbox.enqueue(make_ping("b", 2)).unwrap();
        assert_eq!(outbox.count(), 2);
        // Reopen at the same path and verify on-disk persistence
        let reopened = PingOutbox::load_from(outbox.path().clone()).unwrap();
        assert_eq!(reopened.count(), 2);
        let snap = reopened.snapshot();
        let ids: Vec<&str> = snap.iter().map(|p| p.client_event_id.as_str()).collect();
        assert!(ids.contains(&"a"));
        assert!(ids.contains(&"b"));
    }

    #[test]
    fn drain_removes_by_event_id() {
        let outbox = isolated_outbox();
        outbox.enqueue(make_ping("x", 10)).unwrap();
        outbox.enqueue(make_ping("y", 20)).unwrap();
        outbox.enqueue(make_ping("z", 30)).unwrap();
        assert_eq!(outbox.count(), 3);
        outbox.drain(&["y".to_string()]).unwrap();
        assert_eq!(outbox.count(), 2);
        let snap = outbox.snapshot();
        assert!(snap.iter().all(|p| p.client_event_id != "y"));
    }

    #[test]
    fn cap_drops_oldest() {
        let outbox = isolated_outbox();
        // Push more than MAX_OUTBOX_PINGS to force eviction (use a small loop)
        for i in 0..(MAX_OUTBOX_PINGS + 10) {
            outbox.enqueue(make_ping(&format!("e{}", i), i as i64)).unwrap();
        }
        assert_eq!(outbox.count(), MAX_OUTBOX_PINGS);
        // Oldest (e0) should be gone
        let snap = outbox.snapshot();
        assert!(snap.iter().all(|p| p.client_event_id != "e0"));
    }
}
