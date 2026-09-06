'use client'

import { isDesktopRuntime } from '@/lib/desktop-capabilities'
import { perfWarn, startPerfTimer } from '@/lib/perf-debug'
import {
  asDesktopLocalTruth,
  buildSummaryFromDailyRows,
  getRangeCacheKey,
  shouldAllowDesktopLocalFallback,
  shouldPreferRecentDesktopLocalTruth,
  unavailableComputerStats,
} from './policy'
import {
  aggregateCache,
  appsCache,
  cacheAggregatedResult,
  dailyCache,
  domainsCache,
  fetchWatcherStatsJson,
  normalizeDailyRows,
  summaryCache,
} from './backend-read'
import { fetchBackendAggregatedComputerStats } from './aggregate-backend'
import { tryGetDesktopLocalFirstAggregate } from './aggregate-local-first'
import {
  getDesktopLocalAggregatedStats,
  getDesktopLocalDailyRows,
} from './local-read'
import type {
  AggregatedComputerStatsResponse,
  ComputerActivityRangeParams,
  ComputerDailyResponseRow,
  ComputerSummaryResponse,
  TopAppResponseRow,
  TopDomainResponseRow,
} from './types'

async function readCachedOrThrow<T>(
  cache: Map<string, T>,
  cacheKey: string,
  error: unknown,
  event: string,
  extra: Record<string, unknown>,
): Promise<T> {
  const cached = cache.get(cacheKey)
  if (cached) {
    perfWarn('computer-activity-client', event, {
      ...extra,
      error: error instanceof Error ? error.message : String(error),
    })
    return cached
  }
  throw error
}

