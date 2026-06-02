# Dedicated Chat API Migration Plan

## Recommendation

Use a dedicated **Node/TypeScript chat service** for the AI chat runtime and keep the existing **FastAPI backend** as the system-of-record for analytics, watcher data, conversations, and auth-protected data APIs.

This is the fastest path to the main Midday-style win:

- browser/desktop chat client calls a dedicated chat service directly
- chat service starts streaming immediately
- chat service continues calling the existing Python APIs for data/tool execution
- no Next.js `/api/chat/stream` hop on the critical path

## Why This Is The Recommended Path

### Current Ritual constraints

Today the chat path is tightly coupled to Next.js:

- frontend posts to `/api/chat/stream`
  - `apps/dashboard/app/(dashboard)/chat/chat-client.tsx`
- Next route delegates to the orchestrator
  - `apps/dashboard/app/api/chat/stream/route.ts`
- orchestrator is TypeScript and uses the OpenAI JS SDK plus dashboard-local modules
  - `apps/dashboard/lib/ai/chat-stream/orchestrator.ts`

The chat runtime is already TypeScript-heavy:

- query classification
- tool orchestration
- streaming helpers
- weekly/monthly/daily narrative generation
- OpenAI streaming integration
- persistence helpers

Those modules already call Python APIs as downstream dependencies:

- `apps/dashboard/lib/ai/chat-stream/executors/shared-api.ts`

### Why not FastAPI-first

A FastAPI-native chat service is possible, but it is not the lowest-effort or lowest-risk option.

FastAPI-first would require one of these:

1. Port the existing chat runtime from TypeScript to Python.
2. Run a Node chat runtime from inside the Python service as a sidecar/subprocess.

Option 1 is a large rewrite. Option 2 adds cross-runtime complexity without removing Node from the picture.

The main chat logic you would need to port includes:

- `apps/dashboard/lib/ai/chat-stream/orchestrator.ts`
- `apps/dashboard/lib/ai/chat-stream/query-classifier.ts`
- `apps/dashboard/lib/ai/chat-stream/system-prompt.ts`
- `apps/dashboard/lib/ai/chat-stream/stream-response.ts`
- `apps/dashboard/lib/ai/chat-stream/narrative/weekly-overview.ts`
- `apps/dashboard/lib/ai/chat-stream/narrative/activity-summary.ts`
- all executor modules under `apps/dashboard/lib/ai/chat-stream/executors/`

That is materially more work than standing up a small Node service that reuses the existing runtime.

## Architecture Decision

### Recommended target

```text
Dashboard / Desktop client
  -> Dedicated Chat API (Node/TS)
    -> OpenAI
    -> FastAPI backend (/api/analytics/*, /api/watcher/*, /api/conversations/*, etc.)
```

### Not recommended as first move

```text
Dashboard / Desktop client
  -> FastAPI chat endpoint
    -> Python port of TS orchestrator
    -> OpenAI Python SDK
    -> existing FastAPI internal services
```

## Effort Estimate

### Recommended Node chat service

- Minimal production-capable migration: `3-5 days`
- Clean production migration with rollout/fallback/metrics: `1-2 weeks`

### FastAPI-native rewrite

- Likely `2-4x` more work than the Node service path
- Higher regression risk
- More prompt/behavior drift during porting

## Smallest Safe Migration Path

### Phase 1: Extract a runtime-agnostic chat core

Goal: remove the hard dependency on `NextRequest` and Next route handlers.

Refactor the current orchestrator into:

- `handleChatStreamRequest(input: ChatRequestContext): Promise<Response>`
- thin adapters for:
  - Next.js route
  - future dedicated chat API route

Suggested extraction boundary:

- keep core logic in a shared TS module
- move only transport/auth glue into per-runtime adapters

New interfaces:

```ts
export interface ChatRequestContext {
  token: string;
  body: {
    messages: Array<{ role: string; content: string }>;
    timezone?: string;
    conversationId?: string | null;
    responseMode?: "text" | "voice";
    screenSearchResults?: unknown;
    screenRecordingResults?: unknown;
    localOverviewActivity?: unknown;
  };
}
```

Suggested files:

- `packages/chat-runtime/src/handle-chat-stream.ts`
- `packages/chat-runtime/src/orchestrator/*`

or, if you want the smallest move first:

- `apps/chat-api/src/chat/*`
- keep importing existing dashboard modules temporarily

### Phase 2: Create `apps/chat-api`

Create a dedicated Node/TypeScript service.

Suggested structure:

```text
apps/chat-api/
  package.json
  tsconfig.json
  src/server.ts
  src/routes/chat.ts
  src/lib/auth.ts
  src/lib/cors.ts
```

Suggested stack:

- `hono` or `fastify`
- plain Node runtime
- native `fetch`
- existing `openai` JS SDK

The route should initially preserve the **existing Ritual stream wire format** so the frontend does not need a parser rewrite:

- `__CONVERSATION_ID__...__END_CONVERSATION_ID__`
- `0:"text delta"`
- `__TOOL_DATA__...__END_TOOL_DATA__`

