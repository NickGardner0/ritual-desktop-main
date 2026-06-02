'use client';

import { useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import type {
  DashboardSnapshot,
  MetricDailyPoint,
  MetricsSummaryRow,
} from '@/app/(dashboard)/dashboard/dashboard-initial-data';
import { dashboardQueryKeys } from '@/lib/dashboard/query-keys';
import { getAnalyticsRangeKey, getAnalyticsRangeWindow } from '@/lib/dashboard/analytics-range';
import { habitKeys } from '@/hooks/use-habits-query';
import { QUERY_POLICY } from '@/lib/query-policies';

export type MetricsSnapshotResponse = {
  habits?: unknown[];
  overviewStats?: DashboardSnapshot['overviewStats'];
  metricsAnalyticsData?: Record<string, MetricDailyPoint[]>;
  metricsSummaryMetrics?: Record<string, MetricsSummaryRow>;
  metricsBarListAnalyticsData?: Record<string, MetricDailyPoint[]>;
  metricsBarListSummaryMetrics?: Record<string, MetricsSummaryRow>;
  appRankings?: unknown[];
  websiteRankings?: unknown[];
  meta?: {
    userId?: string | null;
    generatedAt?: number;
    rangeKey?: string;
    startDate?: string;
    endDate?: string;
    source?: string;
    partial?: boolean;
    warnings?: string[];
  };
};

async function fetchMetricsSnapshot(dateRange?: DateRange): Promise<MetricsSnapshotResponse> {
  const rangeWindow = getAnalyticsRangeWindow(dateRange);
  const params = new URLSearchParams();

  if (rangeWindow.startDate && rangeWindow.endDate) {
    params.set('start_date', rangeWindow.startDate);
    params.set('end_date', rangeWindow.endDate);
  }

  const response = await fetch(`/api/dashboard/metrics-snapshot${params.size ? `?${params.toString()}` : ''}`, {
    cache: 'no-store',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard metrics snapshot: ${response.status}`);
  }

  return response.json();
}

export function useMetricsSnapshotQuery({
  initialUserId,
  dateRange,
  enabled = true,
}: {
  initialUserId?: string | null;
  dateRange?: DateRange;
  enabled?: boolean;
} = {}) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const resolvedUserId = user?.id ?? initialUserId ?? null;
  const queryUserId = resolvedUserId ?? 'anonymous';
  const rangeKey = useMemo(() => getAnalyticsRangeKey(dateRange), [dateRange]);
  const queryKey = useMemo(
    () => dashboardQueryKeys.metricsSnapshot.detail(queryUserId, rangeKey),
    [queryUserId, rangeKey],
  );

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchMetricsSnapshot(dateRange);
      if (resolvedUserId && Array.isArray(payload.habits) && payload.habits.length > 0) {
        queryClient.setQueryData(habitKeys.list(resolvedUserId), payload.habits);
      }
      return payload;
    },
    enabled: Boolean(enabled && resolvedUserId),
    placeholderData: (previous) => previous,
    staleTime: QUERY_POLICY.dashboardSnapshot.staleTime,
    gcTime: QUERY_POLICY.dashboardSnapshot.gcTime,
  });

  return {
    ...query,
    rangeKey,
    snapshot: query.data,
  };
}
