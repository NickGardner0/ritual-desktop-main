# Ritual vs. Berd architecture audit

**Audit date:** 2026-08-20  
**Ritual snapshot:** `/Users/nickgardner/Desktop/ritual-desktop-main` at `4afdc5e69a8117f9e13988d6dcde38efdf2f2cef`, branch `codex/tasks-routines-mvp`, including the uncommitted source present in that worktree.  
**Berd snapshot:** `/Users/nickgardner/Desktop/berd-audit` at `a1a41ce4af972712dd28ac1706014b93eab253a3`; `git fetch origin main` confirmed that commit matched `origin/main` during the audit.  
**Berd upstream:** `https://github.com/block/berd.git`  
**Scope:** investigation only. No Ritual application code was changed.

> **Current ship-branch note (2026-08-22):** The 192,474 figure below is the historical audit snapshot, not the current release baseline. The executable `npm run audit:loc` contract reports 190,908 after the additive durable-chat, watcher-lifecycle, explicit-route, model-engine, scheduler, channel-auth, and desktop release-correctness boundaries (starting ship baseline: 187,086 at `65ced577`). See [`LOC_BASELINE.md`](./LOC_BASELINE.md) for buckets, exclusions, source digest, and reconciliation with the dirty-tree 183.97k and manual ~192.6k claims.

## Executive assessment

Ritual is **moderately over-engineered**, but not for the obvious reason.

- Ritual's strict authored production surface is about **192,474 code lines** excluding the separate iOS companion, versus about **255,284** for Berd's core desktop app. Berd is the larger implementation.
- Ritual is nevertheless harder to reason about because one user action can cross React state, browser persistence, a Next route, FastAPI, Turso, Tinybird or Typesense, a WebSocket notification, and a second cache. Its problem is **distributed ownership**, not raw LOC.
- Berd has fewer remote layers and a clearer owner for AI execution. It is not a general simplicity or performance benchmark: it has 169 Tauri commands, three bundled executables, 19 Zustand store definitions, several multi-thousand-line frontend files, and a measured initial web bundle closure of roughly 6.38 MB raw / 1.79 MB gzip.
- Most of Ritual's cloud architecture is justified by its actual product: web and iOS clients, multi-device data, OAuth integrations, SMS, shared AI tools, and account deletion cannot simply become desktop-local.
- The self-inflicted part is the duplication around those justified capabilities: multiple chat control planes, multiple schedulers, overlapping search/analytics representations, several desktop IPC wrappers, identity-unsafe query-cache restore, unused UI/features, and incomplete IPC permissions.

### Direct answer: should Ritual delete all AI/chat/tool-call code and rebuild?

**No—not as a big-bang deletion.** Freeze the current orchestration surface, preserve the working domain tools and external contracts, and replace the turn-execution kernel behind them incrementally.

The current AI surface is not one disposable component. `packages/chat-runtime/src` is about 6.5k production lines, the current dashboard chat feature is about 4.2k more, and the behavior also reaches Next route handlers, FastAPI conversation persistence, receipts, queues, SMS, domain services, and optimistic UI. Deleting it first would discard product-specific work while leaving the hard cloud and domain requirements intact.

What should be rebuilt is the **ownership model**:

1. one authoritative turn state machine;
2. one durable queue/outbox owner;
3. session-serialized mutations and explicitly parallel read-only tools;
4. commit/receipt acknowledgment before a turn is reported complete;
5. cancellation and conversation epochs;
6. one typed event protocol shared by web, desktop, SMS, and later ACP adapters;
7. an explicit capability and permission registry.

These are the useful Berd/OpenCode/Macro-inspired principles. Only Berd was directly audited here; this report does not claim unverified implementation details about Macro or OpenCode.

### Does Berd use Goose directly?

**Yes.** Berd ships and launches a pinned Goose backend binary named `goosed`; it does not embed Goose's UI.

- `goose-backend.lock.json` pins the Goose source at commit `063694cf769269c1f151416605687991fdcbc496` for the audited build.
- `src-tauri/src/services/acp/goose_serve.rs` owns a singleton `GooseServeProcess`, launches `goosed serve --enable-scheduler --host 127.0.0.1 --port …`, injects a random `GOOSE_SERVER__SECRET_KEY`, captures/redacts logs, and waits for readiness.
- `src-tauri/src/commands/acp.rs::get_goose_serve_url` exposes the authenticated local endpoint.
- `src/shared/api/acpConnection.ts` opens an ACP WebSocket and constructs the vendored `@aaif/goose-sdk` `GooseClient`.
- Berd sends ACP `session/new` and `session/prompt` operations and consumes session notifications. Goose owns provider/model execution, the agent/tool loop, MCP, Goose session persistence, and schedules.
- Berd owns the product UI, session lists, queued-message durability, replay/reconciliation, project/agent/skill UX, permission UI, and managed external ACP harnesses such as Claude Code and Codex.

So the accurate model is **Berd UI/orchestration on top of Goose runtime**, not “Berd copied some Goose code” and not “Berd is just the Goose app.”

---

## 1. Method and confidence

### Repository work

The audit read both repositories' product and engineering documents, manifests, frontend and Rust startup paths, capabilities, persistence, sidecar/process management, tests, CI, and release workflows. Documentation was used as a map; conclusions below are based on reachable code and configuration.

The Ritual worktree was already dirty. Counts and conclusions therefore describe the exact current source, not necessarily the last committed release. The release worktree at `/Users/nickgardner/Desktop/ritual-release-0.1.1-prep` was not modified.

### LOC method

`tokei 14.0.0` counted code lines. The main production metric excludes `.git`, `node_modules`, `.next`, `dist`, `target`, coverage, virtual environments, generated sources, lockfiles, assets, fixtures, snapshots, test directories, and `.test`/`.spec` files. Tinybird's DSL is not recognized by Tokei, so its nonblank, non-comment authored lines were counted separately. Rust keeps many unit tests beside production code; Rust production totals therefore contain some test code and are slightly high for both repositories.

### Evidence labels

- **Measured:** produced by a command in this audit.
- **Static conclusion:** directly follows from code/configuration but was not timed at runtime.
- **Estimate:** a bounded engineering estimate, with its basis stated.
- **Hypothesis:** requires interactive profiling or deployment evidence.

---

## 2. Actual architecture maps

### 2.1 Ritual

```text
macOS launch
  -> Tauri 2 host (`apps/desktop/src-tauri/src/main.rs`)
     -> tray, updater, deep links, 71 registered commands
     -> bundled redirect/failure shell
     -> watcher sidecar -> optional vision helper
     -> activity.db / memory.db / vault.db / file outboxes
  -> `DesktopShellApp.jsx`
     -> location.replace(https://desktop.ritualdb.com/...)
  -> hosted Next.js dashboard
     -> Clerk + providers + React Query/browser caches
     -> Next route handlers/BFF
     -> FastAPI
        -> central Turso/libSQL
        -> per-user activity Turso databases
        -> Tinybird / Typesense
        -> provider APIs / webhooks / WebSocket

Separate clients:
  browser extension -> watcher heartbeat/local integration
  iOS companion -> remote APIs, HealthKit and Screen Time ingestion
  SMS/provider webhooks -> FastAPI
```

Production desktop does not contain the useful dashboard. `apps/desktop/src/DesktopShellApp.jsx` invokes `get_desktop_shell_bootstrap_config` and calls `window.location.replace`; the configured hosted origin is `https://desktop.ritualdb.com`. The local shell is an offline/error/bootstrap surface.

### 2.2 Berd

```text
OS launch
  -> Tauri host (`src-tauri/src/lib.rs`)
     -> plugins + commands + local layout migration (`berd.sqlite`)
     -> bundled Vite/React application
     -> `goosed` sidecar
     -> `berdctl` sidecar / `catch` crash helper
  -> React startup/auth/AppShell
     -> 19 Zustand stores + React Query + local files/localStorage
     -> chat runtime startup
     -> authenticated ACP WebSocket
     -> Goose session/model/tool/MCP runtime
     -> model-provider and optional download/telemetry endpoints

Persistence:
  Berd layout sqlite + app-data files
  Goose-owned session/config sqlite/files
  durable queued-message JSON + browser state
```

Berd has no Berd application server or cloud application database. Its network boundary is principally model/provider APIs, authentication or telemetry, updater/download sources, and optional managed tooling.

### 2.3 Representative record flow

#### Ritual habit log

```text
UI
 -> `HabitsContext.logHabit`
 -> `useLogHabitMutation`
 -> optimistic React Query state + local snapshot/private outbox
 -> Next `/api/...` BFF
 -> FastAPI `core` router / `habits_service`
 -> SQLAlchemy/libSQL central Turso
 -> async secondary effects (Tinybird, Typesense, notification)
 <- JSON response
 -> query invalidation / canonical refetch
 -> OpenPanel event and other UI effects
```

The network hop is justified for a record used by web, desktop, iOS, SMS, and server-side tools. The duplicated representations and best-effort secondary effects are the tax.

#### Ritual computer activity

