import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';

// Tool definitions (single source of truth)
import { tools } from './tools';

// Executors
import {
  executeGetHabitStats,
  executeGetDailyBreakdown,
  executeGetCorrelation,
  executeListHabits,
  executeGetHabitTrends,
  executeGetHabitAnomalies,
  executeGetWeeklyOverview,
  executeGetDailyOverview,
  executeGetMonthlyOverview,
  executeSearchContextMemory as executeSearchContextMemoryFromExecutors,
  executeGetActivitySummary as executeGetActivitySummaryFromExecutors,
  executeGetComputerTimeSpentBreakdown as executeGetComputerTimeSpentBreakdownFromExecutors,
  executeSearchScreenRecordings as executeSearchScreenRecordingsFromExecutors,
  executeGetDailyBiometrics,
  executeGetScreenTimeSummary,
  executeGetCalendarEvents,
  inferScreenDaysBackFromQuery,
} from './executors';

// Narrative builders
import {
  buildContextMemoryNarrative,
  streamWeeklyOverviewNarrative,
  inferRecapAnchorDate,
  buildCalendarStyleActivitySummary,
  buildRichActivitySummaryFromStoryPlan,
} from './narrative';
import type { WeeklyOverviewPayload } from './narrative';

// Query classifiers & system prompt
import {
  isComprehensiveWeeklyRecapQuery,
  isDailyOverviewQuery,
  isMonthlyOverviewQuery,
  isExplicitLastWeekQuery,
  isScreenTimeSpentQuery,
  isBroadScreenOverviewQuery,
  isContextMemoryRecapQuery,
  resolveWeeklyOverviewParamsFromQuery,
  getOverviewTitleFromQuery,
  chooseScreenSearchQuery,
} from './query-classifier';
import { buildSystemPrompt } from './system-prompt';

// Stream response & types
import { createChatStreamResponse } from './stream-response';
import type { StreamSource } from './stream-response';
import type {
  ChatToolResults,
  ScreenRecordingResult,
  ScreenSearchContext,
} from './types';

// Voice mode & persistence
import { formatVoiceResponse, generateReplyChips } from './voice';
import { createConversation, saveMessage } from './persistence';

// Thin wrappers that inject orchestrator-local dependencies into extracted executors
async function executeSearchContextMemory(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
): Promise<string> {
  return executeSearchContextMemoryFromExecutors(token, params);
}

async function executeGetComputerTimeSpentBreakdown(
  token: string,
  params: { query: string; daysBack?: number; limit?: number; groupBy?: 'app' | 'window' | 'domain' },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
  timezone?: string,
): Promise<string> {
  return executeGetComputerTimeSpentBreakdownFromExecutors(token, params, prefetchedScreenSearchContext, timezone);
}

async function executeGetActivitySummary(
  token: string,
  params: { query?: string; daysBack?: number },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
  timezone?: string,
) {
  return executeGetActivitySummaryFromExecutors(
    token,
    params,
    prefetchedScreenSearchContext,
    timezone,
    inferRecapAnchorDate,
    buildCalendarStyleActivitySummary,
    buildRichActivitySummaryFromStoryPlan,
    isScreenTimeSpentQuery,
  );
}

async function executeSearchScreenRecordings(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
): Promise<string> {
  return executeSearchScreenRecordingsFromExecutors(
    token,
    params,
    prefetchedScreenSearchContext,
    isScreenTimeSpentQuery,
    isBroadScreenOverviewQuery,
  );
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAI({ apiKey });
}

function buildCanvasToolPayload(toolResults: ChatToolResults): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {
    stats: toolResults.stats,
    dailyBreakdown: toolResults.dailyBreakdown,
    dailyBreakdownHabit: toolResults.dailyBreakdownHabit,
    correlation: toolResults.correlation,
    trends: toolResults.trends,
    anomalies: toolResults.anomalies,
    screenTimeSpent: toolResults.screenTimeSpent,
    weeklyOverview: toolResults.weeklyOverview,
    dailyOverview: toolResults.dailyOverview,
    monthlyOverview: toolResults.monthlyOverview,
    allStats: toolResults.allStats,
    allBreakdowns: toolResults.allBreakdowns,
    activitySummary: toolResults.activitySummary,
    dailyBiometrics: toolResults.dailyBiometrics,
    screenTimeSummary: toolResults.screenTimeSummary,
    calendarEvents: toolResults.calendarEvents,
    suggested_followups: toolResults.suggested_followups,
    reply_chips: toolResults.reply_chips,
  };

  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (value === undefined || value === null) {
      delete payload[key];
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      delete payload[key];
    }
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

