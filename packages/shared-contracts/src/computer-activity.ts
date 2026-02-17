/**
 * Computer Activity Types
 * 
 * Data models for the redesigned Computer Activity analytics view.
 * Inspired by Perplexity Finance + ActivityWatch.
 * 
 * DATA SOURCES:
 * - Sparkline series: derived from get_activity_timeline() bucketed by day
 * - Timeline sessions: get_activity_timeline() events transformed to segments
 * - Ranked apps list: derived from timeline events, grouped by app_name
 * - Ranked domains list: derived from timeline events, grouped by browser_domain
 * - Micro-metrics: computed from timeline events (switches, focus blocks, longest)
 * - Drill-down detail: get_detailed_activity() for selected time slice
 */

// ============================================================
// 1.1 Base event (from watcher via Tauri)
// ============================================================

export interface ActivityEvent {
  id: number
  ts_start: number // ms epoch
  ts_end: number   // ms epoch
  app_bundle_id: string
  app_name: string
  window_title?: string | null
  window_title_hash?: string | null
  is_afk: boolean | 0 | 1
  browser_domain?: string | null
  browser_url?: string | null
  is_incognito: boolean | 0 | 1
  duration_ms?: number // computed or from API
}

// ============================================================
// 1.2 Derived session (for timeline visualization)
// ============================================================

export type SessionKind = 'work' | 'web' | 'media' | 'idle' | 'other'

export interface SessionSegment {
  id: string // stable key (event id or derived)
  start: number // ms epoch
  end: number   // ms epoch
  label: string // app_name or domain or "Idle"
  kind: SessionKind
  appName?: string
  domain?: string
  eventId?: number
  durationMs: number
}

// ============================================================
// 1.3 Summary + series types
// ============================================================

export interface SparklinePoint {
  x: number  // date as ms epoch (start of day)
  yMs: number // total active ms for that day
  label?: string // formatted date for tooltip
}

export interface AttentionHeader {
  primaryLabel: string // "Total" or "Active Time"
  primaryValueMs: number
  deltaPct?: number | null // % change vs comparison period
  deltaMs?: number | null // absolute change in ms
  sparkline: SparklinePoint[]
}

export interface RankedBar {
  key: string // bundle_id or domain
  label: string // display name
  valueMs: number
  subtitle?: string // optional secondary info
  eventCount?: number
}

export interface MicroMetrics {
  focusBlocks: number // count of blocks >= 25 min
  switches: number // context switch count
  longestBlockMs: number // longest continuous block
  longestBlockLabel?: string // app/domain of longest block
  totalActiveMs: number
  totalAfkMs: number
}

// ============================================================
// 1.4 Complete view model
// ============================================================

export interface ComputerActivityViewModel {
  header: AttentionHeader
  segments: SessionSegment[] // for selected range
  apps: RankedBar[]
  domains: RankedBar[]
  micro: MicroMetrics
  range: {
    start: number
    end: number
    preset: TimeRangePreset
  }
  isLoading: boolean
  error?: string | null
}

// ============================================================
// 1.5 Time range presets
// ============================================================

export type TimeRangePreset = '6H' | '12H' | '1D' | '7D' | '30D' | '90D' | 'ALL'

export interface TimeRange {
  start: number // ms epoch
  end: number   // ms epoch
  preset: TimeRangePreset
}

// ============================================================
// 1.6 Daily rollup for efficient querying
// ============================================================

export interface DailyRollup {
  date: string // YYYY-MM-DD
  totalActiveMs: number
  totalAfkMs: number
  appCount: number
  domainCount: number
  eventCount: number
}

// ============================================================
// 1.7 Drill-down detail for selected segment
// ============================================================

export interface DrillDownData {
  segment: SessionSegment
  events: ActivityEvent[]
  totalDurationMs: number
}

// ============================================================
// 1.9 Usage breakdown
// ============================================================

export type UsageBreakdownKind = 'app' | 'website'

export interface BreakdownPoint {
  date: string // YYYY-MM-DD
  seconds: number
  startTime?: string | null
  endTime?: string | null
}

export interface BreakdownResponse {
  kind: UsageBreakdownKind
  key: string
  start: string
  end: string
  points: BreakdownPoint[]
  totalSeconds: number
}

// ============================================================
// 1.8 Category colors (muted grayscale palette)
// ============================================================

export const KIND_COLORS: Record<SessionKind, string> = {
  work: '#374151',   // gray-700
  web: '#6B7280',    // gray-500
  media: '#9CA3AF',  // gray-400
  idle: '#E5E7EB',   // gray-200
  other: '#D1D5DB',  // gray-300
}

// Slightly more colorful variants for hover/focus
export const KIND_COLORS_ACCENT: Record<SessionKind, string> = {
  work: '#1F2937',   // gray-800
  web: '#3B82F6',    // blue-500
  media: '#8B5CF6',  // violet-500
  idle: '#D1D5DB',   // gray-300
  other: '#9CA3AF',  // gray-400
}