```text
watcher/vision
 -> local `activity.db`
 -> local cloud-sync outbox
 -> Rust sync loop (about every 60s)
 -> per-user Turso activity database
 -> backend/dashboard read paths
 -> React Query/browser snapshots

Separately, `DesktopRuntimeBridge` can trigger a large historical
`/api/watcher/sync-to-habit` backfill after startup.
```

This is appropriately local-first, but it has too many read fallbacks and synchronization surfaces.

#### Berd chat turn

```text
ChatInput
 -> chat/session store
 -> durable per-session queued-message state
 -> root background drain, serialized per session
 -> ACP `session/prompt`
 -> goosed
 -> model provider + MCP/tools
 <- ACP notifications
 -> reconciliation/replay replacement
 -> Zustand/UI
```

This flow has a clearer single execution owner than Ritual's chat path.

---

## 3. Quantitative codebase comparison

### 3.1 Ritual production LOC

| Bucket | Files | Code lines | Notes |
|---|---:|---:|---|
| Dashboard production | 591 | 93,271 | Includes 1,785 CSS; 91,486 TS/TSX/JS |
| Dashboard React TSX | 325 | 53,674 | Subset of dashboard |
| Shared packages | 49 | 7,894 | `chat-runtime`, contracts, UI |
| FastAPI application | 224 | 55,324 | Tests, scripts and migrations excluded |
| Rust desktop/watcher/ritual-db | 81 | 32,506 | Includes co-located Rust unit tests |
| Desktop JS shell | 4 | 331 | Redirect/fallback UI only |
| Browser extension | 4 | 965 | Production source |
| chat-api | 3 | 106 | Production source |
| Tinybird authored DSL | — | 2,077 | Nonblank/non-comment manual count |
| **Strict authored production, excluding iOS** | — | **192,474** | Main comparison metric |
| Swift iOS production | 65 | 12,801 | Separate product/client |
| **Strict authored production, including iOS** | — | **205,275** | |

Additional surfaces, excluded from production:

| Bucket | Files | Code lines |
|---|---:|---:|
| Dashboard tests | 30 | 4,697 |
| Package tests | 5 | 432 |
| Backend tests | 71 | 9,655 |
| Swift tests | 4 | 685 |
| Dedicated Rust test path | 1 | 379; co-located tests remain in Rust total |
| Backend scripts | 35 | 4,096 |
| Root scripts/tooling | 41 | 3,879 |
| Backend migrations/support | 14 | 2,195 |
| Filtered repository total | 1,465 | 302,236 |

### 3.2 Berd production LOC

| Bucket | Files | Code lines | Notes |
|---|---:|---:|---|
| Frontend production | 1,031 | 200,669 | Generated manifest/testing/fixtures excluded |
| Frontend TS/TSX | 1,030 | 198,524 | CSS excluded |
| Frontend React TSX | 377 | 108,026 | Subset of frontend |
| Tauri/Rust app | 102 | 54,032 | Includes co-located tests and internal `berdctl` plugin/crate |
| Authored SDK source | 5 | 583 | `sdk/src/generated` excluded |
| **Core authored production** | — | **255,284** | Main comparison metric |
| Top-level optional `bb-cli` | 36 | 18,800 | Reported separately |
| **Production including `bb-cli`** | — | **274,084** | |

Additional surfaces:

| Bucket | Files | Code lines |
|---|---:|---:|
| Co-located frontend tests | 566 | 164,356 |
| Additional `tests/` | 30 | 11,635 |
| Scripts/tooling | 58 | 9,646 |
| SQL migrations | 3 | 90 physical lines |
| Filtered repository total | 2,064 | 518,811 |

### 3.3 Normalized interpretation

- Berd core production is about **33% larger** than Ritual excluding iOS (`255,284 / 192,474`). Including `bb-cli`, it is about **42% larger**.
- Berd's frontend alone is roughly twice Ritual's dashboard/packages frontend. It spends heavily on a rich local agent workbench, artifacts, automations, voice, project management, and tests.
- Ritual spends about 55k Python lines and 32.5k Rust lines on domain/cloud and local activity/privacy capabilities that Berd does not attempt.
- Ritual feels larger because a feature crosses more ownership boundaries. Berd is larger in files and code, but its primary request path usually remains inside React -> Tauri/ACP -> Goose.

Approximate responsibility split—not a parser-derived metric:

| Responsibility | Ritual estimate | Berd estimate | Basis |
|---|---:|---:|---|
| Product/UI behavior | 75–85k | 145–160k | Routes, components, feature logic |
| Domain/runtime behavior | 55–65k | 55–70k | Ritual services/tools; Berd chat/runtime orchestration |
| Native/local platform | 28–34k | 30–40k | Rust after allowing for tests/orchestration overlap |
| Infrastructure/glue | 18–28k | 15–25k | BFF/sync/adapters vs ACP/sidecar/tool management |
| Dead/duplicate/unnecessary | 7.5–12.5k | Not comprehensively audited | Ritual evidence in section 12 |

These ranges overlap categories and are intended to locate the tax, not sum to a second exact LOC total.

---

## 4. Structural complexity inventory

| Metric | Ritual | Berd | Interpretation |
|---|---:|---:|---|
| `package.json` manifests | 9 | 2 | Ritual workspace/config sprawl |
| Unique npm runtime dependencies | 77 | 99 | Berd is dependency-heavier by count |
| Unique Cargo dependency names | 51 across 3 members | larger app crate, about 67 direct declarations | Neither native layer is small |
| Python production dependencies | 22 | 0 | Required by Ritual server |
| Next pages | 32 | n/a | |
| Next route handlers | 42 | n/a | BFF/server surface |
| FastAPI top-level routers | 34 | 0 | 46 `include_router` occurrences overall |
| FastAPI route decorators | 291 | 0 | Includes nested router modules |
| Tauri commands | 70 | 169 | Berd has the larger IPC/native API |
| Relevant nested app providers | 10 | 1 React context definition | Berd instead has store sprawl |
| Zustand store definition files | 0 | 19 | One pattern, many owners |
| Core local process topology | Tauri/WKWebView + watcher; vision on demand | Tauri/WKWebView + goosed; berdctl/catch as needed | Similar local count; different responsibility |
| Application-controlled persistence systems | 3 current local DBs + central/per-user Turso + Tinybird + Typesense + browser/files | Berd sqlite/files + Goose-owned state + browser/files | Ritual owns more consistency edges |
| Network-service classes | More than 12 when optional integrations are enabled | Model/auth/telemetry/update/download classes | Ritual is materially more distributed |
| Explicit product `setInterval` sites | 22 | not normalized | Ritual ongoing-work surface |
| Server recurring loops if internal scheduler enabled | 8 major loops plus DB-backed workers | Goose scheduler plus app warm/reconcile tasks | Ritual also has Trigger entrypoints |
| Production sidecars/external bins | 2 | 3 | Ritual watcher/vision; Berd goosed/berdctl/catch |
| Checked-in DB migrations | 11 Alembic versions + local schemas | 3 Berd layout migrations; Goose separate | Ritual domain is much broader |
| Meaningful runtime env keys, static scan | about 188 unique | about 51 | Ritual configuration is a major tax |
| Browser storage key operations | 121 explicit operations | substantial store/queue persistence | Both persist frontend state |
| Release OS matrix | macOS-focused | macOS, Windows, Linux | Berd's release system is necessarily larger |

The 188 environment-key count is a conservative static union of direct JS, Python and Rust reads; scripts/tooling raise it further. Dynamic keys can make static counts imperfect.

### Duplicate abstractions in Ritual

| Responsibility | Overlapping implementations | What breaks if one disappears? |
|---|---|---|
| Chat streaming | dashboard `/api/chat/stream`, shared chat runtime, `apps/chat-api` | `apps/chat-api` appears to have no current dashboard caller |
| Scheduling | FastAPI lifespan loops, Trigger.dev jobs, several client timers | One correctly selected production scheduler should be enough per job |
| Search | SQL/Turso, Typesense, MiniSearch, Tinybird-derived reads | Advanced/global search degrades; core data does not disappear |
| Desktop commands | `desktop-bridge/commands.ts`, `tauri-utils.ts`, `desktop-runtime.ts`, `DesktopRuntimeBridge`, shell bridge | A single typed client can replace most wrappers |
| Offline delivery | habit, task, location, biome, wearable, and activity outboxes | Domain-specific persistence remains; state-machine primitives can be shared |
| Telemetry | Sentry, OpenPanel, Vercel Speed Insights, service logs | Each covers a different slice, but initialization/governance can be unified |
| Models | TS, Pydantic, SQLAlchemy, Rust, Swift, Tinybird | Cross-process product requires several forms; manual duplication does not |

---

## 5. Frontend comparison

### Ritual frontend

Ritual uses Next App Router, React Query for server state, multiple React contexts for cross-cutting state, local/session storage for cache and preferences, and Tauri event/command bridges. The effective root nesting is:

```text
DesktopCapabilities
 -> Theme
 -> Clerk
 -> ChromeAppearance
 -> OpenPanel
 -> Query
 -> Habits
 -> Font
 -> SidebarMode
 -> AI
 -> route content + runtime bridges
```

