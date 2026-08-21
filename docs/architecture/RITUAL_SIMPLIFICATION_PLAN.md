# Ritual simplification plan

**Source audit:** [`RITUAL_VS_BERD_ARCHITECTURE_AUDIT.md`](./RITUAL_VS_BERD_ARCHITECTURE_AUDIT.md)  
**Scope:** proposed work only; this plan does not implement application changes.  
**Baseline:** 192,474 strict authored production code lines excluding the separate iOS companion.

## Decision

Simplify Ritual by **deleting abandoned surfaces and consolidating ownership**, not by replacing the whole product with Berd or Goose.

For AI, use a strangler migration:

- retain the current chat UI while its controller is replaced;
- retain `packages/chat-runtime` domain tools/executors until each has contract tests and a migrated implementation;
- add one durable assistant turn kernel behind the existing streaming interface;
- migrate channels and tools incrementally;
- delete legacy orchestration only after parity, replay and failure tests pass;
- evaluate ACP/Goose later as an optional engine adapter, not as Ritual's domain backend.

## Outcomes

The target is not the fewest possible files. It is:

1. one owner for each turn, scheduled job, cache, projection and native command;
2. one obvious path from each client to domain truth;
3. local desktop reads for local desktop data;
4. no user-facing control without persisted/enforced behavior;
5. a launch path whose milestones and cost are measured;
6. reproducible builds and immutable releases;
7. approximately **7.5k–12.5k fewer production lines** after consolidation, a conservative **4–7% reduction**.

## Current problems

| Priority | Problem | Main modules | User/engineering effect |
|---:|---|---|---|
| P0 | Assistant turns have no single durable owner | `packages/chat-runtime/src/chat-stream/*`, `stream-response.ts`, dashboard chat hooks, `conversation_queue_service.py` | Lost persistence, races, ambiguous retries |
| P0 | Tauri commands and capabilities disagree | `apps/desktop/src-tauri/src/main.rs`, `capabilities/main.json`, `permissions/*.toml` | Live IPC can be denied; permission drift |
| P0 | Persisted Query cache is restored before identity | `apps/dashboard/components/providers.tsx` | Cross-user stale state and sync main-thread work |
| P0 | Current dashboard production build fails | current chat/routine UI changes | No trustworthy product bundle or ship gate |
| P1 | Dead and ghost product surfaces remain | Kanban, `/widget`, duplicate sidebar, fake AI settings | Review/bundle/product-trust cost |
| P1 | Two chat hosts exist | dashboard stream route, `apps/chat-api` | Deployment/config duplication |
| P1 | Desktop access uses several wrappers/transports | `desktop-bridge/*`, `tauri-utils.ts`, `desktop-runtime.ts`, runtime bridge | Different errors, ACL mismatch, polling |
| P1 | Scheduling ownership is configuration-dependent | FastAPI lifespan/services, `src/trigger/*` | Possible duplicate or missed work |
| P1 | Search/analytics truth is projected several ways | Turso, Typesense, Tinybird, MiniSearch | Extra writes, drift and services |
| P1 | Computer activity has local and remote read fallbacks | `lib/computerActivity/*`, watcher APIs, Rust sync | Extra network/serialization and debugging paths |
| P2 | Startup is network-bound and background work is broad | shell redirect, providers, runtime bridge, Rust startup chain | Slow/offline-unusable startup; wakeups |
| P2 | Release inputs/assets are not fully immutable | CI/release workflows and scripts | Reproducibility and supply-chain risk |

## Proposed architecture

```text
Clients
  web / desktop / iOS / SMS
           |
           v
Hosted Next + Clerk
  - presentation and one typed BFF boundary
           |
           v
FastAPI domain core
  - one scheduler
  - one durable assistant turn coordinator
  - domain services and provider webhooks
           |
           +--> central Turso (canonical shared domain data)
           +--> one justified analytics/search projection

Desktop Tauri
  - one typed NativeGateway
  - watcher/vision -> activity.db
  - vault.db
  - optional, observable cloud sync
  - local activity reads remain local

AssistantKernel
  - durable turn/event log
  - per-session queue and cancellation epoch
  - commit/receipt barrier
  - explicit tool capability and side-effect metadata
  - one model-engine adapter
  - optional ACP adapter later
```

