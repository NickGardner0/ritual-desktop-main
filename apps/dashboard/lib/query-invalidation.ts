'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { Habit } from '@/lib/habit-types';
import type { DashboardSnapshot } from '@/app/(dashboard)/dashboard/dashboard-initial-data';
import type { HabitStats } from '@/lib/services/analytics-api';
import { dashboardSnapshotKeys } from '@/lib/dashboard/dashboard-snapshot';
import { dashboardQueryKeys } from '@/lib/dashboard/query-keys';
import { mergeOverviewStatsPreservingKnownValues } from '@/lib/dashboard/overview-snapshot-merge';
import { clearComputerActivityClientCaches } from '@/lib/computerActivity';

export const ritualQueryKeys = dashboardQueryKeys;

export function applyCanonicalOverviewSnapshot(
  queryClient: QueryClient,
  userId: string,
  snapshot: {
    habits?: unknown[];
    overviewStats?: DashboardSnapshot['overviewStats'];
    meta?: { generatedAt?: number };
  },
  rangeKey = 'all-time',
): void {
  if (Array.isArray(snapshot.habits) && snapshot.habits.length > 0) {
    queryClient.setQueryData(ritualQueryKeys.habits.list(userId), snapshot.habits as Habit[]);
  }

  queryClient.setQueryData<DashboardSnapshot>(
    dashboardSnapshotKeys.detail(userId, rangeKey),
    (previous) => ({
      ...(previous || {
        metricsAnalyticsData: {},
        metricsSummaryMetrics: {},
        metricsBarListAnalyticsData: {},
        metricsBarListSummaryMetrics: {},
      }),
      overviewStats: mergeOverviewStatsPreservingKnownValues(
        previous?.overviewStats,
        snapshot.overviewStats,
      ),
      meta: {
        ...(previous?.meta || {}),
        userId,
        snapshotKey: rangeKey,
        generatedAt: snapshot.meta?.generatedAt ?? Date.now(),
        hydratedFrom: 'server',
      },
    }),
  );
}

function snapshotRangeIncludesDate(snapshot: DashboardSnapshot | undefined, date: string): boolean {
  const rangeKey = snapshot?.meta?.snapshotKey;
  if (!rangeKey || rangeKey === 'all-time') return true;
  const [startDate, endDate] = String(rangeKey).split(':');
  if (!startDate || !endDate) return false;
  return date >= startDate && date <= endDate;
}

function buildOptimisticStat({
  previous,
  habitId,
  habitName,
  unit,
  delta,
}: {
  previous?: HabitStats;
  habitId: string;
  habitName: string;
  unit: string;
  delta: number;
}): HabitStats {
  const previousTotal = Number.isFinite(previous?.total) ? Number(previous?.total) : 0;
  const nextTotal = Math.max(0, previousTotal + delta);
  const previousEntries = Number.isFinite(previous?.total_entries) ? Number(previous?.total_entries) : 0;
  const totalEntries = Math.max(1, previousEntries + 1);
  const previousDays = Number.isFinite(previous?.days_with_data) ? Number(previous?.days_with_data) : 0;
  const daysWithData = Math.max(1, previousDays);
  const average = daysWithData > 0 ? nextTotal / daysWithData : nextTotal;

  return {
    id: previous?.id || habitId,
    name: previous?.name || habitName,
    category: previous?.category || '',
    unit: previous?.unit || unit,
    total: nextTotal,
    average,
    min: previous ? Math.min(previous.min ?? delta, delta) : delta,
    max: previous ? Math.max(previous.max ?? delta, delta) : delta,
    variance: previous?.variance ?? 0,
    std_dev: previous?.std_dev ?? 0,
    days_with_data: daysWithData,
    total_entries: totalEntries,
    summary: `${previous?.name || habitName}: ${nextTotal.toFixed(2)} total`,
  };
}

export function applyOptimisticOverviewStatDelta(
  queryClient: QueryClient,
  userId: string,
  {
    habitId,
    habitName,
    unit,
    delta,
    date,
  }: {
    habitId: string;
    habitName: string;
    unit: string;
    delta: number;
    date: string;
  },
): () => void {
  const queryKey = dashboardSnapshotKeys.byUser(userId);
  const previousEntries = queryClient.getQueriesData<DashboardSnapshot>({ queryKey });

  queryClient.setQueriesData<DashboardSnapshot>({ queryKey }, (previous) => {
    if (!previous || !snapshotRangeIncludesDate(previous, date)) return previous;
    const previousStats = previous.overviewStats || {};
    const previousStat = previousStats[habitId];

    return {
      ...previous,
      overviewStats: {
        ...previousStats,
        [habitId]: buildOptimisticStat({
          previous: previousStat,
          habitId,
          habitName,
          unit,
          delta,
        }),
      },
      meta: {
        ...previous.meta,
        generatedAt: Date.now(),
      },
    };
  });

  return () => {
    for (const [entryKey, data] of previousEntries) {
      queryClient.setQueryData(entryKey, data);
    }
  };
}

export async function invalidateHabitData(
  queryClient: QueryClient,
  userId?: string | null,
): Promise<void> {
  const queryUserId = userId ?? 'anonymous';
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.habits.list(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.habitLogs.list(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.analyticsSummary(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: dashboardSnapshotKeys.byUser(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.overviewSnapshot.byUser(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.metricsSnapshot.byUser(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.logsReadModel.byUser(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.calendarReadModel.byUser(queryUserId) }),
  ]);
}

export async function invalidateComputerData(
  queryClient: QueryClient,
  userId?: string | null,
): Promise<void> {
  const queryUserId = userId ?? 'anonymous';
  clearComputerActivityClientCaches();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.computerSnapshotsByUser(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.computerActivityAll() }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.usageBreakdownAll() }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.overviewActivityByUser(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.overviewSnapshot.byUser(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.metricsSnapshot.byUser(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.calendarReadModel.byUser(queryUserId) }),
  ]);
}

export async function invalidateAfterComputerSync(
  queryClient: QueryClient,
  userId?: string | null,
): Promise<void> {
  await Promise.all([
    invalidateHabitData(queryClient, userId),
    invalidateComputerData(queryClient, userId),
  ]);
}

export async function invalidateAfterHabitWrite(
  queryClient: QueryClient,
  userId?: string | null,
): Promise<void> {
  await invalidateHabitData(queryClient, userId);
}

export async function invalidateAfterWearableSync(
  queryClient: QueryClient,
  userId?: string | null,
): Promise<void> {
  await invalidateHabitData(queryClient, userId);
}

export async function invalidateAfterActivitySync(
  queryClient: QueryClient,
  userId?: string | null,
): Promise<void> {
  await invalidateAfterComputerSync(queryClient, userId);
}

export async function invalidateAfterImport(
  queryClient: QueryClient,
  userId?: string | null,
): Promise<void> {
  await invalidateHabitData(queryClient, userId);
}
