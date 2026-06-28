'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { DateRange } from 'react-day-picker';
import { useComputerSnapshotQuery } from '@/hooks/use-computer-snapshot-query';
import { getMetricCategoryForHabit } from '@/components/analytics/metrics-derived';
import {
  getWearableMetricType,
  getWearableProviderForHabit,
  isWearableBackedHabit,
  type WearableDailyTotal,
} from '@/lib/wearables-dashboard';
import { auditLocalStorage, perfInfo } from '@/lib/perf-debug';
import type { MetricDailyRow } from '@/components/analytics/metrics-derived';
import {
  CARD_ORDER_KEY,
  CARDS_PER_PAGE,
  dateRangeToBarListRange,
  isGranularHeartRateHabit,
  type BarListRange,
  type HabitData,
} from '../metrics-view.shared';
import { isComputerHabitName } from '@/lib/computer-time-habit';

export function useMetricsViewDerived({
  user,
  isUserLoaded,
  dateRange,
  transformedHabits,
  habitLogs,
  selectedHabits,
  appliedCardOrder,
  activeCategoryTab,
  cardPage,
  expandedHabit,
  initialAnalyticsData,
  initialSummaryMetrics,
  lastHydratedCanonicalRangeKeyRef,
  setBarListRange,
  setAnalyticsData,
  setSummaryMetrics,
  setRealtimeRefreshTick,
}: {
  user: { id?: string | null } | null | undefined;
  isUserLoaded: boolean;
  dateRange: DateRange | undefined;
  transformedHabits: HabitData[];
  habitLogs: Array<{ habit_id?: string | null }>;
  selectedHabits: string[];
  appliedCardOrder: string[];
  activeCategoryTab: string | null;
  cardPage: number;
  expandedHabit: string | null;
  initialAnalyticsData?: Record<string, MetricDailyRow[]>;
  initialSummaryMetrics?: import('../metrics-view.shared').MetricsSummaryByHabit;
  lastHydratedCanonicalRangeKeyRef: React.MutableRefObject<string | null>;
  setBarListRange: React.Dispatch<React.SetStateAction<BarListRange>>;
  setAnalyticsData: React.Dispatch<React.SetStateAction<Record<string, MetricDailyRow[]>>>;
  setSummaryMetrics: React.Dispatch<React.SetStateAction<import('../metrics-view.shared').MetricsSummaryByHabit>>;
  setRealtimeRefreshTick: React.Dispatch<React.SetStateAction<number>>;
}) {
  const dateRangeSyncKey = dateRange?.from && dateRange?.to
    ? `${dateRange.from.toISOString()}|${dateRange.to.toISOString()}`
    : 'all-time';
  const lastSyncedBarListRangeKeyRef = useRef<string | null>(null);

  const computerSnapshotQuery = useComputerSnapshotQuery({
    userId: user?.id,
    dateRange,
    enabled: isUserLoaded && Boolean(user?.id),
  });

  const computerActivityDaily = useMemo<MetricDailyRow[]>(
    () =>
      (computerSnapshotQuery.data?.daily ?? []).map((row) => ({
        day: row.day,
        active_hours: row.active_hours,
        active_ms: row.active_ms,
        events_count: row.events_count,
        apps_count: row.apps_count ?? 0,
        domains_count: row.domains_count ?? 0,
      })),
    [computerSnapshotQuery.data?.daily],
  );

  const availableHabits = transformedHabits;

  const detectedComputerHabitId = useMemo(
    () => availableHabits.find((habit) => isComputerHabitName(habit.habit_name))?.habit_id || null,
    [availableHabits],
  );

  const filteredHabits = useMemo(
    () => availableHabits.filter((habit) => !isComputerHabitName(habit.habit_name)),
    [availableHabits],
  );

  const habitById = useMemo(() => {
    const next = new Map<string, HabitData>();
    for (const habit of availableHabits) {
      if (habit.habit_id) {
        next.set(habit.habit_id, habit);
      }
    }
    return next;
  }, [availableHabits]);

  const filteredHabitIds = useMemo(
    () => filteredHabits.map((habit: HabitData) => habit.habit_id).filter((id: string): id is string => !!id),
    [filteredHabits],
  );

  const visibleMetricHabitIds = useMemo(() => {
    const validSelected = selectedHabits.filter((id: string): id is string => !!id);
    const selectedFilteredHabitIds = validSelected.length > 0
      ? validSelected.filter((id) => filteredHabitIds.includes(id))
      : filteredHabitIds;

    const orderedIds = appliedCardOrder.length > 0
      ? [
          ...appliedCardOrder.filter((id: string) => selectedFilteredHabitIds.includes(id)),
          ...selectedFilteredHabitIds.filter((id: string) => !appliedCardOrder.includes(id)),
        ]
      : selectedFilteredHabitIds;

    const categoryFilteredIds = activeCategoryTab
      ? orderedIds.filter((id) => {
          const habit = filteredHabits.find((candidate: HabitData) => candidate.habit_id === id);
          return habit ? getMetricCategoryForHabit(habit.habit_name, habit.category) === activeCategoryTab : false;
        })
      : orderedIds;

    const totalPages = Math.max(1, Math.ceil(categoryFilteredIds.length / CARDS_PER_PAGE));
    const safePage = Math.min(cardPage, totalPages - 1);
    const pageStart = safePage * CARDS_PER_PAGE;
    return categoryFilteredIds.slice(pageStart, pageStart + CARDS_PER_PAGE);
  }, [activeCategoryTab, appliedCardOrder, cardPage, filteredHabitIds, filteredHabits, selectedHabits]);

  const hasCustomDateRange = !!(dateRange?.from && dateRange?.to);

  const expandedHabitData = useMemo(
    () => availableHabits.find((h: HabitData) => h.habit_id === expandedHabit) || null,
    [availableHabits, expandedHabit],
  );

  const expandedHabitUsesGranularHeartRate = isGranularHeartRateHabit(expandedHabitData);

  const habitLogsByHabitId = useMemo(() => {
    const grouped = new Map<string, typeof habitLogs>();
    for (const log of habitLogs) {
      if (!log?.habit_id) continue;
      const habitId = String(log.habit_id);
      const existing = grouped.get(habitId);
      if (existing) {
        existing.push(log);
      } else {
        grouped.set(habitId, [log]);
      }
    }
    return grouped;
  }, [habitLogs]);

  const fetchWearableDailyTotalsForHabits = useCallback(
    async (habitIds: string[], startDate: string, endDate: string) => {
      const groupedMetrics = new Map<string, Set<string>>();

      for (const habitId of habitIds) {
        const habit = habitById.get(habitId);
        if (!habit || !isWearableBackedHabit(habit)) continue;
        const metricType = getWearableMetricType(habit);
        if (!metricType) continue;
        const provider = getWearableProviderForHabit(habit) || '__preferred__';
        const existing = groupedMetrics.get(provider) || new Set<string>();
        existing.add(metricType);
        groupedMetrics.set(provider, existing);
      }

      const responses = await Promise.all(
        Array.from(groupedMetrics.entries()).map(async ([provider, metricTypes]) => {
          const params = new URLSearchParams({
            start_date: startDate,
            end_date: endDate,
            metric_types: Array.from(metricTypes).join(','),
          });
        if (provider !== '__preferred__') {
            params.set('providers', provider);
          }

          const response = await fetch(`/api/wearables/daily-totals?${params.toString()}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch wearable daily totals (${provider})`);
          }

          const payload = await response.json();
          return {
            provider,
            days: Array.isArray(payload?.days) ? (payload.days as WearableDailyTotal[]) : [],
          };
        }),
      );

      return responses.reduce<Record<string, WearableDailyTotal[]>>((acc, entry) => {
        acc[entry.provider] = entry.days;
        return acc;
      }, {});
    },
    [habitById],
  );

  useEffect(() => {
    perfInfo('metrics-view', 'mount', {
      has_date_range: Boolean(dateRange?.from),
      selected_habit_count: selectedHabits.length,
      available_habit_count: availableHabits.length,
    });
    if (process.env.NODE_ENV === 'production') return;
    auditLocalStorage('metrics-view', ['ritual:react-query-cache:v1', CARD_ORDER_KEY]);
  }, [availableHabits.length, dateRange?.from, selectedHabits.length]);

  useEffect(() => {
    if (lastSyncedBarListRangeKeyRef.current === dateRangeSyncKey) return;
    lastSyncedBarListRangeKeyRef.current = dateRangeSyncKey;
    setBarListRange(dateRangeToBarListRange(dateRange));
  }, [dateRange, dateRangeSyncKey, setBarListRange]);

  useEffect(() => {
    setAnalyticsData(initialAnalyticsData ?? {});
    setSummaryMetrics(initialSummaryMetrics ?? {});
    if (
      Object.keys(initialAnalyticsData ?? {}).length > 0
      || Object.keys(initialSummaryMetrics ?? {}).length > 0
    ) {
      lastHydratedCanonicalRangeKeyRef.current = dateRangeSyncKey;
    }
  }, [dateRangeSyncKey, initialAnalyticsData, initialSummaryMetrics, lastHydratedCanonicalRangeKeyRef, setAnalyticsData, setSummaryMetrics]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleRealtimeHabitUpdate = () => {
      setRealtimeRefreshTick((tick) => tick + 1);
    };

    window.addEventListener('ritual:habit-log-updated', handleRealtimeHabitUpdate);
    return () => {
      window.removeEventListener('ritual:habit-log-updated', handleRealtimeHabitUpdate);
    };
  }, [setRealtimeRefreshTick]);

  return {
    dateRangeSyncKey,
    computerActivityDaily,
    availableHabits,
    detectedComputerHabitId,
    filteredHabits,
    habitById,
    filteredHabitIds,
    visibleMetricHabitIds,
    hasCustomDateRange,
    expandedHabitData,
    expandedHabitUsesGranularHeartRate,
    habitLogsByHabitId,
    fetchWearableDailyTotalsForHabits,
  };
}
