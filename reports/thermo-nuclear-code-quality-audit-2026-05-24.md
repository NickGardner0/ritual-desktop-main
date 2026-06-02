# Thermo-Nuclear Code Quality Audit - Ritual Desktop Main

Date: 2026-05-24
Scope: `ritual-desktop-main`
Rubric: `thermo-nuclear-code-quality-review copy.md`
Constraint: audit only. No source code was intentionally modified.

## Executive Summary

The codebase is functional, but its maintainability risk is high. The main issue is not one bad subsystem. The same pattern appears across React, Python, Rust, Swift, and shared TypeScript packages: very large files own too many responsibilities, several orchestration paths duplicate each other, and key domain boundaries are implicit rather than enforced by small modules or typed interfaces.

Validation is mixed. TypeScript typecheck passes, selected backend tests pass, selected dashboard tests pass, and the Tauri Rust workspace passes `cargo check`. However, `npm run lint` currently fails with four errors. That means the repo is not in a clean quality-gate state even before deeper structural refactoring.

The highest-leverage fixes are:

1. Consolidate chat runtime tool orchestration into one shared engine.
2. Split backend wearables into provider adapters, ingest stages, query/read models, and API routers.
3. Move database schema and migrations out of runtime startup code and into versioned migrations.
4. Replace dashboard API proxy sprawl with one canonical proxy helper.
5. Split desktop watcher/process supervision and iOS background sync into smaller bounded modules.
6. Put file-size, lint, and test gates around these refactor seams before broad cleanup.

## Validation Run

Commands run during the audit:

```bash
npm run typecheck
```

Result: passed.

```bash
npm run test:dashboard
```

Result: passed, 76 tests.

```bash
cd apps/backend && python3 -m pytest tests/test_unified_wearables.py tests/test_wearables_query_service.py tests/test_turso_sync_api.py
```

Result: passed, 34 tests. Warnings remain for SQLAlchemy `declarative_base()` deprecation and Pydantic class-based `Config` deprecation.

```bash
python3 -m compileall -q apps/backend
```

