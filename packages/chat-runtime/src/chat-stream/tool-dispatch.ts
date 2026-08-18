import type OpenAI from 'openai';
import { dispatchToolCall, withToolErrorHandling } from '../runtime-tools.js';
import { toolSchemas } from '../tool-registry.js';
import type { ActionReceiptSummary, ChatEntityRef, ChatToolResults } from '../types.js';
import { streamWeeklyOverviewNarrative, type WeeklyOverviewPayload } from '../narrative/index.js';
import type { ChatStreamEvent } from '../stream-response.js';
import { applyVoiceMode } from './narrative-router.js';
import { elapsed, getOpenAIClient } from './shared.js';

export function appendEntityRef(toolResults: ChatToolResults, ref: ChatEntityRef): void {
  if (!ref.id || !ref.type) return;
  toolResults.entityRefs = toolResults.entityRefs || [];
  if (toolResults.entityRefs.some((item) => item.type === ref.type && item.id === ref.id)) return;
  toolResults.entityRefs.push(ref);
}

export function appendEntityRefsFromReceipt(
  toolResults: ChatToolResults,
  receipt: Pick<ActionReceiptSummary, 'habit_id' | 'habit_name' | 'log_id'>,
): void {
  if (receipt.habit_id) {
    appendEntityRef(toolResults, {
      type: 'habit',
      id: receipt.habit_id,
      title: receipt.habit_name || undefined,
    });
  }
  if (receipt.log_id) {
    appendEntityRef(toolResults, {
      type: 'habit_log',
      id: receipt.log_id,
      title: receipt.habit_name || undefined,
    });
  }
}

export type ToolDispatchContext = {
  token: string;
  timezone?: string;
  localOverviewActivity?: unknown;
  latestUserContent: string;
  weeklyOverviewQueryParams: {
    daysBack?: number;
    startDate?: string;
    endDate?: string;
    strictThisWeek?: boolean;
  };
  strictThisWeekForWeeklyOverview: boolean;
  conversationId?: string | null;
  conversationIdPromise?: Promise<string | null>;
};

