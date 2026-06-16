# Cursor Thermo-Nuclear Refactor Fix Ledger

## Verdict

Cursor implemented a broad multi-phase Thermo-Nuclear refactor, but the branch remains unmergeable. This ledger is the exhaustive repair checklist for that implementation attempt.

Creating this document does not fix code. It records what must be fixed before the branch can be considered for merge.

Context documents:

- `docs/thermo-nuclear-remediation-plan.md` remains the source of truth for the original phase intent, architecture targets, and verification matrix.
- `docs/remediation/cursor-thermo-nuclear-follow-up-plan-2026-06-15.md` remains the shorter recovery summary.

## What Cursor Implemented

- **Guardrails and CI:** added API boundary, desktop capability, dashboard line budget, Rust line budget, and performance budget scripts; wired `repo:check`, lint, dashboard tests, full backend pytest, Rust check, and Rust tests into CI.
- **Dashboard:** added `apps/dashboard/lib/api` clients; split computer activity code; created integrations plugin folders; split analytics, chat, calendar, import, habit-selection, and table components; changed onboarding flow; added desktop capabilities provider.
- **Backend:** extracted `main.py` into app factory, lifespan, and background task modules; split `database/models.py` into a package; split watcher computer activity service code; changed wearables route and service structure.
- **Desktop/Rust:** split `macos`, `desktop_runtime`, `watcher`, and `schema` modules; modified the watcher sidecar binary artifact.
- **Chat/shared contracts:** split chat runtime stream orchestration and added shared DTOs for habits and computer activity.

## Gate Status

| Gate | Status | Evidence / notes |
|---|---|---|
| `npm run repo:check` | Pass, misleading | Dashboard budget passes, but Rust budget is warn-only and boundary scripts miss known leakage. |
| `npm run typecheck` | Pass | Dashboard TypeScript typecheck passes. |
| `npm run test:dashboard` | Pass | Dashboard tests pass: 132/132. |
| `npm run contracts:typecheck` | Pass | Shared contracts typecheck passes. |
| `npm run --workspace @ritual/chat-runtime test` | Pass | Chat runtime tests pass: 14/14. |
| `cd apps/desktop/src-tauri && cargo check` | Pass with warnings | Rust compiles but emits many copied-unused-import and visibility warnings. |
| `PYTHONPATH=apps/backend pytest -q apps/backend/tests` | Fail | Full backend pytest fails during collection. |
| `npm run lint` | Fail | Dashboard lint reports 35 errors and 19 warnings. |
| `node scripts/check-rust-line-budget.mjs` | Fail | Strict Rust budget reports 11 files over 1000 lines. |

## Phase Fix Ledger