Result: passed.

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
```

Result: passed.

```bash
npm run lint
```

Result: failed. Current lint errors:

- `apps/dashboard/app/(dashboard)/chat/use-chat-voice-input.ts:144` - `stopVoiceRecording` is accessed before declaration.
- `apps/dashboard/components/analytics/metrics-view-card-sections.tsx:184` - ref mutation during render.
- `apps/dashboard/tests/metric-context-builder.test.mjs:23` - assigns to `module`.
- `apps/dashboard/tests/wearables-dashboard.test.mjs:20` - assigns to `module`.

Current lint warnings include `set-state-in-effect`, unused eslint disables, and render-time impurity warnings in analytics/auth/sidebar/settings areas.

## Size And Shape Findings

The tracked source tree is large and has many files beyond a maintainable single-file budget:

```text
source files: 814
source lines: 211407
files over 300 lines: 214
files over 500 lines: 119
files over 1000 lines: 46
```

Largest tracked source files:

```text
2657 apps/desktop/src-tauri/bin/ritual-watcher/src/macos.rs
2341 apps/desktop/src-tauri/src/watcher.rs
2285 apps/backend/api/wearables.py
2217 apps/ios-companion/Sources/RitualCompanion/Services/BackgroundSyncManagerV2.swift
2170 apps/dashboard/components/ai-habit-chat.tsx
1870 apps/desktop/src-tauri/crates/ritual-db/src/schema.rs
1784 apps/desktop/src-tauri/crates/ritual-db/src/text_processing.rs
1765 apps/dashboard/app/(dashboard)/reports/reports-client.tsx
1711 apps/dashboard/app/(dashboard)/calendar/calendar-client.tsx
1657 apps/backend/database/models.py
1635 apps/desktop/src-tauri/src/recorder.rs
1607 apps/desktop/src-tauri/src/main.rs
1593 apps/ios-companion/Sources/RitualCompanion/Services/HealthKitManagerV2.swift
1592 apps/backend/services/search_service.py
1581 apps/backend/database/connection.py
1579 apps/backend/services/watcher_service_computer_activity.py
1551 apps/backend/services/metric_facts_service.py
1504 apps/dashboard/components/analytics/overview-view.tsx
1485 apps/dashboard/components/apple-watch-settings.tsx
1441 apps/dashboard/components/data-import-modal.tsx
1422 apps/desktop/src-tauri/bin/ritual-watcher/src/browser_heartbeat_server.rs
1398 apps/backend/api/imports.py
1362 apps/backend/services/turso_user_service.py
1356 apps/dashboard/components/habit-selection-modal.tsx
1354 apps/dashboard/components/tables/habit-logs/data-table.tsx
1339 apps/backend/services/whoop_service.py
1287 apps/backend/services/analytics_service.py
1224 packages/chat-runtime/src/handle-chat-stream.ts
```

This is a systemic architecture problem, not just a style issue. Large files are acting as cross-domain coordinators, route registries, state machines, view models, and rendering code at the same time.

Recommended guardrail:

- Warn at 500 lines for hand-authored source.
- Require explicit justification above 800 lines.
- Block new files above 1000 lines, except generated files and schema snapshots.
- Track this in CI with a simple file-size budget script.

## Highest Priority Findings

### 1. Chat Runtime Has Two Tool Dispatch Systems

Severity: high

Evidence:

- `packages/chat-runtime/src/runtime-tools.ts` already exports shared helpers such as `getOpenAIClient`, `safeJsonParse`, `withToolErrorHandling`, and `dispatchToolCall`.
- `packages/chat-runtime/src/handle-chat-stream.ts` redefines the same concepts locally: elapsed timing, OpenAI client creation, JSON parsing, tool error handling, and tool dispatch.
- `packages/chat-runtime/src/sms.ts` uses the shared runtime tool dispatcher, while `handle-chat-stream.ts` uses its own duplicate dispatcher.
- `packages/chat-runtime/src/handle-chat-stream.ts` is 1224 lines and mixes auth, prompt loading, fact retrieval, deterministic routing, OpenAI streaming, tool-call reconstruction, canvas payload handling, voice behavior, and persistence.

Why this matters:

The main chat endpoint and SMS path can drift in behavior even when they are supposed to support the same tools. Bug fixes to one dispatcher may not affect the other. Adding a tool requires understanding multiple loops and multiple execution contracts.

Recommended change:

Create one canonical chat turn engine:

```text
ChatTurnEngine
  -> builds context
  -> applies deterministic routing policy
  -> calls OpenAI provider
  -> reconstructs tool calls
  -> dispatches through ToolRegistry
  -> emits typed stream events
  -> persists final turn
```

The shared `ToolRegistry` should own:

- tool schema
- argument parsing
- executor
- result collection
- canvas payload extraction
- error mapping

`handle-chat-stream.ts`, SMS, and proactive SMS should become thin adapters over the same engine.

### 2. Wearables Is A Router/Service Knot

Severity: high

Evidence:

- `apps/backend/api/wearables.py` is 2285 lines.
- `create_wearables_router` owns provider service imports, serializers, connection status, manual sync, scheduled sync, raw payload inspection, Apple device auth, Apple ingest, export formatting, and metric preferences.
- Manual sync and scheduled sync branch on provider-specific services in the API router.
- Apple export logic renders CSV, Markdown, and JSON inline in the route layer.
- Apple ingest has multiple versions and is mixed with connection/admin endpoints.

Related large files:

- `apps/backend/services/wearables_service.py` - 1064 lines.
- `apps/backend/services/whoop_service.py` - 1339 lines.
- `apps/backend/services/wearables_unified/query.py` - 983 lines and uses a wildcard import from `.common`.

Why this matters:

The write path, read path, provider adapters, admin/debug paths, and UI-facing route contracts are all coupled. This makes sync bugs hard to isolate and makes each new provider or metric type increase the complexity of unrelated code.

Recommended change:

Split by boundary, not by provider name alone:

```text
api/wearables/connections.py
api/wearables/sync.py
api/wearables/apple.py
api/wearables/admin.py
api/wearables/exports.py
services/wearables/provider_adapter.py
services/wearables/ingest_pipeline.py
services/wearables/projection_pipeline.py
services/wearables/read_model.py
```

Provider-specific services should implement a common adapter contract:

```text
connect
refresh_credentials
sync_window
normalize_payload
disconnect
connection_health
```

The canonical data flow should be:

```text
ProviderAdapter
  -> RawPayload
  -> Normalize
  -> Upsert canonical samples/events
  -> Projection policy
  -> Outbox/materialization
  -> Read models