export async function getComputerTimeDaily(
  params: ComputerActivityRangeParams,
): Promise<ComputerDailyResponseRow[]> {
  const cacheKey = getRangeCacheKey('daily', params)
  const stopTimer = startPerfTimer('computer-activity-client', 'getComputerTimeDaily', { params })

  if (shouldPreferRecentDesktopLocalTruth(params)) {
    try {
      const localRows = await getDesktopLocalDailyRows(params)
      dailyCache.set(cacheKey, localRows)
      stopTimer({ success: true, source: 'local', row_count: localRows.length })
      return localRows
    } catch (error) {
      stopTimer({
        success: false,
        source: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  try {
    const payload = await fetchWatcherStatsJson<{ data?: any[] }>(
      '/api/watcher/stats/daily',
      { start_date: params.startDate, end_date: params.endDate },
    )
    const backendRows = normalizeDailyRows(Array.isArray(payload?.data) ? payload.data : [])
      .map((row) => ({ ...row, source: row.source || 'synced' }))
    dailyCache.set(cacheKey, backendRows)
    stopTimer({ success: true, source: 'synced', row_count: backendRows.length })
    return backendRows
  } catch (error) {
    try {
      const cached = await readCachedOrThrow(dailyCache, cacheKey, error, 'daily-cache-hit-after-error', { params })
      stopTimer({ success: true, source: 'cache', row_count: cached.length })
      return cached
    } catch (cacheError) {
      if (!shouldAllowDesktopLocalFallback(params)) {
        stopTimer({ success: false, source: 'unavailable' })
        throw cacheError
      }
    }
  }

  perfWarn('computer-activity-client', 'daily-offline-local', { params })
  const localRows = await getDesktopLocalDailyRows(params)
  stopTimer({ success: true, source: 'local', row_count: localRows.length })
  return localRows
}

export async function getTopApps(
  params: ComputerActivityRangeParams,
  limit: number,
): Promise<TopAppResponseRow[]> {
  const cacheKey = getRangeCacheKey('apps', params, limit)
  const stopTimer = startPerfTimer('computer-activity-client', 'getTopApps', { params, limit })

  if (shouldPreferRecentDesktopLocalTruth(params)) {
    const local = await getDesktopLocalAggregatedStats(params, limit)
    stopTimer({ success: true, source: 'local', row_count: local.apps.length })
    return local.apps
  }

  try {
    const payload = await fetchWatcherStatsJson<{ data?: any[] }>(
      '/api/watcher/stats/top-apps',
      { start_date: params.startDate, end_date: params.endDate, limit },
    )
    const rows = (Array.isArray(payload?.data) ? payload.data : []).map((row) => ({
      app_bundle_id: String(row.app_bundle_id || ''),
      app_name: String(row.app_name || row.app_bundle_id || 'Unknown'),
      total_active_ms: Math.max(0, Number(row.total_active_ms || 0)),
      total_events: Math.max(0, Number(row.total_events || 0)),
      hours: Math.max(0, Number(row.hours || 0)),
      source: row.source || 'synced',
    }))
    if (rows.length > 0) appsCache.set(cacheKey, rows)
    stopTimer({ success: true, source: 'synced', row_count: rows.length })
    return rows
  } catch (error) {
    try {
      const cached = await readCachedOrThrow(appsCache, cacheKey, error, 'top-apps-cache-hit-after-error', { params, limit })
      stopTimer({ success: true, source: 'cache', row_count: cached.length })
      return cached
    } catch (cacheError) {
      if (!shouldAllowDesktopLocalFallback(params)) {
        stopTimer({ success: false, source: 'unavailable' })
        throw cacheError
      }
    }
  }

  const local = await getDesktopLocalAggregatedStats(params, limit)
  stopTimer({ success: true, source: 'local', row_count: local.apps.length })
  return local.apps
}

export async function getTopDomains(
  params: ComputerActivityRangeParams,
  limit: number,
): Promise<TopDomainResponseRow[]> {
  const cacheKey = getRangeCacheKey('domains', params, limit)
  const stopTimer = startPerfTimer('computer-activity-client', 'getTopDomains', { params, limit })

  if (shouldPreferRecentDesktopLocalTruth(params)) {
    const local = await getDesktopLocalAggregatedStats(params, limit)
    stopTimer({ success: true, source: 'local', row_count: local.domains.length })
    return local.domains
  }

  try {
    const payload = await fetchWatcherStatsJson<{ data?: any[] }>(
      '/api/watcher/stats/top-domains',
      { start_date: params.startDate, end_date: params.endDate, limit },
    )
    const rows = (Array.isArray(payload?.data) ? payload.data : []).map((row) => ({
      domain: String(row.domain || 'Unknown'),
      total_active_ms: Math.max(0, Number(row.total_active_ms || 0)),
      total_events: Math.max(0, Number(row.total_events || 0)),
      hours: Math.max(0, Number(row.hours || 0)),
      minutes: row.minutes == null ? undefined : Math.max(0, Number(row.minutes || 0)),
      source: row.source || 'synced',
    }))
    if (rows.length > 0) domainsCache.set(cacheKey, rows)
    stopTimer({ success: true, source: 'synced', row_count: rows.length })
    return rows
  } catch (error) {
    try {
      const cached = await readCachedOrThrow(domainsCache, cacheKey, error, 'top-domains-cache-hit-after-error', { params, limit })
      stopTimer({ success: true, source: 'cache', row_count: cached.length })
      return cached
    } catch (cacheError) {
      if (!shouldAllowDesktopLocalFallback(params)) {
        stopTimer({ success: false, source: 'unavailable' })
        throw cacheError
      }
    }
  }

  const local = await getDesktopLocalAggregatedStats(params, limit)
  stopTimer({ success: true, source: 'local', row_count: local.domains.length })
  return local.domains
}

export async function getComputerTimeSummary(
  params: ComputerActivityRangeParams,
): Promise<ComputerSummaryResponse> {
  const cacheKey = getRangeCacheKey('summary', params)
  const stopTimer = startPerfTimer('computer-activity-client', 'getComputerTimeSummary', { params })

  if (shouldPreferRecentDesktopLocalTruth(params)) {
    const localRows = await getDesktopLocalDailyRows(params)
    const localSummary = buildSummaryFromDailyRows(localRows, 'local')
    summaryCache.set(cacheKey, localSummary)
    stopTimer({ success: true, source: 'local', total_active_ms: localSummary.total_active_ms })
    return localSummary
  }

  try {
    const payload = await fetchWatcherStatsJson<{ data?: any }>(
      '/api/watcher/stats/summary',
      { start_date: params.startDate, end_date: params.endDate },
    )
    const data = payload?.data || {}
    const totalActiveMs = Math.max(0, Number(data.total_active_ms || 0))
    const summary: ComputerSummaryResponse = {
      total_active_ms: totalActiveMs,
      total_afk_ms: Math.max(0, Number(data.total_afk_ms || 0)),
      total_hours: Math.max(0, Number(data.total_hours || totalActiveMs / (1000 * 60 * 60))),
      total_events: Math.max(0, Number(data.total_events || 0)),
      days_tracked: Math.max(0, Number(data.days_tracked || 0)),
      unique_apps: Math.max(0, Number(data.unique_apps || 0)),
      unique_domains: Math.max(0, Number(data.unique_domains || 0)),
      avg_daily_hours: Math.max(0, Number(data.avg_daily_hours || 0)),
      source: data.source || 'synced',
    }
    if (summary.total_active_ms > 0) summaryCache.set(cacheKey, summary)
    stopTimer({ success: true, source: 'synced', total_active_ms: summary.total_active_ms })
    return summary
  } catch (error) {
    try {
      const cached = await readCachedOrThrow(summaryCache, cacheKey, error, 'summary-cache-hit-after-error', { params })
      stopTimer({ success: true, source: 'cache', total_active_ms: cached.total_active_ms })
      return cached
    } catch (cacheError) {
      if (!shouldAllowDesktopLocalFallback(params)) {
        stopTimer({ success: false, source: 'unavailable' })
        throw cacheError
      }
    }
  }

  const localRows = await getDesktopLocalDailyRows(params)
  const localSummary = buildSummaryFromDailyRows(localRows, 'local')
  stopTimer({ success: true, source: 'local', total_active_ms: localSummary.total_active_ms })
  return localSummary
}

export async function getAggregatedComputerStats(
  params: ComputerActivityRangeParams,
  limit = 10,
): Promise<AggregatedComputerStatsResponse> {
  const cacheKey = getRangeCacheKey('aggregate', params, limit)
  const stopTimer = startPerfTimer('computer-activity-client', 'getAggregatedComputerStats', { params, limit })

  const localFirstAggregate = await tryGetDesktopLocalFirstAggregate(params, limit, cacheKey)
  if (localFirstAggregate) {
    stopTimer({
      success: localFirstAggregate.read_source !== 'unavailable',
      source: localFirstAggregate.source,
      state: localFirstAggregate.state,
      summary_active_ms: localFirstAggregate.summary.total_active_ms,
    })
    return localFirstAggregate
  }

  try {
    const result = await fetchBackendAggregatedComputerStats(params, limit, cacheKey)
    stopTimer({
      success: true,
      source: result.source,
      state: result.state,
      summary_active_ms: result.summary.total_active_ms,
    })
    return result
  } catch (error) {
    const cached = aggregateCache.get(cacheKey)
    if (cached) {
      perfWarn('computer-activity-client', 'aggregate-cache-hit-after-error', {
        params,
        limit,
        error: error instanceof Error ? error.message : String(error),
      })
      stopTimer({ success: true, source: 'cache', summary_active_ms: cached.summary.total_active_ms })
      return cached
    }

    if (shouldAllowDesktopLocalFallback(params)) {
      try {
        const localTruth = asDesktopLocalTruth(await getDesktopLocalAggregatedStats(params, limit))
        cacheAggregatedResult(cacheKey, params, limit, localTruth)
        stopTimer({ success: true, source: 'local', summary_active_ms: localTruth.summary.total_active_ms })
        return localTruth
      } catch (localError) {
        perfWarn('computer-activity-client', 'aggregate-offline-local-failed', {
          params,
          limit,
          error: localError instanceof Error ? localError.message : String(localError),
        })
      }
    }

    if (!isDesktopRuntime()) {
      stopTimer({ success: false, error: error instanceof Error ? error.message : String(error) })
      throw error
    }

    const unavailable = unavailableComputerStats()
    cacheAggregatedResult(cacheKey, params, limit, unavailable)
    stopTimer({ success: false, source: 'unavailable' })
    return unavailable
  }
}
