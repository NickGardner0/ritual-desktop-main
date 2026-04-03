# Chat-Stream Orchestrator Refactoring Plan

## Current State vs. Target State

### Side-by-Side: Ritual vs. Midday

| Dimension | Ritual (Current) | Midday (Reference) | Ritual (Target) |
|---|---|---|---|
| **Orchestrator** | 5,847 lines, 1 file, 107 functions | 134 lines, thin router | ~300 lines, thin router |
| **Tool definitions** | Duplicated in `tools.ts` AND `orchestrator.ts` (inline) | 16 domain-scoped files, 103 tools total | Single source of truth in `tools.ts`, extended per-domain |
| **Tool executors** | 16 `execute*` functions inline in orchestrator, some also in `tools.ts` | Each tool file owns its executor via `registerTool()` | Executors co-located with tool definitions in domain files |
| **System prompt** | ~175 lines, static blob, rebuilt from scratch every message | ~55 lines, dynamic from user context (`getServerInstructions(ctx)`) | ~80 lines, static portion cached, dynamic portion injected |
| **Schemas/types** | `ChatToolResults` uses `any` everywhere; no validation | Dedicated `schemas.ts` (562 lines) with Zod for all inputs/outputs | Typed `ToolResult` interfaces, Zod for tool params |
| **Streaming** | Fake — full response generated, then drip-fed in 5-word chunks with 5ms delays | Real streaming via MCP `StreamableHTTPTransport` | Real streaming via OpenAI SDK `stream: true` |
| **Query classification** | 8 hand-written `is*Query()` regex functions + system prompt routing + fast-path checks (triple intent detection) | None — LLM picks the tool via MCP protocol | Keep fast-path for deterministic queries, remove regex duplication |
| **Tool execution** | Sequential `for` loop with `await` per tool call | MCP handles the agentic loop; `Promise.all` for insight generation | `Promise.all` for independent tool calls within same iteration |
| **Error handling** | Per-tool `try/catch` with empty `catch {}` blocks that silently swallow errors | Consistent `withErrorHandling()` wrapper on every tool | Shared `withToolErrorHandling()` wrapper, errors surfaced to user |
| **Temperature** | 0.7 for everything | 0.2-0.4 tuned per task type | 0.3 for analytics, 0.5 for narrative, 0.7 for freeform chat |
| **Response truncation** | None — full tool results passed to LLM | 25KB limit with pagination hints | Truncate tool results > 15KB with summary + pagination hint |

---

## Guiding Principles

1. **Extract, don't rewrite.** Every change is a cut-and-paste from orchestrator.ts into a new file with an import back. The orchestrator's logic is correct — it just needs to live in the right place.
2. **One PR per phase.** Each phase is independently deployable and testable. If Phase 2 breaks something, Phase 1 is already stable in production.
3. **Preserve the stream wire format exactly.** The client (`chat-client.tsx`) parses three prefixes: `__CONVERSATION_ID__`, `0:`, `__TOOL_DATA__`. These must not change.
4. **Preserve tool names exactly.** OpenAI function calling uses tool names as identifiers. Renaming a tool breaks the LLM's ability to call it.
5. **Test after every phase.** Run these queries after each deploy:
   - "How was my week?" (fast-path → `getWeeklyOverview`)
   - "How's my sleep?" (OpenAI path → `getHabitStats` + `getDailyBreakdown`)
   - "What did I work on today?" (fast-path → `getActivitySummary`)
   - "Is there a correlation between sleep and workout?" (OpenAI path → `getCorrelation`)
   - Voice mode: "How am I doing?" (voice post-processing)

---

## Phase 1: Extract Tool Executors (Zero Behavior Change)

**Goal:** Move the 16 `execute*` functions out of orchestrator.ts into domain-specific files. The orchestrator imports them back. No logic changes.

**Why this is safe:** Execute functions are pure — they take (token, params) and return a JSON string. They have no dependencies on orchestrator state.

