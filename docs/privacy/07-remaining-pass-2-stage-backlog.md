# Remaining Pass 2 Stage Backlog

Date: 2026-06-24

Status: historical planning artifact. Pass 2B, Pass 2C, the Pass 2C extension, Pass 2D, Pass 2E, Pass 2F, and the final remaining in-repo hardening work have been implemented. Residual provider/device limitations are documented in `14-final-remaining-pass-2-implementation-notes.md`.

## Purpose

This backlog broke the remaining Pass 2 work into reviewable packets. It is retained as historical context for the staged implementation and the residual provider/device limitations.

## Pass 2B: Local Vault Source-of-Truth and Migration Inventory/Dry-Run

Approval phrase:

`Approved for Pass 2B: implement local sensitive vault source-of-truth foundation and migration inventory/dry-run only.`

### 2B.1 Desktop Vault Storage

- Add a desktop vault module under `apps/desktop/src-tauri/src/` or `apps/desktop/src-tauri/crates/ritual-db/src/` depending on whether key management lives in app code or the DB crate.
- Create/open `~/.ritual/vault.db`.
- Add `vault_records`, `vault_manifest`, and `vault_migration_inventory` schema.
- Add tests for schema creation and reopen behavior.
- Ensure no cloud sync trigger is attached to `vault.db`.

