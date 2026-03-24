/**
 * Computer Activity Data Transformers
 * 
 * Pure functions to derive analytics from raw activity events.
 * These run on the client after fetching data from Tauri.
 */

import {
  ActivityEvent,
  SessionSegment,
  SessionKind,
  RankedBar,
  MicroMetrics,
  SparklinePoint,
  AttentionHeader,
  DailyRollup,
} from '@/lib/computerActivity/contracts'

// ============================================================
// 2.1 Helpers
// ============================================================

/**
 * Convert milliseconds to human-readable format
 */
export function msToHuman(ms: number, short = false): string {
  if (ms < 0) ms = 0
  
  const hours = Math.floor(ms / (1000 * 60 * 60))
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((ms % (1000 * 60)) / 1000)
  
  if (hours > 0) {
    if (short) return `${hours}h ${minutes}m`
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    if (short) return `${minutes}m`
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

/**
 * Format milliseconds as decimal hours (e.g., 1.5h)
 */
export function msToDecimalHours(ms: number): string {
  const hours = ms / (1000 * 60 * 60)
  if (hours >= 10) return `${Math.round(hours)}h`
  if (hours >= 1) return `${hours.toFixed(1)}h`
  const minutes = ms / (1000 * 60)
  return `${Math.round(minutes)}m`
}

/**
 * Get start of day in local timezone
 */
export function startOfDayLocal(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Get end of day in local timezone
 */
export function endOfDayLocal(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

/**
 * Format date for display
 */
export function formatDate(timestamp: number, format: 'short' | 'medium' | 'long' = 'short'): string {
  const date = new Date(timestamp)
  switch (format) {
    case 'short':
      return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
    case 'medium':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    case 'long':
      return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }
}

/**
 * Stable local YYYY-MM-DD key (avoids UTC day-shift from toISOString).
 */
function toLocalDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA')
}

/**
 * Format time for display
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * Bucket events by day, returns map of date string -> total ms
 */
export function bucketByDay(events: ActivityEvent[]): Map<string, number> {
  const dayIntervals = new Map<string, Array<{ start: number; end: number }>>()

  for (const event of events) {
    if (isAfk(event)) continue

    const start = event.ts_start
    const end = event.ts_end
    if (end <= start) continue

    const dateKey = toLocalDateKey(new Date(start))
    const intervals = dayIntervals.get(dateKey) || []
    intervals.push({ start, end })
    dayIntervals.set(dateKey, intervals)
  }

  const buckets = new Map<string, number>()
  for (const [dateKey, intervals] of dayIntervals) {
    const merged = mergeTimeIntervals(intervals)
    const uniqueMs = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0)
    buckets.set(dateKey, uniqueMs)
  }

  return buckets
}

/**
 * Check if event is AFK
 */
export function isAfk(event: ActivityEvent): boolean {
  return event.is_afk === true || event.is_afk === 1
}

/**
 * Check if event is incognito
 */
export function isIncognito(event: ActivityEvent): boolean {
  return event.is_incognito === true || event.is_incognito === 1
}

// ============================================================
// 2.1b Deduplication (inspired by ActivityWatch's union_no_overlap)
// ============================================================

/**
 * Remove duplicate/redundant overlapping events from raw data
 * 
 * This handles the case where multiple watcher instances recorded
 * nearly-identical events with slightly offset timestamps.
 * 
 * Algorithm:
 * 1. Sort events by start time
 * 2. For each event, check if it significantly overlaps with the previous
 * 3. If overlap > 90% and same app, keep only the longer one
 * 4. Otherwise keep both (they're distinct activities)
 */
export function deduplicateEvents(events: ActivityEvent[]): ActivityEvent[] {
  if (events.length <= 1) return events
  
  // Sort by start time
  const sorted = [...events].sort((a, b) => a.ts_start - b.ts_start)
  const deduplicated: ActivityEvent[] = []
  
  let current = sorted[0]
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    
    // Check if these events are essentially duplicates
    const isDuplicate = checkDuplicate(current, next)
    
    if (isDuplicate) {
      // Keep the one with the longer duration
      const currentDuration = current.ts_end - current.ts_start
      const nextDuration = next.ts_end - next.ts_start
      
      if (nextDuration > currentDuration) {
        current = next
      }
      // Otherwise keep current (it's longer)
    } else {
      // Not a duplicate, keep current and move to next
      deduplicated.push(current)
      current = next
    }
  }
  
  // Don't forget the last event
  deduplicated.push(current)
  
  return deduplicated
}

/**
 * Check if two events are effectively duplicates
 * (same app, start times within 5 seconds, high overlap)
 */
function checkDuplicate(a: ActivityEvent, b: ActivityEvent): boolean {
  // Must be same app
  const sameApp = a.app_bundle_id === b.app_bundle_id || 
                  (a.app_bundle_id === '' && b.app_bundle_id === '' && a.app_name === b.app_name)
  
  if (!sameApp) return false
  
  // Start times must be within 5 seconds
  const startDiff = Math.abs(a.ts_start - b.ts_start)
  if (startDiff > 5000) return false
  
  // Calculate overlap ratio
  const overlapStart = Math.max(a.ts_start, b.ts_start)
  const overlapEnd = Math.min(a.ts_end, b.ts_end)
  
  if (overlapStart >= overlapEnd) return false // No overlap
  
  const overlapMs = overlapEnd - overlapStart
  const aDuration = a.ts_end - a.ts_start
  const bDuration = b.ts_end - b.ts_start
  const minDuration = Math.min(aDuration, bDuration)
  
  // If overlap is > 80% of the shorter event, it's a duplicate
  return overlapMs > minDuration * 0.8
}

/**
 * Union of two event lists with no overlap
 * First list has priority (like ActivityWatch's union_no_overlap)
 * 
 * Use case: Merging events from different sources where events1
 * should take precedence over events2 for overlapping time periods.
 */
export function unionNoOverlap(
  events1: ActivityEvent[],
  events2: ActivityEvent[]
): ActivityEvent[] {
  if (events1.length === 0) return [...events2]
  if (events2.length === 0) return [...events1]
  
  // Sort both lists by start time
  const sorted1 = [...events1].sort((a, b) => a.ts_start - b.ts_start)
  const sorted2 = [...events2].sort((a, b) => a.ts_start - b.ts_start)
  
  const result: ActivityEvent[] = []
  let i1 = 0
  let i2 = 0
  
  while (i1 < sorted1.length && i2 < sorted2.length) {
    const e1 = sorted1[i1]
    const e2 = sorted2[i2]
    
    // Check if events intersect
    const intersects = e1.ts_start < e2.ts_end && e2.ts_start < e1.ts_end
    
    if (intersects) {
      // e1 has priority - always add it
      if (e1.ts_start <= e2.ts_start) {
        result.push(e1)
        i1++
        
        // Check if e2 continues after e1
        if (e2.ts_end > e1.ts_end) {
          // Split e2: create a new event for the non-overlapping portion
          const splitEvent: ActivityEvent = {
            ...e2,
            ts_start: e1.ts_end,
            duration_ms: e2.ts_end - e1.ts_end,
          }
          sorted2[i2] = splitEvent
        } else {
          // e2 is completely covered by e1, skip it
          i2++
        }
      } else {
        // e2 starts first, split it at e1's start
        const beforeEvent: ActivityEvent = {
          ...e2,
          ts_end: e1.ts_start,
          duration_ms: e1.ts_start - e2.ts_start,
        }
        result.push(beforeEvent)
        
        // Check if e2 continues after e1
        if (e2.ts_end > e1.ts_end) {
          const afterEvent: ActivityEvent = {
            ...e2,
            ts_start: e1.ts_end,
            duration_ms: e2.ts_end - e1.ts_end,
          }
          sorted2[i2] = afterEvent
        } else {
          i2++
        }
      }
    } else {
      // No intersection - add the earlier one
      if (e1.ts_start <= e2.ts_start) {
        result.push(e1)
        i1++
      } else {
        result.push(e2)
        i2++
      }
    }
  }
  
  // Add remaining events from either list
  while (i1 < sorted1.length) {
    result.push(sorted1[i1++])
  }
  while (i2 < sorted2.length) {
    result.push(sorted2[i2++])
  }
  
  return result
}

/**
 * Merge overlapping time intervals and calculate total unique time
 * This prevents double-counting when events overlap
 */
export function mergeTimeIntervals(
  intervals: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return []
  
  // Sort by start time
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  
  const merged: Array<{ start: number; end: number }> = []
  let current = { ...sorted[0] }
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    
    // If overlapping or adjacent, merge
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end)
    } else {
      // No overlap, push current and start new
      merged.push(current)
      current = { ...next }
    }
  }
  
  merged.push(current)
  return merged
}

