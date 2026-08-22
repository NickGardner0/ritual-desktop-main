# Ritual simplification overview

**Date:** 2026-08-22  
**Goal:** Make Ritual materially simpler, smaller, faster, and easier to maintain by deleting unused architecture, consolidating to one BFF / chat / scheduler / IPC / cache path, and reducing production LOC without losing product functionality.

This is a status report of that goal against the live repo, not a new plan. The governing docs are [`RITUAL_SIMPLIFICATION_PLAN.md`](./RITUAL_SIMPLIFICATION_PLAN.md), [`RITUAL_SIMPLIFICATION_RESULTS.md`](./RITUAL_SIMPLIFICATION_RESULTS.md), and [`RITUAL_SIMPLIFICATION_ARCHITECTURE_REPORT.md`](./RITUAL_SIMPLIFICATION_ARCHITECTURE_REPORT.md).

**Read this against the ship branch**, `codex/release-0.1.1-prep`, worktree `/Users/nickgardner/Desktop/ritual-release-0.1.1-prep`. The Cursor workspace `ritual-desktop-main` is often on `codex/tasks-routines-mvp` with a large dirty tree of unrelated product WIP. That dirty tree is **not** what Vercel and Railway deploy.

---

## How much of the goal landed

**Repository ownership is consolidated and production web/backend gates are green. External desktop, Trigger, mail-delivery, and live-capture gates remain incomplete. The numeric “smaller” target is also not met.**

| Plan outcome | Status |
|---|---|
| One owner per turn, job, cache, projection, native command | **True in repository code and verified for the production scheduler.** `AssistantKernel.runTurn` + FastAPI `assistant_turns`; one provider adapter; one 13-job scheduler registry/occurrence fence; React Query per-user; Tinybird documented; NativeGateway generated triad. The owner confirmed the former Trigger workspace/project was deleted. |
| One obvious path from each client to domain truth | **True at the dashboard/FastAPI route boundary.** Generated-client JSON uses the method-aware catch-all. Multipart import/screenshot and Apple export use three fixed adapters. Habit-log edits use a generated revision-checked PATCH. Chat kernel still uses its internal `fetchPythonApi` transport. |
| Local desktop reads for local desktop data | **True for recent desktop activity.** `activity.db` with `local \| synced \| unavailable`. Web/iOS and long-range aggregates stay `synced` / Tinybird. |
| No user-facing control without persisted behavior | **Mostly true.** Fake AI retention/history controls were hidden. Privacy export/sync/erasure were restored on the release tree. |
| Launch path measured | **Partially true.** Five stored WKWebView cold/warm fixtures gate parser budgets, but cannot certify a live release. Schema v2 now records missing watcher RSS honestly as null/not-applicable and marks release evidence incomplete. |
| Reproducible builds / immutable releases | **Repository gates complete for the supported Apple Silicon target.** Runtime verifies target, Mach-O architecture, and SHA. The release workflow publishes one signed/notarized arm64 package and updater entry. Intel is explicitly unsupported by current product policy. |
| ~7.5k–12.5k fewer production lines (180k–185k band) | **Not met.** The canonical implementation command reports **190,952** after the additive durable-chat, watcher-lifecycle, explicit-route, model-engine, scheduler, channel-auth, desktop release-correctness, and scheduler-integrity boundaries (starting ship baseline: 187,086). See `LOC_BASELINE.md`; the historical 192,474, ~192.6k, and dirty-tree 183.97k figures are no longer current measurements. |

### Definition of done vs evidence