```

Each stage should have durable status and idempotency keys. API routes should call the pipeline, not provider-specific internals.

### 3. Database Schema And Migration Logic Are Runtime Side Effects

Severity: high

Evidence:

- `apps/backend/database/models.py` is 1657 lines and defines users, habits, imports, wearables, financial data, chat/SMS, watcher data, artifacts, workflows, and reports in one file.
- `apps/backend/database/connection.py` is 1581 lines and handles engine configuration, libsql compatibility patching, database initialization, replica validation, table creation, schema alteration, deduplication, and data backfills.
- `connection.py` patches `sqlalchemy_libsql.aiolibsql` near startup.
- Migration/backfill logic runs through application startup paths instead of a versioned migration system.

Why this matters:

Startup should not be the place where schema ownership, driver compatibility, operational migration, and data cleanup all happen. It creates hidden boot-time behavior and makes local/dev/prod database state harder to reason about.

Recommended change:

- Split models by domain and re-export them through a single metadata registration module.
- Move libsql compatibility patching to a small `db/libsql_compat.py` module with a version guard and removal criteria.
- Introduce versioned migrations. Alembic is the obvious option, but a small internal migration runner would still be better than inline startup DDL.
- Keep startup initialization limited to "connect, validate version, fail clearly if migration is required."

### 4. Dashboard API Proxy Logic Is Duplicated

Severity: medium-high

Evidence:

- `apps/dashboard/lib/server/proxy-helper.ts` exists, but many route files still reimplement backend URL lookup, auth handling, request forwarding, and error mapping.
- Repeated patterns appear under dashboard routes for screen time, computer activity, watcher stats, project time, search, suggestions, imports, and wearables.
- `packages/chat-runtime/src/executors/shared-api.ts` separately defines Python API base URL handling and fetch helpers.

Why this matters:

The dashboard has multiple semantics for the same boundary: how to resolve backend URL, how to pass auth, what to do on non-JSON responses, what timeout/retry behavior exists, and how errors are shaped. That creates fragile operational behavior and duplicated fixes.

Recommended change:

Make `proxy-helper.ts` the mandatory route boundary for backend forwarding:

```text
backendProxyRoute({
  method,
  path,
  authPolicy,
  bodyPolicy,
  responsePolicy,
  timeoutMs
})
```

Bespoke route files should only exist when they transform data or aggregate multiple services. Everything else should be declarative configuration over the shared proxy helper.

### 5. Desktop Watcher Code Combines Process Supervision, Diagnostics, DB Querying, And Native Capture

Severity: medium-high

Evidence:

- `apps/desktop/src-tauri/src/main.rs` is 1607 lines and owns module wiring, environment setup, Turso/database startup, cloud sync startup, watcher auto-start, watchdog tasks, URL handling, command registration, and legacy recorder surface registration.
- `apps/desktop/src-tauri/src/watcher.rs` is 2341 lines and includes process state, config types, binary discovery, start/stop, synchronous and asynchronous start variants, diagnostics, DB queries, and context quality scoring.
- `apps/desktop/src-tauri/bin/ritual-watcher/src/macos.rs` is 2657 lines and includes `#![allow(dead_code)]`, native accessibility traversal, candidate scoring, sensitive-content filtering, debug dumping, and active-window capture.
- `start_watcher` and `start_watcher_sync` duplicate a large amount of process startup behavior.

Why this matters:

Native capture and process supervision are high-risk areas. When they are embedded in giant modules, simple changes become risky because test seams and ownership boundaries are unclear.

Recommended change:

Split desktop watcher into:

```text
watcher/process_supervisor.rs
watcher/config_store.rs
watcher/binary_resolver.rs
watcher/diagnostics.rs
watcher/query_facade.rs
watcher/icon_extraction.rs
```

Split macOS capture into:

```text
macos/active_window.rs
macos/accessibility_capture.rs
macos/candidate_scoring.rs
macos/sensitive_filter.rs
macos/debug_dump.rs
```

Replace duplicated async/sync start functions with one command builder plus one spawn path.

### 6. iOS Background Sync Is A Monolithic Manager

Severity: medium-high

Evidence:

- `apps/ios-companion/Sources/RitualCompanion/Services/BackgroundSyncManagerV2.swift` is 2217 lines.
- `apps/ios-companion/Sources/RitualCompanion/Services/HealthKitManagerV2.swift` is 1593 lines.
- Background sync owns scheduling, HealthKit access coordination, upload planning, multiple ingest paths, queue draining, logging, history/status, retry behavior, and user-facing progress text.

Why this matters:

Mobile background sync is already hard to debug because OS scheduling is constrained. A single manager with many responsibilities makes idempotency, retry safety, and duplicate-work prevention harder to prove.

Recommended change:

Split into:

```text
BackgroundTaskRegistrar
SyncPlanner
MetricWindowStore
HealthKitReadService
UploadTransactionBuilder
OfflineQueueDrainer
SyncStatusStore
```

All calls to backend ingest should go through one upload transaction builder so deduplication, metadata, retries, and status recording are uniform.

### 7. Frontend Components Are Stateful Application Containers

Severity: medium

Evidence:

Large React files with high hook counts:

```text
apps/dashboard/components/ai-habit-chat.tsx
  2170 lines, 21 useState, 9 useEffect, 9 useCallback, 8 useMemo

apps/dashboard/app/(dashboard)/reports/reports-client.tsx
  1765 lines, 10 useState, 4 useEffect, 4 useMemo

apps/dashboard/app/(dashboard)/calendar/calendar-client.tsx
  1711 lines, 14 useState, 4 useEffect, 16 useCallback, 10 useMemo

apps/dashboard/components/analytics/overview-view.tsx
  1504 lines, 14 useState, 8 useEffect, 21 useCallback, 23 useMemo

apps/dashboard/components/apple-watch-settings.tsx
  1485 lines, 24 useState, 3 useEffect, 6 useCallback

apps/dashboard/components/data-import-modal.tsx
  1441 lines, 21 useState, 3 useEffect, 14 useCallback
```

Why this matters:

These files combine data fetching, workflow state, derived models, event handling, and UI rendering. This causes brittle hook dependencies, lint issues, and poor testability. The lint errors and warnings are a symptom of this pattern.

Recommended change:

Extract domain hooks and presentation components:

- `AIHabitChat`: `useVoiceInput`, `useHabitLogParser`, `useSuggestions`, `useScreenshotLogFlow`, `HabitChatComposer`.
- `ReportsClient`: artifact workflows, approval flows, report list view, report detail view, memory/facts hooks.
- `CalendarClient`: calendar model builder, task composer, API hooks, render-only calendar grid.
- `OverviewView`: wearable totals, computer activity summary, context panels, metric cards.
- `AppleWatchSettings`: device status, metric preferences, projection policy editor, export panel.
- `DataImportModal`: reducer-backed step state machine, parser preview, mapping editor, import execution.

Do not start by moving JSX around randomly. Start by extracting pure model builders and workflow hooks, then split rendering.

## Additional Findings

### Dead And Legacy Code Needs A Deletion Ledger

Evidence:

- Desktop still exposes disabled or legacy recorder/OCR command surfaces.
- `apps/desktop/src-tauri/bin/ritual-watcher/src/macos.rs` has `#![allow(dead_code)]`.
- Chat runtime has feature-flagged SMS prompt paths with comments indicating removal after the new prompt is permanent.
- iOS biometrics sync has intentionally disabled live sync paths.

Recommended change:

Create a short-lived `docs/deprecation-ledger.md` with four statuses:

```text
active
legacy-supported
deprecated-delete-after-date
delete-now
```

Every disabled feature flag, no-op service, compatibility shim, and legacy command should be classified. Anything in `delete-now` should be removed in small PRs. Anything deprecated should have an owner and date.

### Tests Do Not Yet Protect The Desired Refactor Seams

Evidence:

- Backend tests are the strongest part of the currently observed test suite.
- Dashboard has only a small number of tests relative to the size of its stateful UI.
- Chat runtime tests include copied logic with comments indicating future direct imports.
- Desktop and iOS have limited coverage around the riskiest orchestration seams.

Recommended change:

Add tests around extracted seams before major movement:

- Chat tool registry contract tests.
- Chat stream event reconstruction tests.
- Wearables ingest pipeline idempotency tests.
- Provider adapter contract tests for Whoop/Oura/Garmin/Apple.
- Dashboard proxy helper behavior tests.
- Frontend model-builder tests for reports/calendar/analytics.
- Desktop watcher command-builder tests.
- iOS upload transaction builder tests.

