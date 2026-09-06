use super::VAULT_DB_NAME;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use std::path::{Path, PathBuf};

fn legacy_vault_dir() -> PathBuf {
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

fn sanitized_user_dir_name(user_id: &str) -> Result<String, String> {
    let trimmed = user_id.trim();
    if trimmed.is_empty() {
        return Err("User ID is required to open the local vault".to_string());
    }
    let sanitized = trimmed
        .chars()
        .take(96)
        .map(|character| match character {
            value if value.is_ascii_alphanumeric() => value,
            '-' | '_' => character,
            _ => '-',
        })
        .collect::<String>();
    if sanitized.is_empty() {
        return Err("User ID is invalid for local vault storage".to_string());
    }
    Ok(sanitized)
}

pub(super) fn account_vault_dir(root: &Path, user_id: &str) -> Result<PathBuf, String> {
    Ok(root
        .join(sanitized_user_dir_name(user_id)?)
        .join("Ritual Vault"))
}

fn legacy_vault_contains_user(user_id: &str) -> bool {
    let legacy_db_path = legacy_vault_dir().join(VAULT_DB_NAME);
    if !legacy_db_path.exists() {
        return false;
    }
    let Ok(conn) = Connection::open_with_flags(&legacy_db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return false;
    };
    conn.query_row(
        "SELECT 1 FROM vault_manifest WHERE user_id = ?1 LIMIT 1",
        params![user_id],
        |_| Ok(()),
    )
    .optional()
    .ok()
    .flatten()
    .is_some()
}

pub(super) fn resolved_vault_dir(user_id: &str) -> Result<PathBuf, String> {
    let account_dir = account_vault_dir(&legacy_vault_dir().join("vaults"), user_id)?;
    if account_dir.join(VAULT_DB_NAME).exists() {
        return Ok(account_dir);
    }
    // Preserve legacy encrypted stores while isolating every newly created account.
    if legacy_vault_contains_user(user_id.trim()) {
        return Ok(legacy_vault_dir());
    }
    Ok(account_dir)
}
