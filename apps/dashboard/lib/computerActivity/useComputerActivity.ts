/**
 * useComputerActivity Hook
 * 
 * Fetches and derives computer activity data from local Tauri commands.
 * Implements caching and optimized loading for different time ranges.
 */

'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { isTauri } from '@/lib/tauri-utils'
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
  invokeDailySummariesWithInitRetry,
} from './tauri-activity'
import { normalizeComputerDailySummaryRow } from './normalize'

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
      }),
      fetch(`/api/screen-time/stats/top-apps?start_date=${startDate}&end_date=${endDate}&limit=10`),
      fetch(`/api/screen-time/stats/top-domains?start_date=${startDate}&end_date=${endDate}&limit=10`),
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

    if (isTauri()) {
      const [detailed, daily] = await Promise.all([
        invokeDetailedActivityWithInitRetry({
          startTs,
          endTs,
          limit: 1,
        }),
        invokeDailySummariesWithInitRetry(startDate, endDate),
      ])

      return {
        summary: {
          total_active_ms: Math.max(0, Number(detailed.total_active_ms || 0)),
          total_afk_ms: Math.max(0, Number(detailed.total_afk_ms || 0)),
        },
        daily: daily
          .map(normalizeComputerDailySummaryRow)
          .filter((row): row is NonNullable<ReturnType<typeof normalizeComputerDailySummaryRow>> => Boolean(row))
          .map((row) => ({
            day: row.day,
            active_ms: row.active_ms,
            active_hours: row.active_hours,
            event_count: row.events_count,
            app_count: row.apps_count ?? 0,
            domain_count: row.domain_count ?? 0,
          })),
        apps: detailed.apps.map((row) => ({
          app_bundle_id: row.app_bundle_id,
          app_name: row.app_name,
          total_active_ms: Math.max(0, Number(row.total_duration_ms || 0)),
          total_events: Math.max(0, Number(row.event_count || 0)),
        })),
        domains: detailed.domains.map((row) => ({
          domain: row.domain,
          total_active_ms: Math.max(0, Number(row.total_duration_ms || 0)),
          total_events: Math.max(0, Number(row.event_count || 0)),
        })),
      }
    }

    const [summaryRes, dailyRes, appsRes, domainsRes] = await Promise.all([
      fetch(`/api/watcher/stats/summary?start_date=${startDate}&end_date=${endDate}`),
      fetch(`/api/watcher/stats/daily?start_date=${startDate}&end_date=${endDate}`),
      fetch(`/api/watcher/stats/top-apps?start_date=${startDate}&end_date=${endDate}&limit=10`),
      fetch(`/api/watcher/stats/top-domains?start_date=${startDate}&end_date=${endDate}&limit=10`),
    ])

    if (!summaryRes.ok || !dailyRes.ok || !appsRes.ok || !domainsRes.ok) {
      return null
    }

    const [summaryPayload, dailyPayload, appsPayload, domainsPayload] = await Promise.all([
      summaryRes.json(),
      dailyRes.json(),
      appsRes.json(),
      domainsRes.json(),
    ])

    return {
      summary: summaryPayload?.data || {},
      daily: dailyPayload?.data || [],
      apps: appsPayload?.data || [],
      domains: domainsPayload?.data || [],
    }
  } catch (error) {
    console.error('Failed to fetch aggregated computer stats:', error)
    return null
  }
}

// ============================================================
// Cache for API responses
// ============================================================

