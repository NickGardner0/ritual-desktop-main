import {
  executeGetWeeklyOverview,
  executeGetDailyOverview,
  executeGetMonthlyOverview,
  executeGetActivitySummary as executeGetActivitySummaryFromExecutors,
  executeGetDailyBiometrics,
  executeGetCalendarEvents,
} from '../executors/index.js';
import {
  streamWeeklyOverviewNarrative,
  inferRecapAnchorDate,
  buildCalendarStyleActivitySummary,
  buildRichActivitySummaryFromStoryPlan,
} from '../narrative/index.js';
import type { WeeklyOverviewPayload } from '../narrative/index.js';
import { isComprehensiveWeeklyRecapQuery, getOverviewTitleFromQuery } from '../query-classifier.js';
import { createChatStreamResponse } from '../stream-response.js';
import type { StreamSource } from '../stream-response.js';
import type {
  ActivitySummaryResult,
  BiometricsResult,
  CalendarEventsResult,
  ChatToolResults,
  OverviewResult,
} from '../types.js';
import { formatVoiceResponse, generateReplyChips } from '../voice.js';
import { saveMessage } from '../persistence.js';
import type { ForcedOverviewTool } from './classifier-router.js';
import { buildCanvasToolPayload, elapsed, safeJsonParse } from './shared.js';

