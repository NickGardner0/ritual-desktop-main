# File-Native Ritual Vault Completion Audit

Date: 2026-06-24

Status: superseded historical audit. On 2026-06-26 the approved V1 direction changed to Option A: encrypted local DB/local vault is canonical, and File-over-App is export/mirror only. The live file-native runtime, native folder watcher, native SQLite index/search/retrieval, Markdown-first app adapters, and private-sync device/key-grant ledger audited below were removed or deferred. See `docs/privacy/18-privacy-simplification-pass-2-after-report.md` for the current implementation status.

Historical status before supersession: complete for the file-native vault objective, with adjacent non-goal follow-up noted below.

This audit checks the current implementation against the objective in `pasted-text-1.txt`: make core user-authored Ritual data file-native, with Markdown as the canonical source of truth for habits, daily logs/reflections, workflows, and saved reports, and derived indexes/caches used for speed, analytics, search, AI retrieval, and conflict detection.

## Requirement Evidence

| Requirement | Current evidence | Status |
| --- | --- | --- |
| Vault folder selection/configuration | `PrivacySettings.storageMode` and `vaultPath` are defined in `apps/dashboard/lib/privacy/privacy-settings.ts`; `initializeFileNativeVaultSettings` and desktop folder selection live in `apps/dashboard/lib/privacy/file-native-vault-settings.ts`; the settings UI exposes a Ritual folder section in `apps/dashboard/components/privacy-file-native-vault-section.tsx`. | Complete |
| Vault initialization and metadata | `initializeFileNativeVault` creates `Habits/`, `Daily/`, `Workflows/`, `Reports/`, `.ritual/schema/`, `.ritual/data/`, `.ritual/manifest.json`, `.ritual/checksums.json`, `.ritual/index.sqlite`, and `.ritual/index.snapshot.json` in `apps/dashboard/lib/privacy/file-native-vault-storage.ts`. The manifest includes vault version, schema version, timestamps, vault ID, and app ID, with no secret fields. | Complete |
| Stable Markdown schemas/frontmatter | Schema files for habit, daily log, workflow, and report are declared in `SCHEMA_FILES` in `file-native-vault-storage.ts`. Markdown parsers/renderers in `apps/dashboard/lib/privacy/file-native-vault-markdown.ts` enforce required frontmatter and preserve unknown fields. | Complete |
| Habit Markdown parse/write | `serializeHabitMarkdown`, `parseHabitMarkdown`, `writeFileNativeHabit`, and the app-facing habit adapter write/read `Habits/*.md` as canonical records. Tests cover round trips and app adapter create/update/delete. | Complete |
| Daily Markdown parse/write | `serializeDailyLogMarkdown`, `parseDailyLogMarkdown`, `writeFileNativeDailyLog`, `saveFileNativeDailyLog`, `deleteFileNativeDailyLog`, and `logFileNativeHabit` write `Daily/YYYY/MM/YYYY-MM-DD.md` as canonical logs/reflections. Habit log block markers are emitted as `ritual:block habit_log:<id>`. | Complete |
| Workflow Markdown parse/write | `serializeWorkflowMarkdown`, `parseWorkflowMarkdown`, and the workflow adapter write `Workflows/*.md`; structured workflow definitions are preserved in `ritual:block workflow_definition` while user Markdown after the block survives updates. Reports surface workflow reads/runs/updates go through the file-native helper before API fallback. | Complete |
| Report Markdown parse/write | `serializeReportMarkdown`, `parseReportMarkdown`, and the artifact adapter write saved reports/reviews to `Reports/*.md`; structured report bodies are preserved in `ritual:block artifact_body` while readable Markdown is first-class. Reports surface artifact list/detail/create/update uses file-native helpers before API fallback. | Complete |
| Stable IDs and rename handling | Identity uses frontmatter `ritual_id`; cache rebuild detects renamed files by prior checksum entries with the same ID. Tests cover stable ID surviving rename and duplicate ID conflicts. | Complete |
| Derived cache and SQLite index | `rebuildFileNativeVaultCache` rebuilds normalized cache data and writes `.ritual/index.snapshot.json`; desktop `rebuild_file_native_index` writes real SQLite to `.ritual/index.sqlite` with normalized vault tables. Search, analytics, and AI retrieval prefer SQLite through Tauri commands and fall back to snapshot. | Complete |
| Watcher and polling | Desktop `apps/desktop/src-tauri/src/file_native_watcher.rs` emits native events for canonical Markdown and `.ritual/data/*.jsonl`; `FileNativeVaultChangeBridge` debounces events and uses checksum polling as the correctness path. Tests cover external edits and deletes. | Complete |
| Validation and repair states | Cache rebuild surfaces malformed frontmatter, missing required fields, invalid dates, unsupported `ritual_type`, unparseable habit-log rows, merge conflict markers, duplicate IDs, malformed JSONL, and changed-without-updated-at conflicts without discarding source content. Diagnostics/repair modules expose repair plans and backup-writing repair actions. | Complete |
| Conflict handling | Conflict types include duplicate `ritual_id`, duplicate Daily habit-log IDs, app/external update, deleted file, renamed file, and merge conflict markers. Markdown writes/deletes perform checksum preflight before mutating files. | Complete |
| Markdown-first write path | Habit hooks, report helpers, workflow helpers, calendar scheduled blocks, and service-level daily helpers check file-native mode first and write the vault before falling back to existing APIs. Core Markdown writes preserve unknown frontmatter and user sections where structured blocks are managed. | Complete |
| Migration/import path | `migrateRecordsToFileNativeVault` exports existing habit definitions, habit logs/daily notes, workflows, reports/artifacts, and operational collections into the vault, rebuilds the cache, and verifies migrated IDs. Local encrypted vault promotion into the file-native folder is exposed in settings through `migrateLocalVaultRecordsToFileNativeVault`. | Complete |
| Operational non-Markdown data | High-volume and non-human-editable records are kept under `.ritual/data/*.jsonl`: wearable samples/events/raw payloads/sync metadata, deletion receipts, imports, location, OCR frames, financial records/sync metadata, AI records, SMS/copilot, Private Sync envelopes/devices/key grants, workflow runs, and workflow scheduler state. Writers preserve malformed raw JSONL lines for repair diagnostics. | Complete |
| Analytics/statistics compatibility | Metrics paths call `readConfiguredFileNativeHabitAnalytics` before Tinybird/backend analytics; desktop analytics queries `.ritual/index.sqlite` through `query_file_native_habit_analytics`, with snapshot fallback. | Complete |
| Search and AI retrieval compatibility | Command palette calls `searchConfiguredFileNativeVault`; AI chat context is retrieved from the file-native derived index and attached only when cloud intelligence mode plus AI consent are enabled. Chat runtime treats local vault context as read-only cited context. | Complete |
| Tests | Focused file-native tests cover initialization, parser round trips, stable IDs, conflicts/repairs, external changes, deletes, checksums, JSONL validation/preservation, cache rebuild, migration, app-facing adapters, search, analytics, settings, and workflow scheduling. | Complete |
| Documentation | `docs/privacy/16-file-native-vault-implementation-notes.md` documents the vault layout, canonical-vs-derived split, `.ritual/data/*.jsonl`, SQLite/index role, app wiring, and limitations. This audit records requirement-level evidence. | Complete |

