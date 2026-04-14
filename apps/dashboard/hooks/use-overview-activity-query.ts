'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getOverviewActivityBundle,
  overviewActivityKeys,
  type OverviewActivityRangeKey,
} from '@/lib/ai/chat-stream/overview-activity-query';

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
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}
