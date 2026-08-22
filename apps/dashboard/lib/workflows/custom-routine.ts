// Custom routine agents (user-authored natural-language instructions).
//
// Routines created by the Routines page store their agent settings in the
// workflow definition's config: `instructions`, `agent_tier`, `data_sources`,
// `routine_name`. When `instructions` is present, execution collects data per
// the requested sources and tier, then synthesizes a report from the user's
// instructions. The deterministic branch doubles as the offline/mock executor:
// it renders a real-aggregate report without any model call.

import {
  collectModelEngineResponse,
  defaultModelEngine,
  executeGetCalendarEvents,
  executeGetComputerTimeSpentBreakdown,
  executeGetDailyBiometrics,
  executeGetDailyOverview,
  executeGetMonthlyOverview,
  executeGetScreenTimeSummary,
  executeGetStreaks,
  executeGetWeeklyOverview,
  shiftYmd,
} from '@ritual/chat-runtime';

type AgentTier = 'lite' | 'regular' | 'max';

export interface CustomExecutePayload {
  user_id: string;
  workflow_run_id: string;
  timezone: string;
  config: Record<string, unknown>;
  window: { start: string; end: string };
}

export interface CustomArtifactResult {
  kind: 'report';
  title: string;
  summary: string;
  body: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

function parseJsonPayload(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return { success: false, error: 'Invalid JSON payload' };
  }
}

function toIsoDate(value: string): string {
  return value.slice(0, 10);
}

function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function customTier(config: Record<string, unknown>): AgentTier {
  return config.agent_tier === 'lite' || config.agent_tier === 'max' ? config.agent_tier : 'regular';
}

function customSources(config: Record<string, unknown>): string[] {
  return Array.isArray(config.data_sources) && config.data_sources.length
    ? config.data_sources.map(String)
    : ['sleep', 'workouts', 'steps', 'screen_time', 'coding', 'reading'];
}

function customInstructions(config: Record<string, unknown>): string {
  return typeof config.instructions === 'string' ? config.instructions.trim() : '';
}

export function isCustomRoutine(config: Record<string, unknown>): boolean {
  return customInstructions(config).length > 0;
}

export async function collectCustomRoutine(token: string, payload: CustomExecutePayload) {
  const config = payload.config || {};
  const tier = customTier(config);
  const sources = customSources(config);
  const day = toIsoDate(payload.window.start);
  const windowDays = tier === 'lite' ? 1 : tier === 'regular' ? 7 : 30;
  const overviewStart = shiftYmd(day, -(windowDays - 1));

  const tool_calls_made: string[] = ['getDailyOverview'];
  const tasks: Array<Promise<[string, unknown]>> = [
    executeGetDailyOverview(token, { appLimit: 6 }, payload.timezone)
      .then((raw) => ['daily_overview', parseJsonPayload(raw)] as [string, unknown]),
  ];

  if (tier !== 'lite') {
    tool_calls_made.push('getWeeklyOverview');
    tasks.push(
      executeGetWeeklyOverview(token, { startDate: overviewStart, endDate: day, appLimit: 6 }, payload.timezone, false)
        .then((raw) => ['window_overview', parseJsonPayload(raw)] as [string, unknown]),
    );
    if (sources.includes('sleep')) {
      tool_calls_made.push('getDailyBiometrics');
      tasks.push(
        executeGetDailyBiometrics(token, { day }, payload.timezone)
          .then((raw) => ['biometrics', parseJsonPayload(raw)] as [string, unknown]),
      );
    }
    if (sources.includes('screen_time')) {
      tool_calls_made.push('getScreenTimeSummary');
      tasks.push(
        executeGetScreenTimeSummary(token, { daysBack: windowDays, appLimit: 8 }, payload.timezone)
          .then((raw) => ['screen_time', parseJsonPayload(raw)] as [string, unknown]),
      );
    }
    if (sources.includes('coding')) {
      tool_calls_made.push('getComputerTimeSpentBreakdown');
      tasks.push(
        executeGetComputerTimeSpentBreakdown(
          token,
          { query: 'coding and focus time', daysBack: windowDays, limit: 8, groupBy: 'app' },
          payload.timezone,
        ).then((raw) => ['computer_time', parseJsonPayload(raw)] as [string, unknown]),
      );
    }
    if (sources.includes('calendar')) {
      tool_calls_made.push('getCalendarEvents');
      tasks.push(
        executeGetCalendarEvents(token, { startDate: day, endDate: day }, payload.timezone)
          .then((raw) => ['calendar', parseJsonPayload(raw)] as [string, unknown]),
      );
    }
    if (sources.some((source) => ['workouts', 'steps', 'reading'].includes(source))) {
      tool_calls_made.push('getStreaks');
      tasks.push(
        executeGetStreaks(token, {})
          .then((raw) => ['streaks', parseJsonPayload(raw)] as [string, unknown]),
      );
    }
  }

  if (tier === 'max') {
    tool_calls_made.push('getMonthlyOverview');
    tasks.push(
      executeGetMonthlyOverview(token, { appLimit: 8 }, payload.timezone)
        .then((raw) => ['monthly_overview', parseJsonPayload(raw)] as [string, unknown]),
    );
  }

  const entries = await Promise.all(tasks);
  const dataset: Record<string, unknown> = { day, agent_tier: tier, data_sources: sources };
  for (const [key, value] of entries) dataset[key] = value;
  return { tool_calls_made, dataset };
}

