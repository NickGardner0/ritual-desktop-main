import OpenAI from 'openai';

import { executeGetCalendarEvents } from '@/lib/ai/chat-stream/executors/calendar';
import { executeGetDailyBiometrics } from '@/lib/ai/chat-stream/executors/biometrics';
import { executeGetComputerTimeSpentBreakdown } from '@/lib/ai/chat-stream/executors/computer-time';
import { executeGetActivitySummary } from '@/lib/ai/chat-stream/executors/project-time';
import {
  executeGetDailyOverview,
  executeGetMonthlyOverview,
  executeGetWeeklyOverview,
} from '@/lib/ai/chat-stream/executors/overviews';
import { executeGetScreenTimeSummary } from '@/lib/ai/chat-stream/executors/screen-time';
import { executeGetStreaks } from '@/lib/ai/chat-stream/executors/habits';
import { shiftYmd } from '@/lib/ai/chat-stream/executors/shared-api';
import {
  buildCalendarStyleActivitySummary,
  inferRecapAnchorDate,
} from '@/lib/ai/chat-stream/narrative/activity-summary';

export type WorkflowKind = 'morning_brief' | 'shutdown_review' | 'daily_narrative' | 'distraction_spiral';
export type WorkflowArtifactKind =
  | 'morning_brief'
  | 'shutdown_review'
  | 'ambient_digest';

export interface WorkflowExecuteWindow {
  start: string;
  end: string;
}

export interface WorkflowExecutePayload {
  user_id: string;
  workflow_run_id: string;
  workflow_kind: WorkflowKind;
  timezone: string;
  config: Record<string, unknown>;
  window: WorkflowExecuteWindow;
}

interface FactSuggestion {
  category: 'goal' | 'preference' | 'constraint' | 'routine' | 'profile';
  subject: string;
  predicate: string;
  value: Record<string, unknown>;
  confidence: number;
  visibility?: 'private' | 'prompt' | 'ui';
}

interface ProposedAction {
  action_kind: string;
  capability: string;
  target_ref?: string | null;
  payload?: Record<string, unknown>;
}