export async function executeGetActivitySummary(
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

export async function* streamDeferredOverviewNarrative(
  payloadPromise: Promise<{
    payload: WeeklyOverviewPayload | null;
    title: string;
  }>,
): AsyncGenerator<string> {
  const { payload, title } = await payloadPromise;
  if (!payload?.success) {
    yield 'I was unable to retrieve your data. Please try again.';
    return;
  }

  for await (const token of streamWeeklyOverviewNarrative(payload, title)) {
    yield token;
  }
}

async function enrichActivitySummaryContext(
  token: string,
  activitySummary: ActivitySummaryResult | undefined,
  latestUserContent: string,
  timezone?: string,
): Promise<{
  activitySummary?: ActivitySummaryResult;
  dailyBiometrics?: BiometricsResult;
  calendarEvents?: CalendarEventsResult;
}> {
  if (!activitySummary?.success) {
    return {};
  }

  const anchorDay =
    (typeof activitySummary.calendar_style_date === 'string' && activitySummary.calendar_style_date.trim()) ||
    (typeof activitySummary.end_date === 'string' && activitySummary.end_date.trim()) ||
    inferRecapAnchorDate(latestUserContent, Number(activitySummary.days_back || 1), timezone) ||
    undefined;

  const startDate =
    (typeof activitySummary.start_date === 'string' && activitySummary.start_date.trim()) ||
    anchorDay ||
    undefined;
  const endDate =
    (typeof activitySummary.end_date === 'string' && activitySummary.end_date.trim()) ||
    anchorDay ||
    startDate ||
    undefined;

  const [dailyBiometricsRaw, calendarEventsRaw] = await Promise.all([
    anchorDay
      ? executeGetDailyBiometrics(token, { day: anchorDay }, timezone)
      : Promise.resolve(JSON.stringify({ success: false, error: 'No recap anchor day resolved.' })),
    (startDate && endDate)
      ? executeGetCalendarEvents(token, { startDate, endDate }, timezone)
      : Promise.resolve(JSON.stringify({ success: false, error: 'No recap date range resolved.' })),
  ]);

  const dailyBiometrics = safeJsonParse<BiometricsResult>(dailyBiometricsRaw) || undefined;
  const calendarEvents = safeJsonParse<CalendarEventsResult>(calendarEventsRaw) || undefined;

  const enrichedActivitySummary: ActivitySummaryResult = {
    ...activitySummary,
    daily_biometrics: dailyBiometrics?.success ? dailyBiometrics : null,
    calendar_events: calendarEvents?.success ? calendarEvents : null,
  };

  const enrichedNarrative = await buildRichActivitySummaryFromStoryPlan(
    {
      success: true,
      results: [],
      citations: enrichedActivitySummary.citations || [],
      daily_biometrics: dailyBiometrics?.success ? dailyBiometrics : null,
      calendar_events: calendarEvents?.success ? calendarEvents : null,
    },
    latestUserContent,
    timezone,
    enrichedActivitySummary.calendar_style_summary,
  );

  if (enrichedNarrative && enrichedNarrative.trim().length > 0) {
    enrichedActivitySummary.rich_activity_summary = enrichedNarrative.trim();
  }

  return {
    activitySummary: enrichedActivitySummary,
    dailyBiometrics: dailyBiometrics?.success ? dailyBiometrics : undefined,
    calendarEvents: calendarEvents?.success ? calendarEvents : undefined,
  };
}

export async function tryEnrichActivitySummaryContext(
  token: string,
  activitySummary: ActivitySummaryResult | undefined,
  latestUserContent: string,
  timezone?: string,
) {
  try {
    return await enrichActivitySummaryContext(token, activitySummary, latestUserContent, timezone);
  } catch (error) {
    console.error('⚠️ Activity summary enrichment failed open:', error);
    return { activitySummary };
  }
}

async function executeForcedOverviewTool(
  forcedToolName: ForcedOverviewTool,
  token: string,
  latestUserContent: string,
  timezone: string | undefined,
  weeklyOverviewQueryParams: {
    daysBack?: number;
    startDate?: string;
    endDate?: string;
  },
  strictThisWeekForWeeklyOverview: boolean,
  localOverviewActivity: unknown,
): Promise<string> {
  switch (forcedToolName) {
    case 'getWeeklyOverview':
      return executeGetWeeklyOverview(
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
    case 'getDailyOverview':
      return executeGetDailyOverview(token, {}, timezone, localOverviewActivity);
    case 'getMonthlyOverview':
      return executeGetMonthlyOverview(token, {}, timezone, localOverviewActivity);
    case 'getActivitySummary':
      return executeGetActivitySummary(
        token,
        {
          query: latestUserContent,
          daysBack: isComprehensiveWeeklyRecapQuery(latestUserContent) ? 7 : 1,
        },
        timezone,
      );
    default:
      return JSON.stringify({ success: false, error: 'Unknown overview tool' });
  }
}

function applyOverviewToolResult(
  forcedToolName: ForcedOverviewTool,
  toolResults: ChatToolResults,
  parsed: OverviewResult | ActivitySummaryResult,
): void {
  if (!parsed.success) return;

  if (forcedToolName === 'getWeeklyOverview') toolResults.weeklyOverview = parsed as OverviewResult;
  else if (forcedToolName === 'getDailyOverview') toolResults.dailyOverview = parsed as OverviewResult;
  else if (forcedToolName === 'getActivitySummary') toolResults.activitySummary = parsed as ActivitySummaryResult;
  else toolResults.monthlyOverview = parsed as OverviewResult;

  const followups = (parsed as OverviewResult).suggested_followups;
  if (Array.isArray(followups) && followups.length > 0) {
    toolResults.suggested_followups = followups;
  }
}

function buildFastPathStreamSource(
  forcedToolName: ForcedOverviewTool,
  toolResults: ChatToolResults,
  overviewPayload: OverviewResult | ActivitySummaryResult | undefined,
  title: string,
): StreamSource {
  if (!overviewPayload?.success) {
    return { type: 'complete', text: 'I was unable to retrieve your data. Please try again.' };
  }

  if (forcedToolName === 'getActivitySummary') {
    const activityText =
      (typeof toolResults.activitySummary?.rich_activity_summary === 'string'
        && toolResults.activitySummary.rich_activity_summary.trim().length > 0)
        ? toolResults.activitySummary.rich_activity_summary.trim()
        : (typeof toolResults.activitySummary?.calendar_style_summary === 'string'
            && toolResults.activitySummary.calendar_style_summary.trim().length > 0)
          ? toolResults.activitySummary.calendar_style_summary.trim()
          : String(toolResults.activitySummary?.rich_activity_summary || '');
    return { type: 'complete', text: activityText };
  }

  console.log('🌊 Real-streaming synthesis call for', forcedToolName);
  return {
    type: 'stream',
    tokens: streamWeeklyOverviewNarrative(overviewPayload as WeeklyOverviewPayload, title),
  };
}

export type FastPathParams = {
  t0: number;
  token: string;
  latestUserContent: string;
  timezone?: string;
  localOverviewActivity?: unknown;
  forcedToolName: ForcedOverviewTool;
  weeklyOverviewQueryParams: {
    daysBack?: number;
    startDate?: string;
    endDate?: string;
  };
  strictThisWeekForWeeklyOverview: boolean;
  deferredOverviewFastPath: boolean;
  immediateConversationId: string | null;
  deferredConversationIdPromise?: Promise<string | null>;
  conversationIdPromise: Promise<string | null>;
};

export async function handleDeterministicFastPath(params: FastPathParams): Promise<Response> {
  const {
    t0,
    token,
    latestUserContent,
    timezone,
    localOverviewActivity,
    forcedToolName,
    weeklyOverviewQueryParams,
    strictThisWeekForWeeklyOverview,
    deferredOverviewFastPath,
    immediateConversationId,
    deferredConversationIdPromise,
    conversationIdPromise,
  } = params;

  console.log(`⚡ [${elapsed(t0)}] Fast-path: skipping OpenAI, executing ${forcedToolName} directly`);

  const toolResults: ChatToolResults = { allStats: [], allBreakdowns: [] };

  if (deferredOverviewFastPath) {
    console.log(`⚡ [${elapsed(t0)}] Deferred overview streaming for ${forcedToolName}`);

    const title = getOverviewTitleFromQuery(forcedToolName, latestUserContent, undefined, timezone);

    const overviewResultPromise = (async () => {
      try {
        const toolResultJson = await executeForcedOverviewTool(
          forcedToolName,
          token,
          latestUserContent,
          timezone,
          weeklyOverviewQueryParams,
          strictThisWeekForWeeklyOverview,
          localOverviewActivity,
        );

        const parsed = safeJsonParse<OverviewResult>(toolResultJson);
        if (parsed?.success) {
          applyOverviewToolResult(forcedToolName, toolResults, parsed);
        }

        return {
          payload: parsed?.success ? (parsed as WeeklyOverviewPayload) : null,
          title,
          canvasToolPayload: buildCanvasToolPayload(toolResults),
        };
      } catch (error) {
        console.error('❌ Deferred overview tool failed:', error);
        return { payload: null, title, canvasToolPayload: null };
      }
    })();

    console.log(`⏱️ [${elapsed(t0)}] Deferred overview response created`);

    return createChatStreamResponse({
      conversationId: immediateConversationId,
      conversationIdPromise: deferredConversationIdPromise,
      source: {
        type: 'stream',
        tokens: streamDeferredOverviewNarrative(
          overviewResultPromise.then(({ payload, title: resolvedTitle }) => ({ payload, title: resolvedTitle })),
        ),
      },
      canvasToolPayload: null,
      canvasToolPayloadPromise: overviewResultPromise.then(({ canvasToolPayload }) => canvasToolPayload),
      prefaceLine: '__STREAM_OPEN__',
      onComplete: (fullText, finalCanvasToolPayload) => {
        conversationIdPromise.then((conversationId) => {
          if (!conversationId) return;
          console.log(`⏱️ [${elapsed(t0)}] Deferred overview stream complete (${fullText.length} chars)`);
          saveMessage(token, conversationId, 'assistant', fullText, finalCanvasToolPayload).catch(err => {
            console.error('❌ Failed to save assistant message:', err);
          });
        });
      },
    });
  }

  const toolResultJson = await executeForcedOverviewTool(
    forcedToolName,
    token,
    latestUserContent,
    timezone,
    weeklyOverviewQueryParams,
    strictThisWeekForWeeklyOverview,
    localOverviewActivity,
  );

  console.log(`⏱️ [${elapsed(t0)}] Fast-path tool executed`);
  try {
    const parsed = JSON.parse(toolResultJson);
    if (parsed.success) {
      applyOverviewToolResult(forcedToolName, toolResults, parsed);
    }
  } catch (e) {
    console.warn('⚠️ Tool result parse error:', e);
  }

  if (
    forcedToolName === 'getActivitySummary'
    && toolResults.activitySummary?.success
    && toolResults.activitySummary.retrieval_tier !== 'day_recap_bundle'
  ) {
    const recapEnrichment = await tryEnrichActivitySummaryContext(
      token,
      toolResults.activitySummary,
      latestUserContent,
      timezone,
    );
    if (recapEnrichment.activitySummary) toolResults.activitySummary = recapEnrichment.activitySummary;
    if (recapEnrichment.dailyBiometrics) toolResults.dailyBiometrics = recapEnrichment.dailyBiometrics;
    if (recapEnrichment.calendarEvents) toolResults.calendarEvents = recapEnrichment.calendarEvents;
  }

  const title = getOverviewTitleFromQuery(
    forcedToolName,
    latestUserContent,
    toolResults.activitySummary,
    timezone,
  );

  const overviewPayload =
    toolResults.weeklyOverview
    || toolResults.dailyOverview
    || toolResults.monthlyOverview
    || toolResults.activitySummary;

  const canvasToolPayload = buildCanvasToolPayload(toolResults);
  const streamSource = buildFastPathStreamSource(forcedToolName, toolResults, overviewPayload, title);

  if (streamSource.type === 'complete') {
    conversationIdPromise.then((conversationId) => {
      if (!conversationId) return;
      saveMessage(token, conversationId, 'assistant', streamSource.text, canvasToolPayload).catch(err => {
        console.error('❌ Failed to save assistant message:', err);
      });
    });
  }

  console.log(`⏱️ [${elapsed(t0)}] Fast-path streaming response created`);
  return createChatStreamResponse({
    conversationId: immediateConversationId,
    conversationIdPromise: deferredConversationIdPromise,
    source: streamSource,
    canvasToolPayload,
    prefaceLine: streamSource.type === 'stream' ? '__STREAM_OPEN__' : undefined,
    onComplete: streamSource.type === 'stream'
      ? (fullText, finalCanvasToolPayload) => {
          conversationIdPromise.then((conversationId) => {
            if (!conversationId) return;
            console.log(`⏱️ [${elapsed(t0)}] Fast-path stream complete (${fullText.length} chars)`);
            saveMessage(token, conversationId, 'assistant', fullText, finalCanvasToolPayload ?? canvasToolPayload).catch(err => {
              console.error('❌ Failed to save assistant message:', err);
            });
          });
        }
      : undefined,
  });
}

export function resolveFinalStreamSource(
  t0: number,
  isVoiceMode: boolean,
  toolResults: ChatToolResults,
  streamedSynthesisTokens: AsyncIterable<string> | null,
  assistantContent: string | null,
): StreamSource {
  if (streamedSynthesisTokens) {
    console.log(`⏱️ [${elapsed(t0)}] Using real-stream synthesis tokens`);
    return { type: 'stream', tokens: streamedSynthesisTokens };
  }

  if (!isVoiceMode && toolResults.dailyOverview?.success) {
    console.log(`⏱️ [${elapsed(t0)}] 🌊 Real-streaming narrative for dailyOverview`);
    return {
      type: 'stream',
      tokens: streamWeeklyOverviewNarrative(toolResults.dailyOverview as WeeklyOverviewPayload, 'Daily Activity Overview'),
    };
  }

  if (!isVoiceMode && toolResults.monthlyOverview?.success) {
    console.log(`⏱️ [${elapsed(t0)}] 🌊 Real-streaming narrative for monthlyOverview`);
    return {
      type: 'stream',
      tokens: streamWeeklyOverviewNarrative(toolResults.monthlyOverview as WeeklyOverviewPayload, 'Monthly Activity Overview'),
    };
  }

  if (!isVoiceMode && toolResults.weeklyOverview?.success) {
    console.log(`⏱️ [${elapsed(t0)}] 🌊 Real-streaming narrative for weeklyOverview`);
    return {
      type: 'stream',
      tokens: streamWeeklyOverviewNarrative(toolResults.weeklyOverview as WeeklyOverviewPayload, 'Weekly Activity Overview'),
    };
  }

  return { type: 'complete', text: assistantContent || 'I was unable to process your request.' };
}

export function applyVoiceMode(finalText: string, toolResults: ChatToolResults, isVoiceMode: boolean): string {
  if (!isVoiceMode) return finalText;
  console.log('🎤 Applying voice mode post-processing');
  const formatted = formatVoiceResponse(finalText);
  toolResults.reply_chips = generateReplyChips(toolResults);
  console.log('💬 Generated reply chips:', toolResults.reply_chips);
  return formatted;
}