// ====================
// HELPERS
// ====================

// Tool definitions imported from ./tools (see tools.ts)

function normalizeScreenSearchContext(
  screenSearchResults: unknown,
  legacyScreenRecordingResults: unknown,
): ScreenSearchContext | null {
  if (screenSearchResults && typeof screenSearchResults === 'object' && 'results' in (screenSearchResults as Record<string, unknown>)) {
    return screenSearchResults as ScreenSearchContext;
  }

  if (Array.isArray(legacyScreenRecordingResults)) {
    return {
      modeUsed: 'hybrid',
      status: 'hybrid',
      results: legacyScreenRecordingResults as ScreenRecordingResult[],
    };
  }

  return null;
}

// ====================
// PARALLEL TOOL DISPATCH (Phase 4)
// ====================

/** Context passed to dispatchToolCall so each tool has the info it needs. */
interface ToolExecutionContext {
  timezone?: string;
  normalizedScreenSearchContext: ScreenSearchContext | null;
  localOverviewActivity?: unknown;
  latestUserContent: string;
  weeklyOverviewQueryParams: { startDate?: string; endDate?: string; daysBack?: number; strictThisWeek?: boolean };
  strictThisWeekForWeeklyOverview?: boolean;
}

/**
 * Wrap a tool executor so that any thrown error is returned as a JSON
 * error string instead of blowing up the whole tool loop. OpenAI sees
 * the error message and can decide how to proceed.
 */
