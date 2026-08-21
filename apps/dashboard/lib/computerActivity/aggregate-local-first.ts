'use client'

import { perfInfo, perfWarn } from '@/lib/perf-debug'
import {
  asDesktopLocalTruth,
  shouldReadDesktopAggregateLocalFirst,
  unavailableComputerStats,
} from './policy'
import { cacheAggregatedResult } from './backend-read'
import { getDesktopLocalAggregatedStats } from './local-read'
import type { AggregatedComputerStatsResponse, ComputerActivityRangeParams } from './types'

export async function tryGetDesktopLocalFirstAggregate(
  params: ComputerActivityRangeParams,
  limit: number,
  cacheKey: string,
): Promise<AggregatedComputerStatsResponse | null> {
  if (!shouldReadDesktopAggregateLocalFirst(params)) return null

  try {
    const localAggregate = await getDesktopLocalAggregatedStats(params, limit)
    const localTruth = asDesktopLocalTruth(localAggregate)
    cacheAggregatedResult(cacheKey, params, limit, localTruth)
    perfInfo('computer-activity-client', 'aggregate-desktop-local', {
      params,
      limit,
      local_total_active_ms: localTruth.summary.total_active_ms,
      local_daily_rows: localTruth.daily.length,
    })
    return localTruth
  } catch (localError) {
    perfWarn('computer-activity-client', 'aggregate-desktop-local-unavailable', {
      params,
      limit,
      error: localError instanceof Error ? localError.message : String(localError),
    })
    const unavailable = unavailableComputerStats()
    cacheAggregatedResult(cacheKey, params, limit, unavailable)
    return unavailable
  }
}
