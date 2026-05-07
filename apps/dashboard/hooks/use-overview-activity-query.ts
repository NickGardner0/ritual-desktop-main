'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getOverviewActivityBundle,
  overviewActivityKeys,
  type OverviewActivityRangeKey,
} from '@/lib/ai/overview-activity/overview-activity-query';
import { QUERY_POLICY } from '@/lib/query-policies';

export function useOverviewActivityQuery({
  userId,
  timezone,
  rangeKey,
  enabled,
}: {
  userId?: string | null;
  timezone: string;
  rangeKey: OverviewActivityRangeKey;
  enabled: boolean;
}) {
  const queryUserId = userId ?? 'anonymous';

  return useQuery({
    queryKey: overviewActivityKeys.detail(queryUserId, timezone, rangeKey),
    queryFn: () => getOverviewActivityBundle(rangeKey, timezone),
    enabled: enabled && Boolean(userId),
    staleTime: QUERY_POLICY.overviewActivity.staleTime,
    gcTime: QUERY_POLICY.overviewActivity.gcTime,
    refetchOnWindowFocus: false,
  });
}