### Local Artifact Hygiene Is Heavy

Evidence:

Observed local working directory footprint:

```text
repo total: 10G
apps/desktop/src-tauri/target: 6.9G
root node_modules: 1.2G
apps/backend/.venv: 306M
apps/dashboard/.next: 291M
apps/tinybird/python-service/venv: 123M
.claude: 58M
```

These are mostly ignored, but the amount of generated local state makes audits slower and increases the chance of accidental artifact churn.

Recommended change:

- Keep `.taurignore` or an equivalent committed ignore/export policy if packaging is affected by these directories.
- Add a documented cleanup command for local generated state.
- Keep generated Tauri schemas and watcher binaries out of routine validation diffs, or make their regeneration explicit and isolated.

## Recommended Refactor Sequence

### Phase 0 - Stop The Bleeding

1. Fix the four current lint errors.
2. Add a file-size budget check to CI.
3. Make generated artifact regeneration explicit in docs/scripts.
4. Add a deprecation ledger for disabled and legacy surfaces.
5. Pick one owner per major boundary: chat runtime, wearables, database, desktop watcher, iOS sync, dashboard shell.

### Phase 1 - Consolidate Chat Runtime

1. Move all tool dispatch to `runtime-tools.ts` or a new `ToolRegistry`.
2. Make `handle-chat-stream.ts`, SMS, and proactive SMS use the same engine.
3. Extract deterministic routing from the stream handler into a policy module.
4. Add contract tests for the tool loop before deleting duplicate dispatcher code.

This is the best first structural refactor because the duplicate implementation is clear and the blast radius can be contained with tests.

### Phase 2 - Split Wearables API And Pipeline

1. Split `api/wearables.py` into routers by responsibility.
2. Introduce a provider adapter interface.
3. Move scheduled/manual sync into a shared service.
4. Move exports out of the route file.
5. Make Apple ingest v1/v2 converge on one ingest pipeline.

### Phase 3 - Fix Database Ownership

1. Split `models.py` by domain.
2. Introduce versioned migrations.
3. Remove startup-time schema mutation except for explicit migration checks.
4. Move libsql compatibility patching into a named adapter module with removal criteria.

### Phase 4 - Normalize Dashboard Boundaries

1. Convert simple API routes to `proxy-helper.ts`.
2. Extract pure model builders from the largest dashboard components.
3. Move workflow state into hooks or reducers.
4. Keep visual components mostly render-only.

### Phase 5 - Desktop And iOS Decomposition

1. Split Tauri watcher process management from diagnostics and DB query code.
2. Split macOS accessibility capture from scoring and filtering.
3. Split iOS background sync into scheduler, planner, upload transaction, queue drainer, and status store.
4. Add focused tests at each extracted seam.

## Concrete Cleanup Targets

Start with these files because they are large, central, and have obvious seams:

```text
packages/chat-runtime/src/handle-chat-stream.ts
packages/chat-runtime/src/runtime-tools.ts
apps/backend/api/wearables.py
apps/backend/database/connection.py
apps/backend/database/models.py
apps/dashboard/lib/server/proxy-helper.ts
apps/desktop/src-tauri/src/watcher.rs
apps/desktop/src-tauri/src/main.rs
apps/desktop/src-tauri/bin/ritual-watcher/src/macos.rs
apps/ios-companion/Sources/RitualCompanion/Services/BackgroundSyncManagerV2.swift
apps/dashboard/components/ai-habit-chat.tsx
apps/dashboard/app/(dashboard)/reports/reports-client.tsx
apps/dashboard/app/(dashboard)/calendar/calendar-client.tsx
apps/dashboard/components/analytics/overview-view.tsx
```

## Review Verdict

The repo does not need cosmetic cleanup. It needs boundary cleanup.

The most important structural issue is that orchestration code is repeatedly embedded in endpoints, components, startup files, and platform managers. The same symptoms recur: local branching, duplicated dispatch, startup side effects, long files, mixed read/write paths, and tests that do not directly exercise the seams where bugs are most likely.

The safest path is not a broad rewrite. The safest path is to extract one canonical path at a time, put tests around it, delete the duplicate path, and enforce size/lint gates so the shape does not regress.
