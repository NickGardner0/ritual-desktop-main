# File-Native Ritual Vault Implementation Notes

Date: 2026-06-24

Status: superseded historical implementation note. On 2026-06-26 the product decision changed to Option A: encrypted local DB/local vault is the canonical V1 source of truth, and File-over-App is export/mirror only. The live file-native runtime, native folder watcher, native SQLite index/search/retrieval, file-native app adapters, and private-sync device/key-grant ledger described below were removed or deferred. See `docs/privacy/18-privacy-simplification-pass-2-after-report.md` for the current architecture.

Historical status before supersession: implemented for the file-native vault objective: folder selection, native desktop file events with debounced polling fallback, repair/conflict diagnostics, conservative repair actions with backups, desktop SQLite index materialization, direct SQLite search/habit analytics/AI retrieval, derived-index retrieval helpers, generated `.ritual/data/habit_logs.jsonl`, `.ritual/data` wearable sample analytics, scheduled blocks, deletion receipts, import metadata, location records, OCR frame records, financial records, provider raw payloads, sync metadata, Private Sync encrypted envelopes/devices/key grants, AI records, SMS/copilot events, wearable events, and workflow run history, consent-gated AI chat vault context, richer report Markdown rendering, and habit/saved-artifact/workflow-definition/workflow-run app routes wired through Markdown-first file-native adapters. Scheduled workflow dispatch now runs opportunistically while the app is open with bounded app-open catch-up after missed slots; closed-app/background daemon execution remains incremental follow-up work outside the core vault source-of-truth objective.

## Product Direction

Ritual's core user-authored data should be file-native in `file_native` storage mode. The user-owned files are the canonical source of truth, while internal indexes and caches are derived from those files.

Canonical Markdown categories:

- `Habits/*.md` for habit definitions.
- `Daily/YYYY/MM/YYYY-MM-DD.md` for daily logs, reflections, and user-authored habit completions.
- `Workflows/*.md` for user-authored workflows.
- `Reports/*.md` for saved reports and reviews.

Derived/internal data:

- `.ritual/manifest.json` stores vault identity and schema metadata. It must not contain secrets.
- `.ritual/schema/*.schema.json` stores stable frontmatter contracts.
- `.ritual/checksums.json` tracks file checksums and record identity for change detection, including canonical Markdown files and operational `.ritual/data/*.jsonl` files.
- `.ritual/index.sqlite` is the desktop SQLite derived index/cache artifact used by analytics, search, AI retrieval, repair states, and conflict detection.
- `.ritual/index.snapshot.json` is a derived compatibility snapshot used by the web/test fallback when the desktop SQLite bridge is unavailable.
- `.ritual/data/*.jsonl` stores high-volume or non-human-editable records such as wearable samples, deletion receipts, sync metadata, raw provider payloads, and other operational records. `.ritual/data/habit_logs.jsonl` is generated from canonical Daily Markdown as an operational projection; it is not the source of truth for user-authored habit completions.
- `.ritual/repairs/*` stores backups written before explicit repair actions modify malformed or conflicting Markdown.

## Implemented Foundation

Added:

