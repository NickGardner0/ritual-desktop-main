use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

mod types;
mod record_concurrency;

pub use types::*;

const VAULT_DB_NAME: &str = "vault.db";
const VAULT_KEY_NAME: &str = "vault.key";
const ACTIVE_KEY_VERSION: i64 = 1;
const VAULT_SCHEMA_VERSION: i64 = 1;

fn redacted_error(context: &str) -> String {
    format!("{context}; see desktop logs for details")
}

fn ritual_vault_dir() -> PathBuf {
    if let Ok(path) = std::env::var("RITUAL_VAULT_DIR") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".ritual")
    } else {
        PathBuf::from("./.ritual")
    }
}

fn storage_id(user_id: &str, collection: &str, record_id: &str) -> String {
    format!("{user_id}:{collection}:{record_id}")
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes
}

#[cfg(unix)]
fn protect_key_file(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o600);
    fs::set_permissions(path, permissions)
}

#[cfg(not(unix))]
fn protect_key_file(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn write_key_file(path: &Path, encoded: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(encoded.as_bytes())
}

#[cfg(not(unix))]
fn write_key_file(path: &Path, encoded: &str) -> std::io::Result<()> {
    fs::write(path, encoded)
}

fn read_or_create_root_key(base_dir: &Path) -> Result<[u8; 32], String> {
    fs::create_dir_all(base_dir).map_err(|error| {
        log::error!("Failed creating vault directory: {error}");
        redacted_error("Failed to initialize local vault")
    })?;

    let key_path = base_dir.join(VAULT_KEY_NAME);
    if key_path.exists() {
        let encoded = fs::read_to_string(&key_path).map_err(|error| {
            log::error!("Failed reading vault key file: {error}");
            redacted_error("Failed to unlock local vault")
        })?;
        let decoded = general_purpose::STANDARD
            .decode(encoded.trim())
            .map_err(|error| {
                log::error!("Failed decoding vault key file: {error}");
                redacted_error("Failed to unlock local vault")
            })?;
        if decoded.len() != 32 {
            log::error!("Vault key file had invalid key length");
            return Err(redacted_error("Failed to unlock local vault"));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&decoded);
        return Ok(key);
    }

    let key = random_bytes::<32>();
    let encoded = general_purpose::STANDARD.encode(key);
    write_key_file(&key_path, &encoded).map_err(|error| {
        log::error!("Failed writing vault key file: {error}");
        redacted_error("Failed to initialize local vault")
    })?;
    if let Err(error) = protect_key_file(&key_path) {
        log::warn!("Failed applying strict vault key file permissions: {error}");
    }
    Ok(key)
}

struct LocalVault {
    conn: Connection,
    key: [u8; 32],
    db_path: PathBuf,
}

impl LocalVault {
    fn open(base_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(base_dir).map_err(|error| {
            log::error!("Failed creating vault directory: {error}");
            redacted_error("Failed to initialize local vault")
        })?;
        let db_path = base_dir.join(VAULT_DB_NAME);
        let key = read_or_create_root_key(base_dir)?;
        let conn = Connection::open(&db_path).map_err(|error| {
            log::error!("Failed opening vault database: {error}");
            redacted_error("Failed to open local vault")
        })?;
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "synchronous", "NORMAL").ok();
        let vault = Self { conn, key, db_path };
        vault.initialize_schema()?;
        Ok(vault)
    }

    fn initialize_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(ritual_db::schema::vault::VAULT_SCHEMA_SQL)
            .map_err(|error| {
                log::error!("Failed creating vault schema: {error}");
                redacted_error("Failed to initialize local vault")
            })?;
        Ok(())
    }

    fn ensure_manifest(&self, user_id: &str) -> Result<(), String> {
        let now = now_iso();
        self.conn
            .execute(
                r#"
                INSERT INTO vault_manifest (
                    id, user_id, vault_version, created_at, updated_at, root_key_label, active_key_version
                )
                VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)
                ON CONFLICT(id) DO UPDATE SET
                    updated_at = excluded.updated_at,
                    active_key_version = excluded.active_key_version
                "#,
                params![
                    format!("manifest:{user_id}"),
                    user_id,
                    VAULT_SCHEMA_VERSION,
                    now,
                    "local-key-file-v1",
                    ACTIVE_KEY_VERSION
                ],
            )
            .map_err(|error| {
                log::error!("Failed upserting vault manifest: {error}");
                redacted_error("Failed to initialize local vault")
            })?;
        Ok(())
    }

    fn status(&self, user_id: Option<&str>) -> Result<VaultStatus, String> {
        let record_count = count_records(&self.conn, user_id, "tombstone = 0")?;
        let staged_record_count = count_records(
            &self.conn,
            user_id,
            "collection LIKE 'migration_dry_run:%' AND tombstone = 0",
        )?;
        let inventory_count = count_inventory(&self.conn, user_id)?;
        let migration_manifest_count = count_migration_manifests(&self.conn, user_id)?;
        let deletion_receipt_count = count_deletion_receipts(&self.conn, user_id)?;
        let latest_inventory_at = latest_inventory_at(&self.conn, user_id)?;
        let latest_migration_completed_at = latest_migration_completed_at(&self.conn, user_id)?;
        let latest_deletion_completed_at = latest_deletion_completed_at(&self.conn, user_id)?;
        Ok(VaultStatus {
            initialized: true,
            db_path: self.db_path.display().to_string(),
            record_count,
            staged_record_count,
            inventory_count,
            migration_manifest_count,
            deletion_receipt_count,
            active_key_version: ACTIVE_KEY_VERSION,
            latest_inventory_at,
            latest_migration_completed_at,
            latest_deletion_completed_at,
        })
    }

    fn put_record(&self, input: VaultRecordInput) -> Result<VaultRecordMetadata, String> {
        self.ensure_manifest(input.user_id.trim())?;
        let updated_at = input.updated_at.clone().unwrap_or_else(now_iso);
        let created_at = now_iso();
        let nonce_bytes = random_bytes::<12>();
        let nonce = Nonce::from_slice(&nonce_bytes);
        let aad = json!({
            "user_id": input.user_id,
            "collection": input.collection,
            "record_id": input.record_id,
            "schema_version": VAULT_SCHEMA_VERSION,
            "key_version": ACTIVE_KEY_VERSION,
        })
        .to_string();
        let plaintext = serde_json::to_vec(&input.payload).map_err(|error| {
            log::error!("Failed serializing vault payload: {error}");
            redacted_error("Failed to write local vault record")
        })?;
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|error| {
            log::error!("Failed preparing vault cipher: {error}");
            redacted_error("Failed to write local vault record")
        })?;
        let ciphertext = cipher
            .encrypt(
                nonce,
                Payload {
                    msg: &plaintext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|error| {
                log::error!("Failed encrypting vault payload: {error}");
                redacted_error("Failed to write local vault record")
            })?;
        let storage_id = storage_id(&input.user_id, &input.collection, &input.record_id);
        self.conn
            .execute(
                r#"
                INSERT INTO vault_records (
                    storage_id, user_id, record_id, record_type, collection, updated_at, tombstone,
                    key_version, algorithm, nonce, ciphertext, aad, created_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'AES-256-GCM', ?9, ?10, ?11, ?12)
                ON CONFLICT(storage_id) DO UPDATE SET
                    record_type = excluded.record_type,
                    updated_at = excluded.updated_at,
                    tombstone = excluded.tombstone,
                    key_version = excluded.key_version,
                    algorithm = excluded.algorithm,
                    nonce = excluded.nonce,
                    ciphertext = excluded.ciphertext,
                    aad = excluded.aad
                "#,
                params![
                    storage_id,
                    input.user_id,
                    input.record_id,
                    input.record_type,
                    input.collection,
                    updated_at,
                    if input.tombstone.unwrap_or(false) {
                        1
                    } else {
                        0
                    },
                    ACTIVE_KEY_VERSION,
                    general_purpose::STANDARD.encode(nonce_bytes),
                    general_purpose::STANDARD.encode(ciphertext),
                    aad,
                    created_at,
                ],
            )
            .map_err(|error| {
                log::error!("Failed writing vault record: {error}");
                redacted_error("Failed to write local vault record")
            })?;

        Ok(VaultRecordMetadata {
            id: input.record_id,
            collection: input.collection,
            record_type: input.record_type,
            updated_at,
            tombstone: input.tombstone.unwrap_or(false),
            key_version: ACTIVE_KEY_VERSION,
            algorithm: "AES-256-GCM".to_string(),
        })
    }

    fn get_record(
        &self,
        user_id: &str,
        collection: &str,
        record_id: &str,
    ) -> Result<Option<VaultRecordOutput>, String> {
        let mut stmt = self
            .conn
            .prepare(
                r#"
                SELECT record_id, record_type, collection, updated_at, tombstone, nonce, ciphertext, aad
                FROM vault_records
                WHERE storage_id = ?1
                "#,
            )
            .map_err(|error| {
                log::error!("Failed preparing vault record read: {error}");
                redacted_error("Failed to read local vault record")
            })?;
        let storage_id = storage_id(user_id, collection, record_id);
        let row = stmt
            .query_row(params![storage_id], |row| {
                Ok(EncryptedRow {
                    record_id: row.get(0)?,
                    record_type: row.get(1)?,
                    collection: row.get(2)?,
                    updated_at: row.get(3)?,
                    tombstone: row.get::<_, i64>(4)? != 0,
                    nonce: row.get(5)?,
                    ciphertext: row.get(6)?,
                    aad: row.get(7)?,
                })
            })
            .optional()
            .map_err(|error| {
                log::error!("Failed reading vault record: {error}");
                redacted_error("Failed to read local vault record")
            })?;
        row.map(|encrypted| self.decrypt_row(encrypted)).transpose()
    }

    fn list_records(
        &self,
        user_id: &str,
        collection: &str,
        since: Option<String>,
        limit: Option<i64>,
    ) -> Result<Vec<VaultRecordOutput>, String> {
        let limit = limit.unwrap_or(500).clamp(1, 100_000);
        let since = since.unwrap_or_default();
        let mut stmt = self
            .conn
            .prepare(
                r#"
                SELECT record_id, record_type, collection, updated_at, tombstone, nonce, ciphertext, aad
                FROM vault_records
                WHERE user_id = ?1
                  AND collection = ?2
                  AND (?3 = '' OR updated_at > ?3)
                ORDER BY updated_at DESC
                LIMIT ?4
                "#,
            )
            .map_err(|error| {
                log::error!("Failed preparing vault list: {error}");
                redacted_error("Failed to list local vault records")
            })?;
        let rows = stmt
            .query_map(params![user_id, collection, since, limit], |row| {
                Ok(EncryptedRow {
                    record_id: row.get(0)?,
                    record_type: row.get(1)?,
                    collection: row.get(2)?,
                    updated_at: row.get(3)?,
                    tombstone: row.get::<_, i64>(4)? != 0,
                    nonce: row.get(5)?,
                    ciphertext: row.get(6)?,
                    aad: row.get(7)?,
                })
            })
            .map_err(|error| {
                log::error!("Failed listing vault records: {error}");
                redacted_error("Failed to list local vault records")
            })?;

        let mut records = Vec::new();
        for row in rows {
            let encrypted = row.map_err(|error| {
                log::error!("Failed reading vault list row: {error}");
                redacted_error("Failed to list local vault records")
            })?;
            records.push(self.decrypt_row(encrypted)?);
        }
        Ok(records)
    }

    fn tombstone_record(
        &self,
        user_id: String,
        collection: String,
        record_id: String,
        record_type: String,
    ) -> Result<VaultRecordMetadata, String> {
        self.put_record(VaultRecordInput {
            user_id,
            collection,
            record_id,
            record_type,
            payload: json!({}),
            updated_at: Some(now_iso()),
            tombstone: Some(true),
        })
    }

    fn put_migration_manifest(
        &self,
        input: VaultMigrationManifestInput,
    ) -> Result<VaultMigrationManifestOutput, String> {
        let user_id = input.user_id.trim();
        self.ensure_manifest(user_id)?;
        let now = now_iso();
        let started_at = input.started_at.clone().unwrap_or_else(|| now.clone());
        let categories_json = serde_json::to_string(&input.categories).map_err(|error| {
            log::error!("Failed serializing migration manifest categories: {error}");
            redacted_error("Failed to write local migration manifest")
        })?;
        let manifest_id = format!("{user_id}:{}", input.migration_id);

        self.conn
            .execute(
                r#"
                INSERT INTO vault_migration_manifest (
                    id, user_id, migration_id, categories, status, source_hash, local_hash,
                    record_count, migrated_count, started_at, completed_at, error, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
                ON CONFLICT(id) DO UPDATE SET
                    categories = excluded.categories,
                    status = excluded.status,
                    source_hash = excluded.source_hash,
                    local_hash = excluded.local_hash,
                    record_count = excluded.record_count,
                    migrated_count = excluded.migrated_count,
                    started_at = excluded.started_at,
                    completed_at = excluded.completed_at,
                    error = excluded.error,
                    updated_at = excluded.updated_at
                "#,
                params![
                    manifest_id,
                    user_id,
                    input.migration_id,
                    categories_json,
                    input.status,
                    input.source_hash,
                    input.local_hash,
                    input.record_count,
                    input.migrated_count,
                    started_at,
                    input.completed_at,
                    input.error,
                    now,
                ],
            )
            .map_err(|error| {
                log::error!("Failed writing migration manifest: {error}");
                redacted_error("Failed to write local migration manifest")
            })?;

        self.get_migration_manifest(user_id, &input.migration_id)?
            .ok_or_else(|| redacted_error("Failed to read local migration manifest"))
    }

    fn get_migration_manifest(
        &self,
        user_id: &str,
        migration_id: &str,
    ) -> Result<Option<VaultMigrationManifestOutput>, String> {
        self.conn
            .query_row(
                r#"
                SELECT migration_id, categories, status, source_hash, local_hash, record_count,
                       migrated_count, started_at, completed_at, error, updated_at
                FROM vault_migration_manifest
                WHERE id = ?1
                "#,
                params![format!("{user_id}:{migration_id}")],
                migration_manifest_from_row,
            )
            .optional()
            .map_err(|error| {
                log::error!("Failed reading migration manifest: {error}");
                redacted_error("Failed to read local migration manifest")
            })
    }

    fn list_migration_manifests(
        &self,
        user_id: &str,
        limit: Option<i64>,
    ) -> Result<Vec<VaultMigrationManifestOutput>, String> {
        let limit = limit.unwrap_or(20).clamp(1, 200);
        let mut stmt = self
            .conn
            .prepare(
                r#"
                SELECT migration_id, categories, status, source_hash, local_hash, record_count,
                       migrated_count, started_at, completed_at, error, updated_at
                FROM vault_migration_manifest
                WHERE user_id = ?1
                ORDER BY updated_at DESC
                LIMIT ?2
                "#,
            )
            .map_err(|error| {
                log::error!("Failed preparing migration manifest list: {error}");
                redacted_error("Failed to list local migration manifests")
            })?;
        let rows = stmt
            .query_map(params![user_id, limit], migration_manifest_from_row)
            .map_err(|error| {
                log::error!("Failed listing migration manifests: {error}");
                redacted_error("Failed to list local migration manifests")
            })?;
        let mut manifests = Vec::new();
        for row in rows {
            manifests.push(row.map_err(|error| {
                log::error!("Failed reading migration manifest row: {error}");
                redacted_error("Failed to list local migration manifests")
            })?);
        }
        Ok(manifests)
    }

    fn put_deletion_receipt(
        &self,
        input: VaultDeletionReceiptInput,
    ) -> Result<VaultDeletionReceiptOutput, String> {
        let user_id = input.user_id.trim();
        self.ensure_manifest(user_id)?;
        let now = now_iso();
        let started_at = input.started_at.clone().unwrap_or_else(|| now.clone());
        let categories_json = serde_json::to_string(&input.categories).map_err(|error| {
            log::error!("Failed serializing deletion receipt categories: {error}");
            redacted_error("Failed to write local deletion receipt")
        })?;
        let backend_receipts_json =
            serde_json::to_string(&input.backend_receipts).map_err(|error| {
                log::error!("Failed serializing backend deletion receipts: {error}");
                redacted_error("Failed to write local deletion receipt")
            })?;
        let receipt_id = format!("{user_id}:{}", input.deletion_id);

        self.conn
            .execute(
                r#"
                INSERT INTO vault_deletion_receipt (
                    id, user_id, deletion_id, categories, status, source_hash, requested_record_count,
                    deleted_count, backend_receipts, started_at, completed_at, error, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
                ON CONFLICT(id) DO UPDATE SET
                    categories = excluded.categories,
                    status = excluded.status,
                    source_hash = excluded.source_hash,
                    requested_record_count = excluded.requested_record_count,
                    deleted_count = excluded.deleted_count,
                    backend_receipts = excluded.backend_receipts,
                    started_at = excluded.started_at,
                    completed_at = excluded.completed_at,
                    error = excluded.error,
                    updated_at = excluded.updated_at
                "#,
                params![
                    receipt_id,
                    user_id,
                    input.deletion_id,
                    categories_json,
                    input.status,
                    input.source_hash,
                    input.requested_record_count,
                    input.deleted_count,
                    backend_receipts_json,
                    started_at,
                    input.completed_at,
                    input.error,
                    now,
                ],
            )
            .map_err(|error| {
                log::error!("Failed writing deletion receipt: {error}");
                redacted_error("Failed to write local deletion receipt")
            })?;

        self.get_deletion_receipt(user_id, &input.deletion_id)?
            .ok_or_else(|| redacted_error("Failed to read local deletion receipt"))
    }

    fn get_deletion_receipt(
        &self,
        user_id: &str,
        deletion_id: &str,
    ) -> Result<Option<VaultDeletionReceiptOutput>, String> {
        self.conn
            .query_row(
                r#"
                SELECT deletion_id, categories, status, source_hash, requested_record_count,
                       deleted_count, backend_receipts, started_at, completed_at, error, updated_at
                FROM vault_deletion_receipt
                WHERE id = ?1
                "#,
                params![format!("{user_id}:{deletion_id}")],
                deletion_receipt_from_row,
            )
            .optional()
            .map_err(|error| {
                log::error!("Failed reading deletion receipt: {error}");
                redacted_error("Failed to read local deletion receipt")
            })
    }

    fn list_deletion_receipts(
        &self,
        user_id: &str,
        limit: Option<i64>,
    ) -> Result<Vec<VaultDeletionReceiptOutput>, String> {
        let limit = limit.unwrap_or(20).clamp(1, 200);
        let mut stmt = self
            .conn
            .prepare(
                r#"
                SELECT deletion_id, categories, status, source_hash, requested_record_count,
                       deleted_count, backend_receipts, started_at, completed_at, error, updated_at
                FROM vault_deletion_receipt
                WHERE user_id = ?1
                ORDER BY updated_at DESC
                LIMIT ?2
                "#,
            )
            .map_err(|error| {
                log::error!("Failed preparing deletion receipt list: {error}");
                redacted_error("Failed to list local deletion receipts")
            })?;
        let rows = stmt
            .query_map(params![user_id, limit], deletion_receipt_from_row)
            .map_err(|error| {
                log::error!("Failed listing deletion receipts: {error}");
                redacted_error("Failed to list local deletion receipts")
            })?;
        let mut receipts = Vec::new();
        for row in rows {
            receipts.push(row.map_err(|error| {
                log::error!("Failed reading deletion receipt row: {error}");
                redacted_error("Failed to list local deletion receipts")
            })?);
        }
        Ok(receipts)
    }

    fn decrypt_row(&self, encrypted: EncryptedRow) -> Result<VaultRecordOutput, String> {
        let nonce_bytes = general_purpose::STANDARD
            .decode(encrypted.nonce.as_bytes())
            .map_err(|error| {
                log::error!("Failed decoding vault nonce: {error}");
                redacted_error("Failed to decrypt local vault record")
            })?;
        let ciphertext = general_purpose::STANDARD
            .decode(encrypted.ciphertext.as_bytes())
            .map_err(|error| {
                log::error!("Failed decoding vault ciphertext: {error}");
                redacted_error("Failed to decrypt local vault record")
            })?;
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|error| {
            log::error!("Failed preparing vault cipher: {error}");
            redacted_error("Failed to decrypt local vault record")
        })?;
        let plaintext = cipher
            .decrypt(
                Nonce::from_slice(&nonce_bytes),
                Payload {
                    msg: &ciphertext,
                    aad: encrypted.aad.as_bytes(),
                },
            )
            .map_err(|error| {
                log::error!("Failed decrypting vault payload: {error}");
                redacted_error("Failed to decrypt local vault record")
            })?;
        let payload = serde_json::from_slice::<Value>(&plaintext).map_err(|error| {
            log::error!("Failed decoding vault payload JSON: {error}");
            redacted_error("Failed to decrypt local vault record")
        })?;
        Ok(VaultRecordOutput {
            id: encrypted.record_id,
            collection: encrypted.collection,
            record_type: encrypted.record_type,
            payload,
            updated_at: encrypted.updated_at,
            tombstone: encrypted.tombstone,
        })
    }
}