Strengths:

- route-level code boundaries;
- React Query and virtualized message/log surfaces;
- an enforced roughly 800-line source budget, which is healthier than Berd's god files;
- reusable primitives in `packages/ui`;
- native work is mostly deferred from first paint.

Problems:

- `QueryProvider` calls `restorePersistedQueryCache()` synchronously in its `useState` initializer before Clerk identity is confirmed; the key `ritual:react-query-cache:v1` is global, while a later identity guard clears state. This can parse/render another user's stale cache before cleanup and adds synchronous startup work.
- `DashboardLayoutClient` eagerly prefetches eight routes and mounts AI/runtime/scheduler infrastructure regardless of the first feature needed.
- direct `fetch` remains widespread (240 occurrences in 97 production dashboard files), alongside client wrappers and the generated BFF path matcher.
- `DesktopRuntimeBridge` combines auth-token sync, profile sync, local polling, events, WebSocket reconnect/heartbeat, and a historical data backfill.
- AI chat orchestration and auto-run queue draining are mounted inside feature components rather than owned by a root runtime.

### Twenty largest Ritual frontend source files

Physical source lines are used here to match file-review effort; these are not Tokei code-line counts.

| Lines | File | Assessment |
|---:|---|---|
| 845 | `apps/dashboard/app/(dashboard)/activity/logs-client.inner.tsx` | Legitimate feature, too many view/data responsibilities |
| 812 | `apps/dashboard/app/(dashboard)/reports/reports-client.tsx` | Split orchestration from presentation |
| 809 | `apps/dashboard/components/command-palette.tsx` | Broad feature surface, mostly legitimate |
| 800 | `apps/dashboard/components/habit-selection-modal.tsx` | Split data/search/modal behavior |
| 796 | `apps/dashboard/lib/computerActivity/api.ts` | Complex because it arbitrates local/remote paths |
| 794 | `apps/dashboard/lib/privacy/ritual-vault-export.ts` | Security-sensitive, legitimate complexity |
| 791 | `apps/dashboard/lib/computerActivity/derive.ts` | Heavy domain derivation, test rather than casually split |
| 791 | `apps/dashboard/app/(dashboard)/chat/chat-client.shared.tsx` | Chat UI/controller boundary is still broad |
| 779 | `apps/dashboard/components/computer-tracking-settings.tsx` | UI, polling and native control mixed |
| 776 | `apps/dashboard/hooks/use-habits-query.ts` | Query, optimistic state, vault and outbox mixed |
| 774 | `apps/dashboard/components/ui/sidebar.tsx` | Very likely unused duplicate primitive |
| 768 | `apps/dashboard/lib/privacy/vault-private-sync.ts` | Legitimate but needs explicit state-machine ownership |
| 739 | `packages/chat-runtime/src/sms.ts` | Separate channel, tool/runtime logic duplicated |
| 733 | `apps/dashboard/components/habit-logs-search-filter.tsx` | Could share query/filter composition |
| 729 | `apps/dashboard/hooks/useKanbanBoard.ts` | Definitely unreachable with Kanban feature |
| 718 | `apps/dashboard/components/apple-watch-settings.tsx` | Separate-client integration; retain if product remains |
| 716 | `apps/dashboard/app/(dashboard)/routines/routine-configure-modal.tsx` | Product complexity, split form/state |
| 706 | `apps/dashboard/app/(dashboard)/chat/chat-client.impl.tsx` | Owns too much queue/conversation/UI state |
| 703 | `apps/dashboard/lib/workflows/executor.ts` | Legitimate domain engine; strengthen contracts |
| 701 | `apps/dashboard/components/tables/habit-logs/data-table.tsx` | Legitimate table behavior and virtualization |

### Berd frontend

Berd uses Vite/React, 19 Zustand store definitions, React Query for selected server/cache concerns, durable local queue files, and a large feature-oriented UI. It has clearer runtime ownership but worse file-scale boundaries.

Representative large files include `DesignSystemView.tsx` (~5.9k physical lines), `AppShell.tsx` (~5.4k), `VirtualMessageTimeline.tsx` (~4.0k), `useChatSessionController.ts` (~3.4k), `ChatInput.tsx` (~2.0k), and `chatStore.ts` (~1.9k). Berd does **not** generally achieve its frontend behavior with smaller files. Its advantage is that the state ultimately targets one ACP runtime, not that its React layer is cleaner.

As a coarse comparable—not a component count—the mean production TSX file is about **165 code lines** in Ritual's dashboard (`53,674 / 325`) and about **287** in Berd (`108,026 / 377`). A TSX file can contain zero or several components, so these values measure review granularity, not React-tree size.

---

## 6. Desktop/native comparison

### Ritual Tauri

- Tauri 2 application in `apps/desktop/src-tauri`.
- 71 registered commands plus dialog, filesystem, shell, updater and deep-link plugins.
- Native responsibilities include window/tray lifecycle, auth/config file handoff, watcher and vision-helper lifecycle, TCC permissions, activity/memory/vault databases, cloud sync, project-time attribution, speech recognition, updater, and deep links.
- `spawn_background_startup_tasks` waits 250ms and then sequentially loads sync config, initializes activity storage, imports history, starts sync/watchdog, initializes memory storage, and starts project-time work. Deferring is good; serializing unrelated work in one task is not.
- Location and Biome drains are registered during setup and begin after their own delays; updater starts after five seconds and then checks periodically.
- `tauri.conf.json` permits broad `https:` content plus `'unsafe-inline'` and `'unsafe-eval'` scripts/styles and several localhost bridge ports. A hosted UI makes CSP and origin integrity part of the native security boundary; narrow this as transports are removed.

#### IPC contract defects

The registered command list and custom capability ACL are not synchronized. Thirty-two registered commands are absent from the custom command permissions used by the remote hosted origin:

`show_main_window`, `sidebar_set_width`, `sidebar_navigate`, `sidebar_get_main_state`, `write_auth_token_to_file`, `write_turso_sync_config`, `check_runtime_bridge_signals`, `check_dashboard_refresh_trigger`, `check_token_refresh_request`, `start_native_speech_recognition`, `stop_native_speech_recognition`, `get_native_speech_state`, `clear_native_speech_state`, `open_input_monitoring_settings`, `get_app_icon`, `get_app_icons_batch`, `clear_watcher_config_cmd`, `reconcile_watcher_config_user_cmd`, the ten `vault_*` commands, `text_search`, `run_project_time_attribution_once`, `run_project_time_retention_once`, and `get_project_time_attribution_health`.

The exact list should be machine-tested from `main.rs` against `capabilities/main.json` and `permissions/*.toml`. Because the hosted UI is a remote Tauri origin and the app has a custom `__app-acl__`, this is a reliability/contract issue, not merely configuration tidiness.

Separately, `apps/dashboard/components/analytics/metrics/useMetricsShare.ts` invokes `copy_png_to_clipboard`, but no Rust implementation or registered command exists. That is a confirmed broken call site.

### Berd Tauri

- 169 registered commands, substantially more than Ritual.
- Three bundled external executables: `goosed`, `berdctl`, and `catch`.
- Native code manages Goose, ACP tools and a managed Node runtime, app layout, packages, updater/release behavior, renderer monitoring, crash capture, voice/artifact helpers, and platform differences.
- `src-tauri/capabilities/default.json` grants URL opening for Linear and path opening across `$HOME/**`, `$TEMP/**`, volumes and broad Unix/Windows workspace paths. Ritual's intended filesystem scope is narrower.
- `GooseServeProcess` has careful environment capture, token injection, readiness probing, stale-process cleanup and log redaction. It uses a process singleton; connection code can reconnect, but a post-ready child-death watchdog is not as explicit as Ritual's watcher watchdog.

Verdict: Ritual's native surface is smaller and has better watcher self-healing; Berd's Goose lifecycle and release supply chain are more disciplined. Neither native layer is simple.

---

## 7. Backend and service audit

`apps/backend/app_factory.py` registers 34 top-level router groups. The table lists every group and the architectural disposition; endpoint counts are static decorator counts within the corresponding route group and are not a guarantee that every nested route is deployed under every configuration.

