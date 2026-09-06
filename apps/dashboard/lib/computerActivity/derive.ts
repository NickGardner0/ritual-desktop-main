/**
 * Computer Activity Data Transformers
 * 
 * Pure functions to derive analytics from raw activity events.
 * These run on the client after fetching data from Tauri.
 */

import {
  ActivityEvent,
  RankedBar,
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
