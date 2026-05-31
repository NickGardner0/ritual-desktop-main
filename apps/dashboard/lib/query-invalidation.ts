'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { Habit } from '@/lib/habit-types';
import type { DashboardSnapshot } from '@/app/(dashboard)/dashboard/dashboard-initial-data';
import { dashboardSnapshotKeys } from '@/lib/dashboard/dashboard-snapshot';
import { dashboardQueryKeys } from '@/lib/dashboard/query-keys';
import { mergeOverviewStatsPreservingKnownValues } from '@/lib/dashboard/overview-snapshot-merge';
import { clearComputerActivityClientCaches } from '@/lib/computerActivity/client';

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
