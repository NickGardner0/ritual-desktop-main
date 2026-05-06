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
import { habitKeys, useHabitLogsQuery, useHabitsQuery } from '@/hooks/use-habits-query';
import { getAnalyticsRangeKey, getAnalyticsRangeWindow } from '@/lib/dashboard/analytics-range';
import { perfInfo } from '@/lib/perf-debug';
import { QUERY_POLICY } from '@/lib/query-policies';

const DASHBOARD_SNAPSHOT_STORAGE_KEY = 'ritual:dashboard-snapshot:v3';
const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 12;

type PersistedSnapshot = {
  updatedAt: number;
  data: DashboardSnapshot;
};

type SnapshotEnvelope = {
  byUser?: Record<string, Record<string, PersistedSnapshot>>;
};

type DashboardOverviewSnapshotResponse = {
  habits?: unknown[];
  overviewStats?: DashboardSnapshot['overviewStats'];
  meta?: {
    generatedAt?: number;
  };
};

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

function readPersistedSnapshot(
  userId?: string | null,
  rangeKey?: string,
): PersistedSnapshot | null {
  if (typeof window === 'undefined' || !userId || !rangeKey) return null;

  try {
    const raw = window.localStorage.getItem(DASHBOARD_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SnapshotEnvelope;
    const candidate = parsed.byUser?.[userId]?.[rangeKey];
    if (!candidate?.data || !candidate.updatedAt) return null;
    if (Date.now() - candidate.updatedAt > SNAPSHOT_MAX_AGE_MS) return null;
    return candidate;
  } catch (error) {
    console.warn('Failed to restore persisted dashboard snapshot:', error);
    return null;
  }
}

function persistSnapshot(
  userId: string,
  rangeKey: string,
  snapshot: DashboardSnapshot,
): void {
  if (typeof window === 'undefined') return;
  if (Object.keys(snapshot.overviewStats || {}).length === 0) return;

  try {
    const raw = window.localStorage.getItem(DASHBOARD_SNAPSHOT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as SnapshotEnvelope : {};
    const compactSnapshot: DashboardSnapshot = {
      overviewStats: snapshot.overviewStats,
      metricsAnalyticsData: {},
      metricsSummaryMetrics: {},
      metricsBarListAnalyticsData: {},
      metricsBarListSummaryMetrics: {},
      meta: snapshot.meta,
    };
    const next: SnapshotEnvelope = {
      byUser: {
        ...(parsed.byUser || {}),
        [userId]: {
          ...(parsed.byUser?.[userId] || {}),
          [rangeKey]: {
            data: compactSnapshot,
            updatedAt: Date.now(),
          },
        },
      },
    };
    window.localStorage.setItem(DASHBOARD_SNAPSHOT_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('Failed to persist dashboard snapshot:', error);
  }
}

export function clearPersistedDashboardSnapshots(userId?: string | null): void {
  if (typeof window === 'undefined') return;

  const normalizedUserId = userId?.trim();
  if (!normalizedUserId) {
    window.localStorage.removeItem(DASHBOARD_SNAPSHOT_STORAGE_KEY);
    return;
  }

  try {
    const raw = window.localStorage.getItem(DASHBOARD_SNAPSHOT_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as SnapshotEnvelope;
    if (!parsed.byUser?.[normalizedUserId]) return;

    const next: SnapshotEnvelope = {
      byUser: { ...parsed.byUser },
    };
    if (next.byUser) {
      delete next.byUser[normalizedUserId];
    }
    window.localStorage.setItem(DASHBOARD_SNAPSHOT_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('Failed to clear persisted dashboard snapshots:', error);
    window.localStorage.removeItem(DASHBOARD_SNAPSHOT_STORAGE_KEY);
  }
}

function mergeOverviewSnapshot(
  baseSnapshot: DashboardSnapshot,
  payload: DashboardOverviewSnapshotResponse,
  userId: string,
  rangeKey: string,
): DashboardSnapshot {
  return {
    ...baseSnapshot,
    overviewStats: payload.overviewStats || {},
    meta: {
      ...baseSnapshot.meta,
      userId,
      snapshotKey: rangeKey,
      generatedAt: payload.meta?.generatedAt ?? Date.now(),
      hydratedFrom: 'server',
    },
  };
}

async function fetchOverviewSnapshot(dateRange?: DateRange): Promise<DashboardOverviewSnapshotResponse> {
  const rangeWindow = getAnalyticsRangeWindow(dateRange);
  const params = new URLSearchParams();

  if (rangeWindow.startDate && rangeWindow.endDate) {
    params.set('start_date', rangeWindow.startDate);
    params.set('end_date', rangeWindow.endDate);
  }

  const response = await fetch(`/api/dashboard/overview-snapshot${params.size ? `?${params.toString()}` : ''}`, {
    cache: 'no-store',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard overview snapshot: ${response.status}`);
  }

  return response.json();
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
  const habitLogsQuery = useHabitLogsQuery({ enabled: false });

  const resolvedUserId = user?.id ?? initialUserId ?? null;
  const queryUserId = resolvedUserId ?? 'anonymous';
  const rangeKey = useMemo(() => getAnalyticsRangeKey(dateRange), [dateRange]);
  const queryKey = useMemo(
    () => dashboardSnapshotKeys.detail(queryUserId, rangeKey),
    [queryUserId, rangeKey],
  );
  const persistedSnapshot = useMemo(
    () => readPersistedSnapshot(resolvedUserId, rangeKey),
    [rangeKey, resolvedUserId],
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
      if (!resolvedUserId) {
        return fallbackSnapshot;
      }

      const baseSnapshot =
        queryClient.getQueryData<DashboardSnapshot>(queryKey)
        ?? immediateDerivedSnapshot
        ?? persistedSnapshot?.data
        ?? fallbackSnapshot;

      try {
        const payload = await fetchOverviewSnapshot(dateRange);
        if (Array.isArray(payload.habits) && payload.habits.length > 0) {
          queryClient.setQueryData(habitKeys.list(resolvedUserId), payload.habits);
        }
        return mergeOverviewSnapshot(baseSnapshot, payload, resolvedUserId, rangeKey);
      } catch (error) {
        if (Object.keys(baseSnapshot.overviewStats || {}).length > 0) {
          console.warn('Falling back to cached dashboard snapshot:', error);
          return baseSnapshot;
        }
        throw error;
      }
    },
    initialData: () =>
      queryClient.getQueryData<DashboardSnapshot>(queryKey)
      ?? immediateDerivedSnapshot
      ?? persistedSnapshot?.data
      ?? undefined,
    initialDataUpdatedAt: persistedSnapshot?.updatedAt,
    enabled: Boolean(resolvedUserId),
    placeholderData: (previous) =>
      previous ?? persistedSnapshot?.data ?? immediateDerivedSnapshot ?? fallbackSnapshot,
    staleTime: QUERY_POLICY.dashboardSnapshot.staleTime,
    gcTime: QUERY_POLICY.dashboardSnapshot.gcTime,
  });

  useEffect(() => {
    if (!resolvedUserId || !snapshotQuery.data) return;
    persistSnapshot(resolvedUserId, rangeKey, snapshotQuery.data);
  }, [rangeKey, resolvedUserId, snapshotQuery.data]);

  return {
    ...snapshotQuery,
    rangeKey,
    snapshot: snapshotQuery.data ?? immediateDerivedSnapshot ?? fallbackSnapshot,
  };
}
