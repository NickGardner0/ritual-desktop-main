/**
 * useComputerActivity Hook
 * 
 * Fetches and derives computer activity data with backend/Turso-first
 * aggregated reads and local Tauri raw-event reads as desktop fallback.
 * iPhone Screen Time remains a separate aggregate source and should not be
 * merged with watcher desktop activity implicitly.
 * Implements caching and optimized loading for different time ranges.
 */

'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isDesktopRuntime } from '@/lib/desktop-capabilities'
import {
  ActivityBreakdownSource,
  ActivityBreakdownViewModel,
  ActivityEvent,
  TimeRangePreset,
  SessionSegment,
  DrillDownData,
} from '@/lib/computerActivity/contracts'
import {
  eventsToSegments,
  mergeAdjacentSegments,
  computeMicroMetrics,
  topApps,
  topDomains,
  buildAttentionHeader,
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

async function fetchActivityEvents(startTs: number, endTs: number, limit?: number): Promise<ActivityEvent[]> {
  try {
    // Check if we're in Tauri environment
    if (isDesktopRuntime()) {
      if (process.env.NODE_ENV !== 'production') { console.log('[useComputerActivity] isDesktop=true, attempting Tauri invoke for detailed activity…') }
      try {
        const response = await invokeDetailedActivityWithInitRetry({
          startTs,
          endTs,
          limit,
        })
        if (process.env.NODE_ENV !== 'production') { console.log(`[useComputerActivity] Tauri invoke succeeded: ${response.events.length} events, active_ms=${response.total_active_ms}`) }

        return response.events.map(e => ({
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
        }))
      } catch (tauriError) {
        console.error('[useComputerActivity] Tauri invoke FAILED — IPC bridge likely unavailable:', tauriError)
        if (process.env.NODE_ENV !== 'production') { console.log('[useComputerActivity] Falling through to HTTP fetch…') }
      }
    }

    // Fallback to API for web version
    const params = new URLSearchParams({
      start_ts: startTs.toString(),
      end_ts: endTs.toString(),
    })
    
    const response = await fetch(`/api/watcher/activity?${params}`)
    if (!response.ok) {
      throw new Error('Failed to fetch activity')
    }
    
    const data = await response.json()
    return data.events || []
  } catch (error) {
    console.error('Failed to fetch activity events:', error)
    return []
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
  // Drill-down
  selectedSegment: SessionSegment | null
  selectSegment: (segment: SessionSegment | null) => void
  drillDownData: DrillDownData | null
  isDrillLoading: boolean
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

  // Drill-down state
  const [selectedSegment, setSelectedSegment] = useState<SessionSegment | null>(null)
  const [drillDownData, setDrillDownData] = useState<DrillDownData | null>(null)
  const [isDrillLoading, setIsDrillLoading] = useState(false)

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
        return [] as ActivityEvent[]
      }

      const rawEvents = await fetchActivityEvents(timeRange.start, timeRange.end, eventLimit)
      const dedupedEvents = deduplicateEvents(rawEvents)
      if (dedupedEvents.length < rawEvents.length && process.env.NODE_ENV !== 'production') {
        console.log(`[useComputerActivity] Deduplicated ${rawEvents.length - dedupedEvents.length} redundant events`)
      }
      return dedupedEvents
    },
    enabled: source === 'desktop',
    placeholderData: (previous) => previous ?? [],
    staleTime: QUERY_POLICY.computerEvents.staleTime,
    gcTime: QUERY_POLICY.computerEvents.gcTime,
    refetchOnWindowFocus: false,
    refetchInterval: autoRefresh && source === 'desktop' ? refreshIntervalMs : false,
    refetchIntervalInBackground: autoRefresh,
  })

  const events = source === 'desktop' ? (eventsQuery.data ?? []) : []
  const aggregatedStats = aggregatedQuery.data ?? null
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

  // Clear drill-down when range changes
  useEffect(() => {
    setSelectedSegment(null)
    setDrillDownData(null)
  }, [range, source])
  
  // Handle segment selection for drill-down
  const selectSegment = useCallback(async (segment: SessionSegment | null) => {
    setSelectedSegment(segment)
    
    if (!segment) {
      setDrillDownData(null)
      return
    }
    
    setIsDrillLoading(true)
    
    try {
      // Filter events for this segment's time range
      const segmentEvents = events.filter(
        e => e.ts_start >= segment.start && e.ts_end <= segment.end
      )
      
      setDrillDownData({
        segment,
        events: segmentEvents,
        totalDurationMs: segment.durationMs,
      })
    } catch (err) {
      console.error('Failed to load drill-down data:', err)
    } finally {
      setIsDrillLoading(false)
    }
  }, [events])

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
    const rawSegments = eventsToSegments(events)
    const segments = mergeAdjacentSegments(rawSegments, 60000)

    const micro = computeMicroMetrics(events)
    const fallbackApps = topApps(events, 10)
    const fallbackDomains = topDomains(events, 10)
    const fallbackHeader = buildAttentionHeader(events, timeRange.start, timeRange.end)

    // Aggregated stats are day-level; for sub-day ranges prefer raw
    // event-derived values. Fall back to aggregated if events are empty.
    const isSubDayRange = source === 'desktop' && (range === '6H' || range === '12H')
    const hasRawEvents = fallbackApps.length > 0 || fallbackDomains.length > 0
    const useAggregated = aggregatedStats != null && (source === 'iphone' || !isSubDayRange || !hasRawEvents)

    const dailySparkline = useAggregated
      ? (aggregatedStats?.daily || []).map((row: any) => {
          const dayValue = (row.day || '').toString()
          const dayMs = dayValue ? new Date(`${dayValue}T00:00:00`).getTime() : 0
          const clampedMs = Math.max(
            0,
            Math.min(Number(row.active_ms ?? row.total_active_ms ?? 0), 24 * 60 * 60 * 1000),
          )
          return { x: dayMs, yMs: clampedMs, label: dayValue }
        }).filter((point: any) => Number.isFinite(point.x) && point.x > 0)
      : []

    const rawSummaryActiveMs = useAggregated
      ? Math.max(0, Number(aggregatedStats?.summary?.total_active_ms || 0))
      : 0
    const totalDailyMs = dailySparkline.reduce((sum: number, point: any) => sum + (point.yMs || 0), 0)
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

    let aggregatedDeltaPct: number | null = null
    let aggregatedDeltaMs: number | null = null
    if (dailySparkline.length >= 2) {
      const half = Math.floor(dailySparkline.length / 2)
      const firstHalf = dailySparkline.slice(0, half)
      const secondHalf = dailySparkline.slice(half)
      const firstTotal = firstHalf.reduce((sum: number, point: any) => sum + (point.yMs || 0), 0)
      const secondTotal = secondHalf.reduce((sum: number, point: any) => sum + (point.yMs || 0), 0)
      if (firstTotal > 0) {
        aggregatedDeltaPct = ((secondTotal - firstTotal) / firstTotal) * 100
        aggregatedDeltaMs = secondTotal - firstTotal
      }
    }

    const header = useAggregated && (summaryActiveMs > 0 || dailySparkline.length > 0)
      ? {
          primaryLabel: 'Active Time',
          primaryValueMs: summaryActiveMs > 0 ? summaryActiveMs : dailySparkline.reduce((sum: number, point: any) => sum + (point.yMs || 0), 0),
          deltaPct: aggregatedDeltaPct,
          deltaMs: aggregatedDeltaMs,
          sparkline: dailySparkline.length > 0 ? dailySparkline : fallbackHeader.sparkline,
        }
      : fallbackHeader
    
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
      segments: source === 'desktop' ? segments : [],
      apps,
      domains,
      micro: source === 'desktop'
        ? micro
        : {
            focusBlocks: 0,
            switches: 0,
            longestBlockMs: 0,
            longestBlockLabel: undefined,
            totalActiveMs: header.primaryValueMs,
            totalAfkMs: 0,
          },
      range: {
        start: timeRange.start,
        end: timeRange.end,
        preset: range,
      },
      isLoading,
      error,
    }
  }, [events, aggregatedStats, timeRange.start, timeRange.end, range, source, isLoading, error])
  
  return {
    viewModel,
    range,
    setRange,
    refresh,
    selectedSegment,
    selectSegment,
    drillDownData,
    isDrillLoading,
  }
}

export default useComputerActivity
