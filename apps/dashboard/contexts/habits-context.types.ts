import type { Habit as ServiceHabit, HabitLog as ServiceHabitLog } from '@/lib/habit-types';

export interface Habit extends ServiceHabit {
  emoji?: string;
  streak?: number;
  color?: string;
}

export interface HabitLog extends Omit<ServiceHabitLog, 'duration'> {
  user_id?: string;
  duration: number;
  status: 'completed' | 'missed' | 'skipped';
}
