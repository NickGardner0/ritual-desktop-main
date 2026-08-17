use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub initialized: bool,
    pub db_path: String,
    pub record_count: i64,
    pub staged_record_count: i64,
    pub inventory_count: i64,
    pub migration_manifest_count: i64,
    pub deletion_receipt_count: i64,
    pub active_key_version: i64,
    pub latest_inventory_at: Option<String>,
    pub latest_migration_completed_at: Option<String>,
    pub latest_deletion_completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRecordInput {
    pub user_id: String,
    pub collection: String,
    pub record_id: String,
    pub record_type: String,
    pub payload: Value,
    pub updated_at: Option<String>,
    pub tombstone: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRecordOutput {
    pub id: String,
    pub collection: String,
    pub record_type: String,
    pub payload: Value,
    pub updated_at: String,
    pub tombstone: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRecordMetadata {
    pub id: String,
    pub collection: String,
    pub record_type: String,
    pub updated_at: String,
    pub tombstone: bool,
    pub key_version: i64,
    pub algorithm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultRecordsPage {
    pub records: Vec<VaultRecordOutput>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCompareAndSwapInput {
    pub record: VaultRecordInput,
    pub expected_updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultCompareAndSwapResult {
    pub applied: bool,
    pub record: Option<VaultRecordMetadata>,
    pub current: Option<VaultRecordOutput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMigrationManifestInput {
    pub user_id: String,
    pub migration_id: String,
    pub categories: Vec<String>,
    pub status: String,
    pub source_hash: String,
    pub local_hash: Option<String>,
    pub record_count: i64,
    pub migrated_count: i64,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultMigrationManifestOutput {
    pub migration_id: String,
    pub categories: Vec<String>,
    pub status: String,
    pub source_hash: String,
    pub local_hash: Option<String>,
    pub record_count: i64,
    pub migrated_count: i64,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDeletionReceiptInput {
    pub user_id: String,
    pub deletion_id: String,
    pub categories: Vec<String>,
    pub status: String,
    pub source_hash: String,
    pub requested_record_count: i64,
    pub deleted_count: i64,
    pub backend_receipts: Value,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultDeletionReceiptOutput {
    pub deletion_id: String,
    pub categories: Vec<String>,
    pub status: String,
    pub source_hash: String,
    pub requested_record_count: i64,
    pub deleted_count: i64,
    pub backend_receipts: Value,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub error: Option<String>,
    pub updated_at: String,
}