### Ownership rules

| Concern | Owner |
|---|---|
| Shared habits/tasks/entities/conversations | FastAPI + central Turso |
| Desktop raw activity | local `activity.db` |
| Private/local-only records | local vault |
| Multi-device activity subset | explicit sync projection, never a competing local truth |
| Assistant turn lifecycle | `AssistantKernel` durable store/state machine |
| Domain mutations | `DomainToolGateway` with stable idempotency keys/receipts |
| Recurring server jobs | one documented scheduler |
| Native calls/events | one generated/typed `NativeGateway` |
| Server cache | React Query, keyed and restored after user identity |
| UI-only preferences | local browser/app-data state unless multi-device sync is a stated feature |
| Analytics/search projections | opt-in consumers of canonical events; never required to commit a core mutation |

## What to delete

### Confirmed safe-deletion candidates

| Item | Modules | Estimated code lines | Gate |
|---|---|---:|---|
| Kanban feature and its hook/types/widget | `apps/dashboard/components/kanban/*`, `hooks/useKanbanBoard.ts`, `TodaysFocusWidget` | 3,088 | One final configured reachability scan and dashboard tests |
| Unlinked timer widget route | `apps/dashboard/app/widget/*` | 300 | Confirm no external deep-link/product promise |
| **Confirmed subtotal** | | **3,388** | |

### Delete after a short ownership check

| Item | Modules | Estimated code lines | Required evidence |
|---|---|---:|---|
| Duplicate UI sidebar primitive | `apps/dashboard/components/ui/sidebar.tsx` | 710 | No runtime/dynamic imports; visual smoke test |
| Duplicate chat service | `apps/chat-api/src`, package/deploy config | 106 source plus config | Deployment logs and DNS/client search show zero callers |
| Profiling HTTP bridge | `lib/desktop-bridge/profiling-bridge.ts`, relevant `tauri-activity.ts` fallback/tests | 68–250 | Nick/internal tooling confirms no external `:3031` server |
| Unused Tauri IPC registrations | ten command exposures listed in audit | small | Preserve internally called Rust functions; remove registration only |
| Nonfunctional AI retention/history controls | `components/settings-frame.tsx` | small | Product chooses hide rather than immediate implementation |
| Stale memory-cloud/Turbopuffer config/docs | env examples and deployment docs | config only | Confirm no secret/deployment consumer |

Expected deletion after these gates: about **4.3k production lines**, before broader consolidation.

## What to consolidate

### 1. Assistant execution

Consolidate:

- `packages/chat-runtime/src/chat-stream/*` turn orchestration;
- `stream-response.ts` completion semantics;
- `chat-client.impl.tsx` component-owned queue drain;
- `use-chat-conversation-actions.ts` conversation switching/replay;
- backend conversation queue claims;
- duplicated SMS tool-loop logic in `packages/chat-runtime/src/sms.ts`.

Preserve:

- tool input/output schemas;
- domain executors and authenticated backend contracts;
- action receipts/idempotency fields;
- current streaming UI event compatibility during migration;
- conversation history and SMS behavior.

New invariants:

1. A turn has a monotonic ID and explicit `queued -> running -> committing -> completed|failed|canceled` states.
2. Completion is emitted only after assistant content and mutation receipts are durable.
3. A retry reuses the same idempotency key.
4. Mutating tools execute in declared order; only tools marked read-only may run concurrently.
5. One session has at most one active mutation sequence.
6. Conversation switches increment an epoch; stale events cannot update the new conversation.
7. Reconnect/replay replaces provisional output by event ID.
8. Permission uncertainty fails closed.

### 2. Native gateway

Create one typed source of truth for:

- registered Rust commands;
- allowed hosted origins/capabilities;
- TypeScript command names, inputs and outputs;
- native events and lifecycle status;
- error classification and retry rules.

