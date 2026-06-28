'use client'

import { isDesktopRuntime } from '@/lib/desktop-capabilities'
import {
  invokeDailySummariesWithInitRetry,
  invokeDetailedActivityWithInitRetry,
} from './tauri-activity'
import { perfInfo, perfWarn, startPerfTimer } from '@/lib/perf-debug'
import {
  aggregateHasAnyData,
  asDesktopLocalTruth,
  buildSummaryFromDailyRows,
  getInclusiveRangeDays,
  getRangeCacheKey,
  getRangeTimestamps,
  getLocalTodayDateString,
  mergeTodayRow,
  preferDesktopLocalAggregate,
  rangeIncludesLocalToday,
  shouldAllowDesktopAggregateLocalFallback,
  shouldAllowDesktopLocalFallback,
  shouldPreferRecentDesktopLocalTruth,
  shouldSupplementTodayFromLocal,
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
  applyDesktopRecentSummaryCorrection,
  getDesktopLocalAggregatedStats,
  getDesktopLocalDailyRows,
} from './tauri-fallback'
import type {
  AggregatedComputerStatsResponse,
  ComputerActivityRangeParams,
  ComputerDailyResponseRow,
  ComputerSummaryResponse,
  TopAppResponseRow,
  TopDomainResponseRow,
} from './types'

