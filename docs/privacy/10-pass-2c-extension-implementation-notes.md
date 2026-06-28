# Pass 2C Extension Implementation Notes

Date: 2026-06-23

Status: implemented for the approved scope: category-specific migration for scheduled blocks, imports, wearable projections, location records, AI artifacts, reports, workflows, SMS/copilot, and financial data into the local vault.

## Implemented Scope

The Pass 2C extension broadens the backend migration plan/records APIs and dashboard category selector. It still uses the Pass 2C local vault migration pipeline:

1. Build a backend source plan.
2. Fetch records in batches.
3. Encrypt records into `vault_records`.
4. Re-read local vault records.
5. Compare local count/hash against the backend source hash.
6. Write a local migration manifest.

## Supported Categories

The migration API now supports:

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

The extension intentionally does not migrate raw wearable payloads, desktop activity history, cloud deletion receipts, private sync envelopes, or File-over-App export archives.

## Guardrails

- Cloud source rows are not deleted.
- Backend rows are not marked migrated.
- Provider sync, AI calls, analytics, and search indexing are not triggered.
- Unsupported categories still fail closed with a 400 from the migration API.
- Payloads are encrypted in the local desktop vault; only vault record metadata remains plaintext.

## Verification

Commands run for this stage:

- `pytest tests/test_privacy_migration_inventory.py` from `apps/backend`
- `pytest tests` from `apps/backend`
- `node --import tsx --test apps/dashboard/tests/privacy-vault-migration.test.ts`
- `node --import tsx --test apps/dashboard/tests/privacy-local-vault.test.ts apps/dashboard/tests/privacy-habit-vault-adapter.test.ts apps/dashboard/tests/privacy-vault-migration.test.ts`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `npm run privacy:verify`
- `npm run typecheck`
- `npm run lint`
- `npm run repo:check`
- `npm run test:dashboard`
- `npm run build`
- `git diff --check`