| Phase | Status | Cursor work observed | Remaining defects | Acceptance criteria | Verification |
|---|---|---|---|---|---|
| 0 - Guardrails and baselines | Partial | Added boundary and budget scripts; wired checks into `repo:check` and CI. | API allowlists are broad; desktop guard only catches `isTauri(`; Rust line budget is warn-only; baseline claims do not reflect full pytest failure. | Guardrails fail on known leakage classes and final gates are honestly represented. | `npm run repo:check`; strict Rust budget; targeted greps. |
| 1 - Canonical API client | Partial | Added `apps/dashboard/lib/api/client.ts`, `server-client.ts`, and `trigger-client.ts`. | Browser code still hand-rolls `/api` Bearer fetches; direct backend URL patterns remain in server/API/job files; guardrails allow too much. | Browser callers use canonical client; server and Trigger callers use typed internal clients; static checks catch direct URL and hand-rolled browser auth leaks. | `npm run repo:check:api-client-boundary`; targeted `rg`; `npm run lint`; `npm run test:dashboard`. |
| 2 - Shared contracts and type boundaries | Partial | Added habit and computer activity shared contract types. | Integrations and wearables still rely on broad records and `any`; backend test imports broke after symbol moves. | Hot-path DTOs are typed; no integration god-context `Record<string, any>` remains; backend tests import current contracts. | `npm run contracts:typecheck`; `npm run typecheck`; full backend pytest. |
| 3 - Computer activity policy extraction | Mostly complete | Deleted old `computerActivity/client.ts`; added split modules and policy tests. | Large modules remain near budget; runtime checks still bypass central desktop capabilities. | Public API remains thin; fallback policy is covered; UI uses capability context instead of scattered runtime probes. | `npm run test:dashboard`; computer activity targeted backend tests. |
| 4 - Integrations plugin registry | Partial | Added plugin folders and registry tests. | `IntegrationRuntimeContext` still extends `Record<string, unknown>`; detail panels cast to `Record<string, any>`; plugins still depend on shared god-state. | Each plugin receives typed props/state; no `Record<string, any>` in integrations; tests assert registry completeness and no god-context. | `rg "Record<string, any>" 'apps/dashboard/app/(dashboard)/integrations'`; `npm run typecheck`; `npm run test:dashboard`. |
| 5 - Analytics decomposition | Partial | Split overview and metrics views into folders/hooks. | Lint catches hook/memoization issues; some hooks remain large and close to budget. | React hooks obey lint/compiler rules; data flow is stable and covered by existing dashboard tests. | `npm run lint`; `npm run test:dashboard`; `npm run typecheck`. |
| 6 - God component bisection | Partial | Dashboard files now pass 800-line limit. | Reports page was deleted; split components introduced lint errors; behavior preservation was violated. | Reports behavior restored; component splits are behavior-preserving; dashboard files remain under budget. | `npm run lint`; `npm run typecheck`; `npm run test:dashboard`; manual Reports smoke. |
| 7 - Onboarding unification | Partial | Added backend activation service and deleted legacy onboarding file. | Client code can still bypass backend `nextRoute` and route users to `/dashboard`; failure paths are not fail-closed for incomplete activation. | Backend bootstrap `nextRoute` is the only post-auth routing authority; no incomplete activation bypass remains. | activation tests; targeted routing tests; manual web + Tauri signup QA. |
| 8 - Desktop capabilities context | Partial | Added `lib/desktop-capabilities.tsx`. | `isTauri(`/`isDesktopRuntime(` checks remain scattered; guard script misses `isDesktopRuntime(`. | UI/plugin code consumes capability flags; direct runtime checks limited to approved low-level files; guard checks both symbols. | targeted `rg`; `npm run repo:check:desktop-capabilities`; `npm run lint`. |
| 9 - Backend decomposition | No | Split app startup, models package, watcher computer activity, and wearables routes. | Full backend pytest fails during collection; compat exports and test stubs are broken. | Full backend test suite passes; imports are stable; startup/lifespan behavior is preserved. | `python -m compileall -q apps/backend`; `PYTHONPATH=apps/backend pytest -q apps/backend/tests`. |
| 10 - Desktop Rust decomposition | Partial | Split target Rust monoliths and `cargo check` passes. | Strict Rust budget fails; copied unused imports remain; binary sidecar artifact changed in a refactor PR. | Rust source split is clean; strict budget is enforced or exceptions are documented; binary artifact excluded unless release-specific. | `cd apps/desktop/src-tauri && cargo check`; strict `node scripts/check-rust-line-budget.mjs`; optional `cargo test`. |
| 11 - Chat runtime orchestrator split | Complete | `handle-chat-stream.ts` is a small orchestrator and chat runtime tests pass. | No known blocker from review. | Keep current split stable while other PRs land. | `npm run --workspace @ritual/chat-runtime test`. |
| 12 - Final tightening | No | Some budgets and README/CI changes were attempted. | Final gates are not green; manual QA is not evidenced; guardrails are not honest enough. | Full verification matrix passes and manual QA is documented. | Full matrix from `docs/thermo-nuclear-remediation-plan.md`. |

## Merge Blocker Ledger