- `PrivacySettings.storageMode`, with values `database_native` and `file_native`.
- `PrivacySettings.vaultPath` for the selected Ritual vault folder.
- settings-window `Ritual folder` controls for selecting a folder, initializing/rebuilding the vault metadata, switching to `file_native`, and returning to database-native mode while preserving the chosen path;
- vault initialization with the expected folder layout and `.ritual` metadata files;
- frontmatter parsing/rendering that preserves unknown scalar and array fields;
- habit Markdown serialization/parsing;
- daily log Markdown serialization/parsing with stable habit-log block markers;
- workflow and report Markdown serialization/parsing;
- derived cache rebuild from vault files;
- desktop SQLite materialization for the derived cache at `.ritual/index.sqlite`, with normalized tables for habits, daily logs, habit logs, workflows, reports, search documents, conflicts, repairs, and index metadata;
- a derived JSON snapshot at `.ritual/index.snapshot.json` for non-desktop/test compatibility, so browser code does not need to parse the binary SQLite file;
- native desktop filesystem events for canonical Markdown folders and `.ritual/data/*.jsonl`, plus checksum-based polling fallback for external edits/deletes;
- checksum entries for `.ritual/data/*.jsonl`, so wearable samples, scheduled blocks, workflow runs, deletion receipts, imports, and other operational JSONL files trigger the same invalidation path as Markdown edits;
- a global React Query bridge that listens for native file events, polls configured file-native folders, debounces external-edit invalidation, and refreshes habit, daily-log, artifact/report, workflow-definition, dashboard, metrics, log, and calendar query caches;
- conflict objects for duplicate top-level IDs, duplicate Daily habit-log block IDs, renamed files, deleted files, merge-conflict markers, and changed content without `updated_at` movement;
- repair objects for malformed frontmatter, missing required fields, invalid dates, unsupported `ritual_type`, unparseable habit-log rows, and malformed `.ritual/data/*.jsonl` rows;
- daily habit-log parsing keeps otherwise valid logs while surfacing invalid structured details such as unsupported `status` values or malformed `completed_at` timestamps as repair work;
- workflow Markdown validation now treats missing `status` as a repair state instead of silently defaulting the canonical workflow record;
- a settings diagnostics section that rebuilds from the selected folder, surfaces repair/conflict counts plus the first affected paths/messages, and can apply conservative user-confirmed fixes with backups under `.ritual/repairs/`;
- Markdown-first write helpers for habits, daily logs, workflows, and reports;
- file-native habit/daily adapter used by the main habit React Query hooks for habit read/create/update/delete/log operations plus service-level daily reflection read/save/delete when `storageMode === "file_native"`;
- file-native saved-artifact adapter used by the reports surface for artifact list/detail/create/update operations, plus service-level delete by stable `ritual_id`, with saved reports and reviews written to readable `Reports/*.md` files plus a full-fidelity `ritual:block artifact_body` JSON block for exact app rendering while preserving custom Markdown after the managed block;
- file-native workflow adapter used by the reports surface for workflow definition list/update operations, plus service-level delete by stable `ritual_id`, with workflow definitions written to `Workflows/*.md` while preserving custom Markdown after the managed definition block;
- file-native manual workflow run adapter used by the reports surface, with operational run records written to `.ritual/data/workflow_runs.jsonl` and generated local workflow output written as normal `Reports/*.md` artifacts;
- file-native scheduled workflow dispatcher used by the app provider in `file_native` mode, with due routine schedules queued locally, idempotency keys written to `.ritual/data/workflow_runs.jsonl`, `last_run_at`/`next_run_at` updated in `Workflows/*.md`, and generated output written as normal `Reports/*.md` artifacts;
- app-facing Markdown writes and deletes now perform a checksum preflight and refuse to overwrite or remove a canonical vault file that changed on disk since the last cache/checksum rebuild;
- daily Markdown writes preserve the existing body by default when the caller only supplies structured fields, so user-authored custom Daily sections survive app-driven reflection or log updates;
- generated `.ritual/data/habit_logs.jsonl` projection from parsed `Daily/YYYY/MM/YYYY-MM-DD.md` habit completions, keeping Obsidian-style Daily Markdown canonical while giving operational consumers a stable JSONL habit-log stream;
- `.ritual/data/scheduled_blocks.jsonl` read/write helpers plus a file-native scheduled-block adapter used by the calendar task composer for create/update/delete in `file_native` mode, keeping sensitive planning blocks out of cloud scheduled-block APIs;
- `.ritual/data/deletion_receipts.jsonl` read/write helpers and configured receipt mirroring for cloud behavioral deletion and external erasure flows, keeping destructive-operation evidence in the file-native vault as operational JSONL rather than editable Markdown;
- `.ritual/data/import_runs.jsonl` and `.ritual/data/import_items.jsonl` read/write helpers for high-volume import metadata and parsed/staged records, including compatibility with existing migration wrapper rows and raw-line preservation for repair diagnostics;
- `.ritual/data/location_pings.jsonl` and `.ritual/data/location_state.jsonl` read/write helpers for raw location pings and materialized current location state, including coordinate validation, Wi-Fi-only Mac ping support, compatibility with existing migration wrapper rows, and raw-line preservation for repair diagnostics;
- `.ritual/data/ocr_frames.jsonl` read/write helpers for local desktop OCR frame records, including timestamp, app/window, OCR text, thumbnail reference, image-hash, storage-tier, and text-quality validation, plus compatibility with existing migration wrapper rows and raw-line preservation for repair diagnostics;
- `.ritual/data/financial_accounts.jsonl` and `.ritual/data/financial_transactions.jsonl` read/write helpers for Plaid-backed account and transaction records, including stable provider IDs, spending-rollup flags, compatibility with existing migration wrapper rows, and raw-line preservation for repair diagnostics;
- `.ritual/data/financial_sync_cursors.jsonl` and `.ritual/data/financial_sync_runs.jsonl` read/write helpers for financial provider cursor state and observable sync runs, including item-count validation, migration wrapper compatibility, and raw-line preservation for repair diagnostics;
- `.ritual/data/ai_conversations.jsonl`, `.ritual/data/ai_messages.jsonl`, and `.ritual/data/ai_facts.jsonl` read/write helpers for AI chat history and semantic memory records, including stable conversation/message/fact IDs, role/status/visibility validation, compatibility with existing migration wrapper rows, and raw-line preservation for repair diagnostics;
- `.ritual/data/private_sync_envelopes.jsonl`, `.ritual/data/private_sync_devices.jsonl`, and `.ritual/data/private_sync_key_grants.jsonl` read/write helpers for encrypted Private Sync envelopes, public trusted-device metadata, and encrypted key grants, including algorithm/ciphertext validation, migration wrapper compatibility, and raw-line preservation for repair diagnostics. Local private device keys are not written to the file-native vault;
- `.ritual/data/sms_copilot.jsonl` read/write helpers for SMS/copilot intervention records, including stable event IDs, event-kind/status filters, migration wrapper compatibility, and raw-line preservation for repair diagnostics;
- `.ritual/data/wearable_events.jsonl` read/write helpers for high-level wearable events such as sleep sessions and workouts, including provider/type/date filters, deleted-record filtering, time-range validation, migration wrapper compatibility, and raw-line preservation for repair diagnostics;
- `.ritual/data/wearable_raw_payloads.jsonl`, `.ritual/data/wearable_sync_cursors.jsonl`, and `.ritual/data/wearable_sync_runs.jsonl` read/write helpers for raw provider payload audit records and wearable provider sync metadata, including payload hash/timestamp validation, cursor/run filtering, migration wrapper compatibility, and raw-line preservation for repair diagnostics;
- migration helper from existing record batches into the file-native vault, with canonical habits/daily logs/workflows/reports written as Markdown and operational/high-volume categories such as scheduled blocks and wearable samples written to `.ritual/data/*.jsonl`;
- local-vault promotion helper that reads verified, non-tombstoned encrypted desktop vault records and writes them into the file-native Ritual folder through the same canonical Markdown/JSONL migration path;
- settings migration controls now expose a `Write folder` action that promotes the selected local vault categories into the active file-native Ritual folder after the user has chosen and initialized that folder;
- migration writes now preserve existing unknown frontmatter, custom Markdown sections, existing daily habit-log entries, existing valid `.ritual/data/*.jsonl` rows, and malformed raw JSONL lines that need later repair; if a filename already belongs to a different `ritual_id`, migration writes a suffixed Markdown file instead of clobbering the existing one;
- derived-index vault search and AI retrieval context helpers that read the desktop SQLite index when available, fall back to the derived cache snapshot in web/test mode, and return no result in database-native mode, preserving the backend/cloud search path for existing users;
- derived-index habit analytics helpers that read the cache snapshot in `file_native` mode and return normalized daily rows, summary rows, and calendar habit-log read-model data without scanning Markdown at query time;
- command palette local-vault search in `file_native` mode, including habit, daily log, workflow, and report hits from the derived cache before cloud search is attempted;
- a desktop `search_file_native_index` command and dashboard bridge that query `.ritual/index.sqlite` directly for search-facing queries when available, with `.ritual/index.snapshot.json` preserved as the web/test fallback;
- a desktop `query_file_native_habit_analytics` command and dashboard bridge that aggregate habit statistics from `.ritual/index.sqlite` when available, with `.ritual/index.snapshot.json` preserved as the web/test fallback;
- a desktop `retrieve_file_native_context` command and dashboard bridge that return bounded local vault excerpts from `.ritual/index.sqlite` for AI retrieval when available, with `.ritual/index.snapshot.json` preserved as the web/test fallback;
- metrics card/bar-list effects that read the local file-native analytics cache before Tinybird/backend analytics endpoints, so local habit statistics remain available without uploading private vault data;
- `.ritual/data/habit_logs.jsonl` read/write projection helpers for parsed Daily Markdown habit completions;
- `.ritual/data/wearable_samples.jsonl` read/write helpers for high-volume wearable records, plus file-native analytics/calendar rollups that match samples to wearable-backed habits without turning raw samples into hand-edited Markdown;
- `.ritual/data/import_runs.jsonl`, `.ritual/data/import_items.jsonl`, `.ritual/data/location_pings.jsonl`, `.ritual/data/location_state.jsonl`, `.ritual/data/ocr_frames.jsonl`, `.ritual/data/financial_accounts.jsonl`, `.ritual/data/financial_transactions.jsonl`, `.ritual/data/financial_sync_cursors.jsonl`, `.ritual/data/financial_sync_runs.jsonl`, `.ritual/data/ai_conversations.jsonl`, `.ritual/data/ai_messages.jsonl`, `.ritual/data/ai_facts.jsonl`, `.ritual/data/private_sync_envelopes.jsonl`, `.ritual/data/private_sync_devices.jsonl`, `.ritual/data/private_sync_key_grants.jsonl`, `.ritual/data/sms_copilot.jsonl`, `.ritual/data/wearable_events.jsonl`, `.ritual/data/wearable_raw_payloads.jsonl`, `.ritual/data/wearable_sync_cursors.jsonl`, and `.ritual/data/wearable_sync_runs.jsonl` helpers normalize both flat file-native rows and existing migration wrapper rows, while preserving malformed raw lines when appending or updating valid operational records;
- typed `.ritual/data/*.jsonl` writers preserve malformed or non-normalizable raw lines while merging valid records, so diagnostics are not silently erased by later operational writes;
- derived-cache rebuilds validate known operational JSONL files with the same typed normalizers used by read/write helpers, so syntactically valid but unusable rows are surfaced as `malformed_jsonl` repair work instead of being silently skipped;
- `.ritual/data/deletion_receipts.jsonl` read/write helpers for deletion receipts, including migration normalization from the existing local vault receipt shape and live mirroring from cloud deletion/external erasure clients when a file-native Ritual folder is configured;
- calendar read-model queries that read local vault habit logs in `file_native` mode before falling back to the existing calendar API path;
- consent-gated chat retrieval context that attaches bounded local vault snippets only when the user is in `cloud_intelligence` mode with `ai` consent enabled, so the server never reads the local vault folder directly;
- tests for initialization, parser round trips, rename/delete/conflict/repair states, checksums, derived cache rebuild, migration, and user-authored section preservation.
- tests for app-facing habit, saved-artifact, workflow, file-native vault search/retrieval, and file-native analytics adapters.

