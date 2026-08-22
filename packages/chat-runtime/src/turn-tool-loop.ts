import { executeDeclaredToolCalls } from './tool-batch.js';
import type { AssistantTurnRecord } from './assistant-turn.js';
import { defaultAssistantKernel, type AssistantKernel } from './assistant-kernel.js';
import { toolSchemas } from './tool-registry.js';
import type { ActionReceiptSummary, ChatEntityRef, ChatToolResults } from './types.js';
import { streamWeeklyOverviewNarrative, type WeeklyOverviewPayload } from './narrative/index.js';
import type { ChatStreamEvent } from './stream-response.js';
import {
  defaultModelEngine,
  type ModelEngineAdapter,
  type ModelEngineMessage,
  type ModelEngineTool,
  type ModelEngineToolCall,
  type ModelEngineToolChoice,
} from './model-engine/index.js';
import { applyVoiceMode } from './turn-narrative.js';
import { elapsed } from './chat-stream/shared.js';

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
  turn?: AssistantTurnRecord | null;
  kernel?: AssistantKernel;
  signal?: AbortSignal;
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
  apiMessages: ModelEngineMessage[];
  toolResults: ChatToolResults;
  dispatchContext: ToolDispatchContext;
  isVoiceMode: boolean;
  initialToolChoice: ModelEngineToolChoice;
  modelEngine?: ModelEngineAdapter;
  signal?: AbortSignal;
};

type ToolCallAccumulator = Map<number, { id: string; name: string; arguments: string }>;

function applyToolCallDelta(
  toolCallsMap: ToolCallAccumulator,
  delta: { index: number; id?: string; name?: string; arguments?: string },
): void {
  const existing = toolCallsMap.get(delta.index);
  if (existing) {
    if (delta.id) existing.id = delta.id;
    if (delta.name) existing.name += delta.name;
    if (delta.arguments) existing.arguments += delta.arguments;
  } else {
    toolCallsMap.set(delta.index, {
      id: delta.id || '',
      name: delta.name || '',
      arguments: delta.arguments || '',
    });
  }
}

function assistantMessageFromToolCalls(
  toolCallsMap: ToolCallAccumulator,
): ModelEngineMessage {
  return {
    role: 'assistant',
    content: null,
    toolCalls: Array.from(toolCallsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, toolCall]) => toolCall),
  };
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
  apiMessages: ModelEngineMessage[],
  assistantMessage: ModelEngineMessage,
  toolResults: ChatToolResults,
  dispatchContext: ToolDispatchContext,
): Promise<void> {
  const toolCalls = assistantMessage.toolCalls;
  if (!toolCalls?.length) return;

  apiMessages.push(assistantMessage);
  const tTools = performance.now();
  const toolCallResults = await executeDeclaredToolCalls({
    toolCalls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments || '{}',
    })),
    token: dispatchContext.token,
    ctx: {
      timezone: dispatchContext.timezone,
      localOverviewActivity: dispatchContext.localOverviewActivity,
      latestUserContent: dispatchContext.latestUserContent,
      weeklyOverviewQueryParams: dispatchContext.weeklyOverviewQueryParams,
      strictThisWeekForWeeklyOverview: dispatchContext.strictThisWeekForWeeklyOverview,
      conversationId: dispatchContext.conversationId,
      conversationIdPromise: dispatchContext.conversationIdPromise,
    },
    turn: dispatchContext.turn,
    kernel: dispatchContext.kernel || defaultAssistantKernel,
    signal: dispatchContext.signal,
  });
  console.log(`⏱️ [${elapsed(t0)}] tools_done (${(performance.now() - tTools).toFixed(0)}ms, ${toolCallResults.length} calls)`);

  for (const { toolCall, result } of toolCallResults) {
    collectToolResult(toolResults, toolCall.name, result);
    apiMessages.push({
      role: 'tool',
      toolCallId: toolCall.id,
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
    modelEngine = defaultModelEngine,
    signal,
  } = options;

  const assertNotAborted = () => {
    if (signal?.aborted || dispatchContext.signal?.aborted) {
      const error = new Error('client_disconnected');
      error.name = 'AbortError';
      throw error;
    }
  };

  for (let iterations = 1; iterations <= 6; iterations++) {
    assertNotAborted();
    const toolChoice = iterations === 1 ? initialToolChoice : 'auto';
    yield { type: 'phase', phase: iterations === 1 ? 'searching' : 'answering' };
    console.log(`⏱️ [${elapsed(t0)}] model_start iteration=${iterations} stream=true`);

    const toolCallsMap: ToolCallAccumulator = new Map();
    let emittedText = false;
    let firstProviderEvent = false;
    let answeringPhaseEmitted = false;
    let voiceText = '';
    for await (const event of modelEngine.stream({
      model: 'gpt-4o-mini',
      messages: apiMessages,
      tools: toolSchemas as unknown as ModelEngineTool[],
      toolChoice,
      temperature: iterations < 5 ? 0.3 : 0.7,
      signal,
    })) {
      if (!firstProviderEvent && event.type !== 'done') {
        firstProviderEvent = true;
        console.log(`⏱️ [${elapsed(t0)}] first_provider_token`);
      }
      if (event.type === 'text_delta' && event.text) {
        emittedText = true;
        if (isVoiceMode) {
          voiceText += event.text;
        } else {
          if (!answeringPhaseEmitted) {
            answeringPhaseEmitted = true;
            yield { type: 'phase', phase: 'answering' };
          }
          yield { type: 'text', text: event.text };
        }
      } else if (event.type === 'tool_call_delta') {
        applyToolCallDelta(toolCallsMap, event);
      }
    }

    if (toolCallsMap.size > 0) {
      assertNotAborted();
      const assistantMessage = assistantMessageFromToolCalls(toolCallsMap);
      const toolNames = assistantMessage.toolCalls?.map((toolCall: ModelEngineToolCall) => toolCall.name).join(', ') || 'tool';
      yield { type: 'phase', phase: 'tool', label: `Using ${toolNames}...` };
      console.log(`⏱️ [${elapsed(t0)}] 🔧 Tool loop iteration ${iterations}:`, toolNames);
      await executeAssistantToolCalls(t0, apiMessages, assistantMessage, toolResults, dispatchContext);

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

    if (!emittedText) {
      console.log(`⏱️ [${elapsed(t0)}] model stream empty`);
      yield { type: 'text', text: 'I was unable to process your request.' };
      return;
    }
    if (isVoiceMode) {
      yield { type: 'phase', phase: 'answering' };
      yield {
        type: 'text',
        text: applyVoiceMode(voiceText || 'I was unable to process your request.', toolResults, true),
      };
    }
    return;
  }

  yield { type: 'text', text: 'I was unable to process your request.' };
}
