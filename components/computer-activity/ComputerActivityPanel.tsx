/**
 * ComputerActivityPanel
 * 
 * Main container for the redesigned Computer Activity analytics view.
 * V0-inspired design with separate cards and improved visual hierarchy.
 */

'use client'

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense, useMemo } from 'react'
import { Monitor, BarChart3, AppWindow, Globe, RefreshCw, CheckCircle, X, Download, Search, Sparkles } from 'lucide-react'
import { TimeRangePreset } from '@/types/computerActivity'
import { useComputerActivity } from '@/lib/computerActivity/useComputerActivity'
import { SessionFlowTimeline, DailyStackedTimeline } from './SessionFlowTimeline'
import { RankedBars } from './RankedBars'
import { DeepDrillDrawer } from './DeepDrillDrawer'
import { UsageBreakdownCard } from './UsageBreakdownCard'
import { useUsageBreakdown } from '@/hooks/use-usage-breakdown'

// Lazy load semantic search to avoid loading the model until needed
const SemanticSearch = lazy(() => import('../screen-recorder/SemanticSearch').then(m => ({ default: m.SemanticSearch })))

// Export types
interface ExportEvent {
  id: number
  ts_start: number
  ts_end: number
  duration_ms: number
  app_bundle_id: string
  app_name: string
  window_title?: string | null
  browser_url?: string | null
  browser_domain?: string | null
  is_afk: boolean
  is_incognito: boolean
}

type ExportFormat = 'csv' | 'json'

/**
 * Export activity data to file
 */
async function exportActivityData(
  startDate: string,
  endDate: string,
  format: ExportFormat
): Promise<{ success: boolean; filename?: string; error?: string }> {
  try {
    // Check if we're in Tauri environment
    if (typeof window !== 'undefined' && (window as any).__TAURI__) {
      const { invoke } = await import('@tauri-apps/api/tauri')
      const { downloadDir } = await import('@tauri-apps/api/path')
      const { writeTextFile } = await import('@tauri-apps/api/fs')
      
      // Get events from Tauri
      const events = await invoke<ExportEvent[]>('export_events', {
        startDate,
        endDate,
      })
      
      if (!events || events.length === 0) {
        return { success: false, error: 'No activity data found for this date range' }
      }
      
      // Format the data
      let content: string
      let filename: string
      const timestamp = new Date().toISOString().split('T')[0]
      
      if (format === 'json') {
        content = JSON.stringify(events, null, 2)
        filename = `ritual-activity-${startDate}-to-${endDate}-${timestamp}.json`
      } else {
        // CSV format
        const headers = [
          'Start Time',
          'End Time',
          'Duration (min)',
          'App Name',
          'App Bundle ID',
          'Window Title',
          'Browser URL',
          'Browser Domain',
          'Is AFK',
          'Is Incognito'
        ]
        
        const rows = events.map(e => [
          new Date(e.ts_start).toISOString(),
          new Date(e.ts_end).toISOString(),
          ((e.ts_end - e.ts_start) / 1000 / 60).toFixed(2),
          e.app_name,
          e.app_bundle_id,
          e.window_title || '',
          e.browser_url || '',
          e.browser_domain || '',
          e.is_afk ? 'true' : 'false',
          e.is_incognito ? 'true' : 'false'
        ])
        
        content = [
          headers.join(','),
          ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ].join('\n')
        filename = `ritual-activity-${startDate}-to-${endDate}-${timestamp}.csv`
      }
      
      // Save to Downloads folder
      const downloads = await downloadDir()
      const filepath = `${downloads}${filename}`
      await writeTextFile(filepath, content)
      
      return { success: true, filename }
    }
    
    return { success: false, error: 'Export is only available in the desktop app' }
  } catch (error) {
    console.error('Export failed:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Export failed' }
  }
}

/**
 * Sync computer time to the "Computer Use" habit
 * This ensures the dashboard habit stays in sync with actual activity
 */
