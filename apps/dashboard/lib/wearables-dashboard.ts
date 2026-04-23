import { format, subDays } from 'date-fns';

export type WearableMetricSyncMode = 'off' | 'daily_only' | 'granular';

export type WearableMetricPreferences = Record<
  string,
  {
    sync_mode: WearableMetricSyncMode;
  }
>;

export type WearableTimelineItem = {
  id: string;
  kind: string;
  provider?: string | null;
  metric_type?: string | null;
  event_type?: string | null;
  habit_id?: string | null;
  habit_name?: string | null;
  title?: string | null;
  timestamp: string;
  start_time?: string | null;
  end_time?: string | null;
  attributed_date?: string | null;
  value?: number | null;
  unit?: string | null;
  aggregation_kind?: string | null;
  rollup_level?: string | null;
  rollup_window_minutes?: number | null;
  status?: string | null;
  notes?: string | null;
  source_device_name?: string | null;
};

export type WearableTimelineResponse = {
  items: WearableTimelineItem[];
  next_cursor?: string | null;
};

export type WearableSeriesPoint = {
  timestamp: string;
  start_time?: string | null;
  end_time?: string | null;
  value: number;
  unit?: string | null;
  provider?: string | null;
  metric_type: string;
  aggregation_kind?: string | null;
  rollup_level?: string | null;
  rollup_window_minutes?: number | null;
  attributed_date?: string | null;
  source_device_name?: string | null;
};

export type WearableSeriesResponse = {
  metric_type: string;
  resolution: string;
  points: WearableSeriesPoint[];
};

export type WearableDailyMetricValue = {
  value: number;
  unit?: string | null;
  aggregation?: string | null;
  provider?: string | null;
};

export type WearableDailyTotal = {
  date: string;
  metrics: Record<string, WearableDailyMetricValue>;
};

export type WearableDailyTotalsResponse = {
  days: WearableDailyTotal[];
};

export type WearableBackedHabitLike = {
  id?: string | null;
  habit_id?: string | null;
  name?: string | null;
  habit_name?: string | null;
  metric_type?: string | null;
  integration_source?: string | null;
  unit_type?: string | null;
  category?: string | null;
};

export type WearableDailyRow = {
  date: string;
  value: number;
  unit?: string | null;
  aggregation?: string | null;
  provider?: string | null;
};

const WEARABLE_SOURCES = new Set(['apple_health', 'whoop', 'oura', 'garmin', 'fitbit']);
const AVERAGE_METRIC_TYPES = new Set([
  'oxygen_saturation',
  'hr',
  'heart_rate',
  'resting_hr',
  'walking_hr',
  'hrv',
  'respiratory_rate',
  'body_mass',
  'body_mass_index',
  'body_fat_percentage',
  'lean_body_mass',
  'height',
  'waist_circumference',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'blood_glucose',
  'body_temperature',
  'walking_speed',
  'walking_step_length',
  'walking_asymmetry',
]);
const CUMULATIVE_METRIC_TYPES = new Set([
  'steps',
  'distance',
  'active_energy',
  'basal_energy',
  'exercise_time',
  'stand_time',
  'flights_climbed',
  'sleep_total',
  'sleep_duration',
  'workout',
  'mindful_minutes',
  'dietary_energy',
  'dietary_protein',
  'dietary_carbs',
  'dietary_fat',
  'dietary_fiber',
  'dietary_sugar',
  'dietary_water',
  'dietary_caffeine',
]);

const METRIC_LABELS: Record<string, string> = {
  steps: 'Steps',
  active_energy: 'Active Energy',
  basal_energy: 'Basal Energy',
  distance: 'Distance',
  flights_climbed: 'Flights Climbed',
  exercise_time: 'Exercise Time',
  stand_time: 'Stand Time',
  hr: 'Heart Rate',
  heart_rate: 'Heart Rate',
  hrv: 'HRV',
  resting_hr: 'Resting Heart Rate',
  walking_hr: 'Walking Heart Rate',
  respiratory_rate: 'Respiratory Rate',
  oxygen_saturation: 'Oxygen Saturation',
  sleep_total: 'Sleep Duration',
  sleep_duration: 'Sleep Duration',
  sleep_session: 'Sleep Session',
  sleep_asleep: 'Sleep Asleep',
  sleep_awake: 'Sleep Awake',
  sleep_rem: 'Sleep REM',
  sleep_deep: 'Sleep Deep',
  sleep_core: 'Sleep Core',
  workout: 'Workout',
  mindful_minutes: 'Mindful Minutes',
};

const METRIC_CATEGORIES: Record<string, string> = {
  steps: 'Health',
  active_energy: 'Health',
  basal_energy: 'Health',
  distance: 'Health',
  flights_climbed: 'Health',
  exercise_time: 'Health',
  stand_time: 'Health',
  hr: 'Health',
  heart_rate: 'Health',
  hrv: 'Health',
  resting_hr: 'Health',
  walking_hr: 'Health',
  respiratory_rate: 'Health',
  oxygen_saturation: 'Health',
  sleep_total: 'Health',
  sleep_duration: 'Health',
  sleep_session: 'Health',
  sleep_asleep: 'Health',
  sleep_awake: 'Health',
  sleep_rem: 'Health',
  sleep_deep: 'Health',
  sleep_core: 'Health',
  workout: 'Health',
  mindful_minutes: 'Health',
};