/**
 * Calculate total active time without double-counting overlapping events
 */
export function calculateUniqueActiveTime(events: ActivityEvent[]): number {
  const activeEvents = events.filter(e => !isAfk(e))
  
  if (activeEvents.length === 0) return 0
  
  const intervals = activeEvents.map(e => ({
    start: e.ts_start,
    end: e.ts_end,
  }))
  
  const merged = mergeTimeIntervals(intervals)
  
  return merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0)
}

/**
 * Calculate total active time per app without double-counting overlapping events
 */
export function calculateUniqueTimePerApp(
  events: ActivityEvent[]
): Map<string, { name: string; uniqueMs: number; eventCount: number }> {
  const appMap = new Map<string, { name: string; intervals: Array<{ start: number; end: number }>; eventCount: number }>()
  
  for (const event of events) {
    if (isAfk(event)) continue
    
    const key = event.app_bundle_id || event.app_name
    
    if (!appMap.has(key)) {
      appMap.set(key, { name: event.app_name, intervals: [], eventCount: 0 })
    }
    
    const entry = appMap.get(key)!
    entry.intervals.push({ start: event.ts_start, end: event.ts_end })
    entry.eventCount++
  }
  
  // Merge intervals for each app and calculate unique time
  const result = new Map<string, { name: string; uniqueMs: number; eventCount: number }>()
  
  for (const [key, data] of appMap) {
    const merged = mergeTimeIntervals(data.intervals)
    const uniqueMs = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0)
    
    result.set(key, {
      name: data.name,
      uniqueMs,
      eventCount: data.eventCount,
    })
  }
  
  return result
}