| Criterion | Evidence now |
|---|---|
| Production build green | **Yes on implementation SHA `bdc34ecf`.** GitHub Actions run `32568940329` passed `quality` and `desktop-rust`; Vercel production and Railway production both deployed the reviewed release-branch implementation. |
| Every Tauri command typed + capability | **Yes.** 71 registered, 71 ACL-allowed, and 71 frontend-invoked commands. There are 72 typed Rust signatures; the extra uncompiled `check_recording_source_readiness` signature is explicitly classified outside the gateway. |
| Persisted browser data cannot cross identity | **Yes.** React Query key `ritual:react-query-cache:v1:<userId>`. |
| One durable assistant turn / receipt history | **Yes.** FastAPI atomically accepts the stable turn and user message before provider/tool work, then atomically commits assistant content, receipts, and completion. Remote failures remain `unsent` or `failed_retryable`; they are never replaced with memory success. |
| Only read-only tools concurrent | **Yes.** Mutating tools serial; unknown tools fail closed as mutating. |
| One scheduler owner | **Complete in repository code and Railway.** Deployment `2043bae3-91b0-428b-8f47-151831e29b4f` starts all 13 owners with maintenance disabled. Schema-v2 authenticated health was `healthy` after restart and after distinct 10:00/11:00 UTC hourly occurrences, with no stale jobs, errors, active or overlapping leases, or duplicate occurrence identities. The owner confirmed the former Trigger workspace/project was deleted. |
| No chat-api / profiling callers | **Yes.** `apps/chat-api` and the profiling bridge are deleted. |
| Desktop activity explicit local source | **Yes** for recent desktop. |
| Remaining projections documented | **Yes.** Tinybird inventory; Typesense deleted; MiniSearch stays for the in-modal habit picker. |
| Launch / RSS budgets | **Stored webview fixtures exist; live provenance and watcher RSS do not.** |
| Authored LOC in 180k–185k | **No.** Canonical implementation total is **190,952**. |
| Legacy orchestration deleted after parity | **Yes.** `AssistantKernel.runTurn` owns durable lifecycle for web, SMS, proactive SMS, scheduled workflow synthesis, and desktop-outbox replay. `model-engine/*` is provider-only; `chat-stream/*` is routing/pure helpers. |

Rough score: **the architecture goal is implemented; the “materially smaller” goal is not proven; a short list of product/ops bugs remains.**

---

## What changed about the repo and the app

### Deleted

- Kanban / TodaysFocusWidget, `/widget` timer route, unused shadcn sidebar copy
- `apps/chat-api` (second chat deployable)
- Profiling HTTP bridge (`:3031`)
- Typesense (client, PyPI, index fan-out, erasure target)
- Trigger.dev SDK/jobs/config
- Vercel Speed Insights
- Unused Midday agent stack, unused Next import parsers, unused computer-activity timeline/drill-down, unused routines split-pane, unused wearable pipeline/job registry, leftover UI shims
- Ten unused Tauri command exposures
- Fake AI retention / clear-history controls (hidden)

### Consolidated

- **Chat:** one host, dashboard `/api/chat/stream` → `handleChatStreamRequest` → `AssistantKernel.runTurn` → FastAPI `assistant_turns`. SMS, proactive SMS, scheduled workflow synthesis, and desktop outbox replay enter the same lifecycle. `model-engine/openai-adapter.ts` alone owns provider request/stream decoding; mutating tools remain serial.
- **Scheduler:** FastAPI `background_tasks.py` / `secondary_job_runner.py` only. Job table: `SCHEDULER_JOBS.md`.
- **Search:** command palette / habit search read Turso SQL. MiniSearch is client-only for the in-modal picker.
- **Analytics:** dashboard Tinybird reads go through FastAPI. Tinybird stays the analytics projection.
- **Desktop IPC:** feature code imports NativeGateway. Implementation stays in `apps/dashboard/lib/desktop-bridge/*`.
- **Cache:** React Query restore waits for Clerk user id; per-user key. Habit snapshots folded into that persist path.
- **BFF:** signed-in FastAPI JSON uses the generated client (`apiOperationWithAuth` / `apiOperation` / `createServerBackendClient`). The catch-all validates both OpenAPI method and path and accepts JSON only. The Next API allowlist is **19 routes**: the prior 16 unique boundaries plus fixed import-preview, screenshot-preview, and Apple-export adapters. Each manifest entry records method, owner, content class, callers, and reason.
- **Activity:** recent desktop reads `activity.db` only. Cloud backfill requires `plaintext_sync` consent.

### Kept on purpose

