'use client'

import { invokeDesktopCommand, buildDesktopCommandOrigin } from '@/lib/native-gateway'

export interface TauriDetailedActivityEvent {
  id: number
  ts_start: number
  ts_end: number
  duration_ms: number
  app_bundle_id: string
  app_name: string
  window_title?: string | null
  browser_url?: string | null
  browser_domain?: string | null
  is_afk: boolean
  is_incognito: boolean
}

export interface TauriDetailedActivityResponse {
  events: TauriDetailedActivityEvent[]
  apps: { app_bundle_id: string; app_name: string; total_duration_ms: number; event_count: number }[]
  domains: { domain: string; total_duration_ms: number; event_count: number }[]
  total_active_ms: number
  total_afk_ms: number
}

export interface TauriDailySummaryRow {
  date: string
  total_active_ms: number
  total_hours: number
  event_count: number
  app_count?: number
  domain_count?: number
}

export function isDbNotInitializedError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? '').toLowerCase()
  return (
    message.includes('database not initialized') &&
    message.includes('initialize_database')
  )
}

export async function invokeDetailedActivityWithInitRetry(params: {
  startTs: number
  endTs: number
  limit?: number
}): Promise<TauriDetailedActivityResponse> {
  const camelParams = params
  const detailedActivityOrigin = buildDesktopCommandOrigin('tauri-activity:get_detailed_activity')

  try {
    return await invokeDesktopCommand<TauriDetailedActivityResponse>('get_detailed_activity', {
      ...camelParams,
      origin: detailedActivityOrigin,
    })
  } catch (error) {
    if (isDbNotInitializedError(error)) {
      await invokeDesktopCommand<string>('init_ritual_database', {
        origin: buildDesktopCommandOrigin('tauri-activity:init_ritual_database:detailed'),
      })
      return await invokeDesktopCommand<TauriDetailedActivityResponse>('get_detailed_activity', {
        ...camelParams,
        origin: detailedActivityOrigin,
      })
    }
    throw error
  }
}

export async function invokeDailySummariesWithInitRetry(
  startDate: string,
  endDate: string,
): Promise<TauriDailySummaryRow[]> {
  const camelParams = { startDate, endDate }
  const dailySummariesOrigin = buildDesktopCommandOrigin('tauri-activity:get_daily_summaries')

  try {
    return await invokeDesktopCommand<TauriDailySummaryRow[]>('get_daily_summaries', {
      ...camelParams,
      origin: dailySummariesOrigin,
    })
  } catch (error) {
    if (isDbNotInitializedError(error)) {
      await invokeDesktopCommand<string>('init_ritual_database', {
        origin: buildDesktopCommandOrigin('tauri-activity:init_ritual_database:daily-summaries'),
      })
      return await invokeDesktopCommand<TauriDailySummaryRow[]>('get_daily_summaries', {
        ...camelParams,
        origin: dailySummariesOrigin,
      })
    }
    throw error
  }
}
