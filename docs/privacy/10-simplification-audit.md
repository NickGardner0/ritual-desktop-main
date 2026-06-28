# Privacy Simplification Audit

Date: 2026-06-26

Status: Pass 1 audit only. No implementation changes have been made for this refactor.

## Baseline

The current worktree contains a broad privacy/local-first/file-native/E2EE implementation relative to `HEAD`. The line counts below include tracked diffs plus untracked files, and exclude generated, binary, cache, and build artifacts from implementation totals.

| Category | Added | Deleted | Files | Notes |
| --- | ---: | ---: | ---: | --- |
| Runtime implementation | 24,427 | 358 | 127 | Product code under dashboard/backend/desktop/shared packages |
| Schema migrations | 214 | 0 | 2 | Private Sync server tables |
| Tests and verification | 7,514 | 2 | 25 | Dashboard/backend privacy tests plus verifier script |
| Docs | 2,794 | 0 | 18 | Existing staged privacy docs |
| Excluded generated/binary/build artifacts | 3,900 | 128 | 19 | `openapi.json`, Tauri schema, watcher binary, `outputs/`, iOS `Derived/`, pycache |
| Included total | 34,949 | 360 | 172 | Runtime + migrations + tests + docs |

The meaningful runtime baseline for reduction is approximately 24.6k lines including schema migrations. A 30 percent reduction means removing or collapsing about 7.4k runtime lines, leaving roughly 17.2k or fewer. The preferred 10k-12k target requires removing roughly half the runtime implementation.

## Largest Areas

| Directory | Added | Deleted | Files | Complexity driver |
| --- | ---: | ---: | ---: | --- |
| `apps/dashboard/lib/privacy` | 14,562 | 34 | 41 | Multiple vaults, file-native runtime, sync, migration, deletion, export, adapters |
| `apps/dashboard/tests` | 6,123 | 0 | 18 | Category-heavy file-native and sync tests |
| `apps/desktop/src-tauri` | 3,967 | 109 | 26 | Encrypted local vault, native file watcher, native SQLite index/search/retrieval |
| `docs/privacy` | 2,794 | 0 | 18 | Stage-by-stage implementation docs |
| `apps/dashboard/components` | 2,422 | 60 | 18 | Privacy panel plus multiple feature-specific sections/bridges |
| `apps/backend/services` | 2,052 | 68 | 8 | Migration inventory, Private Sync server, erasure, policy |
| `apps/backend/tests` | 957 | 2 | 5 | Backend privacy tests |
| `apps/backend/api` | 592 | 4 | 6 | Privacy routes and API guardrails |

## Largest Files

| File | Added | Classification | Audit note |
| --- | ---: | --- | --- |
| `apps/dashboard/lib/privacy/file-native-vault-data.ts` | 3,405 | Runtime | Broad `.ritual/data/*.jsonl` typed operational store for many categories |
| `apps/dashboard/lib/privacy/file-native-vault.ts` | 1,109 | Runtime | Markdown runtime, migration writer, operational JSONL routing, polling |
| `apps/desktop/src-tauri/src/file_native_index.rs` | 975 | Runtime | Native derived SQLite materialization and search tables |
| `apps/desktop/src-tauri/src/local_vault.rs` | 936 | Runtime | Encrypted desktop SQLite vault, migration/deletion receipts |
| `apps/backend/services/privacy_migration_inventory.py` | 860 | Runtime | Large category inventory/migration/deletion extractor |
| `apps/dashboard/components/privacy-settings-panel.tsx` | 848 | Runtime | One large settings surface coordinating many privacy subsystems |
| `apps/dashboard/lib/privacy/file-native-workflow-adapter.ts` | 837 | Runtime | File-native workflow definitions, runs, scheduler catch-up |
| `apps/dashboard/lib/privacy/file-native-analytics-adapter.ts` | 799 | Runtime | Local analytics over file-native cache and wearable projections |
| `apps/dashboard/lib/privacy/vault-private-sync.ts` | 733 | Runtime | Generic encrypted envelopes plus conflict/state handling |
| `apps/dashboard/lib/privacy/ritual-vault-export.ts` | 712 | Runtime | ZIP export/import plus encrypted wrapper |
| `apps/dashboard/lib/privacy/vault-private-sync-keyring.ts` | 699 | Runtime | Keyring, recovery, pairing, rotation |
| `apps/desktop/src-tauri/src/file_native_index_analytics.rs` | 671 | Runtime | Native analytics over derived SQLite |
| `apps/backend/services/privacy_private_sync.py` | 552 | Runtime | Server envelope/device/key-grant storage |
| `apps/dashboard/lib/privacy/vault-private-sync-devices.ts` | 534 | Runtime | Trusted device registry, grants, revoke |

