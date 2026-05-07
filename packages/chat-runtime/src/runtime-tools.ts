import OpenAI from 'openai';

import {
  executeGetHabitStats,
  executeGetDailyBreakdown,
  executeGetCorrelation,
  executeListHabits,
  executeGetHabitTrends,
  executeGetHabitAnomalies,
  executeGetStreaks,
  executeLogHabit,
  executeCreateHabit,
  executeGetWeeklyOverview,
  executeGetDailyOverview,
  executeGetMonthlyOverview,
  executeGetActivitySummary as executeGetActivitySummaryFromExecutors,
  executeGetComputerTimeSpentBreakdown as executeGetComputerTimeSpentBreakdownFromExecutors,
  executeGetDailyBiometrics,
  executeGetScreenTimeSummary,
  executeGetCalendarEvents,
  executeGetSmsPreferences,
  executeUpdateSmsPreferences,
} from './executors/index.js';
import {
  inferRecapAnchorDate,
  buildCalendarStyleActivitySummary,
} from './narrative/index.js';

// ---------------------------------------------------------------------------
// Timing helper — logs elapsed ms since a start timestamp
// ---------------------------------------------------------------------------
export function elapsed(startMs: number): string {
  return `${(performance.now() - startMs).toFixed(0)}ms`;
}

async function executeGetComputerTimeSpentBreakdown(
  token: string,
  params: { query: string; daysBack?: number; limit?: number; groupBy?: 'app' | 'window' | 'domain' },
  timezone?: string,
): Promise<string> {
  return executeGetComputerTimeSpentBreakdownFromExecutors(token, params, timezone);
}

async function executeGetActivitySummary(
  token: string,
  params: { query?: string; daysBack?: number },
  timezone?: string,
) {
  return executeGetActivitySummaryFromExecutors(
    token,
    params,
    timezone,
    inferRecapAnchorDate,
    buildCalendarStyleActivitySummary,
  );
}

// Singleton OpenAI client — reuses TCP/TLS connections across requests
// instead of paying ~1-2s cold handshake per request.
let _openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}

export function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ====================
// HELPERS
// ====================

// Tool definitions imported from ./tools (see tools.ts)

// ====================
// PARALLEL TOOL DISPATCH (Phase 4)
// ====================

/** Context passed to dispatchToolCall so each tool has the info it needs. */
export interface ToolExecutionContext {
  timezone?: string;
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
export async function withToolErrorHandling(
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
export async function dispatchToolCall(
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
    case 'getStreaks':
      return executeGetStreaks(token, a);
    case 'getComputerTimeSpentBreakdown':
      return executeGetComputerTimeSpentBreakdown(token, a, ctx.timezone);
    case 'getActivitySummary':
      {
        const result = await executeGetActivitySummary(token, {
        ...a,
        query: String(a?.query || ctx.latestUserContent || 'activity summary'),
        }, ctx.timezone);
        try {
          const parsed = JSON.parse(result);
          if (parsed.success) {
            return JSON.stringify({
              success: parsed.success,
              query: parsed.query,
              intent_resolved: parsed.intent_resolved,
              retrieval_tier: parsed.retrieval_tier,
              citations: Array.isArray(parsed.citations) ? parsed.citations : [],
              citations_count: parsed.citations_count,
              workstreams: Array.isArray(parsed.workstreams) ? parsed.workstreams : [],
              time_truth: parsed.time_truth || null,
              confidence: parsed.confidence || null,
              freshness: parsed.freshness || null,
              calendar_style_summary: parsed.calendar_style_summary || null,
              retrieval_debug: parsed.retrieval_debug || null,
              provider_path: parsed.provider_path || null,
            });
          }
        } catch (e) { console.warn('⚠️ Activity summary trim error:', e); }
        return result;
      }
    case 'getDailyBiometrics':
      return executeGetDailyBiometrics(token, a, ctx.timezone);
    case 'getScreenTimeSummary':
      return executeGetScreenTimeSummary(token, a, ctx.timezone);
    case 'getCalendarEvents':
      return executeGetCalendarEvents(token, a, ctx.timezone);
    case 'logHabit':
      return executeLogHabit(token, a, ctx.timezone);
    case 'createHabit':
      return executeCreateHabit(token, a);
    case 'getSmsPreferences':
      return executeGetSmsPreferences(token);
    case 'updateSmsPreferences':
      return executeUpdateSmsPreferences(token, a);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