| Router group | Endpoints | Disposition | Why outside desktop / simplification |
|---|---:|---|---|
| `core` | 28 | **Probably remain remote** | Shared habits/logs and multi-client truth; reduce secondary index writes |
| `privacy` | 17 | **Probably remain remote** | Server policy/erasure must remain; local vault operations should stay local |
| `watcher_activity` | 15 | **Could move local** | Desktop-origin activity reads should prefer local DB; remote sync remains optional |
| `imports` | 15 | **Probably remain remote** | Large provider imports and shared data; local parsing may reduce upload cost |
| `integrations` | 12 | **Must remain remote** | OAuth callbacks, secrets and provider APIs |
| `conversations` | 12 | **Probably remain remote** | Cross-device/SMS history; replace queue claims with fenced durable turns |
| `analytics` | 11 | **Probably remain remote** | Cross-device aggregation; local activity analytics can bypass it |
| `tasks` | 10 | **Probably remain remote** | Shared domain state and AI tools |
| `financial` | 10 | **Must/probably remain remote** | Provider secrets, account data and webhooks |
| `entities` | 10 | **Probably remain remote** | Shared graph/domain data |
| `biometrics` | 10 | **Probably remain remote** | Multi-device normalized data; raw device capture is local |
| `watcher_stats` | 9 | **Could move local** | Desktop-local derived statistics |
| `watcher_devices` | 8 | **Could move local** | Local device state; cloud device inventory may remain |
| `artifacts` | 8 | **Probably remain remote** | Shared/generated artifacts; cache locally |
| `search` | 7 | **Simplify** | Decide SQL search versus Typesense; do not maintain both without SLO evidence |
| `workflows` | 6 | **Probably remain remote** | Scheduled/shared domain execution; one scheduler owner |
| `screen_time` | 6 | **Could move local** | Desktop/iOS device-origin data; sync only normalized records |
| `reports` | 6 | **Probably remain remote** | Scheduled AI/provider work and delivery |
| `facts` | 6 | **Probably remain remote** | Shared assistant memory/domain truth |
| `metric_facts` | 5 | **Probably remain remote** | Shared derived facts; avoid another canonical store |
| `watcher_project_time` | 4 | **Could move local** | Desktop attribution is already local |
| `experiments` | 4 | **Probably remain remote** | Current reachable domain feature |
| `sms_copilot` | 3 | **Must remain remote** | Provider webhook/channel |
| `screenshot` | 3 | **Probably remain remote** | Model/API secrets; compression/OCR can remain local |
| `ui_preferences` | 2 | **Could move local** | Already duplicated in browser storage; sync only if multi-device is a requirement |
| `sms_preferences` | 2 | **Must remain remote** | Server-delivered channel behavior |
| `action_receipts` | 2 | **Probably remain remote** | Cross-channel idempotency/audit |
| `action_profiles` | 2 | **Probably remain remote** | Server tool/capability policy |
| `account_deletion` | 2 | **Must remain remote** | Legal deletion across providers and stores |
| `watcher_biome` | 1 | **Could move local** | Biome ingestion originates locally |
| `vcard` | 1 | **Probably remain remote** | Import could be local, canonical contacts/entities are shared |
| `sendblue` | 1 | **Must remain remote** | Provider webhook |
| `proactive_sms` | 1 | **Must remain remote** | Server-initiated delivery |
| `observability` | 1 | **Probably remain remote** | Production diagnostics; do not expose raw internals |
| `location` | 1 | **Split** | Capture/outbox local; geocoding and shared sync can remain remote |
| `approvals` | 1 | **Probably remain remote** | Cross-channel action governance |

The backend also includes nested wearable and administrative routers, accounting for the broader 291 route decorators. Remote status should be decided at the responsibility level, not by mechanically moving individual HTTP handlers into Rust.

The endpoint-level implementation repeats a smaller set of responsibility patterns. This caller/auth/data matrix covers all top-level groups without pretending that 291 decorators are 291 independent architectural decisions:

| Route groups | Primary caller | Auth boundary | Data/external systems |
|---|---|---|---|
| `core` | Dashboard, iOS and domain tools | Clerk user | Central Turso; asynchronous Tinybird/Typesense/notifications |
| `privacy`, `account_deletion` | Settings and deletion workflow | Clerk user plus internal job context | Central/local policy records and external processor erasure |
| `watcher_activity`, `watcher_stats`, `watcher_devices`, `watcher_project_time`, `watcher_biome` | Desktop dashboard/native sync | Clerk/device identity | Local/per-user activity stores and sync outboxes |
| `screen_time`, `location` | iOS/desktop capture and dashboard | Clerk/device identity | Device-origin events, central/activity DB, geocoder where used |
| `imports`, `vcard`, `screenshot` | Dashboard import/capture UI | Clerk user | Central Turso, uploaded data, model/provider processing |
| `integrations`, `financial`, `biometrics` | Dashboard plus OAuth/provider callbacks | Clerk for UI; state/signature validation for callbacks | Turso and Whoop/Tesla/Plaid/other provider APIs |
| `conversations` | Dashboard chat/runtime | Clerk user | Turso conversation/message/queue records |
| `sms_copilot`, `sms_preferences`, `sendblue`, `proactive_sms` | SMS webhook, settings and scheduler | Provider webhook validation or Clerk settings auth | Sendblue/SMS provider, conversations, AI/domain tools |
| `analytics`, `search` | Dashboard/report/chat read paths | Clerk user | Tinybird, Typesense and/or Turso |
| `reports`, `facts`, `metric_facts`, `artifacts` | Dashboard, assistant and scheduled jobs | Clerk or internal job identity | Turso, analytics/search projections and model APIs |
| `tasks`, `entities`, `experiments` | Dashboard and domain tools | Clerk user | Central Turso |
| `workflows`, `approvals`, `action_receipts`, `action_profiles` | Dashboard, assistant and scheduler | Clerk user/internal job | Turso, policy/receipt records, model/provider calls where applicable |
| `ui_preferences` | Dashboard | Clerk user | Turso, duplicated by browser state |
| `observability` | Diagnostics/operations | Environment/endpoint-specific guard | Sentry/service logs |

Most user endpoints call the common Clerk-backed `get_current_user`; webhook and internal-job endpoints necessarily differ. Auth must be verified at the individual handler before moving or deleting it—group classification is an architecture decision, not an authorization audit.

### External service and background-work inventory

These are service classes referenced by reachable production code/configuration; optional integrations are not necessarily enabled in every deployment.

| Service/system | Responsibility | Why remote / simplification decision |
|---|---|---|
| Vercel/hosted Next | Product UI and BFF | Required by current desktop delivery and web; consider an offline critical shell, not a second full UI |
| Railway/FastAPI deployment | Domain API and webhooks | Required for shared clients/secrets; keep one service boundary |
| Clerk | Identity/token issuance | Must remain remote unless identity product changes |
| Turso platform and central DB | Canonical shared domain records | Keep; reduce duplicate projections |
| Per-user Turso activity DBs | Synced activity | Keep only for explicit multi-device/server use cases |
| Tinybird | Analytics warehouse/projections | Keep only pipes with unique product/SLO evidence |
| Typesense | Search projection | Candidate for SQL/MiniSearch consolidation |
| OpenAI and Gemini | Model/AI APIs | Inference is remote; expose through one engine adapter |
| Trigger.dev | Scheduled/job execution | Choose it or FastAPI-owned scheduling per job |
| Sentry | Error/performance telemetry | Keep with one privacy/initialization policy |
| OpenPanel | Product analytics | Keep only events that drive decisions; coordinate with other telemetry |
| Vercel Speed Insights | Web performance telemetry | Validate marginal value in desktop-hosted context |
| Deepgram | Dictation/transcription | Remote capability; load only when voice is used |
| Whoop, Tesla, Plaid | OAuth/provider data | Remote callbacks/secrets are necessary |
| Sendblue/SMS provider | Inbound/outbound SMS | Must remain remote |
| Apple Health/Screen Time | iOS-origin data | Capture is device-local; normalized sync is remote |
| Browser extension | Browser activity signal | Separate local client; watcher should own the local contract |

Queues/background work include conversation follow-ups, wearable ingest/event outboxes, reports/notifications, workflows/approvals, account deletion, activity/location/Biome outboxes, FastAPI recurring loops, Trigger jobs, the native watcher watchdog/cloud-sync/project-time workers, and client polling/reconnect timers. The simplification target is shared state-machine semantics and one owner per queue—not one universal queue technology.

### Backend implementation findings

- `app_factory.py` is a large routing/composition table, but the individual router pattern is conventional.
- The Next catch-all BFF uses `lib/api/generated/backend-client.ts` as a route matcher. That generated file is reachable and should not be labeled dead.
- `database/connection.py` uses a Turso/libSQL embedded replica in the server and contains a SQLAlchemy/libSQL cursor compatibility monkeypatch. That is a maintenance smell and should become an upstream/versioned adapter or disappear with a driver upgrade.
- The current release code preserves fast database startup but starts all eight scheduler loops independently of deferred maintenance whenever `ENABLE_INTERNAL_SCHEDULER=1`.
- FastAPI now owns a static 13-job registry. Eleven clock jobs use unique durable occurrence claims; wearable ingest/outbox keep atomic durable row claims. Authenticated health exposes registration, last attempt/success, duration, error, and lease state. Trigger.dev remains only an unverified external cloud blocker.
- WebSocket auth accepts a JWT in a query parameter. Authentication failures and health responses can include underlying exception text. Both increase secret/logging and information-disclosure risk.

---

## 8. Storage and consistency

### Ritual stores

| Store | Owner | Purpose / concern |
|---|---|---|
| `~/.ritual/activity.db` | watcher/Rust | Local activity source and sync outbox |
| `~/.ritual/memory.db` | Rust | Local memory/search material |
| `~/.ritual/vault.db` | Rust | Local/private domain records |
| `~/Library/Biome/sync/sync.db` | Apple system, read-only | iPhone foreground activity source |
| Legacy watcher/frame/sync sqlite files | migrations/import | Compatibility cost, not current truth |
| Central Turso/libSQL | FastAPI | Users, habits, logs, tasks, conversations, integrations, workflows |
| Per-user Turso activity DBs | Rust/backend | Synced computer activity |
| Tinybird | backend/dashboard | Analytics projections |
| Typesense | backend | Search projection |
| React Query + local/session storage | dashboard | Cache, snapshots, preferences, feature state |
| JSONL/config/token files | native/dashboard | Outboxes, cursors, auth/config bridge |

