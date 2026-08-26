'use client';

import { useEffect, useMemo } from 'react';
import type { DateRange } from 'react-day-picker';
import { useQuery } from '@tanstack/react-query';
import {
  getAggregatedComputerStats,
  type AggregatedComputerStatsResponse,
  type ComputerDailyResponseRow,
  type ComputerSummaryResponse,
  type TopAppResponseRow,
  type TopDomainResponseRow,
} from '@/lib/computerActivity';
import { getAnalyticsRangeKey, getAnalyticsRangeWindow } from '@/lib/dashboard/analytics-range';
import { isDesktopTauriRuntime } from '@/lib/desktop-bridge/environment';
import { QUERY_POLICY } from '@/lib/query-policies';

const COMPUTER_SNAPSHOT_STORAGE_KEY = 'ritual:computer-snapshot:v2';
const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const LEGACY_SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90;
const COMPUTER_ACTIVITY_ALL_TIME_START_DATE = '1970-01-01';

export type ComputerSnapshot = {
  summary: ComputerSummaryResponse;
  daily: ComputerDailyResponseRow[];
  apps: TopAppResponseRow[];
  domains: TopDomainResponseRow[];
  source?: string;
  state?: string;
  scope?: string;
  lastSyncedAt?: number | string | null;
  pendingRollups: number;
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
    scope: payload.scope,
    lastSyncedAt: payload.last_synced_at,
    pendingRollups: Math.max(0, Number(payload.pending_rollups || 0)),
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
  pendingRollups: 0,
  syncPending: false,
};

type PersistedSnapshot<T> = {
  updatedAt: number;
  data: T;
};

type SnapshotEnvelope<T> = {
  byUser?: Record<string, Record<string, PersistedSnapshot<T>>>;
};

function snapshotHasComputerData(data?: ComputerSnapshot | null): boolean {
  if (!data) return false;
  return Number(data.summary?.total_active_ms || 0) > 0
    || Number(data.summary?.total_hours || 0) > 0
    || Number(data.summary?.total_events || 0) > 0
    || (data.daily || []).length > 0
    || (data.apps || []).length > 0
    || (data.domains || []).length > 0;
}

function readLegacyOverviewComputerSnapshot(
  userId: string,
  rangeKey: string,
): PersistedSnapshot<ComputerSnapshot> | null {
  try {
    const summaryRaw = window.localStorage.getItem(`ritual:overview-computer:v3:${userId}:${rangeKey}:summary`);
    const rowsRaw = window.localStorage.getItem(`ritual:overview-computer:v3:${userId}:${rangeKey}`);
    if (!summaryRaw && !rowsRaw) return null;

    const summaryEnvelope = summaryRaw ? JSON.parse(summaryRaw) : {};
    const rowsEnvelope = rowsRaw ? JSON.parse(rowsRaw) : {};
    const updatedAt = Number(summaryEnvelope.timestamp || rowsEnvelope.timestamp || 0);
    if (!updatedAt || Date.now() - updatedAt > LEGACY_SNAPSHOT_MAX_AGE_MS) return null;

    const rows = Array.isArray(rowsEnvelope.rows) ? rowsEnvelope.rows as ComputerDailyResponseRow[] : [];
    const summary = summaryEnvelope.summary || {};
    const totalActiveMs = Math.max(
      0,
      Number(summary.total_active_ms || 0)
        || rows.reduce((sum, row) => sum + Math.max(0, Number(row.active_ms || 0)), 0),
    );
    const totalEvents = Math.max(
      0,
      Number(summary.total_events || 0)
        || rows.reduce((sum, row) => sum + Math.max(0, Number(row.events_count || 0)), 0),
    );
    const daysTracked = Math.max(
      0,
      Number(summary.days_tracked || 0)
        || rows.filter((row) => Math.max(0, Number(row.active_ms || 0)) > 0).length,
    );
    const data: ComputerSnapshot = {
      summary: {
        total_active_ms: totalActiveMs,
        total_afk_ms: Math.max(0, Number(summary.total_afk_ms || 0)),
        total_hours: Math.max(0, Number(summary.total_hours || totalActiveMs / (1000 * 60 * 60))),
        total_events: totalEvents,
        days_tracked: daysTracked,
        avg_daily_hours: Math.max(
          0,
          Number(summary.avg_daily_hours || (daysTracked > 0 ? totalActiveMs / (1000 * 60 * 60) / daysTracked : 0)),
        ),
        source: 'legacy_overview_cache',
      },
      daily: rows,
      apps: [],
      domains: [],
      source: 'legacy_overview_cache',
      state: 'legacy_cache_fallback',
      pendingRollups: 0,
      syncPending: false,
    };

    return snapshotHasComputerData(data) ? { updatedAt, data } : null;
  } catch (error) {
    console.warn('Failed to restore legacy computer snapshot:', error);
    return null;
  }
}

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
    if (!candidate?.data || !candidate.updatedAt) {
      return readLegacyOverviewComputerSnapshot(userId, rangeKey);
    }
    if (Date.now() - candidate.updatedAt > SNAPSHOT_MAX_AGE_MS) {
      return readLegacyOverviewComputerSnapshot(userId, rangeKey);
    }
    if (!snapshotHasComputerData(candidate.data)) {
      return readLegacyOverviewComputerSnapshot(userId, rangeKey);
    }
    return candidate;
  } catch (error) {
    console.warn('Failed to restore persisted computer snapshot:', error);
    return readLegacyOverviewComputerSnapshot(userId, rangeKey);
  }
}

function persistSnapshot(
  userId: string,
  rangeKey: string,
  data: ComputerSnapshot,
): void {
  if (typeof window === 'undefined') return;
  if (!snapshotHasComputerData(data)) return;

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
  allTimeStartDate = COMPUTER_ACTIVITY_ALL_TIME_START_DATE,
}: {
  userId?: string | null;
  dateRange?: DateRange;
  enabled?: boolean;
  allTimeStartDate?: string;
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
      const payload = await getAggregatedComputerStats(
        {
          startDate: rangeWindow.startDate ?? allTimeStartDate,
          endDate: rangeWindow.endDate ?? today,
        },
        10,
      );
      const nextSnapshot = toComputerSnapshot(payload);
      if (!snapshotHasComputerData(nextSnapshot) && persistedSnapshot?.data) {
        console.warn('Keeping cached computer snapshot because live computer payload was empty');
        return {
          ...persistedSnapshot.data,
          state: 'stale-fallback-after-empty-live',
          syncPending: true,
        };
      }
      return nextSnapshot;
    },
    enabled: enabled && Boolean(userId),
    initialData: persistedSnapshot?.data,
    initialDataUpdatedAt: persistedSnapshot?.updatedAt,
    placeholderData: (previous) => previous ?? persistedSnapshot?.data ?? EMPTY_COMPUTER_SNAPSHOT,
    staleTime: QUERY_POLICY.computerSnapshot.staleTime,
    gcTime: QUERY_POLICY.computerSnapshot.gcTime,
    refetchOnWindowFocus: false,
    refetchInterval: isDesktopTauriRuntime() ? 5_000 : false,
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
