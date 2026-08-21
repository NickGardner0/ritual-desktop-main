'use client';

import { useEffect, useMemo } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import {
  createEmptyDashboardSnapshot,
  dashboardSnapshotKeys,
} from '@/lib/dashboard/dashboard-snapshot';
import type { DashboardSnapshot } from '@/app/(dashboard)/dashboard/dashboard-initial-data';
import { habitKeys, useHabitsQuery } from '@/hooks/use-habits-query';
import { getAnalyticsRangeKey, getAnalyticsRangeWindow } from '@/lib/dashboard/analytics-range';
import {
  isDegradedOverviewPayload,
  mergeOverviewStatsPreservingKnownValues,
  type DashboardOverviewSnapshotResponse,
} from '@/lib/dashboard/overview-snapshot-merge';
import { QUERY_POLICY } from '@/lib/query-policies';
import { apiOperationWithAuth } from '@/lib/api/client';

const DASHBOARD_SNAPSHOT_STORAGE_KEY = 'ritual:dashboard-snapshot:v3';
const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

type PersistedSnapshot = {
  updatedAt: number;
  data: DashboardSnapshot;
};

type SnapshotEnvelope = {
  byUser?: Record<string, Record<string, PersistedSnapshot>>;
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
    overviewStats: mergeOverviewStatsPreservingKnownValues(
      baseSnapshot.overviewStats,
      payload.overviewStats,
    ),
    meta: {
      ...baseSnapshot.meta,
      userId,
      snapshotKey: rangeKey,
      generatedAt: payload.meta?.generatedAt ?? Date.now(),
      hydratedFrom: 'server',
    },
  };
}

async function fetchOverviewSnapshot(
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
  dateRange?: DateRange,
  userId?: string | null,
): Promise<DashboardOverviewSnapshotResponse> {
  const rangeWindow = getAnalyticsRangeWindow(dateRange);
  return apiOperationWithAuth(
    'get_dashboard_overview_snapshot_api_dashboard_overview_snapshot_get',
    getToken,
    {
      query: rangeWindow.startDate && rangeWindow.endDate
        ? { start_date: rangeWindow.startDate, end_date: rangeWindow.endDate }
        : {},
    },
    userId,
  ) as Promise<DashboardOverviewSnapshotResponse>;
}

export function useDashboardSnapshotQuery({
  dateRange,
}: {
  dateRange?: DateRange;
} = {}) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  useHabitsQuery();

  const resolvedUserId = user?.id ?? null;
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
  const fallbackSnapshot = useMemo(
    () => buildFallbackSnapshot(resolvedUserId, dateRange),
    [dateRange, resolvedUserId],
  );

  const snapshotQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<DashboardSnapshot> => {
      if (!resolvedUserId) {
        return fallbackSnapshot;
      }

      const baseSnapshot =
        queryClient.getQueryData<DashboardSnapshot>(queryKey)
        ?? persistedSnapshot?.data
        ?? fallbackSnapshot;

      try {
        const payload = await fetchOverviewSnapshot(getToken, dateRange, resolvedUserId);
        if (Array.isArray(payload.habits) && payload.habits.length > 0) {
          queryClient.setQueryData(habitKeys.list(resolvedUserId), payload.habits);
        }
        if (isDegradedOverviewPayload(baseSnapshot.overviewStats, payload.overviewStats)) {
          console.warn('Keeping cached dashboard snapshot because live overview payload was degraded');
          return {
            ...baseSnapshot,
            meta: {
              ...baseSnapshot.meta,
              hydratedFrom: 'persisted-query',
              generatedAt: Date.now(),
            },
          };
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
      ?? persistedSnapshot?.data
      ?? undefined,
    initialDataUpdatedAt: persistedSnapshot?.updatedAt,
    enabled: Boolean(resolvedUserId),
    placeholderData: (previous) =>
      previous ?? persistedSnapshot?.data ?? fallbackSnapshot,
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
    snapshot: snapshotQuery.data ?? fallbackSnapshot,
  };
}
