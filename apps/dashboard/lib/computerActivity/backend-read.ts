'use client'

import { isDesktopRuntime } from '@/lib/desktop-capabilities'
import { normalizeComputerDailySummaryRow } from './normalize'
import { perfInfo, startPerfTimer } from '@/lib/perf-debug'
import { getReadConsistencyHeaders } from '@/lib/read-consistency'
import { COMPUTER_ACTIVITY_POLICY, getRangeCacheKey } from './policy'
import type {
  AggregatedComputerStatsResponse,
  ComputerActivityRangeParams,
  ComputerDailyResponseRow,
  ComputerSummaryResponse,
  TopAppResponseRow,
  TopDomainResponseRow,
} from './types'

export const summaryCache = new Map<string, ComputerSummaryResponse>()
export const dailyCache = new Map<string, ComputerDailyResponseRow[]>()
export const appsCache = new Map<string, TopAppResponseRow[]>()
export const domainsCache = new Map<string, TopDomainResponseRow[]>()
export const aggregateCache = new Map<string, AggregatedComputerStatsResponse>()
const inflightWatcherRequests = new Map<string, Promise<any>>()

function buildQueryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  return search.toString()
}

export async function fetchWatcherStatsJson<T>(
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
  const timeoutMs = isDesktopRuntime()
    ? (path.includes('/daily')
      ? COMPUTER_ACTIVITY_POLICY.DESKTOP_DAILY_TIMEOUT_MS
      : COMPUTER_ACTIVITY_POLICY.DESKTOP_STATS_DEFAULT_TIMEOUT_MS)
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

export function normalizeDailyRows(rows: any[]): ComputerDailyResponseRow[] {
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

export function normalizeAggregatedPayload(payload: any): AggregatedComputerStatsResponse {
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

export function cacheAggregatedResult(
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
