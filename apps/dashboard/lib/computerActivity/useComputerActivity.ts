/**
 * useComputerActivity Hook
 *
 * Desktop raw events come from local activity.db via Tauri IPC.
 * Web reads the hosted watcher API. Desktop never silently falls through
 * to cloud HTTP when local IPC fails.
 */

'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isDesktopRuntime } from '@/lib/desktop-capabilities'
import {
  ActivityBreakdownSource,
  ActivityBreakdownViewModel,
  ActivityEvent,
  ComputerActivityReadSource,
  TimeRangePreset,
} from '@/lib/computerActivity/contracts'
import {
  calculateUniqueActiveTime,
  topApps,
  topDomains,
  startOfDayLocal,
  endOfDayLocal,
  deduplicateEvents,
} from './derive'
import {
  invokeDetailedActivityWithInitRetry,
} from './tauri-activity'
import { getAggregatedComputerStats } from './api'
import { QUERY_POLICY } from '@/lib/query-policies'
import { getReadConsistencyHeaders } from '@/lib/read-consistency'

// ============================================================
// Time range helpers
// ============================================================

function getTimeRangeMs(preset: TimeRangePreset): { start: number; end: number } {
  const now = Date.now()
  const endOfToday = endOfDayLocal(now)
  
  switch (preset) {
    case '6H':
      return { start: now - 6 * 60 * 60 * 1000, end: now }
    case '12H':
      return { start: now - 12 * 60 * 60 * 1000, end: now }
    case '1D':
      return { start: now - 24 * 60 * 60 * 1000, end: now }
    case '7D':
      return { start: startOfDayLocal(now - 6 * 24 * 60 * 60 * 1000), end: endOfToday }
    case '30D':
      return { start: startOfDayLocal(now - 29 * 24 * 60 * 60 * 1000), end: endOfToday }
    case '90D':
      return { start: startOfDayLocal(now - 89 * 24 * 60 * 60 * 1000), end: endOfToday }
    case 'ALL':
      // Default to 365 days for ALL
      return { start: startOfDayLocal(now - 364 * 24 * 60 * 60 * 1000), end: endOfToday }
    default:
      return { start: startOfDayLocal(now), end: endOfToday }
  }
}