The vault uses AES-GCM, but the key file is adjacent to the database, so it protects at-rest contents more than it protects against a compromised user account. `~/.ritual/auth_token.txt` is plaintext with mode `0600`; use a keychain or ephemeral broker if practical.

### Berd stores

| Store | Owner | Purpose / concern |
|---|---|---|
| `berd.sqlite` | Berd Tauri | Home/layout state, three migrations |
| Goose state/session DB and files | Goose | Sessions, provider/runtime state |
| queued-message JSON | Berd Tauri | Durable message work |
| localStorage/store persistence | React/Zustand | UI/session state |
| app-data packages/preferences | Berd Tauri | Agents, skills, packages, configuration |

Berd has fewer stores, but ownership is split between Berd and Goose. Its durable queue design is strong: the root background drain, documented queue laws, per-session serialization, timeouts, invalidation, and replay replacement make failure behavior explicit.

### Consistency tax in Ritual

Ritual models domain data in TypeScript, Pydantic, SQLAlchemy, Rust, Swift, and Tinybird. Some duplication is forced by process and client boundaries. The avoidable portion is handwritten transformations and projections without one versioned schema/event contract.

**Estimate:** 8–15k Ritual lines participate in synchronization, projections, outboxes, generated/ad-hoc API translation and cache reconciliation. Only a minority can be deleted; the useful target is to make one canonical record/event contract generate or validate the rest.

---

## 9. AI/runtime correctness comparison

### Ritual's current failure semantics

The durable boundary identified by the original audit is now resolved without replacing Ritual's domain tools:

- FastAPI atomically accepts a stable turn ID and persists its user message before `AssistantKernel` can enter `running` or call a provider/tool.
- Terminal commit atomically stores assistant content, mutation receipt IDs, tool payload, and `completed`; a failed commit cannot appear in conversation history as completed.
- `DurableAssistantTurnStore` reads and writes the remote owner first and propagates failures instead of substituting memory success.
- Provider/stream failures reject the response and become `failed_retryable`; the dashboard labels partial output provisional and retries with the same turn ID.
- Desktop offline mode only queues the stable turn. Its outbox consumes the full response before removing an item and never runs a local model or tool.
- Mutating tools are serial; concurrency is reserved for registry-declared read-only tools.

The W5 lifecycle/provider boundary is now resolved:

- Web, SMS, proactive SMS, scheduled workflow synthesis, and desktop-outbox replay delegate durable lifecycle to `AssistantKernel.runTurn`.
- `packages/chat-runtime/src/model-engine/*` owns provider request construction, event decoding, retry classification, and cancellation propagation only.
- `scripts/check-chat-runtime-boundaries.mjs` forbids model-engine imports from persistence, queues, tools, and kernel lifecycle modules and rejects direct provider access in chat/workflow owners.

Remaining adjacent chat risks are narrower:
- `packages/chat-runtime/src/executors/habits.ts::newClientEventId` falls back to time plus `Math.random()` for a client event/idempotency ID, weakening retry identity when `crypto.randomUUID` is unavailable.
- `apps/backend/services/conversation_queue_service.py::claim_next_item` updates a claim without a compare-and-set lease/fencing token.
- queue auto-drain lives in `apps/dashboard/app/(dashboard)/chat/chat-client.impl.tsx`; it is absent when that component is not mounted.
- `use-chat-conversation-actions.ts` clears and reloads conversation state without a request epoch/abort discipline strong enough to prevent stale response races.
- failed live habit outbox actions can remain `failed`, and create/retry semantics in `lib/habits/local-first-writes.ts` are inconsistent across action types.

These are reasons to replace the orchestration kernel. They are not reasons to throw away domain tools, receipts, server endpoints or proven UI.

### Berd's stronger patterns

- one ACP client boundary;
- a root-owned background queue drain;
- durable queued messages in local files plus frontend state;
- per-session serialization and explicit invalidation;
- replay reconciliation that replaces provisional output instead of blindly appending;
- Goose owns the actual tool loop and session persistence;
- a pinned sidecar and readiness contract.

Risks worth avoiding:

- the fallback ACP permission handler in `src/shared/api/acpConnection.ts` selects the first option when no handler is installed; the security handler is feature-dependent. Permission failure should default closed.
- Goose availability is coupled to normal AppShell startup.
- a full Goose integration adds a large native/sidecar/runtime dependency and still would not remove Ritual's authenticated domain backend.

### Recommended AI boundary

```text
Web UI / desktop UI / SMS / proactive jobs
              |
        typed turn events
              v
       AssistantKernel
       - durable turn log
       - queue + cancellation epoch
       - session serialization
       - commit/receipt barrier
       - capability/permission policy
              |
       DomainToolGateway
       - explicit read/write metadata
       - stable idempotency key
       - authenticated domain APIs
       - sequential mutations
              |
       FastAPI/Turso domain core

Optional later:
ACP adapter -> Goose/OpenCode/other harness
```

Goose should be evaluated as an optional engine adapter only if Ritual wants a general local agent with filesystem/shell/MCP capabilities. It should not become the domain source of truth.

---

## 10. Startup analysis

### 10.1 Ritual launch to useful UI

| Order | Operation | File/function | Classification |
|---:|---|---|---|
| 1 | flags, logging/observability | `apps/desktop/src-tauri/src/main.rs::main` | **BLOCKING** |
| 2 | plugins, state and 70-command handler | same | **BLOCKING** |
| 3 | tray, deep links, window and drains | Tauri `.setup` | **BLOCKING** composition; most work deferred |
| 4 | bundled shell JS/CSS | `DesktopShellApp.jsx` | **BLOCKING** |
| 5 | bootstrap IPC and remote redirect | `get_desktop_shell_bootstrap_config` | **BLOCKING for useful UI** |
| 6 | DNS/TLS/hosted Next assets | production origin | **BLOCKING for useful UI** |
| 7 | root layout/fonts/providers | `app/layout.tsx`, `root-providers.tsx` | **BLOCKING** |
| 8 | Clerk auth resolution | `ClerkProvider`/auth gates | **BLOCKING for personalized UI** |
| 9 | synchronous persisted-query parse/hydrate | `components/providers.tsx` | **BLOCKING main-thread work; currently too early** |
| 10 | dashboard providers/chrome | dashboard layout | **BLOCKING** |
| 11 | show window/frontend-ready IPC | `root-providers.tsx` | **DEFERRED ~50ms** |
| 12 | native storage/import/sync/watcher chain | `spawn_background_startup_tasks` | **DEFERRED 250ms, potentially expensive** |
| 13 | token/profile sync, listeners, WebSocket | `DesktopRuntimeBridge` | **NON-BLOCKING ongoing** |
| 14 | 10-year computer backfill | `DesktopRuntimeBridge` | **DEFERRED ~20s, expensive/networked** |
| 15 | updater, Biome/location drains, project-time | Rust modules | **DEFERRED** |

```text
Tauri/plugins
  -> local shell
  -> remote bootstrap request
  -> hosted assets
  -> React providers + Clerk + cache restore
  -> useful UI

250ms branch -> DB/import -> sync -> watcher/watchdog -> memory/project-time
later branches -> updater, outbox drains, WebSocket, history backfill
```

The hosted UI is the dominant architectural dependency: an offline launch cannot reach the full product. The native code otherwise shows good intent by delaying work.

**UNNECESSARY AT STARTUP:** unconditional eight-route prefetch, AI provider/runtime mounting when the first route does not use AI, the 3,650-day activity backfill, updater work, project-time maintenance, and diagnostic/profiling fallbacks. Some are useful later; none should gate or contend with first useful interaction.

### 10.2 Berd launch to useful UI

| Order | Operation | File/function | Classification |
|---:|---|---|---|
| 1 | plugins, state, migration setup | `src-tauri/src/lib.rs::run` | **BLOCKING** |
| 2 | `block_on(LayoutState::new)` and `berd.sqlite` migration | same / layout commands | **BLOCKING native setup** |
| 3 | bundled Vite assets and startup view | `src/main.tsx` | **BLOCKING** |
| 4 | telemetry/focus setup and installation cohort | `main.tsx` | **BLOCKING before App mount** |
| 5 | show window and auth gate | `App.tsx` | **BLOCKING for normal shell** |
| 6 | `useAppStartup` | `AppShell.tsx` | **BLOCKING for useful authenticated shell** |
| 7 | hydrate queues and `await getClient()` | `chatRuntimeStartup.ts` | **BLOCKING for useful authenticated shell** |
| 8 | `get_goose_serve_url` -> spawn/wait for `goosed` | ACP commands/`goose_serve.rs` | **BLOCKING on runtime readiness, up to its timeout** |
| 9 | seed skills/agents, avatar refresh, artifact warm, managed ACP reconcile | background tasks | **DEFERRED** |