MiniSearch, Tinybird, FastAPI `ui_preferences` (cross-device overview/color), OpenPanel + Sentry, MUI + Lucide, hosted dashboard in WKWebView (not bundled into Tauri), habits/wearables/SMS on the server, no Goose/ACP.

### What the running product feels like

Same product surfaces: dashboard, chat, habits, calendar, tasks, routines, reports, integrations, privacy, desktop watcher. Fewer deployables and fewer duplicate HTTP clients. Desktop launch telemetry now actually records on Tauri 2 (`__TAURI_INTERNALS__.invoke`). Clerk production builds are deploying.

It does **not** feel like a 4–7% smaller codebase, because restored live product replaced the deleted dead code.

---

## Still issues (architecture / ops, not necessarily user-facing bugs)

These are remaining dual paths, unpaid taxes, or incomplete gates. They are documented as leftover on purpose unless noted.

1. **Canonical LOC is 190,952**, not 180k–185k. The checked-in audit command and bucket data supersede the historical estimates. Further reductions must come only from unreachable code or ownership consolidation, not live product cuts.
2. **Scheduler ownership is resolved.** FastAPI registers all 13 jobs, fences normalized occurrences in `scheduler_occurrence_claims`, and reports health. The owner confirmed the former Trigger workspace/project `proj_hctghowrtnzbnyrgoecx` was deleted.
3. **Resolved: explicit BFF ownership.** The generic proxy rejects unknown methods, unknown paths, non-JSON content, and the three explicitly owned paths. Import preview, screenshot preview, and Apple export use fixed adapters. Habit-log inline edit uses an idempotent FastAPI PATCH with optimistic revision conflict handling.
4. **Next-owned AI/OAuth/email routes** listed above. Collapsing them would move streaming, webhooks, or secrets, not delete unused code.
5. **Watcher live RSS evidence pending.** Native code now separates watcher readiness from `native_ready`, waits for reachability/heartbeat, and rejects enabled zero RSS. The legacy samples are fixtures with null/not-applicable RSS; signed enabled/disabled captures still have to be produced.
6. **Resolved: one chat lifecycle and provider boundary.** `AssistantKernel.runTurn` owns acceptance through terminal state. `model-engine/*` contains provider construction/decoding only and a static import contract prevents it from reaching persistence, queues, tools, or completion. `chat-stream/*` now contains only classification and pure response helpers.
7. **Resolved: fail-closed durable chat persistence.** Web and SMS do not start model/tool work before the FastAPI acceptance transaction. A failed provider or terminal commit rejects the stream, retains provisional UI separately, and reuses the stable turn ID on retry or desktop-outbox replay.
8. **Apple Silicon is the explicit supported desktop architecture.** The workflow, sidecar lock, updater manifest, and publisher all fail closed to `aarch64-apple-darwin`; Intel receives no package or updater entry.
9. **Resolved: deterministic backend contracts.** Local, CI, and Railway now select Python 3.12.12; FastAPI 0.119.0 and Pydantic 2.12.2 are enforced by a complete hash-pinned lock. OpenAPI, client generation, and all 505 backend tests use the isolated lock-keyed environment, so an ambient venv cannot change output.
10. **Resolved in repository code: channel-bound desktop social login.** Production, QA, and development have distinct products, bundle IDs, schemes, data roots, and build-selected capability files. Native persists a short-lived verifier with mode `0600`; the browser carries only its SHA-256 challenge and native-generated handoff ID; the Clerk ticket is minted only after the initiating binary proves the verifier to FastAPI. The correct channel consumes once and the browser polls to durable acknowledgement. Protocol v1 remains temporarily readable only for the production native-first rollout and must be removed after v0.1.99 adoption.
11. **Installed `/Applications/Ritual.app` was last seen as 2026-07-17.** v0.1.99 is configured but not published. Runtime diagnostics now exposes channel/version/SHA, executable path, bundle/scheme, backend, watcher/RSS, data root, scheme owner, and window hit-test state so a stale binary is distinguishable. Publication/adoption remains an external release gate.
12. **Production report email is intentionally deferred.** The `ritual-desktop` Vercel project has `INTERNAL_BACKEND_TOKEN` but no `RESEND_API_KEY`. The authenticated route correctly returns 503 instead of pretending delivery succeeded; the owner chose not to configure mail credentials yet.