Primary files:

- `apps/dashboard/lib/privacy/file-native-vault-types.ts`
- `apps/dashboard/lib/privacy/file-native-vault-frontmatter.ts`
- `apps/dashboard/lib/privacy/file-native-vault-markdown.ts`
- `apps/dashboard/lib/privacy/file-native-vault-storage.ts`
- `apps/dashboard/lib/privacy/file-native-vault-cache.ts`
- `apps/dashboard/lib/privacy/file-native-vault.ts`
- `apps/dashboard/lib/privacy/file-native-vault-sqlite-index.ts`
- `apps/dashboard/lib/privacy/file-native-vault-change.ts`
- `apps/dashboard/lib/privacy/file-native-vault-diagnostics.ts`
- `apps/dashboard/lib/privacy/file-native-vault-settings.ts`
- `apps/dashboard/lib/privacy/file-native-vault-repair.ts`
- `apps/dashboard/lib/privacy/file-native-vault-data.ts`
- `apps/dashboard/lib/privacy/file-native-deletion-receipts.ts`
- `apps/dashboard/lib/privacy/file-native-scheduled-block-adapter.ts`
- `apps/dashboard/lib/privacy/file-native-vault-search.ts`
- `apps/dashboard/lib/privacy/file-native-vault-chat-context.ts`
- `apps/dashboard/lib/privacy/file-native-analytics-adapter.ts`
- `apps/dashboard/lib/privacy/file-native-habit-adapter.ts`
- `apps/dashboard/lib/privacy/file-native-artifact-adapter.ts`
- `apps/dashboard/lib/privacy/file-native-workflow-adapter.ts`
- `apps/dashboard/components/file-native-workflow-scheduler-bridge.tsx`
- `apps/desktop/src-tauri/src/file_native_watcher.rs`
- `apps/dashboard/components/file-native-vault-change-bridge.tsx`
- `apps/dashboard/components/privacy-file-native-vault-diagnostics-section.tsx`
- `apps/dashboard/components/privacy-file-native-vault-section.tsx`
- `apps/dashboard/tests/privacy-file-native-vault.test.ts`
- `apps/dashboard/tests/privacy-file-native-vault-diagnostics.test.ts`
- `apps/dashboard/tests/privacy-file-native-vault-settings.test.ts`
- `apps/dashboard/tests/privacy-file-native-vault-search.test.ts`
- `apps/dashboard/tests/privacy-file-native-analytics-adapter.test.ts`
- `apps/dashboard/tests/privacy-file-native-habit-adapter.test.ts`
- `apps/dashboard/tests/privacy-file-native-artifact-adapter.test.ts`
- `apps/dashboard/tests/privacy-file-native-workflow-adapter.test.ts`
- `apps/desktop/src-tauri/src/file_native_index.rs`
- `apps/desktop/src-tauri/src/file_native_index_analytics.rs`
- `apps/desktop/src-tauri/src/file_native_index_retrieval.rs`

