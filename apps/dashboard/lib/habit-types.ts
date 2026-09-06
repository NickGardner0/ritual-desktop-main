export interface Habit {
  id?: string
  name: string
  category: string
  icon?: string
  is_custom?: boolean
  integration_source?: string
  metric_type?: string
  created_at?: string
  updated_at?: string
  user_id?: string
  unit_type?: string
  sensor_type?: string
}

export interface HabitLog {
  id?: string
  habit_id: string
  habit_name?: string
  duration?: number
  amount?: number
  unit?: string
  date: string
  completed_at?: string
  status: 'completed' | 'skipped' | 'missed'
  notes?: string
  integration_source?: string
  metric_type?: string
  time_precision?: 'exact' | 'day'
  location_lat?: number | null
  location_lon?: number | null
  location_accuracy_m?: number | null
  location_source?: string | null
  location_place_label?: string | null
  location_confidence?: number | null
  location_resolved_at?: number | null
  location_signal_age_ms?: number | null
}