First-run onboarding can render before the main shell gate, but the authenticated application's normal useful shell waits for chat runtime startup. Berd is local and network-independent for its assets; Goose startup is still on the useful-startup path.

**UNNECESSARY AT STARTUP:** Goose readiness for non-chat home/project navigation, avatar refresh, artifact warming, and managed ACP-tool reconciliation. These should be capability- or intent-triggered even if their current implementation is backgrounded or placed behind the startup gate.

---

## 11. Performance evidence

### Measured

| Measurement | Result |
|---|---|
| Ritual desktop bootstrap shell build | success, **0.77s** |
| Ritual shell JS | **197.37 kB raw / 61.79 kB gzip** |
| Ritual full dashboard production build | failed after **25.06s** during type checking in the current dirty worktree |
| Berd SDK prerequisite build | success, **3.39s** |
| Berd Vite production build | success, **25.54s** end-to-end |
| Berd transformed modules | **14,423** |
| Berd `dist` | **36,675,304 bytes**, 597 files |
| Berd JS total | **19,644,544 raw bytes**, 562 files |
| Berd initial JS closure from `index.html` | **112 files, 6,375,159 raw / 1,788,054 gzip** |
| Berd initial CSS | **337,944 raw / 50,055 gzip** |

Berd's entry HTML emitted 111 module preloads. Its largest initial chunks included `BackgroundQueuedMessageDrain` at about 2.12 MB raw / 597 kB gzip and the main index chunk at about 1.74 MB raw / 480 kB gzip. Vite warned about chunks over 500 kB. The build ran with Node 20.17 even though the installed Vite version requested at least 20.19, and CSS optimization emitted warnings.

Ritual's dashboard build errors were in current uncommitted source (`use-chat-send-message.ts`, `routine-templates.tsx`, invalid `density` props, and an implicit `any`). The stale `.next` directory predates the audited source and was excluded, so no valid Ritual product-bundle comparison is reported. The small shell bundle is only the redirect/fallback shell.

### Static conclusions

- Ritual has a smaller known bootstrap shell but must download the product and resolve authentication before it is useful.
- Berd ships a large local bundle and blocks the normal useful shell on Goose readiness, but it does not need a hosted UI round trip.
- Ritual's broad provider tree, synchronous cache restore, eight route prefetches, and 22 explicit interval sites create avoidable startup/background work.
- Berd's 112-file initial closure and multi-megabyte queue/shell chunks are substantial parse/evaluation and memory risks.
- Ritual virtualizes chat and large habit-log surfaces; Berd also has deliberate timeline virtualization. Neither should be assumed globally jank-free.
- `DesktopRuntimeBridge`'s WebSocket uses reconnect, 25-second heartbeat, auth-token query parameters, and polling fallbacks. It needs one lifecycle owner and telemetry for bytes/wakeups.
- `packages/chat-runtime/src/turn-context.ts` keeps `promptFactsCache` in an unbounded module-level `Map` keyed by raw token. Entries expire logically but are not proactively removed, so a long-lived server can retain keys/tokens; use a bounded identity-safe cache and never use bearer tokens as raw cache keys.
- The native 250ms startup task defers work but then sequences several unrelated initializations in one future; tracing should establish which can be isolated/parallelized safely.

### Not measured

No authenticated interactive cold launch, warm launch, time-to-useful-UI median, CPU profile, memory/RSS sample, sidecar launch median, or UI frame trace was produced. Claims that either application is faster at runtime would be hypotheses. The correct next measurement is a signed-like local build with milestone instrumentation, five cold and five warm trials, process-tree CPU/RSS, and route-level React/Instruments traces.

---

## 12. Dead, obsolete, duplicate and ghost code

The unconfigured Knip pass reported 131 unused files, 78 unused dependencies and 384 unused exports. Those raw counts contain many false positives because Next routes, workspaces and dynamic registries are entry points. Only manually traced candidates are used below.

### Definitely dead: 3,388 code lines

| Candidate | Evidence | Code lines |
|---|---|---:|
| Kanban components, types, `useKanbanBoard`, `TodaysFocusWidget` | No live page/import mounts the feature; references are internal or prompt examples | 3,088 |
| `/widget` route | No current navigation/import/reference reaches it | 300 |

### Very likely dead: about 884 code lines

| Candidate | Evidence | Code lines | Verification before deletion |
|---|---|---:|---|
| `apps/dashboard/components/ui/sidebar.tsx` | No production import; app uses `components/sidebar.tsx` | 710 | Run configured entrypoint scan |
| `apps/chat-api/src` | Dashboard uses `/api/chat/stream`; only workspace/scripts/docs refer to service | 106 | Confirm no deployed external caller |
| desktop profiling bridge module | No `:3031` server implementation in repository; only wrapper/tests | 68 | Confirm no private profiling tool depends on it |

`lib/computerActivity/tauri-activity.ts` also hard-codes the profiling bridge, so deleting the whole transport may remove somewhat more than 68 lines after callers are migrated.

### Unused IPC exposure, not necessarily dead implementation

Ten registered Tauri command names have no production JavaScript call site: `write_turso_sync_config`, `open_input_monitoring_settings`, `get_watcher_extended_status`, `check_and_restart_watcher_if_hung`, `check_desktop_hosted_app_reachable`, `get_ritual_db_stats`, `text_search`, `check_migration_status`, `run_project_time_attribution_once`, and `run_project_time_retention_once`.

Several underlying functions are called internally by Rust (notably watcher/watchdog and project-time work). The safe deletion is unused IPC registration and permission surface, not automatic deletion of the implementation.

### Ghost or deceptive features

| Feature | Finding | Recommendation |
|---|---|---|
| AI retention toggle | `components/settings-frame.tsx` keeps it only in local React state | Hide until policy is persisted/enforced |
| Clear AI history | Handler only logs `Clear history clicked` | Hide or implement end-to-end erasure |
| Detached sidebar | Only enabled through `RITUAL_DETACHED_SIDEBAR=1`; extra window/IPC path | Product decision, then keep or delete |
| Profiling HTTP bridge | Configuration and client exist, server absent | Delete unless an external internal tool is documented |
| Trigger jobs | May be deployment entry points despite static-tool warnings | Verify production scheduler before consolidation |
| Memory cloud/Turbopuffer | Environment/docs residue and legacy sync suppression, no active TS/Python service | Remove stale config/docs; do not count as large code deletion |
| Workflow/approval routes | Some UI routes redirect into reports | Consolidate navigation; backend capability may still be real |
| iOS companion | Separate reachable product, not dead desktop code | Keep or split repository for ownership, not LOC optics |

### Definite broken behavior, not dead code

- `copy_png_to_clipboard` has a live frontend caller and no native command.
- the 32-command ACL mismatch can make live remote-origin IPC fail.
- current dashboard production build does not type-check.

### Estimate

| Category | Conservative LOC |
|---|---:|
| Definitely dead | 3,388 |
| Very likely dead | ~884 |
| Duplicated/redundant implementation | 2,000–4,000 |
| Removable architectural glue after consolidation | 2,000–5,000 |

After accounting for overlap, **about 4–7% (7.5k–12.5k lines)** of the strict 192,474-line production surface appears dead, obsolete, duplicated or avoidable without removing product capability. This is an estimate, not a Knip total.

No database table or historical migration met the “definitely dead” bar. ORM registration, administrative paths and migration history make absence of a frontend call insufficient evidence; old migrations should normally remain immutable even after a feature is removed. Likewise, no dependency is labeled safe to remove solely from the raw Knip output—feature deletion must be followed by a lockfile/import graph recheck.

---

## 13. Dependency, build and release audit

### Ritual

- 77 unique npm runtime dependencies and 51 unique Cargo dependency names are not abnormally high relative to Berd.
- The root manifest declares 66 runtime packages, all duplicated by the dashboard manifest; the dashboard adds eight. That is ownership/configuration debt even when installation is deduplicated.
- UI weight overlaps include Lucide plus MUI icons, Framer Motion, Recharts, `html2canvas`, Paper shaders, JSZip and several telemetry SDKs. Usage exists, so removal needs bundle evidence and feature decisions.
- Python's 22 production requirements are reasonable for FastAPI, SQLAlchemy/libSQL, models and provider integration. The libSQL compatibility monkeypatch is a sharper maintenance problem than dependency count.
- CI uses moving action tags/toolchains and `npm install` rather than frozen installation in places. Desktop release uploads versioned assets with `--clobber`, without Berd-like staged promotion/provenance.

High-leverage frontend dependency candidates are based on production import counts, not a claim that they are unused:

| Dependency/surface | Approximate production import sites | Decision |
|---|---:|---|
| `@mui/icons-material` alongside Lucide | 2 | Replace or generate a small icon map if bundle analysis confirms retained MUI weight |
| `framer-motion` | 7 | Keep where interaction value is real; lazy-load route-only motion |
| `recharts` | 8 | Route-split analytics charts and enforce a chart chunk budget |
| `html2canvas` | 1 | Dynamic import for share/export only |
| `@paper-design/shaders-react` | 1 | Dynamic import or remove if visual value is not product-critical |
| `jszip` | 4 | Dynamic import for import/export paths |
| Sentry/OpenPanel/Speed Insights | 16 / 2 / 1 approximate sites | Centralize initialization and prove each signal's owner |

