# Ritual simplification overview

**Date:** 2026-08-22  
**Goal:** Make Ritual materially simpler, smaller, faster, and easier to maintain by deleting unused architecture, consolidating to one BFF / chat / scheduler / IPC / cache path, and reducing production LOC without losing product functionality.

This is a status report of that goal against the live repo, not a new plan. The governing docs are [`RITUAL_SIMPLIFICATION_PLAN.md`](./RITUAL_SIMPLIFICATION_PLAN.md), [`RITUAL_SIMPLIFICATION_RESULTS.md`](./RITUAL_SIMPLIFICATION_RESULTS.md), and [`RITUAL_SIMPLIFICATION_ARCHITECTURE_REPORT.md`](./RITUAL_SIMPLIFICATION_ARCHITECTURE_REPORT.md).

**Read this against the ship branch**, `codex/release-0.1.1-prep`, worktree `/Users/nickgardner/Desktop/ritual-release-0.1.1-prep`. The Cursor workspace `ritual-desktop-main` is often on `codex/tasks-routines-mvp` with a large dirty tree of unrelated product WIP. That dirty tree is **not** what Vercel and Railway deploy.

---

## How much of the goal landed

**The earlier simplification removed real duplication, but final ownership and release gates remain incomplete. The numeric “smaller” target is also not met.**

| Plan outcome | Status |
|---|---|
| One owner per turn, job, cache, projection, native command | **Mostly true.** AssistantKernel + FastAPI `assistant_turns`; FastAPI cron only; React Query per-user; Tinybird documented; NativeGateway generated triad. Catch-all and Next-owned chat/voice/calendar/OAuth routes still exist on purpose. |
| One obvious path from each client to domain truth | **Mostly true for signed-in FastAPI JSON.** Dashboard/Next use the generated client. Multipart, plaintext Apple export, and logs inline PUT still go through the catch-all. Chat kernel still uses `fetchPythonApi`. |
| Local desktop reads for local desktop data | **True for recent desktop activity.** `activity.db` with `local \| synced \| unavailable`. Web/iOS and long-range aggregates stay `synced` / Tinybird. |
| No user-facing control without persisted behavior | **Mostly true.** Fake AI retention/history controls were hidden. Privacy export/sync/erasure were restored on the release tree. |
| Launch path measured | **Partially true.** Five stored WKWebView cold/warm fixtures gate `repo:check`, but the artifacts do not contain sufficient raw provenance to certify them as live captures. Watcher RSS is invalidly encoded as zero. |
| Reproducible builds / immutable releases | **Mostly true.** Sidecars SHA-pinned for Apple Silicon; CI/release actions pinned to SHAs. Intel Macs are not a 0.1.1 target. |
| ~7.5k–12.5k fewer production lines (180k–185k band) | **Not met.** The canonical release-branch command reports **187,086**. See `LOC_BASELINE.md`; the historical 192,474, ~192.6k, and dirty-tree 183.97k figures are no longer current measurements. |

### Definition of done vs evidence

| Criterion | Evidence now |
|---|---|
| Production build green | **Yes on the starting ship SHA.** GitHub `quality` + `desktop-rust` succeeded for `65ced577`. Vercel Production deployed that SHA. Local `next build` still needs Clerk keys. |
| Every Tauri command typed + capability | **Yes.** ACL 68/68. Generated name + capability + TS I/O. |
| Persisted browser data cannot cross identity | **Yes.** React Query key `ritual:react-query-cache:v1:<userId>`. |
| One durable assistant turn / receipt history | **Yes.** FastAPI `assistant_turns` + kernel commit. Chat still **fail-open** if FastAPI is down. |
| Only read-only tools concurrent | **Yes.** Mutating tools serial; unknown tools fail closed as mutating. |
| One scheduler owner | **Declared in code, not yet effective in production.** Trigger.dev code is gone, but Railway currently sets `ENABLE_INTERNAL_SCHEDULER=1` while startup maintenance is off, and scheduler task creation is nested under that maintenance gate. The cloud project is also an unverified ops leftover. |
| No chat-api / profiling callers | **Yes.** `apps/chat-api` and the profiling bridge are deleted. |
| Desktop activity explicit local source | **Yes** for recent desktop. |
| Remaining projections documented | **Yes.** Tinybird inventory; Typesense deleted; MiniSearch stays for the in-modal habit picker. |
| Launch / RSS budgets | **Stored webview fixtures exist; live provenance and watcher RSS do not.** |
| Authored LOC in 180k–185k | **No.** Canonical ship-branch total is **187,086**. |
| Legacy orchestration deleted after parity | **Strangler complete for the kernel.** `chat-stream/*` remains the model-loop adapter behind the kernel. |

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

