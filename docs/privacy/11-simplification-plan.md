# Privacy Simplification Plan

Date: 2026-06-26

Status: approved and implemented as the privacy simplification Pass 2. See `docs/privacy/18-privacy-simplification-pass-2-after-report.md` for the implemented result and verification.

## Recommendation

Choose Option A: local DB canonical, File Vault as export/mirror.

For V1, the canonical sensitive store should be the encrypted local desktop vault/local DB path. The Ritual folder should be a generated, readable File-over-App export/mirror, not the live database. The current file-native runtime is a valid future product direction, but it is too large for the current public-beta privacy goal.

Do not keep file-native Markdown/JSONL and encrypted local DB as equal peers. That is the core source-of-truth problem.

## Final V1 Model

| Concern | V1 choice |
| --- | --- |
| Canonical source of truth | Encrypted local desktop vault/local DB for sensitive records |
| Derived/cache layers | Minimal in-memory/query helpers; no native file SQLite index for V1 |
| File-over-App role | Export/mirror generated from canonical local store |
| Private Sync role | Optional generic encrypted envelope sync, feature-gated if device/key-grant complexity remains |
| Migration role | Cloud plaintext behavioral data imported into canonical local store, idempotently |
| Deletion role | Explicit confirmed cloud deletion after local migration verification, with local receipt |
| Indexing/search role | Query canonical local DB where possible; cloud search only with consent |
| Analytics role | Local calculations for sensitive habit/log data; Tinybird only for allowlisted telemetry or consented non-sensitive data |
| AI role | Cloud AI off by default; private local context only sent after explicit consent/action |
| UI role | One concise privacy/data controls screen |
| Backend role | Policy enforcement, migration/deletion endpoints, optional ciphertext envelope storage |

## Proposed Final Directory Structure

```text
packages/shared-contracts/src/privacy.ts
apps/backend/services/privacy_policy.py
apps/backend/api/privacy.py
apps/backend/services/privacy_migration_inventory.py
apps/backend/services/privacy_private_sync.py
apps/backend/services/privacy_external_erasure.py
apps/dashboard/lib/privacy/privacy-settings.ts
apps/dashboard/lib/privacy/vault-client.ts
apps/dashboard/lib/privacy/vault-migration.ts
apps/dashboard/lib/privacy/vault-deletion.ts
apps/dashboard/lib/privacy/vault-private-sync.ts
apps/dashboard/lib/privacy/vault-private-sync-crypto.ts
apps/dashboard/lib/privacy/ritual-vault-export.ts
apps/dashboard/components/privacy-settings-panel.tsx
apps/desktop/src-tauri/src/local_vault.rs
apps/desktop/src-tauri/src/privacy_policy.rs
```

The target structure intentionally removes the live file-native runtime modules from V1. If a small export helper is split out of `ritual-vault-export.ts`, it should be an implementation detail of export, not a second runtime.

## Data Flow

```text
User action
  -> central privacy settings and policy
  -> canonical local encrypted vault/local DB
  -> optional derived views in app memory
  -> optional export writes Markdown/JSONL/CSV files
  -> optional Private Sync uploads encrypted envelopes only
```

Cloud plaintext writes for sensitive behavioral data are not default. Cloud services are reached only when policy allows the destination and the user has the needed consent.

## Privacy Flow

1. UI and server routes read one V1 settings model.
2. All outbound paths ask the shared/backend policy.
3. Unknown sensitive categories and destinations fail closed.
4. Telemetry uses allowlisted properties and redaction.
5. Cloud AI routes require explicit `ai`, `voice`, or `vision` consent depending on the route.
6. Desktop plaintext sync remains blocked in Local Only and Private Sync modes.

## Sync Flow

Retain only a generic encrypted-envelope path for V1:

1. Local canonical record changes are selected by category.
2. The client encrypts a generic record envelope before upload.
3. Backend stores opaque ciphertext and metadata needed for ordering/conflict detection.
4. Pull downloads ciphertext and the client decrypts locally.
5. If trusted-device revoke/key-grant logic remains large, hide it behind a disabled experimental flag and keep envelope push/pull off by default.

