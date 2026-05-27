'use client'

import { isTauri } from '@/lib/tauri-utils'
import {
  invokeDailySummariesWithInitRetry,
  invokeDetailedActivityWithInitRetry,
} from './tauri-activity'
import { normalizeComputerDailySummaryRow } from './normalize'
import { perfError, perfInfo, perfWarn, startPerfTimer } from '@/lib/perf-debug'
import { getReadConsistencyHeaders } from '@/lib/read-consistency'

// Product rule:
// - User-facing computer activity analytics should read from backend `/api/watcher/stats/*`
//   first so desktop and web share the same Turso-backed authority.
// - Native Tauri activity queries remain available only as desktop fallback when the backend
//   is unavailable/offline. Do not import native computer activity commands directly from UI
//   components for normal analytics reads.

export interface ComputerActivityRangeParams {
  startDate: string
  endDate: string
}

export interface ComputerSummaryResponse {
  total_active_ms: number
  total_afk_ms: number
  total_hours?: number
  total_events?: number
  days_tracked?: number
  unique_apps?: number
  unique_domains?: number
  avg_daily_hours?: number
  source?: string
}

export interface ComputerDailyResponseRow {
  day: string
  active_hours: number
  active_ms: number
  events_count: number
  apps_count?: number
  domains_count?: number
  source?: string
}

export interface TopAppResponseRow {
  app_bundle_id: string
  app_name: string
  total_active_ms: number
  total_events: number
  hours: number
  source?: string
}

export interface TopDomainResponseRow {
  domain: string
  total_active_ms: number
  total_events: number
  hours: number
  minutes?: number
  source?: string
}

export interface AggregatedComputerStatsResponse {
  summary: ComputerSummaryResponse
  daily: ComputerDailyResponseRow[]
  apps: TopAppResponseRow[]
  domains: TopDomainResponseRow[]
  source?: string
  state?: string
  sync_pending?: boolean
  empty_reason?: string
}

const DESKTOP_STATS_DEFAULT_TIMEOUT_MS = 65000
const DESKTOP_DAILY_TIMEOUT_MS = 65000
const SHORT_RANGE_LOCAL_FALLBACK_MAX_DAYS = 2
const DESKTOP_RECENT_LOCAL_TRUTH_MAX_DAYS = 7
const DESKTOP_SUMMARY_CORRECTION_WINDOW_DAYS = 7
const summaryCache = new Map<string, ComputerSummaryResponse>()
const dailyCache = new Map<string, ComputerDailyResponseRow[]>()
const appsCache = new Map<string, TopAppResponseRow[]>()
const domainsCache = new Map<string, TopDomainResponseRow[]>()
const aggregateCache = new Map<string, AggregatedComputerStatsResponse>()
const inflightWatcherRequests = new Map<string, Promise<any>>()

function buildQueryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  return search.toString()
}