async function withToolErrorHandling(
  name: string,
  fn: () => Promise<string>,
): Promise<string> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Tool "${name}" failed:`, msg);
    return JSON.stringify({ error: `Tool ${name} failed: ${msg}` });
  }
}

/**
 * Execute a single tool call. Pure dispatch — no side effects on toolResults.
 * Returns the raw JSON string to send back to OpenAI.
 */
async function dispatchToolCall(
  name: string,
  token: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<string> {
  // Args come from JSON.parse(toolCall.function.arguments) — OpenAI guarantees
  // they match the tool schema, so we cast to the expected parameter types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = args as any;
  switch (name) {
    case 'getHabitStats':
      return executeGetHabitStats(token, a);
    case 'getDailyBreakdown':
      return executeGetDailyBreakdown(token, a, ctx.timezone);
    case 'getCorrelation':
      return executeGetCorrelation(token, a);
    case 'listHabits':
      return executeListHabits(token);
    case 'getHabitTrends':
      return executeGetHabitTrends(token, a);
    case 'getWeeklyOverview':
      return executeGetWeeklyOverview(
        token,
        {
          ...a,
          startDate: a?.startDate || ctx.weeklyOverviewQueryParams.startDate,
          endDate: a?.endDate || ctx.weeklyOverviewQueryParams.endDate,
          daysBack: a?.daysBack ?? ctx.weeklyOverviewQueryParams.daysBack,
        },
        ctx.timezone,
        ctx.strictThisWeekForWeeklyOverview,
        ctx.localOverviewActivity,
      );
    case 'getDailyOverview':
      return executeGetDailyOverview(token, a, ctx.timezone, ctx.localOverviewActivity);
    case 'getMonthlyOverview':
      return executeGetMonthlyOverview(token, a, ctx.timezone, ctx.localOverviewActivity);
    case 'getHabitAnomalies':
      return executeGetHabitAnomalies(token, a);
    case 'searchScreenRecordings':
      return executeSearchContextMemory(token, {
        ...a,
        query: chooseScreenSearchQuery(a?.query, ctx.latestUserContent),
      });
    case 'searchContextMemory': {
      const normalizedArgs = {
        ...a,
        query: chooseScreenSearchQuery(a?.query, ctx.latestUserContent),
        limit: Math.max((a?.limit as number) || 0, 30),
        daysBack: Math.max((a?.daysBack as number) || 0, 1),
      };
      let result = await executeSearchContextMemory(token, normalizedArgs);
      // Trim the result for the LLM: keep story_plan but drop raw results
      // to avoid flooding GPT-4o-mini's context with screen dumps
      try {
        const parsed = JSON.parse(result);
        if (parsed.success && parsed.story_plan) {
          const richContextNarrative = buildContextMemoryNarrative(
            {
              success: parsed.success,
              story_plan: parsed.story_plan,
              renderer: parsed.renderer || null,
              results: Array.isArray(parsed.results) ? parsed.results : [],
            },
            normalizedArgs.query as string,
            ctx.timezone,
          );
          result = JSON.stringify({
            success: parsed.success,
            story_plan: parsed.story_plan,
            renderer: parsed.renderer || null,
            rich_context_narrative: richContextNarrative,
            result_count: Array.isArray(parsed.results) ? parsed.results.length : 0,
            message: parsed.message,
          });
        }
      } catch (e) { console.warn('⚠️ Context memory trim error:', e); }
      return result;
    }
    case 'getComputerTimeSpentBreakdown':
      return executeGetComputerTimeSpentBreakdown(token, a, ctx.normalizedScreenSearchContext, ctx.timezone);
    case 'getActivitySummary':
      return executeGetActivitySummary(token, {
        ...a,
        query: chooseScreenSearchQuery(a?.query, ctx.latestUserContent),
      }, ctx.normalizedScreenSearchContext, ctx.timezone);
    case 'getDailyBiometrics':
      return executeGetDailyBiometrics(token, a, ctx.timezone);
    case 'getScreenTimeSummary':
      return executeGetScreenTimeSummary(token, a, ctx.timezone);
    case 'getCalendarEvents':
      return executeGetCalendarEvents(token, a, ctx.timezone);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

/**
 * Parse a tool's raw JSON result and update the shared toolResults object.
 * Called sequentially after parallel dispatch so accumulation order is stable.
 */
function collectToolResult(toolResults: ChatToolResults, name: string, raw: string): void {
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
        // No canvas state to update
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
      case 'searchScreenRecordings':
        console.log('🖥️ screen tool parsed status:', {
          success: parsed?.success,
          result_count: parsed?.result_count,
          status: parsed?.status,
          mode_used: parsed?.mode_used,
        });
        if (parsed.success && parsed.results) toolResults.screenRecordings = parsed;
        break;
      case 'searchContextMemory':
        if (parsed.success && (parsed.results || parsed.story_plan)) toolResults.contextMemoryRecap = parsed;
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
      default:
        break;
    }
  } catch (e) {
    console.warn('⚠️ Tool result parse error:', e);
  }
}

// ====================
// MAIN API HANDLER
// ====================

export async function handleChatStreamPost(req: NextRequest) {
  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    const headerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;
    let token: string | null = null;
    
    try {
      const authResult = await auth();
      // Always prefer a fresh server-side Clerk token when available.
      if (authResult.userId) {
        const freshToken = await authResult.getToken();
        token = freshToken || headerToken;
      } else {
        token = headerToken;
      }
    } catch {
      token = headerToken;
    }

    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const {
      messages,
      timezone,
      conversationId: providedConversationId,
      responseMode = 'text',
      screenSearchResults,
      screenRecordingResults,
      localOverviewActivity,
    } = await req.json();
    const normalizedScreenSearchContext = normalizeScreenSearchContext(screenSearchResults, screenRecordingResults);
    
    // Get or create conversation ID for persistence
    let conversationId = providedConversationId;
    if (!conversationId) {
      conversationId = await createConversation(token);
      console.log('📝 New conversation created:', conversationId);
    }
    
    // Determine if we're in voice mode
    const isVoiceMode = responseMode === 'voice';
    console.log(`🎤 Response mode: ${responseMode}`);
    
    // Get the latest user message to save
    const latestUserMessage = messages[messages.length - 1];
    
    // Save the user message to the conversation (don't block on this)
    if (conversationId && latestUserMessage?.role === 'user') {
      // Fire and forget - don't block the response
      saveMessage(token, conversationId, 'user', latestUserMessage.content).catch(err => {
        console.error('❌ Failed to save user message:', err);
      });
    }
    
    const now = new Date();
    // Use local date components, NOT toISOString() which converts to UTC
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-indexed
    const day = now.getDate();
    const today = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const currentYear = year;

    // Build the full system prompt
    const fullSystemPrompt = buildSystemPrompt({
      timezone: timezone || 'UTC',
      today,
      currentYear,
      isVoiceMode,
    });
    const latestUserContent = latestUserMessage?.content || '';
    const forceScreenTimeBreakdown = isScreenTimeSpentQuery(latestUserContent);
    const forceContextRecap = !forceScreenTimeBreakdown && isContextMemoryRecapQuery(latestUserContent);
    const forceDailyOverview = isDailyOverviewQuery(latestUserContent);
    const forceMonthlyOverview = !forceDailyOverview && isMonthlyOverviewQuery(latestUserContent);
    const forceWeeklyOverview =
      !forceContextRecap &&
      !forceDailyOverview &&
      !forceMonthlyOverview &&
      isComprehensiveWeeklyRecapQuery(latestUserContent);
    const forcedToolName = forceScreenTimeBreakdown
      ? 'getComputerTimeSpentBreakdown'
      : forceContextRecap
        ? 'getActivitySummary'
      : forceDailyOverview
        ? 'getDailyOverview'
        : forceMonthlyOverview
          ? 'getMonthlyOverview'
          : forceWeeklyOverview
            ? 'getWeeklyOverview'
            : null;
    const weeklyOverviewQueryParams = resolveWeeklyOverviewParamsFromQuery(latestUserContent, timezone);
    const strictThisWeekForWeeklyOverview = weeklyOverviewQueryParams.strictThisWeek;

    // Fast path: for deterministic recap tools in text mode, skip OpenAI and
    // render directly from the tool payload so routing and structure stay stable.
    const deterministicFastPath =
      !isVoiceMode &&
      forcedToolName &&
      ['getWeeklyOverview', 'getDailyOverview', 'getMonthlyOverview', 'getActivitySummary'].includes(forcedToolName);

    if (deterministicFastPath) {
      console.log(`⚡ Fast-path: skipping OpenAI, executing ${forcedToolName} directly`);

      const toolResults: ChatToolResults = { allStats: [], allBreakdowns: [] };
      let toolResultJson: string;

      switch (forcedToolName) {
        case 'getWeeklyOverview':
          toolResultJson = await executeGetWeeklyOverview(
            token,
            {
              daysBack: weeklyOverviewQueryParams.daysBack,
              startDate: weeklyOverviewQueryParams.startDate,
              endDate: weeklyOverviewQueryParams.endDate,
            },
            timezone,
            strictThisWeekForWeeklyOverview,
            localOverviewActivity,
          );
          break;
        case 'getDailyOverview':
          toolResultJson = await executeGetDailyOverview(token, {}, timezone, localOverviewActivity);
          break;
        case 'getMonthlyOverview':
          toolResultJson = await executeGetMonthlyOverview(token, {}, timezone, localOverviewActivity);
          break;
        case 'getActivitySummary':
          toolResultJson = await executeGetActivitySummary(
            token,
            {
              query: latestUserContent,
              daysBack: inferScreenDaysBackFromQuery(latestUserContent, 7),
            },
            normalizedScreenSearchContext,
            timezone,
          );
          break;
        default:
          toolResultJson = JSON.stringify({ success: false, error: 'Unknown overview tool' });
      }

      try {
        const parsed = JSON.parse(toolResultJson);
          if (parsed.success) {
            if (forcedToolName === 'getWeeklyOverview') toolResults.weeklyOverview = parsed;
            else if (forcedToolName === 'getDailyOverview') toolResults.dailyOverview = parsed;
            else if (forcedToolName === 'getActivitySummary') toolResults.activitySummary = parsed;
            else toolResults.monthlyOverview = parsed;

          if (parsed.suggested_followups) {
            toolResults.suggested_followups = parsed.suggested_followups;
          }
        }
      } catch (e) { console.warn('⚠️ Tool result parse error:', e); }

      const title = getOverviewTitleFromQuery(
        forcedToolName,
        latestUserContent,
        toolResults.activitySummary || toolResults.contextMemoryRecap,
        timezone,
      );

      const overviewPayload =
        toolResults.weeklyOverview
        || toolResults.dailyOverview
        || toolResults.monthlyOverview
        || toolResults.activitySummary
        || toolResults.contextMemoryRecap;

      const canvasToolPayload = buildCanvasToolPayload(toolResults);
      console.log('📦 Tool results collected:', Object.keys(toolResults));
      console.log('📦 Canvas payload keys:', Object.keys(canvasToolPayload || {}));

      // Determine stream source: real-stream the synthesis call, fake-stream pre-built text
      let streamSource: StreamSource;

      if (!overviewPayload?.success) {
        streamSource = { type: 'complete', text: 'I was unable to retrieve your data. Please try again.' };
      } else if (forcedToolName === 'getActivitySummary') {
        // Activity summaries have pre-built narrative text — fake-stream it
        const activityText =
          (typeof toolResults.activitySummary?.rich_activity_summary === 'string'
            && toolResults.activitySummary.rich_activity_summary.trim().length > 0)
            ? toolResults.activitySummary.rich_activity_summary.trim()
            : (typeof toolResults.activitySummary?.calendar_style_summary === 'string'
                && toolResults.activitySummary.calendar_style_summary.trim().length > 0)
              ? toolResults.activitySummary.calendar_style_summary.trim()
              : buildContextMemoryNarrative(overviewPayload, latestUserContent, timezone);
        streamSource = { type: 'complete', text: activityText };
      } else {
        // Overview queries (weekly/daily/monthly) — real-stream the synthesis call
        console.log('🌊 Real-streaming synthesis call for', forcedToolName);
        streamSource = {
          type: 'stream',
          tokens: streamWeeklyOverviewNarrative(overviewPayload as WeeklyOverviewPayload, title),
        };
      }

      // For pre-built text, save immediately; for real streams, save after completion
      if (streamSource.type === 'complete' && conversationId) {
        saveMessage(token, conversationId, 'assistant', streamSource.text, canvasToolPayload).catch(err => {
          console.error('❌ Failed to save assistant message:', err);
        });
      }

      return createChatStreamResponse({
        conversationId,
        source: streamSource,
        canvasToolPayload,
        onComplete: streamSource.type === 'stream' && conversationId
          ? (fullText) => {
              saveMessage(token, conversationId, 'assistant', fullText, canvasToolPayload).catch(err => {
                console.error('❌ Failed to save assistant message:', err);
              });
            }
          : undefined,
      });
    }

    // Build messages for OpenAI
    const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // Call OpenAI — low temperature for reliable tool selection
    let response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: apiMessages,
      tools,
      tool_choice: forcedToolName
        ? { type: 'function', function: { name: forcedToolName } }
        : 'auto',
      temperature: 0.3,
    });

    let assistantMessage = response.choices[0].message;

    // Collect tool results for frontend canvas
    // Note: For multi-habit/multi-period queries, we accumulate results
    const toolResults: ChatToolResults = {
      allStats: [],
      allBreakdowns: []
    };

    // Handle tool calls (loop up to 5 times for complex queries)
    let iterations = 0;
    while (assistantMessage.tool_calls && iterations < 5) {
      iterations++;
      console.log(`🔧 Tool call iteration ${iterations}:`, assistantMessage.tool_calls.map(t => t.function.name));
      
      apiMessages.push(assistantMessage);

      // Execute all tool calls in parallel for better latency
      const toolCallResults = await Promise.all(
        assistantMessage.tool_calls.map(async (toolCall) => {
          const args = JSON.parse(toolCall.function.arguments || '{}');
          const result = await withToolErrorHandling(
            toolCall.function.name,
            () => dispatchToolCall(
              toolCall.function.name, token, args,
              { timezone, normalizedScreenSearchContext, localOverviewActivity, latestUserContent, weeklyOverviewQueryParams, strictThisWeekForWeeklyOverview },
            ),
          );

          console.log(`📊 Tool ${toolCall.function.name} result length:`, result.length);
          return { toolCall, result };
        })
      );

      // Process results sequentially (accumulation order matters for allStats/allBreakdowns)
      for (const { toolCall, result } of toolCallResults) {
        collectToolResult(toolResults, toolCall.function.name, result);
        apiMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      // Follow-up call: 0.3 if still selecting tools, 0.7 for final freeform answer
      response = await getOpenAIClient().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: apiMessages,
        tools,
        tool_choice: 'auto',
        temperature: iterations < 4 ? 0.3 : 0.7,
      });

      assistantMessage = response.choices[0].message;
    }

    let finalText = assistantMessage.content || 'I was unable to process your request.';
    
    // Apply voice mode post-processing (Phase 4A)
    if (isVoiceMode) {
      console.log('🎤 Applying voice mode post-processing');
      finalText = formatVoiceResponse(finalText);
      
      // Generate reply chips for voice mode
      const replyChips = generateReplyChips(toolResults);
      toolResults.reply_chips = replyChips;
      console.log('💬 Generated reply chips:', replyChips);
    }

    // Determine stream source: real-stream overview synthesis, fake-stream everything else.
    // Check for narrative overrides that replace OpenAI's text with a dedicated synthesis pass.
    let streamSource: StreamSource;

    if (!isVoiceMode && toolResults.dailyOverview?.success) {
      console.log('🌊 Real-streaming synthesis call for dailyOverview');
      streamSource = {
        type: 'stream',
        tokens: streamWeeklyOverviewNarrative(toolResults.dailyOverview as WeeklyOverviewPayload, 'Daily Activity Overview'),
      };
    } else if (!isVoiceMode && toolResults.monthlyOverview?.success) {
      console.log('🌊 Real-streaming synthesis call for monthlyOverview');
      streamSource = {
        type: 'stream',
        tokens: streamWeeklyOverviewNarrative(toolResults.monthlyOverview as WeeklyOverviewPayload, 'Monthly Activity Overview'),
      };
    } else if (!isVoiceMode && toolResults.weeklyOverview?.success) {
      console.log('🌊 Real-streaming synthesis call for weeklyOverview');
      streamSource = {
        type: 'stream',
        tokens: streamWeeklyOverviewNarrative(toolResults.weeklyOverview as WeeklyOverviewPayload, 'Weekly Activity Overview'),
      };
    } else {
      // Pre-built text overrides (activity summaries) or plain OpenAI response
      if (
        !isVoiceMode
        && typeof toolResults.activitySummary?.rich_activity_summary === 'string'
        && toolResults.activitySummary.rich_activity_summary.trim().length > 0
      ) {
        finalText = toolResults.activitySummary.rich_activity_summary.trim();
      } else if (
        !isVoiceMode
        && typeof toolResults.activitySummary?.calendar_style_summary === 'string'
        && toolResults.activitySummary.calendar_style_summary.trim().length > 0
      ) {
        finalText = toolResults.activitySummary.calendar_style_summary.trim();
      }
      streamSource = { type: 'complete', text: finalText };
    }

    // Merge breakdown data if multiple calls were made for the same habit
    if (toolResults.allBreakdowns && toolResults.allBreakdowns.length > 1) {
      const habitIds = toolResults.allBreakdowns.map(b => b.habit?.id).filter(Boolean);
      const uniqueHabitIds = [...new Set(habitIds)];

      if (uniqueHabitIds.length === 1) {
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
    }

    const canvasToolPayload = buildCanvasToolPayload(toolResults);
    console.log('📦 Tool results collected:', Object.keys(toolResults));
    console.log('📦 Canvas payload keys:', Object.keys(canvasToolPayload || {}));

    // For pre-built text, save immediately; for real streams, save after completion
    if (streamSource.type === 'complete' && conversationId) {
      saveMessage(token, conversationId, 'assistant', streamSource.text, canvasToolPayload).catch(err => {
        console.error('❌ Failed to save assistant message:', err);
      });
    }

    return createChatStreamResponse({
      conversationId,
      source: streamSource,
      canvasToolPayload,
      onComplete: streamSource.type === 'stream' && conversationId
        ? (fullText) => {
            saveMessage(token, conversationId, 'assistant', fullText, canvasToolPayload).catch(err => {
              console.error('❌ Failed to save assistant message:', err);
            });
          }
        : undefined,
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ 
      error: 'Error processing request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
