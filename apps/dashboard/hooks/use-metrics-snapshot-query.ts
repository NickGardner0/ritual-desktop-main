'use client';

import { useMemo } from 'react';
import { useAuth, useUser } from '@/lib/desktop-session';
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
import { apiOperationWithAuth } from '@/lib/api/client';

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

async function fetchMetricsSnapshot(
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
  dateRange?: DateRange,
  userId?: string | null,
): Promise<MetricsSnapshotResponse> {
  const rangeWindow = getAnalyticsRangeWindow(dateRange);
  return apiOperationWithAuth(
    'get_dashboard_metrics_snapshot_api_dashboard_metrics_snapshot_get',
    getToken,
    {
      query: rangeWindow.startDate && rangeWindow.endDate
        ? { start_date: rangeWindow.startDate, end_date: rangeWindow.endDate }
        : {},
    },
    userId,
  ) as Promise<MetricsSnapshotResponse>;
}

export function useMetricsSnapshotQuery({
  dateRange,
  enabled = true,
}: {
  dateRange?: DateRange;
  enabled?: boolean;
} = {}) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const resolvedUserId = user?.id ?? null;
  const queryUserId = resolvedUserId ?? 'anonymous';
  const rangeKey = useMemo(() => getAnalyticsRangeKey(dateRange), [dateRange]);
  const queryKey = useMemo(
    () => dashboardQueryKeys.metricsSnapshot.detail(queryUserId, rangeKey),
    [queryUserId, rangeKey],
  );

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = await fetchMetricsSnapshot(getToken, dateRange, resolvedUserId);
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
