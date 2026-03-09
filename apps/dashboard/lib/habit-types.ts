export interface Habit {
  id?: string
  name: string
  category: string
  icon?: string
  is_custom?: boolean
  integration_source?: string
  created_at?: string
  updated_at?: string
  user_id?: string
  unit_type?: string
}

export interface HabitLog {
  id?: string
  habit_id: string
  duration?: number
  amount?: number
  unit?: string
  date: string
  completed_at?: string
  status: 'completed' | 'skipped' | 'missed'
  notes?: string
}
