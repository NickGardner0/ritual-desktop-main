'use client';

import { useEffect } from 'react';
import { format } from 'date-fns';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import {
  buildLocalMetricSummary,
  buildWearableMetricDailyRowsForHabit,
  getRangeDates,
} from '../metrics-view.shared';
import {
  getWearableProviderForHabit,
  isWearableBackedHabit,
} from '@/lib/wearables-dashboard';
import { perfError, perfInfo, startPerfTimer } from '@/lib/perf-debug';
import { analyticsLoader, fetchAnalyticsJsonPair } from '@/lib/analytics-loader';
import {
  getPayloadRows,
  type MetricsDataEffectsContext,
  type MetricsRowsByHabit,
  type MetricsSummaryByHabit,
} from './useMetricsDataQueries.helpers';

export function useMetricsBarListAndPaintEffects(ctx: MetricsDataEffectsContext) {
  const {
    barListAnalyticsData,
    barListRange,
    barListSummaryMetrics,
    computerActivityDaily,
    dateRange,
    fetchWearableDailyTotalsForHabits,
    filteredHabitIds,
    getToken,
    habitById,
    hasInitialBarListAnalytics,
    hasInitialBarListSummary,
    isUserLoaded,
    lastBarListFetchKeyRef,
    loading,
    metricsFirstUsablePaintLoggedRef,
    metricsMountTimeRef,
    queryLoading,
    realtimeRefreshTick,
    selectedHabits,
    setBarListAnalyticsData,
    setBarListSummaryMetrics,
    skippedInitialBarListFetchRef,
    summaryMetrics,
    user,
  } = ctx;
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
    const loaderScope = `metrics-bar-list:${user.id}`;
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

        const [dailyPayload, summaryPayload] = await analyticsLoader.load({
          scope: loaderScope,
          key: `bar-list:${barListFetchKey}`,
          freshnessMs: 30_000,
          request: (signal) => fetchAnalyticsJsonPair(
            signal,
            `/api/analytics/habits/daily-values?${dailyParams.toString()}`,
            `/api/analytics/habits/summary?${summaryParams.toString()}`,
          ),
        });

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
        if (error instanceof DOMException && error.name === 'AbortError') return;
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
      analyticsLoader.release(loaderScope, `bar-list:${barListFetchKey}`);
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

}