---

## Still bugs / things that need fixing

These bit us during the live desktop captures or CI, or are still wrong in production-shaped runs.

| Issue | What happens | Fix / next |
|---|---|---|
| **Wrong backend base in debug “production” desktop** | After sign-in, Turso refresh hits `http://127.0.0.1:8000` and connection-refuses. Location/biome outbox logs “Auth token is unavailable” until handoff, then the local URL. | **Fixed and pushed** (`65ced577`). Hosted `desktop.ritualdb.com` now hands native the Railway FastAPI URL; production Rust also rewrites leftover loopback bases. |
| **Watcher preference/lifecycle ambiguity** | Missing config and explicit disablement previously collapsed to one state. | Fixed in repository code with preference v2, channel-isolated roots, and distinct never-enabled/user-disabled states; installed-release migration evidence remains pending. |
| **`native_ready` races the watcher** | The shell milestone previously sampled the sidecar before readiness. | Fixed in repository code with a separate bounded readiness event and post-heartbeat RSS sample. No live budget is claimed until raw signed trials pass. |
| **QA reload ownership** | QA/dev lacked a focused WKWebView reload. | Fixed in repository code: debug/`qa-tools` builds expose Cmd+R and View → Reload Ritual only for the focused main window; production compiles neither menu nor handler. |
| **OAuth browser terminal state** | The browser previously inferred success after attempting a scheme open. | Fixed in repository code with pending/consumed/acknowledged/expired/failed states and a no-app presentation while durable state remains pending. Live installed-app evidence is pending. |
| **Transparent / liquid-glass window** | Main-window transparency could make screenshots and clicks look like they hit the desktop underneath. | Fixed in repository defaults: main content is opaque, translucency is opt-in/decorative, AppKit explicitly disables ignored mouse events and uses normal level, and QA diagnostics/probes capture the result. |
| **Ambiguous shell identity** | Production, QA, development, watcher, and helper processes were not described by one contract. | Fixed for packaged builds and diagnostics with a channel product/bundle/scheme/data-root/capability matrix. `npm run desktop:diagnostics` builds and executes the channel-named binary (`Ritual Dev` by default); a direct raw Cargo invocation remains truthfully identifiable as `app`. |
| **Alembic two heads / OpenAPI 0.128 drift / Svix `verify()` returning `None` / Rust test filter** | These broke GitHub `quality` or `desktop-rust`. | **Fixed and pushed** (`bcbfb88a`, `0d7d365f`, `c9a3aa21`, `5cb82a5a`). |
| **Tauri 2 IPC not detected** | Hosted dashboard after `location.replace` saw desktop UA but `invoke` threw, so launch events never logged. | **Fixed and pushed** (`cd7976c9`). Vercel is serving that JS. |
| **Bootstrap timing headers dropped** | Catch-all stopped forwarding `server-timing` / `x-ritual-bootstrap-*`. | **Fixed and pushed** (`5cb82a5a`). |
| **Onboarding banner `#fafaf9` vs canvas `#fcfcfa`** | Contract test failed. | **Fixed and pushed** (banner aligned to `#fcfcfa`). |

Not treated as bugs (intentionally not done): bundling the dashboard into Tauri, moving habits/wearables/SMS onto the device, deleting MiniSearch/Tinybird/OpenPanel/Sentry/MUI, Goose/ACP.

---

## What was committed and pushed to production vs what was not

### Production evidence cut (implementation SHA `bdc34ecf`)

Vercel (dashboard) and Railway (FastAPI) deploy from **`codex/release-0.1.1-prep`**, not from `main`, and not from `codex/tasks-routines-mvp`.

