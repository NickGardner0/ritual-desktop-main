'use client';

import { useEffect, type MutableRefObject } from 'react';
import { format, subDays } from 'date-fns';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import { analyticsApi } from '@/lib/services/analytics-api';
import {
  buildLocalMetricSummary,
  buildWearableMetricDailyRowsForHabit,
  getRangeDates,
  isSleepLikeHabit,
} from './metrics-view.shared';
import type { HabitData } from './metrics-view.shared';
import {
  mapDailyBreakdownRows,
  type MetricDailyRow,
  type MetricSummaryLike,
} from '@/components/analytics/metrics-derived';
import {
  getWearableProviderForHabit,
  isWearableBackedHabit,
  type WearableDailyTotal,
} from '@/lib/wearables-dashboard';
import {
  DEFAULT_METRICS_SPARKLINE_DAYS,
  DEFAULT_METRICS_SUMMARY_DAYS,
} from './metrics-view.shared';
import { perfError, perfInfo, startPerfTimer } from '@/lib/perf-debug';

type MetricRow = MetricDailyRow & {
  habit_id?: string;
  habit_name?: string;
  total_value?: number;
  current_value?: number;
};

type HabitStatsRow = {
  id?: string;
  name?: string;
  unit?: string;
  total?: number;
  average?: number;
  days_with_data?: number;
};

type MetricsRowsByHabit = Record<string, MetricRow[]>;
type MetricsSummaryByHabit = Record<string, MetricSummaryLike>;