function toLocalDateString(ts: number): string {
  const date = new Date(ts)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface AggregatedComputerStats {
  summary: any
  daily: any[]
  apps: any[]
  domains: any[]
  source?: string
  read_source?: ComputerActivityReadSource
}

async function fetchScreenTimeAggregatedStats(startTs: number, endTs: number): Promise<AggregatedComputerStats | null> {
  try {
    const startDate = toLocalDateString(startTs)
    const endDate = toLocalDateString(endTs)

    const [summaryRes, appsRes, domainsRes] = await Promise.all([
      fetch(`/api/screen-time/stats/summary?start_date=${startDate}&end_date=${endDate}`, {
        cache: 'no-store',
        headers: {
          ...getReadConsistencyHeaders(),
        },
      }),
      fetch(`/api/screen-time/stats/top-apps?start_date=${startDate}&end_date=${endDate}&limit=10`, {
        headers: {
          ...getReadConsistencyHeaders(),
        },
      }),
      fetch(`/api/screen-time/stats/top-domains?start_date=${startDate}&end_date=${endDate}&limit=10`, {
        headers: {
          ...getReadConsistencyHeaders(),
        },
      }),
    ])

    if (!summaryRes.ok || !appsRes.ok || !domainsRes.ok) {
      return null
    }

    const [summaryPayload, appsPayload, domainsPayload] = await Promise.all([
      summaryRes.json(),
      appsRes.json(),
      domainsRes.json(),
    ])

    const summary = summaryPayload?.data || {}

    return {
      summary,
      daily: Array.isArray(summary.daily) ? summary.daily : [],
      apps: appsPayload?.data || [],
      domains: domainsPayload?.data || [],
    }
  } catch (error) {
    console.error('Failed to fetch aggregated screen time stats:', error)
    return null
  }
}

async function fetchAggregatedStats(startTs: number, endTs: number): Promise<AggregatedComputerStats | null> {
  try {
    const startDate = toLocalDateString(startTs)
    const endDate = toLocalDateString(endTs)
    return await getAggregatedComputerStats({ startDate, endDate }, 10)
  } catch (error) {
    console.error('Failed to fetch aggregated computer stats:', error)
    return null
  }
}

export const computerActivityKeys = {
  all: ['computer-activity'] as const,
  aggregated: (source: ActivityBreakdownSource, rangeKey: string) =>
    [...computerActivityKeys.all, 'aggregated', source, rangeKey] as const,
  events: (
    source: ActivityBreakdownSource,
    rangeKey: string,
    limit: number,
    skipEventFetch: boolean,
  ) => [...computerActivityKeys.all, 'events', source, rangeKey, limit, skipEventFetch ? 'skip' : 'full'] as const,
}

async function fetchActivityEvents(
  startTs: number,
  endTs: number,
  limit?: number,
): Promise<{ events: ActivityEvent[]; readSource: ComputerActivityReadSource }> {
  try {
    if (isDesktopRuntime()) {
      try {
        const response = await invokeDetailedActivityWithInitRetry({
          startTs,
          endTs,
          limit,
        })
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[useComputerActivity] local activity.db: ${response.events.length} events`)
        }

        return {
          readSource: 'local',
          events: response.events.map((e) => ({
            id: e.id,
            ts_start: e.ts_start,
            ts_end: e.ts_end,
            duration_ms: e.duration_ms,
            app_bundle_id: e.app_bundle_id,
            app_name: e.app_name,
            window_title: e.window_title,
            browser_url: e.browser_url,
            browser_domain: e.browser_domain,
            is_afk: e.is_afk,
            is_incognito: e.is_incognito,
          })),
        }
      } catch (tauriError) {
        console.error('[useComputerActivity] activity.db unavailable:', tauriError)
        return { events: [], readSource: 'unavailable' }
      }
    }

    const params = new URLSearchParams({
      start_ts: startTs.toString(),
      end_ts: endTs.toString(),
    })

    const response = await fetch(`/api/watcher/activity?${params}`)
    if (!response.ok) {
      return { events: [], readSource: 'unavailable' }
    }

    const data = await response.json()
    return { events: data.events || [], readSource: 'synced' }
  } catch (error) {
    console.error('Failed to fetch activity events:', error)
    return { events: [], readSource: 'unavailable' }
  }
}

// ============================================================
// Main Hook
// ============================================================

export interface UseComputerActivityOptions {
  initialRange?: TimeRangePreset
  source?: ActivityBreakdownSource
  autoRefresh?: boolean
  refreshIntervalMs?: number
  skipEventFetch?: boolean
}

export interface UseComputerActivityReturn {
  viewModel: ActivityBreakdownViewModel
  range: TimeRangePreset
  setRange: (range: TimeRangePreset) => void
  refresh: () => void
}

export function useComputerActivity(
  options: UseComputerActivityOptions = {}
): UseComputerActivityReturn {
  const {
    initialRange = '1D',
    source = 'desktop',
    autoRefresh = false,
    refreshIntervalMs = 60000,
    skipEventFetch = false,
  } = options
  const queryClient = useQueryClient()
  const [range, setRange] = useState<TimeRangePreset>(initialRange)

  // Computed time range
  const timeRange = useMemo(() => getTimeRangeMs(range), [range])
  const rangeKey = useMemo(
    () => `${source}:${range}:${Math.floor(timeRange.start / 60000)}:${Math.floor(timeRange.end / 60000)}`,
    [range, source, timeRange.end, timeRange.start],
  )
  const eventLimitByRange: Record<TimeRangePreset, number> = {
    '6H': 2000,
    '12H': 4000,
    '1D': 8000,
    '7D': 20000,
    '30D': 60000,
    '90D': 120000,
    'ALL': 200000,
  }
  const eventLimit = eventLimitByRange[range]

  const aggregatedQuery = useQuery({
    queryKey: computerActivityKeys.aggregated(source, rangeKey),
    queryFn: () => (
      source === 'desktop'
        ? fetchAggregatedStats(timeRange.start, timeRange.end)
        : fetchScreenTimeAggregatedStats(timeRange.start, timeRange.end)
    ),
    placeholderData: (previous) => previous ?? null,
    staleTime: QUERY_POLICY.computerSnapshot.staleTime,
    gcTime: QUERY_POLICY.computerSnapshot.gcTime,
    refetchOnWindowFocus: false,
    refetchInterval: autoRefresh ? refreshIntervalMs : false,
    refetchIntervalInBackground: autoRefresh,
  })

  const eventsQuery = useQuery({
    queryKey: computerActivityKeys.events(source, rangeKey, eventLimit, skipEventFetch),
    queryFn: async () => {
      if (source !== 'desktop' || skipEventFetch) {
        return { events: [] as ActivityEvent[], readSource: undefined as ComputerActivityReadSource | undefined }
      }

      const raw = await fetchActivityEvents(timeRange.start, timeRange.end, eventLimit)
      const dedupedEvents = deduplicateEvents(raw.events)
      if (dedupedEvents.length < raw.events.length && process.env.NODE_ENV !== 'production') {
        console.log(`[useComputerActivity] Deduplicated ${raw.events.length - dedupedEvents.length} redundant events`)
      }
      return { events: dedupedEvents, readSource: raw.readSource }
    },
    enabled: source === 'desktop',
    placeholderData: (previous) => previous ?? { events: [], readSource: undefined },
    staleTime: QUERY_POLICY.computerEvents.staleTime,
    gcTime: QUERY_POLICY.computerEvents.gcTime,
    refetchOnWindowFocus: false,
    refetchInterval: autoRefresh && source === 'desktop' ? refreshIntervalMs : false,
    refetchIntervalInBackground: autoRefresh,
  })

  const events = source === 'desktop' ? (eventsQuery.data?.events ?? []) : []
  const eventsReadSource = eventsQuery.data?.readSource
  const aggregatedStats = aggregatedQuery.data ?? null
  const aggregatedReadSource = aggregatedStats?.read_source
    || (aggregatedStats?.source === 'local' || aggregatedStats?.source === 'synced' || aggregatedStats?.source === 'unavailable'
      ? aggregatedStats.source
      : undefined)
  const readSource: ComputerActivityReadSource = source !== 'desktop'
    ? 'synced'
    : (eventsReadSource === 'unavailable' && aggregatedReadSource === 'unavailable'
      ? 'unavailable'
      : eventsReadSource === 'local' || aggregatedReadSource === 'local'
        ? 'local'
        : aggregatedReadSource === 'synced' || eventsReadSource === 'synced'
          ? 'synced'
          : eventsReadSource || aggregatedReadSource || 'unavailable')
  const hasAggregatedData = Boolean(
    Number(aggregatedStats?.summary?.total_active_ms || 0) > 0
    || (aggregatedStats?.daily?.length || 0) > 0
    || (aggregatedStats?.apps?.length || 0) > 0
    || (aggregatedStats?.domains?.length || 0) > 0
  )
  const isLoading = source === 'desktop'
    ? ((aggregatedQuery.isLoading || aggregatedQuery.isFetching) && !hasAggregatedData)
      || (!skipEventFetch && eventsQuery.isLoading && !hasAggregatedData)
    : (aggregatedQuery.isLoading || aggregatedQuery.isFetching) && !hasAggregatedData
  const error = (
    aggregatedQuery.error
    || (source === 'desktop' ? eventsQuery.error : null)
  ) instanceof Error
    ? (
        aggregatedQuery.error
        || (source === 'desktop' ? eventsQuery.error : null)
      )!.message
    : null

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: computerActivityKeys.aggregated(source, rangeKey),
    })
    if (source === 'desktop') {
      void queryClient.invalidateQueries({
        queryKey: computerActivityKeys.events(source, rangeKey, eventLimit, skipEventFetch),
      })
    }
  }, [eventLimit, queryClient, rangeKey, skipEventFetch, source])
  
  // Build view model from events
  const viewModel = useMemo<ActivityBreakdownViewModel>(() => {
    const fallbackApps = topApps(events, 10)
    const fallbackDomains = topDomains(events, 10)

    // Aggregated stats are day-level; for sub-day ranges prefer raw
    // event-derived values. Fall back to aggregated if events are empty.
    const isSubDayRange = source === 'desktop' && (range === '6H' || range === '12H')
    const hasRawEvents = fallbackApps.length > 0 || fallbackDomains.length > 0
    const useAggregated = aggregatedStats != null && (source === 'iphone' || !isSubDayRange || !hasRawEvents)

    const dailyTotals = useAggregated
      ? (aggregatedStats?.daily || []).map((row: any) => {
          const dayValue = (row.day || '').toString()
          const dayMs = dayValue ? new Date(`${dayValue}T00:00:00`).getTime() : 0
          const clampedMs = Math.max(
            0,
            Math.min(Number(row.active_ms ?? row.total_active_ms ?? 0), 24 * 60 * 60 * 1000),
          )
          return { x: dayMs, yMs: clampedMs }
        }).filter((point: any) => Number.isFinite(point.x) && point.x > 0)
      : []

    const rawSummaryActiveMs = useAggregated
      ? Math.max(0, Number(aggregatedStats?.summary?.total_active_ms || 0))
      : 0
    const totalDailyMs = dailyTotals.reduce((sum: number, point: any) => sum + (point.yMs || 0), 0)
    const rangeSpanMs = Math.max(0, timeRange.end - timeRange.start)
    const summaryCapMs = totalDailyMs > 0 ? totalDailyMs : rangeSpanMs
    const summaryActiveMs = summaryCapMs > 0 ? Math.min(rawSummaryActiveMs, summaryCapMs) : rawSummaryActiveMs

    let apps = fallbackApps
    let domains = fallbackDomains

    if (useAggregated) {
      const appsFromAggregatesRaw = (aggregatedStats?.apps || []).map((row: any) => ({
        key: (row.app_bundle_id || row.app_name || '').toString(),
        label: (row.app_name || row.app_bundle_id || 'Unknown App').toString(),
        valueMs: Math.max(0, Number(row.total_active_ms || 0)),
        eventCount: Number(row.total_events || 0),
        subtitle: Number(row.days_used || 0) > 0 ? `${Number(row.days_used)}d` : undefined,
      })).filter((item: any) => item.key && item.valueMs > 0)

      const domainsFromAggregatesRaw = (aggregatedStats?.domains || []).map((row: any) => {
        const domain = (row.browser_domain || row.domain || '').toString()
        return {
          key: domain,
          label: domain,
          valueMs: Math.max(0, Number(row.total_active_ms || 0)),
          eventCount: Number(row.total_events || 0),
          subtitle: Number(row.days_used || 0) > 0 ? `${Number(row.days_used)}d` : undefined,
        }
      }).filter((item: any) => item.key && item.valueMs > 0)

      const normalizeAggregateRows = (rows: typeof appsFromAggregatesRaw) => {
        if (rows.length === 0 || summaryActiveMs <= 0) return rows
        const totalMs = rows.reduce((sum: number, row: any) => sum + (row.valueMs || 0), 0)
        if (totalMs <= 0 || totalMs <= summaryActiveMs) return rows
        const scale = summaryActiveMs / totalMs
        return rows.map((row: any) => ({ ...row, valueMs: row.valueMs * scale }))
      }

      const appsFromAggregates = normalizeAggregateRows(appsFromAggregatesRaw)
      const domainsFromAggregates = normalizeAggregateRows(domainsFromAggregatesRaw)

      if (appsFromAggregates.length > 0) apps = appsFromAggregates
      if (domainsFromAggregates.length > 0) domains = domainsFromAggregates
    }

    const header = {
      primaryLabel: 'Active Time',
      primaryValueMs: useAggregated && (summaryActiveMs > 0 || dailyTotals.length > 0)
        ? (summaryActiveMs > 0 ? summaryActiveMs : dailyTotals.reduce((sum: number, point: any) => sum + (point.yMs || 0), 0))
        : calculateUniqueActiveTime(events),
    }

    const capabilities = {
      supportsDomains: source === 'desktop' ? true : Boolean(aggregatedStats?.summary?.supports_domains),
      domainDisclosure: source === 'iphone' ? (aggregatedStats?.summary?.domain_disclosure || null) : null,
      isConnected: source === 'desktop' ? true : Boolean(aggregatedStats?.summary?.is_connected),
      setupHref: source === 'iphone' ? (aggregatedStats?.summary?.setup_href || '/integrations') : null,
    }

    return {
      source,
      capabilities,
      header,
      apps,
      domains,
      range: {
        start: timeRange.start,
        end: timeRange.end,
        preset: range,
      },
      isLoading,
      error,
      readSource,
    }
  }, [events, aggregatedStats, timeRange.start, timeRange.end, range, source, isLoading, error, readSource])
  
  return {
    viewModel,
    range,
    setRange,
    refresh,
  }
}

export default useComputerActivity
