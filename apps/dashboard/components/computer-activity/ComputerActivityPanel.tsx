/**
 * ComputerActivityPanel
 * 
 * Main container for the redesigned Computer Activity analytics view.
 * V0-inspired design with separate cards and improved visual hierarchy.
 */

'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Monitor, BarChart3, Globe, RefreshCw, X } from 'lucide-react'
import { TimeRangePreset } from '@ritual/shared-contracts/computer-activity'
import { useComputerActivity } from '@/lib/computerActivity/useComputerActivity'
import { SessionFlowTimeline, DailyStackedTimeline } from './SessionFlowTimeline'
import { RankedBars } from './RankedBars'
import { DeepDrillDrawer } from './DeepDrillDrawer'
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

type ViewTab = 'overview' | 'apps' | 'websites'

const TIME_RANGES: TimeRangePreset[] = ['6H', '12H', '1D', '7D', '30D', '90D', 'ALL']

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
  onDismiss?: () => void
}

export function ComputerActivityPanel({ 
  className = '',
  onDismiss,
}: ComputerActivityPanelProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>('overview')
  const [usageSelection, setUsageSelection] = useState<UsageBreakdownSelection>(null)
  const [isUsageExpanded, setIsUsageExpanded] = useState(false)
  const appCardRef = useRef<HTMLDivElement | null>(null)
  const websiteCardRef = useRef<HTMLDivElement | null>(null)
  
  const {
    viewModel,
    range,
    setRange,
    refresh,
    selectedSegment,
    selectSegment,
    drillDownData,
    isDrillLoading,
  } = useComputerActivity({
    initialRange: '1D',
    autoRefresh: true,
    refreshIntervalMs: 60000,
  })
  
  const { header, segments, apps, domains, isLoading, error } = viewModel

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
  
  // Determine if we should show daily stacked view (for longer ranges)
  const showDailyStacked = range === '30D' || range === '90D' || range === 'ALL'
  
  const hasData = segments.length > 0 || apps.length > 0 || domains.length > 0
  
  // Format active time for display
  const activeTime = formatActiveTime(header.primaryValueMs)
  
  return (
    <div className={`bg-white border border-gray-200 ${className}`}>
      {/* Header */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-900">Computer Activity</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3] transition-colors"
              title="Refresh data"
              disabled={isLoading}
            >
              {isLoading ? <BrailleSpinner className="text-sm text-gray-600" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3] transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Time Range Selector */}
          <div className="flex items-center border border-gray-200">
            {TIME_RANGES.map((r, index) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2.5 py-1.5 text-xs transition-colors ${
                  range === r
                    ? 'bg-[#F3F3F3] text-gray-900 font-medium'
                    : 'bg-white text-gray-500 hover:text-gray-900 hover:bg-[#F3F3F3]'
                } ${index !== 0 ? 'border-l border-gray-200' : ''}`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* View Tabs */}
          <div className="flex items-center border border-gray-200">
            {([
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'apps', label: 'Apps', icon: Monitor },
              { id: 'websites', label: 'Websites', icon: Globe },
            ] as const).map((tab, index) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[#F3F3F3] text-gray-900 font-medium'
                    : 'bg-white text-gray-500 hover:text-gray-900 hover:bg-[#F3F3F3]'
                } ${index !== 0 ? 'border-l border-gray-200' : ''}`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
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
      
      {/* Empty State */}
      {!isLoading && !error && !hasData && (
        <div className="flex flex-col items-center justify-center h-48 px-5 text-center">
          <Monitor className="w-10 h-10 text-gray-200 mb-3" />
          <p className="text-sm text-gray-500 mb-1">No activity tracked</p>
          <p className="text-xs text-gray-400 max-w-sm">
            Enable Ritual Watcher in Settings → Computer Tracking to start monitoring.
          </p>
        </div>
      )}
      
      {/* Content */}
      {!error && hasData && (
        <div className="px-5 pb-5 space-y-4">
          {/* Active Time + Timeline Card */}
          <div className="p-4 border border-gray-200 bg-white">
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-3xl font-semibold text-gray-900 tabular-nums">
                {activeTime.value}{activeTime.unit}
              </span>
              <span className="text-sm text-gray-400">Active Time</span>
            </div>
            
            {/* Timeline */}
            {showDailyStacked ? (
              <DailyStackedTimeline
                segments={segments}
                range={viewModel.range}
              />
            ) : (
              <SessionFlowTimeline
                segments={segments}
                range={viewModel.range}
                onSelectSegment={selectSegment}
                selectedSegmentId={selectedSegment?.id}
                height={28}
              />
            )}
          </div>

          {/* App Usage Section - Two Cards */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* TOP APPS Card */}
            {(activeTab === 'overview' || activeTab === 'apps') && (
              <div className="p-4 border border-gray-200 bg-white" ref={appCardRef}>
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                  Top Apps
                </h3>
                <RankedBars 
                  items={apps} 
                  maxVisible={activeTab === 'apps' ? 10 : 3} 
                  type="apps"
                  selectedKey={usageSelection?.kind === 'app' ? usageSelection.key : null}
                  onSelect={(item) => handleUsageSelect('app', item.key, item.label)}
                />
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
                      isLoading={isBreakdownLoading}
                      error={breakdownError instanceof Error ? breakdownError.message : null}
                      hint={breakdownRange.hint}
                      onClose={() => setIsUsageExpanded(false)}
                    />
                  </div>
                )}
              </div>
            )}
            
            {/* TOP WEBSITES Card */}
            {(activeTab === 'overview' || activeTab === 'websites') && (
              <div className="p-4 border border-gray-200 bg-white" ref={websiteCardRef}>
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                  Top Websites
                </h3>
                <RankedBars 
                  items={domains} 
                  maxVisible={activeTab === 'websites' ? 10 : 5} 
                  type="domains"
                  selectedKey={usageSelection?.kind === 'website' ? usageSelection.key : null}
                  onSelect={(item) => handleUsageSelect('website', item.key, item.label)}
                />
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
                      isLoading={isBreakdownLoading}
                      error={breakdownError instanceof Error ? breakdownError.message : null}
                      hint={breakdownRange.hint}
                      onClose={() => setIsUsageExpanded(false)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Deep Drill Drawer (when segment selected) */}
          {(selectedSegment || isDrillLoading) && (
            <DeepDrillDrawer
              data={drillDownData}
              isLoading={isDrillLoading}
              onClose={() => selectSegment(null)}
            />
          )}
        </div>
      )}
      
    </div>
  )
}

export default ComputerActivityPanel