## Current Boundary

The implementation is additive and gated. Existing database-native behavior is not removed.

The settings UI now lets desktop users choose a Ritual folder through the native folder picker. Selection initializes the folder, creates `Habits/`, `Daily/`, `Workflows/`, `Reports/`, `.ritual/manifest.json`, `.ritual/checksums.json`, `.ritual/schema/*.json`, and the derived index artifact, then stores `storageMode: "file_native"` and `vaultPath` in privacy settings.

The app now mounts a lightweight file-native change bridge inside the React Query provider. In `file_native` mode on Desktop, it starts a native recursive watcher for `Habits/`, `Daily/`, `Workflows/`, `Reports/`, and `.ritual/data/*.jsonl`, ignores derived `.ritual` files such as checksums/index snapshots, and emits `ritual:file-native-vault-fs-event` when source files change. The bridge then runs the same checksum-based poll/rebuild path, debounces invalidation, emits `ritual:file-native-vault-changed`, and refreshes app queries that depend on the derived cache. The interval/focus polling path remains as the cross-platform fallback. Polling now tracks `.ritual/data/*.jsonl` checksums as first-class source files, so operational JSONL edits and deletes are detected even without native filesystem events.

The settings UI includes Ritual folder diagnostics. It rebuilds the derived cache, reports indexed category counts, and surfaces conflicts/repairs such as duplicate `ritual_id`, duplicate Daily habit-log block IDs, malformed frontmatter, deleted files, renamed files, merge-conflict markers, unparseable habit-log rows, and malformed operational JSONL rows. JSONL diagnostics cover invalid JSON, non-object rows, and known typed rows that parse but fail their schema normalizer, such as scheduled blocks with invalid time ranges. Supported repair actions are explicit and user-confirmed: normalize missing/invalid frontmatter, recover malformed frontmatter into a valid Markdown file with raw content preserved, and assign a unique `ritual_id` to duplicate files. Every applied action writes a backup under `.ritual/repairs/` before changing the affected Markdown file. Unsupported diagnostics, including merge-conflict markers, duplicate habit-log block IDs, malformed JSONL, and ambiguous external-update/deletion states, remain manual repair items. The repair planner intentionally does not use the top-level duplicate-file repair on duplicate Daily habit-log block IDs, because that would rewrite Daily frontmatter without fixing the duplicate block marker. Typed JSONL writers preserve those malformed raw lines when adding or updating valid operational rows, so a later app write does not silently discard repair evidence.