### New file structure:
```
lib/ai/chat-stream/
├── orchestrator.ts              # ~1,800 lines (down from 5,847)
├── core.ts                      # (unchanged)
├── persistence.ts               # (unchanged)
├── runtime.ts                   # re-exports (updated)
├── voice.ts                     # (unchanged)
├── tools.ts                     # Tool definitions only (cleaned up)
├── types.ts                     # NEW — shared types
├── system-prompt.ts             # NEW — system prompt builder
├── query-classifier.ts          # NEW — is*Query() functions
├── stream-response.ts           # NEW — stream encoding helpers
├── weekly-overview-utils.mjs    # (unchanged)
│
├── executors/
│   ├── index.ts                 # barrel re-export
│   ├── habits.ts                # executeGetHabitStats, executeGetDailyBreakdown,
│   │                            # executeGetCorrelation, executeListHabits,
│   │                            # executeGetHabitTrends, executeGetHabitAnomalies
│   ├── overviews.ts             # executeGetWeeklyOverview, executeGetDailyOverview,
│   │                            # executeGetMonthlyOverview
│   ├── context-memory.ts        # executeSearchContextMemory, executeSearchScreenRecordings,
│   │                            # executeGetActivitySummary
│   ├── computer-time.ts         # executeGetComputerTimeSpentBreakdown
│   ├── biometrics.ts            # executeGetDailyBiometrics
│   ├── screen-time.ts           # executeGetScreenTimeSummary
│   └── calendar.ts              # executeGetCalendarEvents
│
├── narrative/
│   ├── index.ts                 # barrel re-export
│   ├── context-memory.ts        # buildContextMemoryNarrative + helpers (~250 lines)
│   ├── weekly-overview.ts       # buildWeeklyOverviewNarrative, buildWeeklyOverviewHighlights,
│   │                            # buildWeeklyOverviewSynthesisPayload (~450 lines)
│   └── activity-summary.ts      # buildCalendarStyleActivitySummary,
│                                # buildRichActivitySummaryFromStoryPlan (~200 lines)
```

### What moves where:

| Source (orchestrator.ts lines) | Destination | Functions |
|---|---|---|
| 2567-2595 | `executors/habits.ts` | `executeGetHabitStats` |
| 2597-2626 | `executors/habits.ts` | `executeGetDailyBreakdown` |
| 2628-2654 | `executors/habits.ts` | `executeGetCorrelation` |
| 2656-2667 | `executors/habits.ts` | `executeListHabits` |
| 2668-2692 | `executors/habits.ts` | `executeGetHabitTrends` |
| 2912-3262 | `executors/habits.ts` | `executeGetHabitAnomalies` |
| 2694-2867 | `executors/overviews.ts` | `executeGetWeeklyOverview` |
| 2869-2888 | `executors/overviews.ts` | `executeGetDailyOverview` |
| 2890-2910 | `executors/overviews.ts` | `executeGetMonthlyOverview` |
| 4110-4342 | `executors/context-memory.ts` | `executeSearchScreenRecordings` |
| 4344-4401 | `executors/context-memory.ts` | `executeSearchContextMemory` |
| 4582-4806 | `executors/context-memory.ts` | `executeGetActivitySummary` |
| 4403-4580 | `executors/computer-time.ts` | `executeGetComputerTimeSpentBreakdown` |
| 4808-4848 | `executors/biometrics.ts` | `executeGetDailyBiometrics` |
| 4850-4895 | `executors/screen-time.ts` | `executeGetScreenTimeSummary` |
| 4897-4960 | `executors/calendar.ts` | `executeGetCalendarEvents` |
| 716-948 | `narrative/context-memory.ts` | `buildContextMemoryNarrative` + 15 helper functions |
| 1192-1615 | `narrative/weekly-overview.ts` | `buildWeeklyOverview*` + `generateWeeklyOverviewNarrative` |
| 2078-2249 | `narrative/activity-summary.ts` | `buildCalendarStyleActivitySummary`, `buildRichActivitySummaryFromStoryPlan` |

### What stays in orchestrator.ts:
- `handleChatStreamPost()` — the main handler (~200 lines)
- The fast-path logic (~130 lines)
- The tool call loop (~250 lines)
- The response streaming logic (~50 lines)
- Canvas payload builder (~40 lines)