export function collectToolResult(toolResults: ChatToolResults, name: string, raw: string): void {
  try {
    const parsed = JSON.parse(raw);
    switch (name) {
      case 'getHabitStats':
        if (parsed.success && parsed.habits) {
          toolResults.allStats = toolResults.allStats || [];
          toolResults.allStats.push(...parsed.habits);
          toolResults.stats = parsed.habits;
        }
        break;
      case 'getDailyBreakdown':
        if (parsed.success) {
          toolResults.allBreakdowns = toolResults.allBreakdowns || [];
          if (parsed.habit && parsed.data) {
            toolResults.allBreakdowns.push({ habit: parsed.habit, data: parsed.data });
          }
          if (!toolResults.dailyBreakdown || toolResults.dailyBreakdown.length === 0) {
            toolResults.dailyBreakdown = parsed.data || [];
            if (parsed.habit) toolResults.dailyBreakdownHabit = parsed.habit;
          }
        }
        break;
      case 'getCorrelation':
        if (parsed.success) toolResults.correlation = parsed;
        break;
      case 'listHabits':
        break;
      case 'getHabitTrends':
        if (parsed.success) {
          toolResults.trends = parsed;
          if (parsed.suggested_followups) toolResults.suggested_followups = parsed.suggested_followups;
        }
        break;
      case 'getWeeklyOverview':
        if (parsed.success) {
          toolResults.weeklyOverview = parsed;
          if (parsed.suggested_followups) toolResults.suggested_followups = parsed.suggested_followups;
        }
        break;
      case 'getDailyOverview':
        if (parsed.success) {
          toolResults.dailyOverview = parsed;
          if (parsed.suggested_followups) toolResults.suggested_followups = parsed.suggested_followups;
        }
        break;
      case 'getMonthlyOverview':
        if (parsed.success) {
          toolResults.monthlyOverview = parsed;
          if (parsed.suggested_followups) toolResults.suggested_followups = parsed.suggested_followups;
        }
        break;
      case 'getStreaks':
        break;
      case 'getHabitAnomalies':
        if (parsed.success) {
          toolResults.anomalies = parsed;
          if (parsed.suggested_followups) {
            toolResults.suggested_followups = [
              ...(toolResults.suggested_followups || []),
              ...parsed.suggested_followups,
            ].slice(0, 3);
          }
        }
        break;
      case 'getComputerTimeSpentBreakdown':
        if (parsed.success) toolResults.screenTimeSpent = parsed;
        break;
      case 'getActivitySummary':
        if (parsed.success) toolResults.activitySummary = parsed;
        break;
      case 'getDailyBiometrics':
        if (parsed.success) toolResults.dailyBiometrics = parsed;
        break;
      case 'getScreenTimeSummary':
        if (parsed.success) toolResults.screenTimeSummary = parsed;
        break;
      case 'getCalendarEvents':
        if (parsed.success) {
          toolResults.calendarEvents = parsed;
          for (const event of parsed.events || []) {
            if (event?.id) {
              appendEntityRef(toolResults, {
                type: 'calendar_block',
                id: String(event.id),
                title: typeof event.title === 'string' ? event.title : undefined,
              });
            }
          }
        }
        break;
      case 'logHabit':
      case 'createHabit':
        if (parsed.success && parsed.receipt?.receipt_id) {
          toolResults.actionReceipts = toolResults.actionReceipts || [];
          const receipt = {
            receipt_id: parsed.receipt.receipt_id,
            action_kind: name,
            habit_id: parsed.habit_id ?? parsed.receipt.habit_id ?? null,
            habit_name: parsed.habit_name ?? parsed.receipt.habit_name ?? null,
            was_inserted: parsed.receipt.was_inserted ?? parsed.was_inserted ?? true,
            undoable: parsed.receipt.undoable ?? true,
            log_id: parsed.log?.id ?? parsed.receipt.log_id ?? null,
            amount: parsed.amount ?? null,
            date: parsed.date ?? null,
          };
          toolResults.actionReceipts.push(receipt);
          appendEntityRefsFromReceipt(toolResults, receipt);
        }
        break;
      case 'getSmsPreferences':
      case 'updateSmsPreferences':
        break;
      default:
        break;
    }
  } catch (e) {
    console.warn('⚠️ Tool result parse error:', e);
  }
}

export function mergeDailyBreakdowns(toolResults: ChatToolResults): void {
  if (!toolResults.allBreakdowns || toolResults.allBreakdowns.length <= 1) {
    return;
  }

  const habitIds = toolResults.allBreakdowns.map(b => b.habit?.id).filter(Boolean);
  const uniqueHabitIds = [...new Set(habitIds)];

  if (uniqueHabitIds.length !== 1) {
    return;
  }

  const mergedData: Array<{ date: string; value: number; logged?: boolean }> = [];
  const seenDates = new Set<string>();

  for (const breakdown of toolResults.allBreakdowns) {
    for (const entry of (breakdown.data || [])) {
      if (!seenDates.has(entry.date)) {
        seenDates.add(entry.date);
        mergedData.push(entry);
      }
    }
  }

  mergedData.sort((a, b) => a.date.localeCompare(b.date));
  toolResults.dailyBreakdown = mergedData;
  toolResults.dailyBreakdownHabit = toolResults.allBreakdowns[0].habit;
  console.log('📦 Merged breakdown data from', toolResults.allBreakdowns.length, 'calls:', mergedData.length, 'entries');
}

export type StreamingToolLoopOptions = {
  t0: number;
  apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  toolResults: ChatToolResults;
  dispatchContext: ToolDispatchContext;
  isVoiceMode: boolean;
  initialToolChoice: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming['tool_choice'];
};

type ToolCallAccumulator = Map<number, { id: string; name: string; arguments: string }>;