fn migration_manifest_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<VaultMigrationManifestOutput> {
    let categories_text: String = row.get(1)?;
    let categories = serde_json::from_str::<Vec<String>>(&categories_text).unwrap_or_default();
    Ok(VaultMigrationManifestOutput {
        migration_id: row.get(0)?,
        categories,
        status: row.get(2)?,
        source_hash: row.get(3)?,
        local_hash: row.get(4)?,
        record_count: row.get(5)?,
        migrated_count: row.get(6)?,
        started_at: row.get(7)?,
        completed_at: row.get(8)?,
        error: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn deletion_receipt_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<VaultDeletionReceiptOutput> {
    let categories_text: String = row.get(1)?;
    let backend_receipts_text: String = row.get(6)?;
    let categories = serde_json::from_str::<Vec<String>>(&categories_text).unwrap_or_default();
    let backend_receipts =
        serde_json::from_str::<Value>(&backend_receipts_text).unwrap_or_else(|_| json!([]));
    Ok(VaultDeletionReceiptOutput {
        deletion_id: row.get(0)?,
        categories,
        status: row.get(2)?,
        source_hash: row.get(3)?,
        requested_record_count: row.get(4)?,
        deleted_count: row.get(5)?,
        backend_receipts,
        started_at: row.get(7)?,
        completed_at: row.get(8)?,
        error: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

#[derive(Debug)]
struct EncryptedRow {
    record_id: String,
    record_type: String,
    collection: String,
    updated_at: String,
    tombstone: bool,
    nonce: String,
    ciphertext: String,
    aad: String,
}

fn count_records(conn: &Connection, user_id: Option<&str>, predicate: &str) -> Result<i64, String> {
    let sql = format!(
        "SELECT COUNT(*) FROM vault_records WHERE (?1 IS NULL OR user_id = ?1) AND {predicate}"
    );
    conn.query_row(&sql, params![user_id], |row| row.get(0))
        .map_err(|error| {
            log::error!("Failed counting vault records: {error}");
            redacted_error("Failed to read local vault status")
        })
}

fn count_inventory(conn: &Connection, user_id: Option<&str>) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM vault_migration_inventory WHERE (?1 IS NULL OR user_id = ?1)",
        params![user_id],
        |row| row.get(0),
    )
    .map_err(|error| {
        log::error!("Failed counting vault inventory: {error}");
        redacted_error("Failed to read local vault status")
    })
}

fn count_migration_manifests(conn: &Connection, user_id: Option<&str>) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM vault_migration_manifest WHERE (?1 IS NULL OR user_id = ?1)",
        params![user_id],
        |row| row.get(0),
    )
    .map_err(|error| {
        log::error!("Failed counting vault migration manifests: {error}");
        redacted_error("Failed to read local vault status")
    })
}

fn count_deletion_receipts(conn: &Connection, user_id: Option<&str>) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM vault_deletion_receipt WHERE (?1 IS NULL OR user_id = ?1)",
        params![user_id],
        |row| row.get(0),
    )
    .map_err(|error| {
        log::error!("Failed counting vault deletion receipts: {error}");
        redacted_error("Failed to read local vault status")
    })
}