async function fetchWatcherStatsJson<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const queryString = buildQueryString(params)
  const requestKey = `${path}?${queryString}`
  const existing = inflightWatcherRequests.get(requestKey)
  if (existing) {
    perfInfo('computer-activity-client', 'watcher-stats-fetch-dedupe-hit', {
      path,
      params,
    })
    return existing as Promise<T>
  }

  const controller = new AbortController()
  const timeoutMs = isTauri()
    ? (path.includes('/daily') ? DESKTOP_DAILY_TIMEOUT_MS : DESKTOP_STATS_DEFAULT_TIMEOUT_MS)
    : 30000

  const requestPromise = (async () => {
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
    const stopTimer = startPerfTimer('computer-activity-client', 'watcher-stats-fetch', {
      path,
      params,
      timeout_ms: timeoutMs,
    })
    let response: Response

    try {
      response = await fetch(`${path}${queryString ? `?${queryString}` : ''}`, {
        cache: 'no-store',
        credentials: 'include',
        headers: {
          ...getReadConsistencyHeaders(),
        },
        signal: controller.signal,
      })
    } catch (error) {
      stopTimer({
        success: false,
        aborted: controller.signal.aborted,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    } finally {
      window.clearTimeout(timeoutId)
    }

    if (!response.ok) {
      stopTimer({
        success: false,
        status: response.status,
      })
      throw new Error(`${path} failed with status ${response.status}`)
    }

    const payload = await response.json() as T
    stopTimer({
      success: true,
      status: response.status,
      row_count: Array.isArray((payload as any)?.data) ? (payload as any).data.length : undefined,
    })
    return payload
  })()

  inflightWatcherRequests.set(requestKey, requestPromise)
  try {
    return await requestPromise
  } finally {
    inflightWatcherRequests.delete(requestKey)
  }
}

export function clearComputerActivityClientCaches(): void {
  summaryCache.clear()
  dailyCache.clear()
  appsCache.clear()
  domainsCache.clear()
  aggregateCache.clear()
  inflightWatcherRequests.clear()
}

function normalizeDailyRows(rows: any[]): ComputerDailyResponseRow[] {
  return rows
    .map(normalizeComputerDailySummaryRow)
    .filter((row): row is NonNullable<ReturnType<typeof normalizeComputerDailySummaryRow>> => Boolean(row))
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((row) => ({
      day: row.day,
      active_hours: row.active_hours,
      active_ms: row.active_ms,
      events_count: row.events_count,
      apps_count: row.apps_count ?? 0,
      domains_count: row.domain_count ?? 0,
    }))
}

function normalizeSummaryPayload(data: any): ComputerSummaryResponse {
  const totalActiveMs = Math.max(0, Number(data?.total_active_ms || 0))
  return {
    total_active_ms: totalActiveMs,
    total_afk_ms: Math.max(0, Number(data?.total_afk_ms || 0)),
    total_hours: Math.max(0, Number(data?.total_hours || totalActiveMs / (1000 * 60 * 60))),
    total_events: Math.max(0, Number(data?.total_events || 0)),
    days_tracked: Math.max(0, Number(data?.days_tracked || 0)),
    unique_apps: Math.max(0, Number(data?.unique_apps || 0)),
    unique_domains: Math.max(0, Number(data?.unique_domains || 0)),
    avg_daily_hours: Math.max(0, Number(data?.avg_daily_hours || 0)),
    source: data?.source || 'backend',
  }
}

function normalizeTopAppsRows(rows: any[]): TopAppResponseRow[] {
  return rows.map((row) => ({
    app_bundle_id: String(row.app_bundle_id || ''),
    app_name: String(row.app_name || row.app_bundle_id || 'Unknown'),
    total_active_ms: Math.max(0, Number(row.total_active_ms || 0)),
    total_events: Math.max(0, Number(row.total_events || 0)),
    hours: Math.max(0, Number(row.hours || 0)),
    source: row.source || 'backend',
  }))
}

function normalizeTopDomainRows(rows: any[]): TopDomainResponseRow[] {
  return rows.map((row) => ({
    domain: String(row.domain || 'Unknown'),
    total_active_ms: Math.max(0, Number(row.total_active_ms || 0)),
    total_events: Math.max(0, Number(row.total_events || 0)),
    hours: Math.max(0, Number(row.hours || 0)),
    minutes: row.minutes == null ? undefined : Math.max(0, Number(row.minutes || 0)),
    source: row.source || 'backend',
  }))
}

function normalizeAggregatedPayload(payload: any): AggregatedComputerStatsResponse {
  const data = payload?.data || {}
  return {
    summary: normalizeSummaryPayload(data.summary || {}),
    daily: normalizeDailyRows(Array.isArray(data.daily) ? data.daily : []).map((row) => ({
      ...row,
      source: row.source || data.source || data.summary?.source || 'backend',
    })),
    apps: normalizeTopAppsRows(Array.isArray(data.apps) ? data.apps : []),
    domains: normalizeTopDomainRows(Array.isArray(data.domains) ? data.domains : []),
    source: data.source || data.summary?.source || 'backend',
    state: typeof data.state === 'string' ? data.state : undefined,
    sync_pending: Boolean(data.sync_pending),
    empty_reason: typeof data.empty_reason === 'string' ? data.empty_reason : undefined,
  }
}

function cacheAggregatedResult(
  cacheKey: string,
  params: ComputerActivityRangeParams,
  limit: number,
  result: AggregatedComputerStatsResponse,
) {
  aggregateCache.set(cacheKey, result)
  summaryCache.set(getRangeCacheKey('summary', params), result.summary)
  dailyCache.set(getRangeCacheKey('daily', params), result.daily)
  appsCache.set(getRangeCacheKey('apps', params, limit), result.apps)
  domainsCache.set(getRangeCacheKey('domains', params, limit), result.domains)
}

function getRangeTimestamps(params: ComputerActivityRangeParams) {
  const startTs = new Date(`${params.startDate}T00:00:00`).getTime()
  const endTs = new Date(`${params.endDate}T23:59:59.999`).getTime()
  return { startTs, endTs }
}

function getLocalTodayDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function rangeIncludesLocalToday(params: ComputerActivityRangeParams) {
  const today = getLocalTodayDateString()
  return params.startDate <= today && params.endDate >= today
}

function getInclusiveRangeDays(params: ComputerActivityRangeParams) {
  const { startTs, endTs } = getRangeTimestamps(params)
  return Math.max(1, Math.ceil((endTs - startTs + 1) / (1000 * 60 * 60 * 24)))
}

function shouldUseShortRangeNativeFallback(params: ComputerActivityRangeParams) {
  return rangeIncludesLocalToday(params) && getInclusiveRangeDays(params) <= SHORT_RANGE_LOCAL_FALLBACK_MAX_DAYS
}

function shouldPreferRecentDesktopLocalTruth(params: ComputerActivityRangeParams) {
  return isTauri()
    && rangeIncludesLocalToday(params)
    && getInclusiveRangeDays(params) <= DESKTOP_RECENT_LOCAL_TRUTH_MAX_DAYS
}

function shouldAllowDesktopLocalFallback(params: ComputerActivityRangeParams) {
  if (!isTauri()) return true
  return rangeIncludesLocalToday(params)
    && getInclusiveRangeDays(params) <= DESKTOP_RECENT_LOCAL_TRUTH_MAX_DAYS
}

function shouldAllowDesktopAggregateLocalFallback(_params: ComputerActivityRangeParams) {
  return isTauri()
}

function shiftDateString(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function getDesktopLocalDailyRows(
  params: ComputerActivityRangeParams,
): Promise<ComputerDailyResponseRow[]> {
  return normalizeDailyRows(
    await invokeDailySummariesWithInitRetry(params.startDate, params.endDate),
  ).map((row) => ({ ...row, source: row.source || 'tauri_fallback' }))
}

async function getDesktopLocalAggregatedStats(
  params: ComputerActivityRangeParams,
  limit: number,
): Promise<AggregatedComputerStatsResponse> {
  const { startTs, endTs } = getRangeTimestamps(params)
  const [dailyRows, detailed] = await Promise.all([
    getDesktopLocalDailyRows(params),
    invokeDetailedActivityWithInitRetry({ startTs, endTs, limit }),
  ])

  const totalActiveMs = Math.max(
    0,
    Number(detailed.total_active_ms || 0)
      || dailyRows.reduce((sum, row) => sum + Math.max(0, Number(row.active_ms || 0)), 0),
  )
  const totalAfkMs = Math.max(0, Number(detailed.total_afk_ms || 0))
  const daysTracked = dailyRows.filter((row) => Math.max(0, Number(row.active_ms || 0)) > 0).length
  const totalEvents = dailyRows.reduce((sum, row) => sum + Math.max(0, Number(row.events_count || 0)), 0)
  const apps = detailed.apps
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
  const domains = detailed.domains
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

  return {
    summary: {
      total_active_ms: totalActiveMs,
      total_afk_ms: totalAfkMs,
      total_hours: totalActiveMs / (1000 * 60 * 60),
      total_events: totalEvents,
      days_tracked: daysTracked,
      unique_apps: apps.length,
      unique_domains: domains.length,
      avg_daily_hours: daysTracked > 0 ? totalActiveMs / (1000 * 60 * 60) / daysTracked : 0,
      source: 'tauri_fallback',
    },
    daily: dailyRows,
    apps,
    domains,
    source: 'tauri_fallback',
    state: 'tauri_fallback',
    sync_pending: false,
  }
}

function buildSummaryFromDailyRows(
  rows: ComputerDailyResponseRow[],
  source: string,
): ComputerSummaryResponse {
  const totalActiveMs = rows.reduce((sum, row) => sum + Math.max(0, Number(row.active_ms || 0)), 0)
  const totalEvents = rows.reduce((sum, row) => sum + Math.max(0, Number(row.events_count || 0)), 0)
  const daysTracked = rows.filter((row) => Math.max(0, Number(row.active_ms || 0)) > 0).length

  return {
    total_active_ms: totalActiveMs,
    total_afk_ms: 0,
    total_hours: totalActiveMs / (1000 * 60 * 60),
    total_events: totalEvents,
    days_tracked: daysTracked,
    unique_apps: 0,
    unique_domains: 0,
    avg_daily_hours: daysTracked > 0 ? totalActiveMs / (1000 * 60 * 60) / daysTracked : 0,
    source,
  }
}

async function applyDesktopRecentSummaryCorrection(
  params: ComputerActivityRangeParams,
  summary: ComputerSummaryResponse,
): Promise<ComputerSummaryResponse> {
  if (!isTauri()) return summary

  const today = getLocalTodayDateString()
  const correctionStart = shiftDateString(today, -(DESKTOP_SUMMARY_CORRECTION_WINDOW_DAYS - 1))
  const overlapStart = params.startDate > correctionStart ? params.startDate : correctionStart
  const overlapEnd = params.endDate < today ? params.endDate : today

  if (overlapStart > overlapEnd) {
    return summary
  }

  const correctionParams = { startDate: overlapStart, endDate: overlapEnd }
  const [backendDailyPayload, localDailyRows] = await Promise.all([
    fetchWatcherStatsJson<{ data?: any[] }>('/api/watcher/stats/daily', {
      start_date: overlapStart,
      end_date: overlapEnd,
    }),
    getDesktopLocalDailyRows(correctionParams),
  ])

  const backendRows = normalizeDailyRows(Array.isArray(backendDailyPayload?.data) ? backendDailyPayload.data : [])
  const backendByDay = new Map(backendRows.map((row) => [row.day, row]))
  const localByDay = new Map(localDailyRows.map((row) => [row.day, row]))
  const allDays = Array.from(new Set([...backendByDay.keys(), ...localByDay.keys()]))

  let correctionMs = 0
  let backendPositiveDays = 0
  let localPositiveDays = 0

  for (const day of allDays) {
    const backendMs = Math.max(0, Number(backendByDay.get(day)?.active_ms || 0))
    const localMs = Math.max(0, Number(localByDay.get(day)?.active_ms || 0))
    correctionMs += localMs - backendMs
    if (backendMs > 0) backendPositiveDays += 1
    if (localMs > 0) localPositiveDays += 1
  }

  if (correctionMs === 0 && backendPositiveDays === localPositiveDays) {
    return summary
  }

  const correctedActiveMs = Math.max(0, Math.round(summary.total_active_ms + correctionMs))
  return {
    ...summary,
    total_active_ms: correctedActiveMs,
    total_hours: correctedActiveMs / (1000 * 60 * 60),
    days_tracked: Math.max(
      0,
      Math.max(0, Number(summary.days_tracked || 0)) + (localPositiveDays - backendPositiveDays),
    ),
    source: 'backend_plus_recent_tauri',
  }
}

function shouldSupplementTodayFromLocal(
  params: ComputerActivityRangeParams,
  backendRows: ComputerDailyResponseRow[],
) {
  if (!isTauri()) return false
  if (!rangeIncludesLocalToday(params)) return false

  const today = getLocalTodayDateString()
  const todayRow = backendRows.find((row) => row.day === today)
  return !todayRow || Number(todayRow.active_ms || 0) <= 0
}

function mergeTodayRow(
  backendRows: ComputerDailyResponseRow[],
  localRows: ComputerDailyResponseRow[],
): ComputerDailyResponseRow[] {
  const today = getLocalTodayDateString()
  const localToday = localRows.find((row) => row.day === today && Number(row.active_ms || 0) > 0)
  if (!localToday) {
    return backendRows
  }

  const rowsWithoutToday = backendRows.filter((row) => row.day !== today)
  return [...rowsWithoutToday, { ...localToday, source: localToday.source || 'tauri_fallback' }]
    .sort((a, b) => a.day.localeCompare(b.day))
}

function getRangeCacheKey(
  prefix: string,
  params: ComputerActivityRangeParams,
  limit?: number,
) {
  return `${prefix}:${params.startDate}:${params.endDate}:${limit ?? 'na'}`
}

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

    if (backendRows.length === 0 && isTauri()) {
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
    if (!isTauri()) {
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

    if (normalizedRows.length > 0 || !isTauri()) {
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
    if (!isTauri()) {
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

    if (normalizedRows.length > 0 || !isTauri()) {
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
    if (!isTauri()) {
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

    if (!isTauri()) {
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
    if (!isTauri()) {
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

  try {
    const payload = await fetchWatcherStatsJson<{ data?: any }>(
      '/api/watcher/stats/aggregate',
      {
        start_date: params.startDate,
        end_date: params.endDate,
        limit,
      },
    )
    const result = normalizeAggregatedPayload(payload)
    cacheAggregatedResult(cacheKey, params, limit, result)

    const hasAnyData =
      result.summary.total_active_ms > 0
      || result.daily.length > 0
      || result.apps.length > 0
      || result.domains.length > 0

    if (hasAnyData || !isTauri() || !shouldAllowDesktopAggregateLocalFallback(params)) {
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

    if (!isTauri()) {
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
