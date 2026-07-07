import type { Routine, RoutineCreateInput, RoutineTriggerType, RoutineUpdateInput } from '@/lib/tasks/types';
import type {
  WorkflowDefinition,
  WorkflowDefinitionCreateInput,
  WorkflowDefinitionUpdateInput,
  WorkflowKind,
} from '@/lib/workflows/types';

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
 * Agent settings for an AI routine. Stored in the linked workflow definition's
 * free-form `config` JSON (delivered as-is to the workflow executor), so no
 * backend schema changes are required.
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

export function defaultAgentConfig(): RoutineAgentConfig {
  return {
    instructions: '',
    agent_tier: 'regular',
    data_sources: [],
    notify_push: true,
    notify_email: false,
    icon: DEFAULT_AGENT_ICON,
    template_key: null,
  };
}

function asTier(value: unknown): AgentTier {
  return value === 'lite' || value === 'max' ? value : 'regular';
}

export function readAgentConfig(definition: WorkflowDefinition | null | undefined, routine?: Routine | null): RoutineAgentConfig {
  const config = (definition?.config || {}) as Record<string, unknown>;
  return {
    instructions: typeof config.instructions === 'string' && config.instructions.trim()
      ? config.instructions
      : (routine?.description || ''),
    agent_tier: asTier(config.agent_tier),
    data_sources: Array.isArray(config.data_sources) ? config.data_sources.map(String) : [],
    notify_push: config.notify_push !== false,
    notify_email: config.notify_email === true,
    icon: typeof config.icon === 'string' && config.icon ? config.icon : DEFAULT_AGENT_ICON,
    template_key: typeof config.ai_routine_template_key === 'string' ? config.ai_routine_template_key : null,
  };
}

/** A routine joined with its agent definition — the page's working unit. */
export type AgentRoutine = {
  routine: Routine;
  definition: WorkflowDefinition | null;
  agent: RoutineAgentConfig;
};

export function joinAgentRoutines(routines: Routine[], definitions: WorkflowDefinition[]): AgentRoutine[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return routines.map((routine) => {
    const definition = routine.ai_workflow_definition_id ? byId.get(routine.ai_workflow_definition_id) || null : null;
    return { routine, definition, agent: readAgentConfig(definition, routine) };
  });
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

/** Mirror of the routine schedule for the definition row (cosmetic — the routine drives scheduling). */
export function workflowScheduleMirror(draft: ScheduleDraft, timezone: string) {
  return {
    timezone,
    cadence: draft.frequency === 'weekly' ? 'weekly' : 'daily',
    send_hour_local: draft.hour,
    send_minute_local: draft.minute,
    send_weekdays: draft.frequency === 'weekly' ? [...draft.weekdays].sort((a, b) => a - b) : [],
  };
}

export function agentConfigPayload(agent: RoutineAgentConfig, templateKey: string | null, routineName?: string): Record<string, unknown> {
  return {
    routine_agent_version: 1,
    routine_name: routineName || undefined,
    instructions: agent.instructions,
    agent_tier: agent.agent_tier,
    data_sources: agent.data_sources,
    notify_push: agent.notify_push,
    notify_email: agent.notify_email,
    icon: agent.icon,
    ai_routine_template_key: templateKey || undefined,
  };
}

export function buildAgentDefinitionCreateInput({
  name,
  kind,
  agent,
  draft,
  timezone,
  templateKey,
}: {
  name: string;
  kind: WorkflowKind;
  agent: RoutineAgentConfig;
  draft: ScheduleDraft;
  timezone: string;
  templateKey: string | null;
}): WorkflowDefinitionCreateInput {
  return {
    kind,
    name,
    definition_family: 'routine',
    trigger_type: 'schedule',
    signal_kind: null,
    // Paused so the definition never self-schedules; the routine is the
    // single scheduling source and queues runs against this definition.
    status: 'paused',
    schedule: workflowScheduleMirror(draft, timezone),
    delivery: { channel: 'in_app', publish: true, inbox: true },
    config: agentConfigPayload(agent, templateKey, name),
  };
}

export function buildAgentDefinitionUpdateInput(args: {
  name: string;
  agent: RoutineAgentConfig;
  draft: ScheduleDraft;
  timezone: string;
  templateKey: string | null;
}): WorkflowDefinitionUpdateInput {
  return {
    name: args.name,
    status: 'paused',
    schedule: workflowScheduleMirror(args.draft, args.timezone),
    config: agentConfigPayload(args.agent, args.templateKey, args.name),
  };
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
    trigger_config: triggerConfigFromDraft(draft),
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
    trigger_config: triggerConfigFromDraft(args.draft),
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
