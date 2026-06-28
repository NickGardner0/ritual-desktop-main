'use client'

import { perfInfo, perfWarn } from '@/lib/perf-debug'
import { fetchWatcherStatsJson, cacheAggregatedResult, normalizeAggregatedPayload } from './backend-read'
import type { AggregatedComputerStatsResponse, ComputerActivityRangeParams } from './types'

export async function fetchBackendAggregatedComputerStats(
  params: ComputerActivityRangeParams,
  limit: number,
  cacheKey: string,
): Promise<AggregatedComputerStatsResponse> {
  const payload = await fetchWatcherStatsJson<{ data?: any }>('/api/watcher/stats/aggregate', {
    start_date: params.startDate,
    end_date: params.endDate,
    limit,
  })
  const result = normalizeAggregatedPayload(payload)
  cacheAggregatedResult(cacheKey, params, limit, result)
  return result
}

export function refreshBackendAggregatedComputerStatsInBackground(
  params: ComputerActivityRangeParams,
  limit: number,
  cacheKey: string,
): void {
  void fetchBackendAggregatedComputerStats(params, limit, cacheKey)
    .then((result) => {
      perfInfo('computer-activity-client', 'aggregate-background-backend-reconciled', {
        params,
        limit,
        source: result.source || result.summary.source,
        state: result.state,
        summary_active_ms: result.summary.total_active_ms,
      })
    })
    .catch((error) => {
      perfWarn('computer-activity-client', 'aggregate-background-backend-reconcile-failed', {
        params,
        limit,
        error: error instanceof Error ? error.message : String(error),
      })
    })
}
