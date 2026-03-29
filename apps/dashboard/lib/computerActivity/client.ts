'use client'

import { isTauri } from '@/lib/tauri-utils'
import {
  invokeDailySummariesWithInitRetry,
  invokeDetailedActivityWithInitRetry,
} from './tauri-activity'
import { normalizeComputerDailySummaryRow } from './normalize'

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
}

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
  const response = await fetch(`${path}${queryString ? `?${queryString}` : ''}`, {
    cache: 'no-store',
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`${path} failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
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

export async function getComputerTimeDaily(
  params: ComputerActivityRangeParams,
): Promise<ComputerDailyResponseRow[]> {
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

    if (!shouldSupplementTodayFromLocal(params, backendRows)) {
      return backendRows
    }

    const localRows = normalizeDailyRows(
      await invokeDailySummariesWithInitRetry(params.startDate, params.endDate),
    ).map((row) => ({ ...row, source: row.source || 'tauri_fallback' }))

    return mergeTodayRow(backendRows, localRows)
  } catch (error) {
    if (!isTauri()) {
      throw error
    }
  }

  const summaries = await invokeDailySummariesWithInitRetry(params.startDate, params.endDate)
  return normalizeDailyRows(summaries)
}

export async function getTopApps(
  params: ComputerActivityRangeParams,
  limit: number,
): Promise<TopAppResponseRow[]> {
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

    if (normalizedRows.length > 0 || !isTauri() || !rangeIncludesLocalToday(params)) {
      return normalizedRows
    }
  } catch (error) {
    if (!isTauri()) {
      throw error
    }
  }

  const { startTs, endTs } = getRangeTimestamps(params)
  const detailed = await invokeDetailedActivityWithInitRetry({ startTs, endTs, limit: 1 })
  return detailed.apps.slice(0, limit).map((row) => ({
    app_bundle_id: row.app_bundle_id,
    app_name: row.app_name || row.app_bundle_id || 'Unknown',
    total_active_ms: Math.max(0, Number(row.total_duration_ms || 0)),
    total_events: Math.max(0, Number(row.event_count || 0)),
    hours: Math.max(0, Number(row.total_duration_ms || 0) / (1000 * 60 * 60)),
    source: 'tauri_fallback',
  }))
}

export async function getTopDomains(
  params: ComputerActivityRangeParams,
  limit: number,
): Promise<TopDomainResponseRow[]> {
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

    if (normalizedRows.length > 0 || !isTauri() || !rangeIncludesLocalToday(params)) {
      return normalizedRows
    }
  } catch (error) {
    if (!isTauri()) {
      throw error
    }
  }

  const { startTs, endTs } = getRangeTimestamps(params)
  const detailed = await invokeDetailedActivityWithInitRetry({ startTs, endTs, limit: 1 })
  return detailed.domains.slice(0, limit).map((row) => ({
    domain: row.domain || 'Unknown',
    total_active_ms: Math.max(0, Number(row.total_duration_ms || 0)),
    total_events: Math.max(0, Number(row.event_count || 0)),
    hours: Math.max(0, Number(row.total_duration_ms || 0) / (1000 * 60 * 60)),
    minutes: Math.max(0, Number(row.total_duration_ms || 0) / (1000 * 60)),
    source: 'tauri_fallback',
  }))
}

export async function getComputerTimeSummary(
  params: ComputerActivityRangeParams,
): Promise<ComputerSummaryResponse> {
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

    if (!isTauri() || !rangeIncludesLocalToday(params)) {
      return summary
    }

    const mergedDaily = await getComputerTimeDaily(params)
    const mergedTotalActiveMs = mergedDaily.reduce((sum, row) => sum + Math.max(0, Number(row.active_ms || 0)), 0)
    if (mergedTotalActiveMs <= totalActiveMs) {
      return summary
    }

    const mergedTotalEvents = mergedDaily.reduce((sum, row) => sum + Math.max(0, Number(row.events_count || 0)), 0)
    const mergedDaysTracked = mergedDaily.filter((row) => Math.max(0, Number(row.active_ms || 0)) > 0).length

    return {
      ...summary,
      total_active_ms: mergedTotalActiveMs,
      total_hours: mergedTotalActiveMs / (1000 * 60 * 60),
      total_events: Math.max(summary.total_events || 0, mergedTotalEvents),
      days_tracked: Math.max(summary.days_tracked || 0, mergedDaysTracked),
      avg_daily_hours: mergedDaysTracked > 0 ? mergedTotalActiveMs / (1000 * 60 * 60) / mergedDaysTracked : 0,
      source: 'backend_plus_live_today',
    }
  } catch (error) {
    if (!isTauri()) {
      throw error
    }
  }

  const { startTs, endTs } = getRangeTimestamps(params)
  const detailed = await invokeDetailedActivityWithInitRetry({ startTs, endTs, limit: 1 })
  const totalActiveMs = Math.max(0, Number(detailed.total_active_ms || 0))
  const totalAfkMs = Math.max(0, Number(detailed.total_afk_ms || 0))
  const daily = await getComputerTimeDaily(params)
  return {
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
}

export async function getAggregatedComputerStats(
  params: ComputerActivityRangeParams,
  limit = 10,
): Promise<AggregatedComputerStatsResponse> {
  const [summary, daily, apps, domains] = await Promise.all([
    getComputerTimeSummary(params),
    getComputerTimeDaily(params),
    getTopApps(params, limit),
    getTopDomains(params, limit),
  ])

  return { summary, daily, apps, domains }
}
