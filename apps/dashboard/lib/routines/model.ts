import type { Routine, RoutineCreateInput, RoutineTriggerType, RoutineUpdateInput } from '@/lib/tasks/types';
import type { WorkflowDefinition, WorkflowKind } from '@/lib/workflows/types';

export type AgentTier = 'lite' | 'regular' | 'max';

export const AGENT_TIERS: Array<{ id: AgentTier; label: string; description: string }> = [
  { id: 'lite', label: 'Lite', description: 'Fastest. Headline numbers only.' },
  { id: 'regular', label: 'Regular', description: 'Balanced analysis over the relevant window.' },
  { id: 'max', label: 'Max', description: 'Deep cross-metric analysis with longer baselines. Slower.' },
];

export type RoutineDataSourceKey = 'sleep' | 'workouts' | 'steps' | 'screen_time' | 'coding' | 'reading' | 'calendar';

export const ROUTINE_DATA_SOURCES: Array<{ key: RoutineDataSourceKey; label: string }> = [
  { key: 'sleep', label: 'Sleep' },
  { key: 'workouts', label: 'Workouts' },
  { key: 'steps', label: 'Steps' },
  { key: 'screen_time', label: 'Screen time' },
  { key: 'coding', label: 'Coding' },
  { key: 'reading', label: 'Reading' },
  { key: 'calendar', label: 'Calendar' },
];

export const ALL_DATA_SOURCE_KEYS: RoutineDataSourceKey[] = ROUTINE_DATA_SOURCES.map((source) => source.key);

/**
 * Agent settings for an AI routine. Stored under `trigger_config.agent` on the
 * routine itself — workflow definitions are unique per (user_id, kind), so
 * routines share a definition per kind and carry their own agent config into
 * each run (the backend copies it into the run's executor input).
 */
export type RoutineAgentConfig = {
  instructions: string;
  agent_tier: AgentTier;
  data_sources: string[];
  notify_push: boolean;
  notify_email: boolean;
  icon: string;
  template_key: string | null;
};

export const DEFAULT_AGENT_ICON = 'sparkles';

function asTier(value: unknown): AgentTier {
  return value === 'lite' || value === 'max' ? value : 'regular';
}

export function readAgentConfig(routine: Routine | null | undefined): RoutineAgentConfig {
  const raw = (routine?.trigger_config as Record<string, unknown> | undefined)?.agent;
  const agent = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    instructions: typeof agent.instructions === 'string' && agent.instructions.trim()
      ? agent.instructions
      : (routine?.description || ''),
    agent_tier: asTier(agent.agent_tier),
    data_sources: Array.isArray(agent.data_sources) ? agent.data_sources.map(String) : [],
    notify_push: agent.notify_push !== false,
    notify_email: agent.notify_email === true,
    icon: typeof agent.icon === 'string' && agent.icon ? agent.icon : DEFAULT_AGENT_ICON,
    template_key: typeof agent.template_key === 'string' ? agent.template_key : null,
  };
}

/** A routine joined with its parsed agent config — the page's working unit. */
export type AgentRoutine = {
  routine: Routine;
  agent: RoutineAgentConfig;
};

export function joinAgentRoutines(routines: Routine[]): AgentRoutine[] {
  return routines.map((routine) => ({ routine, agent: readAgentConfig(routine) }));
}

/** Pick the shared per-kind definition a new routine's runs execute against. */
export function sharedDefinitionId(definitions: WorkflowDefinition[], kind: WorkflowKind): string | null {
  const routineFamily = definitions.filter((definition) => definition.definition_family === 'routine');
  const byKind = routineFamily.find((definition) => definition.kind === kind);
  return (byKind || routineFamily.find((definition) => definition.kind === 'daily_narrative') || routineFamily[0])?.id || null;
}

/** Editable schedule state used by the configure modal. */
export type ScheduleDraft = {
  frequency: RoutineTriggerType;
  interval: number;
  hour: number;
  minute: number;
  weekdays: number[];
  day: number | 'first' | 'last';
  month: number;
  onCompletionUnit: 'days' | 'weeks' | 'months';
  firstRun: string | null; // ISO date (yyyy-mm-dd)
  ends: string | null;     // ISO date (yyyy-mm-dd)
};

export function defaultScheduleDraft(): ScheduleDraft {
  return {
    frequency: 'daily',
    interval: 1,
    hour: 9,
    minute: 0,
    weekdays: [0, 1, 2, 3, 4],
    day: 1,
    month: 1,
    onCompletionUnit: 'weeks',
    firstRun: null,
    ends: null,
  };
}

