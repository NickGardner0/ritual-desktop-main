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
} from '@/types/computerActivity'
import {
  eventsToSegments,
  mergeAdjacentSegments,
  computeMicroMetrics,
  topApps,
  topDomains,
  buildAttentionHeader,
  startOfDayLocal,
  endOfDayLocal,
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

async function fetchActivityEvents(startTs: number, endTs: number): Promise<ActivityEvent[]> {
  try {
    // Check if we're in Tauri environment
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      const response = await invoke<TauriDetailedResponse>('get_detailed_activity', {
        startTs,
        endTs,
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
    
    try {
      // Check cache first
      const cached = getCachedEvents(timeRange.start, timeRange.end)
      if (cached) {
        if (currentRequestId === requestIdRef.current) {
          setEvents(cached)
          setIsLoading(false)
        }
        return
      }
      
      const fetchedEvents = await fetchActivityEvents(timeRange.start, timeRange.end)
      
      // Cache the result
      setCachedEvents(timeRange.start, timeRange.end, fetchedEvents)
      
      // Only update if this is still the latest request
      if (currentRequestId === requestIdRef.current) {
        setEvents(fetchedEvents)
        setIsLoading(false)
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setIsLoading(false)
      }
    }
  }, [timeRange.start, timeRange.end])
  
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
    const apps = topApps(events, 10)
    const domains = topDomains(events, 10)
    const header = buildAttentionHeader(events, timeRange.start, timeRange.end)
    
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
  }, [events, timeRange.start, timeRange.end, range, isLoading, error])
  
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