fn latest_inventory_at(conn: &Connection, user_id: Option<&str>) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT MAX(checked_at) FROM vault_migration_inventory WHERE (?1 IS NULL OR user_id = ?1)",
        params![user_id],
        |row| row.get(0),
    )
    .map_err(|error| {
        log::error!("Failed reading latest vault inventory timestamp: {error}");
        redacted_error("Failed to read local vault status")
    })
}

fn latest_migration_completed_at(
    conn: &Connection,
    user_id: Option<&str>,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT MAX(completed_at) FROM vault_migration_manifest WHERE (?1 IS NULL OR user_id = ?1) AND status = 'completed'",
        params![user_id],
        |row| row.get(0),
    )
    .map_err(|error| {
        log::error!("Failed reading latest migration completion timestamp: {error}");
        redacted_error("Failed to read local vault status")
    })
}

fn latest_deletion_completed_at(
    conn: &Connection,
    user_id: Option<&str>,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT MAX(completed_at) FROM vault_deletion_receipt WHERE (?1 IS NULL OR user_id = ?1) AND status = 'completed'",
        params![user_id],
        |row| row.get(0),
    )
    .map_err(|error| {
        log::error!("Failed reading latest deletion completion timestamp: {error}");
        redacted_error("Failed to read local vault status")
    })
}

