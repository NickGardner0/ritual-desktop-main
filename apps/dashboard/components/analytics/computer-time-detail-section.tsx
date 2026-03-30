'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { type TimeRangePreset } from '@/lib/computerActivity/contracts'
import {
  getComputerTimeSummary,
  getTopApps,
  getTopDomains,
} from '@/lib/computerActivity/client'
import { RankedBars } from '@/components/computer-activity/RankedBars'
import { UsageBreakdownCard } from '@/components/computer-activity/UsageBreakdownCard'
import { useUsageBreakdown } from '@/hooks/use-usage-breakdown'
import { BrailleSpinner } from '@/components/ui/braille-spinner'
import { perfError, perfInfo, startPerfTimer } from '@/lib/perf-debug'

const TIME_RANGES: { value: TimeRangePreset; label: string }[] = [
  { value: '6H', label: '6H' },
  { value: '12H', label: '12H' },
  { value: '1D', label: '1D' },
  { value: '7D', label: '7D' },
  { value: '30D', label: '30D' },
  { value: '90D', label: '90D' },
  { value: 'ALL', label: 'All' },
]

type UsageBreakdownSelection =
  | { kind: 'app'; key: string; label: string }
  | { kind: 'website'; key: string; label: string }
  | null

function toLocalDateString(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(value: string, days: number): string {
  const date = parseLocalDate(value)
  date.setDate(date.getDate() + days)
  return toLocalDateString(date.getTime())
}

function diffDaysInclusive(start: string, end: string): number {
  const startDate = parseLocalDate(start)
  const endDate = parseLocalDate(end)
  const diffMs = endDate.getTime() - startDate.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1
}

function formatActiveTime(ms: number): string {
  const hours = ms / 1000 / 60 / 60
  if (hours >= 1) return `${hours.toFixed(1)}h`
  const minutes = ms / 1000 / 60
  return `${Math.round(minutes)}m`
}

function getTimeRangeMs(preset: TimeRangePreset): { start: number; end: number } {
  const now = Date.now()
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  switch (preset) {
    case '6H':
      return { start: now - 6 * 60 * 60 * 1000, end: now }
    case '12H':
      return { start: now - 12 * 60 * 60 * 1000, end: now }
    case '1D':
      return { start: now - 24 * 60 * 60 * 1000, end: now }
    case '7D':
      return { start: new Date(now - 6 * 24 * 60 * 60 * 1000).setHours(0, 0, 0, 0), end: endOfToday.getTime() }
    case '30D':
      return { start: new Date(now - 29 * 24 * 60 * 60 * 1000).setHours(0, 0, 0, 0), end: endOfToday.getTime() }
    case '90D':
      return { start: new Date(now - 89 * 24 * 60 * 60 * 1000).setHours(0, 0, 0, 0), end: endOfToday.getTime() }
    case 'ALL':
      return { start: new Date(now - 364 * 24 * 60 * 60 * 1000).setHours(0, 0, 0, 0), end: endOfToday.getTime() }
    default:
      return { start: new Date(now).setHours(0, 0, 0, 0), end: endOfToday.getTime() }
  }
}

function RangePills({ range, setRange }: { range: TimeRangePreset; setRange: (r: TimeRangePreset) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {TIME_RANGES.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setRange(opt.value)}
          className={`text-[11px] px-2 py-0.5 transition-colors ${
            range === opt.value
              ? 'font-medium text-[#27251E]'
              : 'font-normal text-[rgba(39,37,30,0.35)] hover:text-[rgba(39,37,30,0.55)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

interface ComputerTimeDetailSectionProps {
  externalRange?: TimeRangePreset
}

export function ComputerTimeDetailSection({ externalRange }: ComputerTimeDetailSectionProps) {
  const [range, setRange] = useState<TimeRangePreset>(externalRange ?? '1D')
  const [summaryActiveMs, setSummaryActiveMs] = useState(0)
  const [apps, setApps] = useState<any[]>([])
  const [domains, setDomains] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usageSelection, setUsageSelection] = useState<UsageBreakdownSelection>(null)
  const [isUsageExpanded, setIsUsageExpanded] = useState(false)
  const appCardRef = useRef<HTMLDivElement | null>(null)
  const websiteCardRef = useRef<HTMLDivElement | null>(null)
  const fetchIdRef = useRef(0)
  const mountTimeRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now())
  const firstUsablePaintLoggedRef = useRef(false)

  useEffect(() => {
    perfInfo('computer-time-detail-section', 'mount', {
      external_range: externalRange ?? null,
      initial_range: range,
    })
  }, [])

  useEffect(() => {
    if (externalRange) {
      setRange(externalRange)
    }
  }, [externalRange])

  const rangeWindow = useMemo(() => getTimeRangeMs(range), [range])

  useEffect(() => {
    let cancelled = false
    const fetchId = ++fetchIdRef.current

    async function load() {
      const stopTimer = startPerfTimer('computer-time-detail-section', 'load', {
        range,
      })
      setIsLoading(true)
      setError(null)

      try {
        const startDate = toLocalDateString(rangeWindow.start)
        const endDate = toLocalDateString(rangeWindow.end)

        const [summaryResult, topAppsResult, topDomainsResult] = await Promise.allSettled([
          getComputerTimeSummary({ startDate, endDate }),
          getTopApps({ startDate, endDate }, 12),
          getTopDomains({ startDate, endDate }, 12),
        ])

        if (cancelled || fetchId !== fetchIdRef.current) return

        const summary =
          summaryResult.status === 'fulfilled'
            ? Math.max(0, Number(summaryResult.value.total_active_ms || 0))
            : 0
        const topApps =
          topAppsResult.status === 'fulfilled'
            ? topAppsResult.value
                .filter((row) => Number(row.total_active_ms || 0) > 0)
                .map((row) => ({
                  key: row.app_bundle_id || row.app_name || 'unknown-app',
                  label: row.app_name || row.app_bundle_id || 'Unknown App',
                  valueMs: Math.max(0, Number(row.total_active_ms || 0)),
                  eventCount: Math.max(0, Number(row.total_events || 0)),
                }))
            : []
        const topDomains =
          topDomainsResult.status === 'fulfilled'
            ? topDomainsResult.value
                .filter((row) => Number(row.total_active_ms || 0) > 0)
                .map((row) => ({
                  key: row.domain || 'unknown-domain',
                  label: row.domain || 'Unknown',
                  valueMs: Math.max(0, Number(row.total_active_ms || 0)),
                  eventCount: Math.max(0, Number(row.total_events || 0)),
                }))
            : []

        setSummaryActiveMs(summary)
        setApps(topApps)
        setDomains(topDomains)

        const failedCount = [summaryResult, topAppsResult, topDomainsResult].filter(
          (result) => result.status === 'rejected',
        ).length
        const hasAnyData = summary > 0 || topApps.length > 0 || topDomains.length > 0
        setError(failedCount > 0 && !hasAnyData ? 'Failed to load computer activity' : null)
        stopTimer({
          success: failedCount === 0 || hasAnyData,
          failed_count: failedCount,
          has_any_data: hasAnyData,
          summary_active_ms: summary,
          app_rows: topApps.length,
          domain_rows: topDomains.length,
        })
      } catch (err) {
        if (cancelled || fetchId !== fetchIdRef.current) return
        setError(err instanceof Error ? err.message : 'Failed to load computer activity')
        setApps([])
        setDomains([])
        perfError('computer-time-detail-section', 'load-failed', {
          error: err instanceof Error ? err.message : String(err),
          range,
        })
        stopTimer({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        if (!cancelled && fetchId === fetchIdRef.current) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [rangeWindow.end, rangeWindow.start])

  useEffect(() => {
    if (firstUsablePaintLoggedRef.current) return
    if (isLoading) return
    if (apps.length === 0 && domains.length === 0 && summaryActiveMs <= 0 && !error) return

    firstUsablePaintLoggedRef.current = true
    const end = typeof performance !== 'undefined' ? performance.now() : Date.now()
    perfInfo('computer-time-detail-section', 'first-usable-paint', {
      duration_ms: Number((end - mountTimeRef.current).toFixed(2)),
      range,
      app_rows: apps.length,
      domain_rows: domains.length,
      summary_active_ms: summaryActiveMs,
      has_error: Boolean(error),
    })
  }, [apps.length, domains.length, error, isLoading, range, summaryActiveMs])

  const breakdownRange = useMemo(() => {
    const start = toLocalDateString(rangeWindow.start)
    const end = toLocalDateString(rangeWindow.end)
    const days = diffDaysInclusive(start, end)
    let rangeLabel = 'Last 7 days'
    let hint: string | null = null
    let cappedStart = start

    switch (range) {
      case '6H': rangeLabel = 'Last 6 hours'; break
      case '12H': rangeLabel = 'Last 12 hours'; break
      case '1D': rangeLabel = 'Today'; break
      case '7D': rangeLabel = 'Last 7 days'; break
      case '30D': rangeLabel = 'Last 30 days'; break
      case '90D': rangeLabel = 'Last 90 days'; break
      case 'ALL':
        if (days > 120) {
          cappedStart = addDays(end, -89)
          rangeLabel = 'Last 90 days'
          hint = 'Showing last 90 days. Narrow range to see earlier days.'
        } else {
          rangeLabel = `Last ${days} days`
        }
        break
      default: rangeLabel = `Last ${days} days`
    }

    return { start: cappedStart, end, rangeLabel, hint }
  }, [range, rangeWindow.end, rangeWindow.start])

  const { data: breakdownData, isLoading: isBreakdownLoading, error: breakdownError } = useUsageBreakdown({
    source: 'desktop',
    kind: usageSelection?.kind ?? 'app',
    key: usageSelection?.key ?? '',
    start: breakdownRange.start,
    end: breakdownRange.end,
    enabled: Boolean(usageSelection && isUsageExpanded),
  })

  // Close usage breakdown on click outside
  useEffect(() => {
    if (!isUsageExpanded || !usageSelection) return
    const container = usageSelection.kind === 'app' ? appCardRef.current : websiteCardRef.current
    if (!container) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!container.contains(event.target as Node)) {
        setIsUsageExpanded(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isUsageExpanded, usageSelection])

  const handleUsageSelect = useCallback((kind: 'app' | 'website', key: string, label: string) => {
    setUsageSelection((prev) => {
      if (prev && prev.kind === kind && prev.key === key) {
        setIsUsageExpanded((expanded) => !expanded)
        return prev
      }
      setIsUsageExpanded(true)
      return { kind, key, label }
    })
  }, [])

  const hasData = apps.length > 0 || domains.length > 0 || summaryActiveMs > 0
  const activeTimeStr = formatActiveTime(summaryActiveMs)

  if (!isLoading && !hasData && !error) return null

  return (
    <div className="mt-[5px] grid grid-cols-1 lg:grid-cols-2 gap-[5px]">
      {/* Top Apps Card */}
      <div className="border border-[rgba(39,37,30,0.08)] bg-white rounded-lg overflow-hidden flex min-h-[320px] flex-col h-full" ref={appCardRef}>
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0">
              <span className="text-[13px] font-medium text-[#27251E] pr-3 py-1">Active Time</span>
              {hasData && (
                <span className="text-[13px] font-normal tabular-nums text-[rgba(39,37,30,0.40)]">
                  {activeTimeStr}
                </span>
              )}
              {isLoading && (
                <BrailleSpinner className="text-xs text-gray-400 ml-2" />
              )}
            </div>
            <RangePills range={range} setRange={setRange} />
          </div>
        </div>

        {error && (
          <div className="px-5 pb-4 text-center">
            <p className="text-[12px] text-red-500">{error}</p>
          </div>
        )}

        {hasData && (
          <>
            <div className="flex-1 min-h-[180px] overflow-y-auto overflow-x-hidden px-3 pb-1">
              <RankedBars
                items={apps}
                maxVisible={Infinity}
                type="apps"
                showTooltip={false}
                showIcons
                selectedKey={usageSelection?.kind === 'app' ? usageSelection.key : null}
                onSelect={(item) => handleUsageSelect('app', item.key, item.label)}
              />
            </div>
            {usageSelection?.kind === 'app' && (
              <div
                className={`transition-all duration-200 ease-out overflow-hidden px-3 ${
                  isUsageExpanded ? 'max-h-[420px] opacity-100 pb-3' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
                aria-hidden={!isUsageExpanded}
              >
                <UsageBreakdownCard
                  kind="app"
                  label={usageSelection.label}
                  itemKey={usageSelection.key}
                  rangeLabel={breakdownRange.rangeLabel}
                  startDate={breakdownRange.start}
                  endDate={breakdownRange.end}
                  points={breakdownData?.points || []}
                  totalSeconds={breakdownData?.totalSeconds || 0}
                  totalMs={breakdownData?.totalMs}
                  isLoading={isBreakdownLoading}
                  error={breakdownError instanceof Error ? breakdownError.message : null}
                  hint={breakdownRange.hint}
                  onClose={() => setIsUsageExpanded(false)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Top Websites Card */}
      <div className="border border-[rgba(39,37,30,0.08)] bg-white rounded-lg overflow-hidden flex min-h-[320px] flex-col h-full" ref={websiteCardRef}>
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#27251E] py-1">Top Websites</span>
            <RangePills range={range} setRange={setRange} />
          </div>
        </div>

        {hasData && (
          <>
            <div className="flex-1 min-h-[180px] overflow-y-auto overflow-x-hidden px-3 pb-1">
              <RankedBars
                items={domains}
                maxVisible={Infinity}
                type="domains"
                showTooltip={false}
                showIcons
                selectedKey={usageSelection?.kind === 'website' ? usageSelection.key : null}
                onSelect={(item) => handleUsageSelect('website', item.key, item.label)}
              />
            </div>
            {usageSelection?.kind === 'website' && (
              <div
                className={`transition-all duration-200 ease-out overflow-hidden px-3 ${
                  isUsageExpanded ? 'max-h-[420px] opacity-100 pb-3' : 'max-h-0 opacity-0 pointer-events-none'
                }`}
                aria-hidden={!isUsageExpanded}
              >
                <UsageBreakdownCard
                  kind="website"
                  label={usageSelection.label}
                  itemKey={usageSelection.key}
                  rangeLabel={breakdownRange.rangeLabel}
                  startDate={breakdownRange.start}
                  endDate={breakdownRange.end}
                  points={breakdownData?.points || []}
                  totalSeconds={breakdownData?.totalSeconds || 0}
                  totalMs={breakdownData?.totalMs}
                  isLoading={isBreakdownLoading}
                  error={breakdownError instanceof Error ? breakdownError.message : null}
                  hint={breakdownRange.hint}
                  onClose={() => setIsUsageExpanded(false)}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
