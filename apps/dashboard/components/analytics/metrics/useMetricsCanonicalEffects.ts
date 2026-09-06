'use client';

import { useEffect } from 'react';
import { format, subDays } from 'date-fns';
import { analyticsApi } from '@/lib/services/analytics-api';
import { apiOperationWithAuth } from '@/lib/api/client';
import {
  buildLocalMetricSummary,
  buildWearableMetricDailyRowsForHabit,
  isSleepLikeHabit,
} from '../metrics-view.shared';
import type { HabitData } from '../metrics-view.shared';
import { mapDailyBreakdownRows } from '@/components/analytics/metrics-derived';
import {
  getWearableProviderForHabit,
  isWearableBackedHabit,
} from '@/lib/wearables-dashboard';
import {
  DEFAULT_METRICS_SPARKLINE_DAYS,
  DEFAULT_METRICS_SUMMARY_DAYS,
} from '../metrics-view.shared';
import { perfError, startPerfTimer } from '@/lib/perf-debug';
import { analyticsLoader, fetchAnalyticsJsonPair } from '@/lib/analytics-loader';
import {
  getPayloadRows,
  getResponseRows,
  getStatsRows,
  type HabitStatsRow,
  type MetricsDataEffectsContext,
  type MetricsRowsByHabit,
  type MetricsSummaryByHabit,
} from './useMetricsDataQueries.helpers';

export function useMetricsCanonicalEffects(ctx: MetricsDataEffectsContext) {
  const {
    analyticsData,
    availableHabits,
    backfillAttempted,
    dateRange,
    dateRangeSyncKey,
    fetchWearableDailyTotalsForHabits,
    getToken,
    habitById,
    hasInitialMetricsAnalytics,
    hasInitialMetricsSummary,
    initialAnalyticsData,
    initialSummaryMetrics,
    isUserLoaded,
    lastCanonicalFetchKeyRef,
    lastHydratedCanonicalRangeKeyRef,
    loading,
    realtimeRefreshTick,
    setAnalyticsData,
    setAnalyticsError,
    setLoading,
    setSummaryMetrics,
    summaryMetrics,
    user,
    visibleMetricHabitIds,
  } = ctx;
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
    let activeLoaderKey: string | null = null;
    const loaderScope = `metrics-canonical:${user.id}`;

    const fetchCanonicalAnalytics = async () => {
      const useWideRange = !dateRange?.from || !dateRange?.to;
      const canonicalFetchKey = [
        habitsToFetch.join(','),
        useWideRange ? `wide:${DEFAULT_METRICS_SPARKLINE_DAYS}:${DEFAULT_METRICS_SUMMARY_DAYS}` : `${dateRange!.from!.toISOString()}:${dateRange!.to!.toISOString()}`,
        realtimeRefreshTick,
      ].join('|');
      activeLoaderKey = `canonical:${canonicalFetchKey}`;

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
        const [dailyPayload, summaryPayload] = await analyticsLoader.load({
          scope: loaderScope,
          key: activeLoaderKey,
          freshnessMs: 30_000,
          request: (signal) => fetchAnalyticsJsonPair(
            signal,
            `/api/analytics/habits/daily-values?output=daily&${dailyParams.toString()}`,
            `/api/analytics/habits/daily-values?output=summary&${summaryParams.toString()}`,
          ),
        });
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
            void apiOperationWithAuth(
              'tinybird_backfill_api_analytics_tinybird_backfill_post',
              getToken,
            ).then((res) => console.log('📊 Tinybird backfill result:', res))
              .catch((err) => console.warn('⚠️ Tinybird backfill failed (non-critical):', err));
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
      if (activeLoaderKey) analyticsLoader.release(loaderScope, activeLoaderKey);
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

}
