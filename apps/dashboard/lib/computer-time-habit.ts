const COMPUTER_HABIT_ALIASES = new Set([
  'computer use',
  'computer activity',
  'computer time',
]);

export const COMPUTER_HABIT_DISPLAY_NAME = 'Computer Time';

export function normalizeHabitName(name: string | undefined): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isComputerHabitName(name: string | undefined): boolean {
  return COMPUTER_HABIT_ALIASES.has(normalizeHabitName(name));
}

export function getHabitDisplayName(name: string | undefined): string {
  return isComputerHabitName(name) ? COMPUTER_HABIT_DISPLAY_NAME : (name || '');
}

