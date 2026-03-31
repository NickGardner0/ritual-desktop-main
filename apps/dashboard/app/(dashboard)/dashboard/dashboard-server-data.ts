import { QueryClient, dehydrate } from '@tanstack/react-query';
import { subDays } from 'date-fns';
import {
  getAnalyticsSummary,
  getAuthenticatedUserId,
  getHabits,
  getHabitLogs,
} from '@/lib/server/data';
import type { HabitStats } from '@/lib/services/analytics-api';
import type { ViewMode } from '@/components/analytics/view-mode-toggle';
import type {
  DashboardDerivedInitialData,
  DashboardInitialData,
  MetricDailyPoint,
  MetricsSummaryRow,
} from './dashboard-initial-data';

type DashboardSearchParams = Record<string, string | string[] | undefined> | undefined;
type HabitLike = Awaited<ReturnType<typeof getHabits>>[number];
type HabitLogLike = Awaited<ReturnType<typeof getHabitLogs>>[number];

function readSingleParam(
  searchParams: DashboardSearchParams,
  key: string,
): string | null {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function resolveInitialViewMode(searchParams: DashboardSearchParams): ViewMode {
  const viewParam = readSingleParam(searchParams, 'view');
  if (viewParam === 'metrics' || viewParam === 'chat') {
    return viewParam;
  }
  return 'overview';
}

function getHabitUnit(habit: HabitLike): string {
  const record = habit as unknown as Record<string, unknown>;
  const raw = record.target_unit
    ?? record.unit_type
    ?? 'sessions';
  return String(raw || 'sessions');
}

function isSleepLikeHabit(habit: HabitLike): boolean {
  const record = habit as unknown as Record<string, unknown>;
  const habitName = String(record.name || '').trim().toLowerCase();
  const category = String(record.category || '').trim().toLowerCase();
  const metricType = String(record.metric_type || '').trim().toLowerCase();
  const integrationSource = String(record.integration_source || '').trim().toLowerCase();

  if (metricType && ['sleep', 'sleep_session', 'sleep_duration', 'sleep_total', 'in_bed'].includes(metricType)) {
    return true;
  }
  if (habitName.includes('sleep')) {
    return true;
  }
  return category.includes('sleep') && ['whoop', 'oura', 'apple_health', 'fitbit', 'garmin'].includes(integrationSource);
}

function isCompletedLog(log: HabitLogLike): boolean {
  const status = String(log.status || '').trim().toLowerCase();
  return status === '' || status === 'completed' || status === 'success';
}

function getLogDate(log: HabitLogLike): string | null {
  if (typeof log.date === 'string' && log.date.trim()) {
    return log.date.slice(0, 10);
  }
  if (typeof log.completed_at === 'string' && log.completed_at.trim()) {
    return log.completed_at.slice(0, 10);
  }
  return null;
}

function getNumericLogValue(habit: HabitLike, log: HabitLogLike): number {
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
  habit: HabitLike,
  logs: HabitLogLike[],
  minDateInclusive?: string,
): Map<string, number> {
  const useMaxPerDay = isSleepLikeHabit(habit);
  const dailyValues = new Map<string, number>();

  for (const log of logs) {
    if (!isCompletedLog(log)) continue;
    const day = getLogDate(log);
    if (!day) continue;
    if (minDateInclusive && day < minDateInclusive) continue;

    const value = getNumericLogValue(habit, log);
    const previous = dailyValues.get(day) || 0;
    dailyValues.set(day, useMaxPerDay ? Math.max(previous, value) : previous + value);
  }

  return dailyValues;
}

function buildMetricDailyPoints(
  habit: HabitLike,
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
  habit: HabitLike,
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
  habits: HabitLike[],
  logsByHabit: Map<string, HabitLogLike[]>,
): Record<string, HabitStats> {
  const minDate = subDays(new Date(), 1095).toISOString().slice(0, 10);
  const stats: Record<string, HabitStats> = {};

  for (const habit of habits) {
    if (!habit.id) continue;
    const dailyValues = aggregateDailyValues(habit, logsByHabit.get(String(habit.id)) || [], minDate);
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
      category: String((habit as unknown as Record<string, unknown>).category || ''),
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

function buildDerivedInitialData(
  habits: HabitLike[],
  habitLogs: HabitLogLike[],
): DashboardDerivedInitialData {
  const logsByHabit = new Map<string, HabitLogLike[]>();
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

  const sparklineMinDate = subDays(new Date(), 180).toISOString().slice(0, 10);
  const barListMinDate = subDays(new Date(), 30).toISOString().slice(0, 10);
  const metricsAnalyticsData: Record<string, MetricDailyPoint[]> = {};
  const metricsSummaryMetrics: Record<string, MetricsSummaryRow> = {};
  const metricsBarListAnalyticsData: Record<string, MetricDailyPoint[]> = {};
  const metricsBarListSummaryMetrics: Record<string, MetricsSummaryRow> = {};

  for (const habit of habits) {
    if (!habit.id) continue;
    const habitId = String(habit.id);
    const habitLogsForHabit = logsByHabit.get(habitId) || [];
    const sparklineDaily = aggregateDailyValues(habit, habitLogsForHabit, sparklineMinDate);
    const summaryDaily = aggregateDailyValues(habit, habitLogsForHabit);
    const barListDaily = aggregateDailyValues(habit, habitLogsForHabit, barListMinDate);

    metricsAnalyticsData[habitId] = buildMetricDailyPoints(habit, sparklineDaily);
    metricsSummaryMetrics[habitId] = buildMetricsSummaryRow(habit, summaryDaily);
    metricsBarListAnalyticsData[habitId] = buildMetricDailyPoints(habit, barListDaily);
    metricsBarListSummaryMetrics[habitId] = buildMetricsSummaryRow(habit, barListDaily);
  }

  return {
    overviewStats: buildOverviewStats(habits, logsByHabit),
    metricsAnalyticsData,
    metricsSummaryMetrics,
    metricsBarListAnalyticsData,
    metricsBarListSummaryMetrics,
  };
}

export async function loadDashboardInitialData(
  searchParams?: Promise<DashboardSearchParams> | DashboardSearchParams,
): Promise<DashboardInitialData> {
  const resolvedSearchParams = searchParams instanceof Promise
    ? await searchParams
    : searchParams;
  const initialViewMode = resolveInitialViewMode(resolvedSearchParams);
  const queryClient = new QueryClient();
  const userId = await getAuthenticatedUserId();

  const [habits, habitLogs, analyticsSummary] = await Promise.all([
    getHabits(),
    getHabitLogs(),
    getAnalyticsSummary(1095).catch(() => null),
  ]);

  queryClient.setQueryData(['habits', 'list', userId], habits);
  if (habitLogs.length > 0) {
    queryClient.setQueryData(['habit-logs', 'list', userId], habitLogs);
  }
  if (analyticsSummary) {
    queryClient.setQueryData(['analytics-summary', userId], analyticsSummary);
  }

  return {
    dehydratedState: dehydrate(queryClient),
    initialViewMode,
    derived: buildDerivedInitialData(habits, habitLogs),
  };
}