fn open_default_vault() -> Result<LocalVault, String> {
    LocalVault::open(&ritual_vault_dir())
}

#[tauri::command]
pub fn vault_initialize(user_id: String) -> Result<VaultStatus, String> {
    let vault = open_default_vault()?;
    vault.ensure_manifest(user_id.trim())?;
    vault.status(Some(user_id.trim()))
}

#[tauri::command]
pub fn vault_get_status(user_id: Option<String>) -> Result<VaultStatus, String> {
    let vault = open_default_vault()?;
    vault.status(
        user_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
}

#[tauri::command]
pub fn vault_put_record(input: VaultRecordInput) -> Result<VaultRecordMetadata, String> {
    open_default_vault()?.put_record(input)
}

#[tauri::command]
pub fn vault_get_record(
    user_id: String,
    collection: String,
    record_id: String,
) -> Result<Option<VaultRecordOutput>, String> {
    open_default_vault()?.get_record(user_id.trim(), collection.trim(), record_id.trim())
}

#[tauri::command]
pub fn vault_list_records(
    user_id: String,
    collection: String,
    since: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<VaultRecordOutput>, String> {
    open_default_vault()?.list_records(user_id.trim(), collection.trim(), since, limit)
}

#[tauri::command]
pub fn vault_list_records_page(
    user_id: String,
    collection: String,
    cursor: Option<String>,
    limit: Option<i64>,
) -> Result<VaultRecordsPage, String> {
    open_default_vault()?.list_records_page(user_id.trim(), collection.trim(), cursor, limit)
}

#[tauri::command]
pub fn vault_compare_and_swap(
    input: VaultCompareAndSwapInput,
) -> Result<VaultCompareAndSwapResult, String> {
    open_default_vault()?.compare_and_swap_record(input)
}

#[tauri::command]
pub fn vault_tombstone_record(
    user_id: String,
    collection: String,
    record_id: String,
    record_type: String,
) -> Result<VaultRecordMetadata, String> {
    open_default_vault()?.tombstone_record(user_id, collection, record_id, record_type)
}

#[tauri::command]
pub fn vault_put_migration_manifest(
    input: VaultMigrationManifestInput,
) -> Result<VaultMigrationManifestOutput, String> {
    open_default_vault()?.put_migration_manifest(input)
}

#[tauri::command]
pub fn vault_list_migration_manifests(
    user_id: String,
    limit: Option<i64>,
) -> Result<Vec<VaultMigrationManifestOutput>, String> {
    open_default_vault()?.list_migration_manifests(user_id.trim(), limit)
}

#[tauri::command]
pub fn vault_put_deletion_receipt(
    input: VaultDeletionReceiptInput,
) -> Result<VaultDeletionReceiptOutput, String> {
    open_default_vault()?.put_deletion_receipt(input)
}

#[tauri::command]
pub fn vault_list_deletion_receipts(
    user_id: String,
    limit: Option<i64>,
) -> Result<Vec<VaultDeletionReceiptOutput>, String> {
    open_default_vault()?.list_deletion_receipts(user_id.trim(), limit)
}

#[cfg(test)]
mod tests;