The main habit hooks now use the file-native vault as the source of truth in `file_native` mode. Habit logging writes `Daily/YYYY/MM/YYYY-MM-DD.md`; service-level daily reflection saves update that same canonical Daily Markdown file while preserving structured habit-log blocks and unknown user-authored sections even if the caller only supplies structured fields; service-level daily log deletion removes the canonical Daily Markdown file by date after resolving its stable `ritual_id`. Invalid structured habit-log detail rows are surfaced as repair diagnostics while valid rows from the same Daily file remain indexed. An empty configured vault returns empty habit and log arrays, so the app does not fall back to database/cloud reads simply because the vault has no records yet.

Canonical Markdown writes and deletes now check the last known `.ritual/checksums.json` entry before changing a file. If the target file has changed on disk since the last cache rebuild, the operation fails closed instead of replacing or removing external edits. The user can then rebuild diagnostics, inspect the conflict, and retry after the vault cache has incorporated the external change.

The reports surface now uses `Reports/*.md` for saved artifact list/detail/create/update flows in `file_native` mode, with a service-level delete helper available for future UI flows. The adapter renders common structured report blocks such as hero, summary, bullet list, and metric list as normal Markdown sections first, then stores the full-fidelity structured artifact body inside a stable `ritual:block artifact_body` JSON block so the UI can round trip existing structured report rendering while keeping the Markdown file readable and canonical. User-authored sections appended after the managed Ritual data block are preserved on app updates.

