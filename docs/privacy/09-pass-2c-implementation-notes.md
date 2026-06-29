# Pass 2C Implementation Notes

Date: 2026-06-23

Status: implemented for the approved scope: user-controlled migration of approved cloud behavioral data into the local vault. Later extended by `10-pass-2c-extension-implementation-notes.md`.

## Implemented Scope

Pass 2C adds a real cloud-to-local migration path for categories that already have category-specific extraction and verification tests.

- Added backend migration plan and record batch helpers in `apps/backend/services/privacy_migration_inventory.py`.
- Added backend routes:
  - `POST /api/privacy/migration-plan`
  - `POST /api/privacy/migration-records`
- Added local vault migration manifests in `vault_migration_manifest`.
- Added Tauri commands for writing and listing local migration manifests.
- Added a dashboard migration orchestrator in `apps/dashboard/lib/privacy/vault-migration.ts`.
- Extended the Privacy settings panel with selectable supported categories and an explicit `Migrate` action.
- Updated OpenAPI and the generated dashboard backend client.
- Extended the privacy verifier so Pass 2C migration invariants are checked.

## Supported Categories

The initial implemented migration supports:

- `habit_definitions`
- `habit_logs`

The Pass 2C extension adds more approved categories with category-specific tests.

## Verification Model

The migration flow:

1. Initializes the local desktop vault.
2. Requests a backend migration plan for selected supported categories.
3. Writes a local manifest with `running` status.
4. Fetches backend records in batches.
5. Encrypts each record into `vault_records`.
6. Re-reads the local vault records.
7. Computes a canonical SHA-256 hash over local decrypted records.
8. Compares the local hash and count with the backend source plan.
9. Marks the local manifest `completed` or `failed`.

The flow does not delete cloud data and does not mark backend rows migrated.

## Known Limitations

- Only habit definitions and habit logs are migrated in this stage.
- The migration is initiated from the desktop Privacy settings UI. There is not yet a dedicated multi-step migration wizard with pause/resume progress.
- Local vault reads become preferred after records exist locally, but cloud mutation paths are not fully replaced by local-first write paths in this stage.
- Cloud behavioral deletion receipts are implemented in Pass 2D; see `11-pass-2d-implementation-notes.md`.
- File-over-App export/import is not implemented; that is Pass 2F.

## Verification Commands

Commands run for this stage:

- `pytest tests/test_privacy_migration_inventory.py` from `apps/backend`
- `pytest tests` from `apps/backend`
- `node --import tsx --test apps/dashboard/tests/privacy-vault-migration.test.ts`
- `node --import tsx --test apps/dashboard/tests/privacy-local-vault.test.ts apps/dashboard/tests/privacy-habit-vault-adapter.test.ts apps/dashboard/tests/privacy-vault-migration.test.ts`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml vault`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `npm run api:openapi && npm run api:generate-client`
- `npm run lint`
- `npm run typecheck`
- `npm run test:dashboard`
- `npm run privacy:verify`
- `npm run repo:check`
- `npm run build`
- `git diff --check`