### Validation:
- `npm run build` must pass (type-checking)
- Run the 5 test queries listed above
- Verify canvas/side-panel data still renders

### Estimated orchestrator.ts after Phase 1: ~1,800 lines

---

## Phase 2: Add Types and Remove `any`

**Goal:** Replace `ChatToolResults` and all `any` types with proper interfaces.

### New file: `types.ts`

```typescript
// Tool result types — one per tool
export interface HabitStatsResult {
  success: boolean;
  habits: Array<{
    id: string;
    name: string;
    total: number;
    average: number;
    min: number;
    max: number;
    std_dev: number;
    days_with_data: number;
    unit?: string;
  }>;
  available_habits?: string[];
  error?: string;
}

export interface DailyBreakdownResult {
  success: boolean;
  habit: { id: string; name: string; unit?: string };
  data: Array<{ date: string; value: number; logged: boolean }>;
  error?: string;
}

// ... similar for every tool result

// Aggregated results passed to canvas
export interface ChatToolResults {
  stats?: HabitStatsResult['habits'];
  dailyBreakdown?: DailyBreakdownResult['data'];
  dailyBreakdownHabit?: DailyBreakdownResult['habit'];
  correlation?: CorrelationResult;
  trends?: TrendsResult;
  anomalies?: AnomaliesResult;
  screenRecordings?: ContextMemoryResult;
  contextMemoryRecap?: ContextMemoryResult;
  screenTimeSpent?: ComputerTimeResult;
  weeklyOverview?: WeeklyOverviewResult;
  dailyOverview?: DailyOverviewResult;
  monthlyOverview?: MonthlyOverviewResult;
  activitySummary?: ActivitySummaryResult;
  dailyBiometrics?: BiometricsResult;
  screenTimeSummary?: ScreenTimeSummaryResult;
  calendarEvents?: CalendarEventsResult;
  suggested_followups?: string[];
  reply_chips?: string[];
  allStats?: HabitStatsResult['habits'];
  allBreakdowns?: Array<{ habit: DailyBreakdownResult['habit']; data: DailyBreakdownResult['data'] }>;
}
```

### Changes:
- Replace every `any` in orchestrator.ts with the correct type
- Replace `catch {}` blocks with `catch (e) { console.error(...) }` so errors are visible
- Add return types to all execute functions: `Promise<HabitStatsResult>` instead of `Promise<string>`

### Validation:
- `npm run build` must pass
- Same 5 test queries

---

## Phase 3: Extract Query Classifiers and System Prompt

**Goal:** Move the 8 `is*Query()` functions and the system prompt into their own files.

### New file: `query-classifier.ts` (~250 lines)

All of these move here:
- `isComprehensiveWeeklyRecapQuery()`
- `isDailyOverviewQuery()`
- `isMonthlyOverviewQuery()`
- `isExplicitThisWeekQuery()`
- `isExplicitLastWeekQuery()`
- `isScreenTimeSpentQuery()`
- `isBroadScreenOverviewQuery()`
- `isContextMemoryRecapQuery()`
- `hasRelativeTimeHint()`
- `resolveWeeklyOverviewParamsFromQuery()`
- `getOverviewTitleFromQuery()`
- `chooseScreenSearchQuery()`
- `parseRelativeTimeWindowMs()`
- `inferScreenDaysBackFromQuery()`
- `inferRelativeCutoffTimestamp()`
- `parseExplicitRecapAnchorDate()`

### New file: `system-prompt.ts` (~200 lines)

```typescript
// Static portion (cached at module level, never changes)
const STATIC_SYSTEM_PROMPT = `You are a helpful habit tracking assistant for Ritual...
=== TOOL ROUTING GUIDE ===
...
=== EVIDENCE-GROUNDING RULES ===
...`;

// Dynamic portion (changes per request)
export function buildSystemPrompt(options: {
  timezone: string;
  today: string;
  currentYear: number;
  isVoiceMode: boolean;
}): string {
  const dateContext = `Current date: ${options.today}\nCurrent year: ${options.currentYear}\nTimezone: ${options.timezone}`;
  const base = `${dateContext}\n\n${STATIC_SYSTEM_PROMPT}`;
  return options.isVoiceMode ? base + VOICE_STYLE_PROMPT : base;
}
```

