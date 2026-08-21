# Ritual simplification — architecture before/after

**Date:** 2026-08-21  
**Worktree:** `/Users/nickgardner/Desktop/ritual-desktop-main` (dirty feature tree). Ship target is `codex/release-0.1.1-prep`.  
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
  FastAPI loops + Trigger.dev (deleted this program)
  SQL + Typesense (deleted) + Tinybird + MiniSearch
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
| Production build reproducible and green | Dashboard `tsc --noEmit` and `next build --webpack` are green on this tree (2026-08-21). |
| Every Tauri command typed + capability | ACL 60/60. Generated `NativeCommandName` + `NATIVE_COMMAND_CAPABILITIES` + `NativeCommandInputs`/`Outputs` from Rust signatures. |
| Persisted browser data cannot cross identity | Done earlier (React Query persist key). |
| One durable turn/receipt history | FastAPI `assistant_turns` + kernel commit after persist. Receipts stored on the turn. |
| Only read-only tools concurrent | `planToolBatch` / `executeDeclaredToolCalls`; unknown tools fail closed as mutating. |
| One scheduler owner | FastAPI only. Job table written. Trigger.dev **code** deleted. Cloud project disable is a post-deploy ops step (`TRIGGER_DEV_OPS.md`). |
| No chat-api / profiling callers | Deleted. |
| Desktop activity explicit local source | Done earlier for recent desktop. Long-range/web still `synced`. |
| Remaining projections documented | Tinybird inventory + domain-event types for habit log, habit def, assistant turn, activity sync. |
| Launch/route/CPU/RSS budgets | Five-trial cold/warm + RSS fixture budgets in `repo:check`; desktop-rust tests parse RSS and orphan sidecars; production code records launch milestones and process RSS. |
| LOC remeasured | Audit baseline 192,474. Audit-comparable total ~183.97k after unused-duplicate deletion. Inside 180–185k. |
| Legacy orchestration deleted after parity | SMS mutation loop uses the same tool batch. Stream abort cancels the kernel turn. Conversation queue remains a prompt queue, not a second turn owner. |

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