function customTitle(config: Record<string, unknown>): string {
  if (typeof config.routine_name === 'string' && config.routine_name.trim()) return config.routine_name.trim();
  return 'Routine report';
}

/** Offline/mock renderer: a grounded report from real aggregates, no model call. */
export function buildCustomDeterministicArtifact(
  config: Record<string, unknown>,
  dataset: any,
  toolCalls: string[],
  timezone: string,
): CustomArtifactResult {
  const title = customTitle(config);
  const overview = dataset.daily_overview || {};
  const summaryParts = [
    typeof overview.summary === 'string' ? overview.summary : `Data collected for ${dataset.day}.`,
    dataset.screen_time?.total_active_ms
      ? `Phone usage was about ${Math.round(Number(dataset.screen_time.total_active_ms) / 3600000 * 10) / 10} hours.`
      : null,
    dataset.computer_time?.summary?.estimated_total_hours
      ? `Computer time was about ${Number(dataset.computer_time.summary.estimated_total_hours).toFixed(1)} hours.`
      : null,
    typeof dataset.biometrics?.average_bpm === 'number'
      ? `Average heart rate was ${Math.round(dataset.biometrics.average_bpm)} bpm.`
      : null,
  ].filter(Boolean);

  const streakItems = safeArray<any>(dataset.streaks?.streaks)
    .slice(0, 5)
    .map((item: any) => `${item.habit_name || 'Habit'}: ${item.current_streak || 0} day streak`);

  return {
    kind: 'report',
    title,
    summary: summaryParts.join(' '),
    body: {
      schemaVersion: 1,
      blocks: [
        { type: 'hero', title, periodLabel: dataset.day, intro: 'Generated by your routine from the data it watches.' },
        { type: 'summary', text: summaryParts.join(' ') },
        {
          type: 'bullet_list',
          title: 'What the routine looked at',
          items: (dataset.data_sources as string[]).map((source) => source.replace(/_/g, ' ')),
        },
        ...(streakItems.length ? [{ type: 'bullet_list', title: 'Momentum', items: streakItems }] : []),
      ],
    },
    metadata: {
      workflow_kind: 'custom_routine',
      template_version: 1,
      timezone,
      tool_calls_made: toolCalls,
      agent_tier: dataset.agent_tier,
      data_sources: dataset.data_sources,
    },
  };
}

export async function synthesizeCustomArtifactWithModelEngine(
  config: Record<string, unknown>,
  dataset: any,
  toolCalls: string[],
  timezone: string,
): Promise<CustomArtifactResult> {
  const title = customTitle(config);
  const response = await collectModelEngineResponse(defaultModelEngine, {
    model: 'gpt-4o-mini',
    temperature: 0.25,
    responseFormat: 'json_object',
    messages: [
      {
        role: 'system',
        content: [
          'You are a scheduled agent inside Ritual, a personal quantified-self app.',
          'Follow the user\'s routine instructions exactly — tone, scope, length, and any conditional behavior they describe.',
          'Ground every claim in the provided dataset; if the data needed is missing, say so plainly instead of inventing numbers.',
          'Return valid JSON only, with keys: title, summary, blocks.',
          'blocks must be an array of 2-6 objects for Ritual structured rendering.',
          'Allowed block types: hero, summary, metric_list, bullet_list.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          routine_name: title,
          instructions: customInstructions(config),
          agent_tier: dataset.agent_tier,
          timezone,
          tool_calls_made: toolCalls,
          dataset,
        }),
      },
    ],
  });

  const content = response.content || '{}';
  const parsed = JSON.parse(content) as { title?: string; summary?: string; blocks?: unknown[] };
  return {
    kind: 'report',
    title: String(parsed.title || title),
    summary: String(parsed.summary || ''),
    body: {
      schemaVersion: 1,
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    },
    metadata: {
      workflow_kind: 'custom_routine',
      template_version: 1,
      timezone,
      tool_calls_made: toolCalls,
      model: 'gpt-4o-mini',
      agent_tier: dataset.agent_tier,
      data_sources: dataset.data_sources,
    },
  };
}
