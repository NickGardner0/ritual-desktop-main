# Cursor Thermo-Nuclear Refactor Follow-Up Plan

## Verdict

**Cursor implemented a broad multi-phase refactor, but the branch is not mergeable as-is.**

This document is a recovery guide for the attempted implementation of the Thermo-Nuclear Codebase Remediation Plan. It does not replace `docs/thermo-nuclear-remediation-plan.md`; that original plan remains the source of truth for architecture targets, phase intent, and verification gates.

## What Cursor Implemented

Cursor attempted to implement the full plan in one broad pass instead of landing the phase sequence independently.

- **Guardrails and CI wiring:** added API boundary, desktop capability, dashboard line budget, Rust line budget, and performance budget checks; wired full backend pytest, lint, dashboard tests, Rust checks, and Rust tests into CI.
- **Dashboard refactors:** added `apps/dashboard/lib/api` clients, split computer activity code, created integration plugin folders, split analytics and several dashboard components, changed onboarding/activation routing, and added a desktop capabilities provider.
- **Backend refactors:** extracted `main.py` into app factory, lifespan, and background task modules; split `database/models.py` into a package; split watcher computer activity service code; changed wearables routes and provider service structure.
- **Desktop/Rust refactors:** split `macos`, `desktop_runtime`, `watcher`, and `schema` modules, while also modifying the watcher binary artifact.
- **Chat/shared contracts:** split chat runtime stream handling and added shared contract DTOs for habits and computer activity.

## Phase Completion Status

| Phase | Status | Follow-up needed |
|---|---|---|
| 0 - Guardrails and baselines | Needs fixes | Guardrails exist, but `repo:check` is misleading because Rust is warn-only and boundary scans miss important leakage. |
| 1 - Canonical API client | Needs completion | API clients exist, but raw `/api` fetches with hand-rolled Bearer headers and direct backend URL allowlists remain. |
| 2 - Shared contracts and type boundaries | Needs fixes | Some DTOs were added, but integrations and wearables still use broad records and `any` casts. |
| 3 - Computer activity policy extraction | Mostly complete | The old client import path is gone and policy tests exist; remaining work is tightening module size and capability usage. |
| 4 - Integrations plugin registry | Needs completion | Plugin folders exist, but the broad runtime context preserves the god-context pattern. |
| 5 - Analytics decomposition | Needs fixes | Splits exist, but lint catches hook and memoization issues; large hooks remain near the budget. |
| 6 - God component bisection | Needs fixes | Dashboard files pass the 800-line budget, but the split introduced lint errors and deleted Reports behavior. |
| 7 - Onboarding unification | Needs completion | Legacy onboarding was deleted, but client routes can still bypass backend `nextRoute`. |
| 8 - Desktop capabilities context | Needs completion | Capability provider exists, but `isTauri()` / `isDesktopRuntime()` checks are still scattered. |
| 9 - Backend decomposition | Needs fixes | Structural split exists, but full backend pytest fails during collection. |
| 10 - Desktop Rust decomposition | Needs fixes | Target modules were split and `cargo check` passes, but strict Rust line budget fails and copied unused imports remain. |
| 11 - Chat runtime orchestrator split | Complete | `handle-chat-stream.ts` is a small orchestrator and chat-runtime tests pass. |
| 12 - Final tightening | Not complete | Final verification is not green; lint, full backend pytest, and strict Rust budget fail. |

## Biggest Merge Blockers

- **Full backend pytest fails during collection.** Broken imports include removed `SCHEMA_STATEMENTS`, moved wearables helper exports, and test pollution from direct `sys.modules["database.connection"]` stubs.
- **Reports was functionally deleted.** The Reports page now renders a “Reports coming soon” placeholder after deleting the previous client and helpers, violating behavior-preserving scope.
- **`npm run lint` fails despite being in CI.** Errors include a nested hook in calendar AI summary, use-before-declare in AI habit voice code, and ref reads during render in split UI components.
- **API boundary migration is incomplete.** Browser code still contains raw `fetch('/api/...')` calls with hand-rolled Bearer headers; server/API/job files still contain direct backend URL patterns.
- **Onboarding routing is not single-authority.** Backend bootstrap `nextRoute` exists, but client fallbacks can still route signed-in users directly to `/dashboard`.
- **Desktop capability checks remain scattered.** The guard script checks `isTauri(` only and misses `isDesktopRuntime(` usage in UI and plugin code.
- **Integrations plugin registry still has a broad runtime context.** `IntegrationRuntimeContext` extends `Record<string, unknown>`, and detail panels still cast data to `Record<string, any>`.
- **Rust budget is not honestly green.** `repo:check` forces `RITUAL_RUST_LINE_BUDGET_WARN_ONLY=1`; strict Rust line budget still fails.