That means the dedicated service can ship without touching the chat UI rendering model.

### Phase 3: Add auth verification in the Node service

Do **not** accept arbitrary Bearer tokens and defer auth failure until downstream Python calls.

That would allow unauthorized OpenAI usage on generic chat turns that do not immediately hit a protected Python endpoint.

Recommended implementation:

- verify Clerk JWT in Node using Clerk server SDK or JWKS verification
- on success, continue with the raw bearer token for downstream Python API calls

Behavior:

- client sends `Authorization: Bearer <clerk-jwt>`
- chat service verifies token
- chat service uses same token when calling Python APIs
- Python continues enforcing auth exactly as it does today

This keeps security consistent without requiring the chat service to become the source of truth for user data.

### Phase 4: Move the client to the dedicated service

Update the dashboard client to call the dedicated chat API directly instead of `/api/chat/stream`.

Current call site:

- `apps/dashboard/app/(dashboard)/chat/chat-client.tsx`

Change:

- add `NEXT_PUBLIC_CHAT_API_URL`
- switch from:
  - `fetch('/api/chat/stream', ...)`
- to:
  - `fetch(\`${NEXT_PUBLIC_CHAT_API_URL}/chat/stream\`, ...)`

Keep the request body shape the same at first:

- `messages`
- `timezone`
- `conversationId`
- `responseMode`
- `screenSearchResults`
- `localOverviewActivity`

### Phase 5: Keep the existing Next route as fallback

Do not delete the Next route immediately.

Instead:

- leave `apps/dashboard/app/api/chat/stream/route.ts` in place
- optionally convert it into a proxy/fallback adapter
- gate the new direct chat endpoint behind a feature flag

Suggested env flag:

```text
NEXT_PUBLIC_USE_DIRECT_CHAT_API=true
```

Fallback policy:

- if direct chat service is unavailable, either:
  - fall back to old Next route in client code, or
  - keep the old route operational for emergency rollback

### Phase 6: Add service-level concerns

Before full rollout, add:

- per-user rate limiting
- structured request latency logging
- first-token latency metrics
- OpenAI error classification
- request IDs / trace IDs
- health endpoint

Suggested endpoints:

- `GET /healthz`
- `POST /chat/stream`

## Concrete File Changes

### Minimal viable migration

1. Extract auth-independent request handling from:
   - `apps/dashboard/lib/ai/chat-stream/orchestrator.ts`
2. Add new app:
   - `apps/chat-api/*`
3. Add Clerk/JWKS verification module:
   - `apps/chat-api/src/lib/auth.ts`
4. Add direct route:
   - `apps/chat-api/src/routes/chat.ts`
5. Update dashboard client:
   - `apps/dashboard/app/(dashboard)/chat/chat-client.tsx`
6. Keep current Next route temporarily:
   - `apps/dashboard/app/api/chat/stream/route.ts`

### Optional cleanup after cutover

1. Move all chat runtime code from `apps/dashboard/lib/ai/chat-stream/*` to a shared package.
2. Remove Next-only imports from the chat core.
3. Reuse the same chat core for:
   - dashboard chat
   - desktop chat
   - SMS chat if desired

## Node vs FastAPI Decision

### Dedicated Node chat service

Pros:

- reuses existing chat runtime with minimal translation
- smallest implementation delta
- lowest behavior drift risk
- easiest path to Midday-like direct streaming
- no need to port prompt/tool logic

Cons:

- one more deployable service
- mixed-runtime architecture remains

### FastAPI chat service

Pros:

- single backend runtime in the long term
- operationally simpler if everything is eventually Python

Cons:

- major rewrite now
- slower time to value
- more regression risk
- duplicate business logic while porting

## Recommendation Summary

If the goal is:

- faster first-token latency
- less proxy overhead
- minimal rewrite
- Midday-like architecture soon

Then the right next move is:

1. build `apps/chat-api` in Node/TypeScript
2. reuse the existing TypeScript chat runtime
3. keep Python as the data/tool backend
4. preserve the existing Ritual stream format during migration

If the goal is instead:

- consolidate everything onto Python eventually

Then do that **after** the dedicated Node chat service is live and stable, not as the first migration step.

## Suggested Rollout Order

### Step 1

Extract a runtime-neutral chat handler from the current orchestrator.

### Step 2

Stand up `apps/chat-api` with one route: `POST /chat/stream`.

### Step 3

Verify Clerk JWTs in the Node service.

### Step 4

Point the dashboard chat client at the new service behind a feature flag.

### Step 5

Measure:

- request latency
- time to first byte
- time to first token
- end-to-end completion time

### Step 6

Only after stable rollout, decide whether the stream protocol and frontend transport should be modernized toward the Midday AI SDK UI-message model.

## Practical Recommendation For This Repo

Do **not** start by porting chat to FastAPI.

Start by creating a dedicated Node chat service that reuses the existing TypeScript runtime and continues to call the current FastAPI backend for data.
