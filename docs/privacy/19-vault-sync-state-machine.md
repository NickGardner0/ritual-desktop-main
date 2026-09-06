# Vault Sync State Machine

**Status:** Implementation guide
**Date:** 2026-07-05

The dashboard now treats vault sync as one module with explicit adapters:

- `TauriVaultAdapter` — desktop production adapter for the encrypted local vault.
- `WebCryptoVaultAdapter` — browser/local production adapter when a passphrase-backed WebCrypto store is configured.
- `InMemoryVaultAdapter` — test adapter only.

## States

| State | Meaning | Allowed next states |
|---|---|---|
| `uninitialized` | No local vault status has been established for the current user. | `local_initialized` |
| `local_initialized` | Local encrypted storage is available and can read/write records. | `pairing_export_pending`, `sync_ready`, `deletion_pending` |
| `pairing_export_pending` | A recovery bundle, pairing bundle, or export archive is being created/imported. | `sync_ready`, `conflict` |
| `sync_ready` | Local records, private sync envelopes, keyring state, and outbox replay can run. | `conflict`, `deletion_pending` |
| `conflict` | Pull/push found records requiring explicit conflict handling. | `sync_ready`, `deletion_pending` |
| `deletion_pending` | Local deletion receipts or external erasure receipts are being written. | `deletion_complete`, `conflict` |
| `deletion_complete` | Local deletion receipts are durable and old data is no longer read by app flows. | `local_initialized` |

## Interface Rules

- Habit and task local-vault reads/writes must go through `VaultSync`.
- Runtime-specific storage is behind adapters; callers should not import Tauri command helpers directly for new vault flows.
- In-memory storage validates interface behavior in tests only. It does not justify an external seam by itself.
- Migration/export/private-sync modules may remain as internal implementation during migration, but they should not become new direct app call surfaces.

## Completion Criteria

- Habit and task adapters use `VaultSync`.
- Migration, export, deletion, private-sync, keyring, and device helpers depend on the same facade or are explicitly marked internal.
- Interface-level tests cover Tauri-shaped behavior through `InMemoryVaultAdapter`.
- Browser WebCrypto support is only enabled with an explicit passphrase/storage configuration.
