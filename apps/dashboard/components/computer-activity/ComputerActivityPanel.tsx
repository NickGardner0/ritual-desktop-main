/**
 * ComputerActivityPanel
 * 
 * Main container for the redesigned Computer Activity analytics view.
 * V0-inspired design with separate cards and improved visual hierarchy.
 */

'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Monitor, RefreshCw, X } from 'lucide-react'
import { ActivityBreakdownSource, TimeRangePreset } from '@/lib/computerActivity/contracts'
import { useComputerActivity } from '@/lib/computerActivity/useComputerActivity'
import { RankedBars } from './RankedBars'
import { UsageBreakdownCard } from './UsageBreakdownCard'
import { useUsageBreakdown } from '@/hooks/use-usage-breakdown'
import { BrailleSpinner } from '@/components/ui/braille-spinner'

/**
 * Format milliseconds to human-readable time
 */
function formatActiveTime(ms: number): { value: string; unit: string } {
  const hours = ms / 1000 / 60 / 60
  if (hours >= 1) {
    return { value: hours.toFixed(1), unit: 'h' }
  }
  const minutes = ms / 1000 / 60
  return { value: Math.round(minutes).toString(), unit: 'm' }
}

const TIME_RANGES: TimeRangePreset[] = ['6H', '12H', '1D', '7D', '30D', '90D', 'ALL']
const SOURCE_OPTIONS: ActivityBreakdownSource[] = ['desktop', 'iphone']

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

interface ComputerActivityPanelProps {
  className?: string
  /** When provided, the panel uses this preset and hides its own range picker */
  externalRange?: TimeRangePreset
  /** When provided, renders a close button in the header */
  onClose?: () => void
}

