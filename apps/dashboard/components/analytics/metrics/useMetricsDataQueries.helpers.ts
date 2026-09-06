'use client';

import type { MutableRefObject } from 'react';
import type { MetricDailyRow, MetricSummaryLike } from '@/components/analytics/metrics-derived';
import type { WearableDailyTotal } from '@/lib/wearables-dashboard';
import type { HabitData } from '../metrics-view.shared';

export type MetricRow = MetricDailyRow & {
  habit_id?: string;
  habit_name?: string;
  total_value?: number;
  current_value?: number;
};

export type HabitStatsRow = {
  id?: string;
  name?: string;
  unit?: string;
  total?: number;
  average?: number;
  days_with_data?: number;
};

export type MetricsRowsByHabit = Record<string, MetricRow[]>;
export type MetricsSummaryByHabit = Record<string, MetricSummaryLike>;

export type MetricsDataEffectsContext = {
  analyticsData: MetricsRowsByHabit;
  availableHabits: HabitData[];
  backfillAttempted: MutableRefObject<boolean>;
  barListAnalyticsData: MetricsRowsByHabit;
  barListRange: string;
  barListSummaryMetrics: MetricsSummaryByHabit;
  computerActivityDaily: unknown[];
  dateRange?: { from?: Date | null; to?: Date | null } | null;
  dateRangeSyncKey: string;
  fetchWearableDailyTotalsForHabits: (
    habitIds: string[],
    startDate: string,
    endDate: string,
  ) => Promise<Record<string, WearableDailyTotal[]>>;
  filteredHabitIds: string[];
  filteredHabits?: HabitData[];
  getToken: () => Promise<string | null>;
  habitById: Map<string, HabitData>;
  habitLogsByHabitId?: unknown;
  hasInitialBarListAnalytics: boolean;
  hasInitialBarListSummary: boolean;
  hasInitialMetricsAnalytics: boolean;
  hasInitialMetricsSummary: boolean;
  initialAnalyticsData?: MetricsRowsByHabit;
  initialSummaryMetrics?: MetricsSummaryByHabit;
  isUserLoaded: boolean;
  lastBarListFetchKeyRef: MutableRefObject<string | null>;
  lastCanonicalFetchKeyRef: MutableRefObject<string | null>;
  lastHydratedCanonicalRangeKeyRef: MutableRefObject<string | null>;
  loading: boolean;
  metricsFirstUsablePaintLoggedRef: MutableRefObject<boolean>;
  metricsMountTimeRef: MutableRefObject<number>;
  queryLoading: boolean;
  realtimeRefreshTick: number;
  selectedHabits: string[];
  setAnalyticsData: (value: MetricsRowsByHabit) => void;
  setAnalyticsError: (value: string | null) => void;
  setBarListAnalyticsData: (value: MetricsRowsByHabit) => void;
  setBarListSummaryMetrics: (value: MetricsSummaryByHabit) => void;
  setLoading: (value: boolean) => void;
  setSelectedHabits: (value: string[]) => void;
  setSummaryMetrics: (value: MetricsSummaryByHabit) => void;
  skippedInitialBarListFetchRef: MutableRefObject<boolean>;
  summaryMetrics: MetricsSummaryByHabit;
  user?: { id?: string | null } | null;
  visibleMetricHabitIds: string[];
};

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isMetricRow(value: unknown): value is MetricRow {
  return isObject(value);
}

export function getPayloadRows(payload: unknown): MetricRow[] {
  if (!isObject(payload) || !Array.isArray(payload.data)) {
    return [];
  }
  return payload.data.filter(isMetricRow);
}

export function getResponseRows(response: unknown): MetricRow[] {
  if (!isObject(response)) {
    return [];
  }
  const rows = Array.isArray(response.data) ? response.data : response.daily_data;
  return Array.isArray(rows) ? rows.filter(isMetricRow) : [];
}

export function getStatsRows(result: unknown): HabitStatsRow[] {
  if (!isObject(result) || !Array.isArray(result.habits)) {
    return [];
  }
  return result.habits.filter(isObject).map((row) => ({
    id: typeof row.id === 'string' ? row.id : undefined,
    name: typeof row.name === 'string' ? row.name : undefined,
    unit: typeof row.unit === 'string' ? row.unit : undefined,
    total: typeof row.total === 'number' ? row.total : undefined,
    average: typeof row.average === 'number' ? row.average : undefined,
    days_with_data: typeof row.days_with_data === 'number' ? row.days_with_data : undefined,
  }));
}
