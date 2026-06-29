# Pass 2B Local Vault and Migration Inventory Design

Date: 2026-06-23

Status: approved and implemented as the bounded Pass 2B scope. See `08-pass-2b-implementation-notes.md` for implementation details and verification.

## Goal

Pass 2B should turn the Pass 2A encrypted vault pilot into the first durable local source-of-truth path, without attempting the full privacy migration at once.

The narrow goal is:

1. Make desktop the durable local vault host for sensitive habit definitions and habit logs.
2. Add compatibility reads so existing dashboard habit/log screens can prefer local vault data when present and fall back to current backend data.
3. Add migration inventory and dry-run planning for current cloud-stored behavioral data.
4. Do not delete cloud data, implement E2EE sync, or ship full Ritual Vault export in this stage.

## Current Code Boundaries

Relevant current files:

- Browser-local pilot encryption helper: `apps/dashboard/lib/privacy/local-vault.ts`
- Dashboard habit/log read/write hooks: `apps/dashboard/hooks/use-habits-query.ts`
- Dashboard habit/log TypeScript shapes: `apps/dashboard/lib/habit-types.ts`, `apps/dashboard/contexts/habits-context.types.ts`
- Backend habit/log models: `apps/backend/database/models/habits.py`, `apps/backend/models/habit_models.py`
- Backend habit/log API boundary: `apps/backend/api/core.py`
- Desktop database wrapper and Tauri command registration: `apps/desktop/src-tauri/src/ritual_database.rs`, `apps/desktop/src-tauri/src/main.rs`
- Desktop libSQL crate and migrations: `apps/desktop/src-tauri/crates/ritual-db/src/lib.rs`, `apps/desktop/src-tauri/crates/ritual-db/src/schema/migrations.rs`
- Desktop cloud sync guardrail: `apps/desktop/src-tauri/src/cloud_sync.rs`, `apps/desktop/src-tauri/src/privacy_policy.rs`

Important constraints from current code:

- The Pass 2A vault helper uses WebCrypto, browser/localStorage style storage, and passphrase-derived keys. It is useful as a cryptographic pilot but is not the durable desktop vault.
- Existing desktop durable storage is local libSQL/SQLite under `~/.ritual`, split between memory and activity databases. There are no desktop habit/log source-of-truth tables yet.
- Current dashboard habit/log UX is cloud-primary through Next API routes and backend services. It has localStorage snapshots for display fallback, not durable encrypted ownership.
- Existing legacy desktop cloud sync uses plaintext outbox rows and is now blocked by privacy policy unless `plaintext_sync` consent is explicit.

## Proposed Storage Shape

Add a desktop-local vault database rather than mutating the existing `memory.db` or `activity.db` first.

Recommended path:

```text
~/.ritual/vault.db
```

Recommended first tables:

```sql
CREATE TABLE vault_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  collection TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0,
  key_version INTEGER NOT NULL DEFAULT 1,
  algorithm TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  aad TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_vault_records_user_collection_updated
  ON vault_records(user_id, collection, updated_at);

CREATE INDEX idx_vault_records_type_tombstone
  ON vault_records(record_type, tombstone);

CREATE TABLE vault_manifest (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vault_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  root_key_label TEXT,
  active_key_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE vault_migration_inventory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  byte_count INTEGER,
  min_updated_at TEXT,
  max_updated_at TEXT,
  sampled_hash TEXT,
  status TEXT NOT NULL,
  error TEXT,
  checked_at TEXT NOT NULL
);
```

Sensitive domain payloads should live only in `ciphertext`. Minimal plaintext metadata is allowed only for local indexing and future sync:

- opaque record ID;
- user ID;
- collection/type;
- updated timestamp;
- tombstone flag;
- algorithm/key version;
- nonce/AAD.

Do not store habit names, notes, location labels, OCR text, URLs, window titles, health samples, financial fields, AI messages, or raw provider payloads in plaintext vault metadata.

## Record Collections for Pass 2B

Implement only these collections first:

| Collection | Existing source shape | Local vault payload |
| --- | --- | --- |
| `habit_definitions` | `HabitDB` / `Habit` | id, name, category, icon, is_custom, integration_source, unit_type, sensor_type, metric_type, created_at, updated_at |
| `habit_logs` | `HabitLogDB` / `HabitLog` | id, habit_id, habit_name, duration, amount, date, completed_at, status, notes, log_metadata, source, origin fields, location fields |

Out of scope for Pass 2B:

- wearable raw payloads;
- health samples;
- desktop activity;
- AI conversations/facts;
- artifacts/reports/workflows;
- SMS/copilot;
- financial transactions;
- location history outside fields already denormalized on habit logs.

Those categories should appear in migration inventory counts but should not be migrated in Pass 2B.

## Key Management

Pass 2B should replace the browser passphrase-only pilot for desktop vault persistence.

Recommended desktop approach:

1. Generate a 256-bit random vault root key on first vault setup.
2. Store the root key in the platform keychain or Tauri-supported secure storage.
3. Store only a `root_key_label` and `active_key_version` in `vault_manifest`.
4. Use AES-GCM for record payload encryption.
5. Use AAD containing `user_id`, `collection`, `record_id`, `schema_version`, and `key_version`.
6. Keep the Pass 2A WebCrypto helper available for tests/browser fallback, but make desktop vault commands the preferred durable path.