type MetricsDataEffectsContext = {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isMetricRow(value: unknown): value is MetricRow {
  return isObject(value);
}

function getPayloadRows(payload: unknown): MetricRow[] {
  if (!isObject(payload) || !Array.isArray(payload.data)) {
    return [];
  }
  return payload.data.filter(isMetricRow);
}

function getResponseRows(response: unknown): MetricRow[] {
  if (!isObject(response)) {
    return [];
  }
  const rows = Array.isArray(response.data) ? response.data : response.daily_data;
  return Array.isArray(rows) ? rows.filter(isMetricRow) : [];
}

function getStatsRows(result: unknown): HabitStatsRow[] {
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

export function useMetricsDataEffects(ctx: MetricsDataEffectsContext) {
  const {
    analyticsData,
    availableHabits,
    backfillAttempted,
    barListAnalyticsData,
    barListRange,
    barListSummaryMetrics,
    computerActivityDaily,
    dateRange,
    dateRangeSyncKey,
    fetchWearableDailyTotalsForHabits,
    filteredHabitIds,
    getToken,
    habitById,
    hasInitialBarListAnalytics,
    hasInitialBarListSummary,
    hasInitialMetricsAnalytics,
    hasInitialMetricsSummary,
    initialAnalyticsData,
    initialSummaryMetrics,
    isUserLoaded,
    lastBarListFetchKeyRef,
    lastCanonicalFetchKeyRef,
    lastHydratedCanonicalRangeKeyRef,
    loading,
    metricsFirstUsablePaintLoggedRef,
    metricsMountTimeRef,
    queryLoading,
    realtimeRefreshTick,
    selectedHabits,
    setAnalyticsData,
    setAnalyticsError,
    setBarListAnalyticsData,
    setBarListSummaryMetrics,
    setLoading,
    setSelectedHabits,
    setSummaryMetrics,
    skippedInitialBarListFetchRef,
    summaryMetrics,
    user,
    visibleMetricHabitIds,
  } = ctx;

// Auto-select all habits when data loads
useEffect(() => {
  if (availableHabits.length > 0 && selectedHabits.length === 0) {
    const allHabitIds = availableHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);
    if (allHabitIds.length > 0) {
      setSelectedHabits(allHabitIds);
    }
  }
}, [availableHabits, selectedHabits.length, setSelectedHabits]);

// Fetch canonical daily values + summary (Tinybird first, Python fallback only on failure)
useEffect(() => {
  if (!isUserLoaded || !user?.id) return;

  const habitsToFetch = visibleMetricHabitIds;
  const hasQueryBackedCanonicalData =
    Object.keys(initialAnalyticsData ?? {}).length > 0 ||
    Object.keys(initialSummaryMetrics ?? {}).length > 0;

  if (habitsToFetch.length === 0) {
    setLoading(false);
    return;
  }

  let cancelled = false;

  const fetchCanonicalAnalytics = async () => {
    const useWideRange = !dateRange?.from || !dateRange?.to;
    const canonicalFetchKey = [
      habitsToFetch.join(','),
      useWideRange ? `wide:${DEFAULT_METRICS_SPARKLINE_DAYS}:${DEFAULT_METRICS_SUMMARY_DAYS}` : `${dateRange!.from!.toISOString()}:${dateRange!.to!.toISOString()}`,
      realtimeRefreshTick,
    ].join('|');

    if (
      lastCanonicalFetchKeyRef.current === canonicalFetchKey &&
      (Object.keys(analyticsData).length > 0 || Object.keys(summaryMetrics).length > 0)
    ) {
      return;
    }
    lastCanonicalFetchKeyRef.current = canonicalFetchKey;

    const stopTimer = startPerfTimer('metrics-view', 'fetch-canonical-analytics', {
      habit_count: habitsToFetch.length,
      has_existing_data: Object.keys(analyticsData).length > 0,
      use_wide_range: useWideRange,
    });
    const hasExistingData = Object.keys(analyticsData).length > 0;
    if (!hasExistingData) {
      setLoading(true);
    }
    setAnalyticsError(null);

    const dailyParams = new URLSearchParams();
    const summaryParams = new URLSearchParams();
    let dailyStartDateForFetch: string;
    let summaryStartDateForFetch: string;
    let endDateForFetch: string;

    if (!useWideRange) {
      const startDate = format(dateRange!.from!, 'yyyy-MM-dd');
      const endDate = format(dateRange!.to!, 'yyyy-MM-dd');
      // Extend the daily fetch back by one window length so the spark cards
      // can compute "vs prior equivalent window" without a second round trip.
      // The summary range still reflects the user-selected window only.
      const windowMs = dateRange!.to!.getTime() - dateRange!.from!.getTime();
      const priorFromDate = new Date(dateRange!.from!.getTime() - windowMs);
      const dailyStartDate = format(priorFromDate, 'yyyy-MM-dd');
      dailyStartDateForFetch = dailyStartDate;
      summaryStartDateForFetch = startDate;
      endDateForFetch = endDate;
      dailyParams.set('start_date', dailyStartDate);
      dailyParams.set('end_date', endDate);
      summaryParams.set('start_date', startDate);
      summaryParams.set('end_date', endDate);
    } else {
      // Keep "All time" totals, but cap sparkline history so the initial metrics
      // grid does not have to download years of daily rows for every habit.
      const now = new Date();
      dailyStartDateForFetch = format(subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS), 'yyyy-MM-dd');
      summaryStartDateForFetch = format(subDays(now, DEFAULT_METRICS_SUMMARY_DAYS), 'yyyy-MM-dd');
      endDateForFetch = format(now, 'yyyy-MM-dd');
      dailyParams.set('days_back', String(DEFAULT_METRICS_SPARKLINE_DAYS));
      summaryParams.set('days_back', String(DEFAULT_METRICS_SUMMARY_DAYS));
    }

    if (habitsToFetch.length === 1) {
      dailyParams.set('habit_id', habitsToFetch[0]);
      summaryParams.set('habit_id', habitsToFetch[0]);
    } else {
      const joinedIds = habitsToFetch.join(',');
      dailyParams.set('habit_ids', joinedIds);
      summaryParams.set('habit_ids', joinedIds);
    }

    try {
      const [dailyRes, summaryRes] = await Promise.all([
        fetch(`/api/analytics/habits/daily-values?output=daily&${dailyParams.toString()}`),
        fetch(`/api/analytics/habits/daily-values?output=summary&${summaryParams.toString()}`),
      ]);
      if (cancelled) return;

      if (!dailyRes.ok || !summaryRes.ok) {
        throw new Error(`Tinybird canonical fetch failed (daily=${dailyRes.status}, summary=${summaryRes.status})`);
      }

      const [dailyPayload, summaryPayload] = await Promise.all([
        dailyRes.json(),
        summaryRes.json(),
      ]);
      if (cancelled) return;

      const dataByHabit: MetricsRowsByHabit = {};
      habitsToFetch.forEach((habitId: string) => {
        dataByHabit[habitId] = [];
      });

      getPayloadRows(dailyPayload).forEach((row) => {
        if (row.habit_id && habitsToFetch.includes(row.habit_id)) {
          dataByHabit[row.habit_id].push(row);
        }
      });

      const summaryMap: MetricsSummaryByHabit = {};
      getPayloadRows(summaryPayload).forEach((row) => {
        if (row.habit_id) {
          summaryMap[row.habit_id] = row;
        }
      });

      const totalDailyRows = Object.values(dataByHabit).reduce((sum, rows) => sum + rows.length, 0);
      const habitsWithData = Object.values(dataByHabit).filter(rows => rows.length > 0).length;
      const coverageRatio = habitsToFetch.length > 0 ? habitsWithData / habitsToFetch.length : 0;

      if (totalDailyRows === 0) {
        throw new Error('Tinybird returned no daily data, falling back to Python backend');
      }

      if (habitsToFetch.length > 1 && coverageRatio < 0.5) {
        console.warn(`⚠️ Tinybird only has data for ${habitsWithData}/${habitsToFetch.length} habits (${(coverageRatio * 100).toFixed(0)}%), falling back to Python`);
        throw new Error('Tinybird data too sparse, falling back to Python backend');
      }

      const sleepHabitIds = habitsToFetch.filter((habitId: string) =>
        isSleepLikeHabit(availableHabits.find((habit: HabitData) => habit.habit_id === habitId))
      );

      if (sleepHabitIds.length > 0) {
        const token = await getToken();
        if (token) {
          const now = new Date();
          const to = useWideRange ? now : (dateRange?.to || now);
          const summaryFrom = useWideRange ? subDays(now, DEFAULT_METRICS_SUMMARY_DAYS) : (dateRange?.from || subDays(now, DEFAULT_METRICS_SUMMARY_DAYS));
          const dailyFrom = useWideRange ? subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS) : (dateRange?.from || subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS));
          const summaryStartDate = format(summaryFrom, 'yyyy-MM-dd');
          const dailyStartDate = format(dailyFrom, 'yyyy-MM-dd');
          const endDate = format(to, 'yyyy-MM-dd');
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

          const [statsResult, dailyResults] = await Promise.all([
            analyticsApi.getHabitStats(token, { startDate: summaryStartDate, endDate }),
            Promise.all(
            sleepHabitIds.map((habitId: string) =>
                analyticsApi.getDailyBreakdown(token, {
                  habitId,
                  startDate: dailyStartDate,
                  endDate,
                  timezone,
                }).catch(() => null)
              )
            ),
          ]);

          const statsById = new Map(
            getStatsRows(statsResult)
              .filter((stat): stat is HabitStatsRow & { id: string } => Boolean(stat.id))
              .map((stat) => [stat.id, stat])
          );

        sleepHabitIds.forEach((habitId: string, index: number) => {
            const stat = statsById.get(habitId);
            if (stat) {
              summaryMap[habitId] = {
                ...(summaryMap[habitId] || {}),
                habit_id: stat.id,
                habit_name: stat.name,
                unit: stat.unit,
                total_value: stat.total,
                current_value: stat.average,
                days_with_data: stat.days_with_data,
              };
            }

            const response = dailyResults[index];
            const rows = getResponseRows(response);
            if (rows.length > 0) {
              dataByHabit[habitId] = mapDailyBreakdownRows(habitId, rows);
            }
          });
        }
      }

      const wearableHabitIds = habitsToFetch.filter((habitId: string) => {
        const habit = habitById.get(habitId);
        return Boolean(habit && isWearableBackedHabit(habit));
      });

      if (wearableHabitIds.length > 0) {
        const wearableDailyTotals = await fetchWearableDailyTotalsForHabits(
          wearableHabitIds,
          dailyStartDateForFetch,
          endDateForFetch,
        );

        for (const habitId of wearableHabitIds) {
          const habit = habitById.get(habitId);
          if (!habit) continue;
          const providerKey = getWearableProviderForHabit(habit) || '__preferred__';
          const dailyRows = buildWearableMetricDailyRowsForHabit(
            habit,
            wearableDailyTotals[providerKey] || [],
            dailyStartDateForFetch,
            endDateForFetch,
          );
          const summaryRows = buildWearableMetricDailyRowsForHabit(
            habit,
            wearableDailyTotals[providerKey] || [],
            summaryStartDateForFetch,
            endDateForFetch,
          );
          dataByHabit[habitId] = dailyRows;
          const summary = buildLocalMetricSummary(habit, summaryRows);
          if (summary) {
            summaryMap[habitId] = summary;
          }
        }
      }

      if (cancelled) return;
      setAnalyticsData(dataByHabit);
      setSummaryMetrics(summaryMap);
      stopTimer({
        success: true,
        source: 'tinybird_primary',
        daily_rows: totalDailyRows,
        habits_with_data: habitsWithData,
        summary_rows: Object.keys(summaryMap).length,
      });
    } catch (error) {
      perfError('metrics-view', 'fetch-canonical-analytics-primary-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        const token = await getToken();
        if (!token) {
          throw new Error('Authentication required to load analytics metrics.');
        }

        const now = new Date();
        const to = useWideRange ? now : (dateRange?.to || now);
        const summaryFrom = useWideRange ? subDays(now, DEFAULT_METRICS_SUMMARY_DAYS) : (dateRange?.from || subDays(now, DEFAULT_METRICS_SUMMARY_DAYS));
        const dailyFrom = useWideRange ? subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS) : (dateRange?.from || subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS));
        const fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

        const [statsResult, dailyResults] = await Promise.all([
          analyticsApi.getHabitStats(token, {
            startDate: format(summaryFrom, 'yyyy-MM-dd'),
            endDate: format(to, 'yyyy-MM-dd'),
          }),
          Promise.all(
            habitsToFetch.map((habitId: string) =>
              analyticsApi.getDailyBreakdown(token, {
                habitId,
                startDate: format(dailyFrom, 'yyyy-MM-dd'),
                endDate: format(to, 'yyyy-MM-dd'),
                timezone: fallbackTimezone,
              }).catch(() => null)
            )
          ),
        ]);
        if (cancelled) return;

        const fallbackSummaryMap: MetricsSummaryByHabit = {};
        getStatsRows(statsResult).forEach((stat) => {
          if (!stat.id) return;
          fallbackSummaryMap[stat.id] = {
            habit_id: stat.id,
            habit_name: stat.name,
            unit: stat.unit,
            total_value: stat.total,
            current_value: stat.average,
            previous_value: 0,
            change_pct: 0,
            absolute_change: 0,
            days_with_data: stat.days_with_data,
          };
        });

        const fallbackDailyByHabit: MetricsRowsByHabit = {};
        habitsToFetch.forEach((habitId: string, index: number) => {
          const response = dailyResults[index];
          const rows = getResponseRows(response);
          fallbackDailyByHabit[habitId] = mapDailyBreakdownRows(habitId, rows);
        });

        const wearableHabitIds = habitsToFetch.filter((habitId: string) => {
          const habit = habitById.get(habitId);
          return Boolean(habit && isWearableBackedHabit(habit));
        });

        if (wearableHabitIds.length > 0) {
          const wearableDailyTotals = await fetchWearableDailyTotalsForHabits(
            wearableHabitIds,
            format(dailyFrom, 'yyyy-MM-dd'),
            format(to, 'yyyy-MM-dd'),
          );

          for (const habitId of wearableHabitIds) {
            const habit = habitById.get(habitId);
            if (!habit) continue;
            const providerKey = getWearableProviderForHabit(habit) || '__preferred__';
            const dailyRows = buildWearableMetricDailyRowsForHabit(
              habit,
              wearableDailyTotals[providerKey] || [],
              format(dailyFrom, 'yyyy-MM-dd'),
              format(to, 'yyyy-MM-dd'),
            );
            const summaryRows = buildWearableMetricDailyRowsForHabit(
              habit,
              wearableDailyTotals[providerKey] || [],
              format(summaryFrom, 'yyyy-MM-dd'),
              format(to, 'yyyy-MM-dd'),
            );
            fallbackDailyByHabit[habitId] = dailyRows;
            const summary = buildLocalMetricSummary(habit, summaryRows);
            if (summary) {
              fallbackSummaryMap[habitId] = summary;
            }
          }
        }

        if (cancelled) return;
        setSummaryMetrics(fallbackSummaryMap);
        setAnalyticsData(fallbackDailyByHabit);
        stopTimer({
          success: true,
          source: 'python_fallback',
          summary_rows: Object.keys(fallbackSummaryMap).length,
          daily_habits: Object.keys(fallbackDailyByHabit).length,
        });

        if (!backfillAttempted.current) {
          backfillAttempted.current = true;
          fetch(`${process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000'}/api/analytics/tinybird-backfill`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          }).then(r => r.json())
            .then(res => console.log('📊 Tinybird backfill result:', res))
            .catch(err => console.warn('⚠️ Tinybird backfill failed (non-critical):', err));
        }
      } catch (fallbackError) {
        lastCanonicalFetchKeyRef.current = null;
        perfError('metrics-view', 'fetch-canonical-analytics-fallback-failed', {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        setAnalyticsError(
          fallbackError instanceof Error
            ? fallbackError.message
            : 'Unable to load analytics metrics at the moment.',
        );
        stopTimer({
          success: false,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    } finally {
      if (!cancelled) {
        setLoading(false);
      }
    }
  };

  if (
    hasQueryBackedCanonicalData
    && (
      (!dateRange?.from && hasInitialMetricsAnalytics && hasInitialMetricsSummary)
      || Boolean(dateRange?.from)
    )
    && lastHydratedCanonicalRangeKeyRef.current !== dateRangeSyncKey
  ) {
    lastHydratedCanonicalRangeKeyRef.current = dateRangeSyncKey;
    setLoading(false);
    return;
  }

  fetchCanonicalAnalytics();

  return () => {
    cancelled = true;
  };
}, [
  visibleMetricHabitIds.join(','),
  dateRange?.from?.toISOString(),
  dateRange?.to?.toISOString(),
  isUserLoaded,
  realtimeRefreshTick,
  user?.id,
  getToken,
  habitById,
  initialAnalyticsData,
  initialSummaryMetrics,
  hasInitialMetricsAnalytics,
  hasInitialMetricsSummary,
  fetchWearableDailyTotalsForHabits,
]);

useEffect(() => {
  if (!isUserLoaded || !user?.id) return;

  const validSelected = selectedHabits.filter((id: string): id is string => !!id);
  const habitsToFetch = validSelected.length > 0
    ? validSelected.filter((id: string) => filteredHabitIds.includes(id))
    : filteredHabitIds;

  if (habitsToFetch.length === 0) {
    return;
  }

  const { from, to } = getRangeDates(barListRange as RangeKey);
  // Fetch one extra window-length backwards so the bar list can compare the
  // visible window against the prior equivalent window. ALL is excluded from
  // the comparison (see buildMetricsBarData) so we don't double its payload.
  const isAllRange = (barListRange as RangeKey) === 'ALL';
  const windowMs = to.getTime() - from.getTime();
  const fetchFrom = isAllRange ? from : new Date(from.getTime() - windowMs);
  const startDate = format(fetchFrom, 'yyyy-MM-dd');
  const endDate = format(to, 'yyyy-MM-dd');
  const controller = new AbortController();
  const barListFetchKey = [
    habitsToFetch.join(','),
    barListRange,
    startDate,
    endDate,
    realtimeRefreshTick,
  ].join('|');

  const fetchBarListAnalytics = async () => {
    if (
      lastBarListFetchKeyRef.current === barListFetchKey &&
      (Object.keys(barListAnalyticsData).length > 0 || Object.keys(barListSummaryMetrics).length > 0)
    ) {
      return;
    }
    lastBarListFetchKeyRef.current = barListFetchKey;

    const stopTimer = startPerfTimer('metrics-view', 'fetch-bar-list-analytics', {
      habit_count: habitsToFetch.length,
      range: barListRange,
    });
    try {
      const dailyParams = new URLSearchParams({
        output: 'daily',
        habit_ids: habitsToFetch.join(','),
        start_date: startDate,
        end_date: endDate,
      });

      const summaryParams = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
      });

      const [dailyRes, summaryRes] = await Promise.all([
        fetch(`/api/analytics/habits/daily-values?${dailyParams.toString()}`, {
          signal: controller.signal,
        }),
        fetch(`/api/analytics/habits/summary?${summaryParams.toString()}`, {
          signal: controller.signal,
        }),
      ]);

      if (!dailyRes.ok || !summaryRes.ok) {
        throw new Error(`Bar list analytics failed (daily=${dailyRes.status}, summary=${summaryRes.status})`);
      }

      const [dailyPayload, summaryPayload] = await Promise.all([
        dailyRes.json(),
        summaryRes.json(),
      ]);

      if (controller.signal.aborted) return;

      const nextDailyByHabit: MetricsRowsByHabit = {};
      habitsToFetch.forEach((habitId: string) => {
        nextDailyByHabit[habitId] = [];
      });

      for (const row of getPayloadRows(dailyPayload)) {
        if (row?.habit_id && nextDailyByHabit[row.habit_id]) {
          nextDailyByHabit[row.habit_id].push(row);
        }
      }

      const nextSummaryByHabit: MetricsSummaryByHabit = {};
      for (const row of getPayloadRows(summaryPayload)) {
        if (row?.habit_id && habitsToFetch.includes(row.habit_id)) {
          nextSummaryByHabit[row.habit_id] = row;
        }
      }

      const wearableHabitIds = habitsToFetch.filter((habitId: string) => {
        const habit = habitById.get(habitId);
        return Boolean(habit && isWearableBackedHabit(habit));
      });

      if (wearableHabitIds.length > 0) {
        const wearableDailyTotals = await fetchWearableDailyTotalsForHabits(
          wearableHabitIds,
          startDate,
          endDate,
        );

        for (const habitId of wearableHabitIds) {
          const habit = habitById.get(habitId);
          if (!habit) continue;
          const providerKey = getWearableProviderForHabit(habit) || '__preferred__';
          const dailyRows = buildWearableMetricDailyRowsForHabit(
            habit,
            wearableDailyTotals[providerKey] || [],
            startDate,
            endDate,
          );
          nextDailyByHabit[habitId] = dailyRows;
          const summary = buildLocalMetricSummary(habit, dailyRows);
          if (summary) {
            nextSummaryByHabit[habitId] = summary;
          }
        }
      }

      setBarListAnalyticsData(nextDailyByHabit);
      setBarListSummaryMetrics(nextSummaryByHabit);
      stopTimer({
        success: true,
        daily_habits: Object.keys(nextDailyByHabit).length,
        summary_rows: Object.keys(nextSummaryByHabit).length,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      lastBarListFetchKeyRef.current = null;
      perfError('metrics-view', 'fetch-bar-list-analytics-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      stopTimer({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  if (!dateRange?.from && hasInitialBarListAnalytics && hasInitialBarListSummary && !skippedInitialBarListFetchRef.current) {
    skippedInitialBarListFetchRef.current = true;
    return;
  }

  fetchBarListAnalytics();

  return () => {
    controller.abort();
  };
}, [
  barListRange,
  filteredHabitIds.join(','),
  fetchWearableDailyTotalsForHabits,
  getToken,
  habitById,
  isUserLoaded,
  realtimeRefreshTick,
  selectedHabits.join(','),
  user?.id,
  hasInitialBarListAnalytics,
  hasInitialBarListSummary,
]);

useEffect(() => {
  if (metricsFirstUsablePaintLoggedRef.current) return;
  if (queryLoading || loading) return;
  if (
    Object.keys(summaryMetrics).length === 0 &&
    Object.keys(barListSummaryMetrics).length === 0 &&
    computerActivityDaily.length === 0
  ) {
    return;
  }

  metricsFirstUsablePaintLoggedRef.current = true;
  const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
  perfInfo('metrics-view', 'first-usable-paint', {
    duration_ms: Number((end - metricsMountTimeRef.current).toFixed(2)),
    summary_rows: Object.keys(summaryMetrics).length,
    bar_list_summary_rows: Object.keys(barListSummaryMetrics).length,
    computer_daily_rows: computerActivityDaily.length,
  });
}, [
  barListSummaryMetrics,
  computerActivityDaily.length,
  loading,
  queryLoading,
  summaryMetrics,
]);




  return {
    mergedBarListAnalyticsData: barListAnalyticsData,
    mergedBarListSummaryMetrics: barListSummaryMetrics,
    mergedCardAnalyticsData: analyticsData,
    mergedCardSummaryMetrics: summaryMetrics,
  };
}