- GitHub PR: [https://github.com/NickGardner0/ritual-desktop-main/pull/9](https://github.com/NickGardner0/ritual-desktop-main/pull/9) — **open, mergeable, and not merged to `main`.**
- GitHub CI run `32568940329`: **`quality` success, `desktop-rust` success.**
- Vercel production at the evidence cut: deployment `dpl_5RPpF6ZcuFthBcnhxr7tmcNr4D24`, Ready behind `desktop.ritualdb.com`, built from `bdc34ecf`.
- Railway production: deployment `2043bae3-91b0-428b-8f47-151831e29b4f`, image `sha256:3085f255cd64c97eb78649c7305b597e3773abd1b8c18bd8f1f4f3f5e4074b0d`, built from `bdc34ecf` with Python 3.12.12 and a successful migration predeploy.
- Railway scheduler health: schema v2 reported 13/13 registered and current; the post-deploy duplicate sweep preserved the 10:00 UTC completion timestamps, all six hourly owners completed new 11:00 UTC occurrences, and duplicate-identity, error, stale, active-lease, and overlapping-lease lists were empty after completion.
- Historical commit `2984b9f8` labeled launch samples as live. The current audit truthfully reclassifies those samples as fixtures because raw provenance and watcher RSS were absent.

If “production” means “what users hit on desktop.ritualdb.com / Railway,” **the implementation is in production at `bdc34ecf`**. If it means “merged to `main`,” **nothing from this program is on `main` yet.** Report-only commits after this evidence cut do not change backend behavior.

### Pushed on `codex/release-0.1.1-prep` (in production deploys)

All simplification commits on that branch, including:

- Collapse onto one chat, scheduler, native path; restore native commands; delete Typesense and Trigger.dev code
- Generated FastAPI client for dashboard JSON (client + Next server)
- AssistantKernel + mounted `/api/assistant-turns`
- Identity-safe React Query cache; NativeGateway ACL triad
- Privacy export/sync/erasure restore
- CI unblockers: OpenAPI 0.119 regen, Alembic head linearization, Clerk webhook parse, Rust test filter, bootstrap timing headers, contract tests
- Tauri 2 IPC detection
- Debug-only SIGUSR1 WKWebView reload
- Legacy debug launch fixtures in `tools/performance/launch-budgets.json`; release evidence is explicitly incomplete

Composer / Tasks icon polish that was merged from origin into this branch is also on that SHA (product, not simplification).

The **release worktree is clean** — there are **no leftover uncommitted simplification edits** on `codex/release-0.1.1-prep`.

### External or not yet published

| What | Where | Notes |
|---|---|---|
| **Dirty `codex/tasks-routines-mvp` worktree** | `/Users/nickgardner/Desktop/ritual-desktop-main` | ~438 dirty files. Entities/experiments/account-deletion and other product WIP. **Do not treat this tree as ship.** Some of those features already exist on the release branch; the dirty copies are not what deployed. |
| **Trigger.dev cloud project** | Trigger.dev UI | Owner-confirmed deleted. No code or Railway credentials remain. |
| **New desktop `.app` containing this native code** | Not yet published | v0.1.99 is configured for Apple Silicon; signing, notarization, packaged smoke, updater validation, and publication remain release gates. |
| **Watcher live RSS samples** | launch budgets | Not yet captured. Legacy missing values are null/not-applicable; release status remains incomplete. |
| **Production report mail secret** | Vercel project configuration | Intentionally deferred by the owner; authenticated report delivery fails closed with 503. |
| **LOC reduction into 180k–185k** | measurement | Not achieved; canonical total is 190,952 and no product deletion is authorized for the metric. |

---

## Suggested remaining work (priority)

1. Publish and install the Apple Silicon v0.1.99 desktop patch, verify channel-bound auth and updater selection, then remove temporary auth protocol v1.
2. Capture signed enabled/disabled Apple Silicon launch trials and attach raw artifact hashes.
3. Keep report email fail-closed until the owner chooses to configure `RESEND_API_KEY`.
4. Keep the 180k–185k band as a deletion/consolidation target only. If 190,952 cannot be reduced without live product loss, record the honest final result instead of naming product to cut for the metric.

Do not start another deletion pass of the remaining Next routes (chat stream, voice, calendar OpenAI, OAuth, Sendblue) unless the product owner wants those moved. They are still serving unique jobs.