## Leaky Abstractions and Incomplete Migrations

Latest review evidence:

- Direct backend URL grep: **18 hits** across dashboard server/API/job files.
- `computerActivity/client` imports: **0 hits**.
- Legacy onboarding references: **docs only**.
- `Record<string, any>` in integrations: **10 hits**.
- `isTauri(`/`isDesktopRuntime(` runtime checks: **56 hits** outside the intended central boundary.

The main architectural leaks are:

- API access is not yet one canonical path.
- Onboarding has durable backend state, but not durable backend routing authority.
- Desktop capability detection is centralized for some code but still directly queried elsewhere.
- Integrations have plugin folders, but the runtime state and data contracts are still centralized and weakly typed.
- Guardrails pass by allowlist or warn-only behavior instead of enforcing the plan intent.

## Gate Status

Passing gates from the review:

- `npm run repo:check`
- `npm run typecheck`
- `npm run test:dashboard`
- `npm run contracts:typecheck`
- `npm run --workspace @ritual/chat-runtime test`
- `cd apps/desktop/src-tauri && cargo check`

Failing gates from the review:

- `PYTHONPATH=apps/backend pytest -q apps/backend/tests`
- `npm run lint`
- strict `node scripts/check-rust-line-budget.mjs`

`repo:check` should not be treated as a complete signal until the Rust budget is no longer warn-only and the API/capability guard scripts catch the known leakage classes.

## Recommended PR Split

### 1. `refactor(api-boundary): canonical dashboard API client migration`

Scope: `apps/dashboard/lib/api`, browser hooks/components using `/api`, and API boundary scripts.

Goal: all browser callers use `apiFetchWithAuth` or an equivalent typed dashboard client; server and Trigger callers use typed internal clients; guardrails fail on direct backend URL or hand-rolled browser auth leaks.

### 2. `refactor(onboarding): activation nextRoute authority`

Scope: backend activation service, onboarding page, home client, auth callback pages, and activation tests.

Goal: backend bootstrap `nextRoute` is the only post-auth routing authority; no dashboard fallback bypasses incomplete activation.

### 3. `refactor(integrations): typed plugin registry`

Scope: `apps/dashboard/app/(dashboard)/integrations/**`.

Goal: replace the broad runtime context with typed plugin contracts; remove `Record<string, any>` and residual god-context behavior.

### 4. `refactor(backend): app/model/watcher decomposition`

Scope: backend splits only.

Goal: preserve imports and compatibility exports, isolate test stubs, keep route/service behavior stable, and make `PYTHONPATH=apps/backend pytest -q apps/backend/tests` pass.

### 5. `refactor(dashboard-components): split analytics/chat/calendar/import components`

Scope: dashboard UI component splits.

Goal: restore Reports behavior, fix lint/typecheck/test issues, and keep decomposition behavior-preserving. No feature deletion belongs in this PR.

### 6. `refactor(desktop): Rust module split and budget enforcement`

Scope: Rust source only.

Goal: clean copied unused imports, enforce or explicitly document remaining over-1000-line exceptions, and exclude binary watcher artifacts unless the PR is specifically a release PR.

## Test Plan

Each PR must run its focused phase gate plus:

- `npm run repo:check`
- `npm run typecheck`
- `npm run lint`
- `npm run test:dashboard`

The backend PR must additionally run:

- `python -m compileall -q apps/backend`
- `PYTHONPATH=apps/backend pytest -q apps/backend/tests`

The desktop PR must additionally run:

- `cd apps/desktop/src-tauri && cargo check`
- strict `node scripts/check-rust-line-budget.mjs`, unless documented exceptions are deliberately accepted

The final recovery branch must rerun the full verification matrix from `docs/thermo-nuclear-remediation-plan.md`.

## Assumptions and Defaults

- This document is additive and lives under `docs/remediation/`.
- The original Thermo-Nuclear plan remains the source of truth.
- Reports removal is treated as a regression, not an intentional product decision.
- The branch should be recovered through the six PRs above, not repaired and merged as one large PR.
