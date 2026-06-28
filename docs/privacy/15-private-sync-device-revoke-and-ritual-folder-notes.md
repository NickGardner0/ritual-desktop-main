# Private Sync Device Revoke and Ritual Folder Notes

Date: 2026-06-24

Updated: 2026-06-26

Status: scoped device revoke and one-way Ritual folder mirror implemented; live bidirectional Ritual folder remains a proposed next stage.

## Device Revoke Implementation

This pass adds a trusted device registry and encrypted key-grant ledger for Private Sync.

Implemented:

- backend `private_sync_devices` table for per-user trusted devices;
- backend `private_sync_key_grants` table for ciphertext-only sync-key grants addressed to a recipient device;
- `/api/privacy/e2ee/devices` register/list routes;
- `/api/privacy/e2ee/devices/{device_id}/revoke` route;
- `/api/privacy/e2ee/key-grants` put/list routes;
- `x-ritual-private-sync-device-id` enforcement on Private Sync envelope and key-grant operations;
- local-only storage of a per-machine Private Sync device id in the encrypted local vault;
- client registration before envelope push/pull;
- settings UI for registering the current device, listing devices, and revoking a device.

The backend never receives raw Private Sync record contents. It stores device metadata, encrypted grants, encrypted envelopes, and minimal routing metadata.

Not yet implemented in this scoped pass:

- client-side device public/private keypairs for automatic key grants;
- automatic encrypted key-grant publishing from one active device to a newly pending device;
- automatic key-grant application on recipient devices;
- automatic Private Sync key rotation after revoke.

The backend key-grant ledger exists and is tested, but the current UI does not yet provide a complete second-device trust ceremony.

## Revoke Semantics

Revocation is forward-looking:

- a revoked device cannot upload or pull Private Sync envelopes once the user has any registered devices;
- a revoked device cannot fetch key grants;
- a revoked device cannot revoke other devices because revoke requires an active requester device once a registry exists;
- a revoked device cannot be re-registered with the same device id;
- a pending device cannot upload or pull envelopes until an active device stores a key grant for it.

Revocation is forward-looking and does not erase data already downloaded onto a device before revocation. Without automatic post-revoke key rotation, a revoked device that already has the local keyring could still decrypt ciphertext it obtained before revoke; the backend now blocks future envelope and key-grant access for that device id.

## Current Ritual and Habit Storage Formats

Ritual currently has several formats, each serving a different purpose.

### Local Vault App State

The local sensitive source of truth is the desktop local vault:

- default directory: `~/.ritual`, unless `RITUAL_VAULT_DIR` is set;
- database file: `vault.db`;
- key file: `vault.key`;
- table: `vault_records`;
- payload format before encryption: JSON;
- at-rest encryption: `AES-256-GCM`;
- visible metadata: `user_id`, `collection`, `record_id`, `record_type`, `updated_at`, `tombstone`, `key_version`, `algorithm`, `nonce`, `aad`.

Habit data uses these collections:

- habit definitions: `habit_definitions`, record type `habit_definition`;
- habit logs: `habit_logs`, record type `habit_log`.

The decrypted in-app record shape is:

```json
{
  "id": "habit-or-log-id",
  "collection": "habit_logs",
  "recordType": "habit_log",
  "payload": {},
  "updatedAt": "2026-06-24T00:00:00Z",
  "tombstone": false
}
```

The actual SQLite row stores encrypted payload bytes, not the plaintext `payload`.

### Private Sync Transport

Private Sync stores ciphertext-only sync envelopes on the backend:

- table: `private_sync_envelopes`;
- encryption: client-side `AES-256-GCM`;
- visible metadata: `collection`, `record_id`, `record_type`, `revision`, `server_revision`, `key_version`, `tombstone`, timestamps, client/device routing fields;
- ciphertext fields: `nonce`, `ciphertext`, `aad`, `ciphertext_sha256`.

### Ritual Vault Export

The current File-over-App export is a ZIP with this root:

```text
Ritual Vault/
  manifest.json
  checksums.sha256
  schema/ritual-vault.schema.json
  data/<category>.jsonl
  markdown/<category>.md
  metadata/migration-manifests.json
  metadata/deletion-receipts.json
```

Each `data/<category>.jsonl` line contains:

```json
{
  "collection": "habit_logs",
  "record_id": "log-id",
  "record_type": "habit_log",
  "updated_at": "2026-06-24T00:00:00Z",
  "tombstone": false,
  "payload": {}
}
```

Each `markdown/<category>.md` file is a human-readable projection of the same records. The encrypted export option is currently a `ritual-vault-encrypted` JSON wrapper around the ZIP bytes, encrypted with passphrase-derived `AES-GCM`.

## Current Obsidian-Style Ritual Folder Scope

An Obsidian-like folder is currently treated as a durable user-owned projection, not as the operational database.

Implemented:

- first-run onboarding includes a `Ritual Vault folder` picker;
- settings includes folder selection and manual `Mirror` controls;
- the selected folder is stored separately from runtime privacy mode;
- the app writes the same File-over-App files used by ZIP export directly into the chosen folder:
  - `manifest.json`
  - `checksums.sha256`
  - `schema/ritual-vault.schema.json`
  - `data/<category>.jsonl`
  - `markdown/<category>.md`
  - `metadata/migration-manifests.json`
  - `metadata/deletion-receipts.json`
- the mirror is one-way from the encrypted local vault/local DB into readable files.

Not yet implemented:

- per-object hand-authored paths such as `Habits/<habit-slug>.md`, `Logs/YYYY/MM/YYYY-MM-DD.md`, `Reports/<report-id>.md`, and `Workflows/<workflow-id>.md`;
- hidden `.ritual/manifest.json`, `.ritual/checksums.json`, and `.ritual/index.jsonl` layout;
- stable frontmatter on editable Markdown files, for example:

```yaml
---
ritual_id: habit-id
ritual_collection: habit_definitions
ritual_record_type: habit_definition
ritual_schema_version: 1
ritual_updated_at: "2026-06-24T00:00:00Z"
ritual_tombstone: false
---
```

- parser and round-trip tests for habits and logs;
- file watcher, debounce, checksum comparison, and conflict records;
- bidirectional editing.

Sensitive categories remain excluded from the standard plaintext folder mirror by default: financial data, raw location, AI conversations/facts, screenshots/OCR, raw provider payloads, and SMS/copilot records.
