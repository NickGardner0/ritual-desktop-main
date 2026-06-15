/**
 * Habit create/read contracts shared across dashboard, backend, and chat runtime.
 * Mirrors apps/backend/models/habit_models.py HabitBase / Habit.
 */

export interface CreateHabitInput {
  name: string
  category: string
  icon?: string
  is_custom?: boolean
  integration_source?: string | null
  unit_type?: string | null
  sensor_type?: string | null
  metric_type?: string | null
}

export interface HabitRecord {
  id: string
  user_id: string
  name: string
  category: string
  icon?: string | null
  is_custom?: boolean
  integration_source?: string | null
  unit_type?: string | null
  sensor_type?: string | null
  metric_type?: string | null
  created_at: string
  updated_at: string
}
