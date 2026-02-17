# Midday AI Chat Architecture - Deep Analysis

> **Purpose**: This document analyzes how Midday (https://github.com/midday-ai/midday) built their AI assistant to help guide the implementation of similar features in Ritual, adapted for habit/behavior tracking instead of finance.

---

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Multi-Agent System](#multi-agent-system)
3. [Tool System](#tool-system)
4. [Artifacts & Canvas](#artifacts--canvas)
5. [UI Components](#ui-components)
6. [Suggested Prompts & Actions](#suggested-prompts--actions)
7. [Command System](#command-system)
8. [Voice Recording](#voice-recording)
9. [Memory & Chat History](#memory--chat-history)
10. [Status Indicators](#status-indicators)
11. [Key Packages Used](#key-packages-used)
12. [Adapting for Ritual](#adapting-for-ritual)

---

## High-Level Architecture

Midday's AI chat is split between:

### Backend (API)
- **Location**: `apps/api/src/ai/`
- **Framework**: Fly.io hosted Hono API with tRPC
- **AI SDK**: Vercel AI SDK with custom `@ai-sdk-tools/agents` wrapper

### Frontend (Dashboard)
- **Location**: `apps/dashboard/src/components/chat/`
- **Framework**: Next.js with React
- **State Management**: Zustand + custom hooks

### Data Flow
```
User Input → Chat Interface → API Route → Main Agent (Triage)
                                              ↓
                                    Specialist Agent Selected
                                              ↓
                                    Tools Execute (get data)
                                              ↓
                                    Artifacts Stream (visualizations)
                                              ↓
                                    Response Streamed to UI
```

---

## Multi-Agent System

Midday uses a **hierarchical multi-agent architecture**:

### Main/Triage Agent (`agents/main.ts`)
Routes user requests to the appropriate specialist:

```typescript
export const mainAgent = createAgent({
  name: "triage",
  model: openai("gpt-4o-mini"),
  temperature: 0.1,
  modelSettings: {
    toolChoice: {
      type: "tool",
      toolName: "handoff_to_agent",
    },
  },
  instructions: (ctx) => `Route user requests to the appropriate specialist.
    <agent-capabilities>
    general: General questions, greetings, web search
    research: AFFORDABILITY ANALYSIS, purchase decisions
    operations: Account balances, documents, inbox
    reports: Financial reports (revenue, expenses, burn rate, etc.)
    analytics: Predictions, advanced analytics
    transactions: Transaction history
    invoices: Invoice management
    customers: Customer management
    timeTracking: Time tracking
    </agent-capabilities>`,
  handoffs: [generalAgent, reportsAgent, analyticsAgent, ...],
  maxTurns: 1,
});
```

### Specialist Agents
Each agent handles a specific domain:

| Agent | Purpose | Tools |
|-------|---------|-------|
| `general` | Greetings, web search | `webSearch` |
| `reports` | Financial reports | `getSpending`, `getBurnRate`, `getRevenue`, etc. |
| `analytics` | Predictions, ML | `getPredictions` |
| `transactions` | Transaction queries | `getTransactions` |
| `invoices` | Invoice management | `getInvoices`, `createInvoice` |
| `customers` | Customer data | `getCustomers` |
| `timeTracking` | Time entries | `getTrackerEntries`, `createTrackerEntry` |
| `operations` | Documents, inbox | `getDocuments`, `getInbox` |
| `research` | Affordability analysis | `webSearch` |

### Agent Creation Pattern
Each agent is created with shared configuration:

```typescript
export const createAgent = (config: AgentConfig<AppContext>) => {
  return new Agent({
    ...config,
    memory: {
      provider: memoryProvider, // Redis
      history: { enabled: true, limit: 10 },
      workingMemory: {
        enabled: true,
        template: memoryTemplate,
        scope: "user",
      },
      chats: {
        enabled: true,
        generateTitle: { model: openai("gpt-4.1-nano"), instructions: titleInstructions },
        generateSuggestions: { enabled: true, model: openai("gpt-4.1-nano"), limit: 5, instructions: suggestionsInstructions },
      },
    },
  });
};
```

---

## Tool System

Tools are the core of how the AI retrieves and processes data.

### Tool Structure
Each tool follows this pattern:

```typescript
export const getSpendingTool = tool({
  description: "Analyze spending patterns with transaction details",
  inputSchema: z.object({
    from: z.string().optional().describe("Start date (ISO 8601)"),
    to: z.string().optional().describe("End date (ISO 8601)"),
    currency: z.string().nullable().optional(),
    showCanvas: z.boolean().default(false).describe("Show visual analytics"),
  }),
  execute: async function* ({ from, to, currency, showCanvas }, executionOptions) {
    // 1. Get context (user, team, etc.)
    const appContext = executionOptions.experimental_context as AppContext;
    
    // 2. Check preconditions
    if (!hasBankAccounts) throw new Error("BANK_ACCOUNT_REQUIRED");
    
    // 3. Initialize artifact (if showCanvas)
    if (showCanvas) {
      const writer = getWriter(executionOptions);
      analysis = spendingArtifact.stream({ stage: "loading" }, writer);
    }
    
    // 4. Fetch data from database
    const spendingData = await getSpending(db, { teamId, from, to });
    
    // 5. Update artifact with data
    if (showCanvas) {
      await analysis.update({ stage: "metrics_ready", metrics: {...} });
    }
    
    // 6. Generate AI summary
    const summaryResult = await generateText({
      model: openai("gpt-4o-mini"),
      messages: [{ role: "user", content: `Analyze this spending...` }],
    });
    
    // 7. Yield text response
    yield { text: responseText };
    
    // 8. Return structured data
    return { totalSpending, topCategory, transactions };
  },
});
```

### Key Tools in Midday

| Tool | Purpose | Has Canvas? |
|------|---------|-------------|
| `getSpending` | Spending analysis | ✅ |
| `getBurnRate` | Cash burn analysis | ✅ |
| `getRevenueSummary` | Revenue metrics | ✅ |
| `getProfitAnalysis` | Profit & Loss | ✅ |
| `getRunway` | Cash runway | ✅ |
| `getCashFlow` | Cash flow | ✅ |
| `getBalanceSheet` | Balance sheet | ✅ |
| `getForecast` | Revenue forecast | ✅ |
| `getTransactions` | Transaction list | ❌ |
| `getInvoices` | Invoice list | ❌ |
| `webSearch` | Web search | ❌ |

---

## Artifacts & Canvas

Artifacts are rich, interactive visualizations that slide in from the right.

### Artifact Definition (`artifacts/spending.ts`)

```typescript
export const spendingArtifact = artifact(
  "spending-canvas",
  z.object({
    // Processing stages
    stage: z.enum(["loading", "chart_ready", "metrics_ready", "analysis_ready"]),
    
    // Basic info
    currency: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
    
    // Chart data (available at chart_ready)
    chart: z.object({
      monthlyData: z.array(z.object({
        month: z.string(),
        amount: z.number(),
        average: z.number(),
      })),
    }).optional(),
    
    // Metrics (available at metrics_ready)
    metrics: z.object({
      totalSpending: z.number(),
      averageMonthlySpending: z.number(),
      topCategory: z.object({ name: z.string(), amount: z.number() }).optional(),
    }).optional(),
    
    // Analysis (available at analysis_ready)
    analysis: z.object({
      summary: z.string(),
      recommendations: z.array(z.string()),
    }).optional(),
  }),
);
```

### Canvas Component (`canvas/spending-canvas.tsx`)

```tsx
export function SpendingCanvas() {
  const [artifact] = useArtifact(spendingArtifact, { version });
  const { data, status } = artifact;
  
  const stage = data?.stage;
  const showTransactions = stage && ["metrics_ready", "analysis_ready"].includes(stage);
  
  return (
    <BaseCanvas>
      <CanvasHeader title="Spending" />
      <CanvasContent>
        {/* Transactions Table */}
        {showTransactions ? (
          <Table>...</Table>
        ) : (
          <Skeleton />
        )}
        
        {/* Summary Cards */}
        {showCards ? (
          <div className="grid grid-cols-2 gap-3">
            <Card>Spending this month: {metrics.currentMonthSpending}</Card>
            <Card>Top category: {metrics.topCategory.name}</Card>
          </div>
        ) : (
          <SkeletonCards />
        )}
        
        {/* AI Summary */}
        <CanvasSection title="Summary & Recommendations" isLoading={!showSummary}>
          {data?.analysis?.summary}
        </CanvasSection>
      </CanvasContent>
    </BaseCanvas>
  );
}
```

### Canvas Container Layout

The canvas slides in from the right when an artifact is active:

```tsx
<div className={cn(
  "fixed right-0 top-0 bottom-0 z-20",
  showCanvas ? "translate-x-0" : "translate-x-full",
  "transition-transform duration-300 ease-in-out",
)}>
  <Canvas />
</div>

{/* Main chat shifts left when canvas opens */}
<div className={cn(
  "relative flex-1 transition-all duration-300",
  showCanvas && "mr-0 md:mr-[600px]",
)}>
  <ChatMessages />
</div>
```

---

## UI Components

### Message Component

```tsx
export const Message = ({ from, ...props }: MessageProps) => (
  <div className={cn(
    "group flex w-full items-end justify-end gap-2 py-4",
    from === "user" ? "is-user" : "is-assistant flex-row-reverse justify-end",
  )} {...props} />
);

export const MessageContent = ({ children, className }) => (
  <div className={cn(
    // User styling
    "group-[.is-user]:!bg-[#F7F7F7] group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-none",
    // Assistant styling
    "group-[.is-assistant]:!bg-transparent group-[.is-assistant]:!px-0",
  )}>
    {children}
  </div>
);
```

### Response Component (Markdown Rendering)

Uses `Streamdown` for streaming markdown:

```tsx
export const Response = memo(({ ...props }) => (
  <Streamdown
    className="space-y-4"
    components={{
      ul: CustomUnorderedList,
      ol: CustomOrderedList,
      h3: ({ children }) => <h3 className="font-medium text-sm">{children}</h3>,
      p: ({ children }) => <p className="leading-relaxed">{children}</p>,
      table: (props) => <Table {...props} className="border" />,
      a: (props) => props.href?.startsWith(appUrl) ? <Link href={props.href}>{props.children}</Link> : <a {...props} />,
    }}
    {...props}
  />
), (prev, next) => prev.children === next.children);
```

### PromptInput Component

Full-featured input with attachments, voice, and actions:

```tsx
<PromptInput onSubmit={handleSubmit} globalDrop multiple>
  <PromptInputBody>
    <PromptInputAttachments>
      {(attachment) => <PromptInputAttachment data={attachment} />}
    </PromptInputAttachments>
    <PromptInputTextarea
      ref={textareaRef}
      autoFocus
      onChange={handleInputChange}
      placeholder="Ask anything"
    />
  </PromptInputBody>
  <PromptInputToolbar>
    <PromptInputTools>
      <PromptInputActionAddAttachments />
      <SuggestedActionsButton />
      <WebSearchButton />
    </PromptInputTools>
    <PromptInputTools>
      <RecordButton />
      <PromptInputSubmit status={status} />
    </PromptInputTools>
  </PromptInputToolbar>
</PromptInput>
```

---

## Suggested Prompts & Actions

### Post-Response Suggestions

AI generates 5 follow-up suggestions after each response:

```typescript
// In agent config
chats: {
  generateSuggestions: {
    enabled: true,
    model: openai("gpt-4.1-nano"),
    limit: 5,
    instructions: suggestionsInstructions, // See below
  },
}
```

**Suggestion Instructions:**
```markdown
Generate 5 brief follow-up suggestions (2-3 words each, max 5 words).

After showing data/metrics:
- Compare periods or categories
- Show related metrics
- Visualize trends (charts/graphs)
- Drill into details

Examples:
After showing revenue: "Compare quarters", "Show expenses", "Visualize trends"
After listing transactions: "Filter by type", "Visualize spending", "Show patterns"

What NOT to suggest:
- "Tell me more" (too generic)
- Repeating what was just shown
```

### Suggested Prompts UI

```tsx
export function SuggestedPrompts() {
  const [suggestions] = useDataPart<{ prompts: string[] }>("suggestions");
  
  return (
    <AnimatePresence mode="wait">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex gap-2 overflow-x-auto">
          {prompts.map((prompt, index) => (
            <motion.div
              key={prompt}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + index * 0.05 }}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handlePromptClick(prompt)}
                className="rounded-full text-xs border"
              >
                {prompt}
              </Button>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
```

### Pre-built Action Buttons (Homepage)

Quick action buttons with predefined tool calls:

```tsx
const uiConfig = {
  "get-burn-rate-analysis": {
    icon: Icons.Speed,
    title: "Burn rate analysis",
    description: "Show me my burn rate visual analytics",
  },
  "get-spending": {
    icon: Icons.ShowChart,
    title: "Spending Analysis",
    description: "Show me my spending analysis",
  },
  // ... more actions
};

// On click, send message with tool metadata
sendMessage({
  role: "user",
  parts: [{ type: "text", text: description }],
  metadata: {
    toolCall: {
      toolName: action.toolName,
      toolParams: action.toolParams,
    },
  },
});
```

---

## Command System

Midday has a `/` command system for quick actions:

### Command Definition (`store/chat.ts`)

```typescript
const COMMAND_SUGGESTIONS = [
  {
    command: "/show",
    title: "Show latest transactions",
    toolName: "getTransactions",
    toolParams: { pageSize: 10, sort: ["date", "desc"] },
    keywords: ["show", "latest", "transactions", "recent"],
  },
  {
    command: "/show",
    title: "Show cash burn and top 3 vendor increases",
    toolName: "getBurnRate",
    toolParams: { showCanvas: true },
    keywords: ["show", "burn", "cash", "vendor"],
  },
  {
    command: "/analyze",
    title: "Analyze spending patterns",
    toolName: "getSpending",
    toolParams: { showCanvas: true },
    keywords: ["analyze", "spending", "patterns"],
  },
  // ... many more
];
```

### Command Menu UI

```tsx
export function CommandMenu() {
  const { showCommands, filteredCommands, selectedCommandIndex } = useChatStore();
  
  if (!showCommands) return null;
  
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-background border rounded-lg shadow-lg">
      {filteredCommands.map((command, index) => (
        <div
          key={command.title}
          className={cn(
            "px-3 py-2 cursor-pointer",
            index === selectedCommandIndex && "bg-accent"
          )}
          onClick={() => handleCommandSelect(command)}
        >
          <span className="text-muted-foreground">{command.command}</span>
          <span className="ml-2">{command.title}</span>
        </div>
      ))}
    </div>
  );
}
```

---

## Voice Recording

### Record Button with Animation

```tsx
export function RecordButton({ size = 16 }) {
  const { isRecording, isProcessing, setIsRecording, setIsProcessing } = useChatStore();
  const { startRecording, stopRecording, transcribeAudio } = useAudioRecording();
  
  const handleRecordClick = async () => {
    if (isRecording) {
      setIsProcessing(true);
      const audioBlob = await stopRecording();
      const transcribedText = await transcribeAudio(audioBlob);
      setInput(transcribedText);
      setIsRecording(false);
      setIsProcessing(false);
    } else {
      await startRecording();
      setIsRecording(true);
    }
  };
  
  return (
    <Button onClick={handleRecordClick}>
      <RecordIcon size={size} isRecording={isRecording} />
    </Button>
  );
}
```

The `RecordIcon` has animated SVG bars that pulse when recording.

---

## Memory & Chat History

### Redis-backed Memory

```typescript
export const memoryProvider = new RedisProvider(getSharedRedisClient());

// Memory configuration per agent
memory: {
  provider: memoryProvider,
  history: {
    enabled: true,
    limit: 10, // Keep last 10 messages
  },
  workingMemory: {
    enabled: true,
    template: memoryTemplate,
    scope: "user", // Per-user working memory
  },
  chats: {
    enabled: true,
    generateTitle: { model: openai("gpt-4.1-nano") },
    generateSuggestions: { enabled: true, model: openai("gpt-4.1-nano"), limit: 5 },
  },
}
```

### Chat History Navigation

```tsx
export function ChatHistory() {
  const { data: chats } = useQuery(trpc.chat.list.queryOptions());
  
  return (
    <div className="flex flex-col gap-1">
      {chats.map((chat) => (
        <Link href={`/chat/${chat.id}`} key={chat.id}>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent">
            <span className="text-sm truncate">{chat.title}</span>
            <span className="text-xs text-muted-foreground">{formatDate(chat.updatedAt)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
```

---

## Status Indicators

### Agent & Tool Status

Shows what the AI is currently doing:

```tsx
export function ChatStatusIndicators({ agentStatus, currentToolCall, artifactStage }) {
  const displayMessage = getStatusMessage(agentStatus) || getToolMessage(currentToolCall);
  const toolIcon = currentToolCall ? getToolIcon(currentToolCall) : null;
  
  return (
    <div className="h-8 flex items-center">
      <AnimatedStatus
        text={displayMessage}
        shimmerDuration={0.75}
        icon={toolIcon}
      />
    </div>
  );
}
```

### Status Messages

```typescript
function getStatusMessage(status: AgentStatus | null): string | null {
  switch (status?.agent) {
    case "triage": return "Routing...";
    case "reports": return "Analyzing financials...";
    case "analytics": return "Running predictions...";
    default: return null;
  }
}

function getToolMessage(toolName: string | null): string | null {
  switch (toolName) {
    case "getSpending": return "Fetching spending data...";
    case "getBurnRate": return "Calculating burn rate...";
    case "webSearch": return "Searching the web...";
    default: return null;
  }
}
```

---

## Key Packages Used

| Package | Purpose |
|---------|---------|
| `ai` (Vercel AI SDK) | Core AI streaming, tools, messages |
| `@ai-sdk/openai` | OpenAI provider |
| `@ai-sdk-tools/agents` | Multi-agent orchestration (custom) |
| `@ai-sdk-tools/artifacts` | Artifact streaming (custom) |
| `@ai-sdk-tools/store` | Chat state management (custom) |
| `@ai-sdk-tools/memory` | Redis-backed memory (custom) |
| `streamdown` | Streaming markdown rendering |
| `zustand` | State management |
| `framer-motion` | Animations |
| `nuqs` | URL query state |
| `zod` | Schema validation |

---

## Adapting for Ritual

### Mapping Midday → Ritual Concepts

| Midday (Finance) | Ritual (Habits) |
|------------------|-----------------|
| Transactions | Habit Logs |
| Spending Categories | Habit Categories |
| Revenue | Habit Streaks |
| Burn Rate | Habit Trends |
| Cash Flow | Activity Patterns |
| Invoices | Goals/Targets |
| Customers | N/A |
| Balance Sheet | Habit Summary |
| Forecast | Habit Predictions |

### Suggested Ritual Agents

```typescript
// Triage Agent - route to specialists
const mainAgent = createAgent({
  name: "triage",
  handoffs: [generalAgent, analyticsAgent, loggingAgent, insightsAgent],
});

// Analytics Agent - habit trends, patterns
const analyticsAgent = createAgent({
  name: "analytics",
  tools: {
    getHabitTrends: habitTrendsTool,
    getHabitStreaks: habitStreaksTool,
    getActivityPatterns: activityPatternsTool,
    getHabitCorrelations: habitCorrelationsTool,
  },
});

// Logging Agent - log habits via chat
const loggingAgent = createAgent({
  name: "logging",
  tools: {
    logHabit: logHabitTool,
    updateHabitLog: updateHabitLogTool,
    bulkLogHabits: bulkLogHabitsTool,
  },
});

// Insights Agent - personalized recommendations
const insightsAgent = createAgent({
  name: "insights",
  tools: {
    getDailyInsights: dailyInsightsTool,
    getWeeklyReport: weeklyReportTool,
    getHabitRecommendations: habitRecommendationsTool,
  },
});
```

### Suggested Ritual Tools

```typescript
// Get habit trends with optional canvas
export const getHabitTrendsTool = tool({
  description: "Analyze habit trends over time",
  inputSchema: z.object({
    habitId: z.string().optional(),
    daysBack: z.number().default(30),
    showCanvas: z.boolean().default(false),
  }),
  execute: async function* ({ habitId, daysBack, showCanvas }) {
    // Fetch from Tinybird
    const trends = await tinybirdService.getHabitTrends(userId, daysBack);
    
    // Stream artifact if canvas requested
    if (showCanvas) {
      const writer = getWriter(executionOptions);
      await habitTrendsArtifact.stream({ stage: "loading" }, writer);
      // ... update stages
    }
    
    yield { text: `Your ${habitName} trend over ${daysBack} days...` };
    return { trends, summary };
  },
});
```

### Suggested Ritual Commands

```typescript
const RITUAL_COMMANDS = [
  { command: "/log", title: "Log meditation for 10 minutes", toolName: "logHabit", toolParams: { habitName: "meditation", duration: 10 } },
  { command: "/show", title: "Show my habit streaks", toolName: "getHabitStreaks", toolParams: { showCanvas: true } },
  { command: "/show", title: "Show sleep trends this month", toolName: "getHabitTrends", toolParams: { habitName: "sleep", showCanvas: true } },
  { command: "/analyze", title: "Analyze my weekly patterns", toolName: "getActivityPatterns", toolParams: { period: "week", showCanvas: true } },
  { command: "/compare", title: "Compare this week vs last week", toolName: "compareHabitPeriods", toolParams: { showCanvas: true } },
];
```

### Suggested Ritual Artifacts

```typescript
// Habit Trends Canvas
export const habitTrendsArtifact = artifact("habit-trends-canvas", z.object({
  stage: z.enum(["loading", "chart_ready", "summary_ready"]),
  habitName: z.string(),
  period: z.string(),
  chart: z.object({
    dailyData: z.array(z.object({ date: z.string(), value: z.number() })),
  }).optional(),
  metrics: z.object({
    total: z.number(),
    average: z.number(),
    trend: z.enum(["up", "down", "stable"]),
    streak: z.number(),
  }).optional(),
}));

// Activity Heatmap Canvas
export const activityHeatmapArtifact = artifact("activity-heatmap-canvas", z.object({
  stage: z.enum(["loading", "data_ready"]),
  habitName: z.string().optional(),
  heatmapData: z.array(z.object({
    date: z.string(),
    hour: z.number(),
    intensity: z.number(),
  })).optional(),
}));
```

---

## Implementation Priority for Ritual

### Phase 1: Foundation
1. ✅ Enhanced streaming chat (already done)
2. Create `Response` component with proper markdown rendering
3. Add suggested prompts after each response
4. Improve message styling (user bubbles vs assistant text)

### Phase 2: Tools & Data
5. Create habit-specific tools (getHabitTrends, getStreaks, etc.)
6. Implement tool status indicators ("Fetching your meditation data...")
7. Add `/` command system for quick actions

### Phase 3: Visualizations
8. Create artifact system for rich visualizations
9. Build canvas components (HabitTrendsCanvas, StreakCanvas, etc.)
10. Add slide-in panel for visualizations

### Phase 4: Polish
11. Add voice recording with transcription
12. Implement chat history and navigation
13. Add working memory (remember user preferences)
14. Create pre-built action buttons on homepage

---

## Key Takeaways

1. **Multi-agent is powerful** - Route simple questions to fast/cheap models, complex analysis to powerful models
2. **Tools are the backbone** - Every data operation is a tool with a schema
3. **Artifacts make it rich** - Streaming visualizations with stages (loading → ready)
4. **Suggestions keep engagement** - AI-generated follow-ups after each response
5. **Commands are shortcuts** - Power users love `/` commands
6. **Status indicators build trust** - Show what the AI is doing
7. **Memory creates continuity** - Remember past conversations and preferences

---

*This analysis is based on Midday v0.3.0 (June 2025). The codebase is available at https://github.com/midday-ai/midday under AGPL-3.0 license.*