Kanban deletion may remove some drag/drop use, but drag/drop packages also support reachable analytics sorting; do not remove them solely from the Kanban result.

### Berd

- 99 npm runtime dependencies, a large Cargo surface, many Radix packages, rich graphics/UI dependencies, syntax/diagram rendering, telemetry, voice/model support, ACP/Goose, and managed tooling explain the large bundle.
- Build/release pins Goose, verifies source/tag relationships, freezes lockfiles, pins GitHub Actions by SHA, stages artifacts, requires promotion/approval, re-downloads artifacts, and emits provenance attestations.
- Ritual should copy these **release invariants**, not Berd's dependency volume or managed Node/tool installation.

---

## 14. Architecture-tax scorecard

Scores use **10 = simplest/best**, not “most architecture tax.” Every score combines topology and implementation evidence; it is not a product-quality score.

| Category | Ritual | Berd | Explanation |
|---|---:|---:|---|
| Architectural simplicity | 3 | 6 | Ritual has more processes/services/stores; Berd still has a large UI, Goose boundary and managed tooling |
| Frontend simplicity | 5 | 3 | Ritual has provider/API sprawl but smaller files; Berd has ~200.7k frontend LOC and several 3–6k-line files |
| Native/Tauri simplicity | 5 | 4 | Ritual has fewer commands/sidecars; ACL is broken. Berd has 169 commands, three bins and managed runtimes |
| Backend simplicity | 4 | 8 | Ritual's server is mostly justified but broad; Berd has no app backend |
| Database simplicity | 3 | 6 | Ritual maintains local/cloud/analytics/search truth; Berd splits only Berd/Goose/local queue state |
| State-management simplicity | 4 | 4 | Query+contexts+caches+outboxes versus 19 Zustand stores+Query+files |
| Dependency simplicity | 5 | 3 | Ritual has fewer JS dependencies and a smaller known UI; Berd's bundle validates its dependency cost |
| Startup-path simplicity | 3 | 4 | Ritual requires hosted UI/Clerk; Berd is local but blocks useful shell on DB/cohort/Goose |
| Maintainability | 4 | 5 | Ritual crosses four languages and remote services; Berd has clearer runtime ownership but god files |
| Debuggability | 3 | 5 | Ritual failures cross many systems; Berd usually narrows to UI/ACP/Goose/provider |
| Testability | 5 | 8 | Ritual has useful tests; Berd has about 176k frontend test LOC and strong runtime/queue coverage |
| Developer onboarding | 3 | 5 | Ritual's config/service topology is hard; Berd setup is heavy but responsibility is more legible |
| Runtime efficiency | 4 | 4 | Unmeasured interactively: Ritual has network startup; Berd has a 6.38 MB initial JS closure and Goose sidecar |

---

## 15. Fifteen highest complexity hotspots

LOC values are conservative estimates of code that could disappear, not total code touched.

| # | Problem / exact modules | Why it exists | Berd equivalent | Current architecture cost | Performance impact | Maintenance impact | Removable LOC | Risk | Recommendation |
|---:|---|---|---|---|---|---|---:|---|---|
| 1 | No single AI turn owner: `packages/chat-runtime/src/chat-stream/*`, `stream-response.ts`, dashboard chat hooks, `conversation_queue_service.py` | Incremental web/SMS growth | One ACP/Goose runtime and root durable drain | Lost writes, stale turns, mutation races | Retry/replay and extra persistence work | Highest reasoning burden; failure semantics scattered | 500–1,500 net | **High** | **REPLACE** orchestration kernel; keep tools/contracts |
| 2 | Habit crosses cache/outbox/BFF/FastAPI/Turso/Tinybird/Typesense/WS: `use-habits-query.ts`, `local-first-writes.ts`, `habits_service.py`, secondary jobs | Real multi-device/domain requirement plus added projections | No equivalent domain; mostly local stores | Many consistency/failure edges | Network fan-out and repeated serialization/refetch | A field/change crosses languages and stores | 1,500–3,500 | **High** | **MERGE** projections; canonical event/record |
| 3 | Incomplete Tauri capability contract: `main.rs`, `capabilities/main.json`, `permissions/*.toml` | Hosted remote origin needs custom ACL | Bundled UI avoids Ritual's remote-origin seam | Live commands can be denied; security drift | Failed IPC/retry, otherwise little speed effect | Manual lists inevitably diverge | ~0 | **Medium** | **SIMPLIFY** with generated contract/test |
| 4 | Identity-unsafe query hydrate: `components/providers.tsx` | Cached-paint optimization preceded identity design | Versioned local stores, still complex | Stale/cross-user cache window | Synchronous parse/hydrate on startup | Identity and cache lifecycles are separate | ~0 | **Low** | **REPLACE** with per-user post-auth hydrate |
| 5 | Dual scheduling: backend `lifespan.py`/services and `apps/dashboard/src/trigger/*` | Successive deployment strategies | Goose has one scheduler owner | Duplicate/missed job risk and two configs | Duplicate wakeups/work if both active | Production ownership cannot be inferred easily | 800–2,000 | **Medium** | **MERGE** into one scheduler per job |
| 6 | Search/analytics proliferation: Turso SQL, Typesense, Tinybird, MiniSearch | Each solved a specific query over time | Mostly in-app/local search | Extra projections and consistency rules | Extra write I/O/network and cold services | Schema/freshness debugging across systems | 1,000–3,000 | **Medium** | **MERGE**; require unique SLO evidence |
| 7 | Desktop bridge sprawl: `desktop-bridge/*`, `tauri-utils.ts`, `desktop-runtime.ts`, `DesktopRuntimeBridge`, shell bridge | Bootstrap/runtime/profiling evolved separately | Tauri invoke plus ACP | Different errors, command lists and lifecycle owners | Polling/fallback traffic and extra branches | ACL/types/callers drift independently | 400–900 | **Medium** | **MERGE** into typed `NativeGateway` |
| 8 | Abandoned Kanban/widget: `components/kanban/*`, `useKanbanBoard.ts`, `TodaysFocusWidget`, `app/widget` | Superseded experiments | None | Dead product surface | Some build/chunk/index cost; likely little launch cost | Search/review/dependency noise | 3,388 | **Low** | **DELETE** |
| 9 | Duplicate chat service: `apps/chat-api` and dashboard `/api/chat/stream` | Earlier standalone deployment option | One ACP endpoint | Extra package/deploy/config | No current caller; operational resources only | Two possible hosts confuse ownership | 106 + config | **Low** after traffic check | **DELETE** |
| 10 | Activity read/sync fallbacks: `lib/computerActivity/*`, `DesktopRuntimeBridge`, watcher APIs, Rust sync | Supports web plus desktop-local views | Berd data stays local | Source ambiguity and sync consistency | Avoidable network/IPC/serialization | Failures require tracing native and cloud | 500–1,500 | **High** | **MOVE LOCAL** for desktop raw/recent reads |
| 11 | Backend/config breadth: `app_factory.py`, 34 router groups, ~188 runtime env keys | Real integrations plus residue | No app backend; fewer config classes | Many optional topologies | Conditional startup/services and connection cost | Onboarding/deploy mistakes, poor discoverability | 300–1,000 | **Medium** | **SIMPLIFY** into explicit deployment profiles |
| 12 | God hooks/clients: logs, reports, chat, `use-habits-query.ts` | Feature accumulation | Berd is worse, with 3–6k-line files | Mixed view/data/lifecycle ownership | Broad rerenders and possible large route chunks | Tests/reviews require large mental context | Little direct reduction | **Low** | **SIMPLIFY** boundaries; no gratuitous abstractions |
| 13 | Profiling HTTP bridge: `desktop-bridge/profiling-bridge.ts`, `computerActivity/tauri-activity.ts` | Development fallback | No equivalent | Second local transport with absent server | Dead-port attempts/fallback latency | Extra configuration and test matrix | 68–250 | **Low** | **DELETE** or document external owner |
| 14 | Deceptive/ghost UI: `settings-frame.tsx`, detached sidebar, redirect-only routes | UI preceded enforcement/product decision | Berd has feature sprawl too | Conditional code and user-trust debt | Small bundle/window/listener cost | Engineers cannot tell real from placeholder | 100–700 | **Low** | **DELETE**/hide until real |
| 15 | Mutable release/reproducibility gaps: desktop workflows/scripts | Fast early shipping | Pinned, staged, attested promotion | Supply-chain and rollback ambiguity | No runtime impact | Releases are harder to reproduce/debug | ~0 | **Medium** | **REPLACE** release invariants |

---

## 16. Simplified target architecture

