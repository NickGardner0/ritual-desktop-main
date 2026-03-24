'use client'

export interface NormalizedComputerDailyRow {
  day: string
  active_hours: number
  active_ms: number
  events_count: number
  apps_count?: number
  domain_count?: number
}

function sanitizeDailyActiveHours(rawHours: number): number {
  if (!Number.isFinite(rawHours) || rawHours < 0) {
    return 0
  }

  return Math.min(rawHours, 24)
}

export function normalizeComputerDailySummaryRow(row: any): NormalizedComputerDailyRow | null {
  if (!row || typeof row !== 'object') return null

  const day = String(row.date ?? row.day ?? '').trim()
  if (!day) return null

  const activeMsRaw =
    row.total_active_ms ??
    row.totalActiveMs ??
    row.active_ms ??
    row.activeMs ??
    0

  const totalHoursRaw =
    row.total_hours ??
    row.totalHours ??
    row.active_hours ??
    row.activeHours ??
    0

  const eventCountRaw =
    row.event_count ??
    row.eventCount ??
    row.events_count ??
    row.eventsCount ??
    0

  const appCountRaw = row.app_count ?? row.appCount ?? row.apps_count ?? row.appsCount
  const domainCountRaw = row.domain_count ?? row.domainCount ?? row.domains_count ?? row.domainsCount

  const activeMs = Math.max(0, Number(activeMsRaw || 0))
  const derivedHoursFromMs = activeMs > 0 ? activeMs / (1000 * 60 * 60) : null
  const fallbackHours = sanitizeDailyActiveHours(Number(totalHoursRaw || 0))
  const activeHours = derivedHoursFromMs !== null ? derivedHoursFromMs : fallbackHours

  return {
    day,
    active_hours: Math.round(activeHours * 1000000) / 1000000,
    active_ms: activeMs > 0 ? activeMs : Math.round(fallbackHours * 60 * 60 * 1000),
    events_count: Math.max(0, Number(eventCountRaw || 0)),
    apps_count: appCountRaw == null ? undefined : Math.max(0, Number(appCountRaw || 0)),
    domain_count: domainCountRaw == null ? undefined : Math.max(0, Number(domainCountRaw || 0)),
  }
}