Migrate callers from `desktop-bridge/commands.ts`, `tauri-utils.ts`, `desktop-runtime.ts`, `DesktopRuntimeBridge` helper calls and the desktop shell bridge. Keep the shell bootstrap interface separate only if it must run before the full dashboard client loads.

### 3. Scheduler ownership

Build a table from every loop/job in:

- `apps/backend/lifespan.py` and called services;
- `apps/dashboard/src/trigger/*`;
- client intervals that actually initiate server work.

For each job record owner, production enablement, lease/idempotency key, cadence, timeout, retry and alert. Select one server scheduler per job. Do not run the same job in FastAPI and Trigger.dev as redundancy.

### 4. Search and analytics projections

For each Typesense collection and Tinybird datasource/pipe record:

- user-visible query/caller;
- latency/scale requirement SQL cannot meet;
- freshness SLO;
- source event and rebuild procedure;
- behavior when the projection is unavailable.

Delete a projection if it has no unique query or measured requirement. Core writes must commit without projection availability.

### 5. Computer activity

On desktop, make `activity.db` the explicit read source for raw/recent activity. Sync only data needed for multi-device, AI server tools or shared reports. Replace hidden fallback selection with an observable `local | synced | unavailable` source result.

## Implementation order

### Phase 0 — Safe deletion and a trustworthy baseline

**Goal:** remove confirmed baggage without changing architecture, and make later measurements valid.

| Order | Action | Modules | Expected result |
|---:|---|---|---|
| 0.1 | Make the current production build/typecheck green; preserve unrelated dirty work | current chat/routine files reported in audit | Valid baseline artifact; no intended LOC reduction |
| 0.2 | Add a configured entrypoint/dependency scan to CI | root scripts/config, workspace manifests | Dead-code evidence becomes repeatable |
| 0.3 | Delete confirmed Kanban and `/widget` code | modules above | **3,388 LOC removed** |
| 0.4 | Validate then delete unused sidebar, chat-api and profiling bridge | modules above | Up to **~884 additional LOC** plus deploy/config removal |
| 0.5 | Hide/remove nonfunctional settings and stale config | `settings-frame.tsx`, env/docs | No deceptive UI/config |
| 0.6 | Remove unused IPC registrations, not internally used implementations | `main.rs`, capabilities/permissions | Smaller attack/debug surface |

**Performance expectation:** small compile/index/bundle wins; likely little initial-render change because some dead routes were already split. Measure rather than promise milliseconds.

**Exit gate:** dashboard build/test, chat-runtime tests, Tauri check, route smoke tests, package graph check, and a clean deployment inventory.

### Phase 1 — Low-risk correctness and ownership

**Goal:** close current contract holes before changing runtime topology.

| Order | Action | Modules | Acceptance criterion |
|---:|---|---|---|
| 1.1 | Generate/test command registration vs capability vs TS client | desktop Rust/capabilities/dashboard gateway | Every live command is allowed and typed; unknown command test fails CI |
| 1.2 | Decide and fix/remove `copy_png_to_clipboard` | `useMetricsShare.ts` and native gateway | Share action has a tested supported path |
| 1.3 | Restore React Query only after Clerk user resolution and use a user/version key | `components/providers.tsx`, root providers | Switching users cannot expose stale cached data |
| 1.4 | Add turn lifecycle, replay, cancellation and mutation-order contract tests around current behavior | chat runtime/dashboard/backend tests | Tests fail for known fire-and-forget/race cases |
| 1.5 | Add launch milestones and process-tree telemetry | desktop startup, shell, dashboard providers/runtime bridge | Cold/warm launch can be reported as medians |
| 1.6 | Pin release actions/toolchains and stop mutable versioned asset replacement | workflows/release scripts | Rebuild inputs and release artifacts are immutable |

**Expected LOC:** roughly neutral to **500 lines removed**; this phase intentionally adds tests/measurement.  
**Expected performance:** identity-aware cache restore removes unnecessary parse/hydrate work for signed-out or switched users; exact gain requires the new milestones.

