'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import type { Habit, HabitLog } from '@/lib/habit-types';
import type { DashboardSnapshot } from '@/app/(dashboard)/dashboard/dashboard-initial-data';
import { buildDashboardSnapshot, dashboardSnapshotKeys } from '@/lib/dashboard/dashboard-snapshot';
import { clearComputerActivityClientCaches } from '@/lib/computerActivity/client';

const ANALYTICS_SUMMARY_KEY = 'analytics-summary';
const USAGE_BREAKDOWN_KEY = 'usage-breakdown';
const COMPUTER_ACTIVITY_KEY = 'computer-activity';
const OVERVIEW_ACTIVITY_KEY = 'overview-activity';

export const ritualQueryKeys = {
  habitsList: (userId: string) => ['habits', 'list', userId] as const,
  habitLogsList: (userId: string) => ['habit-logs', 'list', userId] as const,
  analyticsSummary: (userId: string) => [ANALYTICS_SUMMARY_KEY, userId] as const,
  computerSnapshotsByUser: (userId: string) => ['computer-snapshot', userId] as const,
  computerActivityAll: () => [COMPUTER_ACTIVITY_KEY] as const,
  usageBreakdownAll: () => [USAGE_BREAKDOWN_KEY] as const,
  overviewActivityByUser: (userId: string) => [OVERVIEW_ACTIVITY_KEY, userId] as const,
};

type HabitLogCacheRollback = {
  previousHabits?: Habit[];
  previousLogs?: HabitLog[];
  previousSnapshots: Array<[readonly unknown[], DashboardSnapshot | undefined]>;
};

function parseSnapshotRangeKey(snapshotKey: string): DateRange | undefined {
  if (!snapshotKey || snapshotKey === 'all-time' || !snapshotKey.includes(':')) {
    return undefined;
  }

  const [fromRaw, toRaw] = snapshotKey.split(':');
  if (!fromRaw || !toRaw) return undefined;

  const from = new Date(`${fromRaw}T12:00:00`);
  const to = new Date(`${toRaw}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return undefined;
  }

  return { from, to };
}

function rebuildDashboardSnapshotCaches(
  queryClient: QueryClient,
  userId: string,
  habits: Habit[],
  habitLogs: HabitLog[],
): Array<[readonly unknown[], DashboardSnapshot | undefined]> {
  const snapshotEntries = queryClient.getQueriesData<DashboardSnapshot>({
    queryKey: dashboardSnapshotKeys.byUser(userId),
  });

  snapshotEntries.forEach(([queryKey, snapshot]) => {
    const snapshotKey = snapshot?.meta?.snapshotKey || 'all-time';
    const nextSnapshot = buildDashboardSnapshot(habits, habitLogs, {
      userId,
      hydratedFrom: 'client-derived',
      dateRange: parseSnapshotRangeKey(snapshotKey),
      snapshotKey,
    });
    queryClient.setQueryData(queryKey, nextSnapshot);
  });

  return snapshotEntries;
}

export function applyOptimisticHabitLogUpdate(
  queryClient: QueryClient,
  userId: string,
  optimisticLog: HabitLog,
): HabitLogCacheRollback {
  const habitsKey = ritualQueryKeys.habitsList(userId);
  const logsKey = ritualQueryKeys.habitLogsList(userId);
  const previousHabits = queryClient.getQueryData<Habit[]>(habitsKey);
  const previousLogs = queryClient.getQueryData<HabitLog[]>(logsKey);
  const previousSnapshots = queryClient.getQueriesData<DashboardSnapshot>({
    queryKey: dashboardSnapshotKeys.byUser(userId),
  });

  const touchedAtIso = new Date().toISOString();
  const nextHabits = previousHabits
    ? previousHabits.map((habit) =>
        habit.id === optimisticLog.habit_id
          ? { ...habit, updated_at: touchedAtIso }
          : habit,
      )
    : previousHabits;

  if (nextHabits) {
    queryClient.setQueryData(habitsKey, nextHabits);
  }

  const nextLogs = [...(previousLogs || []), optimisticLog];
  queryClient.setQueryData(logsKey, nextLogs);

  if (nextHabits && previousLogs) {
    rebuildDashboardSnapshotCaches(queryClient, userId, nextHabits, nextLogs);
  }

  return {
    previousHabits,
    previousLogs,
    previousSnapshots,
  };
}

export function rollbackOptimisticHabitLogUpdate(
  queryClient: QueryClient,
  userId: string,
  rollback: HabitLogCacheRollback | undefined,
): void {
  if (!rollback) return;

  queryClient.setQueryData(ritualQueryKeys.habitsList(userId), rollback.previousHabits);
  queryClient.setQueryData(ritualQueryKeys.habitLogsList(userId), rollback.previousLogs);

  rollback.previousSnapshots.forEach(([queryKey, snapshot]) => {
    queryClient.setQueryData(queryKey, snapshot);
  });
}

export async function invalidateHabitData(
  queryClient: QueryClient,
  userId?: string | null,
): Promise<void> {
  const queryUserId = userId ?? 'anonymous';
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.habitsList(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.habitLogsList(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: ritualQueryKeys.analyticsSummary(queryUserId) }),
    queryClient.invalidateQueries({ queryKey: dashboardSnapshotKeys.byUser(queryUserId) }),
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