## What Was Added

The current implementation added these major capabilities:

| Area | Main files | Purpose |
| --- | --- | --- |
| Central guardrails | `packages/shared-contracts/src/privacy.ts`, `apps/backend/services/privacy_policy.py`, `apps/dashboard/lib/privacy/server-policy.ts` | Privacy modes, data classes, cloud destinations, consent checks, telemetry redaction |
| Privacy settings | `apps/dashboard/lib/privacy/privacy-settings.ts`, `apps/dashboard/components/privacy-settings-panel.tsx` | Client settings, mode/consent headers, UI controls |
| Local encrypted vault | `apps/desktop/src-tauri/src/local_vault.rs`, `apps/dashboard/lib/privacy/vault-client.ts`, `apps/dashboard/lib/privacy/local-vault.ts` | Desktop local encrypted record store, migration/deletion manifests |
| File-native Markdown vault | `file-native-vault*.ts`, `file-native-*-adapter.ts`, file-native bridge components | Live Ritual folder source of truth for habits, daily logs, workflows, reports, plus operational JSONL |
| Native file runtime | `file_native_watcher.rs`, `file_native_index*.rs`, Tauri command registration | Watch external edits and build/query `.ritual/index.sqlite` |
| Migration | `vault-migration.ts`, `privacy_migration_inventory.py`, privacy API routes | Inventory, dry-run, cloud-to-local migration, local-to-file-native promotion |
| Cloud deletion/erasure | `vault-deletion.ts`, `external-erasure.ts`, `privacy_external_erasure.py` | Explicit deletion controls and receipts |
| Private Sync | `vault-private-sync*.ts`, `privacy_private_sync.py`, server migrations | Encrypted envelopes, local keyring, devices, key grants, revoke |
| File-over-App export/import | `ritual-vault-export.ts`, `privacy-vault-export-section.tsx` | ZIP export/import, readable Markdown/JSONL, optional encrypted JSON wrapper |
| Analytics/search/AI adapters | `file-native-analytics-adapter.ts`, `file-native-vault-search.ts`, `file-native-vault-chat-context.ts` | Local read paths for file-native mode before Tinybird/search/AI cloud paths |

## Essential Modules

These modules support core beta privacy guarantees and should be retained, though some should be simplified.

| Module | Why it is essential | Refactor direction |
| --- | --- | --- |
| `packages/shared-contracts/src/privacy.ts` | Shared central privacy policy and telemetry redaction | Keep; make it the single TypeScript policy surface |
| `apps/backend/services/privacy_policy.py` | Backend-side cloud-egress guardrail | Keep; align names with shared contract and reduce drift |
| `apps/dashboard/lib/privacy/privacy-settings.ts` | Local privacy mode/consent settings | Keep; simplify to one V1 settings model |
| `apps/desktop/src-tauri/src/privacy_policy.rs` | Desktop plaintext cloud sync guardrail | Keep; align with V1 modes |
| `apps/desktop/src-tauri/src/local_vault.rs` plus `vault-client.ts` | The clearest encrypted local durable store already present | Keep as V1 canonical local store if Option A is approved |
| `vault-migration.ts` and backend migration API | Safe cloud-to-local migration is required | Keep but narrow to one idempotent path |
| `vault-deletion.ts` and backend deletion endpoint | Explicit cloud behavioral deletion is required | Keep but avoid duplicate receipt stores |
| `vault-private-sync.ts` and server envelope storage | Private Sync can be retained as generic ciphertext envelopes | Keep only if simplified and feature-gated |
| `ritual-vault-export.ts` | User-readable export is required | Keep but reduce import/encrypted-wrapper scope if needed |
| Tests for Local Only, telemetry redaction, E2EE ciphertext, export readability, migration safety | Required by the objective | Keep representative boundary tests |