interface WorkflowArtifactResult {
  kind: WorkflowArtifactKind;
  title: string;
  summary: string;
  body: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface WorkflowExecutionResult {
  plan: Record<string, unknown>;
  artifact: WorkflowArtifactResult;
  artifact_draft?: Record<string, unknown>;
  result: Record<string, unknown>;
  proposed_actions: ProposedAction[];
  fact_suggestions: FactSuggestion[];
  linked_entities: Array<Record<string, unknown>>;
  queue_suggestions: Array<Record<string, unknown>>;
}

let _openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
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

async function collectMorningBrief(token: string, payload: WorkflowExecutePayload) {
  const day = toIsoDate(payload.window.start);
  const weeklyStart = shiftYmd(day, -6);
  const tool_calls_made = [
    'getCalendarEvents',
    'getStreaks',
    'getDailyBiometrics',
    'getWeeklyOverview',
  ];

  const [calendarRaw, streaksRaw, biometricsRaw, weeklyRaw] = await Promise.all([
    executeGetCalendarEvents(token, { startDate: day, endDate: day }, payload.timezone),
    executeGetStreaks(token, {}),
    executeGetDailyBiometrics(token, { day }, payload.timezone),
    executeGetWeeklyOverview(
      token,
      { startDate: weeklyStart, endDate: day, appLimit: 5 },
      payload.timezone,
      false,
    ),
  ]);

  return {
    tool_calls_made,
    dataset: {
      day,
      calendar: parseJsonPayload(calendarRaw),
      streaks: parseJsonPayload(streaksRaw),
      biometrics: parseJsonPayload(biometricsRaw),
      weekly_overview: parseJsonPayload(weeklyRaw),
    },
  };
}

async function collectShutdownReview(token: string, payload: WorkflowExecutePayload) {
  const day = toIsoDate(payload.window.start);
  const tool_calls_made = [
    'getActivitySummary',
    'getDailyOverview',
    'getComputerTimeSpentBreakdown',
    'getScreenTimeSummary',
  ];

  const [activitySummary, dailyOverviewRaw, computerTimeRaw, screenTimeRaw] = await Promise.all([
    executeGetActivitySummary(
      token,
      {
        query: 'what did I do today',
        daysBack: 1,
      },
      payload.timezone,
      inferRecapAnchorDate,
      buildCalendarStyleActivitySummary,
    ),
    executeGetDailyOverview(token, { appLimit: 5 }, payload.timezone),
    executeGetComputerTimeSpentBreakdown(
      token,
      { query: 'overall computer time today', daysBack: 1, limit: 8, groupBy: 'app' },
      payload.timezone,
    ),
    executeGetScreenTimeSummary(token, { daysBack: 1, appLimit: 5 }, payload.timezone),
  ]);

  return {
    tool_calls_made,
    dataset: {
      day,
      activity_summary: activitySummary,
      daily_overview: parseJsonPayload(dailyOverviewRaw),
      computer_time: parseJsonPayload(computerTimeRaw),
      screen_time: parseJsonPayload(screenTimeRaw),
    },
  };
}

async function collectDailyNarrative(token: string, payload: WorkflowExecutePayload) {
  const day = toIsoDate(payload.window.start);
  const tool_calls_made = [
    'getActivitySummary',
    'getDailyOverview',
    'getDailyBiometrics',
    'getCalendarEvents',
  ];

  const [activitySummary, dailyOverviewRaw, biometricsRaw, calendarRaw] = await Promise.all([
    executeGetActivitySummary(
      token,
      {
        query: 'what did I do today',
        daysBack: 1,
      },
      payload.timezone,
      inferRecapAnchorDate,
      buildCalendarStyleActivitySummary,
    ),
    executeGetDailyOverview(token, { appLimit: 6 }, payload.timezone),
    executeGetDailyBiometrics(token, { day }, payload.timezone),
    executeGetCalendarEvents(token, { startDate: day, endDate: day }, payload.timezone),
  ]);

  return {
    tool_calls_made,
    dataset: {
      day,
      activity_summary: activitySummary,
      daily_overview: parseJsonPayload(dailyOverviewRaw),
      biometrics: parseJsonPayload(biometricsRaw),
      calendar: parseJsonPayload(calendarRaw),
    },
  };
}

async function collectDistractionSpiral(token: string, payload: WorkflowExecutePayload) {
  const day = toIsoDate(payload.window.start);
  const weeklyStart = shiftYmd(day, -2);
  const tool_calls_made = [
    'getComputerTimeSpentBreakdown',
    'getScreenTimeSummary',
    'getDailyOverview',
    'getWeeklyOverview',
  ];

  const [computerTimeRaw, screenTimeRaw, dailyOverviewRaw, weeklyOverviewRaw] = await Promise.all([
    executeGetComputerTimeSpentBreakdown(
      token,
      { query: 'where did my time go today', daysBack: 1, limit: 10, groupBy: 'app' },
      payload.timezone,
    ),
    executeGetScreenTimeSummary(token, { daysBack: 1, appLimit: 8 }, payload.timezone),
    executeGetDailyOverview(token, { appLimit: 8 }, payload.timezone),
    executeGetWeeklyOverview(
      token,
      { startDate: weeklyStart, endDate: day, appLimit: 8 },
      payload.timezone,
      false,
    ),
  ]);

  return {
    tool_calls_made,
    dataset: {
      day,
      computer_time: parseJsonPayload(computerTimeRaw),
      screen_time: parseJsonPayload(screenTimeRaw),
      daily_overview: parseJsonPayload(dailyOverviewRaw),
      weekly_overview: parseJsonPayload(weeklyOverviewRaw),
    },
  };
}

function buildDeterministicArtifact(
  kind: WorkflowKind,
  dataset: any,
  toolCalls: string[],
  timezone: string,
): WorkflowArtifactResult {
  if (kind === 'morning_brief') {
    const calendarEvents = safeArray<any>(dataset.calendar?.events);
    const topHabit = safeArray<any>(dataset.weekly_overview?.overviewHabits)[0] || null;
    const bestStreak = safeArray<any>(dataset.streaks?.streaks).reduce(
      (best: any, item: any) => ((item?.current_streak || 0) > (best?.current_streak || 0) ? item : best),
      null,
    );
    const title = 'Morning Brief';
    const summaryParts = [
      calendarEvents.length > 0
        ? `You have ${calendarEvents.length} scheduled block${calendarEvents.length === 1 ? '' : 's'} today.`
        : 'Your calendar is open today.',
      bestStreak?.habit_name ? `${bestStreak.habit_name} is on a ${bestStreak.current_streak}-day streak.` : null,
      typeof dataset.biometrics?.average_bpm === 'number'
        ? `Average heart rate yesterday was ${Math.round(dataset.biometrics.average_bpm)} bpm.`
        : null,
      topHabit?.name ? `${topHabit.name} has been one of your strongest habits this week.` : null,
    ].filter(Boolean);

    return {
      kind: 'morning_brief',
      title,
      summary: summaryParts.join(' '),
      body: {
        schemaVersion: 1,
        blocks: [
          { type: 'hero', title, periodLabel: dataset.day, intro: 'Here is your morning snapshot before the day gets moving.' },
          { type: 'summary', text: summaryParts.join(' ') },
          {
            type: 'bullet_list',
            title: 'Today',
            items: calendarEvents.slice(0, 5).map((event: any) => `${event.start_time} - ${event.title}`),
          },
          {
            type: 'bullet_list',
            title: 'Momentum',
            items: [
              bestStreak?.habit_name ? `${bestStreak.habit_name}: ${bestStreak.current_streak} day streak` : 'No active streaks detected yet.',
              topHabit?.name ? `${topHabit.name}: ${topHabit.days_with_data || 0} days with data this week` : 'Weekly habit summary is still sparse.',
            ],
          },
        ],
      },
      metadata: {
        workflow_kind: kind,
        template_version: 1,
        timezone,
        tool_calls_made: toolCalls,
      },
    };
  }

  if (kind === 'shutdown_review') {
    const title = 'Shutdown Review';
    const summaryParts = [
      dataset.activity_summary?.calendar_style_summary || dataset.activity_summary?.rendered_summary || 'Your day has been summarized and saved for review.',
      dataset.computer_time?.summary?.estimated_total_hours
        ? `Computer time was about ${Number(dataset.computer_time.summary.estimated_total_hours).toFixed(1)} hours.`
        : null,
      dataset.screen_time?.total_active_ms
        ? `Phone usage totaled about ${Math.round(Number(dataset.screen_time.total_active_ms) / 3600000 * 10) / 10} hours.`
        : null,
    ].filter(Boolean);

    return {
      kind: 'shutdown_review',
      title,
      summary: summaryParts.join(' '),
      body: {
        schemaVersion: 1,
        blocks: [
          { type: 'hero', title, periodLabel: dataset.day, intro: 'A compact review of the day before you shut down.' },
          { type: 'summary', text: summaryParts.join(' ') },
          {
            type: 'bullet_list',
            title: 'Activity',
            items: safeArray<string>(dataset.activity_summary?.high_level_bullets).slice(0, 5).length
              ? safeArray<string>(dataset.activity_summary?.high_level_bullets).slice(0, 5)
              : [dataset.activity_summary?.calendar_style_summary || 'No recap bullets available yet.'],
          },
          {
            type: 'bullet_list',
            title: 'Usage',
            items: [
              dataset.computer_time?.summary?.estimated_total_hours
                ? `Computer: ${Number(dataset.computer_time.summary.estimated_total_hours).toFixed(1)} hours`
                : 'Computer time unavailable.',
              dataset.screen_time?.total_active_ms
                ? `Phone: ${Math.round(Number(dataset.screen_time.total_active_ms) / 60000)} minutes`
                : 'Phone screen time unavailable.',
            ],
          },
        ],
      },
      metadata: {
        workflow_kind: kind,
        template_version: 1,
        timezone,
        tool_calls_made: toolCalls,
      },
    };
  }

  if (kind === 'daily_narrative') {
    const bullets = safeArray<string>(dataset.activity_summary?.high_level_bullets).slice(0, 5);
    const calendarEvents = safeArray<any>(dataset.calendar?.events).slice(0, 4);
    const summary = [
      dataset.activity_summary?.calendar_style_summary || dataset.activity_summary?.rendered_summary || 'A compact narrative of the day is ready.',
      calendarEvents.length ? `${calendarEvents.length} calendar blocks landed on the day.` : 'Calendar load stayed light.',
      typeof dataset.biometrics?.average_bpm === 'number' ? `Average heart rate was ${Math.round(dataset.biometrics.average_bpm)} bpm.` : null,
    ].filter(Boolean).join(' ');

    return {
      kind: 'ambient_digest',
      title: 'Daily Narrative',
      summary,
      body: {
        schemaVersion: 1,
        blocks: [
          { type: 'hero', title: 'Daily Narrative', periodLabel: dataset.day, intro: 'A persistent narrative of how the day unfolded.' },
          { type: 'summary', text: summary },
          {
            type: 'bullet_list',
            title: 'Highlights',
            items: bullets.length ? bullets : [dataset.activity_summary?.calendar_style_summary || 'The day has been captured, but highlights are still sparse.'],
          },
          {
            type: 'bullet_list',
            title: 'Calendar anchors',
            items: calendarEvents.length
              ? calendarEvents.map((event: any) => `${event.start_time} - ${event.title}`)
              : ['No strong calendar anchors were detected.'],
          },
        ],
      },
      metadata: {
        workflow_kind: kind,
        template_version: 1,
        timezone,
        tool_calls_made: toolCalls,
      },
    };
  }

  const topApps = safeArray<any>(dataset.computer_time?.breakdown || dataset.computer_time?.rows || []).slice(0, 4);
  const summary = [
    dataset.daily_overview?.summary || 'Potential distraction pressure was detected in today’s activity mix.',
    dataset.computer_time?.summary?.estimated_total_hours
      ? `Computer time reached about ${Number(dataset.computer_time.summary.estimated_total_hours).toFixed(1)} hours.`
      : null,
    dataset.screen_time?.total_active_ms
      ? `Phone time reached ${Math.round(Number(dataset.screen_time.total_active_ms) / 60000)} minutes.`
      : null,
  ].filter(Boolean).join(' ');

  return {
    kind: 'ambient_digest',
    title: 'Distraction Spiral Guardrail',
    summary,
    body: {
      schemaVersion: 1,
      blocks: [
        { type: 'hero', title: 'Distraction Spiral Guardrail', periodLabel: dataset.day, intro: 'A signal review when your attention starts to fragment.' },
        { type: 'summary', text: summary },
        {
          type: 'bullet_list',
          title: 'Top attention sinks',
          items: topApps.length
            ? topApps.map((item: any) => `${item.label || item.app_name || 'Unknown'}: ${item.hours || item.total_hours || item.value || 0}`)
            : ['No clear attention sink was identified.'],
        },
        {
          type: 'bullet_list',
          title: 'Suggested reset',
          items: ['Schedule one protected focus block.', 'Close the highest-friction attention drain.', 'Queue a quick reset prompt in chat.'],
        },
      ],
    },
    metadata: {
      workflow_kind: kind,
      template_version: 1,
      timezone,
      tool_calls_made: toolCalls,
    },
  };
}

async function synthesizeArtifactWithOpenAI(
  kind: WorkflowKind,
  dataset: any,
  toolCalls: string[],
  timezone: string,
): Promise<WorkflowArtifactResult> {
  const openai = getOpenAIClient();
  const titleByKind: Record<WorkflowKind, string> = {
    morning_brief: 'Morning Brief',
    shutdown_review: 'Shutdown Review',
    daily_narrative: 'Daily Narrative',
    distraction_spiral: 'Distraction Spiral Guardrail',
  };
  const artifactKind: WorkflowArtifactKind =
    kind === 'morning_brief' ? 'morning_brief' : kind === 'shutdown_review' ? 'shutdown_review' : 'ambient_digest';
  const title = titleByKind[kind];
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.25,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You produce Ritual workflow artifacts.',
          'Return valid JSON only.',
          'The JSON must have keys: title, summary, blocks.',
          'blocks must be an array of 3-5 objects suitable for Ritual structured rendering.',
          'Allowed block types: hero, summary, metric_list, bullet_list.',
          'Be concrete and grounded in the provided data. Do not invent facts.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          workflow_kind: kind,
          title,
          timezone,
          tool_calls_made: toolCalls,
          dataset,
        }),
      },
    ],
  });

  const content = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(content) as { title?: string; summary?: string; blocks?: unknown[] };
  return {
    kind: artifactKind,
    title: String(parsed.title || title),
    summary: String(parsed.summary || ''),
    body: {
      schemaVersion: 1,
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    },
    metadata: {
      workflow_kind: kind,
      template_version: 1,
      timezone,
      tool_calls_made: toolCalls,
      model: 'gpt-4o-mini',
    },
  };
}

