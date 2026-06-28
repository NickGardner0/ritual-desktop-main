export type HabitLog = {
  id: string;
  habit_id?: string;
  habit_name: string;
  category: string;
  icon?: string;
  date: string;
  completed_at?: string;
  duration?: number;
  amount?: number;
  unit_type?: string;
  status: 'completed' | 'skipped' | 'missed';
  notes?: string;
  integration_source?: string;
  metric_type?: string;
  time_precision?: 'exact' | 'day';
  metadata?: Record<string, any>;
  editable?: boolean;
  record_kind?: 'habit_log' | 'wearable_sample' | 'wearable_event';
  start_time?: string;
  end_time?: string;
  rollup_level?: string | null;
  aggregation_kind?: string | null;
  source_device_name?: string | null;
  location_lat?: number | null;
  location_lon?: number | null;
  location_accuracy_m?: number | null;
  location_source?: string | null;
  location_place_label?: string | null;
  location_confidence?: number | null;
  location_resolved_at?: number | null;
  location_signal_age_ms?: number | null;
};

export type FilterState = {
  q: string | null;
  start: string | null;
  end: string | null;
  categories: string[] | null;
  habits: string[] | null;
  statuses: string[] | null;
  sources: string[] | null;
};

export type TableDensity = 'comfortable' | 'compact';

export type SavedFilterView = {
  id: string;
  name: string;
  filters: FilterState;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  createdAt: string;
};

export type BuiltInFilterPresetId = 'all' | 'today' | 'last7' | 'completed' | 'manual';
