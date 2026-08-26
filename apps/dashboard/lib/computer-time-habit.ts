const COMPUTER_HABIT_ALIASES = new Set([
  'computer use',
  'computer activity',
  'computer time',
]);

export const COMPUTER_HABIT_DISPLAY_NAME = 'Computer Time';
const HABIT_DISPLAY_ALIASES: Record<string, string> = {
  'caffeine consumption': 'Caffeine',
  'nicotine consumption': 'Nicotine',
};

export function normalizeHabitName(name: string | undefined): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isComputerHabitName(name: string | undefined): boolean {
  return COMPUTER_HABIT_ALIASES.has(normalizeHabitName(name));
}

export function isComputerTimeHabit(habit: {
  name?: string | null;
  metric_type?: string | null;
  integration_source?: string | null;
  sensor_type?: string | null;
  is_custom?: boolean | null;
}): boolean {
  const metricType = habit.metric_type?.trim().toLowerCase();
  if (metricType) return metricType === 'computer_time';

  const integrationSource = habit.integration_source?.trim().toLowerCase();
  const sensorType = habit.sensor_type?.trim().toLowerCase();
  return habit.is_custom === false
    && isComputerHabitName(habit.name ?? undefined)
    && (!integrationSource || integrationSource === 'ritual_watcher')
    && (!sensorType || sensorType === 'automatic');
}

export function getHabitDisplayName(name: string | undefined): string {
  if (isComputerHabitName(name)) return COMPUTER_HABIT_DISPLAY_NAME;
  const normalized = normalizeHabitName(name);
  return HABIT_DISPLAY_ALIASES[normalized] || (name || '');
}
