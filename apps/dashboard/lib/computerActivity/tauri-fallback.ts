'use client'

import { isDesktopRuntime } from '@/lib/desktop-capabilities'
import {
  invokeDailySummariesWithInitRetry,
  invokeDetailedActivityWithInitRetry,
} from './tauri-activity'
import { perfWarn } from '@/lib/perf-debug'
import {
  COMPUTER_ACTIVITY_POLICY,
  getLocalTodayDateString,
  getRangeTimestamps,
  shiftDateString,
} from './policy'
import { fetchWatcherStatsJson, normalizeDailyRows } from './backend-read'
import type {
  AggregatedComputerStatsResponse,
  ComputerActivityRangeParams,
  ComputerDailyResponseRow,
  ComputerSummaryResponse,
} from './types'

export async function getDesktopLocalDailyRows(
  params: ComputerActivityRangeParams,
): Promise<ComputerDailyResponseRow[]> {
  return normalizeDailyRows(
    await invokeDailySummariesWithInitRetry(params.startDate, params.endDate),
  ).map((row) => ({ ...row, source: row.source || 'tauri_fallback' }))
}

export async function getDesktopLocalAggregatedStats(
  params: ComputerActivityRangeParams,
  limit: number,
): Promise<AggregatedComputerStatsResponse> {
  const { startTs, endTs } = getRangeTimestamps(params)
  const [dailyResult, detailedResult] = await Promise.allSettled([
    getDesktopLocalDailyRows(params),
    invokeDetailedActivityWithInitRetry({ startTs, endTs, limit }),
  ])

  if (dailyResult.status === 'rejected' && detailedResult.status === 'rejected') {
    throw new Error(
      `desktop local aggregate unavailable: daily=${String(dailyResult.reason)} detailed=${String(detailedResult.reason)}`,
    )
  }

  const dailyRows = dailyResult.status === 'fulfilled' ? dailyResult.value : []
  const detailed = detailedResult.status === 'fulfilled'
    ? detailedResult.value
    : {
        events: [],
        apps: [],
        domains: [],
        total_active_ms: 0,
        total_afk_ms: 0,
      }

  if (dailyResult.status === 'rejected') {
    perfWarn('computer-activity-client', 'aggregate-local-daily-failed', {
      params,
      error: dailyResult.reason instanceof Error ? dailyResult.reason.message : String(dailyResult.reason),
    })
  }
  if (detailedResult.status === 'rejected') {
    perfWarn('computer-activity-client', 'aggregate-local-detailed-failed', {
      params,
      error: detailedResult.reason instanceof Error ? detailedResult.reason.message : String(detailedResult.reason),
    })
  }

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

export async function applyDesktopRecentSummaryCorrection(
  params: ComputerActivityRangeParams,
  summary: ComputerSummaryResponse,
): Promise<ComputerSummaryResponse> {
  if (!isDesktopRuntime()) return summary

  const today = getLocalTodayDateString()
  const correctionStart = shiftDateString(
    today,
    -(COMPUTER_ACTIVITY_POLICY.DESKTOP_SUMMARY_CORRECTION_WINDOW_DAYS - 1),
  )
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
