'use client'

import {
  invokeDailySummariesWithInitRetry,
  invokeDetailedActivityWithInitRetry,
} from './tauri-activity'
import { perfWarn } from '@/lib/perf-debug'
import { getRangeTimestamps } from './policy'
import { normalizeDailyRows } from './backend-read'
import type {
  AggregatedComputerStatsResponse,
  ComputerActivityRangeParams,
  ComputerDailyResponseRow,
} from './types'

export async function getDesktopLocalDailyRows(
  params: ComputerActivityRangeParams,
): Promise<ComputerDailyResponseRow[]> {
  return normalizeDailyRows(
    await invokeDailySummariesWithInitRetry(params.startDate, params.endDate),
  ).map((row) => ({ ...row, source: row.source || 'local' }))
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
      source: 'local',
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
      source: 'local',
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
      source: 'local',
    },
    daily: dailyRows,
    apps,
    domains,
    source: 'local',
    read_source: 'local',
    state: 'local',
    sync_pending: false,
  }
}