## Export Flow

Minimal V1 File-over-App export:

```text
Ritual Vault/
  README.md
  manifest.json
  tracks/*.md
  logs/YYYY/MM/YYYY-MM-DD.jsonl
  daily/YYYY-MM-DD.md
  checksums.sha256
```

The export can include CSV summaries where easy. It should not write broad operational `.ritual/data/*.jsonl` files in V1. Exported files are user-owned and readable; import can be validation/preview only unless full round-trip is explicitly approved.

## Migration Flow

1. Backend builds an inventory and plan for supported categories.
2. User explicitly starts migration.
3. Client imports cloud records into the canonical local vault/local DB.
4. Client writes a migration manifest with source hash and local hash.
5. Re-running migration is idempotent.
6. Cloud deletion is disabled until matching local migration evidence exists.

## Deletion Flow

1. User requests a deletion plan for selected categories.
2. UI shows count, categories, limitations, and confirmation copy.
3. User confirms deletion.
4. Backend deletes supported cloud behavioral rows.
5. Client stores a local deletion receipt in the canonical local store.
6. External provider/manual erasure targets are receipt-backed limitations, not fake completed deletes.

## UI Flow

Use one privacy page/panel with these sections:

- Current privacy mode.
- Local Only status.
- Private Sync toggle/status, disabled or experimental if not ready.
- Analytics and crash toggles.
- Cloud AI, voice, and vision toggles.
- Migration status and action.
- Delete cloud behavioral data action.
- Export Ritual Vault action.
- Data map/limitations link.

Avoid separate feature panels for file-native diagnostics, Private Sync hardening, external erasure, and vault export unless they are collapsed into simple subsections.

## Module Plan

