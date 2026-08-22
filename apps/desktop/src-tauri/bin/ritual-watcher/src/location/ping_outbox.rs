//! SQLite-backed outbox of LocationPing JSON objects.
//!
//! New production writes append to the shared activity database. On first
//! load, the watcher transactionally copies the legacy JSON-array outbox into
//! SQLite and archives the source only after every valid row is durable.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;

use ritual_db::{blocking::BlockingDatabase, DeliveryOutboxKind};

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
    database: Option<BlockingDatabase>,
}

#[derive(Debug, PartialEq, Eq)]
enum LegacyLocationMigration {
    NotPresent,
    Imported { records: usize, archive: PathBuf },
    Quarantined { quarantine: PathBuf },
}

fn migrate_legacy_location_file(
    path: &PathBuf,
    database: &BlockingDatabase,
) -> io::Result<LegacyLocationMigration> {
    if !path.exists() {
        return Ok(LegacyLocationMigration::NotPresent);
    }
    let raw = fs::read_to_string(path)?;
    let pings = match serde_json::from_str::<Vec<LocationPing>>(&raw) {
        Ok(pings) => pings,
        Err(_) => {
            let quarantine = path.with_extension("json.malformed");
            fs::rename(path, &quarantine)?;
            return Ok(LegacyLocationMigration::Quarantined { quarantine });
        }
    };

    // INSERT OR IGNORE makes a retry after commit-but-before-rename safe, while
    // the batch transaction prevents a partially copied legacy file.
    let records = pings
        .iter()
        .map(|ping| {
            serde_json::to_string(ping)
                .map(|payload| (ping.client_event_id.clone(), payload))
                .map_err(|error| io::Error::new(io::ErrorKind::Other, error))
        })
        .collect::<io::Result<Vec<_>>>()?;
    database
        .enqueue_delivery_outbox_batch(DeliveryOutboxKind::Location, &records)
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
    let archive = path.with_extension("json.migrated");
    fs::rename(path, &archive)?;
    Ok(LegacyLocationMigration::Imported {
        records: pings.len(),
        archive,
    })
}

impl PingOutbox {
    /// Open (or create) the outbox at the standard path.
    pub fn load() -> io::Result<Self> {
        let path = outbox_path();
        let database_path = crate::paths::data_dir().join("activity.db");
        let database = BlockingDatabase::open_activity_db_with_env(database_path)
            .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
        migrate_legacy_location_file(&path, &database)?;
        Ok(Self {
            path,
            inner: Mutex::new(Vec::new()),
            database: Some(database),
        })
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
            database: None,
        })
    }

    /// Append a single ping. Persists to disk immediately.
    pub fn enqueue(&self, ping: LocationPing) -> io::Result<()> {
        if let Some(database) = &self.database {
            let payload = serde_json::to_string(&ping)
                .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?;
            database
                .enqueue_delivery_outbox(
                    DeliveryOutboxKind::Location,
                    &ping.client_event_id,
                    &payload,
                )
                .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
            return Ok(());
        }
        let mut guard = self.inner.lock().expect("ping outbox mutex poisoned");
        guard.push(ping);
        if guard.len() > MAX_OUTBOX_PINGS {
            let overflow = guard.len() - MAX_OUTBOX_PINGS;
            guard.drain(0..overflow); // drop oldest
        }
        let json =
            serde_json::to_string(&*guard).map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        write_atomic(&self.path, &json)
    }

    /// Read a snapshot of pending pings (used by a follow-up drainer process).
    pub fn snapshot(&self) -> Vec<LocationPing> {
        self.inner
            .lock()
            .expect("ping outbox mutex poisoned")
            .clone()
    }

    /// Remove specified pings by client_event_id. Called after successful POST.
    pub fn drain(&self, submitted_event_ids: &[String]) -> io::Result<()> {
        let mut guard = self.inner.lock().expect("ping outbox mutex poisoned");
        let submitted: std::collections::HashSet<&str> =
            submitted_event_ids.iter().map(String::as_str).collect();
        guard.retain(|p| !submitted.contains(p.client_event_id.as_str()));
        let json =
            serde_json::to_string(&*guard).map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        write_atomic(&self.path, &json)
    }

    pub fn count(&self) -> usize {
        if let Some(database) = &self.database {
            return database
                .delivery_outbox_count(DeliveryOutboxKind::Location)
                .unwrap_or(0)
                .max(0) as usize;
        }
        self.inner.lock().expect("ping outbox mutex poisoned").len()
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

fn outbox_path() -> PathBuf {
    crate::paths::auxiliary_data_dir().join("location_outbox.json")
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
        let tmp = env::temp_dir().join(format!("ritual-loc-test-{}-{}", std::process::id(), n));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("create test dir");
        let path = tmp.join("location_outbox.json");
        PingOutbox {
            path,
            inner: Mutex::new(Vec::new()),
            database: None,
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
            outbox
                .enqueue(make_ping(&format!("e{}", i), i as i64))
                .unwrap();
        }
        assert_eq!(outbox.count(), MAX_OUTBOX_PINGS);
        // Oldest (e0) should be gone
        let snap = outbox.snapshot();
        assert!(snap.iter().all(|p| p.client_event_id != "e0"));
    }

    #[test]
    fn legacy_file_is_copied_to_sqlite_before_it_is_archived() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("location_outbox.json");
        let pings = vec![make_ping("legacy-a", 1), make_ping("legacy-b", 2)];
        fs::write(&path, serde_json::to_vec(&pings).unwrap()).expect("write legacy file");
        let database = BlockingDatabase::open_activity_db_with_env(temp.path().join("activity.db"))
            .expect("open activity database");

        let result = migrate_legacy_location_file(&path, &database).expect("migrate legacy file");
        let archive = path.with_extension("json.migrated");
        assert_eq!(
            result,
            LegacyLocationMigration::Imported {
                records: 2,
                archive: archive.clone(),
            }
        );
        assert!(!path.exists());
        assert!(archive.exists());
        assert_eq!(
            database
                .delivery_outbox_count(DeliveryOutboxKind::Location)
                .unwrap(),
            2
        );
    }

    #[test]
    fn malformed_legacy_file_is_quarantined_without_inserting_rows() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("location_outbox.json");
        fs::write(&path, "[{not-json]").expect("write malformed legacy file");
        let database = BlockingDatabase::open_activity_db_with_env(temp.path().join("activity.db"))
            .expect("open activity database");

        let result =
            migrate_legacy_location_file(&path, &database).expect("quarantine legacy file");
        let quarantine = path.with_extension("json.malformed");
        assert_eq!(
            result,
            LegacyLocationMigration::Quarantined {
                quarantine: quarantine.clone(),
            }
        );
        assert!(!path.exists());
        assert!(quarantine.exists());
        assert_eq!(
            database
                .delivery_outbox_count(DeliveryOutboxKind::Location)
                .unwrap(),
            0
        );
    }
}