The reports surface also reads and updates workflow definitions through `Workflows/*.md` in `file_native` mode, with a service-level delete helper available for future UI flows. The adapter stores readable workflow frontmatter plus a full-fidelity structured workflow definition inside a stable `ritual:block workflow_definition` JSON block, preserving user-authored sections appended after that managed block on app updates. Manual workflow runs now stay local in `file_native` mode: the reports surface queues them through the file-native adapter, records run history in `.ritual/data/workflow_runs.jsonl`, updates the workflow definition's `last_run_at`, and writes the generated output as a normal `Reports/*.md` artifact with `source_type: workflow_run`. Scheduled routine workflows also run locally while the app is open: the provider bridge checks due `next_run_at` slots on load, focus, vault changes, privacy-setting changes, and a one-minute interval, queues each due slot once with an idempotency key, advances `next_run_at`, and invalidates workflow/report caches. If the app was closed through several scheduled slots, the dispatcher now catches up bounded missed slots in one app-open check, writes per-slot reports using each slot's scheduled date, advances `next_run_at` to the next future slot, and records the current scheduler status in `.ritual/data/workflow_scheduler_state.jsonl`. The vault change bridge ignores changes that only touch that singleton status file, avoiding a scheduler self-invalidation loop. Closed-app background dispatch, action profile management, approvals, and cloud-executed workflow actions still use the existing API path.

The command palette now checks the configured file-native vault before calling the server search API. This keeps local vault search on the client side and avoids routing private Markdown content through the backend search proxy. On Desktop, search uses `.ritual/index.sqlite` directly; otherwise it reads the derived cache snapshot and only rebuilds when missing. Query-time search and AI retrieval are based on normalized index content rather than repeated Markdown scans. A bounded retrieval-context helper is available for AI chat integration, with source paths, snippets, and capped content excerpts from the derived index.

The main chat send path now uses that retrieval helper in `file_native` mode, but only when local privacy settings allow cloud AI (`mode: cloud_intelligence` plus `ai` consent). On Desktop, retrieval first invokes `retrieve_file_native_context` against `.ritual/index.sqlite`; otherwise it uses `.ritual/index.snapshot.json`. The client sends a bounded `localVaultContext` payload alongside the chat request; the server-side chat runtime appends it as a read-only system context with file-path citations and explicit instructions not to edit or rewrite vault Markdown without user approval. The server still cannot browse the local vault folder on its own.

