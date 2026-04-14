'use client';

import { useEffect, useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import {
  buildDashboardSnapshot,
  createEmptyDashboardSnapshot,
  dashboardSnapshotKeys,
} from '@/lib/dashboard/dashboard-snapshot';
import type { DashboardSnapshot } from '@/app/(dashboard)/dashboard/dashboard-initial-data';
import { useHabitLogsQuery, useHabitsQuery } from '@/hooks/use-habits-query';
import { getAnalyticsRangeKey } from '@/lib/dashboard/analytics-range';
import { perfInfo } from '@/lib/perf-debug';

function buildFallbackSnapshot(
  userId: string | null,
  dateRange?: DateRange,
): DashboardSnapshot {
  return createEmptyDashboardSnapshot({
    userId,
    dateRange,
    hydratedFrom: 'empty',
  });
}

export function useDashboardSnapshotQuery({
  initialUserId,
  dateRange,
}: {
  initialUserId?: string | null;
  dateRange?: DateRange;
} = {}) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const habitsQuery = useHabitsQuery();
  const habitLogsQuery = useHabitLogsQuery();

  const resolvedUserId = user?.id ?? initialUserId ?? null;
  const queryUserId = resolvedUserId ?? 'anonymous';
  const rangeKey = useMemo(() => getAnalyticsRangeKey(dateRange), [dateRange]);
  const queryKey = useMemo(
    () => dashboardSnapshotKeys.detail(queryUserId, rangeKey),
    [queryUserId, rangeKey],
  );
  const immediateDerivedSnapshot = useMemo(() => {
    if (!resolvedUserId || !habitsQuery.data || !habitLogsQuery.data) {
      return null;
    }

    return buildDashboardSnapshot(habitsQuery.data, habitLogsQuery.data, {
      userId: resolvedUserId,
      hydratedFrom: 'client-derived',
      dateRange,
      snapshotKey: rangeKey,
    });
  }, [dateRange, habitLogsQuery.data, habitsQuery.data, rangeKey, resolvedUserId]);
  const fallbackSnapshot = useMemo(
    () => buildFallbackSnapshot(resolvedUserId, dateRange),
    [dateRange, resolvedUserId],
  );

  useEffect(() => {
    if (!immediateDerivedSnapshot) {
      return;
    }

    queryClient.setQueryData(queryKey, immediateDerivedSnapshot);
    perfInfo('dashboard-snapshot', 'query-populated', {
      range_key: rangeKey,
      hydrated_from: immediateDerivedSnapshot.meta.hydratedFrom,
      bytes: JSON.stringify(immediateDerivedSnapshot).length,
    });
  }, [immediateDerivedSnapshot, queryClient, queryKey, rangeKey]);

  const snapshotQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<DashboardSnapshot> => {
      const cached = queryClient.getQueryData<DashboardSnapshot>(queryKey);
      if (cached) {
        return cached;
      }

      if (immediateDerivedSnapshot) {
        return immediateDerivedSnapshot;
      }

      return fallbackSnapshot;
    },
    initialData: () =>
      queryClient.getQueryData<DashboardSnapshot>(queryKey) ?? immediateDerivedSnapshot ?? undefined,
    enabled:
      Boolean(queryClient.getQueryData(queryKey)) ||
      (Boolean(resolvedUserId) && habitsQuery.isFetched && habitLogsQuery.isFetched),
    staleTime: 1000 * 60 * 5,
  });

  return {
    ...snapshotQuery,
    rangeKey,
    snapshot: snapshotQuery.data ?? immediateDerivedSnapshot ?? fallbackSnapshot,
  };
}
