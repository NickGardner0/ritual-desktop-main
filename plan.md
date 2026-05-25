# Ritual Architecture Cleanup Plan

## Summary

This plan turns the audit findings into a phased cleanup program focused on less code, clearer ownership, faster startup/load paths, and stronger refactor protection.

The first implementation slice removes the legacy native recorder sidecar path and keeps watcher-owned context capture as the supported desktop path. Later slices should adopt the best patterns observed in Midday and Macro: shared assistant orchestration, typed tool contracts, provider facades, versioned migrations, generated API clients, explicit job registries, and CI gates that prevent the same sprawl from returning.

## Phase 1: Dead Code And Recorder Removal

- Remove the old `ritual-recorder` workspace member, Cargo feature, Tauri command surface, dashboard hook/components, autostart behavior, and config reconciliation.
- Keep the `ritual-watcher` path as the only desktop context-capture runtime.
- Remove stale script references to the deleted recorder target.
- Update product/legal copy that referenced recorder implementation files.
- Do not delete dashboard components that were flagged by static analysis but are still imported by live routes.
- Audit backend one-off scripts before moving or deleting them, because some may still be operational repair tools.

Validation:

- `rg "native-recorder|ritual-recorder|screen-recorder|use-recorder|reconcile_recorder_config_user_cmd" apps package.json scripts`
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --all-targets`
- `npm run typecheck`
- `npm run test:dashboard`

## Phase 2: Chat Runtime Consolidation

- Introduce one `ChatTurnEngine` in `packages/chat-runtime`.
- Move tool definitions into one typed `ToolRegistry`.
- Keep dashboard chat, SMS, and future agent entrypoints as thin adapters over the same engine.
- Preserve the current stream event wire format during the first migration.
- Delete duplicated dispatch/classification code after parity tests pass.

Tests:

- Golden stream tests for dashboard chat.
- SMS response parity tests.
- Tool registry contract tests.
- Tool error, timeout, and duplicate dispatch regression tests.

## Phase 3: Wearables Provider Architecture

- Add provider boundaries: `ProviderClient`, `ProviderTransformer`, `SyncCheckpointStore`, and `WearableIngestPipeline`.
- Move Apple Health, Whoop, Oura, and future provider-specific transforms behind those interfaces.
- Keep routers thin: auth, request validation, orchestration, and response shaping only.
- Make sync idempotency and checkpoint writes explicit.

Tests:

- Per-provider transformer snapshot tests.
- Checkpoint/idempotency tests.
- Partial failure and retry tests.
- Backfill tests.
- Router tests that prove provider logic is not embedded in route handlers.

## Phase 4: Database Migrations

- Move backend runtime schema mutation into Alembic migrations.
- Keep desktop SQLite migrations versioned and idempotent.
- App startup may verify migration state, but must not create or alter schema implicitly.
- Add a migration command for local/dev/prod operations.

Tests:

- Fresh database migration test.
- Existing database upgrade test.
- Failed migration behavior test.
- Startup test proving schema mutation does not happen implicitly.

## Phase 5: Typed API Boundary

- Generate a TypeScript client from the FastAPI OpenAPI schema.
- Collapse dashboard proxy duplication into a small typed server client/proxy helper.
- Move dashboard callers to the generated client incrementally.
- Delete redundant proxy routes only after callers have migrated.

Tests:

- Generated client drift check in CI.
- Server route contract tests.
- Dashboard caller tests using typed client mocks.
- Regression tests for each deleted proxy route.

## Phase 6: Sync And Process Orchestration

- Create explicit registries for sync jobs, schedules, and processors.
- Give every job one owner, one schedule, one idempotency key, and one testable processor.
- Remove duplicate sync entrypoints after registry adoption.
- Keep watcher startup/shutdown and health checks in small desktop modules.

Tests:

- Scheduler registry tests.
- Duplicate schedule prevention.
- Idempotent processor tests.
- Retry/dead-letter tests.
- Overlapping sync concurrency tests.
- Watcher startup/shutdown and missing-binary tests.

## Phase 7: React Container Reduction And Performance

- Split large stateful React containers by data loading, derived state, command handlers, and presentational views.
- Prefer server-first data boundaries where practical.
- Dynamically import heavy modals/tools when they are not needed for initial route load.
- Track bundle size and startup timing before and after each major cleanup.

Tests:

- Component tests for refactored workflows.
- Route smoke tests.
- Bundle analysis proving deleted recorder/legacy chunks are gone.
- Initial dashboard route load comparison.

## Phase 8: CI Gates

- Fix current lint failures before adding stricter gates.
- Require typecheck, lint, dashboard tests, backend tests, Rust checks/tests, generated-client drift checks, migration checks, import-cycle checks, and dead-code checks.
- Add an allowlisted dead-code scanner configured with real Next/Tauri/FastAPI/package entrypoints.

Tests:

- CI must fail on generated client drift.
- CI must fail on migration drift.
- CI must fail on new unreachable source outside the allowlist.
- CI must fail on import cycles in dashboard/package code.

## Assumptions

- The legacy native recorder is no longer product-critical.
- Watcher-owned context capture is the supported desktop path.
- Backend scripts are operational artifacts until audited.
- FastAPI OpenAPI generation is the simplest typed-client path; do not introduce tRPC.
- Phase 1 can remove unsupported recorder UI/commands; later phases should preserve user-visible behavior until parity tests pass.