- **Chat:** one host, dashboard `/api/chat/stream` → `handleChatStreamRequest` → `AssistantKernel` → FastAPI `assistant_turns`. SMS uses the same tool batch. Desktop has a local turn outbox.
- **Scheduler:** FastAPI `background_tasks.py` / `secondary_job_runner.py` only. Job table: `SCHEDULER_JOBS.md`.
- **Search:** command palette / habit search read Turso SQL. MiniSearch is client-only for the in-modal picker.
- **Analytics:** dashboard Tinybird reads go through FastAPI. Tinybird stays the analytics projection.
- **Desktop IPC:** feature code imports NativeGateway. Implementation stays in `apps/dashboard/lib/desktop-bridge/*`.
- **Cache:** React Query restore waits for Clerk user id; per-user key. Habit snapshots folded into that persist path.
- **BFF:** signed-in FastAPI JSON uses the generated client (`apiOperationWithAuth` / `apiOperation` / `createServerBackendClient`). Next API allowlist is **16 routes** (catch-all, Clerk desktop token, calendar OpenAI stream, chat habits/stream/SMS, Whisper + Deepgram, OAuth callbacks, store-code, workflows/execute, reports/send, Sendblue, sentry-smoke).
- **Activity:** recent desktop reads `activity.db` only. Cloud backfill requires `plaintext_sync` consent.

### Kept on purpose

MiniSearch, Tinybird, FastAPI `ui_preferences` (cross-device overview/color), OpenPanel + Sentry, MUI + Lucide, hosted dashboard in WKWebView (not bundled into Tauri), habits/wearables/SMS on the server, no Goose/ACP.

### What the running product feels like

Same product surfaces: dashboard, chat, habits, calendar, tasks, routines, reports, integrations, privacy, desktop watcher. Fewer deployables and fewer duplicate HTTP clients. Desktop launch telemetry now actually records on Tauri 2 (`__TAURI_INTERNALS__.invoke`). Clerk production builds are deploying.

It does **not** feel like a 4–7% smaller codebase, because restored live product replaced the deleted dead code.

---

## Still issues (architecture / ops, not necessarily user-facing bugs)

These are remaining dual paths, unpaid taxes, or incomplete gates. They are documented as leftover on purpose unless noted.

1. **Canonical LOC is 187,086**, not 180k–185k. The checked-in audit command and bucket data supersede the historical estimates. Further reductions must come only from unreachable code or ownership consolidation, not live product cuts.
2. **Trigger.dev cloud project** may still fire jobs until it is paused/deleted in the Trigger.dev UI. Railway FastAPI is already the in-repo scheduler.
3. **Next catch-all leftovers:** multipart import/screenshot preview, plaintext/CSV Apple Health export, habit-log inline PUT (FastAPI has no update-log operation).
4. **Next-owned AI/OAuth/email routes** listed above. Collapsing them would move streaming, webhooks, or secrets, not delete unused code.
5. **Watcher RSS unmeasured.** `native_ready` fires before the sidecar starts; the live capture session had no saved watcher config, so `watcher_rss_bytes` is 0 in `tools/performance/launch-budgets.json`.
6. **`chat-stream/*` still exists** as the model-loop adapter. That is the strangler leftover, not a second chat host.
7. **Chat / conversation persist fail-open** if FastAPI is down. Durable turns exist; the UI still continues rather than hard-failing.
8. **Apple Silicon only.** No Intel `x86_64` sidecars.
9. **FastAPI 0.119.0 in CI vs a local 0.128 venv.** OpenAPI/client must be generated against the CI pin or `check-generated-backend-client` fails.
10. **Desktop social login still hops through the browser** (`/auth/desktop-oauth-bridge` → `com.ritual.desktop://`). One Clerk app; several UI doors. Chrome cannot hear Tauri deep links, so after ~5s it always shows “Open Ritual”.
11. **Installed `/Applications/Ritual.app` was last seen as 2026-07-17.** Hosted JS comes from `desktop.ritualdb.com`; native IPC/RSS/watcher behavior comes from whichever binary is running. A July app plus a debug `app` binary can steal `com.ritual.desktop://` from each other.

---

## Still bugs / things that need fixing

These bit us during the live desktop captures or CI, or are still wrong in production-shaped runs.

