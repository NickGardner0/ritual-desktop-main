import { isTauri } from '@/lib/native-gateway'
import type {
  AggregatedComputerStatsResponse,
  ComputerActivityRangeParams,
  ComputerActivityReadSource,
  ComputerDailyResponseRow,
  ComputerSummaryResponse,
} from './types'

export const COMPUTER_ACTIVITY_POLICY = {
  DESKTOP_STATS_DEFAULT_TIMEOUT_MS: 65000,
  DESKTOP_DAILY_TIMEOUT_MS: 65000,
  DESKTOP_RECENT_LOCAL_TRUTH_MAX_DAYS: 7,
  DESKTOP_LOCAL_FALLBACK_MAX_DAYS: 45,
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

export function shouldPreferRecentDesktopLocalTruth(params: ComputerActivityRangeParams) {
  return isTauri()
    && rangeIncludesLocalToday(params)
    && getInclusiveRangeDays(params) <= COMPUTER_ACTIVITY_POLICY.DESKTOP_RECENT_LOCAL_TRUTH_MAX_DAYS
}

export function shouldReadDesktopAggregateLocalFirst(params: ComputerActivityRangeParams) {
  return shouldPreferRecentDesktopLocalTruth(params)
}

export function shouldAllowDesktopLocalFallback(params: ComputerActivityRangeParams) {
  if (!isTauri()) return false
  return rangeIncludesLocalToday(params)
    && getInclusiveRangeDays(params) <= COMPUTER_ACTIVITY_POLICY.DESKTOP_LOCAL_FALLBACK_MAX_DAYS
}

export function shouldAllowDesktopAggregateLocalFallback(params: ComputerActivityRangeParams) {
  return shouldAllowDesktopLocalFallback(params)
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

export function stampReadSource(
  result: AggregatedComputerStatsResponse,
  readSource: ComputerActivityReadSource,
): AggregatedComputerStatsResponse {
  return {
    ...result,
    source: readSource,
    read_source: readSource,
    state: readSource,
    summary: {
      ...result.summary,
      source: readSource,
    },
    daily: result.daily.map((row) => ({
      ...row,
      source: readSource,
    })),
    apps: result.apps.map((row) => ({
      ...row,
      source: readSource,
    })),
    domains: result.domains.map((row) => ({
      ...row,
      source: readSource,
    })),
  }
}

export function asDesktopLocalTruth(result: AggregatedComputerStatsResponse): AggregatedComputerStatsResponse {
  return stampReadSource({ ...result, sync_pending: false }, 'local')
}

export function unavailableComputerStats(): AggregatedComputerStatsResponse {
  return stampReadSource({
    summary: {
      total_active_ms: 0,
      total_afk_ms: 0,
      total_hours: 0,
      total_events: 0,
      days_tracked: 0,
      unique_apps: 0,
      unique_domains: 0,
      avg_daily_hours: 0,
      source: 'unavailable',
    },
    daily: [],
    apps: [],
    domains: [],
    sync_pending: false,
  }, 'unavailable')
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

export function getRangeCacheKey(
  prefix: string,
  params: ComputerActivityRangeParams,
  limit?: number,
) {
  return `${prefix}:${params.startDate}:${params.endDate}:${limit ?? 'na'}`
}