| Current file/module | Decision | Reason | Replacement | Risk | Tests needed | Expected line reduction |
| --- | --- | --- | --- | --- | --- | ---: |
| `packages/shared-contracts/src/privacy.ts` | Keep/simplify | Central TS policy is essential | Same file | Low | Policy fail-closed/redaction | 0-30 |
| `apps/backend/services/privacy_policy.py` | Keep/simplify | Backend must enforce same policy | Same file | Low | Backend policy tests | 0-30 |
| `apps/dashboard/lib/privacy/privacy-settings.ts` | Keep/simplify | One settings model needed | Same file | Low | Settings normalization | 10-30 |
| `apps/dashboard/components/privacy-settings-panel.tsx` | Rewrite smaller | Current panel orchestrates too many systems | Single compact panel | Medium | UI smoke or unit coverage | 400-600 |
| `apps/desktop/src-tauri/src/local_vault.rs` | Keep/simplify | Best candidate canonical encrypted store | Same file | Medium | Ciphertext/local CRUD tests | 100-200 |
| `apps/dashboard/lib/privacy/vault-client.ts` | Keep/simplify | Desktop bridge to canonical store | Same file | Low | Client contract tests | 20-50 |
| `apps/dashboard/lib/privacy/local-vault.ts` | Delete/merge | Browser localStorage vault duplicates desktop vault | Test-only memory helper or remove | Low | Local vault tests moved | 150-213 |
| `apps/dashboard/lib/privacy/habit-vault-adapter.ts` | Merge | Category adapter can be generic local record helpers | `vault-client.ts` or small `vault-records.ts` | Medium | Habit/log CRUD | 50-100 |
| `apps/dashboard/lib/privacy/vault-migration.ts` | Keep/simplify | Migration required, but no file-native promotion | Same file | Medium | Idempotent migration/no silent delete | 150-250 |
| `apps/backend/services/privacy_migration_inventory.py` | Simplify | Too many category-specific extractors for V1 | Same file, smaller registry | Medium | Category inventory/migration tests | 250-450 |
| `apps/dashboard/lib/privacy/vault-deletion.ts` | Keep/simplify | Deletion required | Same file | Medium | Confirmation/receipt/idempotence | 50-120 |
| `apps/dashboard/lib/privacy/external-erasure.ts` | Defer/delete from V1 UI | Broad external erasure framework is not core local-first | Backend manual limitations doc | Medium | Keep backend tests if retained | 200-297 |
| `apps/backend/services/privacy_external_erasure.py` | Defer/simplify | Manual targets can be documented limitations | Smaller backend helper or remove route | Medium | Tinybird/Typesense delete if retained | 100-234 |
| `apps/dashboard/lib/privacy/vault-private-sync.ts` | Keep/simplify/flag | Generic envelope sync is enough | Same file, no category explosion | Medium | Ciphertext/tamper/roundtrip | 200-350 |
| `apps/dashboard/lib/privacy/vault-private-sync-keyring.ts` | Simplify/flag | Recovery/pairing/rotation are advanced | Minimal key abstraction | Medium-high | Wrong key/tamper | 300-500 |
| `apps/dashboard/lib/privacy/vault-private-sync-devices.ts` | Defer/flag | Trusted device revoke/grants add large complexity | Experimental flag or remove V1 | Medium-high | Device tests only if retained | 350-534 |
| `apps/backend/services/privacy_private_sync.py` | Keep/simplify | Ciphertext storage required if sync retained | Envelopes only; device/grant optional | Medium | Server ciphertext/device auth if retained | 150-300 |
| `apps/backend/database/models/privacy_sync.py` | Keep/simplify | Tables needed for sync if retained | Envelope table only if V1 sync minimal | Medium | Migration/model tests | 20-60 |
| `apps/dashboard/lib/privacy/ritual-vault-export.ts` | Keep/simplify | File ownership required | Minimal export writer/validator | Medium | Manifest/readable files | 250-400 |
| `apps/dashboard/components/privacy-vault-export-section.tsx` | Merge | Export should be one panel section | `privacy-settings-panel.tsx` | Low | Export button smoke | 150-215 |
| `apps/dashboard/lib/privacy/file-native-vault-data.ts` | Delete/defer | Broad operational JSONL store duplicates canonical local DB | Export serializers only | Medium | Export tests replace category tests | 2,500-3,405 |
| `apps/dashboard/lib/privacy/file-native-vault.ts` | Delete/defer | Live Markdown database is not V1 | `ritual-vault-export.ts` | High | Habit/log CRUD must use local DB | 800-1,109 |
| `apps/dashboard/lib/privacy/file-native-vault-storage.ts` | Delete/defer | Folder runtime only needed for live file-native | Export writer helper if needed | Medium | Export manifest/files | 250-333 |
| `apps/dashboard/lib/privacy/file-native-vault-markdown.ts` | Merge subset | Markdown serializers useful for export | Export serializer module | Low | Markdown export parse | 150-250 |
| `apps/dashboard/lib/privacy/file-native-vault-cache.ts` | Delete/defer | Derived cache only needed for live file-native | None | Medium | Remove cache-dependent tests | 478 |
| `apps/dashboard/lib/privacy/file-native-vault-repair.ts` | Delete/defer | Repair is for bidirectional file editing | None | Medium | None for V1 | 374 |
| `apps/dashboard/lib/privacy/file-native-vault-diagnostics.ts` | Delete/defer | Diagnostics are for live vault | None | Medium | None for V1 | 64 |
| `apps/dashboard/lib/privacy/file-native-vault-change.ts` | Delete/defer | Watch/poll only needed for live vault | None | Medium | None for V1 | 106 |
| `apps/dashboard/lib/privacy/file-native-vault-sqlite-index.ts` | Delete/defer | Native index is premature | Query canonical local DB | Medium | Local analytics smoke | 205 |
| `apps/dashboard/lib/privacy/file-native-analytics-adapter.ts` | Delete/rewrite | Analytics should read canonical local store | Local DB analytics helper | Medium-high | Metrics smoke/local-only | 500-799 |
| `apps/dashboard/lib/privacy/file-native-vault-search.ts` | Delete/defer | File search only needed for live vault | Local DB search or none | Medium | Search fallback tests | 285 |
| `apps/dashboard/lib/privacy/file-native-vault-chat-context.ts` | Delete/defer | AI vault retrieval over files is advanced | Explicit user-selected context | Medium | AI consent tests | 64 |
| `apps/dashboard/lib/privacy/file-native-habit-adapter.ts` | Delete/rewrite | Habit adapter should use canonical local DB | Local DB habit adapter | High | Habit/log CRUD/offline | 250-344 |
| `apps/dashboard/lib/privacy/file-native-artifact-adapter.ts` | Delete/defer | Reports as file DB is V2 | Existing reports/local DB path | Medium | Reports smoke | 435 |
| `apps/dashboard/lib/privacy/file-native-workflow-adapter.ts` | Delete/defer | Workflow scheduling in vault is over-scoped | Existing workflow path with guardrails | Medium-high | Workflow smoke | 700-837 |
| `apps/dashboard/lib/privacy/file-native-scheduled-block-adapter.ts` | Delete/rewrite | Scheduled blocks should use canonical local DB | Local DB scheduled block helper | Medium | Calendar CRUD smoke | 120-167 |
| `apps/dashboard/components/file-native-vault-change-bridge.tsx` | Delete | Bridge supports live file edits | None | Low | None | 122 |
| `apps/dashboard/components/file-native-workflow-scheduler-bridge.tsx` | Delete/defer | Scheduler bridge supports file-native workflow runtime | Existing scheduler | Medium | Workflow smoke | 66 |
| `apps/dashboard/components/privacy-file-native-vault-*.tsx` | Delete/merge | Live folder diagnostics/section no longer V1 | Export section in main panel | Low | Export UI smoke | 250-315 |
| `apps/desktop/src-tauri/src/file_native_watcher.rs` | Delete/defer | Live file watching is V2 | None | Medium | Remove watcher tests | 261 |
| `apps/desktop/src-tauri/src/file_native_index*.rs` | Delete/defer | Native file index/search/analytics/retrieval is V2 | Canonical local DB queries | Medium-high | Desktop cargo tests adjusted | 2,049 |
| `apps/desktop/src-tauri/crates/ritual-db/src/schema/vault.rs` | Simplify | Keep vault tables; remove file-native index tables | Smaller schema | Medium | Cargo/db tests | 50-120 |
| `scripts/verify-privacy-guardrails.mjs` | Keep/rewrite | Verification is useful but currently checks removed modules | Smaller verifier | Low | Script run | 100-200 |

