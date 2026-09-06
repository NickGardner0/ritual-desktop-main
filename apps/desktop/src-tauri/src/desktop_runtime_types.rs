use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
pub(crate) struct TursoSyncConfigResponse {
    pub(crate) sync_url: String,
    pub(crate) auth_token: String,
    pub(crate) expires_at: String,
    pub(crate) database_name: String,
    #[serde(default = "default_activity_schema_version")]
    pub(crate) activity_schema_version: i64,
}

fn default_activity_schema_version() -> i64 {
    1
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct DesktopLocationPing {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) horizontal_accuracy_m: Option<f64>,
    pub(crate) source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) bssid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) ssid: Option<String>,
    pub(crate) client_ts: i64,
    pub(crate) client_event_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LocationIngestResponse {
    pub(crate) accepted: i64,
    pub(crate) rejected: i64,
    pub(crate) duplicates: i64,
    #[serde(default)]
    pub(crate) accepted_ids: Vec<String>,
    #[serde(default)]
    pub(crate) duplicate_ids: Vec<String>,
    #[serde(default)]
    pub(crate) rejected_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct DesktopBiomeActivityEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) event_uid: Option<String>,
    pub(crate) device_id: String,
    pub(crate) app_bundle_id: String,
    pub(crate) app_name: String,
    pub(crate) ts_start: i64,
    pub(crate) ts_end: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) browser_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) browser_domain: Option<String>,
    #[serde(default)]
    pub(crate) is_incognito: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) app_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) app_build: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) transition_reason: Option<String>,
    #[serde(default)]
    pub(crate) biome_is_provisional: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BiomeIngestResponse {
    pub(crate) accepted: i64,
    pub(crate) rejected: i64,
    pub(crate) duplicates: i64,
    #[serde(default)]
    pub(crate) accepted_event_uids: Vec<String>,
    #[serde(default)]
    pub(crate) duplicate_event_uids: Vec<String>,
    #[serde(default)]
    pub(crate) rejected_event_uids: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomeDrainSnapshot {
    pub last_checked_at_ms: Option<i64>,
    pub last_status: Option<String>,
    pub last_processed_count: Option<usize>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomeDeviceDiagnostics {
    pub device_id: String,
    pub path: String,
    pub path_exists: bool,
    pub source_file_count: usize,
    pub newest_source_file_mtime_ms: Option<i64>,
    pub oldest_source_file_mtime_ms: Option<i64>,
    pub source_file_bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomeOutboxDiagnostics {
    pub path: Option<String>,
    pub exists: bool,
    pub event_count: usize,
    pub malformed_line_count: usize,
    pub bytes: u64,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiomeIphoneDiagnostics {
    pub sync_db_path: Option<String>,
    pub sync_db_exists: bool,
    pub sync_db_error: Option<String>,
    pub ios_device_peer_count: usize,
    pub app_in_focus_remote_path: Option<String>,
    pub app_in_focus_remote_exists: bool,
    pub device_folder_count: usize,
    pub source_file_count: usize,
    pub devices: Vec<BiomeDeviceDiagnostics>,
    pub outbox: BiomeOutboxDiagnostics,
    pub committed_cursors_path: Option<String>,
    pub committed_cursors: HashMap<String, i64>,
    pub last_drain: BiomeDrainSnapshot,
    pub notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateStatusPayload {
    pub(crate) content_length: Option<u64>,
    pub(crate) downloaded: Option<u64>,
    pub(crate) error: Option<String>,
    pub(crate) percentage: Option<u8>,
    pub(crate) status: Option<String>,
}
