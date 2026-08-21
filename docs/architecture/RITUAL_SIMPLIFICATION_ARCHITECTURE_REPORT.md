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
packages/chat-runtime AssistantKernel
  queued -> running -> committing -> completed | failed | canceled
  serial mutating tools; parallel read-only
  epoch cancel; abort -> canceled; in-flight duplicate 409; stale running reclaim
        |
        v
FastAPI
  assistant_turns durable store
  domain services, one scheduler (background_tasks.py)
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
| Assistant turn lifecycle | `AssistantKernel` + `assistant_turns` + desktop outbox |
| Domain mutations | existing executors, serial when mutating, idempotency key `turnId:toolCallId` |
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
| Every Tauri command typed + capability | ACL 68/68. Generated `NativeCommandName` + `NATIVE_COMMAND_CAPABILITIES` + `NativeCommandInputs`/`Outputs` from Rust signatures. |
| Persisted browser data cannot cross identity | React Query persist key is `ritual:react-query-cache:v1:<userId>` and restore rejects identity mismatch. |
| One durable turn/receipt history | FastAPI `assistant_turns` + kernel commit after persist. Receipts stored on the turn. |
| Only read-only tools concurrent | `planToolBatch` / `executeDeclaredToolCalls`; unknown tools fail closed as mutating. |
| One scheduler owner | FastAPI only. Job table written. Trigger.dev **code** deleted. Cloud project disable is a post-deploy ops step (`TRIGGER_DEV_OPS.md`). |
| No chat-api / profiling callers | Deleted. Stale `package-lock.json` `apps/chat-api` workspace entry removed. |
| Desktop activity explicit local source | Recent desktop reads `activity.db` with observable `local \| synced \| unavailable`. Long-range/web still `synced`. |
| Remaining projections documented | Tinybird inventory. Typesense deleted. MiniSearch stays for the in-modal picker. Dashboard Tinybird reads go through FastAPI. Overview/metrics daily-totals and chat conversation/queue/artifact/fact reads use the generated client. Catch-all remains for logs, calendar, import, and Apple Watch cookie reads. |
| Launch/route/CPU/RSS budgets | Five-trial cold/warm + RSS fixture budgets in `repo:check`; production code records launch milestones and process RSS. Live WKWebView five-trial captures are still release QA. |
| LOC remeasured | Audit baseline 192,474. Next BFF is 16/39 after unused import parsers and duplicate OAuth store-code routes were deleted. |
| Legacy orchestration deleted after parity | SMS mutation loop uses the same tool batch. Stream abort cancels the kernel turn. The `ChatTurnEngine` wrapper is deleted; BFF routes call `handleChatStreamRequest` / SMS handlers. `chat-stream/*` remains the model-loop adapter behind the kernel. |

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
