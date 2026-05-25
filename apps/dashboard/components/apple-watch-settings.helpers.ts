import {
  getWearableMetricType,
  type WearableMetricPreferences,
  type WearableMetricSyncMode,
} from '@/lib/wearables-dashboard';

export function formatHour(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:00 ${period}`;
}

export function seedLastEnabledSyncModesFromPreferences(
  preferences: WearableMetricPreferences,
  previous: Record<string, Exclude<WearableMetricSyncMode, 'off'>>,
): Record<string, Exclude<WearableMetricSyncMode, 'off'>> {
  const next = { ...previous };
  for (const [metricType, preference] of Object.entries(preferences) as Array<
    [string, WearableMetricPreferences[string]]
  >) {
    const syncMode = preference?.sync_mode;
    if (syncMode === 'daily_only' || syncMode === 'granular') {
      next[metricType] = syncMode;
    }
  }
  return next;
}

export function formatRelativeTime(dateValue: string | null | undefined): string {
  if (!dateValue) return 'Never';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / (1000 * 60));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleString();
}

export type AppleWatchTab = 'overview' | 'metrics' | 'export' | 'settings';
export type HabitProjectionSource = 'apple_health' | 'manual' | 'whoop' | 'oura' | 'garmin' | 'fitbit';

export interface HabitSummary {
  id: string;
  name: string;
  integration_source?: string | null;
  metric_type?: string | null;
  unit_type?: string | null;
  category?: string | null;
}

export interface HabitProjectionPolicy {
  habit_id: string;
  canonical_metric_type?: string | null;
  projection_source_priority: string[];
}

export interface ExportSchedule {
  enabled: boolean;
  frequency: 'daily' | 'weekly';
  format: 'markdown' | 'json' | 'csv';
  time: string;
  day_of_week: number | null;
  folder_path: string | null;
  include_all_metrics: boolean;
  metric_types: string[] | null;
}

export interface ExportHistoryEntry {
  id: string;
  timestamp: string;
  start_date: string;
  end_date: string;
  format: string;
  status: 'success' | 'failed';
  sample_count: number;
  file_size_bytes: number | null;
  file_path: string | null;
  error: string | null;
  triggered_by: 'manual' | 'scheduled';
}

export interface MetricEntry {
  type: string;
  name: string;
  unit: string;
}

export interface MetricCategory {
  category: string;
  metrics: MetricEntry[];
}

export interface ProjectionPriorityOption {
  value: string;
  label: string;
  priority: string[];
}

const APPLE_SOURCE_PRIORITY_METRIC_TYPES = new Set([
  'steps',
  'active_energy',
  'basal_energy',
  'distance',
  'flights_climbed',
  'exercise_time',
  'stand_time',
  'hr',
  'heart_rate',
  'hrv',
  'resting_hr',
  'resting_heart_rate',
  'walking_hr',
  'respiratory_rate',
  'oxygen_saturation',
  'sleep_total',
  'sleep_duration',
  'sleep_session',
  'sleep_asleep',
  'sleep_awake',
  'sleep_rem',
  'sleep_deep',
  'sleep_core',
  'workout',
  'mindful_minutes',
]);

const SOURCE_LABELS: Record<string, string> = {
  apple_health: 'Apple Health',
  manual: 'Manual',
  whoop: 'Whoop',
  oura: 'Oura',
  garmin: 'Garmin',
  fitbit: 'Fitbit',
};

const SOURCE_ORDER: HabitProjectionSource[] = [
  'manual',
  'whoop',
  'oura',
  'garmin',
  'fitbit',
  'apple_health',
];

function normalizeProjectionSource(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

export function formatProjectionSource(source: string | null | undefined): string {
  const normalized = normalizeProjectionSource(source);
  return (normalized && SOURCE_LABELS[normalized]) || 'Source';
}

export function isAppleProjectionMetric(metricType: string | null | undefined): boolean {
  const normalized = String(metricType || '').trim().toLowerCase();
  return APPLE_SOURCE_PRIORITY_METRIC_TYPES.has(normalized);
}

function orderProjectionSources(sources: Iterable<string>, preferredOrder: string[] = []): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const pushSource = (source: string | null | undefined) => {
    const normalized = normalizeProjectionSource(source);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    ordered.push(normalized);
  };

  preferredOrder.forEach(pushSource);
  SOURCE_ORDER.forEach(pushSource);
  Array.from(sources).sort().forEach(pushSource);
  return ordered;
}

function getProjectionCandidateSources(
  habit: HabitSummary,
  policy?: HabitProjectionPolicy | null,
): string[] {
  const metricType = getWearableMetricType(habit);
  const policyPriority = policy?.projection_source_priority || [];
  const candidateSources = new Set<string>(
    policyPriority
      .map((source) => normalizeProjectionSource(source))
      .filter((source): source is string => Boolean(source)),
  );

  const habitSource = normalizeProjectionSource(habit.integration_source);
  if (habitSource) candidateSources.add(habitSource);

  if (metricType) {
    if (metricType.startsWith('sleep')) {
      candidateSources.add('whoop');
      candidateSources.add('apple_health');
    } else if (metricType === 'workout' || metricType === 'mindful_minutes') {
      candidateSources.add('manual');
      candidateSources.add('apple_health');
    } else if (isAppleProjectionMetric(metricType)) {
      candidateSources.add('apple_health');
    }
  }

  if (candidateSources.size === 0) candidateSources.add('apple_health');
  return orderProjectionSources(candidateSources, policyPriority);
}

export function buildProjectionPriorityOptions(
  habit: HabitSummary,
  policy?: HabitProjectionPolicy | null,
): ProjectionPriorityOption[] {
  const sources = getProjectionCandidateSources(habit, policy);
  const options = new Map<string, ProjectionPriorityOption>();
  const addOption = (priority: string[], label: string) => {
    const normalizedPriority = priority
      .map((source) => normalizeProjectionSource(source))
      .filter((source): source is string => Boolean(source));
    if (normalizedPriority.length === 0) return;
    const value = normalizedPriority.join('|');
    if (!options.has(value)) options.set(value, { value, label, priority: normalizedPriority });
  };

  for (const source of sources) addOption([source], `${formatProjectionSource(source)} only`);
  if (sources.length > 1) {
    for (const primarySource of sources) {
      addOption([primarySource, ...sources.filter((source) => source !== primarySource)], `${formatProjectionSource(primarySource)} first`);
    }
  }

  const currentPriority = (policy?.projection_source_priority || [])
    .map((source) => normalizeProjectionSource(source))
    .filter((source): source is string => Boolean(source));
  if (currentPriority.length > 0) {
    addOption(
      currentPriority,
      currentPriority.length === 1
        ? `${formatProjectionSource(currentPriority[0])} only`
        : `${formatProjectionSource(currentPriority[0])} first`,
    );
  }

  return Array.from(options.values());
}

export function formatProjectionPrioritySummary(priority: string[] | null | undefined): string {
  const normalizedPriority = (priority || [])
    .map((source) => normalizeProjectionSource(source))
    .filter((source): source is string => Boolean(source));
  if (normalizedPriority.length === 0) return 'No priority set';
  return normalizedPriority.map((source) => formatProjectionSource(source)).join(' -> ');
}
