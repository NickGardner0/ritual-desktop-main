# Ritual simplification — architecture before/after

**Date:** 2026-08-21  
**Worktree:** `/Users/nickgardner/Desktop/ritual-release-0.1.1-prep` on `codex/release-0.1.1-prep`.  
**Sources:** [`RITUAL_SIMPLIFICATION_PLAN.md`](./RITUAL_SIMPLIFICATION_PLAN.md), [`RITUAL_VS_BERD_ARCHITECTURE_AUDIT.md`](./RITUAL_VS_BERD_ARCHITECTURE_AUDIT.md), [`RITUAL_SIMPLIFICATION_RESULTS.md`](./RITUAL_SIMPLIFICATION_RESULTS.md).

This is the before/after architecture report. The ledger in the results file is the pass log; this document is the ownership map.

## Before

```text
Chat turn
  dashboard sendMessage
    -> Next /api/chat/stream
    -> packages/chat-runtime stream callbacks
    -> optional conversation_queue claim/drain in the chat component
    -> SMS copy of the tool loop
  Completion could close before persist. No durable turn row.
  Mutating tools could race. Conversation switch had no epoch.

Desktop IPC
  desktop-bridge/* + tauri-utils + deleted desktop-runtime.ts + DesktopRuntimeBridge
  + shell bootstrap + (removed) profiling bridge
  Command names were strings; ACL check existed after Phase 1.1.

Jobs / search
  FastAPI loops only
  SQL search + Tinybird analytics + MiniSearch habit picker
```

## After

```text
Clients
  web / desktop / iOS / SMS
        |
        v
Hosted Next + Clerk
  NativeGateway (generated command + capability + TS input/output triad)
  DesktopRuntimeBridge lifecycle owners (auth / native events / legacy signals / realtime / backfill)
  local assistant-turn outbox (desktop offline)
        |
        v
packages/chat-runtime AssistantKernel.runTurn
  queued -> running -> committing -> completed | failed_retryable | canceled
  serial mutating tools; parallel read-only
  epoch cancel; abort -> canceled; in-flight duplicate 409; stale running reclaim
        |
        +--> model-engine/OpenAI adapter (provider request + event decoding only)
        |
        v
FastAPI
  assistant_turns durable store
  domain services, one scheduler registry/occurrence fence (scheduler_service.py)
        |
        +--> Turso (canonical shared domain)
        +--> Tinybird (analytics projection only)
        +--> MiniSearch (in-modal habit picker only)

Desktop
  activity.db for recent local reads
  biome/location capture queues stay on device
  cloud activity/habit backfill requires plaintext_sync
```

## Ownership after this pass

| Concern | Owner |
|---|---|
| Assistant turn lifecycle | `AssistantKernel.runTurn` + `assistant_turns` + desktop outbox |
| Model/provider access | `model-engine/openai-adapter.ts`; statically forbidden from persistence, queues, tools, and lifecycle completion |
| Domain mutations | existing executors, serial when mutating, idempotency key `turnId:toolCallId` |
| FastAPI JSON from dashboard/Next | generated client (`apiOperationWithAuth` / `apiOperation` / `createServerBackendClient`) |
| User prompt queue (chips/workflows) | `conversation_queue_items`; execution goes through `sendMessage({ turnId: queue:<id> })` |
| Native commands | generated triad: name + capability + TS input/output; `invokeDesktopCommand` |
| Recurring jobs | FastAPI loops only — see `SCHEDULER_JOBS.md` |
| Analytics projection | Tinybird — see `TINYBIRD_PROJECTIONS.md` |
| Recent desktop activity | `activity.db` (`local \| synced \| unavailable`) |
| Cross-device UI prefs | FastAPI `ui_preferences` (kept on purpose) |

## Definition of done vs evidence

| Plan criterion | Evidence |
|---|---|
| Production build reproducible and green | `npm run typecheck` is green. `next build --webpack` compiles; local prerender still needs Clerk publishableKey. CI/Vercel supply that key. |
| Every Tauri command typed + capability | ACL 70/70. Generated `NativeCommandName` + `NATIVE_COMMAND_CAPABILITIES` + `NativeCommandInputs`/`Outputs` from Rust signatures; one uncompiled signature remains classified outside the gateway. |
| Persisted browser data cannot cross identity | React Query persist key is `ritual:react-query-cache:v1:<userId>` and restore rejects identity mismatch. |
| One durable turn/receipt history | FastAPI `assistant_turns` + kernel commit after persist. Receipts stored on the turn. |
| Only read-only tools concurrent | `planToolBatch` / `executeDeclaredToolCalls`; unknown tools fail closed as mutating. |
| One scheduler owner | FastAPI registry has 13 jobs; maintenance no longer gates startup. Eleven clock jobs use durable occurrence claims, two queue jobs use atomic domain row claims, and authenticated health exposes startup/attempt/success/duration/error/lease state. Trigger.dev **code** is deleted; cloud disable remains external. |
| No chat-api / profiling callers | Deleted. Stale `package-lock.json` `apps/chat-api` workspace entry removed. |
| Desktop activity explicit local source | Recent desktop reads `activity.db` with observable `local \| synced \| unavailable`. Long-range/web still `synced`. |
| Remaining projections documented | Tinybird inventory. Typesense deleted. MiniSearch stays for the in-modal picker. Dashboard Tinybird reads go through FastAPI. Signed-in FastAPI JSON reads/writes use the generated client. Raw desktop activity events read `activity.db` only. The catch-all is JSON-only and operation/method bounded; import preview, screenshot preview, and Apple export use fixed adapters; habit-log edit uses the generated revision-checked PATCH. Next-owned chat/voice/calendar/OAuth/workflow/email routes remain for their declared boundaries. |
| Launch/route/CPU/RSS budgets | Legacy five-trial cold/warm debug fixtures exercise parser budgets in `repo:check`. Watcher lifecycle code now samples only after heartbeat readiness and encodes disabled RSS as null/not-applicable. Signed live release evidence is explicitly incomplete. |
| LOC remeasured | Canonical implementation total 190,894 via `npm run audit:loc` after the additive durable-chat, watcher-lifecycle, explicit-route, model-engine, scheduler, channel-auth, and desktop release-correctness boundaries (starting ship baseline 187,086); historical 192,474, ~192.6k, and dirty-tree 183.97k claims are reconciled in `LOC_BASELINE.md`. Next BFF is 19/39 because three named non-JSON adapters replaced generic ownership. |
| Legacy orchestration deleted after parity | Web, SMS, proactive SMS, scheduled workflow synthesis, and desktop replay delegate lifecycle to `AssistantKernel.runTurn`. Provider request/decoding exists only in `model-engine/openai-adapter.ts`; `chat-stream/*` is classification and pure helpers. `check-chat-runtime-boundaries.mjs` enforces dependency direction. |

## Intentionally not done

These stay because they still have a unique job, or they are product/ops work outside this worktree:

- MiniSearch habit picker
- Tinybird web/iOS/long-range analytics
- FastAPI cross-device overview/color prefs
- OpenPanel + Sentry
- MUI icons + Lucide + Paper shaders
- Bundling the hosted dashboard into Tauri
- Moving habits/wearables/SMS local
- Goose/ACP as Ritual's kernel
- Intel Mac desktop builds (0.1.1 is Apple Silicon only)
- Disabling Nick's Trigger.dev cloud project from this repo
