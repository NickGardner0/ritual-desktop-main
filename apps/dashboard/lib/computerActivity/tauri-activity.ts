'use client'

import { invoke } from '@tauri-apps/api/core'
import { buildDesktopCommandOrigin } from '@/lib/desktop-runtime'

const LOCAL_BRIDGE_BASE = 'http://127.0.0.1:3031'

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

function hasTauriIpcBridge(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as Window & { __TAURI__?: unknown; __TAURI_IPC__?: unknown }
  return Boolean(w.__TAURI__) || typeof w.__TAURI_IPC__ === 'function'
}

function isDesktopUserAgent(): boolean {
  return typeof navigator !== 'undefined' && (navigator.userAgent || '').includes('RitualDesktop/')
}

async function fetchLocalBridgeJson<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    search.set(key, String(value))
  }

  const response = await fetch(`${LOCAL_BRIDGE_BASE}${path}?${search.toString()}`, {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Local bridge request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export async function invokeDetailedActivityWithInitRetry(params: {
  startTs: number
  endTs: number
  limit?: number
}): Promise<TauriDetailedActivityResponse> {
  if (isDesktopUserAgent() && !hasTauriIpcBridge()) {
    try {
      return await fetchLocalBridgeJson<TauriDetailedActivityResponse>('/v1/activity/detailed', {
        start_ts: params.startTs,
        end_ts: params.endTs,
        limit: params.limit,
      })
    } catch (bridgeError) {
      console.warn(
        '[tauri-activity] Local detailed bridge failed, falling back to Tauri invoke',
        bridgeError,
        { hasIpcBridge: hasTauriIpcBridge() },
      )
    }
  }

  const camelParams = params
  const snakeParams = {
    start_ts: params.startTs,
    end_ts: params.endTs,
    limit: params.limit,
  }
  const detailedActivityOrigin = buildDesktopCommandOrigin('tauri-activity:get_detailed_activity')

  try {
    return await invoke<TauriDetailedActivityResponse>('get_detailed_activity', {
      ...camelParams,
      origin: detailedActivityOrigin,
    })
  } catch (error) {
    if (isDbNotInitializedError(error)) {
      await invoke<string>('init_ritual_database', {
        origin: buildDesktopCommandOrigin('tauri-activity:init_ritual_database:detailed'),
      })
      try {
        return await invoke<TauriDetailedActivityResponse>('get_detailed_activity', {
          ...camelParams,
          origin: detailedActivityOrigin,
        })
      } catch (retryError) {
        if (!isDbNotInitializedError(retryError)) {
          throw retryError
        }
      }
    }

    try {
      return await invoke<TauriDetailedActivityResponse>('get_detailed_activity', {
        ...snakeParams,
        origin: detailedActivityOrigin,
      })
    } catch (snakeError) {
      throw snakeError
    }
  }
}

export async function invokeDailySummariesWithInitRetry(
  startDate: string,
  endDate: string,
): Promise<TauriDailySummaryRow[]> {
  if (isDesktopUserAgent() && !hasTauriIpcBridge()) {
    try {
      return await fetchLocalBridgeJson<TauriDailySummaryRow[]>('/v1/activity/daily-summaries', {
        start_date: startDate,
        end_date: endDate,
      })
    } catch (bridgeError) {
      console.warn(
        '[tauri-activity] Local daily-summaries bridge failed, falling back to Tauri invoke',
        bridgeError,
        { hasIpcBridge: hasTauriIpcBridge() },
      )
    }
  }

  const camelParams = { startDate, endDate }
  const snakeParams = { start_date: startDate, end_date: endDate }
  const dailySummariesOrigin = buildDesktopCommandOrigin('tauri-activity:get_daily_summaries')

  try {
    return await invoke<TauriDailySummaryRow[]>('get_daily_summaries', {
      ...camelParams,
      origin: dailySummariesOrigin,
    })
  } catch (error) {
    if (isDbNotInitializedError(error)) {
      await invoke<string>('init_ritual_database', {
        origin: buildDesktopCommandOrigin('tauri-activity:init_ritual_database:daily-summaries'),
      })
      try {
        return await invoke<TauriDailySummaryRow[]>('get_daily_summaries', {
          ...camelParams,
          origin: dailySummariesOrigin,
        })
      } catch (retryError) {
        if (!isDbNotInitializedError(retryError)) {
          throw retryError
        }
      }
    }

    try {
      return await invoke<TauriDailySummaryRow[]>('get_daily_summaries', {
        ...snakeParams,
        origin: dailySummariesOrigin,
      })
    } catch (snakeError) {
      throw snakeError
    }
  }
}
