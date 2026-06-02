'use client';

import { useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import type { DateRange } from 'react-day-picker';
import { dashboardQueryKeys } from '@/lib/dashboard/query-keys';
import { getAnalyticsRangeKey, getAnalyticsRangeWindow } from '@/lib/dashboard/analytics-range';
import { QUERY_POLICY } from '@/lib/query-policies';

function rangeParams(dateRange?: DateRange): URLSearchParams {
  const rangeWindow = getAnalyticsRangeWindow(dateRange);
  const params = new URLSearchParams();
  if (rangeWindow.startDate && rangeWindow.endDate) {
    params.set('start_date', rangeWindow.startDate);
    params.set('end_date', rangeWindow.endDate);
  }
  return params;
}

export function useLogsReadModelQuery({
  initialUserId,
  dateRange,
  limit = 200,
  offset = 0,
  habitId,
  enabled = true,
}: {
  initialUserId?: string | null;
  dateRange?: DateRange;
  limit?: number;
  offset?: number;
  habitId?: string | null;
  enabled?: boolean;
} = {}) {
  const { user } = useUser();
  const resolvedUserId = user?.id ?? initialUserId ?? null;
  const queryUserId = resolvedUserId ?? 'anonymous';
  const rangeKey = useMemo(() => getAnalyticsRangeKey(dateRange), [dateRange]);
  const queryKey = useMemo(
    () => dashboardQueryKeys.logsReadModel.detail(queryUserId, rangeKey, limit, offset, habitId),
    [habitId, limit, offset, queryUserId, rangeKey],
  );

  return useQuery({
    queryKey,
    queryFn: async () => {
      const params = rangeParams(dateRange);
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      if (habitId) params.set('habit_id', habitId);
      const response = await fetch(`/api/logs/read-model?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Failed to fetch logs read model: ${response.status}`);
      return response.json();
    },
    enabled: Boolean(enabled && resolvedUserId),
    placeholderData: (previous) => previous,
    staleTime: QUERY_POLICY.general.staleTime,
    gcTime: QUERY_POLICY.general.gcTime,
  });
}

export function useCalendarReadModelQuery({
  initialUserId,
  dateRange,
  enabled = true,
}: {
  initialUserId?: string | null;
  dateRange?: DateRange;
  enabled?: boolean;
} = {}) {
  const { user } = useUser();
  const resolvedUserId = user?.id ?? initialUserId ?? null;
  const queryUserId = resolvedUserId ?? 'anonymous';
  const rangeKey = useMemo(() => getAnalyticsRangeKey(dateRange), [dateRange]);
  const queryKey = useMemo(
    () => dashboardQueryKeys.calendarReadModel.detail(queryUserId, rangeKey),
    [queryUserId, rangeKey],
  );

  return useQuery({
    queryKey,
    queryFn: async () => {
      const params = rangeParams(dateRange);
      const response = await fetch(`/api/calendar/read-model${params.size ? `?${params.toString()}` : ''}`, {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Failed to fetch calendar read model: ${response.status}`);
      return response.json();
    },
    enabled: Boolean(enabled && resolvedUserId),
    placeholderData: (previous) => previous,
    staleTime: QUERY_POLICY.general.staleTime,
    gcTime: QUERY_POLICY.general.gcTime,
  });
}
