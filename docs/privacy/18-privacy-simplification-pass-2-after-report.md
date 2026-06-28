# Privacy Simplification Pass 2 After Report

Date: 2026-06-26

Status: implemented for the approved simplification scope.

## Approved Direction

The approved V1 architecture is Option A:

- Encrypted local DB/local vault remains the canonical source of truth for sensitive behavioral records.
- File-over-App remains user-facing through Ritual Vault export/import and mirror-style artifacts, not as the live runtime database.
- Live file-native runtime, native folder watching, native file index/search/retrieval, and broad `.ritual/data/*.jsonl` runtime adapters are deferred.
- Private Sync was simplified to encrypted envelopes first. A follow-up scoped pass now adds device registration, key-grant storage, and per-device revoke enforcement.

## Implemented Changes

- Removed `PrivacySettings.storageMode` and `vaultPath` from the active settings model so the app no longer switches into a live `file_native` runtime mode.
- Removed dashboard live file-native read/write branches from habits, calendar, reports, metrics, command palette, chat context, providers, and privacy settings.
- Deleted live file-native dashboard modules, bridge components, diagnostics UI, and file-native implementation-detail tests.
- Removed native Tauri file-native watcher and index commands, permissions, Rust modules, and index schema constants.
- Kept Ritual Vault export/import as the File-over-App boundary, including the existing encrypted export wrapper around archive bytes.
- Added first-run onboarding and settings controls for choosing a Ritual Vault folder and writing a one-way readable folder mirror from the encrypted local vault.
- Removed local-vault-to-file-native promotion. Migration now targets the canonical local vault only.
- Simplified deletion and external-erasure receipts to local vault receipts instead of mirroring into a file-native folder.
- Simplified Private Sync backend and client paths around opaque encrypted envelopes, then added a scoped trusted-device registry/key-grant ledger so revoked devices cannot push or pull future envelopes.
- Regenerated the backend OpenAPI document and dashboard generated client after the API simplification.
- Rewrote the privacy guardrail verifier to require the retained V1 privacy guarantees, forbid the deferred live file-native paths, and require the active Private Sync device-revoke paths.

## Current Data Model

The active runtime model is:

```text
User action
  -> privacy settings and policy checks
  -> encrypted local vault/local DB for sensitive records
  -> optional cloud migration/deletion APIs when explicitly requested
  -> optional encrypted Private Sync envelopes gated by active device registration
  -> optional Ritual Vault export/import artifacts and one-way folder mirror
```

The Ritual Vault folder is not treated as the app database. Markdown, JSONL, and archive files are export/import or mirror artifacts derived from local records.

## Deferred Work

- Live Obsidian-style Markdown-as-database runtime.
- Native folder watcher and bidirectional external edit handling.
- Native file index/search/retrieval/analytics over a Ritual folder.
- Per-object Obsidian-style Markdown paths/frontmatter and round-trip parsers.
- File-native workflow scheduling and report runtime.
- Automatic second-device trust ceremony with device keypairs, encrypted key-grant application, and post-revoke key rotation.
- A true encrypted ZIP container format. Current encrypted Ritual Vault export remains a JSON encryption wrapper around the ZIP bytes.

## Verification

Completed during this pass:

- `node scripts/verify-privacy-guardrails.mjs`
- `node --import tsx --test apps/dashboard/tests/privacy-vault-deletion.test.ts apps/dashboard/tests/privacy-external-erasure.test.ts apps/dashboard/tests/privacy-vault-migration.test.ts apps/dashboard/tests/privacy-vault-private-sync.test.ts apps/dashboard/tests/privacy-ritual-vault-export.test.ts apps/dashboard/tests/privacy-local-vault.test.ts apps/dashboard/tests/privacy-habit-vault-adapter.test.ts apps/dashboard/tests/privacy-settings.test.mjs`
- `python3 -m pytest apps/backend/tests/test_privacy_private_sync.py apps/backend/tests/test_privacy_external_erasure.py apps/backend/tests/test_privacy_migration_inventory.py apps/backend/tests/test_privacy_policy.py`
- `npm run repo:check:generated-client`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `npm run repo:check`
- `git diff --check`

Observed non-blocking warnings:

- Next used the WASM SWC fallback because the native `@next/swc-darwin-arm64` package is not installed locally.
- Browserslist data is stale.
- Rust tests emitted existing unused-test-helper warnings in desktop runtime modules.
