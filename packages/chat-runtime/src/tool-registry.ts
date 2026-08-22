import { tools as toolSchemas } from './tools.js';
import type { ToolSideEffect } from './assistant-turn.js';
import type { ModelEngineTool } from './model-engine/types.js';

export const toolNames = [
  'getHabitStats',
  'getDailyBreakdown',
  'getCorrelation',
  'listHabits',
  'getHabitTrends',
  'getWeeklyOverview',
  'getDailyOverview',
  'getMonthlyOverview',
  'getHabitAnomalies',
  'getComputerTimeSpentBreakdown',
  'getActivitySummary',
  'getDailyBiometrics',
  'getScreenTimeSummary',
  'getCalendarEvents',
  'getStreaks',
  'logHabit',
  'createHabit',
  'getSmsPreferences',
  'updateSmsPreferences',
] as const;

export type ToolName = (typeof toolNames)[number];
export type ChatToolSchema = ModelEngineTool;
export type ChatToolChannel = 'dashboard' | 'sms';
export type ChatToolOwner =
  | 'habits'
  | 'overviews'
  | 'computer-activity'
  | 'biometrics'
  | 'screen-time'
  | 'calendar'
  | 'sms-preferences';

export interface RegisteredTool {
  name: ToolName;
  schema: ChatToolSchema;
  channels: readonly ChatToolChannel[];
  owner: ChatToolOwner;
  sideEffect: ToolSideEffect;
}

const mutatingTools = new Set<ToolName>([
  'logHabit',
  'createHabit',
  'updateSmsPreferences',
]);

const dashboardOnlyTools = new Set<ToolName>([
  'getWeeklyOverview',
  'getDailyOverview',
  'getMonthlyOverview',
  'getComputerTimeSpentBreakdown',
  'getActivitySummary',
  'getDailyBiometrics',
  'getScreenTimeSummary',
  'getCalendarEvents',
]);

const toolOwners: Record<ToolName, ChatToolOwner> = {
  getHabitStats: 'habits',
  getDailyBreakdown: 'habits',
  getCorrelation: 'habits',
  listHabits: 'habits',
  getHabitTrends: 'habits',
  getWeeklyOverview: 'overviews',
  getDailyOverview: 'overviews',
  getMonthlyOverview: 'overviews',
  getHabitAnomalies: 'habits',
  getComputerTimeSpentBreakdown: 'computer-activity',
  getActivitySummary: 'computer-activity',
  getDailyBiometrics: 'biometrics',
  getScreenTimeSummary: 'screen-time',
  getCalendarEvents: 'calendar',
  getStreaks: 'habits',
  logHabit: 'habits',
  createHabit: 'habits',
  getSmsPreferences: 'sms-preferences',
  updateSmsPreferences: 'sms-preferences',
};

function toToolName(name: string): ToolName | null {
  return (toolNames as readonly string[]).includes(name) ? (name as ToolName) : null;
}

export const toolRegistry: ReadonlyMap<ToolName, RegisteredTool> = new Map(
  toolSchemas.map((schema) => {
    const schemaName = schema.function.name;
    const name = toToolName(schemaName);
    if (!name) {
      throw new Error(`Unknown chat tool schema name: ${schemaName}`);
    }
    return [
      name,
      {
        name,
        schema,
        owner: toolOwners[name],
        channels: dashboardOnlyTools.has(name) ? ['dashboard'] : ['dashboard', 'sms'],
        sideEffect: mutatingTools.has(name) ? 'mutating' : 'read_only',
      },
    ];
  }),
);

export { toolSchemas };

export function getRegisteredToolNames(): ToolName[] {
  return Array.from(toolRegistry.keys());
}

export function getToolSchema(name: ToolName): ChatToolSchema {
  const entry = toolRegistry.get(name);
  if (!entry) {
    throw new Error(`Chat tool is not registered: ${name}`);
  }
  return entry.schema;
}

export function getToolsForChannel(channel: ChatToolChannel): ChatToolSchema[] {
  return Array.from(toolRegistry.values())
    .filter((entry) => entry.channels.includes(channel))
    .map((entry) => entry.schema);
}

export function getToolSideEffect(name: string): ToolSideEffect {
  const toolName = toToolName(name);
  if (!toolName) return 'mutating';
  return toolRegistry.get(toolName)?.sideEffect ?? 'mutating';
}

export function getToolOwner(name: ToolName): ChatToolOwner {
  const entry = toolRegistry.get(name);
  if (!entry) {
    throw new Error(`Chat tool is not registered: ${name}`);
  }
  return entry.owner;
}

export function validateToolRegistry(): string[] {
  const errors: string[] = [];
  const seenSchemaNames = new Set<string>();

  for (const schema of toolSchemas) {
    if (schema.type !== 'function') {
      errors.push(`Tool schema must be a function: ${JSON.stringify(schema)}`);
      continue;
    }

    const name = schema.function.name;
    if (seenSchemaNames.has(name)) {
      errors.push(`Duplicate tool schema: ${name}`);
    }
    seenSchemaNames.add(name);

    if (!toToolName(name)) {
      errors.push(`Tool schema has no ToolName entry: ${name}`);
    }
  }

  for (const name of toolNames) {
    if (!seenSchemaNames.has(name)) {
      errors.push(`ToolName has no schema: ${name}`);
    }
    if (!toolRegistry.has(name)) {
      errors.push(`ToolName is not registered: ${name}`);
      continue;
    }

    const entry = toolRegistry.get(name);
    if (!entry?.owner) {
      errors.push(`ToolName has no executor owner: ${name}`);
    }
    if (!entry?.channels.length) {
      errors.push(`ToolName has no channel availability: ${name}`);
    }
    if (entry?.sideEffect !== 'read_only' && entry?.sideEffect !== 'mutating') {
      errors.push(`ToolName has no side-effect class: ${name}`);
    }
  }

  return errors;
}