/**
 * Calculate total active time per domain without double-counting overlapping events
 */
export function calculateUniqueTimePerDomain(
  events: ActivityEvent[],
  excludeIncognito: boolean = true
): Map<string, { uniqueMs: number; eventCount: number }> {
  const domainMap = new Map<string, { intervals: Array<{ start: number; end: number }>; eventCount: number }>()
  
  for (const event of events) {
    if (isAfk(event)) continue
    if (!event.browser_domain) continue
    if (excludeIncognito && isIncognito(event)) continue
    
    const key = event.browser_domain
    
    if (!domainMap.has(key)) {
      domainMap.set(key, { intervals: [], eventCount: 0 })
    }
    
    const entry = domainMap.get(key)!
    entry.intervals.push({ start: event.ts_start, end: event.ts_end })
    entry.eventCount++
  }
  
  // Merge intervals for each domain and calculate unique time
  const result = new Map<string, { uniqueMs: number; eventCount: number }>()
  
  for (const [key, data] of domainMap) {
    const merged = mergeTimeIntervals(data.intervals)
    const uniqueMs = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0)
    
    result.set(key, {
      uniqueMs,
      eventCount: data.eventCount,
    })
  }
  
  return result
}

// ============================================================
// 2.2 Category derivation
// ============================================================

// App lists for categorization (minimal v1)
const WORK_APPS = new Set([
  'cursor', 'code', 'visual studio code', 'vscode',
  'terminal', 'iterm', 'warp', 'hyper',
  'xcode', 'android studio', 'intellij', 'webstorm', 'pycharm',
  'figma', 'sketch', 'adobe xd', 'framer',
  'slack', 'discord', 'zoom', 'microsoft teams', 'google meet',
  'notion', 'obsidian', 'roam', 'logseq',
  'linear', 'jira', 'asana', 'trello', 'clickup',
  'postman', 'insomnia', 'tableplus', 'datagrip',
  'github desktop', 'sourcetree', 'tower', 'fork',
  'arc', 'safari', 'chrome', 'firefox', 'brave', 'edge', // browsers for work context
])

const MEDIA_APPS = new Set([
  'spotify', 'apple music', 'music', 'youtube music',
  'netflix', 'disney+', 'hulu', 'amazon prime video', 'hbo max',
  'vlc', 'iina', 'quicktime player', 'mpv',
  'youtube', 'twitch', 'tiktok',
  'podcast', 'podcasts', 'overcast', 'pocket casts',
  'audible', 'kindle',
])

const MEDIA_DOMAINS = new Set([
  'youtube.com', 'netflix.com', 'spotify.com', 'twitch.tv',
  'disneyplus.com', 'hulu.com', 'hbomax.com', 'primevideo.com',
  'tiktok.com', 'soundcloud.com', 'music.apple.com',
])

