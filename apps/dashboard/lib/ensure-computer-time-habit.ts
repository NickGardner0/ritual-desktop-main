import type { CreateHabitInput, HabitRecord } from '@ritual/shared-contracts';
import {
  COMPUTER_HABIT_DISPLAY_NAME,
  isComputerHabitName,
} from '@/lib/computer-time-habit';

/**
 * Creates the canonical "Computer Time" habit if the user does not already have
 * a computer-use / computer-time habit. Idempotent — safe to call on every Connect / Save.
 */
export async function ensureComputerTimeHabit(
  habits: Array<{
    id?: string | null;
    name?: string | null;
    is_custom?: boolean | null;
    integration_source?: string | null;
    metric_type?: string | null;
    sensor_type?: string | null;
  }>,
  createHabit: (data: CreateHabitInput) => Promise<HabitRecord>,
  updateHabit?: (habitId: string, updates: {
    integration_source: string;
    metric_type: string;
    sensor_type: string;
    is_custom: boolean;
  }) => Promise<unknown>,
): Promise<{ created: boolean; upgraded?: boolean; habit?: HabitRecord }> {
  const systemHabit = habits.find((habit) => habit.metric_type === 'computer_time');
  if (systemHabit) {
    return { created: false, habit: systemHabit as HabitRecord };
  }

  const canonicalLegacyHabit = habits.find((habit) => (
    Boolean(habit.id)
    && habit.is_custom === false
    && isComputerHabitName(habit.name ?? undefined)
    && !habit.metric_type
    && (!habit.integration_source || habit.integration_source === 'ritual_watcher')
    && (!habit.sensor_type || habit.sensor_type.toLowerCase() === 'automatic')
  ));
  if (canonicalLegacyHabit?.id) {
    if (updateHabit) {
      await updateHabit(canonicalLegacyHabit.id, {
        integration_source: 'ritual_watcher',
        metric_type: 'computer_time',
        sensor_type: 'Automatic',
        is_custom: false,
      });
    }
    return {
      created: false,
      upgraded: Boolean(updateHabit),
      habit: canonicalLegacyHabit as HabitRecord,
    };
  }

  const habit = await createHabit({
    name: COMPUTER_HABIT_DISPLAY_NAME,
    category: 'Productivity',
    is_custom: false,
    sensor_type: 'Automatic',
    icon: 'lucide:monitor',
    unit_type: 'Hours',
    integration_source: 'ritual_watcher',
    metric_type: 'computer_time',
  });

  return { created: true, habit };
}
