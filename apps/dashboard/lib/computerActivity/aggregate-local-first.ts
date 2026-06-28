'use client'

import { isDesktopRuntime } from '@/lib/desktop-capabilities'
import { perfInfo, perfWarn } from '@/lib/perf-debug'
import { aggregateHasAnyData, asDesktopLocalTruth, shouldReadDesktopAggregateLocalFirst } from './policy'
import { cacheAggregatedResult } from './backend-read'
import { getDesktopLocalAggregatedStats } from './tauri-fallback'
import { refreshBackendAggregatedComputerStatsInBackground } from './aggregate-backend'
import type { AggregatedComputerStatsResponse, ComputerActivityRangeParams } from './types'

export async function tryGetDesktopLocalFirstAggregate(
  params: ComputerActivityRangeParams,
  limit: number,
  cacheKey: string,
): Promise<AggregatedComputerStatsResponse | null> {
  if (!isDesktopRuntime() || !shouldReadDesktopAggregateLocalFirst(params)) return null

  try {
    const localAggregate = await getDesktopLocalAggregatedStats(params, limit)
    if (!aggregateHasAnyData(localAggregate)) {
      perfWarn('computer-activity-client', 'aggregate-desktop-local-first-empty', { params, limit })
      return null
    }

    const localTruth = asDesktopLocalTruth(localAggregate)
    cacheAggregatedResult(cacheKey, params, limit, localTruth)
    refreshBackendAggregatedComputerStatsInBackground(params, limit, cacheKey)
    perfInfo('computer-activity-client', 'aggregate-desktop-local-first', {
      params,
      limit,
      local_total_active_ms: localTruth.summary.total_active_ms,
      local_daily_rows: localTruth.daily.length,
    })
    return localTruth
  } catch (localError) {
    perfWarn('computer-activity-client', 'aggregate-desktop-local-first-failed', {
      params,
      limit,
      error: localError instanceof Error ? localError.message : String(localError),
    })
    return null
  }
}