function applyToolCallDeltas(
  toolCallsMap: ToolCallAccumulator,
  deltas: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta['tool_calls'],
): void {
  for (const tc of deltas || []) {
    const existing = toolCallsMap.get(tc.index);
    if (existing) {
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name += tc.function.name;
      if (tc.function?.arguments) existing.arguments += tc.function.arguments;
    } else {
      toolCallsMap.set(tc.index, {
        id: tc.id || '',
        name: tc.function?.name || '',
        arguments: tc.function?.arguments || '',
      });
    }
  }
}

function assistantMessageFromToolCalls(
  toolCallsMap: ToolCallAccumulator,
): OpenAI.Chat.Completions.ChatCompletionMessage {
  return {
    role: 'assistant',
    content: null,
    refusal: null,
    tool_calls: Array.from(toolCallsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
  };
}

type ConsumedAssistantStream =
  | { kind: 'empty' }
  | { kind: 'tool_calls'; message: OpenAI.Chat.Completions.ChatCompletionMessage }
  | { kind: 'text'; firstText: string; rest: AsyncGenerator<string> };

async function consumeStreamedAssistant(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  t0: number,
): Promise<ConsumedAssistantStream> {
  const iterator = stream[Symbol.asyncIterator]();
  const firstResult = await iterator.next();

  if (firstResult.done) {
    return { kind: 'empty' };
  }

  console.log(`⏱️ [${elapsed(t0)}] first_provider_token`);
  const firstChunk = firstResult.value;
  const isToolCallResponse = !!(firstChunk.choices[0]?.delta?.tool_calls);

  if (isToolCallResponse) {
    const toolCallsMap: ToolCallAccumulator = new Map();
    applyToolCallDeltas(toolCallsMap, firstChunk.choices[0]?.delta?.tool_calls);

    let done = false;
    while (!done) {
      const next = await iterator.next();
      done = next.done || false;
      if (!done) {
        applyToolCallDeltas(toolCallsMap, next.value.choices[0]?.delta?.tool_calls);
      }
    }

    return {
      kind: 'tool_calls',
      message: assistantMessageFromToolCalls(toolCallsMap),
    };
  }

  async function* restOfText(): AsyncGenerator<string> {
    let chunkDone = false;
    while (!chunkDone) {
      const next = await iterator.next();
      chunkDone = next.done || false;
      if (!chunkDone) {
        const content = next.value.choices[0]?.delta?.content;
        if (content) yield content;
      }
    }
  }

  return {
    kind: 'text',
    firstText: firstChunk.choices[0]?.delta?.content || '',
    rest: restOfText(),
  };
}

async function* yieldTextTokens(firstText: string, rest: AsyncGenerator<string>): AsyncGenerator<ChatStreamEvent> {
  if (firstText) yield { type: 'text', text: firstText };
  for await (const token of rest) {
    if (token) yield { type: 'text', text: token };
  }
}

function overviewNarrativeSource(toolResults: ChatToolResults): { payload: WeeklyOverviewPayload; title: string } | null {
  if (toolResults.dailyOverview?.success) {
    return { payload: toolResults.dailyOverview as WeeklyOverviewPayload, title: 'Daily Activity Overview' };
  }
  if (toolResults.monthlyOverview?.success) {
    return { payload: toolResults.monthlyOverview as WeeklyOverviewPayload, title: 'Monthly Activity Overview' };
  }
  if (toolResults.weeklyOverview?.success) {
    return { payload: toolResults.weeklyOverview as WeeklyOverviewPayload, title: 'Weekly Activity Overview' };
  }
  return null;
}

async function executeAssistantToolCalls(
  t0: number,
  apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessage,
  toolResults: ChatToolResults,
  dispatchContext: ToolDispatchContext,
): Promise<void> {
  const toolCalls = assistantMessage.tool_calls;
  if (!toolCalls?.length) return;

  apiMessages.push(assistantMessage);
  const tTools = performance.now();
  const toolCallResults = await Promise.all(
    toolCalls.map(async (toolCall) => {
      const tTool = performance.now();
      const args = JSON.parse(toolCall.function.arguments || '{}');
      const result = await withToolErrorHandling(
        toolCall.function.name,
        () => dispatchToolCall(
          toolCall.function.name,
          dispatchContext.token,
          args,
          {
            timezone: dispatchContext.timezone,
            localOverviewActivity: dispatchContext.localOverviewActivity,
            latestUserContent: dispatchContext.latestUserContent,
            weeklyOverviewQueryParams: dispatchContext.weeklyOverviewQueryParams,
            strictThisWeekForWeeklyOverview: dispatchContext.strictThisWeekForWeeklyOverview,
            conversationId: dispatchContext.conversationId,
            conversationIdPromise: dispatchContext.conversationIdPromise,
          },
        ),
      );

      console.log(
        `⏱️ [${elapsed(t0)}] 📊 ${toolCall.function.name} done (${(performance.now() - tTool).toFixed(0)}ms, ${result.length} chars)`,
      );
      return { toolCall, result };
    }),
  );
  console.log(`⏱️ [${elapsed(t0)}] tools_done (parallel: ${(performance.now() - tTools).toFixed(0)}ms)`);

  for (const { toolCall, result } of toolCallResults) {
    collectToolResult(toolResults, toolCall.function.name, result);
    apiMessages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: result,
    });
  }
}