function buildFactSuggestions(kind: WorkflowKind, dataset: any): FactSuggestion[] {
  if (kind === 'morning_brief') {
    const bestStreak = safeArray<any>(dataset.streaks?.streaks).reduce(
      (best: any, item: any) => ((item?.current_streak || 0) > (best?.current_streak || 0) ? item : best),
      null,
    );
    if (bestStreak?.habit_name && Number(bestStreak.current_streak || 0) >= 5) {
      return [
        {
          category: 'routine',
          subject: 'user',
          predicate: 'anchor_habit',
          value: { name: bestStreak.habit_name, current_streak: bestStreak.current_streak },
          confidence: 0.82,
          visibility: 'ui',
        },
      ];
    }
    return [];
  }

  if (kind === 'shutdown_review') {
    if (dataset.computer_time?.summary?.estimated_total_hours) {
      return [
        {
          category: 'profile',
          subject: 'user',
          predicate: 'daily_computer_time_pattern',
          value: { estimated_hours: Number(dataset.computer_time.summary.estimated_total_hours) },
          confidence: 0.68,
          visibility: 'private',
        },
      ];
    }
    return [];
  }

  if (kind === 'daily_narrative') {
    return [
      {
        category: 'routine',
        subject: 'user',
        predicate: 'benefits_from_end_of_day_narrative',
        value: { day: dataset.day },
        confidence: 0.74,
        visibility: 'ui',
      },
    ];
  }

  return [
    {
      category: 'constraint',
      subject: 'user',
      predicate: 'attention_fragility_window',
      value: {
        detected_on: dataset.day,
        phone_minutes: dataset.screen_time?.total_active_ms ? Math.round(Number(dataset.screen_time.total_active_ms) / 60000) : null,
      },
      confidence: 0.72,
      visibility: 'ui',
    },
  ];
}

