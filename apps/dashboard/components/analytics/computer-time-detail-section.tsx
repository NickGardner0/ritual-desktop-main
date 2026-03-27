'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { type TimeRangePreset } from '@/lib/computerActivity/contracts'
import { useComputerActivity } from '@/lib/computerActivity/useComputerActivity'
import { RankedBars } from '@/components/computer-activity/RankedBars'
import { UsageBreakdownCard } from '@/components/computer-activity/UsageBreakdownCard'
import { useUsageBreakdown } from '@/hooks/use-usage-breakdown'
import { BrailleSpinner } from '@/components/ui/braille-spinner'

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

export function ComputerTimeDetailSection() {
  const [usageSelection, setUsageSelection] = useState<UsageBreakdownSelection>(null)
  const [isUsageExpanded, setIsUsageExpanded] = useState(false)
  const appCardRef = useRef<HTMLDivElement | null>(null)
  const websiteCardRef = useRef<HTMLDivElement | null>(null)

  const {
    viewModel,
    range,
    setRange,
    refresh,
  } = useComputerActivity({
    initialRange: '1D',
    source: 'desktop',
    autoRefresh: true,
    refreshIntervalMs: 60000,
  })

  const { header, apps, domains, isLoading, error } = viewModel

  const breakdownRange = useMemo(() => {
    const start = toLocalDateString(viewModel.range.start)
    const end = toLocalDateString(viewModel.range.end)
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
  }, [range, viewModel.range.start, viewModel.range.end])

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

  const hasData = apps.length > 0 || domains.length > 0 || header.primaryValueMs > 0
  const activeTimeStr = formatActiveTime(header.primaryValueMs)

  if (!isLoading && !hasData && !error) return null

  return (
    <div className="mt-[5px] grid grid-cols-1 lg:grid-cols-2 gap-[5px]">
      {/* Top Apps Card */}
      <div className="border border-[rgba(39,37,30,0.08)] bg-white rounded-lg overflow-hidden flex flex-col h-full" ref={appCardRef}>
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
            <div className="flex-1 min-h-0 max-h-[420px] overflow-y-auto overflow-x-hidden px-3 pb-1">
              <RankedBars
                items={apps}
                maxVisible={Infinity}
                type="apps"
                showTooltip={false}
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
      <div className="border border-[rgba(39,37,30,0.08)] bg-white rounded-lg overflow-hidden flex flex-col h-full" ref={websiteCardRef}>
        <div className="px-5 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#27251E] py-1">Top Websites</span>
            <RangePills range={range} setRange={setRange} />
          </div>
        </div>

        {hasData && (
          <>
            <div className="flex-1 min-h-0 max-h-[420px] overflow-y-auto overflow-x-hidden px-3 pb-1">
              <RankedBars
                items={domains}
                maxVisible={Infinity}
                type="domains"
                showTooltip={false}
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
