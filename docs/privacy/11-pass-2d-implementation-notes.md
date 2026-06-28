# Pass 2D Implementation Notes

Date: 2026-06-23

Status: implemented for the approved scope: cloud behavioral deletion controls and local deletion receipts.

## Implemented Scope

Pass 2D adds a user-controlled deletion path for cloud behavioral rows that are already migratable into the local vault.

- Added backend deletion plan and execute helpers in `apps/backend/services/privacy_migration_inventory.py`.
- Added backend routes:
  - `POST /api/privacy/deletion-plan`
  - `POST /api/privacy/deletion-execute`
- Added local vault deletion receipts in `vault_deletion_receipt`.
- Added Tauri commands for writing and listing local deletion receipts.
- Added a dashboard deletion orchestrator in `apps/dashboard/lib/privacy/vault-deletion.ts`.
- Extended the Privacy settings panel with selectable deletion categories, deletion planning, and explicit cloud deletion execution.
- Extended backend, dashboard, desktop vault, and static privacy verifier tests.

## Supported Deletion Categories

Deletion is supported for the same category-specific records migrated in Pass 2C:

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

Parent categories that can orphan child records are dependency-gated. For example, habit definitions require habit logs, import runs require import items, AI conversations require AI messages, and financial accounts require financial transactions.

## Guardrails

The deletion flow:

1. Requires an explicit category selection.
2. Requires a completed local migration manifest for every selected category.
3. Builds a backend deletion plan with counts and source hashes.
4. Writes a local `running` deletion receipt before backend mutation.
5. Requires `confirm_behavioral_cloud_deletion` and a local receipt id on the execute request.
6. Deletes selected backend Turso rows in dependency-aware order.
7. Writes a final local receipt with backend category receipts and counts.

Account metadata is preserved. The `users` row and provider connection records are not deleted by this stage.

## Known Limitations

- This stage deletes approved backend Turso behavioral rows only.
- Tinybird historical rows, Typesense indexes, OpenPanel events, Sentry events, Trigger logs, and external provider-side data are not erased in this stage.
- Provider disconnect/revocation is not included.
- Raw wearable payloads and desktop activity history remain unsupported because they do not yet have approved local migration coverage.
- E2EE private sync was later implemented as a ciphertext envelope foundation in Pass 2E. File-over-App export/import remains unimplemented and requires later approval.

## Verification Commands

Commands run for this stage:

- `pytest tests/test_privacy_migration_inventory.py` from `apps/backend`
- `node --import tsx --test apps/dashboard/tests/privacy-vault-migration.test.ts apps/dashboard/tests/privacy-vault-deletion.test.ts apps/dashboard/tests/privacy-local-vault.test.ts apps/dashboard/tests/privacy-habit-vault-adapter.test.ts`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml local_vault`
- `npm run api:openapi && npm run api:generate-client`
- `npm run privacy:verify`
- `npm run typecheck`
- `npm run lint`
- `npm run test:dashboard`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `pytest tests` from `apps/backend`
- `npm run repo:check`
- `npm run build`
- `git diff --check`

Observed non-blocking warnings:

- Next used the WASM SWC fallback because `@next/swc-darwin-arm64` is not installed locally.
- Browserslist data is stale.
- Backend tests still emit existing Pydantic/SQLAlchemy/datetime deprecation warnings.
- Desktop tests still emit existing unused test helper warnings.