function buildQueueSuggestions(kind: WorkflowKind): Array<Record<string, unknown>> {
  if (kind === 'morning_brief') {
    return [
      { prompt_text: 'Turn this morning brief into a concrete focus plan for today.', source: 'workflow' },
    ];
  }
  if (kind === 'shutdown_review') {
    return [
      { prompt_text: 'Turn this shutdown review into a plan for tomorrow.', source: 'workflow' },
    ];
  }
  if (kind === 'daily_narrative') {
    return [
      { prompt_text: 'What should I carry forward from this day into tomorrow?', source: 'workflow' },
    ];
  }
  return [
    { prompt_text: 'Help me recover focus for the next 30 minutes.', source: 'workflow' },
  ];
}

function buildProposedActions(kind: WorkflowKind, queueSuggestions: Array<Record<string, unknown>>): ProposedAction[] {
  if (kind === 'daily_narrative' || kind === 'distraction_spiral') {
    return queueSuggestions.slice(0, 1).map((item) => ({
      action_kind: 'queue_follow_up_prompt',
      capability: 'queue_items',
      target_ref: null,
      payload: item,
    }));
  }
  return [];
}

function buildLinkedEntities(payload: WorkflowExecutePayload, artifact: WorkflowArtifactResult): Array<Record<string, unknown>> {
  return [
    { type: 'workflow_run', id: payload.workflow_run_id },
    { type: 'artifact_kind', id: artifact.kind },
  ];
}

