'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  ActivityBreakdownSource,
  BreakdownResponse,
  UsageBreakdownKind,
} from '@/lib/computerActivity/contracts';
import { QUERY_POLICY } from '@/lib/query-policies';
import { getReadConsistencyHeaders } from '@/lib/read-consistency';

export interface UsageBreakdownParams {
  source?: ActivityBreakdownSource;
  kind: UsageBreakdownKind;
  key: string;
  start: string;
  end: string;
  enabled?: boolean;
}

export function useUsageBreakdown({
  source = 'desktop',
  kind,
  key,
  start,
  end,
  enabled = true,
}: UsageBreakdownParams) {
  return useQuery({
    queryKey: ['usage-breakdown', source, kind, key, start, end],
    queryFn: async () => {
      const params = new URLSearchParams({ source, kind, key, start, end });
      const response = await fetch(`/api/computer-activity/breakdown?${params.toString()}`, {
        headers: {
          ...getReadConsistencyHeaders(),
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch usage breakdown');
      }

      return response.json() as Promise<BreakdownResponse>;
    },
    enabled: enabled && !!kind && !!key && !!start && !!end,
    staleTime: QUERY_POLICY.computerBreakdown.staleTime,
    gcTime: QUERY_POLICY.computerBreakdown.gcTime,
  });
}
