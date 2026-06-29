import { isTauri } from '@/lib/tauri-utils'
import type {
  AggregatedComputerStatsResponse,
  ComputerActivityRangeParams,
  ComputerDailyResponseRow,
  ComputerSummaryResponse,
} from './types'

export const COMPUTER_ACTIVITY_POLICY = {
  DESKTOP_STATS_DEFAULT_TIMEOUT_MS: 65000,
  DESKTOP_DAILY_TIMEOUT_MS: 65000,
  SHORT_RANGE_LOCAL_FALLBACK_MAX_DAYS: 2,
  DESKTOP_RECENT_LOCAL_TRUTH_MAX_DAYS: 7,
  DESKTOP_LOCAL_FALLBACK_MAX_DAYS: 45,
  DESKTOP_SUMMARY_CORRECTION_WINDOW_DAYS: 7,
  DESKTOP_LOCAL_TRUTH_MIN_DELTA_MS: 5 * 60 * 1000,
} as const

export function getRangeTimestamps(params: ComputerActivityRangeParams) {
  const startTs = new Date(`${params.startDate}T00:00:00`).getTime()
  const endTs = new Date(`${params.endDate}T23:59:59.999`).getTime()
  return { startTs, endTs }
}

export function getLocalTodayDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function rangeIncludesLocalToday(params: ComputerActivityRangeParams) {
  const today = getLocalTodayDateString()
  return params.startDate <= today && params.endDate >= today
}

export function getInclusiveRangeDays(params: ComputerActivityRangeParams) {
  const { startTs, endTs } = getRangeTimestamps(params)
  return Math.max(1, Math.ceil((endTs - startTs + 1) / (1000 * 60 * 60 * 24)))
}

export function shouldUseShortRangeNativeFallback(params: ComputerActivityRangeParams) {
  return rangeIncludesLocalToday(params)
    && getInclusiveRangeDays(params) <= COMPUTER_ACTIVITY_POLICY.SHORT_RANGE_LOCAL_FALLBACK_MAX_DAYS
}

export function shouldPreferRecentDesktopLocalTruth(params: ComputerActivityRangeParams) {
  return isTauri()
    && rangeIncludesLocalToday(params)
    && getInclusiveRangeDays(params) <= COMPUTER_ACTIVITY_POLICY.DESKTOP_RECENT_LOCAL_TRUTH_MAX_DAYS
}

export function shouldReadDesktopAggregateLocalFirst(params: ComputerActivityRangeParams) {
  return shouldPreferRecentDesktopLocalTruth(params)
}

export function shouldAllowDesktopLocalFallback(params: ComputerActivityRangeParams) {
  if (!isTauri()) return true
  return rangeIncludesLocalToday(params)
    && getInclusiveRangeDays(params) <= COMPUTER_ACTIVITY_POLICY.DESKTOP_LOCAL_FALLBACK_MAX_DAYS
}

export function shouldAllowDesktopAggregateLocalFallback(_params: ComputerActivityRangeParams) {
  return isTauri()
}

export function shiftDateString(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function aggregateHasAnyData(result: AggregatedComputerStatsResponse) {
  return result.summary.total_active_ms > 0
    || result.daily.length > 0
    || result.apps.length > 0
    || result.domains.length > 0
}

export function preferDesktopLocalAggregate(
  backendResult: AggregatedComputerStatsResponse,
  localResult: AggregatedComputerStatsResponse,
) {
  const localMs = Math.max(0, Number(localResult.summary.total_active_ms || 0))
  const backendMs = Math.max(0, Number(backendResult.summary.total_active_ms || 0))
  if (localMs <= 0) return false

  return localMs > backendMs + COMPUTER_ACTIVITY_POLICY.DESKTOP_LOCAL_TRUTH_MIN_DELTA_MS
}

export function asDesktopLocalTruth(result: AggregatedComputerStatsResponse): AggregatedComputerStatsResponse {
  return {
    ...result,
    source: 'tauri_local_truth',
    state: 'desktop_local_truth',
    summary: {
      ...result.summary,
      source: 'tauri_local_truth',
    },
    daily: result.daily.map((row) => ({
      ...row,
      source: row.source || 'tauri_local_truth',
    })),
    apps: result.apps.map((row) => ({
      ...row,
      source: row.source || 'tauri_local_truth',
    })),
    domains: result.domains.map((row) => ({
      ...row,
      source: row.source || 'tauri_local_truth',
    })),
    sync_pending: false,
  }
}

export function buildSummaryFromDailyRows(
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

export function shouldSupplementTodayFromLocal(
  params: ComputerActivityRangeParams,
  backendRows: ComputerDailyResponseRow[],
) {
  if (!isTauri()) return false
  if (!rangeIncludesLocalToday(params)) return false

  const today = getLocalTodayDateString()
  const todayRow = backendRows.find((row) => row.day === today)
  return !todayRow || Number(todayRow.active_ms || 0) <= 0
}

export function mergeTodayRow(
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

export function getRangeCacheKey(
  prefix: string,
  params: ComputerActivityRangeParams,
  limit?: number,
) {
  return `${prefix}:${params.startDate}:${params.endDate}:${limit ?? 'na'}`
}
