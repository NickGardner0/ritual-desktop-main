//! Local encrypted vault schema.

pub const VAULT_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS vault_manifest (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    vault_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    root_key_label TEXT,
    active_key_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vault_records (
    storage_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    record_type TEXT NOT NULL,
    collection TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    tombstone INTEGER NOT NULL DEFAULT 0,
    key_version INTEGER NOT NULL DEFAULT 1,
    algorithm TEXT NOT NULL,
    nonce TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    aad TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_records_user_collection_updated
    ON vault_records(user_id, collection, updated_at);

CREATE INDEX IF NOT EXISTS idx_vault_records_type_tombstone
    ON vault_records(record_type, tombstone);

CREATE TABLE IF NOT EXISTS vault_migration_inventory (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    category TEXT NOT NULL,
    record_count INTEGER NOT NULL,
    byte_count INTEGER,
    min_updated_at TEXT,
    max_updated_at TEXT,
    sampled_hash TEXT,
    status TEXT NOT NULL,
    error TEXT,
    checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_migration_manifest (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    migration_id TEXT NOT NULL,
    categories TEXT NOT NULL,
    status TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    local_hash TEXT,
    record_count INTEGER NOT NULL,
    migrated_count INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_migration_manifest_user_updated
    ON vault_migration_manifest(user_id, updated_at);

CREATE TABLE IF NOT EXISTS vault_deletion_receipt (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    deletion_id TEXT NOT NULL,
    categories TEXT NOT NULL,
    status TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    requested_record_count INTEGER NOT NULL,
    deleted_count INTEGER NOT NULL,
    backend_receipts TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_deletion_receipt_user_updated
    ON vault_deletion_receipt(user_id, updated_at);
"#;
