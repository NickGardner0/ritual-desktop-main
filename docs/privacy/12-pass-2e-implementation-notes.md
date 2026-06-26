# Pass 2E Implementation Notes

Date: 2026-06-23

Status: implemented for the approved scope: optional E2EE private sync envelopes.

## Implemented Scope

Pass 2E adds a ciphertext-only envelope foundation for syncing local vault records through the backend without exposing record payloads to backend code.

- Added `private_sync_envelopes` backend schema and SQLAlchemy model.
- Added backend service helpers for envelope put, delta list, and remote encrypted-envelope deletion.
- Added backend routes:
  - `POST /api/privacy/e2ee/envelopes`
  - `GET /api/privacy/e2ee/envelopes`
  - `DELETE /api/privacy/e2ee/envelopes`
- Gated the routes through the existing encrypted-sync privacy policy path.
- Added dashboard WebCrypto AES-GCM envelope encryption/decryption in `apps/dashboard/lib/privacy/vault-private-sync.ts`.
- Stored the local Private Sync key as an encrypted local vault record in `private_sync_state`.
- Added Privacy settings controls for Private Sync setup, encrypted push, and encrypted pull.
- Extended static privacy verification for E2EE envelope paths.

## Server-Side Storage Boundary

The backend stores only:

- envelope id;
- user id;
- collection and opaque record id;
- record type;
- client revision and server revision;
- key version and algorithm;
- nonce;
- AAD;
- ciphertext;
- ciphertext hash;
- tombstone flag;
- client updated timestamp and client id.

The backend API and service do not accept plaintext record payload fields for Private Sync envelopes. The server can deduplicate, order, and relay envelopes, but it has no decrypt path.

## Client-Side Sync Boundary

The dashboard client:

1. Initializes the desktop local vault.
2. Creates or reuses a Private Sync AES-GCM key stored in the encrypted local vault.
3. Reads selected local vault categories.
4. Encrypts each local record with authenticated metadata.
5. Uploads only envelope metadata and ciphertext.
6. Pulls remote envelopes by server revision.
7. Decrypts envelopes locally and writes records back into the local vault.

Duplicate unchanged records are skipped using local Private Sync state, so repeated pushes do not re-encrypt and churn the server when local records are unchanged.

## Supported Categories

Private Sync can push the same local vault categories supported by Pass 2C migration:

- `habit_definitions`
- `habit_logs`
- `scheduled_blocks`
- `import_runs`
- `import_items`
- `wearable_samples`
- `wearable_events`
- `location_pings`
- `location_state`
- `ai_conversations`
- `ai_messages`
- `ai_facts`
- `artifacts`
- `reports`
- `workflows`
- `sms_copilot`
- `financial_accounts`
- `financial_transactions`

## Known Limitations

- This stage originally shipped an envelope foundation, not a complete multi-device sync product.
- A later hardening pass added recovery kits, trusted-device pairing kits, key rotation, local conflict records, and conflict review/resolution controls. See `14-final-remaining-pass-2-implementation-notes.md`.
- A later scoped pass added backend trusted-device registration, key-grant storage, and per-device revoke enforcement. Automatic second-device key-grant application and post-revoke key rotation remain future hardening.
- The server stores metadata such as collection, record id, record type, revisions, client id, and timestamps.
- Private Sync itself does not export files. File-over-App Ritual Vault export/import was later implemented as Pass 2F.
- External erasure controls were later added for Private Sync envelopes, Tinybird, and Typesense. OpenPanel, Sentry, Trigger.dev, and provider-side erasure remain manual-required receipt workflows unless their provider APIs are wired and tested.

## Verification Commands

Commands run during implementation:

- `pytest tests/test_privacy_private_sync.py tests/test_privacy_policy.py` from `apps/backend`
- `node --import tsx --test apps/dashboard/tests/privacy-vault-private-sync.test.ts`
- `node --import tsx --test apps/dashboard/tests/privacy-vault-private-sync.test.ts apps/dashboard/tests/privacy-vault-migration.test.ts apps/dashboard/tests/privacy-vault-deletion.test.ts apps/dashboard/tests/privacy-settings.test.mjs`
- `npm run api:openapi && npm run api:generate-client`
- `npm run privacy:verify`
- `npm run typecheck`
- `npm run lint`
- `pytest tests/test_privacy_private_sync.py tests/test_privacy_migration_inventory.py tests/test_privacy_policy.py` from `apps/backend`
- `node --import tsx --test apps/dashboard/tests/privacy-vault-private-sync.test.ts apps/dashboard/tests/privacy-vault-migration.test.ts apps/dashboard/tests/privacy-vault-deletion.test.ts apps/dashboard/tests/privacy-local-vault.test.ts apps/dashboard/tests/privacy-habit-vault-adapter.test.ts apps/dashboard/tests/privacy-settings.test.mjs`
- `pytest tests` from `apps/backend`
- `npm run test:dashboard`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `npm run repo:check`
- `npm run build`
- `git diff --check`

Observed non-blocking warnings:

- Next used the WASM SWC fallback because `@next/swc-darwin-arm64` is not installed locally.
- Browserslist data is stale.
- Backend tests still emit existing Pydantic/SQLAlchemy/datetime deprecation warnings outside the new private sync service.
- Desktop tests still emit existing unused test helper warnings.
