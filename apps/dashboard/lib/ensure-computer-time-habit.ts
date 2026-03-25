import {
  COMPUTER_HABIT_DISPLAY_NAME,
  isComputerHabitName,
} from '@/lib/computer-time-habit';

/**
 * Creates the canonical "Computer Time" habit if the user does not already have
 * a computer-use / computer-time habit. Idempotent — safe to call on every Connect / Save.
 */
export async function ensureComputerTimeHabit(
  habits: { name?: string | null }[],
  createHabit: (data: Record<string, unknown>) => Promise<unknown>
): Promise<{ created: boolean; habit?: unknown }> {
  if (habits.some((h) => isComputerHabitName(h.name ?? undefined))) {
    return { created: false };
  }

  const habit = await createHabit({
    name: COMPUTER_HABIT_DISPLAY_NAME,
    category: 'Productivity',
    is_custom: false,
    sensor_type: 'Manual',
    icon: 'lucide:monitor',
    unit_type: 'Hours',
    integration_source: null,
    metric_type: null,
  });

  return { created: true, habit };
}