Done when:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml vault` passes.
- A test confirms the vault opens offline and does not require `TURSO_SYNC_URL`.

### 2B.2 Vault Key Handling

- Generate a local vault root key on first initialization.
- Store key material in platform secure storage where available.
- Store only key labels/version metadata in `vault_manifest`.
- Keep recovery phrase/file and multi-device key exchange out of this stage.

Done when:

- tests prove key metadata is present but raw key material is not persisted in `vault.db`;
- errors are redacted and do not log key material.

### 2B.3 Encrypted Habit and Log Records

- Add record codecs for `habit_definitions` and `habit_logs`.
- Encrypt full payloads with AES-GCM and authenticated metadata.
- Keep only allowed metadata plaintext: opaque ID, collection, timestamps, tombstone, algorithm, key version, nonce/AAD.
- Add tombstone support for deletes without cloud deletion.

Done when:

- tests write sample habit/log records and confirm plaintext habit names, notes, log metadata, and location labels are absent from DB bytes;
- records decrypt back to existing dashboard/backend shapes.

### 2B.4 Tauri Vault Commands

- Add commands for status, initialize, put, get, list, and tombstone.
- Register commands in `apps/desktop/src-tauri/src/main.rs`.
- Ensure command responses are typed and redacted.

Done when:

- command-level or module-level tests cover put/list/tombstone;
- command error strings do not include payloads.

### 2B.5 Dashboard Vault Adapter

- Add `apps/dashboard/lib/privacy/vault-client.ts`.
- Add `apps/dashboard/lib/privacy/habit-vault-adapter.ts`.
- Update habit/log query hooks to prefer local vault records only in desktop with initialized vault.
- Preserve backend fallback when local vault is absent or empty.
- Keep backend writes in Cloud Intelligence/uninitialized modes.

Done when:

- dashboard tests cover local-first read and backend fallback;
- Local Only + initialized vault does not call backend for local habit/log reads.

### 2B.6 Migration Inventory

- Add backend inventory service with category counts and safe metadata only.
- Cover backend Turso tables first, then Tinybird/Typesense counts where supported.
- Add dashboard Privacy UI surface for inventory status.
- Do not delete anything.

Done when:

- backend tests cover table count categories;
- inventory calls do not trigger provider sync or AI/cloud analysis;
- `scripts/verify-privacy-guardrails.mjs` covers inventory egress.

### 2B.7 Migration Dry-Run

- Add dry-run path for sampling habit definitions and habit logs.
- Encrypt sample records into staging records or isolated staging collection.
- Verify sample counts/hashes locally.
- Clean staging records unless a later approved migration stage promotes them.

Done when:

- dry-run is idempotent;
- cloud source data is unchanged;
- tests prove staging cleanup.

## Pass 2C: Actual Cloud-to-Local Migration

Approval phrase:

`Approved for Pass 2C: implement user-controlled migration of approved cloud behavioral data into the local vault.`

Status: implemented for supported categories and later extended to additional approved categories. See `09-pass-2c-implementation-notes.md` and `10-pass-2c-extension-implementation-notes.md`.

### 2C.1 Migration Wizard

- Add UI flow showing categories, counts, size estimates, and risks.
- Require explicit confirmation before migration starts.
- Show progress, pause/resume, failure details, and retry state.

### 2C.2 Category Migration Services

- Implement migration adapters for habits/logs first.
- Add scheduled blocks, aliases, import runs, wearable projections, location-enriched logs, AI artifacts, reports, workflows, SMS/copilot, and financial data only after category-specific tests exist.
- Store a local migration manifest in the vault.

### 2C.3 Verification

- Verify counts and hashes per category.
- Support idempotent reruns.
- Leave cloud source data intact until Pass 2D deletion approval.

Done when:

- migration can be resumed after interruption;
- duplicate logs are not created;
- local manifest records category status, counts, hashes, timestamps, and source IDs.

## Pass 2D: Cloud Behavioral Deletion Controls

Approval phrase:

`Approved for Pass 2D: implement cloud behavioral deletion controls and local deletion receipts.`

Status: implemented for backend Turso behavioral rows that have approved local migration coverage. See `11-pass-2d-implementation-notes.md`.

### 2D.1 Deletion Coverage Map

- Enumerate account-required metadata versus behavioral data.
- Cover backend Turso tables, per-user Turso DBs, Tinybird datasources, Typesense collections, provider raw/debug/job tables, generated artifacts/reports/workflows/facts, SMS/copilot, financial records, Trigger logs where available, OpenPanel deletion where available, and Sentry limitations.

### 2D.2 Dry-Run and Execute

- Add dry-run deletion inventory.
- Add execute mode only after local migration verification.
- Preserve account metadata unless full account deletion is explicitly requested.

### 2D.3 Receipts and Status

- Add deletion status UI.
- Store immutable deletion receipts in local vault.
- Support retry for partial failures.

Done when:

- table-by-table tests prove behavioral deletion coverage;
- account metadata survives behavioral deletion;
- deletion is idempotent;
- receipts include services attempted, counts, timestamps, and failures.

Implemented boundaries:

- deletion requires a completed local migration manifest for each selected category;
- local deletion receipt is written before backend mutation;
- later stages added File-over-App export, Tinybird erasure, Typesense erasure, and Private Sync hardening; provider-side deletion, OpenPanel, Sentry, Trigger logs, and full per-device Private Sync revoke remain limitations or manual-required workflows.

## Pass 2E: Optional E2EE Private Sync

Approval phrase:

`Approved for Pass 2E: implement optional E2EE private sync envelopes.`

Status: implemented for the approved envelope foundation. See `12-pass-2e-implementation-notes.md`.

### 2E.1 Envelope API

- Add server endpoints for encrypted envelope upload, delta fetch, tombstones, revision ordering, and quota checks.
- Server stores ciphertext and minimal metadata only.
- Server never indexes sensitive ciphertext into Tinybird/Typesense.

Implemented boundaries:

- backend stores `private_sync_envelopes` rows with ciphertext, nonce, AAD, hashes, revision metadata, and client id;
- API is policy-gated to `private_sync` or `cloud_intelligence` mode through the encrypted-sync exception;
- backend does not accept or model plaintext payload fields for E2EE envelopes.

### 2E.2 Client Sync

- Add client-side encryption/decryption for vault records.
- Add local conflict resolution.
- Add offline edit then sync behavior.

Implemented boundaries:

- dashboard client uses WebCrypto AES-GCM to encrypt/decrypt selected local vault records;
- local Private Sync key material is stored as an encrypted local vault record;
- Privacy settings can create the key, push selected local categories, and pull/decrypt remote envelopes.

### 2E.3 Key Recovery and Device Management

- Add recovery phrase or recovery file.
- Add trusted-device pairing.
- Add device revoke and key rotation metadata.

Later implemented hardening:

- recovery kit export/import;
- trusted-device pairing kit export/import;
- key rotation with retired-key decrypt support;
- local conflict records;
- conflict review/resolution UI and multi-device edit tests.

Remaining future work:

- per-device revoke backed by a trusted device registry and key-grant ledger.

Done when:

- tests prove plaintext payloads never reach sync API;
- envelope upload/download tests pass for the foundation;
- multi-device conflict, recovery restore, and key-rotation tests pass; per-device revoke still needs a separate device-registry design.

## Pass 2F: File-over-App Ritual Vault Export and Import

Approval phrase:

`Approved for Pass 2F: implement File-over-App Ritual Vault export/import.`

Status: implemented for checksum-verified local-vault ZIP archives. See `13-pass-2f-implementation-notes.md`.

### 2F.1 Export Schema

- Add `Ritual Vault/manifest.json`.
- Add `schema/ritual-vault.schema.json`.
- Export readable habits, logs, daily summaries, artifacts, health summaries, activity summaries, imports, migration manifests, and deletion receipts.
- Add `checksums.sha256`.

Implemented boundaries:

- archive root is `Ritual Vault/`;
- each exported local-vault category has `data/<category>.jsonl` and `markdown/<category>.md`;
- archive includes `manifest.json`, `schema/ritual-vault.schema.json`, `metadata/migration-manifests.json`, `metadata/deletion-receipts.json`, and `checksums.sha256`;
- import validates checksums before writing records into the local vault.

### 2F.2 Sensitive Export Controls

- Exclude raw URLs, window titles, OCR, screenshots, visible text, raw provider payloads, raw location, AI conversations/facts, and financial transactions by default.
- Add explicit sensitive export toggles.
- Add encrypted archive option for full sensitive export.

Implemented boundaries:

- standard export excludes AI conversations/messages/facts, artifacts, imports, raw location categories, reports, SMS/copilot, workflows, financial accounts, and financial transactions by default;
- Privacy settings has an explicit `Include sensitive` export toggle;
- a later hardening pass added a passphrase-encrypted JSON wrapper around the ZIP bytes because JSZip does not provide encrypted ZIP output.

### 2F.3 Import and Round Trip

- Add schema validation.
- Add import preview.
- Add round-trip tests from export to fresh vault.

Done when:

- export/import tests pass;
- checksums validate;
- sensitive-default exclusion tests pass;
- large export streaming does not exhaust memory.

Implemented proof:

- `apps/dashboard/tests/privacy-ritual-vault-export.test.ts` covers default sensitive exclusion, explicit sensitive export, checksum validation, checksum tamper rejection, and local-vault round-trip import.

## Cross-Stage Verification Requirements

Every stage must keep these checks green unless the stage explicitly updates them:

```bash
npm run privacy:verify
npm run typecheck
npm run lint
npm run build
npm run test:dashboard
cd apps/backend && pytest tests
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml privacy_policy
```

Every stage that adds desktop Rust functionality must add a focused `cargo test` selector for that functionality.

Every stage that adds backend APIs must add tests under `apps/backend/tests/`.

Every stage that adds dashboard adapters/UI must add dashboard tests or explicit manual QA notes if automated coverage is not practical.