```text
                       +----------------------+
Web / desktop / iOS -->| Hosted Next + Clerk  |
                       +----------+-----------+
                                  |
                         one typed BFF boundary
                                  |
                       +----------v-----------+
SMS / provider hooks -->| FastAPI domain core  |
                       | one scheduler         |
                       | one turn coordinator  |
                       +-----+-----------+-----+
                             |           |
                        central Turso   optional analytics projection

Desktop Tauri
  -> one typed native gateway
  -> watcher/vision -> activity.db
  -> vault.db
  -> optional, observable activity sync
  -> local desktop reads stay local

AssistantKernel
  -> durable turns/receipts
  -> stable DomainToolGateway
  -> model adapter today
  -> optional ACP/Goose adapter later
```

### Keep

Hosted Next deployability, Clerk, one FastAPI domain service, central Turso, watcher/vision, local activity database, privacy vault, iOS/SMS/provider ingress, and domain-specific AI tools.

### Delete

Confirmed Kanban/widget code, unused sidebar primitive after verification, `apps/chat-api` after deployment verification, profiling transport after internal-tool verification, unused IPC exposure, stale memory-cloud configuration, and nonfunctional settings controls.

### Consolidate

Chat/turn ownership, schedulers, desktop IPC wrappers, search/index projections, schema/event contracts, cache ownership, telemetry initialization, and activity read selection.

### Do not do

- Do not replace FastAPI/Turso with Goose; Goose does not solve Ritual's shared domain system.
- Do not port every backend route into Rust. It would trade network topology for cross-platform native complexity.
- Do not count moving the iOS app to another repository as product simplification.
- Do not copy Berd's 19-store frontend, 5k-line shell, broad filesystem opener, managed Node runtime, or startup coupling.

---

## 17. Simplification opportunity

| Measure | Conservative result |
|---|---:|
| Strict production LOC today, excluding iOS | 192,474 |
| Definitely dead | 3,388 |
| Very likely dead | ~884 |
| Duplicate/redundant | 2,000–4,000 |
| Removable architecture after consolidation | 2,000–5,000 |
| Overlap allowance | required; categories are not additive at their maxima |
| **Estimated simplified production LOC** | **180,000–185,000** |
| **Potential production-code reduction** | **about 4–7%** |

The lower bound corresponds to deleting only confirmed/probable code and small duplicated glue. The upper opportunity assumes scheduler, IPC, search/projection and AI orchestration consolidation succeeds without removing features. Moving the 12,801-line iOS client to another repository would reduce repository size, not product architecture, and is intentionally excluded.

The largest benefit is not the LOC percentage. It is reducing a habit/chat/activity failure from five or six possible owners to two or three.

---

## 18. Maintainability and reasoning burden

| Question for a new engineer | Ritual | Berd |
|---|---|---|
| Where does application state live? | Query, contexts, component state, browser caches, local DB/outboxes, server | Mostly Zustand/Query/files, then Goose |
| Where does user data live? | Central Turso, per-user Turso, three local DBs, Tinybird, Typesense, browser/file caches | Berd sqlite/files and Goose-owned state |
| How does data reach UI? | BFF/FastAPI, direct local Tauri path, WebSocket, cache/refetch | Tauri invoke or ACP notification |
| What runs at launch? | Native setup, redirect, hosted/auth/providers, several deferred workers | Native layout setup, local bundle/auth, chat startup/Goose, deferred assets/tools |
| Who owns a feature? | Often split by channel/process | Usually one store/feature plus Goose runtime |
| Add a domain DB field? | SQLAlchemy/Alembic, Pydantic, TS, projections; possibly Rust/Swift | Berd migration/type or Goose boundary |
| Debug failed user action? | Browser, BFF, FastAPI, DB, secondary jobs, WebSocket/local outbox | UI/store, ACP, Goose, provider |

Berd is easier to understand at the process-topology level. Ritual's smaller frontend files are easier to review locally. Ritual's highest reasoning-burden features are habits, chat, computer activity and privacy sync because each has multiple persistence and transport modes.

---

## 19. Where Ritual is better

- Ritual has a smaller production codebase and frontend.
- Its roughly 800-line repository check is a better maintainability guard than Berd's multi-thousand-line components/controllers.
- Watcher self-healing is more explicit than Berd's post-start Goose child recovery.
- Route-based Next splitting and a tiny bootstrap shell avoid shipping Berd's measured 6.38 MB raw initial JS closure; the cost is network startup instead.
- The hosted deploy seam lets Ritual update product UI without a desktop notarization/release.
- Privacy modes, vault, multi-device domain semantics and action receipts solve requirements Berd does not have.
- Ritual's intended filesystem capability scope is narrower than Berd's broad `$HOME/**` opener.
- Existing domain idempotency fields and optimistic/offline work are valuable foundations for a durable assistant kernel.

### Berd complexity Ritual should avoid

- 169-command native API and three sidecars;
- large initial frontend closure and 3–6k-line frontend files;
- 19 store definitions;
- managed Node/ACP-tool installation;
- broad filesystem opener scopes;
- feature-dependent permission handling that can fall back to selecting the first option;
- blocking normal useful startup on Goose readiness;
- importing an agent platform when Ritual needs a constrained domain assistant.

---

## 20. Final verdict

| Question | Answer |
|---|---|
| Which app has the simpler architecture? | **Berd**, because it has fewer remote layers and no application server |
| Easier codebase to understand? | **Berd's topology; Ritual's individual frontend files** |
| Fewer architectural layers? | **Berd** |
| Cleaner frontend? | **Ritual**, narrowly; provider/state sprawl remains, but Berd is far larger and has god files |
| Cleaner native/Tauri layer? | **Ritual by size; Berd by sidecar/release discipline. Overall a tie** |
| Cleaner persistence? | **Berd**, because it has fewer canonical stores; Goose ownership still must be understood |
| Easier to maintain? | **Berd for agent-only features; Ritual can become comparable for domain features after ownership consolidation** |
| More performant architecturally? | **No proven winner.** Ritual pays network/auth startup; Berd pays a huge local bundle and sidecar startup |
| Faster/simpler startup? | **Berd is network-simpler; neither path is simple and no interactive timing was measured** |
| How much Ritual complexity is inherent? | Roughly **three quarters to four fifths**: multi-client, sync, integrations, privacy/activity and shared domain truth |
| How much is self-inflicted? | Roughly **one fifth to one quarter** of reasoning burden, though only 4–7% of LOC is conservatively removable |

**Over-engineering classification: moderately over-engineered.**

Ritual has not become absurdly overbuilt: the product genuinely needs more than Berd. It has, however, accumulated duplicate control planes and ambiguous ownership at precisely the seams where correctness and startup behavior matter. Its simplification should be a consolidation program, not a rewrite program.

### First ten architecture changes

1. Define and implement one durable `AssistantKernel` turn contract; migrate current chat behind it without deleting domain tools.
2. Generate/test the Tauri command-to-capability contract and fix the missing `copy_png_to_clipboard` decision.
3. Move persisted React Query restore after Clerk identity and key/cache-encrypt it per user.
4. Delete confirmed Kanban/widget code and hide the fake AI retention/history controls.
5. Retire `apps/chat-api` after checking deployment traffic; keep one stream endpoint.
6. Assign every recurring server job to exactly one scheduler and remove the other implementation/configuration.
7. Merge desktop IPC clients and remove the profiling HTTP fallback unless an external owner is documented.
8. Make desktop computer-activity reads local by default and narrow cloud sync to multi-device/product-required projections.
9. Prove the need for Typesense/Tinybird projections with latency/product SLOs; remove unearned duplicate indexes.
10. Adopt immutable, pinned, attestable release inputs/artifacts and add reproducible full-workspace build gates.

The implementation sequence, risks and expected benefits are in [`RITUAL_SIMPLIFICATION_PLAN.md`](./RITUAL_SIMPLIFICATION_PLAN.md).

---

## Appendix A: validation log

| Check | Result |
|---|---|
| Berd clone/fetch/status | clean at recorded SHA |
| Berd dependency install/build | completed; build metrics above |
| Ritual desktop shell build | passed |
| Ritual dashboard build | failed at current-source typecheck after 25.06s |
| Ritual dashboard tests | 177 passed during audit |
| `packages/chat-runtime` tests | 22 passed during audit |
| Ritual root Tauri `cargo check --locked` | passed during audit |
| Ritual `repo:check` | failed current dirty source: `aggregate-local-first.ts` calls `isDesktopRuntime()` outside allowlist |
| Backend pytest | not run; pytest was not installed in the available environment |
| Knip | run only as candidate generator; raw findings not trusted |

## Appendix B: measurements that should precede performance claims

1. Make the current dashboard production build green and save a bundle analyzer artifact.
2. Add milestones for process start, Tauri setup done, shell loaded, remote navigation, React mount, auth ready, cache ready, route useful, watcher ready and assistant ready.
3. Run five cold and five warm launches on the same Mac/network/account; report medians and p95 where useful.
4. Record process-tree CPU/RSS, WKWebView memory, transferred bytes, JS parse/evaluation, long tasks and interval wakeups.
5. Kill watcher/Goose/network mid-turn to test recovery rather than timing only the happy path.
6. Profile representative logs, reports, chat and activity routes with production-sized data.