export async function* runStreamingToolLoop(
  options: StreamingToolLoopOptions,
): AsyncGenerator<ChatStreamEvent> {
  const {
    t0,
    apiMessages,
    toolResults,
    dispatchContext,
    isVoiceMode,
    initialToolChoice,
  } = options;

  for (let iterations = 1; iterations <= 6; iterations++) {
    const toolChoice = iterations === 1 ? initialToolChoice : 'auto';
    yield { type: 'phase', phase: iterations === 1 ? 'searching' : 'answering' };
    console.log(`⏱️ [${elapsed(t0)}] model_start iteration=${iterations} stream=true`);

    const streamingResponse = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: apiMessages,
      tools: toolSchemas,
      tool_choice: toolChoice,
      temperature: iterations < 5 ? 0.3 : 0.7,
      stream: true,
    });

    const consumed = await consumeStreamedAssistant(streamingResponse, t0);

    if (consumed.kind === 'empty') {
      console.log(`⏱️ [${elapsed(t0)}] OpenAI stream empty`);
      yield { type: 'text', text: 'I was unable to process your request.' };
      return;
    }

    if (consumed.kind === 'tool_calls') {
      const toolNames = consumed.message.tool_calls?.map((toolCall) => toolCall.function.name).join(', ') || 'tool';
      yield { type: 'phase', phase: 'tool', label: `Using ${toolNames}...` };
      console.log(`⏱️ [${elapsed(t0)}] 🔧 Tool loop iteration ${iterations}:`, toolNames);
      await executeAssistantToolCalls(t0, apiMessages, consumed.message, toolResults, dispatchContext);

      const narrative = !isVoiceMode ? overviewNarrativeSource(toolResults) : null;
      if (narrative) {
        yield { type: 'phase', phase: 'answering' };
        for await (const token of streamWeeklyOverviewNarrative(narrative.payload, narrative.title)) {
          if (token) yield { type: 'text', text: token };
        }
        return;
      }
      continue;
    }

    yield { type: 'phase', phase: 'answering' };
    if (isVoiceMode) {
      let fullText = consumed.firstText;
      for await (const token of consumed.rest) fullText += token;
      yield {
        type: 'text',
        text: applyVoiceMode(fullText || 'I was unable to process your request.', toolResults, true),
      };
      return;
    }

    yield* yieldTextTokens(consumed.firstText, consumed.rest);
    return;
  }

  yield { type: 'text', text: 'I was unable to process your request.' };
}