export function ComputerActivityPanel({
  className = '',
  externalRange,
  onClose,
}: ComputerActivityPanelProps) {
  const [source, setSource] = useState<ActivityBreakdownSource>('desktop')
  const [usageSelection, setUsageSelection] = useState<UsageBreakdownSelection>(null)
  const [isUsageExpanded, setIsUsageExpanded] = useState(false)
  const appCardRef = useRef<HTMLDivElement | null>(null)
  const websiteCardRef = useRef<HTMLDivElement | null>(null)
  const hasExternalRange = externalRange !== undefined

  const {
    viewModel,
    range,
    setRange,
    refresh,
  } = useComputerActivity({
    initialRange: externalRange ?? '1D',
    source,
    autoRefresh: true,
    refreshIntervalMs: 60000,
  })

  // Sync with external range when it changes
  useEffect(() => {
    if (externalRange !== undefined && externalRange !== range) {
      setRange(externalRange)
    }
  }, [externalRange, range, setRange])
  
  const { header, apps, domains, isLoading, error, capabilities } = viewModel

  const breakdownRange = useMemo(() => {
    const start = toLocalDateString(viewModel.range.start)
    const end = toLocalDateString(viewModel.range.end)
    const days = diffDaysInclusive(start, end)
    let rangeLabel = 'Last 7 days'
    let hint: string | null = null
    let cappedStart = start

    switch (range) {
      case '6H':
        rangeLabel = 'Last 6 hours'
        break
      case '12H':
        rangeLabel = 'Last 12 hours'
        break
      case '1D':
        rangeLabel = 'Today'
        break
      case '7D':
        rangeLabel = 'Last 7 days'
        break
      case '30D':
        rangeLabel = 'Last 30 days'
        break
      case '90D':
        rangeLabel = 'Last 90 days'
        break
      case 'ALL':
        if (days > 120) {
          cappedStart = addDays(end, -89)
          rangeLabel = 'Last 90 days'
          hint = 'Showing last 90 days. Narrow range to see earlier days.'
        } else {
          rangeLabel = `Last ${days} days`
        }
        break
      default:
        rangeLabel = `Last ${days} days`
    }

    return {
      start: cappedStart,
      end,
      rangeLabel,
      hint,
    }
  }, [range, viewModel.range.start, viewModel.range.end])

  const { data: breakdownData, isLoading: isBreakdownLoading, error: breakdownError } = useUsageBreakdown({
    source,
    kind: usageSelection?.kind ?? 'app',
    key: usageSelection?.key ?? '',
    start: breakdownRange.start,
    end: breakdownRange.end,
    enabled: Boolean(usageSelection && isUsageExpanded),
  })

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

  useEffect(() => {
    if (source === 'iphone' && (range === '6H' || range === '12H')) {
      setRange('1D')
    }
  }, [source, range, setRange])

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

  const handleSourceChange = useCallback((nextSource: ActivityBreakdownSource) => {
    setUsageSelection(null)
    setIsUsageExpanded(false)
    setSource(nextSource)
  }, [])
  
  const hasData = apps.length > 0 || domains.length > 0 || header.primaryValueMs > 0
  const isIphone = source === 'iphone'
  const showIphoneSetup = isIphone && !isLoading && !capabilities?.isConnected
  const showIphoneWebsiteDisclosure = isIphone && !capabilities?.supportsDomains && domains.length === 0
  const visibleTimeRanges = isIphone
    ? TIME_RANGES.filter((preset) => preset !== '6H' && preset !== '12H')
    : TIME_RANGES
  
  // Format active time for display
  const activeTime = formatActiveTime(header.primaryValueMs)
  
  return (
    <div className={`rounded-sm border border-gray-200 bg-white ${className}`}>
      {/* Header */}
      <div className="border-b border-[rgba(39,37,30,0.07)] px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-[15px] font-medium tracking-[-0.02em] text-[#27251E]">Computer Time</h2>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center overflow-hidden rounded-sm border border-[rgba(39,37,30,0.09)] bg-white">
              {SOURCE_OPTIONS.map((option, index) => (
                <button
                  key={option}
                  onClick={() => handleSourceChange(option)}
                  className={`px-3 py-1.5 text-[12px] capitalize tracking-[-0.02em] transition-colors ${
                    source === option
                      ? 'bg-[rgba(39,37,30,0.06)] font-medium text-[#27251E]'
                      : 'bg-white text-[rgba(39,37,30,0.5)] hover:bg-[rgba(39,37,30,0.03)] hover:text-[#27251E]'
                  } ${index !== 0 ? 'border-l border-[rgba(39,37,30,0.09)]' : ''}`}
                >
                  {option === 'iphone' ? 'iPhone' : 'Desktop'}
                </button>
              ))}
            </div>

            {!hasExternalRange && (
              <div className="flex items-center overflow-hidden rounded-sm border border-[rgba(39,37,30,0.09)] bg-white">
                {visibleTimeRanges.map((r, index) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`px-2.5 py-1.5 text-[12px] tracking-[-0.02em] transition-colors ${
                      range === r
                        ? 'bg-[rgba(39,37,30,0.06)] font-medium text-[#27251E]'
                        : 'bg-white text-[rgba(39,37,30,0.5)] hover:bg-[rgba(39,37,30,0.03)] hover:text-[#27251E]'
                    } ${index !== 0 ? 'border-l border-[rgba(39,37,30,0.09)]' : ''}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={refresh}
              className="inline-flex h-[31px] w-[31px] items-center justify-center rounded-sm border border-[rgba(39,37,30,0.09)] bg-white text-[rgba(39,37,30,0.42)] transition-colors hover:bg-[rgba(39,37,30,0.03)] hover:text-[#27251E]"
              title="Refresh data"
              disabled={isLoading}
            >
              {isLoading ? <BrailleSpinner className="text-sm text-gray-600" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>

            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-[31px] w-[31px] items-center justify-center rounded-sm border border-[rgba(39,37,30,0.09)] bg-white text-[rgba(39,37,30,0.42)] transition-colors hover:text-[#27251E]"
                aria-label="Close expanded view"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}

          </div>
        </div>
      </div>
      
      {/* Loading State */}
      {isLoading && !hasData && (
        <div className="flex items-center justify-center h-48 px-5">
          <BrailleSpinner className="text-base text-gray-600" />
        </div>
      )}
      
      {/* Error State */}
      {error && (
        <div className="px-5 py-6 text-center">
          <p className="text-sm text-red-500">{error}</p>
          <button
            onClick={refresh}
            className="mt-2 text-xs text-gray-500 hover:text-gray-700"
          >
            Try again
          </button>
        </div>
      )}

      {showIphoneSetup && (
        <div className="flex flex-col items-center justify-center h-48 px-5 text-center">
          <Monitor className="w-10 h-10 text-gray-200 mb-3" />
          <p className="text-sm text-gray-600 mb-1">No iPhone Screen Time data yet</p>
          <p className="text-xs text-gray-400 max-w-sm mb-4">
            Connect the Ritual iPhone companion and enable Screen Time access to see iPhone activity here.
          </p>
          <a
            href={capabilities?.setupHref || '/integrations'}
            className="inline-flex items-center px-3 py-2 text-xs font-medium text-gray-900 border border-gray-200 rounded-sm hover:bg-[#F3F3F3] transition-colors"
          >
            Open Integrations
          </a>
        </div>
      )}
      
      {/* Empty State */}
      {!isLoading && !error && !hasData && !showIphoneSetup && (
        <div className="flex flex-col items-center justify-center h-48 px-5 text-center">
          <Monitor className="w-10 h-10 text-gray-200 mb-3" />
          <p className="text-sm text-gray-500 mb-1">{isIphone ? 'No iPhone activity tracked' : 'No activity tracked'}</p>
          <p className="text-xs text-gray-400 max-w-sm">
            {isIphone
              ? 'Open the Ritual iPhone companion and keep Screen Time sync enabled to populate this view.'
              : 'Enable Ritual Watcher in Settings → Computer Use to start monitoring.'}
          </p>
        </div>
      )}
      
      {/* Content */}
      {!error && hasData && (
        <div className="space-y-4 px-4 pb-4 pt-4">
          {isIphone && (
            <div className="text-[12px] font-medium tracking-[-0.02em] text-[rgba(39,37,30,0.46)]">
              From Ritual iPhone companion via Screen Time
            </div>
          )}

          <div className="rounded-sm border border-gray-200 bg-white px-5 py-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[rgba(39,37,30,0.42)]">
              Active Time
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-[30px] font-semibold leading-none tracking-[-0.04em] text-[#27251E] tabular-nums">
                {activeTime.value}
              </span>
              <span className="text-[14px] font-medium leading-[18px] text-[rgba(39,37,30,0.62)]">
                {activeTime.unit}
              </span>
            </div>
            <div className="mt-3 text-[12px] font-medium tracking-[-0.02em] text-[rgba(39,37,30,0.56)]">
              Across selected range
            </div>
          </div>

          {/* App Usage Section - Two Cards */}
          <div className="overflow-x-auto">
            <div className="grid min-w-[760px] gap-4 md:grid-cols-2">
            {/* TOP APPS Card */}
            <div className="flex max-h-[460px] min-h-0 flex-col rounded-sm border border-gray-200 bg-white p-4" ref={appCardRef}>
              <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[rgba(39,37,30,0.42)]">
                Top Apps
              </h3>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
                <RankedBars 
                  items={apps} 
                  maxVisible={Infinity} 
                  type="apps"
                  selectedKey={usageSelection?.kind === 'app' ? usageSelection.key : null}
                  onSelect={(item) => handleUsageSelect('app', item.key, item.label)}
                />
              </div>
              {usageSelection?.kind === 'app' && (
                <div
                  className={`transition-all duration-200 ease-out overflow-hidden ${
                    isUsageExpanded ? 'max-h-[420px] opacity-100 mt-3' : 'max-h-0 opacity-0 pointer-events-none'
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
            </div>
            
            {/* TOP WEBSITES Card */}
            <div className="flex max-h-[460px] min-h-0 flex-col rounded-sm border border-gray-200 bg-white p-4" ref={websiteCardRef}>
              <h3 className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[rgba(39,37,30,0.42)]">
                Top Websites
              </h3>
              {showIphoneWebsiteDisclosure ? (
                <div className="py-8 text-center">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
                    <Monitor className="w-5 h-5 text-gray-300" />
                  </div>
                  <p className="text-sm text-gray-500 mb-2">No mobile website detail yet</p>
                  <p className="text-xs text-gray-400 max-w-xs mx-auto">
                    {capabilities?.domainDisclosure}
                  </p>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
                  <RankedBars 
                    items={domains} 
                    maxVisible={Infinity} 
                    type="domains"
                    selectedKey={usageSelection?.kind === 'website' ? usageSelection.key : null}
                    onSelect={(item) => handleUsageSelect('website', item.key, item.label)}
                  />
                </div>
              )}
              {usageSelection?.kind === 'website' && (
                <div
                  className={`transition-all duration-200 ease-out overflow-hidden ${
                    isUsageExpanded ? 'max-h-[420px] opacity-100 mt-3' : 'max-h-0 opacity-0 pointer-events-none'
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
                    hint={isIphone ? (capabilities?.domainDisclosure || breakdownRange.hint) : breakdownRange.hint}
                    onClose={() => setIsUsageExpanded(false)}
                  />
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      )}
      
    </div>
  )
}

export default ComputerActivityPanel
