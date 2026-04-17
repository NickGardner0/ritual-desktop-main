'use client';

import { useEffect, useMemo } from 'react';
import type { DateRange } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import { subDays } from 'date-fns';
import {
  getAggregatedComputerStats,
  type AggregatedComputerStatsResponse,
  type ComputerDailyResponseRow,
  type ComputerSummaryResponse,
  type TopAppResponseRow,
  type TopDomainResponseRow,
} from '@/lib/computerActivity/client';
import { getAnalyticsRangeKey, getAnalyticsRangeWindow } from '@/lib/dashboard/analytics-range';
import { QUERY_POLICY } from '@/lib/query-policies';

const COMPUTER_SNAPSHOT_STORAGE_KEY = 'ritual:computer-snapshot:v1';
const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 12;

export type ComputerSnapshot = {
  summary: ComputerSummaryResponse;
  daily: ComputerDailyResponseRow[];
  apps: TopAppResponseRow[];
  domains: TopDomainResponseRow[];
  source?: string;
  state?: string;
  syncPending: boolean;
  emptyReason?: string;
};

export const computerSnapshotKeys = {
  all: ['computer-snapshot'] as const,
  byUser: (userId: string) => [...computerSnapshotKeys.all, userId] as const,
  detail: (userId: string, rangeKey: string) => [...computerSnapshotKeys.byUser(userId), rangeKey] as const,
};

function toComputerSnapshot(payload: AggregatedComputerStatsResponse): ComputerSnapshot {
  return {
    summary: payload.summary,
    daily: payload.daily,
    apps: payload.apps,
    domains: payload.domains,
    source: payload.source,
    state: payload.state,
    syncPending: Boolean(payload.sync_pending),
    emptyReason: payload.empty_reason,
  };
}

const EMPTY_COMPUTER_SNAPSHOT: ComputerSnapshot = {
  summary: {
    total_active_ms: 0,
    total_afk_ms: 0,
    total_hours: 0,
    total_events: 0,
    days_tracked: 0,
    avg_daily_hours: 0,
  },
  daily: [],
  apps: [],
  domains: [],
  source: 'empty',
  state: 'empty',
  syncPending: false,
};

type PersistedSnapshot<T> = {
  updatedAt: number;
  data: T;
};

type SnapshotEnvelope<T> = {
  byUser?: Record<string, Record<string, PersistedSnapshot<T>>>;
};

function readPersistedSnapshot(
  userId?: string | null,
  rangeKey?: string,
): PersistedSnapshot<ComputerSnapshot> | null {
  if (typeof window === 'undefined' || !userId || !rangeKey) return null;

  try {
    const raw = window.localStorage.getItem(COMPUTER_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SnapshotEnvelope<ComputerSnapshot>;
    const candidate = parsed.byUser?.[userId]?.[rangeKey];
    if (!candidate?.data || !candidate.updatedAt) return null;
    if (Date.now() - candidate.updatedAt > SNAPSHOT_MAX_AGE_MS) return null;
    return candidate;
  } catch (error) {
    console.warn('Failed to restore persisted computer snapshot:', error);
    return null;
  }
}

function persistSnapshot(
  userId: string,
  rangeKey: string,
  data: ComputerSnapshot,
): void {
  if (typeof window === 'undefined') return;

  try {
    const raw = window.localStorage.getItem(COMPUTER_SNAPSHOT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as SnapshotEnvelope<ComputerSnapshot> : {};
    const next: SnapshotEnvelope<ComputerSnapshot> = {
      byUser: {
        ...(parsed.byUser || {}),
        [userId]: {
          ...(parsed.byUser?.[userId] || {}),
          [rangeKey]: {
            data,
            updatedAt: Date.now(),
          },
        },
      },
    };
    window.localStorage.setItem(COMPUTER_SNAPSHOT_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('Failed to persist computer snapshot:', error);
  }
}

export function useComputerSnapshotQuery({
  userId,
  dateRange,
  enabled = true,
  allTimeDays = 1095,
}: {
  userId?: string | null;
  dateRange?: DateRange;
  enabled?: boolean;
  allTimeDays?: number;
}) {
  const rangeWindow = useMemo(() => getAnalyticsRangeWindow(dateRange), [dateRange]);
  const rangeKey = rangeWindow.rangeKey;
  const queryUserId = userId ?? 'anonymous';
  const persistedSnapshot = useMemo(
    () => readPersistedSnapshot(userId, rangeKey),
    [userId, rangeKey],
  );

  const query = useQuery({
    queryKey: computerSnapshotKeys.detail(queryUserId, rangeKey),
    queryFn: async (): Promise<ComputerSnapshot> => {
      const today = new Date().toISOString().slice(0, 10);
      const defaultStartDate = subDays(new Date(), allTimeDays).toISOString().slice(0, 10);
      const payload = await getAggregatedComputerStats(
        {
          startDate: rangeWindow.startDate ?? defaultStartDate,
          endDate: rangeWindow.endDate ?? today,
        },
        10,
      );
      return toComputerSnapshot(payload);
    },
    enabled: enabled && Boolean(userId),
    initialData: persistedSnapshot?.data,
    initialDataUpdatedAt: persistedSnapshot?.updatedAt,
    placeholderData: (previous) => previous ?? persistedSnapshot?.data ?? EMPTY_COMPUTER_SNAPSHOT,
    staleTime: QUERY_POLICY.computerSnapshot.staleTime,
    gcTime: QUERY_POLICY.computerSnapshot.gcTime,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!userId || !query.data) return;
    persistSnapshot(userId, rangeKey, query.data);
  }, [userId, rangeKey, query.data]);

  return query;
}

export function getComputerSnapshotRangeKey(dateRange?: DateRange) {
  return getAnalyticsRangeKey(dateRange);
}
