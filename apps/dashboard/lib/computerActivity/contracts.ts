export interface ActivityEvent {
  id: number
  ts_start: number
  ts_end: number
  app_bundle_id: string
  app_name: string
  window_title?: string | null
  window_title_hash?: string | null
  is_afk: boolean | 0 | 1
  browser_domain?: string | null
  browser_url?: string | null
  is_incognito: boolean | 0 | 1
  duration_ms?: number
}

export type SessionKind = 'work' | 'web' | 'media' | 'idle' | 'other'

export interface SessionSegment {
  id: string
  start: number
  end: number
  label: string
  kind: SessionKind
  appName?: string
  domain?: string
  eventId?: number
  durationMs: number
}

export interface SparklinePoint {
  x: number
  yMs: number
  label?: string
}

export interface AttentionHeader {
  primaryLabel: string
  primaryValueMs: number
  deltaPct?: number | null
  deltaMs?: number | null
  sparkline: SparklinePoint[]
}

export interface RankedBar {
  key: string
  label: string
  valueMs: number
  subtitle?: string
  eventCount?: number
}

export interface MicroMetrics {
  focusBlocks: number
  switches: number
  longestBlockMs: number
  longestBlockLabel?: string
  totalActiveMs: number
  totalAfkMs: number
}

export type ActivityBreakdownSource = 'desktop' | 'iphone'

export interface ActivityBreakdownCapabilities {
  supportsDomains: boolean
  domainDisclosure?: string | null
  isConnected?: boolean
  setupHref?: string | null
}

export interface ComputerActivityViewModel {
  header: AttentionHeader
  segments: SessionSegment[]
  apps: RankedBar[]
  domains: RankedBar[]
  micro: MicroMetrics
  range: {
    start: number
    end: number
    preset: TimeRangePreset
  }
  source?: ActivityBreakdownSource
  capabilities?: ActivityBreakdownCapabilities
  isLoading: boolean
  error?: string | null
}

export interface ActivityBreakdownViewModel extends ComputerActivityViewModel {
  source: ActivityBreakdownSource
  capabilities: ActivityBreakdownCapabilities
}

export type TimeRangePreset = '6H' | '12H' | '1D' | '7D' | '30D' | '90D' | 'ALL'

export interface TimeRange {
  start: number
  end: number
  preset: TimeRangePreset
}

export interface DailyRollup {
  date: string
  totalActiveMs: number
  totalAfkMs: number
  appCount: number
  domainCount: number
  eventCount: number
}

export interface DrillDownData {
  segment: SessionSegment
  events: ActivityEvent[]
  totalDurationMs: number
}

export type UsageBreakdownKind = 'app' | 'website'

export interface BreakdownPoint {
  date: string
  seconds: number
  activeMs: number
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
  totalMs: number
}

export const KIND_COLORS: Record<SessionKind, string> = {
  work: '#374151',
  web: '#6B7280',
  media: '#9CA3AF',
  idle: '#E5E7EB',
  other: '#D1D5DB',
}

export const KIND_COLORS_ACCENT: Record<SessionKind, string> = {
  work: '#1F2937',
  web: '#3B82F6',
  media: '#8B5CF6',
  idle: '#D1D5DB',
  other: '#9CA3AF',
}