**Why this matters:** The static portion (~90% of the prompt) can be cached. Only the date/timezone context changes per request. This also makes it easy to iterate on prompt wording without touching the orchestrator.

### Validation:
- Same 5 test queries
- Verify voice mode still works by toggling responseMode

---

## Phase 4: Parallelize Tool Execution (Performance Win)

**Goal:** When OpenAI requests multiple tool calls in one response, execute them concurrently instead of sequentially.

### Current code (orchestrator.ts ~5430):
```typescript
for (const toolCall of assistantMessage.tool_calls) {
  // ...
  result = await executeGetHabitStats(token, args);  // BLOCKS
  // ...
  result = await executeGetDailyBreakdown(token, args);  // WAITS FOR ABOVE
}
```

### Target code:
```typescript
const toolCallResults = await Promise.all(
  assistantMessage.tool_calls.map(async (toolCall) => {
    const args = JSON.parse(toolCall.function.arguments || '{}');
    const result = await executeToolCall(toolCall.function.name, token, args, {
      timezone,
      normalizedScreenSearchContext,
      localOverviewActivity,
      latestUserContent,
      weeklyOverviewQueryParams,
      strictThisWeekForWeeklyOverview,
    });
    return { toolCall, result };
  })
);

// Process results and update toolResults (same logic as today)
for (const { toolCall, result } of toolCallResults) {
  updateToolResults(toolResults, toolCall.function.name, result);
  apiMessages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: result.raw,
  });
}
```

### New helper: `executeToolCall()` — a unified dispatcher

```typescript
async function executeToolCall(
  name: string,
  token: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolCallResult> {
  switch (name) {
    case 'getHabitStats': return { raw: await executeGetHabitStats(token, args), name };
    case 'getDailyBreakdown': return { raw: await executeGetDailyBreakdown(token, args, context.timezone), name };
    // ... all 16 tools
    default: return { raw: JSON.stringify({ error: `Unknown tool: ${name}` }), name };
  }
}
```

### Expected performance impact:
- "How's my sleep?" calls `getHabitStats` + `getDailyBreakdown` → currently ~800ms sequential, target ~400ms parallel
- Queries requesting 3 tools → ~40% latency reduction

### Validation:
- Same 5 test queries
- Time each query before and after — expect 30-40% improvement on multi-tool queries
- Verify tool results still accumulate correctly (allStats, allBreakdowns)

---

## Phase 5: Real Streaming (Optional, Higher Risk)

**Goal:** Stream tokens from OpenAI as they arrive instead of waiting for the complete response then faking it.

### Current flow:
```
User → OpenAI (wait 2-3s) → full text → split into 5-word chunks → drip-feed with 5ms delays
```

### Target flow:
```
User → OpenAI (stream: true) → token arrives → immediately forward to client
```

### Changes:
1. Use `openai.chat.completions.create({ ..., stream: true })`
2. Forward each `chunk.choices[0].delta.content` directly to the ReadableStream
3. Handle tool calls in streaming mode (collect tool call deltas, then execute)

### Why this is higher risk:
- Tool calls in streaming mode arrive as deltas that need to be assembled
- The fast-path already doesn't use OpenAI, so it won't benefit
- The final narrative synthesis (lines 5726-5753) replaces OpenAI's text anyway for overviews

### Recommendation: Do this last, and only if latency is still a problem after Phases 1-4. The fast-path + parallel tool execution may be sufficient.

---

## Phase 6: Cleanup and Polish

**Goal:** Final cleanup after all extractions are stable.

