'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import { useUser, useAuth } from '@clerk/nextjs';
import { apiOperationWithAuth } from '@/lib/api/client';
import type { Habit } from '@/contexts/HabitsContext';
import {
  buildWearableDailyRows,
  getWearableDateRange,
  getWearableMetricType,
  getWearableProviderForHabit,
  isWearableBackedHabit,
  summarizeWearableDailyRows,
  usesAverageDisplay,
  type WearableDailyTotal,
} from '@/lib/wearables-dashboard';
import {
  formatMetricDisplay,
  type HabitMetricData,
} from '@/components/analytics/overview-view.helpers';


export function useOverviewWearableMetrics({
  user,
  dateRange,
  habits,
  effectiveCachedStats,
  isOverviewSnapshotFetching,
}: {
  user: ReturnType<typeof useUser>['user'];
  dateRange: DateRange | undefined;
  habits: Habit[];
  effectiveCachedStats: Record<string, import('@/lib/services/analytics-api').HabitStats>;
  isOverviewSnapshotFetching: boolean;
}) {
  const { getToken } = useAuth();
  const [allowWearableDailyTotalsRefresh, setAllowWearableDailyTotalsRefresh] = useState(false);
  const wearableHabits = useMemo(
    () => habits.filter((habit) => isWearableBackedHabit(habit)),
    [habits],
  );
  const shouldFetchWearableDailyTotals = useMemo(
    () => wearableHabits.some((habit) => {
      const habitId = habit.id || '';
      const stats = habitId ? effectiveCachedStats[habitId] : null;
      return !stats || Number(stats.days_with_data || 0) === 0;
    }),
    [effectiveCachedStats, wearableHabits],
  );
  useEffect(() => {
    queueMicrotask(() => setAllowWearableDailyTotalsRefresh(false));
    if (!user?.id || wearableHabits.length === 0 || shouldFetchWearableDailyTotals) {
      return;
    }

    const timer = window.setTimeout(() => {
      setAllowWearableDailyTotalsRefresh(true);
    }, 2_500);

    return () => window.clearTimeout(timer);
  }, [shouldFetchWearableDailyTotals, user?.id, wearableHabits.length]);
  const wearableDailyTotalsQuery = useQuery({
    queryKey: [
      'overview-wearable-daily-totals',
      user?.id,
      dateRange?.from?.toISOString() || 'all',
      dateRange?.to?.toISOString() || 'all',
      wearableHabits
        .map((habit) => `${getWearableProviderForHabit(habit) || 'preferred'}:${getWearableMetricType(habit) || ''}:${habit.id || ''}`)
        .sort()
        .join('|'),
    ],
    queryFn: async () => {
      const { startDate, endDate } = getWearableDateRange(dateRange);
      const groupedMetrics = new Map<string, Set<string>>();

      for (const habit of wearableHabits) {
        const metricType = getWearableMetricType(habit);
        if (!metricType) continue;
        const provider = getWearableProviderForHabit(habit) || '__preferred__';
        const existing = groupedMetrics.get(provider) || new Set<string>();
        existing.add(metricType);
        groupedMetrics.set(provider, existing);
      }

      const responses = await Promise.all(
        Array.from(groupedMetrics.entries()).map(async ([provider, metricTypes]) => {
          const payload = await apiOperationWithAuth(
            'get_wearable_daily_totals_api_wearables_daily_totals_get',
            getToken,
            {
              query: {
                start_date: startDate,
                end_date: endDate,
                metric_types: Array.from(metricTypes).join(','),
                providers: provider !== '__preferred__' ? provider : undefined,
              },
            },
            user?.id,
          );
          return {
            provider,
            days: Array.isArray(payload.days) ? (payload.days as WearableDailyTotal[]) : [],
          };
        }),
      );

      return responses.reduce<Record<string, WearableDailyTotal[]>>((acc, entry) => {
        acc[entry.provider] = entry.days;
        return acc;
      }, {});
    },
    enabled:
      Boolean(user?.id)
      && wearableHabits.length > 0
      && (shouldFetchWearableDailyTotals || (Boolean(dateRange?.from) && allowWearableDailyTotalsRefresh))
      && !isOverviewSnapshotFetching,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const wearableMetricDataByHabitId = useMemo(() => {
    const next = new Map<string, HabitMetricData>();
    const totalsByProvider = wearableDailyTotalsQuery.data || {};

    for (const habit of wearableHabits) {
      const habitId = habit.id || '';
      const metricType = getWearableMetricType(habit);
      if (!habitId || !metricType) continue;
      const cachedStats = effectiveCachedStats[habitId];
      if (!dateRange?.from && cachedStats && Number(cachedStats.days_with_data || 0) > 0) {
        continue;
      }

      const providerKey = getWearableProviderForHabit(habit) || '__preferred__';
      const dailyRows = buildWearableDailyRows(totalsByProvider[providerKey] || [], metricType);
      const summary = summarizeWearableDailyRows(dailyRows);
      if (summary.daysWithData === 0) continue;

      const unitLabel = habit.unit_type || summary.unit || 'sessions';
      const displayValue = usesAverageDisplay(habit.metric_type, habit.unit_type, habit.name)
        ? summary.average
        : summary.total;

      next.set(habitId, {
        display: formatMetricDisplay(displayValue, unitLabel),
        stats: {
          unitLabel,
          sumFormatted: formatMetricDisplay(summary.total, unitLabel),
          avgFormatted: formatMetricDisplay(summary.average, unitLabel),
          minFormatted: formatMetricDisplay(summary.min, unitLabel),
          maxFormatted: formatMetricDisplay(summary.max, unitLabel),
          stdDevFormatted: formatMetricDisplay(summary.stdDev, unitLabel),
          daysWithData: summary.daysWithData,
          trackedDays: dailyRows.length,
        },
      });
    }

    return next;
  }, [dateRange?.from, effectiveCachedStats, wearableDailyTotalsQuery.data, wearableHabits]);


  return { wearableMetricDataByHabitId, wearableDailyTotalsQuery };
}
