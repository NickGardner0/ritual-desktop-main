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

export function getHabitDisplayName(name: string | undefined): string {
  if (isComputerHabitName(name)) return COMPUTER_HABIT_DISPLAY_NAME;
  const normalized = normalizeHabitName(name);
  return HABIT_DISPLAY_ALIASES[normalized] || (name || '');
}
