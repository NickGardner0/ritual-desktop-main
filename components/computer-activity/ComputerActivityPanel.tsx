/**
 * ComputerActivityPanel
 * 
 * Main container for the redesigned Computer Activity analytics view.
 * Combines all components into a single minimal surface.
 */

'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Monitor, BarChart3, AppWindow, Globe, RefreshCw, CheckCircle, X } from 'lucide-react'
import { TimeRangePreset } from '@/types/computerActivity'
import { useComputerActivity } from '@/lib/computerActivity/useComputerActivity'
import { AttentionIndexHeader } from './AttentionIndexHeader'
import { SessionFlowTimeline, DailyStackedTimeline } from './SessionFlowTimeline'
import { RankedBars } from './RankedBars'
import { MicroMetricsRow } from './MicroMetricsRow'
import { DeepDrillDrawer } from './DeepDrillDrawer'

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

type ViewTab = 'overview' | 'apps' | 'websites'

const TIME_RANGES: TimeRangePreset[] = ['6H', '12H', '1D', '7D', '30D', '90D', 'ALL']

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
  
  return (
    <div className={`bg-[#FAFAF9] border border-gray-300 ${className}`}>
      {/* Header - Row 1: Title and close */}
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-center justify-between mb-6">
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
              onClick={refresh}
              className="p-1.5 hover:bg-[#F3F3F3] transition-colors"
              title="Refresh data"
              disabled={isLoading}
            >
              <RefreshCw className={`w-4 h-4 text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="p-1.5 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>
        
        {/* Row 2: Time Range (left) and View Tabs (right) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Time Range Selector - matches analytics expanded view exactly */}
          <div className="flex items-center gap-0.5 p-1 bg-white border border-gray-200 shadow-sm">
            {TIME_RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs transition-all duration-200 ${
                  range === r
                    ? 'bg-[#F3F3F3] text-gray-900 font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-[#F3F3F3] font-normal'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          
          {/* View Tabs - same bordered card style as time range */}
          <div className="flex items-center gap-0.5 p-1 bg-white border border-gray-200 shadow-sm">
            {(['overview', 'apps', 'websites'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-all duration-200 ${
                  activeTab === tab
                    ? 'bg-[#F3F3F3] text-gray-900 font-medium shadow-sm'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-[#F3F3F3] font-normal'
                }`}
              >
                {tab === 'overview' && <BarChart3 className="w-3.5 h-3.5" />}
                {tab === 'apps' && <AppWindow className="w-3.5 h-3.5" />}
                {tab === 'websites' && <Globe className="w-3.5 h-3.5" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Loading State */}
      {isLoading && !hasData && (
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        </div>
      )}
      
      {/* Error State */}
      {error && (
        <div className="px-6 py-8 text-center">
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
        <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
          <Monitor className="w-14 h-14 text-gray-200 mb-4" />
          <p className="text-base text-gray-500 mb-1">No activity tracked</p>
          <p className="text-sm text-gray-400 max-w-sm">
            Enable Ritual Watcher in Settings → Computer Tracking to start monitoring.
          </p>
        </div>
      )}
      
      {/* Content */}
      {!error && hasData && (
        <div className="divide-y divide-gray-100">
          {/* Section A: Attention Header */}
          <div className="px-6 py-4">
            <AttentionIndexHeader header={header} />
          </div>
          
          {/* Section B: Timeline */}
          <div className="px-6 py-4">
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
          
          {/* Section C: Distribution (tab-specific) */}
          <div className="px-6 py-4">
            {activeTab === 'overview' && (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                    Top Apps
                  </h3>
                  <RankedBars items={apps} maxVisible={5} type="apps" />
                </div>
                <div>
                  <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                    Top Websites
                  </h3>
                  <RankedBars items={domains} maxVisible={5} type="domains" />
                </div>
              </div>
            )}
            
            {activeTab === 'apps' && (
              <div>
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                  Apps by Usage
                </h3>
                <RankedBars items={apps} maxVisible={10} type="apps" />
              </div>
            )}
            
            {activeTab === 'websites' && (
              <div>
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
                  Websites by Usage
                </h3>
                <RankedBars items={domains} maxVisible={10} type="domains" />
              </div>
            )}
          </div>
          
          {/* Section D: Micro-metrics */}
          <div className="px-6 py-3 bg-gray-50/50">
            <MicroMetricsRow metrics={micro} />
          </div>
          
          {/* Section E: Deep Drill (when segment selected) */}
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

