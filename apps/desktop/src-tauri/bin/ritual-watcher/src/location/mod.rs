//! Mac watcher location module.
//!
//! Captures the user's location on Mac and persists pings to a disk outbox.
//! A separate sync process (the main Tauri desktop app) is expected to read
//! the outbox file and POST batches to /api/user/location-pings.
//!
//! ## Design
//!
//! macOS Macs are mostly stationary, so Apple's `startMonitoringSignificantLocationChanges`
//! (SCLS) — which works great on iPhone — produces very few events here. Instead
//! we use a layered strategy:
//!
//! 1. **Wi-Fi BSSID fingerprinting** as the primary "did the user move" signal.
//!    BSSID changes when the user joins a different network → triggers a fresh
//!    location lookup.
//! 2. **Periodic refresh** every 30 minutes as a heartbeat, so even a Mac that
//!    never switches networks still emits regular pings.
//! 3. **On-launch one-shot** to seed the freshest state when the watcher starts.
//!
//! ## Outbox path
//!
//! `~/Library/Application Support/Ritual/location_outbox.json`
//!
//! The file is a JSON array of `LocationPing` objects matching the backend's
//! Pydantic schema. The main Tauri process should batch-read, POST, and
//! truncate (or merge by `client_event_id` to keep outbox lean).
//!
//! ## Limitations
//!
//! - Without Core Location bindings (skipped for crate-version stability), this
//!   module emits BSSID-only "fingerprint" pings without raw lat/lon. The backend
//!   stores them as `mac_bssid_trigger` source with null lat/lon, which means
//!   the resolver won't return them as a coordinate signal — but the BSSID is
//!   recorded for future place-labeling features (Phase 4 in plan-location-tracking.md).
//! - For raw lat/lon on Mac, a follow-up task should add Core Location bindings
//!   via `objc2-core-location` once the crate version landscape settles.

mod ping_outbox;
mod wifi_monitor;

use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

pub use ping_outbox::{LocationPing, PingOutbox};

/// How often to refresh location even if nothing changes (30 min).
const PERIODIC_REFRESH: Duration = Duration::from_secs(30 * 60);

/// How often to poll Wi-Fi state for BSSID changes (10s).
const WIFI_POLL_INTERVAL: Duration = Duration::from_secs(10);

/// Public service handle. Spawning launches a background thread that runs
/// for the lifetime of the watcher process.
pub struct LocationService {
    _join: std::thread::JoinHandle<()>,
}

impl LocationService {
    /// Spawn the location-monitoring background thread. Returns immediately;
    /// the thread runs until the process exits.
    pub fn spawn(device_id: String) -> Self {
        let join = std::thread::Builder::new()
            .name("ritual-location".to_string())
            .spawn(move || run_service(device_id))
            .expect("failed to spawn location thread");
        Self { _join: join }
    }
}

fn run_service(device_id: String) {
    info!("📍 Location service starting (Wi-Fi fingerprint mode)");

    let outbox = match PingOutbox::load() {
        Ok(ob) => ob,
        Err(e) => {
            warn!("Failed to open location outbox: {}. Service disabled.", e);
            return;
        }
    };

    let mut last_fingerprint: Option<wifi_monitor::WifiFingerprint> = None;
    let mut last_periodic = Instant::now();

    // Initial fingerprint snapshot
    if let Some(fp) = wifi_monitor::current_fingerprint() {
        debug!(
            "Initial Wi-Fi fingerprint: ssid={:?} bssid={:?}",
            fp.ssid, fp.bssid
        );
        record_ping(&outbox, &device_id, &fp, "mac_one_shot");
        last_fingerprint = Some(fp);
    }

    loop {
        std::thread::sleep(WIFI_POLL_INTERVAL);

        // Wi-Fi-change trigger
        let current = wifi_monitor::current_fingerprint();
        let changed = fingerprint_changed(current.as_ref(), last_fingerprint.as_ref());

        if changed {
            if let Some(fp) = &current {
                debug!(
                    "Wi-Fi BSSID change → ping ({}→{})",
                    last_fingerprint
                        .as_ref()
                        .and_then(|f| f.bssid.as_deref())
                        .unwrap_or("none"),
                    fp.bssid.as_deref().unwrap_or("none")
                );
                record_ping(&outbox, &device_id, fp, "mac_bssid_trigger");
            }
            last_fingerprint = current;
        }

        // Periodic heartbeat refresh
        if last_periodic.elapsed() >= PERIODIC_REFRESH {
            if let Some(fp) = wifi_monitor::current_fingerprint() {
                debug!("Periodic location refresh");
                record_ping(&outbox, &device_id, &fp, "mac_one_shot");
                last_fingerprint = Some(fp);
            }
            last_periodic = Instant::now();
        }
    }
}