| Severity | Phase | Recovery PR | Evidence | Required fix | Acceptance criteria | Verification |
|---|---|---|---|---|---|---|
| P0 | 9 | `refactor(backend): app/model/watcher decomposition` | Full backend pytest fails during collection; removed `SCHEMA_STATEMENTS`; moved wearables helper exports; `database.connection` test stubs pollute collection. | Restore compat exports or update tests to new modules; isolate `sys.modules` stubs with teardown/monkeypatch. | Full backend tests collect and pass. | `PYTHONPATH=apps/backend pytest -q apps/backend/tests`. |
| P1 | 6 | `refactor(dashboard-components): split analytics/chat/calendar/import components` | Reports page renders “Reports coming soon” after deleting reports client/helper files. | Restore Reports UI and behavior from before the refactor, or move intentional removal to a separate product PR. | Reports route is functional and no placeholder regression remains. | Manual Reports smoke; `npm run typecheck`; `npm run lint`. |
| P1 | 5/6 | `refactor(dashboard-components): split analytics/chat/calendar/import components` | `npm run lint` fails with 35 errors and 19 warnings. | Fix nested hooks, use-before-declare, ref reads during render, memo dependency issues, and unused eslint disables introduced by splits. | `npm run lint` passes without disabling rules to hide issues. | `npm run lint`. |
| P1 | 1 | `refactor(api-boundary): canonical dashboard API client migration` | 18 direct backend URL hits; many browser `fetch('/api/...')` calls manually set Bearer headers. | Migrate browser calls to canonical API client; migrate server/trigger calls to typed internal clients; narrow allowlists. | No browser hand-rolled backend auth or direct backend URL leakage remains. | targeted `rg`; `npm run repo:check:api-client-boundary`; `npm run lint`. |
| P1 | 7 | `refactor(onboarding): activation nextRoute authority` | Client fallback paths can send incomplete activation to `/dashboard`. | Route post-auth decisions exclusively through backend bootstrap `nextRoute`; fail closed for incomplete activation. | No client-side bypass of activation remains. | activation tests; targeted route tests; manual signup QA. |
| P2 | 8 | `refactor(desktop): Rust module split and budget enforcement` or `refactor(onboarding)` depending on touched area | 56 `isTauri(`/`isDesktopRuntime(` hits outside central boundary. | Replace UI/runtime probes with `useDesktopCapabilities()` flags; update guard script to catch both function names. | Only approved low-level files contain runtime probes. | targeted `rg`; `npm run repo:check:desktop-capabilities`. |
| P2 | 4 | `refactor(integrations): typed plugin registry` | 10 `Record<string, any>` hits in integrations; plugin context still has broad runtime record. | Replace broad runtime context with typed plugin contracts and DTOs. | `Record<string, any>` count is zero in integrations; plugins compile with typed props. | targeted `rg`; `npm run typecheck`; registry tests. |
| P2 | 10/12 | `refactor(desktop): Rust module split and budget enforcement` | `repo:check` sets `RITUAL_RUST_LINE_BUDGET_WARN_ONLY=1`; strict Rust budget fails 11 files. | Enforce strict budget or document deliberate exceptions; remove warn-only from final gate if strict enforcement is expected. | Rust budget result is honest and matches final definition of done. | strict `node scripts/check-rust-line-budget.mjs`; `cargo check`. |

## Leaky Abstraction Ledger

| Leakage class | Current evidence | Required end state | Recovery PR |
|---|---:|---|---|
| Direct backend URL patterns in dashboard | 18 hits | Browser code has zero direct backend URLs; server/API/job usage is centralized through typed internal clients. | API boundary |
| Old `computerActivity/client` imports | 0 hits | Keep at zero. | Computer activity / dashboard components if touched |
| Legacy onboarding references | docs only | Product code stays free of legacy onboarding references. | Onboarding |
| `Record<string, any>` in integrations | 10 hits | Zero hits in integrations. | Integrations |
| `isTauri(`/`isDesktopRuntime(` outside intended boundary | 56 hits | Only approved low-level files contain direct runtime probes; UI uses capability context. | Desktop capabilities / dashboard components |

Targeted verification commands:

```bash
rg "NEXT_PUBLIC_PYTHON_API_URL|127\\.0\\.0\\.1:8000" apps/dashboard --glob "!**/*.test.*"
rg "from ['\"]\\.\\./client['\"]|computerActivity/client" apps/dashboard
rg "legacy-activation-onboarding" .
rg "Record<string, any>" 'apps/dashboard/app/(dashboard)/integrations'
rg "isTauri\\(|isDesktopRuntime\\(" apps/dashboard --glob "!lib/desktop-capabilities.tsx"
```

## Recommended PR Split

### 1. `refactor(api-boundary): canonical dashboard API client migration`

Scope:

- `apps/dashboard/lib/api`
- Browser hooks and components using `/api`
- API boundary scripts and tests

Required fixes:

- Replace browser raw `/api` Bearer fetches with `apiFetchWithAuth` or an equivalent typed dashboard client.
- Keep server-side and Trigger.dev direct backend calls behind typed internal clients.
- Tighten guardrails so broad folders are not blanket exemptions.

Acceptance criteria:

- Direct backend URL scan only reports approved server/internal clients.
- Browser code has no hand-rolled Bearer fetches to dashboard BFF routes where the canonical client applies.
- `npm run repo:check:api-client-boundary`, `npm run lint`, `npm run typecheck`, and `npm run test:dashboard` pass.

### 2. `refactor(onboarding): activation nextRoute authority`

Scope:

- Backend activation service and bootstrap route
- Onboarding page
- Home client
- Auth callback pages
- Activation tests

Required fixes:

- Make backend bootstrap `nextRoute` the single post-auth routing authority.
- Remove fallback branches that send incomplete activation to `/dashboard`.
- Keep local onboarding step persistence only as UX cache, never routing authority.

Acceptance criteria:

- Unknown or failed bootstrap routes fail closed without skipping required activation.
- Full signup and SSO flows honor backend `nextRoute`.
- Activation tests and manual web/Tauri activation smoke pass.

### 3. `refactor(integrations): typed plugin registry`

Scope:

- `apps/dashboard/app/(dashboard)/integrations/**`
- Integration plugin contracts and registry tests

Required fixes:

- Replace `IntegrationRuntimeContext & Record<string, unknown>` with typed plugin-specific props.
- Remove `Record<string, any>` casts from detail panels and shared helpers.
- Keep registry completeness tests, but add tests/assertions that catch god-context regression.

Acceptance criteria:

- `rg "Record<string, any>" 'apps/dashboard/app/(dashboard)/integrations'` returns zero product-code hits.
- Plugin panels compile without broad runtime casts.
- `npm run typecheck` and `npm run test:dashboard` pass.

### 4. `refactor(backend): app/model/watcher decomposition`

Scope:

- Backend app factory/lifespan/background split
- Backend models package
- Watcher computer activity split
- Wearables compat exports and tests

Required fixes:

- Restore or intentionally replace moved helper exports used by tests.
- Isolate test stubs that mutate `sys.modules`.
- Preserve startup/lifespan/background scheduler behavior from pre-refactor `main.py`.

Acceptance criteria:

- Backend tests collect cleanly.
- Full backend suite passes.
- No test relies on polluted module globals from previous test files.

Verification:

```bash
python -m compileall -q apps/backend
PYTHONPATH=apps/backend pytest -q apps/backend/tests
```

### 5. `refactor(dashboard-components): split analytics/chat/calendar/import components`

Scope:

- Dashboard component splits from analytics, chat, calendar, data import, habit selection, habit logs table, and Reports restoration.

Required fixes:

- Restore Reports behavior and remove the “coming soon” regression.
- Fix lint errors introduced by splits.
- Keep all UI decomposition behavior-preserving; no feature deletion in this PR.

Acceptance criteria:

- Dashboard line budget remains under 800.
- Reports route is functional.
- Lint, typecheck, and dashboard tests pass.

Verification:

```bash
npm run lint
npm run typecheck
npm run test:dashboard
RITUAL_DASHBOARD_FILE_LINE_BUDGET=800 node scripts/check-dashboard-line-budget.mjs
```

### 6. `refactor(desktop): Rust module split and budget enforcement`

Scope:

- Rust source only.
- Exclude binary watcher artifact unless this is explicitly a release PR.

Required fixes:

- Clean copied unused imports and warnings from split Rust modules.
- Enforce strict Rust line budget or document deliberate exceptions.
- Keep behavior unchanged in `macos`, `desktop_runtime`, `watcher`, and `schema` splits.

Acceptance criteria:

- `cargo check` passes with materially reduced warnings.
- Strict Rust line budget is green or documented exceptions are reviewed.
- No binary sidecar artifact is included without release justification.

Verification:

```bash
cd apps/desktop/src-tauri && cargo check
node scripts/check-rust-line-budget.mjs
```

## Definition of Done

The recovered branch is merge-ready only when all of these are true:

- Full backend pytest passes in local runs and CI.
- `npm run lint` passes without disabling rules to hide refactor issues.
- Reports behavior is restored or removed only by a separate intentional product PR.
- Browser API access goes through the canonical dashboard client.
- Backend `nextRoute` is the single post-auth activation routing authority.
- Integrations have typed plugin contracts and no `Record<string, any>` god-context.
- Dashboard UI does not directly probe desktop runtime outside approved low-level files.
- Rust budget enforcement is honest: strict check passes or exceptions are explicitly documented and accepted.
- The full verification matrix from `docs/thermo-nuclear-remediation-plan.md` is rerun.
- Manual QA is documented for web and Tauri flows: signup/SSO, onboarding, dashboard, analytics, computer activity, integrations, calendar, habit logs, and desktop permissions.

## Final Verification Matrix

Run before declaring the Cursor refactor recovered:

```bash
npm run repo:check
npm run repo:check:api-client-boundary
npm run contracts:typecheck
npm run typecheck
npm run typecheck:chat-api
npm run lint
npm run test:dashboard
npm run --workspace @ritual/chat-runtime test
npm run build
python -m compileall -q apps/backend
PYTHONPATH=apps/backend pytest -q apps/backend/tests
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
```

## Assumptions and Defaults

- This ledger is additive and does not replace the original remediation plan or shorter follow-up plan.
- Reports removal is a regression.
- The six-PR split is the default recovery sequence.
- Code fixes should be landed in focused PRs, not as one more broad “fix everything” branch.