The metrics view now checks the file-native analytics adapter before calling Tinybird or backend analytics APIs. On Desktop, the adapter first invokes `query_file_native_habit_analytics` against `.ritual/index.sqlite`; otherwise it reads `.ritual/index.snapshot.json` and rebuilds the derived cache only when no snapshot exists. It converts canonical vault habit logs into the same daily-row and summary-row shapes the existing metrics cards and bar lists consume, including support for a wider sparkline range and a narrower summary range. The adapter also reads `.ritual/data/wearable_samples.jsonl` and rolls matching wearable samples into analytics/calendar read models for habits with matching `metric_type` and `integration_source`, keeping raw samples out of user-authored Markdown.

The calendar task composer now writes scheduled planning blocks to `.ritual/data/scheduled_blocks.jsonl` in `file_native` mode before using the existing API path. Calendar read-model queries include those local scheduled blocks in the same shape as the backend scheduled-block API, so month/week views can render, create, drag-update, and delete local planning blocks without sending them to the cloud. Database-native mode keeps the existing `/api/calendar/scheduled-blocks` behavior.

The file-native migration helper now preserves non-Markdown operational records instead of dropping them. Core user-authored categories still become canonical Markdown files, while supported operational collections such as `scheduled_blocks`, `wearable_samples`, `deletion_receipts`, imports, location state/pings, OCR frames, AI records, Private Sync encrypted metadata, SMS/copilot, wearable events, wearable raw payloads, wearable sync metadata, financial records, financial sync metadata, and workflow runs are written to collection-specific `.ritual/data/*.jsonl` files. Habit-log migration records are written into canonical Daily Markdown first; cache rebuild then regenerates `.ritual/data/habit_logs.jsonl` from those Daily files. Typed scheduled-block, wearable-sample, wearable-event, wearable-raw-payload, wearable-sync-cursor, wearable-sync-run, deletion-receipt, import-run, import-item, location-ping, location-state, OCR-frame, financial-account, financial-transaction, financial-sync-cursor, financial-sync-run, AI-conversation, AI-message, AI-fact, private-sync-envelope, private-sync-device, private-sync-key-grant, and SMS/copilot-event rows are normalized for app read paths; malformed incoming operational rows are preserved with `needs_repair` metadata for future repair tooling. Re-running migration into an edited Ritual folder now merges with existing files instead of replacing them: unknown frontmatter, custom habit/workflow/report Markdown, daily reflections, existing daily habit-log entries, existing valid JSONL rows, and malformed raw JSONL lines are preserved. If the desired Markdown filename already belongs to a different `ritual_id`, migration writes a suffixed file for the incoming record rather than clobbering the existing file. A local-vault promotion helper now bridges the earlier encrypted desktop vault into this file-native path by listing selected local vault categories, skipping tombstones, hashing the promoted source records, and writing them through the canonical file-native migrator. The Settings > Privacy migration controls expose that bridge as a file-native-only `Write folder` action, so a user can first migrate cloud records into the encrypted local vault and then write the selected categories into the selected Ritual folder.

On Desktop, each derived cache rebuild invokes `rebuild_file_native_index`, which writes a real SQLite database to `.ritual/index.sqlite`. If an older derived JSON file already exists at that path, the desktop command moves it to `.ritual/index.legacy-json.bak` before creating the SQLite database. Desktop search-facing queries invoke `search_file_native_index`, habit analytics invoke `query_file_native_habit_analytics`, and AI retrieval invokes `retrieve_file_native_context` against that SQLite file first. These paths fall back to `.ritual/index.snapshot.json` if the native index is unavailable. Non-desktop and test runs continue to write/read `.ritual/index.snapshot.json` and only use JSON at `.ritual/index.sqlite` as a legacy fallback.

## Follow-Up Work

Next implementation stages:

1. Define whether closed-app/background file-native workflow dispatch needs a native daemon or OS scheduler beyond the current app-open catch-up dispatcher and `.ritual/data/workflow_scheduler_state.jsonl` handoff/status record.
2. Extend typed `.ritual/data/*.jsonl` adapters beyond habit-log projections, wearable samples/events/raw payloads/sync metadata, scheduled blocks, deletion receipts, workflow runs, imports, location records, OCR frames, financial records/sync metadata, AI records, Private Sync encrypted metadata, and SMS/copilot records to any remaining high-volume operational categories as those app surfaces are wired into file-native mode.
