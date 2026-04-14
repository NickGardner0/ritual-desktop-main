'use client';

import { useMemo } from 'react';
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

  return useQuery({
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
    placeholderData: (previous) => previous ?? EMPTY_COMPUTER_SNAPSHOT,
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });
}

export function getComputerSnapshotRangeKey(dateRange?: DateRange) {
  return getAnalyticsRangeKey(dateRange);
}