Expected runtime reduction from the file-native runtime, native index/watcher, and UI/test collapse is roughly 9k-13k lines. That should meet the 30 percent target and may approach the preferred 10k-12k runtime target if Private Sync hardening is also flagged/deferred.

## Files To Delete Or Defer In Pass 2

Primary deletion/defer list if Option A is approved:

- `apps/dashboard/lib/privacy/file-native-vault-data.ts`
- `apps/dashboard/lib/privacy/file-native-vault.ts`
- `apps/dashboard/lib/privacy/file-native-vault-cache.ts`
- `apps/dashboard/lib/privacy/file-native-vault-change.ts`
- `apps/dashboard/lib/privacy/file-native-vault-diagnostics.ts`
- `apps/dashboard/lib/privacy/file-native-vault-repair.ts`
- `apps/dashboard/lib/privacy/file-native-vault-search.ts`
- `apps/dashboard/lib/privacy/file-native-vault-settings.ts`
- `apps/dashboard/lib/privacy/file-native-vault-sqlite-index.ts`
- `apps/dashboard/lib/privacy/file-native-analytics-adapter.ts`
- `apps/dashboard/lib/privacy/file-native-artifact-adapter.ts`
- `apps/dashboard/lib/privacy/file-native-workflow-adapter.ts`
- `apps/dashboard/lib/privacy/file-native-scheduled-block-adapter.ts`
- `apps/dashboard/components/file-native-vault-change-bridge.tsx`
- `apps/dashboard/components/file-native-workflow-scheduler-bridge.tsx`
- `apps/dashboard/components/privacy-file-native-vault-section.tsx`
- `apps/dashboard/components/privacy-file-native-vault-diagnostics-section.tsx`
- `apps/desktop/src-tauri/src/file_native_watcher.rs`
- `apps/desktop/src-tauri/src/file_native_index.rs`
- `apps/desktop/src-tauri/src/file_native_index_analytics.rs`
- `apps/desktop/src-tauri/src/file_native_index_retrieval.rs`

