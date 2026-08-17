use super::*;

const CURSOR_VERSION: u8 = 1;
const DEFAULT_PAGE_LIMIT: i64 = 500;
const MAX_PAGE_LIMIT: i64 = 5_000;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct PageCursor {
    version: u8,
    updated_at: String,
    storage_id: String,
}

fn encode_cursor(updated_at: String, storage_id: String) -> Result<String, String> {
    let payload = serde_json::to_vec(&PageCursor {
        version: CURSOR_VERSION,
        updated_at,
        storage_id,
    })
    .map_err(|error| format!("Failed to encode vault cursor: {error}"))?;
    Ok(general_purpose::URL_SAFE_NO_PAD.encode(payload))
}

fn decode_cursor(cursor: Option<String>) -> Result<Option<PageCursor>, String> {
    let Some(cursor) = cursor.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };
    let payload = general_purpose::URL_SAFE_NO_PAD
        .decode(cursor)
        .map_err(|_| "Invalid vault cursor".to_string())?;
    let decoded: PageCursor =
        serde_json::from_slice(&payload).map_err(|_| "Invalid vault cursor".to_string())?;
    if decoded.version != CURSOR_VERSION {
        return Err("Unsupported vault cursor version".to_string());
    }
    Ok(Some(decoded))
}

impl LocalVault {
    pub(super) fn list_records_page(
        &self,
        user_id: &str,
        collection: &str,
        cursor: Option<String>,
        limit: Option<i64>,
    ) -> Result<VaultRecordsPage, String> {
        let cursor = decode_cursor(cursor)?;
        let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT).clamp(1, MAX_PAGE_LIMIT);
        let (cursor_updated_at, cursor_storage_id) = cursor
            .map(|value| (value.updated_at, value.storage_id))
            .unwrap_or_default();
        let mut stmt = self
            .conn
            .prepare(
                r#"
            SELECT storage_id, record_id, record_type, collection, updated_at,
                   tombstone, nonce, ciphertext, aad
            FROM vault_records
            WHERE user_id = ?1 AND collection = ?2
              AND (?3 = '' OR updated_at < ?3 OR (updated_at = ?3 AND storage_id < ?4))
            ORDER BY updated_at DESC, storage_id DESC
            LIMIT ?5
            "#,
            )
            .map_err(|error| {
                log::error!("Failed preparing vault page: {error}");
                redacted_error("Failed to list local vault records")
            })?;
        let rows = stmt
            .query_map(
                params![
                    user_id,
                    collection,
                    cursor_updated_at,
                    cursor_storage_id,
                    limit + 1
                ],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        EncryptedRow {
                            record_id: row.get(1)?,
                            record_type: row.get(2)?,
                            collection: row.get(3)?,
                            updated_at: row.get(4)?,
                            tombstone: row.get::<_, i64>(5)? != 0,
                            nonce: row.get(6)?,
                            ciphertext: row.get(7)?,
                            aad: row.get(8)?,
                        },
                    ))
                },
            )
            .map_err(|error| {
                log::error!("Failed listing vault page: {error}");
                redacted_error("Failed to list local vault records")
            })?;
        let mut encrypted_rows = rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
            log::error!("Failed reading vault page row: {error}");
            redacted_error("Failed to list local vault records")
        })?;
        let has_more = encrypted_rows.len() > limit as usize;
        encrypted_rows.truncate(limit as usize);
        let next_cursor = if has_more {
            encrypted_rows
                .last()
                .map(|(storage_id, encrypted)| {
                    encode_cursor(encrypted.updated_at.clone(), storage_id.clone())
                })
                .transpose()?
        } else {
            None
        };
        let records = encrypted_rows
            .into_iter()
            .map(|(_, encrypted)| self.decrypt_row(encrypted))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(VaultRecordsPage {
            records,
            next_cursor,
        })
    }

    pub(super) fn compare_and_swap_record(
        &self,
        input: VaultCompareAndSwapInput,
    ) -> Result<VaultCompareAndSwapResult, String> {
        let expected = input.expected_updated_at.clone();
        let record = input.record;
        self.ensure_manifest(record.user_id.trim())?;
        let updated_at = record.updated_at.clone().unwrap_or_else(now_iso);
        let created_at = now_iso();
        let nonce_bytes = random_bytes::<12>();
        let nonce = Nonce::from_slice(&nonce_bytes);
        let aad = json!({
            "user_id": record.user_id, "collection": record.collection,
            "record_id": record.record_id, "schema_version": VAULT_SCHEMA_VERSION,
            "key_version": ACTIVE_KEY_VERSION,
        })
        .to_string();
        let plaintext = serde_json::to_vec(&record.payload)
            .map_err(|_| redacted_error("Failed to write local vault record"))?;
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|_| redacted_error("Failed to write local vault record"))?;
        let ciphertext = cipher
            .encrypt(
                nonce,
                Payload {
                    msg: &plaintext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| redacted_error("Failed to write local vault record"))?;
        let row_storage_id = storage_id(&record.user_id, &record.collection, &record.record_id);
        let tombstone = record.tombstone.unwrap_or(false);
        let changed = if let Some(expected_updated_at) = expected {
            self.conn.execute(
                r#"UPDATE vault_records SET record_type = ?2, updated_at = ?3, tombstone = ?4,
                    key_version = ?5, algorithm = 'AES-256-GCM', nonce = ?6,
                    ciphertext = ?7, aad = ?8 WHERE storage_id = ?1 AND updated_at = ?9"#,
                params![
                    &row_storage_id,
                    &record.record_type,
                    &updated_at,
                    if tombstone { 1 } else { 0 },
                    ACTIVE_KEY_VERSION,
                    general_purpose::STANDARD.encode(nonce_bytes),
                    general_purpose::STANDARD.encode(ciphertext),
                    &aad,
                    expected_updated_at
                ],
            )
        } else {
            self.conn.execute(
                r#"INSERT OR IGNORE INTO vault_records (
                    storage_id, user_id, record_id, record_type, collection, updated_at,
                    tombstone, key_version, algorithm, nonce, ciphertext, aad, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'AES-256-GCM', ?9, ?10, ?11, ?12)"#,
                params![
                    &row_storage_id,
                    &record.user_id,
                    &record.record_id,
                    &record.record_type,
                    &record.collection,
                    &updated_at,
                    if tombstone { 1 } else { 0 },
                    ACTIVE_KEY_VERSION,
                    general_purpose::STANDARD.encode(nonce_bytes),
                    general_purpose::STANDARD.encode(ciphertext),
                    &aad,
                    &created_at
                ],
            )
        }
        .map_err(|error| {
            log::error!("Failed compare-and-swap vault write: {error}");
            redacted_error("Failed to write local vault record")
        })?;
        if changed == 0 {
            return Ok(VaultCompareAndSwapResult {
                applied: false,
                record: None,
                current: self.get_record(&record.user_id, &record.collection, &record.record_id)?,
            });
        }
        Ok(VaultCompareAndSwapResult {
            applied: true,
            record: Some(VaultRecordMetadata {
                id: record.record_id,
                collection: record.collection,
                record_type: record.record_type,
                updated_at,
                tombstone,
                key_version: ACTIVE_KEY_VERSION,
                algorithm: "AES-256-GCM".to_string(),
            }),
            current: None,
        })
    }
}
