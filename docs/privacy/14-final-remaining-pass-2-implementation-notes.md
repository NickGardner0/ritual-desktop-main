# Final Remaining Pass 2 Implementation Notes

Date: 2026-06-24

Status: implemented for the remaining in-repo privacy gaps after Pass 2F.

## Implemented Scope

This pass closes the prior limitations around Private Sync hardening, encrypted File-over-App archives, and API-backed external erasure.

### Private Sync Hardening

Added:

- multi-key Private Sync keyring with backward compatibility for the original single-key record;
- key rotation that preserves retired keys for decrypting older envelopes;
- passphrase-encrypted recovery kit export/import;
- passphrase-encrypted trusted-device pairing kit export/import;
- local conflict detection during pull;
- local conflict records in `private_sync_conflicts`;
- conflict review/resolution controls in Privacy settings.

Primary files:

- `apps/dashboard/lib/privacy/vault-private-sync-crypto.ts`
- `apps/dashboard/lib/privacy/vault-private-sync-keyring.ts`
- `apps/dashboard/lib/privacy/vault-private-sync.ts`
- `apps/dashboard/components/privacy-private-sync-hardening-section.tsx`
- `apps/dashboard/tests/privacy-vault-private-sync.test.ts`

### Encrypted Ritual Vault Archives

Added:

- `ritual-vault-encrypted` JSON wrapper format;
- PBKDF2-SHA256 derived AES-GCM archive encryption;
- ciphertext checksum verification before decrypt;
- encrypted export UI and passphrase-aware import;
- tests proving the encrypted wrapper does not expose exported habit names, notes, or category metadata.

The original readable ZIP format remains supported for File-over-App portability. Sensitive exports should use the encrypted wrapper.

Primary files:

- `apps/dashboard/lib/privacy/ritual-vault-export.ts`
- `apps/dashboard/components/privacy-vault-export-section.tsx`
- `apps/dashboard/tests/privacy-ritual-vault-export.test.ts`

### External Erasure Controls

Added:

- external erasure plan and execute API routes;
- explicit confirmation requirement;
- local deletion receipt client;
- Tinybird user-scoped delete calls for sensitive datasources;
- Typesense user-scoped delete calls for sensitive search collections;
- Private Sync envelope deletion in the external erasure flow;
- manual-required receipts for OpenPanel, Sentry, Trigger.dev, and provider-side erasure where no trusted in-repo API exists.

Primary files:

- `apps/backend/services/privacy_external_erasure.py`
- `apps/backend/api/privacy.py`
- `apps/backend/services/search_service.py`
- `apps/backend/tests/test_privacy_external_erasure.py`
- `apps/dashboard/lib/privacy/external-erasure.ts`
- `apps/dashboard/components/privacy-external-erasure-section.tsx`
- `apps/dashboard/tests/privacy-external-erasure.test.ts`

## Remaining Limitations

- Per-device Private Sync revoke is implemented in `docs/privacy/15-private-sync-device-revoke-and-ritual-folder-notes.md`.
- Private Sync revoke is forward-looking. It blocks future envelope/key-grant access for the revoked device id, but it does not yet rotate replacement keys for remaining active devices and cannot erase data already downloaded onto a revoked device.
- OpenPanel, Sentry, Trigger.dev, and external provider erasure are receipt-backed manual workflows unless their APIs are wired with account-specific credentials and tested deletion contracts.
- Tinybird delete counts depend on Tinybird's Delete API response. Some successful Tinybird delete jobs may report completion without row counts.
- Typesense erasure depends on the configured Typesense collection schemas retaining `user_id` as a facet/filterable field.
- The encrypted Ritual Vault wrapper is a JSON envelope around the ZIP bytes, not an encrypted ZIP format. This keeps import simple and avoids pretending JSZip can write encrypted ZIPs.
- A later File-over-App pass added first-run folder selection and a one-way readable Ritual folder mirror. The live Obsidian-style Markdown-as-database runtime remains deferred.

## Verification Commands

Focused commands run for this pass:

- `node --import tsx --test apps/dashboard/tests/privacy-vault-private-sync.test.ts`
- `node --import tsx --test apps/dashboard/tests/privacy-ritual-vault-export.test.ts`
- `pytest tests/test_privacy_external_erasure.py -q` from `apps/backend`
- `node --import tsx --test apps/dashboard/tests/privacy-external-erasure.test.ts`
- `npm run privacy:verify`
- `npm run typecheck`
- `npm run lint`
- `node --import tsx --test apps/dashboard/tests/privacy-*.test.ts apps/dashboard/tests/privacy-settings.test.mjs`
- `pytest tests/test_privacy_policy.py tests/test_privacy_migration_inventory.py tests/test_privacy_private_sync.py tests/test_privacy_external_erasure.py -q` from `apps/backend`
- `npm run api:openapi && npm run api:generate-client`
- `pytest tests` from `apps/backend`
- `npm run test:dashboard`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `git diff --check`
- `npm run repo:check`
- `npm run build`

Observed non-blocking warnings:

- Backend privacy tests still emit the existing SQLAlchemy `declarative_base()` deprecation warning.
- Full backend tests still emit existing Pydantic/SQLAlchemy/datetime/pytest return-value deprecation warnings.
- Desktop tests still emit existing unused test helper warnings.
- Next build still uses WASM SWC fallback because `@next/swc-darwin-arm64` is not installed locally, and Browserslist data is stale.
