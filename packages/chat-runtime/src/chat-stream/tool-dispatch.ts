import type OpenAI from 'openai';
import { dispatchToolCall, withToolErrorHandling } from '../runtime-tools.js';
import { toolSchemas } from '../tool-registry.js';
import type { ChatToolResults } from '../types.js';
import { elapsed, getOpenAIClient } from './shared.js';

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
        if (parsed.success) toolResults.calendarEvents = parsed;
        break;
      case 'logHabit':
      case 'createHabit':
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

export type ToolLoopResult = {
  assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessage;
  streamedSynthesisTokens: AsyncIterable<string> | null;
};

export async function runToolLoop(
  t0: number,
  apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  initialAssistantMessage: OpenAI.Chat.Completions.ChatCompletionMessage,
  toolResults: ChatToolResults,
  dispatchContext: ToolDispatchContext,
  isVoiceMode: boolean,
): Promise<ToolLoopResult> {
  let assistantMessage = initialAssistantMessage;
  let streamedSynthesisTokens: AsyncIterable<string> | null = null;
  let iterations = 0;

  while (assistantMessage.tool_calls && iterations < 5) {
    iterations++;
    console.log(
      `⏱️ [${elapsed(t0)}] 🔧 Tool loop iteration ${iterations}:`,
      assistantMessage.tool_calls.map(t => t.function.name),
    );

    apiMessages.push(assistantMessage);

    const tTools = performance.now();
    const toolCallResults = await Promise.all(
      assistantMessage.tool_calls.map(async (toolCall) => {
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
            },
          ),
        );

        console.log(
          `⏱️ [${elapsed(t0)}] 📊 ${toolCall.function.name} done (${(performance.now() - tTool).toFixed(0)}ms, ${result.length} chars)`,
        );
        return { toolCall, result };
      }),
    );
    console.log(`⏱️ [${elapsed(t0)}] All tools done (parallel: ${(performance.now() - tTools).toFixed(0)}ms)`);

    for (const { toolCall, result } of toolCallResults) {
      collectToolResult(toolResults, toolCall.function.name, result);
      apiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }

    const hasNarrativeOverride =
      toolResults.dailyOverview?.success
      || toolResults.monthlyOverview?.success
      || toolResults.weeklyOverview?.success;
    const canStreamSynthesis = !isVoiceMode && !hasNarrativeOverride;

    console.log(`⏱️ [${elapsed(t0)}] OpenAI follow-up #${iterations} start (stream=${canStreamSynthesis})`);

    if (canStreamSynthesis) {
      const streamingResponse = await getOpenAIClient().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: apiMessages,
        tools: toolSchemas,
        tool_choice: 'auto',
        temperature: iterations < 4 ? 0.3 : 0.7,
        stream: true,
      });

      const iterator = streamingResponse[Symbol.asyncIterator]();
      const firstResult = await iterator.next();

      if (firstResult.done) {
        console.log(`⏱️ [${elapsed(t0)}] OpenAI follow-up #${iterations} empty stream`);
        assistantMessage = { role: 'assistant', content: 'I was unable to process your request.', refusal: null };
        break;
      }

      const firstChunk = firstResult.value;
      const isToolCallResponse = !!(firstChunk.choices[0]?.delta?.tool_calls);

      if (isToolCallResponse) {
        const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

        for (const tc of firstChunk.choices[0]?.delta?.tool_calls || []) {
          toolCallsMap.set(tc.index, {
            id: tc.id || '',
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '',
          });
        }

        let done = false;
        while (!done) {
          const next = await iterator.next();
          done = next.done || false;
          if (!done) {
            for (const tc of next.value.choices[0]?.delta?.tool_calls || []) {
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
        }

        assistantMessage = {
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
        console.log(
          `⏱️ [${elapsed(t0)}] OpenAI follow-up #${iterations} done (tool_calls: ${assistantMessage.tool_calls!.map(t => t.function.name).join(', ')})`,
        );
      } else {
        async function* yieldSynthesisTokens(): AsyncGenerator<string> {
          const firstContent = firstChunk.choices[0]?.delta?.content;
          if (firstContent) yield firstContent;

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

        streamedSynthesisTokens = yieldSynthesisTokens();
        console.log(`⏱️ [${elapsed(t0)}] OpenAI follow-up #${iterations} streaming text → client`);
        break;
      }
    } else {
      const response = await getOpenAIClient().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: apiMessages,
        tools: toolSchemas,
        tool_choice: 'auto',
        temperature: iterations < 4 ? 0.3 : 0.7,
      });
      assistantMessage = response.choices[0].message;
      console.log(`⏱️ [${elapsed(t0)}] OpenAI follow-up #${iterations} done (non-streaming)`);
    }
  }

  return { assistantMessage, streamedSynthesisTokens };
}