export function scheduleDraftFromRoutine(routine: Routine): ScheduleDraft {
  const config = routine.trigger_config || {};
  const draft = defaultScheduleDraft();
  draft.frequency = routine.trigger_type;
  draft.interval = Math.max(1, Math.floor(Number(config.interval) || 1));
  draft.hour = Number.isFinite(Number(config.hour)) ? Number(config.hour) : 9;
  draft.minute = Number.isFinite(Number(config.minute)) ? Number(config.minute) : 0;
  if (Array.isArray(config.weekdays) && config.weekdays.length) {
    draft.weekdays = config.weekdays.map(Number).filter((day) => day >= 0 && day <= 6);
  }
  const rawDay = (config as Record<string, unknown>).day;
  if (rawDay === 'first' || rawDay === 'last') draft.day = rawDay;
  else if (Number.isFinite(Number(rawDay))) draft.day = Math.max(1, Math.min(31, Number(rawDay)));
  if (Number.isFinite(Number(config.month))) draft.month = Math.max(1, Math.min(12, Number(config.month)));
  const unit = String((config as Record<string, unknown>).unit || 'weeks');
  draft.onCompletionUnit = unit.startsWith('day') ? 'days' : unit.startsWith('month') ? 'months' : 'weeks';
  draft.firstRun = routine.first_run_at ? routine.first_run_at.slice(0, 10) : null;
  draft.ends = routine.ends_at ? routine.ends_at.slice(0, 10) : null;
  return draft;
}

/** Schedule keys only — what the recurrence engines read. */
export function triggerConfigFromDraft(draft: ScheduleDraft): Record<string, unknown> {
  const base: Record<string, unknown> = { interval: draft.interval, hour: draft.hour, minute: draft.minute };
  if (draft.frequency === 'weekly') base.weekdays = [...draft.weekdays].sort((a, b) => a - b);
  if (draft.frequency === 'monthly') {
    base.mode = 'day_of_month';
    base.day = draft.day;
  }
  if (draft.frequency === 'yearly') {
    base.mode = 'day_of_month';
    base.day = draft.day;
    base.month = draft.month;
  }
  if (draft.frequency === 'on_completion') {
    return { interval: draft.interval, unit: draft.onCompletionUnit };
  }
  return base;
}

function agentConfigJson(agent: RoutineAgentConfig, routineName: string): Record<string, unknown> {
  return {
    instructions: agent.instructions,
    agent_tier: agent.agent_tier,
    data_sources: agent.data_sources,
    notify_push: agent.notify_push,
    notify_email: agent.notify_email,
    icon: agent.icon,
    template_key: agent.template_key || undefined,
    routine_name: routineName,
  };
}

/** Full trigger_config: schedule keys plus the namespaced agent config. */
export function triggerConfigWithAgent(draft: ScheduleDraft, agent: RoutineAgentConfig, routineName: string): Record<string, unknown> {
  return { ...triggerConfigFromDraft(draft), agent: agentConfigJson(agent, routineName) };
}

function isoDateToLocalIso(date: string | null, hour: number, minute: number): string | null {
  if (!date) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

export function firstRunAtFromDraft(draft: ScheduleDraft): string | null {
  return isoDateToLocalIso(draft.firstRun, 0, 0);
}

export function endsAtFromDraft(draft: ScheduleDraft): string | null {
  return isoDateToLocalIso(draft.ends, 23, 59);
}

export function buildAgentRoutineInput({
  name,
  agent,
  draft,
  timezone,
  definitionId,
  tags,
}: {
  name: string;
  agent: RoutineAgentConfig;
  draft: ScheduleDraft;
  timezone: string;
  definitionId: string;
  tags?: string[];
}): RoutineCreateInput {
  return {
    title: name,
    description: agent.instructions,
    status: 'scheduled',
    kind: 'ai_workflow',
    trigger_type: draft.frequency,
    trigger_config: triggerConfigWithAgent(draft, agent, name),
    timezone,
    priority: 'none',
    tags: tags && tags.length ? tags : ['ai'],
    ai_workflow_definition_id: definitionId,
    first_run_at: firstRunAtFromDraft(draft),
    ends_at: endsAtFromDraft(draft),
  };
}

export function buildAgentRoutineUpdateInput(args: {
  name: string;
  agent: RoutineAgentConfig;
  draft: ScheduleDraft;
  paused: boolean;
}): RoutineUpdateInput {
  return {
    title: args.name,
    description: args.agent.instructions,
    status: args.paused ? 'paused' : 'scheduled',
    trigger_type: args.draft.frequency,
    trigger_config: triggerConfigWithAgent(args.draft, args.agent, args.name),
    first_run_at: firstRunAtFromDraft(args.draft),
    ends_at: endsAtFromDraft(args.draft),
  };
}

/** Auto-generate a routine name from the first line of its instructions. */
export function nameFromInstructions(instructions: string): string {
  const firstLine = instructions.split('\n').map((line) => line.trim()).find(Boolean) || '';
  const words = firstLine.replace(/[.!?].*$/, '').split(/\s+/).filter(Boolean);
  const name = words.slice(0, 8).join(' ');
  if (!name) return 'Untitled routine';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function currentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
}