Some Markdown serializer code can be moved into the export module before deleting the live file-native files.

## Tests To Keep

- Shared privacy policy fail-closed/redaction tests.
- Backend privacy policy tests.
- Local encrypted vault tests.
- Migration idempotence/no-silent-delete tests.
- Cloud deletion explicit-confirmation/receipt tests.
- Private Sync ciphertext/tamper/wrong-key tests if sync remains enabled.
- Ritual Vault export readability tests.
- Habit/log local CRUD smoke tests through canonical local store.

## Tests To Delete Or Collapse

- `privacy-file-native-vault*.test.ts` should collapse into export-format tests if live file-native is removed.
- `privacy-file-native-analytics-adapter.test.ts`, search tests, and workflow adapter tests should be removed or rewritten around local DB behavior.
- `privacy-vault-private-sync-devices.test.ts` should be kept only if trusted devices remain V1; otherwise move to skipped/experimental coverage or delete with docs.
- Category-specific JSONL migration tests should collapse into a generic migration serializer test plus a few representative sensitive categories.

## Docs To Keep Or Rewrite

Keep/rewrite:

- `00-current-architecture-audit.md` as historical context.
- A new concise privacy architecture doc after Pass 2.
- A file vault/export format doc.
- A migration/deletion guide.
- A Private Sync envelope spec if sync remains enabled.

Shorten or replace:

- Stage-by-stage implementation notes from `03` through `17`.
- File-native completion docs if file-native is no longer canonical.
- Device revoke docs if trusted-device revoke is deferred.

## Features Deferred Or Experimental

| Feature | V1 status |
| --- | --- |
| Live bidirectional Markdown editing | Deferred |
| Native file watcher | Deferred |
| Native file SQLite index/search/analytics/retrieval | Deferred |
| Broad operational `.ritual/data/*.jsonl` database | Deferred |
| File-native workflow scheduler/runtime | Deferred |
| AI retrieval over vault files | Deferred |
| Trusted device revoke/key-grant ledger | Experimental unless explicitly approved |
| Encrypted archive wrapper import | Optional; readable export is V1 |
| Provider-specific external erasure framework | Deferred except supported Tinybird/Typesense deletion if already safe |

## Before/After Estimate

| Metric | Current | Target after Option A |
| --- | ---: | ---: |
| Runtime implementation + migrations | ~24.6k | ~10k-14k |
| Tests/verification | ~7.5k | ~3k-5k |
| Docs | ~2.8k | ~1k-1.8k after cleanup |
| Runtime reduction | n/a | 43-59 percent likely |

If implementation evidence shows the canonical local DB path cannot support habit/log CRUD offline without substantial new code, stop and revise the plan rather than forcing deletion. In that case, the staged fallback is to keep only habits/logs file-native and defer every other file-native category until category-specific local DB replacement exists.

## Stop Gate

Do not implement this plan until the product owner explicitly approves Pass 2 for this simplification plan. Suggested approval wording:

`Approved for privacy simplification Pass 2: implement Option A local DB canonical, reduce File-over-App to export/mirror, defer live file-native runtime/native watcher/native index, and simplify Private Sync to generic encrypted envelopes or an experimental flag.`