function chooseCollector(kind: WorkflowKind) {
  switch (kind) {
    case 'morning_brief':
      return collectMorningBrief;
    case 'shutdown_review':
      return collectShutdownReview;
    case 'daily_narrative':
      return collectDailyNarrative;
    case 'distraction_spiral':
      return collectDistractionSpiral;
    default:
      return collectMorningBrief;
  }
}

export async function executeWorkflow(payload: WorkflowExecutePayload, backendToken: string): Promise<WorkflowExecutionResult> {
  const compositeToken = `${backendToken}::${payload.user_id}`;
  const collector = chooseCollector(payload.workflow_kind);
  const collected = await collector(compositeToken, payload);

  let artifact: WorkflowArtifactResult;
  let modelUsed = 'deterministic';
  try {
    artifact = await synthesizeArtifactWithOpenAI(payload.workflow_kind, collected.dataset, collected.tool_calls_made, payload.timezone);
    modelUsed = 'gpt-4o-mini';
  } catch (error) {
    console.warn('[workflow-executor] falling back to deterministic renderer', error);
    artifact = buildDeterministicArtifact(payload.workflow_kind, collected.dataset, collected.tool_calls_made, payload.timezone);
  }

  artifact.metadata = {
    ...artifact.metadata,
    workflow_run_id: payload.workflow_run_id,
    workflow_kind: payload.workflow_kind,
    template_version: 1,
  };

  const factSuggestions = buildFactSuggestions(payload.workflow_kind, collected.dataset);
  const queueSuggestions = buildQueueSuggestions(payload.workflow_kind);
  const proposedActions = buildProposedActions(payload.workflow_kind, queueSuggestions);

  return {
    plan: {
      title: artifact.title,
      tool_calls_made: collected.tool_calls_made,
    },
    artifact: {
      kind: artifact.kind,
      title: artifact.title,
      summary: artifact.summary,
      body: artifact.body,
      metadata: artifact.metadata,
    },
    artifact_draft: {
      title: artifact.title,
      summary: artifact.summary,
      body: artifact.body,
      metadata: artifact.metadata,
    },
    result: {
      model: modelUsed,
      tool_calls_made: collected.tool_calls_made,
    },
    proposed_actions: proposedActions,
    fact_suggestions: factSuggestions,
    linked_entities: buildLinkedEntities(payload, artifact),
    queue_suggestions: queueSuggestions,
  };
}
