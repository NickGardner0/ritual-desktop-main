use super::*;
use serde_json::{json, Value};
use std::fs;
use tempfile::TempDir;

fn sample_habit_payload() -> Value {
    json!({
        "id": "habit-private",
        "name": "Private Medication",
        "category": "Health",
        "notes": "sensitive note should not be visible",
        "location_place_label": "Home address",
    })
}

#[test]
fn vault_stores_sensitive_payload_as_ciphertext() {
    let temp = TempDir::new().expect("temp dir");
    let vault = LocalVault::open(temp.path()).expect("open vault");
    vault
        .put_record(VaultRecordInput {
            user_id: "user-1".to_string(),
            collection: "habit_definitions".to_string(),
            record_id: "habit-private".to_string(),
            record_type: "habit_definition".to_string(),
            payload: sample_habit_payload(),
            updated_at: Some("2026-06-23T00:00:00Z".to_string()),
            tombstone: Some(false),
        })
        .expect("put record");

    let db_bytes = fs::read(temp.path().join(VAULT_DB_NAME)).expect("read vault db");
    let db_text = String::from_utf8_lossy(&db_bytes);
    assert!(!db_text.contains("Private Medication"));
    assert!(!db_text.contains("sensitive note should not be visible"));
    assert!(!db_text.contains("Home address"));

    let record = vault
        .get_record("user-1", "habit_definitions", "habit-private")
        .expect("get record")
        .expect("record exists");
    assert_eq!(record.payload["name"], "Private Medication");
}

#[test]
fn vault_key_material_is_not_stored_in_database() {
    let temp = TempDir::new().expect("temp dir");
    let vault = LocalVault::open(temp.path()).expect("open vault");
    vault.ensure_manifest("user-1").expect("manifest");
    let key_text = fs::read_to_string(temp.path().join(VAULT_KEY_NAME)).expect("key file");
    let label: String = vault
        .conn
        .query_row(
            "SELECT root_key_label FROM vault_manifest WHERE id = 'manifest:user-1'",
            [],
            |row| row.get(0),
        )
        .expect("manifest label");
    assert_eq!(label, "local-key-file-v1");
    for filename in [VAULT_DB_NAME, "vault.db-wal"] {
        let path = temp.path().join(filename);
        if path.exists() {
            let bytes = fs::read(path).expect("read vault storage file");
            let text = String::from_utf8_lossy(&bytes);
            assert!(!text.contains(key_text.trim()));
        }
    }
}

#[test]
fn vault_lists_and_tombstones_records() {
    let temp = TempDir::new().expect("temp dir");
    let vault = LocalVault::open(temp.path()).expect("open vault");
    vault
        .put_record(VaultRecordInput {
            user_id: "user-1".to_string(),
            collection: "habit_logs".to_string(),
            record_id: "log-1".to_string(),
            record_type: "habit_log".to_string(),
            payload: json!({"notes": "private log"}),
            updated_at: Some("2026-06-23T00:00:00Z".to_string()),
            tombstone: Some(false),
        })
        .expect("put record");
    assert_eq!(
        vault
            .list_records("user-1", "habit_logs", None, Some(10))
            .expect("list")
            .len(),
        1
    );
    let tombstone = vault
        .tombstone_record(
            "user-1".to_string(),
            "habit_logs".to_string(),
            "log-1".to_string(),
            "habit_log".to_string(),
        )
        .expect("tombstone");
    assert!(tombstone.tombstone);
    let record = vault
        .get_record("user-1", "habit_logs", "log-1")
        .expect("get")
        .expect("exists");
    assert!(record.tombstone);
}

#[test]
fn vault_records_migration_manifests_without_payloads() {
    let temp = TempDir::new().expect("temp dir");
    let vault = LocalVault::open(temp.path()).expect("open vault");
    let manifest = vault
        .put_migration_manifest(VaultMigrationManifestInput {
            user_id: "user-1".to_string(),
            migration_id: "migration-1".to_string(),
            categories: vec!["habit_definitions".to_string(), "habit_logs".to_string()],
            status: "completed".to_string(),
            source_hash: "source-hash".to_string(),
            local_hash: Some("source-hash".to_string()),
            record_count: 2,
            migrated_count: 2,
            started_at: Some("2026-06-23T00:00:00Z".to_string()),
            completed_at: Some("2026-06-23T00:00:01Z".to_string()),
            error: None,
        })
        .expect("write manifest");
    assert_eq!(manifest.status, "completed");

    let manifests = vault
        .list_migration_manifests("user-1", Some(10))
        .expect("list manifests");
    assert_eq!(manifests.len(), 1);
    assert_eq!(manifests[0].migration_id, "migration-1");
    assert_eq!(
        vault
            .status(Some("user-1"))
            .expect("status")
            .migration_manifest_count,
        1
    );
}

#[test]
fn vault_records_cloud_deletion_receipts() {
    let temp = TempDir::new().expect("temp dir");
    let vault = LocalVault::open(temp.path()).expect("open vault");
    let receipt = vault
        .put_deletion_receipt(VaultDeletionReceiptInput {
            user_id: "user-1".to_string(),
            deletion_id: "delete-1".to_string(),
            categories: vec!["habit_definitions".to_string(), "habit_logs".to_string()],
            status: "completed".to_string(),
            source_hash: "source-hash".to_string(),
            requested_record_count: 2,
            deleted_count: 2,
            backend_receipts: json!([
                {
                    "category": "habit_logs",
                    "deleted_count": 1,
                    "status": "deleted"
                }
            ]),
            started_at: Some("2026-06-23T00:00:00Z".to_string()),
            completed_at: Some("2026-06-23T00:00:01Z".to_string()),
            error: None,
        })
        .expect("write deletion receipt");
    assert_eq!(receipt.status, "completed");
    assert_eq!(receipt.deleted_count, 2);

    let receipts = vault
        .list_deletion_receipts("user-1", Some(10))
        .expect("list receipts");
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].deletion_id, "delete-1");
    assert_eq!(
        vault
            .status(Some("user-1"))
            .expect("status")
            .deletion_receipt_count,
        1
    );
    assert_eq!(
        vault
            .status(Some("user-1"))
            .expect("status")
            .latest_deletion_completed_at
            .as_deref(),
        Some("2026-06-23T00:00:01Z")
    );
}