/**
 * Derive session kind from event data
 */
export function deriveKind(event: ActivityEvent): SessionKind {
  // AFK is always idle
  if (isAfk(event)) return 'idle'
  
  const appNameLower = event.app_name.toLowerCase()
  const domain = event.browser_domain?.toLowerCase()
  
  // Check if it's a browser with a domain
  if (domain) {
    // Media domains
    if (MEDIA_DOMAINS.has(domain)) return 'media'
    // Otherwise it's web activity
    return 'web'
  }
  
  // Check app categories
  if (MEDIA_APPS.has(appNameLower)) return 'media'
  if (WORK_APPS.has(appNameLower)) return 'work'
  
  return 'other'
}

// ============================================================
// 2.3 Build timeline segments
// ============================================================

/**
 * Convert raw events to timeline segments
 */
export function eventsToSegments(events: ActivityEvent[]): SessionSegment[] {
  return events.map((event, index) => {
    const kind = deriveKind(event)
    const duration = event.duration_ms || (event.ts_end - event.ts_start)
    
    // Determine label: prefer domain for web, otherwise app name
    let label = event.app_name
    if (kind === 'web' && event.browser_domain) {
      label = event.browser_domain
    } else if (kind === 'idle') {
      label = 'Idle'
    }
    
    return {
      id: `seg-${event.id || index}`,
      start: event.ts_start,
      end: event.ts_end,
      label,
      kind,
      appName: event.app_name,
      domain: event.browser_domain || undefined,
      eventId: event.id,
      durationMs: duration,
    }
  })
}

/**
 * Merge adjacent segments with same signature within gap threshold
 */
export function mergeAdjacentSegments(
  segments: SessionSegment[],
  gapMs: number = 60000 // 1 minute default
): SessionSegment[] {
  if (segments.length === 0) return []
  
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const merged: SessionSegment[] = []
  let current = { ...sorted[0] }
  
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]
    const gap = next.start - current.end
    const sameSignature = current.label === next.label && current.kind === next.kind
    
    if (sameSignature && gap <= gapMs) {
      // Merge: extend current segment
      current.end = next.end
      current.durationMs = current.end - current.start
    } else {
      // Push current and start new
      merged.push(current)
      current = { ...next }
    }
  }
  
  merged.push(current)
  return merged
}

// ============================================================
// 2.4 Micro-metrics
// ============================================================

/**
 * Compute micro-metrics from events
 * Uses de-duplicated time to avoid double-counting overlapping events
 */
export function computeMicroMetrics(
  events: ActivityEvent[],
  focusThresholdMs: number = 25 * 60 * 1000 // 25 minutes
): MicroMetrics {
  if (events.length === 0) {
    return {
      focusBlocks: 0,
      switches: 0,
      longestBlockMs: 0,
      totalActiveMs: 0,
      totalAfkMs: 0,
    }
  }
  
  // Calculate unique active and AFK time (without double-counting overlaps)
  const totalActiveMs = calculateUniqueActiveTime(events)
  
  // Calculate AFK time separately
  const afkIntervals = events
    .filter(e => isAfk(e))
    .map(e => ({ start: e.ts_start, end: e.ts_end }))
  const mergedAfkIntervals = mergeTimeIntervals(afkIntervals)
  const totalAfkMs = mergedAfkIntervals.reduce((sum, i) => sum + (i.end - i.start), 0)
  
  let switches = 0
  let focusBlocks = 0
  let longestBlockMs = 0
  let longestBlockLabel = ''
  
  // Track for context switches and focus blocks
  let lastSignature: string | null = null
  let currentBlockMs = 0
  let currentBlockSignature: string | null = null
  let lastEventEnd: number = 0
  
  const sortedEvents = [...events]
    .filter(e => !isAfk(e))
    .sort((a, b) => a.ts_start - b.ts_start)
  
  for (const event of sortedEvents) {
    const signature = `${event.app_name}|${event.browser_domain || ''}`
    
    // Check if this event starts after the last event ended (non-overlapping)
    const isNewSession = event.ts_start > lastEventEnd
    
    if (lastSignature !== null && lastSignature !== signature && isNewSession) {
      switches++
      
      // Check if previous block was a focus block
      if (currentBlockMs >= focusThresholdMs) {
        focusBlocks++
      }
      if (currentBlockMs > longestBlockMs) {
        longestBlockMs = currentBlockMs
        longestBlockLabel = currentBlockSignature || ''
      }
      
      // Start new block
      const duration = event.ts_end - event.ts_start
      currentBlockMs = duration
      currentBlockSignature = event.app_name
    } else if (lastSignature === signature || !isNewSession) {
      // Continue current block (same app or overlapping event)
      // For overlapping events, extend the block time to the later end
      if (event.ts_end > lastEventEnd) {
        currentBlockMs += event.ts_end - Math.max(event.ts_start, lastEventEnd)
      }
      if (!currentBlockSignature) {
        currentBlockSignature = event.app_name
      }
    } else {
      // First event
      const duration = event.ts_end - event.ts_start
      currentBlockMs = duration
      currentBlockSignature = event.app_name
    }
    
    lastSignature = signature
    lastEventEnd = Math.max(lastEventEnd, event.ts_end)
  }
  
  // Check final block
  if (currentBlockMs >= focusThresholdMs) {
    focusBlocks++
  }
  if (currentBlockMs > longestBlockMs) {
    longestBlockMs = currentBlockMs
    longestBlockLabel = currentBlockSignature || ''
  }
  
  return {
    focusBlocks,
    switches,
    longestBlockMs,
    longestBlockLabel,
    totalActiveMs,
    totalAfkMs,
  }
}