interface CacheEntry {
  events: ActivityEvent[]
  aggregated: AggregatedComputerStats | null
  timestamp: number
  range: { start: number; end: number }
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 1000
const STALE_TTL_MS = 5 * 60 * 1000

function getCacheKey(source: ActivityBreakdownSource, start: number, end: number): string {
  const roundedStart = Math.floor(start / 60000) * 60000
  const roundedEnd = Math.floor(end / 60000) * 60000
  return `${source}:${roundedStart}-${roundedEnd}`
}

function getCached(source: ActivityBreakdownSource, start: number, end: number): { events: ActivityEvent[] | null; aggregated: AggregatedComputerStats | null; isStale: boolean } {
  const key = getCacheKey(source, start, end)
  const entry = cache.get(key)

  if (!entry) return { events: null, aggregated: null, isStale: true }

  const age = Date.now() - entry.timestamp
  if (age > STALE_TTL_MS) return { events: null, aggregated: null, isStale: true }

  return {
    events: entry.events,
    aggregated: entry.aggregated,
    isStale: age > CACHE_TTL_MS,
  }
}

function setCache(source: ActivityBreakdownSource, start: number, end: number, events: ActivityEvent[], aggregated: AggregatedComputerStats | null): void {
  const key = getCacheKey(source, start, end)
  cache.set(key, {
    events,
    aggregated,
    timestamp: Date.now(),
    range: { start, end },
  })

  if (cache.size > 20) {
    const entries = Array.from(cache.entries())
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    for (let i = 0; i < 10; i++) {
      cache.delete(entries[i][0])
    }
  }
}

async function fetchActivityEvents(startTs: number, endTs: number, limit?: number): Promise<ActivityEvent[]> {
  try {
    // Check if we're in Tauri environment
    if (isTauri()) {
      if (process.env.NODE_ENV !== 'production') { console.log('[useComputerActivity] isTauri()=true, attempting Tauri invoke for detailed activity…') }
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
  } = options
  
  const [range, setRange] = useState<TimeRangePreset>(initialRange)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [aggregatedStats, setAggregatedStats] = useState<AggregatedComputerStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Drill-down state
  const [selectedSegment, setSelectedSegment] = useState<SessionSegment | null>(null)
  const [drillDownData, setDrillDownData] = useState<DrillDownData | null>(null)
  const [isDrillLoading, setIsDrillLoading] = useState(false)
  
  // Request ID to prevent stale updates
  const requestIdRef = useRef(0)
  
  // Computed time range
  const timeRange = useMemo(() => getTimeRangeMs(range), [range])
  
  // Fetch data, showing cached results immediately when available
  const fetchData = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current
    setError(null)

    const { events: cachedEvents, aggregated: cachedAgg, isStale } = getCached(source, timeRange.start, timeRange.end)

    if (cachedEvents && cachedAgg) {
      setEvents(cachedEvents)
      setAggregatedStats(cachedAgg)
      setIsLoading(false)
      if (!isStale) return
    } else {
      setIsLoading(true)
    }

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

    try {
      const eventsPromise = source === 'desktop'
        ? (cachedEvents
            ? Promise.resolve(cachedEvents)
            : fetchActivityEvents(timeRange.start, timeRange.end, eventLimit))
        : Promise.resolve<ActivityEvent[]>([])
      const aggregatedPromise = source === 'desktop'
        ? fetchAggregatedStats(timeRange.start, timeRange.end)
        : fetchScreenTimeAggregatedStats(timeRange.start, timeRange.end)

      const aggregated = await aggregatedPromise
      let hasAggregatedData = false
      if (currentRequestId === requestIdRef.current) {
        setAggregatedStats(aggregated)
        hasAggregatedData = Boolean(
          Number(aggregated?.summary?.total_active_ms || 0) > 0
          || (aggregated?.daily?.length || 0) > 0
          || (aggregated?.apps?.length || 0) > 0
          || (aggregated?.domains?.length || 0) > 0
        )
        if (hasAggregatedData) {
          setIsLoading(false)
        }
      }

      const rawEvents = await eventsPromise
      const dedupedEvents = cachedEvents === rawEvents ? rawEvents : deduplicateEvents(rawEvents)

      if (cachedEvents !== rawEvents && dedupedEvents.length < rawEvents.length) {
        if (process.env.NODE_ENV !== 'production') { console.log(`[useComputerActivity] Deduplicated ${rawEvents.length - dedupedEvents.length} redundant events`) }
      }

      if (currentRequestId === requestIdRef.current) {
        setEvents(dedupedEvents)
        setCache(source, timeRange.start, timeRange.end, dedupedEvents, aggregated)
        if (!hasAggregatedData) {
          setIsLoading(false)
        }
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        if (!cachedEvents) {
          setError(err instanceof Error ? err.message : 'Failed to load data')
          setAggregatedStats(null)
        }
        setIsLoading(false)
      }
    }
  }, [range, source, timeRange.start, timeRange.end])
  
  // Initial fetch and range changes
  useEffect(() => {
    fetchData()
  }, [fetchData])
  
  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return
    
    const interval = setInterval(fetchData, refreshIntervalMs)
    return () => clearInterval(interval)
  }, [autoRefresh, refreshIntervalMs, fetchData])
  
  // Clear drill-down when range changes
  useEffect(() => {
    setSelectedSegment(null)
    setDrillDownData(null)
  }, [range])
  
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
    refresh: fetchData,
    selectedSegment,
    selectSegment,
    drillDownData,
    isDrillLoading,
  }
}

export default useComputerActivity