## Nice-To-Have Modules

These improve UX but are not required for first beta privacy safety.

| Module | Reason |
| --- | --- |
| `privacy-file-native-vault-section.tsx` | Folder selection is useful if export/mirror remains user-visible |
| `privacy-vault-export-section.tsx` | Export UI is useful but can be much smaller |
| `privacy-private-sync-hardening-section.tsx` | Good for advanced sync, but too much for a simple V1 if Private Sync is experimental |
| `file-native-vault-diagnostics.ts` and diagnostics UI | Useful for live file-native editing, less useful if vault is export-only |
| `file-native-vault-search.ts` and chat context | Useful if file-native is canonical; otherwise speculative |

## Speculative Or Over-Scoped Modules

| Module | Why it is speculative for V1 |
| --- | --- |
| `file-native-vault-data.ts` | Encodes many operational categories as durable `.ritual/data/*.jsonl` stores before the product has settled on file-native as the database |
| `file-native-workflow-adapter.ts` | Implements local workflow scheduling/catch-up and report generation inside the vault runtime |
| `file-native-analytics-adapter.ts` | Rebuilds analytics around file-native caches instead of using the canonical local store |
| `file-native-vault-sqlite-index.ts` plus Rust `file_native_index*.rs` | Native performance/cache layer before V1 source-of-truth decision is simplified |
| `file-native-vault-change.ts` plus Rust watcher | Live external edit support is a V2 feature if File-over-App is export/mirror |
| `file-native-vault-repair.ts` | Repair workflows are primarily needed for bidirectional file editing |
| `vault-private-sync-devices.ts` and key grants | Valuable but large; device revoke/key grants are beyond generic envelope sync |
| `external-erasure.ts` provider framework | Some targets are manual receipts; broad framework can be deferred |
| `ritual-vault-export.ts` encrypted wrapper/import | Useful, but import/encrypted wrapper can be deferred if readable export is the V1 requirement |

## Duplicate Concepts

The implementation currently keeps several peer concepts that can all hold or derive sensitive records:

| Concept | Current location | Duplication problem |
| --- | --- | --- |
| Encrypted local vault | Desktop SQLite `vault_records` via `local_vault.rs` | Stores local sensitive payloads |
| Browser local vault | `apps/dashboard/lib/privacy/local-vault.ts` | Separate WebCrypto/localStorage vault model not integrated with desktop canonical store |
| File-native Markdown vault | `Habits/`, `Daily/`, `Workflows/`, `Reports/` | Also treated as canonical in `file_native` mode |
| Operational JSONL store | `.ritual/data/*.jsonl` | Adds many non-human-editable stores parallel to local vault |
| Native SQLite index | `.ritual/index.sqlite` | Derived, but currently queried by analytics/search/AI as a major runtime path |
| JSON snapshot index | `.ritual/index.snapshot.json` | Second derived cache for web/test fallback |
| Backend Private Sync tables | `private_sync_envelopes`, devices, grants | Cloud ciphertext store plus server device registry |
| Migration manifests/deletion receipts | Desktop vault and file-native receipt mirror | Same audit evidence can be written in multiple places |

The biggest source-of-truth ambiguity is the combination of encrypted local vault plus live file-native Markdown/JSONL plus derived SQLite indexes. V1 should pick one canonical store and make all other files derived or experimental.

## Native/Platform Complexity

Native code added value but also creates build, permission, and maintenance cost:

| Native module | Lines | Audit |
| --- | ---: | --- |
| `local_vault.rs` | 936 | Worth keeping if local DB canonical is approved |
| `file_native_index.rs` | 975 | Premature if file vault becomes export/mirror |
| `file_native_index_analytics.rs` | 671 | Premature analytics optimization |
| `file_native_index_retrieval.rs` | 403 | Premature AI/search retrieval optimization |
| `file_native_watcher.rs` | 261 | Needed only for live bidirectional file editing |
| `privacy_policy.rs` | 77 | Keep as desktop egress guardrail |

## Current App Feature Dependencies

The current code wires privacy/file-native behavior into:

- Habit hooks and daily log/reflection helpers.
- Calendar task composer and scheduled block read models.
- Reports and workflow surfaces.
- Command palette search.
- Metrics/analytics cards.
- AI chat local vault context.
- Voice, image import, screenshot, calendar summary, and chat API routes via consent checks.
- Tinybird, Typesense/search, OpenPanel, Sentry, Trigger, and desktop cloud sync guardrails.
- Settings modal/window and sidebar settings entry points.

If live file-native mode is removed or deferred, affected surfaces must fall back to the canonical local DB/encrypted vault path, not directly to plaintext cloud paths.

## Tests

Essential tests to retain or rewrite around the simplified architecture:

- `privacy-settings.test.mjs` or equivalent shared policy tests for fail-closed and telemetry redaction.
- Backend `test_privacy_policy.py`.
- Local vault tests proving ciphertext at rest and no key material in DB.
- Migration tests proving idempotence and no silent deletion.
- Deletion tests proving explicit confirmation and local receipts.
- Private Sync tests proving ciphertext-only upload, decrypt roundtrip, wrong-key/tamper failure if sync remains enabled.
- Export tests proving manifest/readable files and sensitive default exclusions.
- One smoke test for habit/log CRUD through the chosen local canonical store.

Tests likely to collapse:

- Category-by-category file-native tests that repeat the same JSONL normalizer behavior.
- Native SQLite search/analytics/retrieval tests if native file index is deleted/deferred.
- Watcher/change-bridge tests if live file watching is deleted/deferred.
- Repair/diagnostics tests if bidirectional file editing is deferred.
- Device/key-grant tests if Private Sync device revoke is behind an experimental flag.

## Docs

Essential docs to retain or replace:

- Privacy architecture and data map.
- Threat model.
- V1 local store and migration/deletion guide.
- Private Sync envelope spec if retained.
- Ritual Vault export format.
- Known limitations.

Docs likely stale or too verbose after simplification:

- Stage-by-stage Pass 2 implementation notes that describe removed runtime layers.
- File-native completion docs if file-native becomes export/mirror rather than canonical.
- Device revoke docs if trusted devices are deferred.

## Simplification Opportunities

Recommended removals/deferments for Pass 2:

1. Remove live bidirectional file-native runtime from V1 unless product explicitly chooses File Vault canonical.
2. Remove native file watcher and native file SQLite index/search/analytics/retrieval from V1.
3. Collapse `.ritual/data/*.jsonl` category explosion into minimal export files only.
4. Keep one encrypted local canonical store and make export/vault derived.
5. Collapse migration into cloud-to-local-canonical only; remove local-vault-to-file-native promotion from V1.
6. Collapse deletion receipts into canonical local store, with export including receipts if requested.
7. Collapse privacy UI into one page with mode, consents, migration, deletion, export, and optional sync.
8. Keep generic encrypted envelopes for Private Sync, but defer trusted-device/key-grant revoke unless explicitly approved as V1.
9. Replace many adapter-specific tests with smaller boundary tests.

## Pass 1 Recommendation

Proceed to Pass 2 only with an approved simplification plan. The recommended direction is Option A: local DB/encrypted local vault canonical, with File-over-App as readable export/mirror. This is the only path likely to reduce runtime implementation by at least 30 percent while preserving Local Only, central guardrails, safe migration, explicit deletion, optional encrypted sync, and readable user-owned export.