### Phase 2 — Architectural consolidation

**Goal:** remove duplicate control planes while keeping user-visible behavior.

#### 2A. AssistantKernel strangler

1. Define turn/event/tool contracts in a small existing shared package rather than a new service.
2. Wrap current model execution and domain executors as adapters.
3. Add a durable server-side turn/receipt record for web/SMS and a local durable outbox where desktop offline submission is required.
4. Shadow **read-only event interpretation**, never mutation execution, against production-like transcripts.
5. Migrate web chat reads, then web mutations, then queue auto-run, then SMS/proactive channels.
6. Make persistence/receipt commit part of completion.
7. Remove legacy stream callbacks, component-owned drain and duplicated SMS loop only after replay/retry parity.

Do not dual-run mutations. Compare planned tool calls and event streams, then execute through only one owner.

#### 2B. Other consolidation

- retire `apps/chat-api` if Phase 0 traffic verification passed;
- assign all recurring jobs to one scheduler;
- replace desktop wrapper sprawl with the typed gateway;
- remove unneeded Typesense/Tinybird projections;
- define versioned canonical domain events/schemas for remaining projections.

**Expected net LOC reduction:** **2.0k–5.0k**, after accounting for the new kernel/contracts.  
**Expected performance:** fewer duplicate network calls and polls; lower reconnect/replay work; no projection waits on core mutations. Exact values depend on instrumentation.

**Exit gate:** failure-injection tests for disconnect, retry, process death, duplicate delivery, out-of-order completion, conversation switch and provider timeout; no lost/duplicated domain mutation in a staged transcript corpus.

### Phase 3 — Local-first opportunities

**Goal:** remove remote hops only where desktop ownership is unambiguous.

| Action | Modules | Keep remote | Risk |
|---|---|---|---|
| Read raw/recent computer activity directly from local DB | `lib/computerActivity/*`, Rust activity commands | synced summaries for web/iOS/server AI | Source divergence |
| Keep UI-only preferences local | preference context/storage and backend preference route | explicitly selected cross-device preferences | UX drift between devices |
| Keep location/Biome capture and queues local | native drains and local DB | geocoding/shared normalized records | Offline queue migration |
| Parse/compress import and screenshots locally where safe | import/screenshot clients, watcher/vision | provider secrets and canonical shared ingest | Native bundle/security cost |
| Make activity cloud sync opt-in by capability/purpose | Rust sync/config/backend reads | product-required multi-device/report data | Privacy and feature expectations |

Do **not** move OAuth callbacks, SMS/provider webhooks, account deletion, shared domain truth or server-held model credentials into the desktop app.

**Expected net LOC reduction:** **500–1,500**; the primary benefit is fewer request/fallback paths.  
**Expected performance:** local activity screens should remove one network round trip and remain useful offline. Benchmark p50/p95 screen readiness before and after.

### Phase 4 — Performance architecture

**Goal:** use the Phase 1 baseline to remove proven launch/runtime cost.

1. Keep the local shell instant, but cache a versioned last-known product shell or evaluate a bundled critical shell if offline usefulness is a product requirement.
2. Defer AI provider/runtime mounting until chat or an assistant surface is requested; do not repeat Berd's blocking Goose startup.
3. Replace unconditional eight-route prefetch with intent/idle/network-aware prefetch.
4. Split `DesktopRuntimeBridge` into lifecycle owners for auth/config, native events and realtime sync; start each only when its capability is active.
5. Replace intervals with event-driven invalidation where an event already exists; centralize remaining timers and suspend them when hidden/offline.
6. Parallelize independent native startup work only after database/order constraints are expressed and failure isolation is tested.
7. Add bundle budgets per route and initial closure. Remove or dynamically load MUI icons, charts, capture, shader and archive libraries based on analyzer evidence.
8. Profile the top 20 frontend files with production-sized data before refactoring; file size alone is not a runtime profile.
9. Add WKWebView/process RSS monitoring and orphan-sidecar tests.
10. Instrument request fan-out and serialized bytes for habit, chat and activity actions.