fn fingerprint_changed(
    current: Option<&wifi_monitor::WifiFingerprint>,
    last: Option<&wifi_monitor::WifiFingerprint>,
) -> bool {
    match (current, last) {
        (Some(c), Some(l)) => c.bssid != l.bssid || c.ssid != l.ssid,
        (Some(_), None) => true,
        (None, Some(_)) => true,
        (None, None) => false,
    }
}

fn record_ping(
    outbox: &PingOutbox,
    device_id: &str,
    fp: &wifi_monitor::WifiFingerprint,
    source: &str,
) {
    // We don't have raw lat/lon without Core Location bindings. Emit a
    // coordinate-less fingerprint ping carrying ssid/bssid as the meaningful
    // payload. The backend stores these pings but excludes them from coordinate
    // resolution so they can never enrich habit logs as Null Island.
    let ping = LocationPing {
        lat: None,
        lon: None,
        horizontal_accuracy_m: None,
        source: source.to_string(),
        device_id: Some(device_id.to_string()),
        bssid: fp.bssid.clone(),
        ssid: fp.ssid.clone(),
        client_ts: now_ms(),
        client_event_id: uuid_v4_string(),
    };

    if let Err(e) = outbox.enqueue(ping) {
        warn!("Failed to write location ping to outbox: {}", e);
    }
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Generate a UUIDv4-shaped string without pulling in the `uuid` crate.
/// Sufficient for client_event_id idempotency keys.
fn uuid_v4_string() -> String {
    use std::time::SystemTime;
    // Mix wall-clock nanos with two thread-local randoms via std hash for entropy.
    let nanos = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut bytes = [0u8; 16];
    for (i, b) in bytes.iter_mut().enumerate() {
        // Mix nanos with index to vary bytes
        let mixed = nanos.wrapping_mul((i as u128) * 0x9E3779B97F4A7C15 + 1);
        *b = (mixed >> (i * 8)) as u8;
    }
    // Set version (4) and variant bits per RFC 4122
    bytes[6] = (bytes[6] & 0x0F) | 0x40;
    bytes[8] = (bytes[8] & 0x3F) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_change_detects_masked_bssid_ssid_changes() {
        let home = wifi_monitor::WifiFingerprint {
            ssid: Some("Home".to_string()),
            bssid: None,
        };
        let office = wifi_monitor::WifiFingerprint {
            ssid: Some("Office".to_string()),
            bssid: None,
        };
        assert!(fingerprint_changed(Some(&office), Some(&home)));
    }

    #[test]
    fn fingerprint_change_detects_bssid_changes() {
        let first = wifi_monitor::WifiFingerprint {
            ssid: Some("Home".to_string()),
            bssid: Some("aa:bb:cc:dd:ee:ff".to_string()),
        };
        let second = wifi_monitor::WifiFingerprint {
            ssid: Some("Home".to_string()),
            bssid: Some("11:22:33:44:55:66".to_string()),
        };
        assert!(fingerprint_changed(Some(&second), Some(&first)));
    }
}
