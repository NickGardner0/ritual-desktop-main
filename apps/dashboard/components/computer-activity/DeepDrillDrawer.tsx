/**
 * DeepDrillDrawer
 * 
 * Expandable detail panel for selected segment.
 * Shows session details and constituent events.
 */

'use client'

import React from 'react'
import { X, Clock, AppWindow, Globe, Eye, EyeOff } from 'lucide-react'
import { SessionSegment, DrillDownData, ActivityEvent, KIND_COLORS } from '@ritual/shared-contracts/computer-activity'
import { msToHuman, formatTime, formatDate, isAfk } from '@/lib/computerActivity/derive'
import { BrailleSpinner } from '@/components/ui/braille-spinner'

interface DeepDrillDrawerProps {
  data: DrillDownData | null
  isLoading?: boolean
  onClose: () => void
  privacyMode?: 'full' | 'truncate' | 'hash' | 'off'
  className?: string
}

export function DeepDrillDrawer({
  data,
  isLoading = false,
  onClose,
  privacyMode = 'off',
  className = '',
}: DeepDrillDrawerProps) {
  if (!data && !isLoading) return null
  
  const { segment, events, totalDurationMs } = data || {
    segment: null,
    events: [],
    totalDurationMs: 0,
  }
  
  // Filter out titles/URLs based on privacy mode
  const shouldShowTitles = privacyMode === 'full' || privacyMode === 'truncate'
  const shouldShowUrls = privacyMode === 'full' || privacyMode === 'truncate'
  
  return (
    <div className={`border-t border-gray-200 bg-white ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          {segment && (
            <>
              <div 
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: KIND_COLORS[segment.kind] }}
              />
              <div>
                <h3 className="text-sm font-medium text-gray-900">{segment.label}</h3>
                <p className="text-xs text-gray-400">
                  {formatTime(segment.start)} – {formatTime(segment.end)}
                  <span className="mx-1.5">·</span>
                  {msToHuman(totalDurationMs)}
                </p>
              </div>
            </>
          )}
          {isLoading && (
            <div className="flex items-center gap-2">
              <BrailleSpinner className="text-sm text-gray-600" />
              <span className="text-sm text-gray-500">Loading details...</span>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-200 rounded transition-colors"
          aria-label="Close details"
        >
          <X className="w-4 h-4 text-gray-400" />
        </button>
      </div>
      
      {/* Events list */}
      {!isLoading && events.length > 0 && (
        <div className="max-h-48 overflow-y-auto">
          <div className="divide-y divide-gray-100">
            {events.slice(0, 20).map((event, index) => (
              <EventRow 
                key={event.id || index} 
                event={event}
                showTitle={shouldShowTitles}
                showUrl={shouldShowUrls}
              />
            ))}
          </div>
          {events.length > 20 && (
            <div className="px-4 py-2 text-xs text-gray-400 text-center border-t border-gray-100">
              +{events.length - 20} more events
            </div>
          )}
        </div>
      )}
      
      {/* Empty state */}
      {!isLoading && events.length === 0 && segment && (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-gray-400">No detailed events available</p>
        </div>
      )}
      
      {/* Privacy notice */}
      {privacyMode === 'off' && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <EyeOff className="w-3 h-3" />
            <span>Window titles hidden (privacy mode: off)</span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Single event row in the drill-down
 */
function EventRow({
  event,
  showTitle = false,
  showUrl = false,
}: {
  event: ActivityEvent
  showTitle?: boolean
  showUrl?: boolean
}) {
  const duration = event.duration_ms || (event.ts_end - event.ts_start)
  const afk = isAfk(event)
  
  return (
    <div className={`flex items-start gap-3 px-4 py-2 ${afk ? 'opacity-50' : ''}`}>
      {/* Time */}
      <span className="text-xs text-gray-400 tabular-nums w-14 flex-shrink-0 pt-0.5">
        {formatTime(event.ts_start)}
      </span>
      
      {/* Icon */}
      <div className="w-5 h-5 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
        {event.browser_domain ? (
          <Globe className="w-3 h-3 text-gray-400" />
        ) : (
          <AppWindow className="w-3 h-3 text-gray-400" />
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700 truncate">
            {event.app_name}
          </span>
          {event.browser_domain && (
            <span className="text-xs text-gray-400 truncate">
              ({event.browser_domain})
            </span>
          )}
          {afk && (
            <span className="text-xs text-gray-400 italic">idle</span>
          )}
        </div>
        
        {/* Window title */}
        {showTitle && event.window_title && (
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {event.window_title}
          </p>
        )}
        
        {/* URL */}
        {showUrl && event.browser_url && (
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {event.browser_url}
          </p>
        )}
      </div>
      
      {/* Duration */}
      <span className="text-xs font-medium text-gray-500 tabular-nums flex-shrink-0">
        {msToHuman(duration, true)}
      </span>
    </div>
  )
}

export default DeepDrillDrawer

