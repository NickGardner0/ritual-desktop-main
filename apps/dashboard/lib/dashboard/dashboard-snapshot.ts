import type { DateRange } from 'react-day-picker';
import { subDays } from 'date-fns';
import type { HabitStats } from '@/lib/services/analytics-api';
import type {
  DashboardSnapshot,
  MetricDailyPoint,
  MetricsSummaryRow,
} from '@/app/(dashboard)/dashboard/dashboard-initial-data';
import { getAnalyticsRangeKey, getAnalyticsRangeWindow } from './analytics-range';

export type DashboardSnapshotHabitLike = {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  metric_type?: string | null;
  integration_source?: string | null;
  target_unit?: string | null;
  unit_type?: string | null;
};

export type DashboardSnapshotHabitLogLike = {
  id?: string | null;
  habit_id?: string | null;
  duration?: number | null;
  amount?: number | null;
  date?: string | null;
  completed_at?: string | null;
  status?: string | null;
};

export const dashboardSnapshotKeys = {
  all: ['dashboard-snapshot', 'v2'] as const,
  byUser: (userId: string) => [...dashboardSnapshotKeys.all, userId] as const,
  detail: (userId: string, rangeKey: string) => [...dashboardSnapshotKeys.byUser(userId), rangeKey] as const,
};

type DashboardSnapshotMetaOverrides = Partial<DashboardSnapshot['meta']> & {
  dateRange?: DateRange;
  snapshotKey?: string;
};

type AggregateWindow = {
  startDate?: string;
  endDate?: string;
};

function getDefaultMeta(overrides?: DashboardSnapshotMetaOverrides): DashboardSnapshot['meta'] {
  const snapshotKey = overrides?.snapshotKey ?? getAnalyticsRangeKey(overrides?.dateRange);
  return {
    userId: overrides?.userId ?? null,
    snapshotKey,
    generatedAt: overrides?.generatedAt ?? Date.now(),
    hydratedFrom: overrides?.hydratedFrom ?? 'empty',
  };
}

export function createEmptyDashboardSnapshot(
  overrides?: DashboardSnapshotMetaOverrides,
): DashboardSnapshot {
  return {
    overviewStats: {},
    metricsAnalyticsData: {},
    metricsSummaryMetrics: {},
    metricsBarListAnalyticsData: {},
    metricsBarListSummaryMetrics: {},
    meta: getDefaultMeta(overrides),
  };
}

function getHabitUnit(habit: DashboardSnapshotHabitLike): string {
  const raw = habit.target_unit ?? habit.unit_type ?? 'sessions';
  return String(raw || 'sessions');
}

function isSleepLikeHabit(habit: DashboardSnapshotHabitLike): boolean {
  const habitName = String(habit.name || '').trim().toLowerCase();
  const category = String(habit.category || '').trim().toLowerCase();
  const metricType = String(habit.metric_type || '').trim().toLowerCase();
  const integrationSource = String(habit.integration_source || '').trim().toLowerCase();

  if (metricType && ['sleep', 'sleep_session', 'sleep_duration', 'sleep_total', 'in_bed'].includes(metricType)) {
    return true;
  }
  if (habitName.includes('sleep')) {
    return true;
  }
  return category.includes('sleep') && ['whoop', 'oura', 'apple_health', 'fitbit', 'garmin'].includes(integrationSource);
}

function isCompletedLog(log: DashboardSnapshotHabitLogLike): boolean {
  const status = String(log.status || '').trim().toLowerCase();
  return status === '' || status === 'completed' || status === 'success';
}

function getLogDate(log: DashboardSnapshotHabitLogLike): string | null {
  if (typeof log.date === 'string' && log.date.trim()) {
    return log.date.slice(0, 10);
  }
  if (typeof log.completed_at === 'string' && log.completed_at.trim()) {
    return log.completed_at.slice(0, 10);
  }
  return null;
}

function getNumericLogValue(
  habit: DashboardSnapshotHabitLike,
  log: DashboardSnapshotHabitLogLike,
): number {
  const unitLabel = getHabitUnit(habit).toLowerCase();
  if (typeof log.duration === 'number' && Number.isFinite(log.duration) && log.duration > 0) {
    if (unitLabel.includes('hour')) return log.duration / 3600;
    if (unitLabel.includes('minute')) return log.duration / 60;
    return log.duration;
  }
  if (typeof log.amount === 'number' && Number.isFinite(log.amount)) {
    return log.amount;
  }
  return 1;
}

function aggregateDailyValues(
  habit: DashboardSnapshotHabitLike,
  logs: DashboardSnapshotHabitLogLike[],
  window?: AggregateWindow,
): Map<string, number> {
  const useMaxPerDay = isSleepLikeHabit(habit);
  const dailyValues = new Map<string, number>();

  for (const log of logs) {
    if (!isCompletedLog(log)) continue;
    const day = getLogDate(log);
    if (!day) continue;
    if (window?.startDate && day < window.startDate) continue;
    if (window?.endDate && day > window.endDate) continue;

    const value = getNumericLogValue(habit, log);
    const previous = dailyValues.get(day) || 0;
    dailyValues.set(day, useMaxPerDay ? Math.max(previous, value) : previous + value);
  }

  return dailyValues;
}