| Issue | What happens | Fix / next |
|---|---|---|
| **Wrong backend base in debug “production” desktop** | After sign-in, Turso refresh hits `http://127.0.0.1:8000` and connection-refuses. Location/biome outbox logs “Auth token is unavailable” until handoff, then the local URL. | **Fixed and pushed** (`65ced577`). Hosted `desktop.ritualdb.com` now hands native the Railway FastAPI URL; production Rust also rewrites leftover loopback bases. |
| **Watcher does not autostart without a saved config** | Launch RSS for the sidecar is 0; computer-activity tracking may stay off until the user enables it in this binary. | Expected if tracking was never enabled in that app data dir; not expected if the July app already had a config the debug binary cannot see. |
| **`native_ready` races the watcher** | Even when the sidecar starts, the first telemetry sample often has `watcher_pid: null`. | Sample RSS after watcher start, or delay that field, before treating watcher RSS as a live budget. |
| **Cmd+R does not reload the WKWebView** | Keystrokes go to Chrome if it is focused; Tauri has no Reload handler. Debug builds can `SIGUSR1` to `location.reload()`. | Product builds still have no in-app reload. Fine for users; painful for QA. |
| **OAuth leftover page in Chrome** | “Still returning to Ritual?” / “Open Ritual” is `/auth/desktop-oauth-bridge`, not a second onboarding/Clerk. | Click Open Ritual and look at the **native** window. Uninstall or quit the July `Ritual.app` if the deep link opens the wrong binary. |
| **Transparent / liquid-glass window** | Screenshots and clicks can look like they hit the desktop underneath. | Known desktop chrome issue; not a second app. |
| **Debug process name is `app`** | Activity Monitor / `pgrep` will not show `Ritual`. | Expected for `target/debug/app`. |
| **Alembic two heads / OpenAPI 0.128 drift / Svix `verify()` returning `None` / Rust test filter** | These broke GitHub `quality` or `desktop-rust`. | **Fixed and pushed** (`bcbfb88a`, `0d7d365f`, `c9a3aa21`, `5cb82a5a`). |
| **Tauri 2 IPC not detected** | Hosted dashboard after `location.replace` saw desktop UA but `invoke` threw, so launch events never logged. | **Fixed and pushed** (`cd7976c9`). Vercel is serving that JS. |
| **Bootstrap timing headers dropped** | Catch-all stopped forwarding `server-timing` / `x-ritual-bootstrap-*`. | **Fixed and pushed** (`5cb82a5a`). |
| **Onboarding banner `#fafaf9` vs canvas `#fcfcfa`** | Contract test failed. | **Fixed and pushed** (banner aligned to `#fcfcfa`). |

Not treated as bugs (intentionally not done): bundling the dashboard into Tauri, moving habits/wearables/SMS onto the device, deleting MiniSearch/Tinybird/OpenPanel/Sentry/MUI, Goose/ACP.

---

## What was committed and pushed to production vs what was not

### How production is wired

Vercel (dashboard) and Railway (FastAPI) deploy from **`codex/release-0.1.1-prep`**, not from `main`, and not from `codex/tasks-routines-mvp`.

- Branch HEAD (pushed): **`2984b9f8`** — *Replace launch-budget fixtures with live WKWebView five-trial captures.*
- GitHub PR: [https://github.com/NickGardner0/ritual-desktop-main/pull/9](https://github.com/NickGardner0/ritual-desktop-main/pull/9) — **open, not merged to `main`.**
- GitHub CI on `2984b9f8`: **`quality` success, `desktop-rust` success.**
- Vercel Production: **deployed `2984b9f8`.**
- Railway FastAPI: last backend deploy seen for this work was **`c9a3aa21`** (Clerk webhook JSON parse). Later SHAs did not touch `apps/backend/**`, so Railway correctly skipped.

If “production” means “what users hit on desktop.ritualdb.com / Railway,” **the pushed release-branch commits are in production** (dashboard at `2984b9f8`, backend at the last backend-touching SHA). If it means “merged to `main`,” **nothing from this program is on `main` yet.**

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
- Live launch/RSS numbers in `tools/performance/launch-budgets.json`

Composer / Tasks icon polish that was merged from origin into this branch is also on that SHA (product, not simplification).

The **release worktree is clean** — there are **no leftover uncommitted simplification edits** on `codex/release-0.1.1-prep`.

### Not pushed / not production

| What | Where | Notes |
|---|---|---|
| **Dirty `codex/tasks-routines-mvp` worktree** | `/Users/nickgardner/Desktop/ritual-desktop-main` | ~438 dirty files. Entities/experiments/account-deletion and other product WIP. **Do not treat this tree as ship.** Some of those features already exist on the release branch; the dirty copies are not what deployed. |
| **Trigger.dev cloud project** | Trigger.dev UI | Ops only. No code left in the repo. |
| **New desktop `.app` containing this native code** | Not shipped as a DMG/app replacement in this pass | Users still run hosted JS in WKWebView. The July `/Applications/Ritual.app` native shell is old. Debug `target/debug/app` is local-only. |
| **Watcher live RSS samples** | launch budgets | Recorded as 0. |
| **LOC reduction into 180k–185k** | measurement | Not achieved; no extra deletion pass queued. |
| **This overview file** | local | Created on request; **not committed** unless you ask. |

---

## Suggested remaining work (priority)

1. In Trigger.dev, pause/delete the cloud project after confirming Railway cron is running.
2. Quit or replace the July `Ritual.app` so deep links hit the this-branch binary; confirm production FastAPI base (not `:8000`) after desktop sign-in.
3. Recapture watcher RSS with tracking actually running, then replace the 0s in `launch-budgets.json`.
4. Keep the 180k–185k band as a deletion/consolidation target only. If 187,086 cannot be reduced without live product loss, record the honest final result instead of naming product to cut for the metric.
5. Merge PR 9 to `main` only if you want `main` to match what Vercel/Railway already deploy.

Do not start another deletion pass of the remaining Next routes (chat stream, voice, calendar OpenAI, OAuth, Sendblue) unless the product owner wants those moved. They are still serving unique jobs.
