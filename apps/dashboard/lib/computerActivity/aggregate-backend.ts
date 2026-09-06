'use client'

import { fetchWatcherStatsJson, cacheAggregatedResult, normalizeAggregatedPayload } from './backend-read'
import { stampReadSource } from './policy'
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
  const result = stampReadSource(normalizeAggregatedPayload(payload), 'synced')
  cacheAggregatedResult(cacheKey, params, limit, result)
  return result
}