export async function getComputerTimeDaily(
  params: ComputerActivityRangeParams,
): Promise<ComputerDailyResponseRow[]> {
  const cacheKey = getRangeCacheKey('daily', params)
  const stopTimer = startPerfTimer('computer-activity-client', 'getComputerTimeDaily', {
    params,
  })

  if (shouldPreferRecentDesktopLocalTruth(params)) {
    try {
      const localRows = await getDesktopLocalDailyRows(params)
      dailyCache.set(cacheKey, localRows)
      perfInfo('computer-activity-client', 'daily-desktop-local-truth', {
        params,
        row_count: localRows.length,
      })
      stopTimer({ success: true, source: 'tauri_recent_truth', row_count: localRows.length })
      return localRows
    } catch (error) {
      perfWarn('computer-activity-client', 'daily-desktop-local-truth-failed', {
        params,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  try {
    const payload = await fetchWatcherStatsJson<{ data?: any[] }>(
      '/api/watcher/stats/daily',
      {
        start_date: params.startDate,
        end_date: params.endDate,
      },
    )
    const normalized = normalizeDailyRows(Array.isArray(payload?.data) ? payload.data : [])
    const backendRows = normalized.map((row) => ({ ...row, source: row.source || 'backend' }))
    if (backendRows.length > 0) {
      dailyCache.set(cacheKey, backendRows)
      perfInfo('computer-activity-client', 'daily-backend-cache-store', {
        cache_key: cacheKey,
        row_count: backendRows.length,
      })
    }

    if (backendRows.length === 0 && isDesktopRuntime()) {
      if (!shouldAllowDesktopLocalFallback(params)) {
        perfWarn('computer-activity-client', 'daily-empty-backend-desktop-fallback-suppressed', {
          params,
          range_days: getInclusiveRangeDays(params),
        })
        throw new Error('backend daily returned empty for large desktop range')
      }
      perfWarn('computer-activity-client', 'daily-empty-backend-fallback-local', { params })
      const localRows = normalizeDailyRows(
        await invokeDailySummariesWithInitRetry(params.startDate, params.endDate),
      ).map((row) => ({ ...row, source: row.source || 'tauri_fallback' }))

      if (localRows.length > 0) {
        stopTimer({ success: true, source: 'tauri_fallback', row_count: localRows.length })
        return localRows
      }
    }

    if (!shouldSupplementTodayFromLocal(params, backendRows)) {
      stopTimer({ success: true, source: 'backend', row_count: backendRows.length })
      return backendRows
    }

    perfInfo('computer-activity-client', 'daily-supplement-today-from-local', {
      params,
      backend_rows: backendRows.length,
    })
    const localRows = normalizeDailyRows(
      await invokeDailySummariesWithInitRetry(params.startDate, params.endDate),
    ).map((row) => ({ ...row, source: row.source || 'tauri_fallback' }))

    const merged = mergeTodayRow(backendRows, localRows)
    perfInfo('computer-activity-client', 'daily-today-merged', {
      backend_rows: backendRows.length,
      local_rows: localRows.length,
      merged_rows: merged.length,
    })
    stopTimer({ success: true, source: 'backend+tauri_today', row_count: merged.length })
    return merged
  } catch (error) {
    const cached = dailyCache.get(cacheKey)
    if (cached?.length) {
      perfWarn('computer-activity-client', 'daily-cache-hit-after-error', {
        params,
        row_count: cached.length,
        error: error instanceof Error ? error.message : String(error),
      })
      stopTimer({ success: true, source: 'cache', row_count: cached.length })
      return cached
    }
    if (!isDesktopRuntime()) {
      stopTimer({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  if (!shouldAllowDesktopLocalFallback(params)) {
    perfWarn('computer-activity-client', 'daily-hard-fallback-suppressed', {
      params,
      range_days: getInclusiveRangeDays(params),
    })
    stopTimer({
      success: false,
      source: 'backend_required_large_range',
    })
    throw new Error('backend daily unavailable for large desktop range')
  }

  perfWarn('computer-activity-client', 'daily-hard-fallback-local', { params })
  const summaries = await invokeDailySummariesWithInitRetry(params.startDate, params.endDate)
  const normalized = normalizeDailyRows(summaries)
  stopTimer({ success: true, source: 'tauri_fallback', row_count: normalized.length })
  return normalized
}

export async function getTopApps(
  params: ComputerActivityRangeParams,
  limit: number,
): Promise<TopAppResponseRow[]> {
  const cacheKey = getRangeCacheKey('apps', params, limit)
  const stopTimer = startPerfTimer('computer-activity-client', 'getTopApps', {
    params,
    limit,
  })
  try {
    const payload = await fetchWatcherStatsJson<{ data?: any[] }>(
      '/api/watcher/stats/top-apps',
      {
        start_date: params.startDate,
        end_date: params.endDate,
        limit,
      },
    )
    const rows = Array.isArray(payload?.data) ? payload.data : []
    const normalizedRows = rows.map((row) => ({
      app_bundle_id: String(row.app_bundle_id || ''),
      app_name: String(row.app_name || row.app_bundle_id || 'Unknown'),
      total_active_ms: Math.max(0, Number(row.total_active_ms || 0)),
      total_events: Math.max(0, Number(row.total_events || 0)),
      hours: Math.max(0, Number(row.hours || 0)),
      source: row.source || 'backend',
    }))

    if (normalizedRows.length > 0) {
      appsCache.set(cacheKey, normalizedRows)
      perfInfo('computer-activity-client', 'top-apps-backend-cache-store', {
        cache_key: cacheKey,
        row_count: normalizedRows.length,
      })
    }

    if (normalizedRows.length > 0 || !isDesktopRuntime()) {
      stopTimer({
        success: true,
        source: normalizedRows.length > 0 ? 'backend' : 'backend-empty-web',
        row_count: normalizedRows.length,
      })
      return normalizedRows
    }

    perfWarn('computer-activity-client', 'top-apps-backend-empty-desktop-fallback', {
      params,
      limit,
    })
  } catch (error) {
    const cached = appsCache.get(cacheKey)
    if (cached?.length) {
      perfWarn('computer-activity-client', 'top-apps-cache-hit-after-error', {
        params,
        limit,
        row_count: cached.length,
        error: error instanceof Error ? error.message : String(error),
      })
      stopTimer({ success: true, source: 'cache', row_count: cached.length })
      return cached
    }
    if (!isDesktopRuntime()) {
      stopTimer({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  if (!shouldAllowDesktopLocalFallback(params)) {
    perfWarn('computer-activity-client', 'top-apps-local-fallback-suppressed', {
      params,
      limit,
      range_days: getInclusiveRangeDays(params),
    })
    stopTimer({
      success: false,
      source: 'backend_required_large_range',
    })
    throw new Error('backend top apps unavailable for large desktop range')
  }

  perfWarn('computer-activity-client', 'top-apps-local-fallback', {
    params,
    limit,
    range_days: getInclusiveRangeDays(params),
  })
  const { startTs, endTs } = getRangeTimestamps(params)
  const detailed = await invokeDetailedActivityWithInitRetry({ startTs, endTs, limit })
  const rows = detailed.apps
    .filter((row) => Math.max(0, Number(row.total_duration_ms || 0)) > 0)
    .slice(0, limit)
    .map((row) => ({
    app_bundle_id: row.app_bundle_id,
    app_name: row.app_name || row.app_bundle_id || 'Unknown',
    total_active_ms: Math.max(0, Number(row.total_duration_ms || 0)),
    total_events: Math.max(0, Number(row.event_count || 0)),
    hours: Math.max(0, Number(row.total_duration_ms || 0) / (1000 * 60 * 60)),
    source: 'tauri_fallback',
    }))
  perfInfo('computer-activity-client', 'top-apps-local-fallback-result', {
    limit,
    row_count: rows.length,
    total_active_ms: rows.reduce((sum, row) => sum + row.total_active_ms, 0),
  })
  stopTimer({ success: true, source: 'tauri_fallback', row_count: rows.length })
  return rows
}

export async function getTopDomains(
  params: ComputerActivityRangeParams,
  limit: number,
): Promise<TopDomainResponseRow[]> {
  const cacheKey = getRangeCacheKey('domains', params, limit)
  const stopTimer = startPerfTimer('computer-activity-client', 'getTopDomains', {
    params,
    limit,
  })
  try {
    const payload = await fetchWatcherStatsJson<{ data?: any[] }>(
      '/api/watcher/stats/top-domains',
      {
        start_date: params.startDate,
        end_date: params.endDate,
        limit,
      },
    )
    const rows = Array.isArray(payload?.data) ? payload.data : []
    const normalizedRows = rows.map((row) => ({
      domain: String(row.domain || 'Unknown'),
      total_active_ms: Math.max(0, Number(row.total_active_ms || 0)),
      total_events: Math.max(0, Number(row.total_events || 0)),
      hours: Math.max(0, Number(row.hours || 0)),
      minutes: row.minutes == null ? undefined : Math.max(0, Number(row.minutes || 0)),
      source: row.source || 'backend',
    }))

    if (normalizedRows.length > 0) {
      domainsCache.set(cacheKey, normalizedRows)
      perfInfo('computer-activity-client', 'top-domains-backend-cache-store', {
        cache_key: cacheKey,
        row_count: normalizedRows.length,
      })
    }

    if (normalizedRows.length > 0 || !isDesktopRuntime()) {
      stopTimer({
        success: true,
        source: normalizedRows.length > 0 ? 'backend' : 'backend-empty-web',
        row_count: normalizedRows.length,
      })
      return normalizedRows
    }

    perfWarn('computer-activity-client', 'top-domains-backend-empty-desktop-fallback', {
      params,
      limit,
    })
  } catch (error) {
    const cached = domainsCache.get(cacheKey)
    if (cached?.length) {
      perfWarn('computer-activity-client', 'top-domains-cache-hit-after-error', {
        params,
        limit,
        row_count: cached.length,
        error: error instanceof Error ? error.message : String(error),
      })
      stopTimer({ success: true, source: 'cache', row_count: cached.length })
      return cached
    }
    if (!isDesktopRuntime()) {
      stopTimer({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  if (!shouldAllowDesktopLocalFallback(params)) {
    perfWarn('computer-activity-client', 'top-domains-local-fallback-suppressed', {
      params,
      limit,
      range_days: getInclusiveRangeDays(params),
    })
    stopTimer({
      success: false,
      source: 'backend_required_large_range',
    })
    throw new Error('backend top domains unavailable for large desktop range')
  }

  perfWarn('computer-activity-client', 'top-domains-local-fallback', {
    params,
    limit,
    range_days: getInclusiveRangeDays(params),
  })
  const { startTs, endTs } = getRangeTimestamps(params)
  const detailed = await invokeDetailedActivityWithInitRetry({ startTs, endTs, limit })
  const rows = detailed.domains
    .filter((row) => Math.max(0, Number(row.total_duration_ms || 0)) > 0)
    .slice(0, limit)
    .map((row) => ({
    domain: row.domain || 'Unknown',
    total_active_ms: Math.max(0, Number(row.total_duration_ms || 0)),
    total_events: Math.max(0, Number(row.event_count || 0)),
    hours: Math.max(0, Number(row.total_duration_ms || 0) / (1000 * 60 * 60)),
    minutes: Math.max(0, Number(row.total_duration_ms || 0) / (1000 * 60)),
    source: 'tauri_fallback',
    }))
  perfInfo('computer-activity-client', 'top-domains-local-fallback-result', {
    limit,
    row_count: rows.length,
    total_active_ms: rows.reduce((sum, row) => sum + row.total_active_ms, 0),
  })
  stopTimer({ success: true, source: 'tauri_fallback', row_count: rows.length })
  return rows
}

export async function getComputerTimeSummary(
  params: ComputerActivityRangeParams,
): Promise<ComputerSummaryResponse> {
  const cacheKey = getRangeCacheKey('summary', params)
  const stopTimer = startPerfTimer('computer-activity-client', 'getComputerTimeSummary', {
    params,
  })

  if (shouldPreferRecentDesktopLocalTruth(params)) {
    try {
      const localRows = await getDesktopLocalDailyRows(params)
      const localSummary = buildSummaryFromDailyRows(localRows, 'tauri_recent_truth')
      if (localSummary.total_active_ms > 0 || localRows.length > 0) {
        summaryCache.set(cacheKey, localSummary)
        perfInfo('computer-activity-client', 'summary-desktop-local-truth', {
          params,
          total_active_ms: localSummary.total_active_ms,
        })
        stopTimer({
          success: true,
          source: 'tauri_recent_truth',
          total_active_ms: localSummary.total_active_ms,
        })
        return localSummary
      }
    } catch (error) {
      perfWarn('computer-activity-client', 'summary-desktop-local-truth-failed', {
        params,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  try {
    const payload = await fetchWatcherStatsJson<{ data?: any }>(
      '/api/watcher/stats/summary',
      {
        start_date: params.startDate,
        end_date: params.endDate,
      },
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
      source: data.source || 'backend',
    }
    if (summary.total_active_ms > 0) {
      summaryCache.set(cacheKey, summary)
      perfInfo('computer-activity-client', 'summary-backend-cache-store', {
        cache_key: cacheKey,
        total_active_ms: summary.total_active_ms,
      })
    }

    if (!isDesktopRuntime()) {
      stopTimer({
        success: true,
        source: 'backend',
        total_active_ms: summary.total_active_ms,
      })
      return summary
    }

    const correctedSummary = await applyDesktopRecentSummaryCorrection(params, summary)
    if (
      correctedSummary.total_active_ms !== summary.total_active_ms ||
      correctedSummary.days_tracked !== summary.days_tracked ||
      correctedSummary.source !== summary.source
    ) {
      summaryCache.set(cacheKey, correctedSummary)
      perfInfo('computer-activity-client', 'summary-applied-recent-desktop-correction', {
        params,
        backend_total_active_ms: summary.total_active_ms,
        corrected_total_active_ms: correctedSummary.total_active_ms,
        source: correctedSummary.source,
      })
      stopTimer({
        success: true,
        source: correctedSummary.source,
        total_active_ms: correctedSummary.total_active_ms,
      })
      return correctedSummary
    }

    const includesToday = rangeIncludesLocalToday(params)

    if (!includesToday && summary.total_active_ms > 0) {
      stopTimer({
        success: true,
        source: 'backend',
        total_active_ms: summary.total_active_ms,
      })
      return summary
    }

    if (!includesToday && summary.total_active_ms <= 0) {
      perfWarn('computer-activity-client', 'summary-backend-empty-desktop-fallback', {
        params,
        range_days: getInclusiveRangeDays(params),
      })
      throw new Error('backend summary returned empty for desktop historical range')
    }

    const today = getLocalTodayDateString()
    const [backendTodayPayload, localTodayRows] = await Promise.allSettled([
      fetchWatcherStatsJson<{ data?: any[] }>('/api/watcher/stats/daily', {
        start_date: today,
        end_date: today,
      }),
      invokeDailySummariesWithInitRetry(today, today),
    ])

    const backendTodayRows =
      backendTodayPayload.status === 'fulfilled'
        ? normalizeDailyRows(Array.isArray(backendTodayPayload.value?.data) ? backendTodayPayload.value.data : [])
        : []
    const localTodayNormalized =
      localTodayRows.status === 'fulfilled'
        ? normalizeDailyRows(localTodayRows.value)
        : []

    const backendTodayMs = backendTodayRows.reduce((sum, row) => sum + Math.max(0, Number(row.active_ms || 0)), 0)
    const localTodayMs = localTodayNormalized.reduce((sum, row) => sum + Math.max(0, Number(row.active_ms || 0)), 0)
    const supplementMs = Math.max(0, localTodayMs - backendTodayMs)

    if (supplementMs <= 0) {
      stopTimer({
        success: true,
        source: 'backend',
        total_active_ms: summary.total_active_ms,
      })
      return summary
    }

    const mergedSummary = {
      ...summary,
      total_active_ms: totalActiveMs + supplementMs,
      total_hours: (totalActiveMs + supplementMs) / (1000 * 60 * 60),
      source: 'backend_plus_live_today',
    }
    perfInfo('computer-activity-client', 'summary-merged-live-today-delta', {
      backend_total_active_ms: totalActiveMs,
      backend_today_ms: backendTodayMs,
      local_today_ms: localTodayMs,
      supplement_ms: supplementMs,
      merged_total_active_ms: mergedSummary.total_active_ms,
    })
    stopTimer({
      success: true,
      source: 'backend_plus_live_today',
      total_active_ms: mergedSummary.total_active_ms,
    })
    return mergedSummary
  } catch (error) {
    const cached = summaryCache.get(cacheKey)
    if (cached && cached.total_active_ms > 0) {
      perfWarn('computer-activity-client', 'summary-cache-hit-after-error', {
        params,
        total_active_ms: cached.total_active_ms,
        error: error instanceof Error ? error.message : String(error),
      })
      stopTimer({
        success: true,
        source: 'cache',
        total_active_ms: cached.total_active_ms,
      })
      return cached
    }
    if (!isDesktopRuntime()) {
      stopTimer({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  if (!shouldAllowDesktopLocalFallback(params)) {
    perfWarn('computer-activity-client', 'summary-local-fallback-suppressed', {
      params,
      range_days: getInclusiveRangeDays(params),
    })
    stopTimer({
      success: false,
      source: 'backend_required_large_range',
    })
    throw new Error('backend summary unavailable for large desktop range')
  }

  perfWarn('computer-activity-client', 'summary-local-fallback', { params })
  const { startTs, endTs } = getRangeTimestamps(params)
  const detailed = await invokeDetailedActivityWithInitRetry({ startTs, endTs, limit: 10 })
  const totalActiveMs = Math.max(0, Number(detailed.total_active_ms || 0))
  const totalAfkMs = Math.max(0, Number(detailed.total_afk_ms || 0))
  const daily = await getComputerTimeDaily(params)
  const fallbackSummary = {
    total_active_ms: totalActiveMs,
    total_afk_ms: totalAfkMs,
    total_hours: totalActiveMs / (1000 * 60 * 60),
    total_events: daily.reduce((sum, row) => sum + Number(row.events_count || 0), 0),
    days_tracked: daily.filter((row) => Number(row.active_ms || 0) > 0).length,
    unique_apps: 0,
    unique_domains: 0,
    avg_daily_hours: daily.length > 0
      ? daily.reduce((sum, row) => sum + Number(row.active_hours || 0), 0) / daily.length
      : 0,
    source: 'tauri_fallback',
  }
  stopTimer({
    success: true,
    source: 'tauri_fallback',
    total_active_ms: fallbackSummary.total_active_ms,
  })
  return fallbackSummary
}

export async function getAggregatedComputerStats(
  params: ComputerActivityRangeParams,
  limit = 10,
): Promise<AggregatedComputerStatsResponse> {
  const cacheKey = getRangeCacheKey('aggregate', params, limit)
  const stopTimer = startPerfTimer('computer-activity-client', 'getAggregatedComputerStats', {
    params,
    limit,
  })

  const localFirstAggregate = await tryGetDesktopLocalFirstAggregate(params, limit, cacheKey)
  if (localFirstAggregate) {
    stopTimer({
      success: true,
      source: localFirstAggregate.source,
      state: localFirstAggregate.state,
      summary_active_ms: localFirstAggregate.summary.total_active_ms,
      daily_rows: localFirstAggregate.daily.length,
      app_rows: localFirstAggregate.apps.length,
      domain_rows: localFirstAggregate.domains.length,
    })
    return localFirstAggregate
  }

  try {
    const result = await fetchBackendAggregatedComputerStats(params, limit, cacheKey)
    const hasAnyData = aggregateHasAnyData(result)

    if (isDesktopRuntime() && shouldAllowDesktopAggregateLocalFallback(params)) {
      try {
        const localAggregate = await getDesktopLocalAggregatedStats(params, limit)
        const localHasAnyData = aggregateHasAnyData(localAggregate)
        if (localHasAnyData && (!hasAnyData || preferDesktopLocalAggregate(result, localAggregate))) {
          const localTruth = asDesktopLocalTruth(localAggregate)
          cacheAggregatedResult(cacheKey, params, limit, localTruth)
          perfInfo('computer-activity-client', 'aggregate-desktop-local-truth', {
            params,
            backend_total_active_ms: result.summary.total_active_ms,
            local_total_active_ms: localTruth.summary.total_active_ms,
            backend_daily_rows: result.daily.length,
            local_daily_rows: localTruth.daily.length,
          })
          stopTimer({
            success: true,
            source: localTruth.source,
            state: localTruth.state,
            summary_active_ms: localTruth.summary.total_active_ms,
            daily_rows: localTruth.daily.length,
            app_rows: localTruth.apps.length,
            domain_rows: localTruth.domains.length,
          })
          return localTruth
        }
      } catch (localError) {
        perfWarn('computer-activity-client', 'aggregate-local-truth-check-failed', {
          params,
          limit,
          error: localError instanceof Error ? localError.message : String(localError),
        })
      }
    }

    if (hasAnyData || !isDesktopRuntime() || !shouldAllowDesktopAggregateLocalFallback(params)) {
      stopTimer({
        success: true,
        source: result.source || result.summary.source,
        state: result.state,
        sync_pending: result.sync_pending,
        summary_active_ms: result.summary.total_active_ms,
        daily_rows: result.daily.length,
        app_rows: result.apps.length,
        domain_rows: result.domains.length,
      })
      return result
    }

    perfWarn('computer-activity-client', 'aggregate-empty-backend-fallback-local', {
      params,
      limit,
      sync_pending: result.sync_pending,
      empty_reason: result.empty_reason,
      range_days: getInclusiveRangeDays(params),
    })
    try {
      const localAggregate = await getDesktopLocalAggregatedStats(params, limit)
      const localHasAnyData =
        localAggregate.summary.total_active_ms > 0
        || localAggregate.daily.length > 0
        || localAggregate.apps.length > 0
        || localAggregate.domains.length > 0
      if (localHasAnyData) {
        cacheAggregatedResult(cacheKey, params, limit, localAggregate)
        stopTimer({
          success: true,
          source: localAggregate.source,
          state: localAggregate.state,
          summary_active_ms: localAggregate.summary.total_active_ms,
          daily_rows: localAggregate.daily.length,
          app_rows: localAggregate.apps.length,
          domain_rows: localAggregate.domains.length,
        })
        return localAggregate
      }
    } catch (localError) {
      perfWarn('computer-activity-client', 'aggregate-local-fallback-failed', {
        params,
        limit,
        error: localError instanceof Error ? localError.message : String(localError),
      })
    }

    if (result.sync_pending) {
      stopTimer({
        success: true,
        source: result.source || result.summary.source,
        state: result.state,
        sync_pending: result.sync_pending,
        summary_active_ms: result.summary.total_active_ms,
        daily_rows: result.daily.length,
        app_rows: result.apps.length,
        domain_rows: result.domains.length,
      })
      return result
    }
  } catch (error) {
    const cached = aggregateCache.get(cacheKey)
    if (cached) {
      perfWarn('computer-activity-client', 'aggregate-cache-hit-after-error', {
        params,
        limit,
        error: error instanceof Error ? error.message : String(error),
      })
      stopTimer({
        success: true,
        source: 'cache',
        summary_active_ms: cached.summary.total_active_ms,
        daily_rows: cached.daily.length,
        app_rows: cached.apps.length,
        domain_rows: cached.domains.length,
      })
      return cached
    }

    if (!isDesktopRuntime()) {
      stopTimer({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  const [summary, daily, apps, domains] = await Promise.all([
    getComputerTimeSummary(params),
    getComputerTimeDaily(params),
    getTopApps(params, limit),
    getTopDomains(params, limit),
  ])
  const fallback = {
    summary,
    daily,
    apps,
    domains,
    source: summary.source || 'backend',
    state: 'legacy_fallback',
    sync_pending: false,
  } satisfies AggregatedComputerStatsResponse
  cacheAggregatedResult(cacheKey, params, limit, fallback)
  stopTimer({
    success: true,
    source: fallback.source,
    state: fallback.state,
    summary_active_ms: fallback.summary.total_active_ms,
    daily_rows: fallback.daily.length,
    app_rows: fallback.apps.length,
    domain_rows: fallback.domains.length,
  })
  return fallback
}