**Expected LOC:** roughly neutral to **1,000 lines removed**.  
**Expected performance:** directional only until baseline exists—less startup JS/provider work, fewer background wakeups and network requests, faster local activity readiness, and better memory diagnostics. No launch-time percentage is promised without five-trial measurements.

## AI migration decision gates

Before considering Goose or another ACP runtime, answer:

| Question | If yes | If no |
|---|---|---|
| Does Ritual need general filesystem/shell/MCP agency? | Prototype an ACP adapter in isolation | Keep constrained model/domain engine |
| Must tool execution work fully offline? | Evaluate local runtime/provider and local tool subset | Keep server coordinator |
| Can Goose express Ritual receipts, policy and multi-channel queues without forks? | Adapter may reduce model-loop code | Do not make Goose the kernel |
| Does the prototype remove more code/owners than it adds? | Continue behind feature flag | Stop; retain internal adapter |
| Can startup remain independent of engine readiness? | Eligible for staged rollout | Reject architecture |

A successful prototype must not require moving domain truth out of FastAPI/Turso, exposing broad filesystem permissions, downloading a managed Node runtime at normal startup, or duplicating mutations between runtimes.

## Risks and mitigations

| Risk | Where | Mitigation |
|---|---|---|
| Lost or duplicated mutations | Assistant/scheduler/outbox migration | Stable idempotency keys, fenced leases, replay corpus, failure injection |
| Conversation-history incompatibility | AssistantKernel migration | Versioned event adapter and reversible read path |
| Multi-device regression | Local-first changes | Keep canonical shared records remote; migrate one read surface at a time |
| Privacy leakage | Query cache/activity sync | Per-user cache keys, erasure tests, explicit sync purpose and retention |
| Hidden production caller | chat-api/profiling/Trigger deletion | Deployment logs, DNS/config search, owner sign-off and rollback window |
| Tauri remote-origin lockout | ACL generation | Contract test plus signed-build smoke test against production origin |
| Projection freshness regression | Typesense/Tinybird removal | Query inventory, SLO comparison, rebuild/fallback plan |
| Startup regression | provider/native refactor | milestone budgets and cold/warm medians in CI/release candidate testing |
| Large rewrite never reaches parity | AI work | Strangler slices, no big-bang branch, delete old path after each slice |
| More abstractions instead of less | all phases | Every new type/module must replace an owner or encode an enforced invariant |

## LOC and performance forecast

| Stage | Cumulative production LOC reduction | Performance expectation |
|---|---:|---|
| Phase 0 | 3.4k confirmed; up to ~4.3k after checks | Small build/index/bundle improvement |
| Phase 1 | roughly unchanged to +tests / small production reduction | Safer cache/startup; measurable baseline |
| Phase 2 | about 6.0k–10.0k cumulative | Fewer polls, duplicate calls and replay/persistence work |
| Phase 3 | about 6.5k–11.5k cumulative | Local activity avoids network path; better offline behavior |
| Phase 4 | **about 7.5k–12.5k cumulative** | Less eager JS/provider work and fewer wakeups; exact gains measured |

Final expected production surface: **approximately 180k–185k lines**, excluding iOS. The range accounts for overlap and new contract code.

## Definition of done

The simplification program is complete when:

- the production build is reproducible and green;
- every Tauri command has one typed declaration and explicit capability decision;
- persisted browser data cannot cross user identity;
- every assistant turn has one durable state/receipt history;
- only read-only tools execute concurrently;
- every recurring server job has one owner;
- no deployed client calls `apps/chat-api` or the profiling bridge;
- desktop activity screens use an explicit local source and work offline;
- each remaining search/analytics projection has a documented unique need and rebuild path;
- cold/warm launch, route readiness, CPU/RSS and background wakeups have baselines and budgets;
- strict authored production LOC is remeasured with the audit exclusions;
- legacy orchestration is deleted only after staged parity and failure tests pass.
