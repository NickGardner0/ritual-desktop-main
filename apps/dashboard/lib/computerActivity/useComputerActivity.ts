/**
 * useComputerActivity Hook
 * 
 * Fetches and derives computer activity data from local Tauri commands.
 * Implements caching and optimized loading for different time ranges.
 */

'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import {
  ActivityEvent,
  ComputerActivityViewModel,
  TimeRangePreset,
  SessionSegment,
  DrillDownData,
} from '@ritual/shared-contracts/computer-activity'
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
      return { start: startOfDayLocal(now), end: endOfToday }
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

async function fetchAggregatedStats(startTs: number, endTs: number): Promise<AggregatedComputerStats | null> {
  try {
    const startDate = toLocalDateString(startTs)
    const endDate = toLocalDateString(endTs)

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
  timestamp: number
  range: { start: number; end: number }
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30 * 1000 // 30 seconds

function getCacheKey(start: number, end: number): string {
  // Round to nearest minute for cache key stability
  const roundedStart = Math.floor(start / 60000) * 60000
  const roundedEnd = Math.floor(end / 60000) * 60000
  return `${roundedStart}-${roundedEnd}`
}

function getCachedEvents(start: number, end: number): ActivityEvent[] | null {
  const key = getCacheKey(start, end)
  const entry = cache.get(key)
  
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.events
  }
  
  return null
}

function setCachedEvents(start: number, end: number, events: ActivityEvent[]): void {
  const key = getCacheKey(start, end)
  cache.set(key, {
    events,
    timestamp: Date.now(),
    range: { start, end },
  })
  
  // Clean old entries
  if (cache.size > 20) {
    const entries = Array.from(cache.entries())
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    for (let i = 0; i < 10; i++) {
      cache.delete(entries[i][0])
    }
  }
}

// ============================================================
// Tauri API interface
// ============================================================

interface TauriActivityEvent {
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

interface TauriDetailedResponse {
  events: TauriActivityEvent[]
  apps: { app_bundle_id: string; app_name: string; total_duration_ms: number; event_count: number }[]
  domains: { domain: string; total_duration_ms: number; event_count: number }[]
  total_active_ms: number
  total_afk_ms: number
}

async function fetchActivityEvents(startTs: number, endTs: number, limit?: number): Promise<ActivityEvent[]> {
  try {
    // Check if we're in Tauri environment
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      const response = await invoke<TauriDetailedResponse>('get_detailed_activity', {
        startTs,
        endTs,
        limit,
      })
      
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
  autoRefresh?: boolean
  refreshIntervalMs?: number
}

export interface UseComputerActivityReturn {
  viewModel: ComputerActivityViewModel
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
  
  // Fetch data
  const fetchData = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current
    setIsLoading(true)
    setError(null)
    
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
      const cached = getCachedEvents(timeRange.start, timeRange.end)

      const [rawEvents, aggregated] = await Promise.all([
        cached
          ? Promise.resolve(cached)
          : fetchActivityEvents(timeRange.start, timeRange.end, eventLimit),
        fetchAggregatedStats(timeRange.start, timeRange.end),
      ])

      const dedupedEvents = cached ? rawEvents : deduplicateEvents(rawEvents)

      if (!cached && dedupedEvents.length < rawEvents.length) {
        console.log(`[useComputerActivity] Deduplicated ${rawEvents.length - dedupedEvents.length} redundant events`)
      }

      if (!cached) {
        setCachedEvents(timeRange.start, timeRange.end, dedupedEvents)
      }

      if (currentRequestId === requestIdRef.current) {
        setEvents(dedupedEvents)
        setAggregatedStats(aggregated)
        setIsLoading(false)
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setAggregatedStats(null)
        setIsLoading(false)
      }
    }
  }, [range, timeRange.start, timeRange.end])
  
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
  const viewModel = useMemo<ComputerActivityViewModel>(() => {
    // Generate segments
    const rawSegments = eventsToSegments(events)
    const segments = mergeAdjacentSegments(rawSegments, 60000) // 1 min gap threshold
    
    // Compute metrics
    const micro = computeMicroMetrics(events)
    const fallbackApps = topApps(events, 10)
    const fallbackDomains = topDomains(events, 10)
    const fallbackHeader = buildAttentionHeader(events, timeRange.start, timeRange.end)

    const appsFromAggregates = (aggregatedStats?.apps || []).map((row: any) => ({
      key: (row.app_bundle_id || row.app_name || '').toString(),
      label: (row.app_name || row.app_bundle_id || 'Unknown App').toString(),
      valueMs: Number(row.total_active_ms || 0),
      eventCount: Number(row.total_events || 0),
      subtitle: Number(row.days_used || 0) > 0 ? `${Number(row.days_used)}d` : undefined,
    })).filter((item: any) => item.key && item.valueMs > 0)

    const domainsFromAggregates = (aggregatedStats?.domains || []).map((row: any) => {
      const domain = (row.browser_domain || row.domain || '').toString()
      return {
        key: domain,
        label: domain,
        valueMs: Number(row.total_active_ms || 0),
        eventCount: Number(row.total_events || 0),
        subtitle: Number(row.days_used || 0) > 0 ? `${Number(row.days_used)}d` : undefined,
      }
    }).filter((item: any) => item.key && item.valueMs > 0)

    const apps = appsFromAggregates.length > 0 ? appsFromAggregates : fallbackApps
    const domains = domainsFromAggregates.length > 0 ? domainsFromAggregates : fallbackDomains

    const dailySparkline = (aggregatedStats?.daily || []).map((row: any) => {
      const dayValue = (row.day || '').toString()
      const dayMs = dayValue ? new Date(`${dayValue}T00:00:00`).getTime() : 0
      return {
        x: dayMs,
        yMs: Number(row.active_ms ?? row.total_active_ms ?? 0),
        label: dayValue,
      }
    }).filter((point: any) => Number.isFinite(point.x) && point.x > 0)

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

    const summaryActiveMs = Number(aggregatedStats?.summary?.total_active_ms || 0)
    const header = summaryActiveMs > 0 || dailySparkline.length > 0
      ? {
          primaryLabel: 'Active Time',
          primaryValueMs: summaryActiveMs > 0 ? summaryActiveMs : dailySparkline.reduce((sum: number, point: any) => sum + (point.yMs || 0), 0),
          deltaPct: aggregatedDeltaPct,
          deltaMs: aggregatedDeltaMs,
          sparkline: dailySparkline.length > 0 ? dailySparkline : fallbackHeader.sparkline,
        }
      : fallbackHeader
    
    return {
      header,
      segments,
      apps,
      domains,
      micro,
      range: {
        start: timeRange.start,
        end: timeRange.end,
        preset: range,
      },
      isLoading,
      error,
    }
  }, [events, aggregatedStats, timeRange.start, timeRange.end, range, isLoading, error])
  
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