function buildMetricDailyPoints(
  habit: DashboardSnapshotHabitLike,
  dailyValues: Map<string, number>,
): MetricDailyPoint[] {
  const unit = getHabitUnit(habit);
  return Array.from(dailyValues.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({
      habit_id: String(habit.id),
      date,
      value,
      daily_value: value,
      total_amount: value,
      unit,
    }));
}

function buildMetricsSummaryRow(
  habit: DashboardSnapshotHabitLike,
  dailyValues: Map<string, number>,
): MetricsSummaryRow {
  const values = Array.from(dailyValues.values()).filter((value) => Number.isFinite(value));
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length > 0 ? total / values.length : 0;

  return {
    habit_id: String(habit.id),
    habit_name: String(habit.name || ''),
    unit: getHabitUnit(habit),
    total_value: total,
    current_value: average,
    days_with_data: values.filter((value) => value > 0).length,
  };
}

function buildOverviewStats(
  habits: DashboardSnapshotHabitLike[],
  logsByHabit: Map<string, DashboardSnapshotHabitLogLike[]>,
  window?: AggregateWindow,
): Record<string, HabitStats> {
  const stats: Record<string, HabitStats> = {};

  for (const habit of habits) {
    if (!habit.id) continue;
    const dailyValues = aggregateDailyValues(habit, logsByHabit.get(String(habit.id)) || [], window);
    const values = Array.from(dailyValues.values()).filter((value) => Number.isFinite(value));
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = values.length > 0 ? total / values.length : 0;
    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const variance = values.length
      ? values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / values.length
      : 0;

    stats[String(habit.id)] = {
      id: String(habit.id),
      name: String(habit.name || ''),
      category: String(habit.category || ''),
      unit: getHabitUnit(habit),
      total,
      average,
      min,
      max,
      variance,
      std_dev: Math.sqrt(variance),
      days_with_data: values.filter((value) => value > 0).length,
      total_entries: values.length,
      summary: values.length > 0
        ? `${String(habit.name || '')}: ${total.toFixed(2)} total across ${values.length} days`
        : `${String(habit.name || '')}: no recent data`,
    };
  }

  return stats;
}

export function buildDashboardSnapshot(
  habits: DashboardSnapshotHabitLike[],
  habitLogs: DashboardSnapshotHabitLogLike[],
  overrides?: DashboardSnapshotMetaOverrides,
): DashboardSnapshot {
  const logsByHabit = new Map<string, DashboardSnapshotHabitLogLike[]>();
  for (const log of habitLogs) {
    if (!log.habit_id) continue;
    const habitId = String(log.habit_id);
    const existing = logsByHabit.get(habitId);
    if (existing) {
      existing.push(log);
    } else {
      logsByHabit.set(habitId, [log]);
    }
  }

  const rangeWindow = getAnalyticsRangeWindow(overrides?.dateRange);
  const isAllTime = !rangeWindow.hasExplicitRange;
  const allTimeOverviewWindow: AggregateWindow = {
    startDate: subDays(new Date(), 1095).toISOString().slice(0, 10),
  };
  const allTimeSparklineWindow: AggregateWindow = {
    startDate: subDays(new Date(), 180).toISOString().slice(0, 10),
  };
  const allTimeBarListWindow: AggregateWindow = {
    startDate: subDays(new Date(), 30).toISOString().slice(0, 10),
  };
  const explicitWindow: AggregateWindow | undefined = rangeWindow.hasExplicitRange
    ? {
        startDate: rangeWindow.startDate,
        endDate: rangeWindow.endDate,
      }
    : undefined;
  const overviewWindow = isAllTime ? allTimeOverviewWindow : explicitWindow;
  const sparklineWindow = isAllTime ? allTimeSparklineWindow : explicitWindow;
  const summaryWindow = isAllTime ? undefined : explicitWindow;
  const barListWindow = isAllTime ? allTimeBarListWindow : explicitWindow;
  const metricsAnalyticsData: Record<string, MetricDailyPoint[]> = {};
  const metricsSummaryMetrics: Record<string, MetricsSummaryRow> = {};
  const metricsBarListAnalyticsData: Record<string, MetricDailyPoint[]> = {};
  const metricsBarListSummaryMetrics: Record<string, MetricsSummaryRow> = {};

  for (const habit of habits) {
    if (!habit.id) continue;
    const habitId = String(habit.id);
    const habitLogsForHabit = logsByHabit.get(habitId) || [];
    const sparklineDaily = aggregateDailyValues(habit, habitLogsForHabit, sparklineWindow);
    const summaryDaily = aggregateDailyValues(habit, habitLogsForHabit, summaryWindow);
    const barListDaily = aggregateDailyValues(habit, habitLogsForHabit, barListWindow);

    metricsAnalyticsData[habitId] = buildMetricDailyPoints(habit, sparklineDaily);
    metricsSummaryMetrics[habitId] = buildMetricsSummaryRow(habit, summaryDaily);
    metricsBarListAnalyticsData[habitId] = buildMetricDailyPoints(habit, barListDaily);
    metricsBarListSummaryMetrics[habitId] = buildMetricsSummaryRow(habit, barListDaily);
  }

  return {
    overviewStats: buildOverviewStats(habits, logsByHabit, overviewWindow),
    metricsAnalyticsData,
    metricsSummaryMetrics,
    metricsBarListAnalyticsData,
    metricsBarListSummaryMetrics,
    meta: getDefaultMeta(overrides),
  };
}
