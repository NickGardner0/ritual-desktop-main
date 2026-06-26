# Pass 2B Implementation Notes

Date: 2026-06-23

Status: implemented for the approved scope only: local sensitive vault source-of-truth foundation and migration inventory/dry-run.

## Implemented Scope

Pass 2B adds a durable desktop vault foundation without changing cloud deletion behavior or enabling E2EE sync.

- Added `apps/desktop/src-tauri/src/local_vault.rs` with `~/.ritual/vault.db`, `vault_manifest`, `vault_records`, and `vault_migration_inventory`.
- Added the vault DDL under the approved desktop schema boundary in `apps/desktop/src-tauri/crates/ritual-db/src/schema/vault.rs`.
- Added AES-256-GCM record encryption with authenticated metadata and redacted command errors.
- Added Tauri commands for vault initialize/status/put/get/list/tombstone and registered them in `apps/desktop/src-tauri/src/main.rs`.
- Added dashboard vault client and habit/log adapter in `apps/dashboard/lib/privacy/vault-client.ts` and `apps/dashboard/lib/privacy/habit-vault-adapter.ts`.
- Updated habit/log reads to prefer local vault records when present and fall back to existing backend data when the vault is absent or empty.
- Added backend migration inventory and dry-run endpoints in `apps/backend/api/privacy.py` and `apps/backend/services/privacy_migration_inventory.py`.
- Added Privacy settings UI for desktop vault status, backend inventory, and dry-run sampling.
- Extended `scripts/verify-privacy-guardrails.mjs` so the local vault and migration dry-run invariants are part of the privacy verification script.

## Guardrails

Pass 2B intentionally does not:

- delete cloud behavioral data;
- mark backend records as migrated;
- change the authoritative source for users with no local vault records;
- implement E2EE multi-device sync;
- implement File-over-App Ritual Vault export/import;
- migrate wearable, activity, AI, SMS, financial, or artifact data into the vault.

The dry-run samples only `habit_definitions` and `habit_logs`. When running outside Ritual Desktop, the UI reports that samples were fetched but local staging requires Ritual Desktop. In Ritual Desktop, samples are written to `migration_dry_run:*` staging collections and immediately tombstoned after verification.

## Known Limitations

- The desktop vault root key is currently stored in a local `vault.key` file with `0600` permissions on Unix, outside `vault.db`. Platform keychain storage, recovery, rotation, and trusted-device key exchange remain future work.
- Habit/log reads can prefer local vault records when present, but Pass 2B does not yet include the full user-controlled migration wizard or category promotion flow.
- Dry-run cleanup tombstones staging records rather than erasing all staging metadata, so the local vault can still account for dry-run attempts without retaining live staging payloads.

## Verification

Commands run for this stage:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml vault`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml privacy_policy`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `pytest tests/test_privacy_migration_inventory.py` from `apps/backend`
- `pytest tests/test_privacy_policy.py tests/test_privacy_migration_inventory.py` from `apps/backend`
- `pytest tests` from `apps/backend`
- `node --test apps/dashboard/tests/privacy-settings.test.mjs`
- `node --import tsx --test apps/dashboard/tests/privacy-local-vault.test.ts`
- `node --import tsx --test apps/dashboard/tests/privacy-habit-vault-adapter.test.ts`
- `npm run api:openapi && npm run api:generate-client`
- `npm run privacy:verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test:dashboard`
- `npm run build`
- `npm run repo:check`
- `git diff --check`

## Remaining Work

Pass 2C was later approved and implemented for supported habit categories. Pass 2D cloud deletion controls and Pass 2E E2EE private sync envelopes were later approved and implemented. Pass 2F File-over-App Ritual Vault export/import still requires separate explicit approval.