// ============================================================
// 2.5 Ranked distributions
// ============================================================

/**
 * Get top apps by usage time (de-duplicated to handle overlapping events)
 */
export function topApps(events: ActivityEvent[], limit: number = 10): RankedBar[] {
  const appTimeMap = calculateUniqueTimePerApp(events)
  
  return Array.from(appTimeMap.entries())
    .map(([key, data]) => ({
      key,
      label: data.name,
      valueMs: data.uniqueMs,
      eventCount: data.eventCount,
    }))
    .sort((a, b) => b.valueMs - a.valueMs)
    .slice(0, limit)
}

/**
 * Get top domains by usage time (de-duplicated to handle overlapping events)
 */
export function topDomains(
  events: ActivityEvent[],
  limit: number = 10,
  excludeIncognito: boolean = true
): RankedBar[] {
  const domainTimeMap = calculateUniqueTimePerDomain(events, excludeIncognito)
  
  return Array.from(domainTimeMap.entries())
    .map(([key, data]) => ({
      key,
      label: key,
      valueMs: data.uniqueMs,
      eventCount: data.eventCount,
    }))
    .sort((a, b) => b.valueMs - a.valueMs)
    .slice(0, limit)
}

// ============================================================
// 2.6 Sparkline generation
// ============================================================

/**
 * Generate sparkline data points for the date range
 */
export function generateSparkline(
  events: ActivityEvent[],
  startTs: number,
  endTs: number
): SparklinePoint[] {
  const buckets = bucketByDay(events)
  const points: SparklinePoint[] = []
  
  // Generate a point for each day in range
  const current = new Date(startOfDayLocal(startTs))
  const end = new Date(startOfDayLocal(endTs))
  
  while (current <= end) {
    const dateKey = toLocalDateKey(current)
    const dayMs = current.getTime()
    
    points.push({
      x: dayMs,
      yMs: buckets.get(dateKey) || 0,
      label: formatDate(dayMs, 'medium'),
    })
    
    current.setDate(current.getDate() + 1)
  }
  
  return points
}

/**
 * Build the attention header with sparkline
 */
export function buildAttentionHeader(
  events: ActivityEvent[],
  startTs: number,
  endTs: number,
  comparisonEvents?: ActivityEvent[]
): AttentionHeader {
  const metrics = computeMicroMetrics(events)
  const sparkline = generateSparkline(events, startTs, endTs)
  
  let deltaPct: number | null = null
  let deltaMs: number | null = null
  
  if (comparisonEvents && comparisonEvents.length > 0) {
    const comparisonMetrics = computeMicroMetrics(comparisonEvents)
    if (comparisonMetrics.totalActiveMs > 0) {
      deltaPct = ((metrics.totalActiveMs - comparisonMetrics.totalActiveMs) / comparisonMetrics.totalActiveMs) * 100
      deltaMs = metrics.totalActiveMs - comparisonMetrics.totalActiveMs
    }
  }
  
  return {
    primaryLabel: 'Active Time',
    primaryValueMs: metrics.totalActiveMs,
    deltaPct,
    deltaMs,
    sparkline,
  }
}