## Non-Goal Follow-Up

The following items remain intentionally outside the core file-native source-of-truth objective:

- True closed-app/native OS scheduler execution for file-native workflow dispatch. Current behavior is app-open opportunistic dispatch with bounded catch-up and a durable `.ritual/data/workflow_scheduler_state.jsonl` status record.
- Cloud-executed workflow actions, action-profile management, approval queues, AI facts, and provider-specific background jobs still use existing API paths where they are not core user-authored vault records.
- Provider-side/manual erasure limitations remain as documented in `docs/privacy/14-final-remaining-pass-2-implementation-notes.md`.

## Verification

Most recent verification for this file-native completion audit:

- `node --import tsx --test apps/dashboard/tests/privacy-file-native-vault.test.ts apps/dashboard/tests/privacy-file-native-vault-diagnostics.test.ts apps/dashboard/tests/privacy-file-native-vault-search.test.ts apps/dashboard/tests/privacy-file-native-vault-settings.test.ts apps/dashboard/tests/privacy-file-native-habit-adapter.test.ts apps/dashboard/tests/privacy-file-native-analytics-adapter.test.ts apps/dashboard/tests/privacy-file-native-scheduled-block-adapter.test.ts apps/dashboard/tests/privacy-file-native-artifact-adapter.test.ts apps/dashboard/tests/privacy-file-native-workflow-adapter.test.ts apps/dashboard/tests/privacy-vault-migration.test.ts`
- `npm run privacy:verify`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- `npm run build`

Observed non-blocking build warnings remain environment-level: Next uses the WASM SWC fallback because `@next/swc-darwin-arm64` is not installed locally, and Browserslist data is stale.