export function isWearableIntegrationSource(source?: string | null): boolean {
  return WEARABLE_SOURCES.has(String(source || '').trim().toLowerCase());
}

export function isWearableBackedHabit(habit?: WearableBackedHabitLike | null): boolean {
  if (!habit) return false;
  const metricType = getWearableMetricType(habit);
  if (!metricType) return false;
  return isWearableIntegrationSource(habit.integration_source) || Boolean(metricType);
}

export function getWearableMetricType(habit?: WearableBackedHabitLike | null): string | null {
  const metricType = String(habit?.metric_type || '').trim().toLowerCase();
  return metricType || null;
}

export function getWearableProviderForHabit(habit?: WearableBackedHabitLike | null): string | null {
  const source = String(habit?.integration_source || '').trim().toLowerCase();
  return isWearableIntegrationSource(source) ? source : null;
}

export function getWearableHabitId(habit?: WearableBackedHabitLike | null): string | null {
  return String(habit?.habit_id || habit?.id || '').trim() || null;
}

export function getWearableHabitName(habit?: WearableBackedHabitLike | null): string {
  return String(habit?.habit_name || habit?.name || '').trim();
}

export function humanizeWearableMetric(metricType?: string | null): string {
  const normalized = String(metricType || '').trim().toLowerCase();
  if (!normalized) return 'Metric';
  return METRIC_LABELS[normalized] || normalized.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getWearableMetricCategory(metricType?: string | null): string {
  const normalized = String(metricType || '').trim().toLowerCase();
  return METRIC_CATEGORIES[normalized] || 'Health';
}

export function usesAverageDisplay(metricType?: string | null, unitType?: string | null, habitName?: string | null): boolean {
  const normalizedMetric = String(metricType || '').trim().toLowerCase();
  const normalizedUnit = String(unitType || '').trim().toLowerCase();
  const normalizedName = String(habitName || '').trim().toLowerCase();

  if (AVERAGE_METRIC_TYPES.has(normalizedMetric)) return true;
  if (normalizedUnit.includes('percentage') || normalizedUnit === 'percent' || normalizedUnit === '%' || normalizedUnit === 'bpm') {
    return true;
  }
  if (normalizedName.includes('heart rate')) return true;
  return false;
}

export function getWearableDateRange(
  dateRange?: { from?: Date | undefined; to?: Date | undefined },
  fallbackDays = 3650,
): {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
} {
  const now = new Date();
  const from = dateRange?.from || subDays(now, fallbackDays);
  const to = dateRange?.to || now;
  const startDate = format(from, 'yyyy-MM-dd');
  const endDate = format(to, 'yyyy-MM-dd');
  const startTime = `${startDate}T00:00:00Z`;
  const endTime = `${endDate}T23:59:59Z`;
  return { startDate, endDate, startTime, endTime };
}

export function buildWearableDailyRows(
  days: WearableDailyTotal[],
  metricType: string,
): WearableDailyRow[] {
  const rows = days
    .map<WearableDailyRow | null>((day) => {
      const metric = day.metrics?.[metricType];
      if (!metric || !Number.isFinite(Number(metric.value))) return null;
      return {
        date: day.date,
        value: Number(metric.value),
        unit: metric.unit || null,
        aggregation: metric.aggregation || null,
        provider: metric.provider || null,
      };
    })
    .filter((row): row is WearableDailyRow => row !== null);

  rows.sort((left, right) => left.date.localeCompare(right.date));
  return rows;
}

export function summarizeWearableDailyRows(rows: WearableDailyRow[]): {
  total: number;
  average: number;
  min: number;
  max: number;
  stdDev: number;
  daysWithData: number;
  unit: string | null;
} {
  const values = rows
    .map((row) => Number(row.value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) {
    return {
      total: 0,
      average: 0,
      min: 0,
      max: 0,
      stdDev: 0,
      daysWithData: 0,
      unit: rows[0]?.unit || null,
    };
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const average = total / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / values.length;

  return {
    total,
    average,
    min,
    max,
    stdDev: Math.sqrt(variance),
    daysWithData: values.length,
    unit: rows[0]?.unit || null,
  };
}

export function isDailyWearableTimelineItem(item: Pick<WearableTimelineItem, 'rollup_level' | 'aggregation_kind'>): boolean {
  const rollupLevel = String(item.rollup_level || '').trim().toLowerCase();
  const aggregationKind = String(item.aggregation_kind || '').trim().toLowerCase();
  return rollupLevel === 'daily' || aggregationKind === 'daily' || aggregationKind === 'daily_aggregate';
}

export function shouldSumWearableMetric(metricType?: string | null): boolean {
  const normalizedMetric = String(metricType || '').trim().toLowerCase();
  return CUMULATIVE_METRIC_TYPES.has(normalizedMetric);
}