Recovery phrase, recovery file, trusted-device pairing, and key rotation UX are Pass 2C/Private Sync work unless explicitly approved.

## Desktop API Surface

Add Tauri commands only after approval:

```text
vault_get_status()
vault_initialize()
vault_put_record(record)
vault_get_record(collection, id)
vault_list_records(collection, since, limit)
vault_tombstone_record(collection, id)
vault_get_migration_inventory()
vault_run_migration_inventory()
vault_plan_migration_dry_run(categories)
```

Command rules:

- All commands must return redacted errors.
- No command should log plaintext payloads.
- `vault_put_record` accepts plaintext only inside the local Tauri process boundary, encrypts before writing, and never emits plaintext to logs.
- `vault_list_records` may decrypt for the local UI, but should support collection/date filters so the UI avoids loading the entire vault.

## Dashboard Compatibility Adapter

Add a dashboard adapter layer rather than rewriting UI components directly.

Recommended files:

```text
apps/dashboard/lib/privacy/vault-client.ts
apps/dashboard/lib/privacy/habit-vault-adapter.ts
```

Behavior:

1. If running in desktop/Tauri and vault is initialized, read habits/logs from Tauri vault commands.
2. If local records exist, return them to React Query using the existing `Habit` and `HabitLog` shapes.
3. If no local records exist, fall back to the existing Next/backend fetch path.
4. Mutations for habit create/update/log/delete should write local-first only when the user is in Local Only mode and the desktop vault is initialized.
5. In Cloud Intelligence or uninitialized vault states, keep existing backend mutations unless product approval explicitly changes that behavior.

Pass 2B should keep UX degradation explicit:

- show vault source/status in Settings > Privacy;
- do not silently discard backend results;
- do not mark migration complete after only inventory/dry-run.

## Migration Inventory and Dry Run

Pass 2B should add inventory and dry-run only.

Inventory sources:

- backend Turso tables for habits, habit logs, scheduled blocks, aliases, imports, wearable tables, location tables, AI/artifact/workflow/SMS/financial tables;
- Tinybird datasources with user-scoped row counts where API supports it;
- Typesense collections with user-scoped document counts;
- desktop plaintext outbox/backlog counts;
- known generated reports/artifacts by user.

Dry-run behavior:

1. Fetch counts and safe metadata by category.
2. Download a small sample batch for `habit_definitions` and `habit_logs`.
3. Encrypt sample records into the local vault with a dry-run marker or isolated staging collection.
4. Verify count/hash/sample decode locally.
5. Delete dry-run staging records unless the user explicitly promotes them in a later approved stage.

Do not:

- delete cloud data;
- mark backend records migrated;
- change user source-of-truth;
- ingest every behavioral category;
- run provider syncs as part of inventory.

## Privacy Invariants

Pass 2B implementation must preserve these invariants:

1. Local Only remains the default fail-closed mode.
2. Plaintext legacy sync remains blocked unless `plaintext_sync` consent is explicit.
3. Vault ciphertext blobs must not contain plaintext habit names, notes, location labels, or log metadata strings.
4. Inventory requests must not trigger Tinybird/Typesense/OpenPanel/OpenAI/Gemini/Deepgram/Groq egress unless their explicit consent is present and necessary.
5. Migration dry-run must be idempotent.
6. Migration dry-run must never delete source data.
7. Logs and telemetry must not include plaintext vault payloads or sampled record values.

## Tests Required for Pass 2B

Add focused tests before broad refactors:

- Rust unit tests for vault schema creation/open/lock status.
- Rust tests proving encrypted vault storage does not contain sample habit/log plaintext.
- Tauri command tests or lower-level command handler tests for record put/list/tombstone.
- Dashboard adapter tests for desktop local-first read and backend fallback.
- Backend migration inventory tests with mocked table counts and service adapters.
- Dry-run idempotency test.
- Static verifier extension that detects unguarded new migration inventory egress and plaintext vault logging.
- Existing full checks from Pass 2A must still pass.

Required verification commands should include at minimum:

```bash
npm run privacy:verify
npm run typecheck
npm run lint
npm run build
npm run test:dashboard
cd apps/backend && pytest tests
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml vault
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml privacy_policy
```

## Acceptance Criteria

Pass 2B is complete only when:

1. A durable local desktop vault exists and opens without requiring cloud connectivity.
2. Habit definitions and habit logs can be written/read from encrypted local vault storage.
3. Existing dashboard habit/log views can prefer local vault data when available and fall back to backend data when not.
4. Settings > Privacy clearly reports vault status and migration inventory state.
5. A migration inventory can show current cloud behavioral categories and counts without deletion.
6. A dry-run can sample habit/log data, encrypt it locally, verify it, and clean staging data without changing cloud source data.
7. The privacy verifier covers the new vault and inventory paths.
8. Lint, typecheck, tests, build, and focused Rust/backend/dashboard checks pass.

## Non-Goals

The following still require separate approval after Pass 2B:

- Actual migration of all current cloud behavioral data.
- Cloud behavioral deletion controls and deletion receipts.
- File-over-App Ritual Vault folder/zip export/import.
- Optional E2EE private sync envelopes.
- iOS vault/local queue encryption.
- Full AI/analytics product consent UX.