async function syncToComputerUseHabit(): Promise<void> {
  try {
    const response = await fetch('/api/watcher/sync-to-habit', {
      method: 'POST',
    })
    
    if (response.ok) {
      const result = await response.json()
      if (result.success && result.synced) {
        console.log(`✅ Synced computer time to habit: ${result.amount} ${result.unit}`)
      }
    }
  } catch (e) {
    // Silently fail - this is a background sync
    console.debug('Failed to sync computer time to habit:', e)
  }
}

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

type ViewTab = 'overview' | 'apps' | 'websites' | 'search'

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
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced'>('idle')
  const [usageSelection, setUsageSelection] = useState<UsageBreakdownSelection>(null)
  const [isUsageExpanded, setIsUsageExpanded] = useState(false)
  const appCardRef = useRef<HTMLDivElement | null>(null)
  const websiteCardRef = useRef<HTMLDivElement | null>(null)
  
  // Export state
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportStartDate, setExportStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toISOString().split('T')[0]
  })
  const [exportEndDate, setExportEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv')
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'success' | 'error'>('idle')
  const [exportMessage, setExportMessage] = useState('')
  
  // Handle export
  const handleExport = useCallback(async () => {
    setExportStatus('exporting')
    setExportMessage('')
    
    const result = await exportActivityData(exportStartDate, exportEndDate, exportFormat)
    
    if (result.success) {
      setExportStatus('success')
      setExportMessage(`Saved to Downloads: ${result.filename}`)
      setTimeout(() => {
        setShowExportModal(false)
        setExportStatus('idle')
        setExportMessage('')
      }, 2000)
    } else {
      setExportStatus('error')
      setExportMessage(result.error || 'Export failed')
    }
  }, [exportStartDate, exportEndDate, exportFormat])
  
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
  
  const { header, segments, apps, domains, micro, isLoading, error } = viewModel

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
  
  // Track if we've already synced this session to avoid excessive API calls
  const hasSyncedRef = useRef(false)
  
  // Wrapped sync function with status tracking
  const doSync = useCallback(async () => {
    setSyncStatus('syncing')
    await syncToComputerUseHabit()
    setSyncStatus('synced')
    // Reset to idle after a brief display
    setTimeout(() => setSyncStatus('idle'), 2000)
  }, [])
  
  // Sync to "Computer Use" habit when we have data (1D range = today)
  useEffect(() => {
    // Only sync when viewing today's data and we have actual activity
    if (range === '1D' && hasData && header.primaryValueMs > 0 && !hasSyncedRef.current && !isLoading) {
      hasSyncedRef.current = true
      doSync()
    }
  }, [range, hasData, header.primaryValueMs, isLoading, doSync])
  
  // Also sync periodically (every 5 minutes) if viewing today
  useEffect(() => {
    if (range !== '1D') return
    
    const interval = setInterval(() => {
      if (hasData && header.primaryValueMs > 0) {
        doSync()
      }
    }, 5 * 60 * 1000) // 5 minutes
    
    return () => clearInterval(interval)
  }, [range, hasData, header.primaryValueMs, doSync])
  
  // Format active time for display
  const activeTime = formatActiveTime(header.primaryValueMs)
  
  return (
    <div className={`bg-white border border-gray-200 ${className}`}>
      {/* Header */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-900">Computer Activity</h2>
          <div className="flex items-center gap-1">
            {/* Sync status indicator */}
            {syncStatus === 'synced' && (
              <span className="flex items-center gap-1 text-xs text-green-600 animate-fade-in mr-2">
                <CheckCircle className="w-3.5 h-3.5" />
                Synced
              </span>
            )}
            {syncStatus === 'syncing' && (
              <span className="text-xs text-gray-400 mr-2">Syncing...</span>
            )}
            <button
              onClick={() => setShowExportModal(true)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3] transition-colors"
              title="Export data"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={refresh}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-[#F3F3F3] transition-colors"
              title="Refresh data"
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
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
              { id: 'search', label: 'AI Search', icon: Sparkles },
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
          <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
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
      {!error && hasData && activeTab !== 'search' && (
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

          {/* Focus Stats - Inline compact row */}
          <div className="flex items-center gap-6 text-sm pt-1">
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400">Focus blocks</span>
              <span className="font-medium text-gray-900">{micro.focusBlocks}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400">Switches</span>
              <span className="font-medium text-gray-900">{micro.switches}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400">Longest</span>
              <span className="font-medium text-gray-900">{micro.longestBlockLabel || '0m'}</span>
            </div>
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
      
      {/* Semantic Search View */}
      {activeTab === 'search' && (
        <div className="px-5 pb-5">
          <Suspense fallback={
            <div className="flex items-center justify-center h-48">
              <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            </div>
          }>
            <SemanticSearch className="border-0 shadow-none" />
          </Suspense>
        </div>
      )}
      
      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Download className="w-5 h-5 text-gray-600" />
                <h3 className="text-lg font-medium text-gray-900">Export Activity Data</h3>
              </div>
              <button
                onClick={() => {
                  setShowExportModal(false)
                  setExportStatus('idle')
                  setExportMessage('')
                }}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="px-5 py-4 space-y-4">
              {/* Date Range */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date Range
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Start</label>
                    <input
                      type="date"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">End</label>
                    <input
                      type="date"
                      value={exportEndDate}
                      onChange={(e) => setExportEndDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
              
              {/* Quick Presets */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const today = new Date().toISOString().split('T')[0]
                    setExportStartDate(today)
                    setExportEndDate(today)
                  }}
                  className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Today
                </button>
                <button
                  onClick={() => {
                    const end = new Date()
                    const start = new Date()
                    start.setDate(start.getDate() - 7)
                    setExportStartDate(start.toISOString().split('T')[0])
                    setExportEndDate(end.toISOString().split('T')[0])
                  }}
                  className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Last 7 Days
                </button>
                <button
                  onClick={() => {
                    const end = new Date()
                    const start = new Date()
                    start.setDate(start.getDate() - 30)
                    setExportStartDate(start.toISOString().split('T')[0])
                    setExportEndDate(end.toISOString().split('T')[0])
                  }}
                  className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Last 30 Days
                </button>
                <button
                  onClick={() => {
                    const end = new Date()
                    const start = new Date('2020-01-01')
                    setExportStartDate(start.toISOString().split('T')[0])
                    setExportEndDate(end.toISOString().split('T')[0])
                  }}
                  className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  All Time
                </button>
              </div>
              
              {/* Format Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Export Format
                </label>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="exportFormat"
                      value="csv"
                      checked={exportFormat === 'csv'}
                      onChange={() => setExportFormat('csv')}
                      className="w-4 h-4 text-gray-900 focus:ring-gray-900"
                    />
                    <span className="text-sm text-gray-700">CSV (Excel, Sheets)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="exportFormat"
                      value="json"
                      checked={exportFormat === 'json'}
                      onChange={() => setExportFormat('json')}
                      className="w-4 h-4 text-gray-900 focus:ring-gray-900"
                    />
                    <span className="text-sm text-gray-700">JSON (Developers)</span>
                  </label>
                </div>
              </div>
              
              {/* Status Message */}
              {exportMessage && (
                <div className={`text-sm px-3 py-2 rounded ${
                  exportStatus === 'success' 
                    ? 'bg-green-50 text-green-700' 
                    : 'bg-red-50 text-red-700'
                }`}>
                  {exportMessage}
                </div>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-5 py-4 bg-gray-50 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowExportModal(false)
                  setExportStatus('idle')
                  setExportMessage('')
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={exportStatus === 'exporting'}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {exportStatus === 'exporting' ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Export to Downloads
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ComputerActivityPanel
