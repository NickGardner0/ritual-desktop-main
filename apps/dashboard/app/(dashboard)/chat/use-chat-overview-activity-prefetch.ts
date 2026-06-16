'use client';

import { useCallback, useDeferredValue, useEffect, useMemo } from 'react';
import { useOverviewActivityQuery } from '@/hooks/use-overview-activity-query';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import {
  getOverviewActivityBundle,
  getOverviewActivityRangeKeysForText,
  overviewActivityKeys,
  type OverviewActivityRangeKey,
} from '@/lib/ai/overview-activity/overview-activity-query';

interface UseChatOverviewActivityPrefetchParams {
  input: string;
  queryClient: {
    prefetchQuery: (options: {
      queryKey: readonly unknown[];
      queryFn: () => Promise<unknown>;
      staleTime: number;
    }) => Promise<unknown>;
  };
  timezone: string;
  userId?: string;
}

export function useChatOverviewActivityPrefetch({
  input,
  queryClient,
  timezone,
  userId,
}: UseChatOverviewActivityPrefetchParams) {
  const { isDesktop } = useDesktopCapabilities();
  const deferredInput = useDeferredValue(input.trim());
  const overviewIntentRangeKeys = useMemo(
    () => getOverviewActivityRangeKeysForText(deferredInput),
    [deferredInput],
  );
  const primaryOverviewRangeKey = overviewIntentRangeKeys[0] ?? 'rolling-week';

  useOverviewActivityQuery({
    userId,
    timezone,
    rangeKey: primaryOverviewRangeKey,
    enabled: isDesktop && overviewIntentRangeKeys.length > 0,
  });

  const prefetchOverviewActivityRange = useCallback((rangeKey: OverviewActivityRangeKey) => {
    if (!userId || !isDesktop) return;
    void queryClient.prefetchQuery({
      queryKey: overviewActivityKeys.detail(userId, timezone, rangeKey),
      queryFn: () => getOverviewActivityBundle(rangeKey, timezone),
      staleTime: 1000 * 60 * 5,
    });
  }, [isDesktop, queryClient, timezone, userId]);

  useEffect(() => {
    if (!userId || !isDesktop) return;
    (['today', 'rolling-week', 'this-week', 'last-week', 'month'] as OverviewActivityRangeKey[])
      .forEach(prefetchOverviewActivityRange);
  }, [prefetchOverviewActivityRange, userId]);

  useEffect(() => {
    if (!userId || !isDesktop || overviewIntentRangeKeys.length === 0) return;
    overviewIntentRangeKeys.forEach(prefetchOverviewActivityRange);
  }, [overviewIntentRangeKeys, prefetchOverviewActivityRange, userId]);
}
