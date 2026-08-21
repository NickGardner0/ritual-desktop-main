/**
 * Computer activity contracts for the live analytics panel.
 *
 * Desktop raw/recent reads come from local activity.db.
 * Web/iOS and long-range desktop aggregates are explicit `synced`.
 */

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

export interface AttentionHeader {
  primaryLabel: string
  primaryValueMs: number
}

export interface RankedBar {
  key: string // bundle_id or domain
  label: string // display name
  valueMs: number
  subtitle?: string // optional secondary info
  eventCount?: number
}

export type ActivityBreakdownSource = 'desktop' | 'iphone'

/** Observable activity-db vs cloud result. Not a hidden fallback. */
export type ComputerActivityReadSource = 'local' | 'synced' | 'unavailable'

export interface ActivityBreakdownCapabilities {
  supportsDomains: boolean
  domainDisclosure?: string | null
  isConnected?: boolean
  setupHref?: string | null
}

export interface ComputerActivityViewModel {
  header: AttentionHeader
  apps: RankedBar[]
  domains: RankedBar[]
  range: {
    start: number
    end: number
    preset: TimeRangePreset
  }
  source?: ActivityBreakdownSource
  capabilities?: ActivityBreakdownCapabilities
  isLoading: boolean
  error?: string | null
  readSource?: ComputerActivityReadSource
}

export interface ActivityBreakdownViewModel extends ComputerActivityViewModel {
  source: ActivityBreakdownSource
  capabilities: ActivityBreakdownCapabilities
}

export type TimeRangePreset = '6H' | '12H' | '1D' | '7D' | '30D' | '90D' | 'ALL'

export interface TimeRange {
  start: number // ms epoch
  end: number   // ms epoch
  preset: TimeRangePreset
}

export type UsageBreakdownKind = 'app' | 'website'

export interface BreakdownPoint {
  date: string // YYYY-MM-DD
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

export interface ComputerActivityRangeParams {
  startDate: string
  endDate: string
}

export interface ComputerSummaryResponse {
  total_active_ms: number
  total_afk_ms: number
  total_hours?: number
  total_events?: number
  days_tracked?: number
  unique_apps?: number
  unique_domains?: number
  avg_daily_hours?: number
  source?: string
}

export interface ComputerDailyResponseRow {
  day: string
  active_hours: number
  active_ms: number
  events_count: number
  apps_count?: number
  domains_count?: number
  source?: string
}

export interface TopAppResponseRow {
  app_bundle_id: string
  app_name: string
  total_active_ms: number
  total_events: number
  hours: number
  source?: string
}

export interface TopDomainResponseRow {
  domain: string
  total_active_ms: number
  total_events: number
  hours: number
  minutes?: number
  source?: string
}

export interface AggregatedComputerStatsResponse {
  summary: ComputerSummaryResponse
  daily: ComputerDailyResponseRow[]
  apps: TopAppResponseRow[]
  domains: TopDomainResponseRow[]
  source?: string
  read_source?: ComputerActivityReadSource
  state?: string
  sync_pending?: boolean
  empty_reason?: string
}
