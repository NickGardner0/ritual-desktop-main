'use client';

import { useQuery } from '@tanstack/react-query';
import type { BreakdownResponse, UsageBreakdownKind } from '@ritual/shared-contracts/computer-activity';

export interface UsageBreakdownParams {
  kind: UsageBreakdownKind;
  key: string;
  start: string;
  end: string;
  enabled?: boolean;
}

export function useUsageBreakdown({
  kind,
  key,
  start,
  end,
  enabled = true,
}: UsageBreakdownParams) {
  return useQuery({
    queryKey: ['usage-breakdown', kind, key, start, end],
    queryFn: async () => {
      const params = new URLSearchParams({ kind, key, start, end });
      const response = await fetch(`/api/computer-activity/breakdown?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch usage breakdown');
      }

      return response.json() as Promise<BreakdownResponse>;
    },
    enabled: enabled && !!kind && !!key && !!start && !!end,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });
}
