'use client';

import { useEffect, useMemo } from 'react';
import type { DateRange } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import { useUser, useAuth } from '@clerk/nextjs';
import { apiOperationWithAuth } from '@/lib/api/client';
import type { Habit } from '@/contexts/HabitsContext';
import { isComputerTimeHabit } from '@/lib/computer-time-habit';
import {
  buildMetricContextModel,
  getMetricContextFetchWindow,
  type MetricContextDailySourceRow,
} from '@/components/analytics/metric-context-builder';
import { useComputerSnapshotQuery } from '@/hooks/use-computer-snapshot-query';
import {
  buildWearableDailyRows,
  getWearableMetricType,
  getWearableProviderForHabit,
  isWearableBackedHabit,
  type WearableDailyTotal,
} from '@/lib/wearables-dashboard';
import type { ComputerDailyResponseRow as ComputerDailyRow } from '@/lib/computerActivity';
import {
  formatMetricDisplay,
  type HabitMetricData,
} from '@/components/analytics/overview-view.helpers';


export function useOverviewMetricContext({
  user,
  dateRange,
  habits,
  orderedHabits,
  habitsById,
  selectedContextHabitId,
  setSelectedContextHabitId,
  habitMetricDataById,
  effectiveComputerActivityDaily,
  computerSnapshotQuery,
  contextFetchWindow,
  contextComputerDateRange,
}: {
  user: ReturnType<typeof useUser>['user'];
  dateRange: DateRange | undefined;
  habits: Habit[];
  orderedHabits: Habit[];
  habitsById: Map<string, Habit>;
  selectedContextHabitId: string | null;
  setSelectedContextHabitId: (id: string | null) => void;
  habitMetricDataById: Map<string, HabitMetricData>;
  effectiveComputerActivityDaily: ComputerDailyRow[];
  computerSnapshotQuery: ReturnType<typeof useComputerSnapshotQuery>;
  contextFetchWindow: ReturnType<typeof getMetricContextFetchWindow>;
  contextComputerDateRange: DateRange;
}) {
  const { getToken } = useAuth();
  const selectedContextHabit = useMemo(() => {
    if (!selectedContextHabitId) return null;
    return habitsById.get(selectedContextHabitId)
      || orderedHabits.find((habit) => habit.id === selectedContextHabitId)
      || null;
  }, [habitsById, orderedHabits, selectedContextHabitId]);

  const selectedContextIsComputer = Boolean(
    selectedContextHabit && isComputerTimeHabit(selectedContextHabit),
  );

  const selectedContextIsWearable = Boolean(
    selectedContextHabit && isWearableBackedHabit(selectedContextHabit),
  );
  const selectedContextWearableMetricType = selectedContextHabit
    ? getWearableMetricType(selectedContextHabit)
    : null;
  const selectedContextWearableProvider = selectedContextHabit
    ? getWearableProviderForHabit(selectedContextHabit)
    : null;
  const contextHabitIds = useMemo(() => {
    const sourceHabits = orderedHabits.length > 0 ? orderedHabits : habits;
    return sourceHabits
      .filter((habit) => habit.id && !isComputerTimeHabit(habit))
      .map((habit) => habit.id)
      .slice(0, 40);
  }, [habits, orderedHabits]);

  const contextDailyRowsQuery = useQuery<MetricContextDailySourceRow[]>({
    queryKey: [
      'overview-metric-context-daily',
      user?.id,
      contextHabitIds.join('|'),
      contextFetchWindow.startDate,
      contextFetchWindow.endDate,
    ],
    queryFn: async () => {
      const payload = await apiOperationWithAuth(
        'get_habit_daily_values_api_analytics_habits_daily_values_get',
        getToken,
        {
          query: {
            output: 'daily',
            habit_ids: contextHabitIds.join(','),
            start_date: contextFetchWindow.startDate,
            end_date: contextFetchWindow.endDate,
          },
        },
        user?.id,
      ) as { data?: MetricContextDailySourceRow[] };
      return Array.isArray(payload?.data) ? payload.data : [];
    },
    enabled: Boolean(user?.id && selectedContextHabitId && selectedContextHabit && contextHabitIds.length > 0),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const contextWearableDailyTotalsQuery = useQuery<WearableDailyTotal[]>({
    queryKey: [
      'overview-context-wearable-daily-totals',
      user?.id,
      selectedContextWearableProvider || 'preferred',
      selectedContextWearableMetricType || 'none',
      contextFetchWindow.startDate,
      contextFetchWindow.endDate,
    ],
    queryFn: async () => {
      const payload = await apiOperationWithAuth(
        'get_wearable_daily_totals_api_wearables_daily_totals_get',
        getToken,
        {
          query: {
            start_date: contextFetchWindow.startDate,
            end_date: contextFetchWindow.endDate,
            metric_types: selectedContextWearableMetricType || undefined,
            providers: selectedContextWearableProvider || undefined,
          },
        },
        user?.id,
      );
      return Array.isArray(payload.days) ? payload.days as WearableDailyTotal[] : [];
    },
    enabled: Boolean(user?.id && selectedContextIsWearable && selectedContextWearableMetricType),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const contextComputerSnapshotQuery = useComputerSnapshotQuery({
    userId: user?.id,
    dateRange: contextComputerDateRange,
    enabled: Boolean(user?.id && selectedContextIsComputer),
  });

  useEffect(() => {
    if (selectedContextHabitId && !selectedContextHabit) {
      setSelectedContextHabitId(null);
    }
  }, [selectedContextHabit, selectedContextHabitId]);

  const selectedContextDailyRows = useMemo<MetricContextDailySourceRow[]>(() => {
    if (!selectedContextHabitId || selectedContextIsComputer) return [];

    const canonicalRows = (contextDailyRowsQuery.data || []).filter((row) => {
      const rowHabitId = String(row.habit_id || '').trim();
      return rowHabitId === selectedContextHabitId;
    });

    if (selectedContextIsWearable && selectedContextWearableMetricType) {
      const wearableRows = buildWearableDailyRows(
        contextWearableDailyTotalsQuery.data || [],
        selectedContextWearableMetricType,
      ).map<MetricContextDailySourceRow>((row) => ({
        date: row.date,
        value: row.value,
        entries_count: 1,
      }));

      if (wearableRows.length > 0) {
        return wearableRows;
      }
    }

    return canonicalRows;
  }, [
    contextDailyRowsQuery.data,
    contextWearableDailyTotalsQuery.data,
    selectedContextHabitId,
    selectedContextIsComputer,
    selectedContextIsWearable,
    selectedContextWearableMetricType,
  ]);

  const contextPeerDailyRows = useMemo(() => {
    const rows = contextDailyRowsQuery.data || [];
    if (rows.length === 0) return [];

    const rowsByHabitId = new Map<string, MetricContextDailySourceRow[]>();
    for (const row of rows) {
      const habitId = String(row.habit_id || '').trim();
      if (!habitId || habitId === selectedContextHabitId) continue;
      const existing = rowsByHabitId.get(habitId) || [];
      existing.push(row);
      rowsByHabitId.set(habitId, existing);
    }

    const sourceHabits = orderedHabits.length > 0 ? orderedHabits : habits;
    return sourceHabits
      .filter((habit) => {
        const habitId = habit.id || '';
        return habitId
          && habitId !== selectedContextHabitId
          && !isComputerTimeHabit(habit)
          && rowsByHabitId.has(habitId);
      })
      .slice(0, 12)
      .map((habit) => {
        const habitId = habit.id || '';
        return {
          habitId,
          habitName: habit.name || 'Metric',
          unitLabel: habitMetricDataById.get(habitId)?.stats.unitLabel || habit.unit_type || 'sessions',
          rows: rowsByHabitId.get(habitId) || [],
        };
      });
  }, [
    contextDailyRowsQuery.data,
    habitMetricDataById,
    habits,
    orderedHabits,
    selectedContextHabitId,
  ]);

  const metricContextModel = useMemo(() => {
    if (!selectedContextHabit || !selectedContextHabitId) return null;

    const metricData = habitMetricDataById.get(selectedContextHabitId);
    const contextComputerSnapshot = contextComputerSnapshotQuery.data || computerSnapshotQuery.data;
    const computerRows = selectedContextIsComputer
      ? (
        contextComputerSnapshot?.daily?.length
          ? contextComputerSnapshot.daily
          : effectiveComputerActivityDaily
      )
      : undefined;

    return buildMetricContextModel({
      habit: selectedContextHabit,
      displayValue: metricData?.display || formatMetricDisplay(0, selectedContextHabit.unit_type || 'sessions'),
      displayStats: metricData?.stats,
      dateRange,
      dailyRows: selectedContextDailyRows,
      peerDailyRows: contextPeerDailyRows,
      computerDailyRows: computerRows,
      computerTopApps: selectedContextIsComputer ? contextComputerSnapshot?.apps || [] : [],
      computerTopDomains: selectedContextIsComputer ? contextComputerSnapshot?.domains || [] : [],
      isComputerTime: selectedContextIsComputer,
    });
  }, [
    selectedContextHabit,
    selectedContextHabitId,
    habitMetricDataById,
    dateRange,
    selectedContextDailyRows,
    contextPeerDailyRows,
    contextComputerSnapshotQuery.data,
    contextComputerSnapshotQuery.data?.daily,
    effectiveComputerActivityDaily,
    computerSnapshotQuery.data,
    computerSnapshotQuery.data?.apps,
    computerSnapshotQuery.data?.domains,
    selectedContextIsComputer,
  ]);

  const isMetricContextLoading = selectedContextIsComputer
    ? contextComputerSnapshotQuery.isFetching || contextDailyRowsQuery.isFetching
    : contextDailyRowsQuery.isFetching || (selectedContextIsWearable && contextWearableDailyTotalsQuery.isFetching);
  const isMetricContextOpen = Boolean(metricContextModel);
  const overviewContextStyle = useMemo(
    () => ({
      '--overview-context-pane-width': isMetricContextOpen
        ? 'clamp(520px, 42vw, 680px)'
        : '0px',
    }) as React.CSSProperties,
    [isMetricContextOpen],
  );


  return {
    selectedContextHabit,
    selectedContextIsComputer,
    selectedContextIsWearable,
    metricContextModel,
    isMetricContextLoading,
    isMetricContextOpen,
    overviewContextStyle,
    contextDailyRowsQuery,
    contextWearableDailyTotalsQuery,
    contextComputerSnapshotQuery,
  };
}