1. **Remove duplicate tool definitions** — orchestrator.ts has inline tool defs AND tools.ts has them. Keep only tools.ts.
2. **Remove duplicate execute functions** — tools.ts has basic versions, orchestrator has extended versions. After Phase 1, remove the tools.ts stubs.
3. **Remove dead code** — `formatVoiceResponse` and `generateReplyChips` exist in both voice.ts and orchestrator.ts. Keep only voice.ts versions.
4. **Add `withToolErrorHandling` wrapper** (Midday pattern):
   ```typescript
   function withToolErrorHandling<T>(fn: () => Promise<T>, label: string): Promise<T> {
     try { return await fn(); }
     catch (e) { console.error(`Tool ${label} failed:`, e); return JSON.stringify({ error: String(e) }); }
   }
   ```
5. **Tune temperature per task:**
   - Tool selection call: `temperature: 0.3` (more deterministic tool choice)
   - Final synthesis call: `temperature: 0.5` (slightly creative narrative)
   - Freeform chat (no tools): `temperature: 0.7` (current default)

---

## Final Target File Sizes

| File | Lines | Purpose |
|---|---|---|
| `orchestrator.ts` | ~300 | Main handler, fast-path, tool loop, stream response |
| `types.ts` | ~150 | All shared TypeScript interfaces |
| `system-prompt.ts` | ~200 | System prompt builder with caching |
| `query-classifier.ts` | ~250 | All `is*Query()` functions and date helpers |
| `stream-response.ts` | ~60 | Stream encoding helpers |
| `tools.ts` | ~300 | Tool definitions (single source of truth) |
| `executors/*.ts` | ~2,000 total | 7 domain files with execute functions |
| `narrative/*.ts` | ~900 total | 3 files for narrative generation |
| `core.ts` | ~60 | fetchPythonApi, withTimeout (unchanged) |
| `persistence.ts` | ~55 | createConversation, saveMessage (unchanged) |
| `voice.ts` | ~95 | Voice post-processing (unchanged) |
| **Total** | ~4,370 | Down from 5,847 (removing duplicates and dead code) |

The critical metric isn't total lines — it's that no single file exceeds ~300 lines, and each file has one clear responsibility.

---

## Risk Mitigation

### What could break and how to prevent it:

| Risk | Prevention |
|---|---|
| Stream format changes break client | Extract stream encoding into `stream-response.ts` with unit tests. Never change the three prefix formats. |
| Tool name rename breaks OpenAI | Tool names are string constants — never rename them. Keep in `tools.ts` as the single source of truth. |
| Fast-path stops matching queries | Extract `is*Query()` into `query-classifier.ts` with unit tests for known query patterns. |
| Parallel tool execution causes race conditions | `Promise.all` on independent calls is safe. Tool result accumulation happens AFTER all calls complete. |
| Canvas payload shape changes break frontend | `ChatToolResults` type enforces shape. `buildCanvasToolPayload` stays in orchestrator, unchanged. |
| Import paths break after extraction | Use barrel `index.ts` files in `executors/` and `narrative/`. The orchestrator imports from barrels. |

### Rollback strategy:
Each phase is a separate PR. If Phase N breaks production, revert that single PR. Phases 1-3 are zero-behavior-change extractions — the only risk is a missed import.

---

## Test Matrix (Run After Every Phase)

| Query | Expected Path | Verify |
|---|---|---|
| "How was my week?" | Fast-path → `getWeeklyOverview` | Canvas shows weekly table, narrative summary in chat |
| "How's my sleep?" | OpenAI → `getHabitStats` + `getDailyBreakdown` | Canvas shows daily chart, stats in chat |
| "What did I work on today?" | Fast-path → `getActivitySummary` | Narrative with workstreams, no raw evidence |
| "Is there a connection between sleep and caffeine?" | OpenAI → `getCorrelation` | Correlation coefficient in chat |
| "Show me anomalies for workout" | OpenAI → `getHabitAnomalies` | Specific dates and z-scores in chat |
| Voice: "How am I doing?" | Voice mode → overview | Short response, ends with question, reply chips |
| "What apps did I use today?" | Fast-path → `getComputerTimeSpentBreakdown` | App list with time estimates |
| "What's on my calendar?" | OpenAI → `getCalendarEvents` | Calendar events listed |
