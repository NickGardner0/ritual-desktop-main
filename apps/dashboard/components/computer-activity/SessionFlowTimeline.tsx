/**
 * SessionFlowTimeline
 * 
 * Horizontal session flow visualization inspired by ActivityWatch.
 * Shows stacked segments for each activity session.
 */

'use client'

import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { SessionSegment, KIND_COLORS, KIND_COLORS_ACCENT } from '@ritual/shared-contracts/computer-activity'
import { msToHuman, formatTime } from '@/lib/computerActivity/derive'

interface SessionFlowTimelineProps {
  segments: SessionSegment[]
  range: { start: number; end: number }
  onSelectSegment?: (segment: SessionSegment) => void
  selectedSegmentId?: string | null
  height?: number
  className?: string
}

/**
 * Tooltip component for segment hover - Compact frosted glass style
 * Rendered via portal to escape CSS transforms
 */
function SegmentTooltip({ 
  segment, 
  position 
}: { 
  segment: SessionSegment
  position: { x: number; y: number }
}) {
  if (typeof document === 'undefined') return null
  
  return createPortal(
    <div 
      className="fixed z-[9999] pointer-events-none"
      style={{ 
        left: position.x, 
        top: position.y - 10,
        transform: 'translate(-50%, -100%)'
      }}
    >
      <div 
        className="px-2 py-1.5 text-xs border border-gray-200/60 shadow-md whitespace-nowrap"
        style={{
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(12px) saturate(180%)',
          WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        }}
      >
        <span className="font-medium text-gray-900">{segment.label}</span>
        <span className="text-gray-400 mx-1.5">·</span>
        <span className="text-gray-500 tabular-nums">{formatTime(segment.start)} – {formatTime(segment.end)}</span>
        <span className="text-gray-400 mx-1.5">·</span>
        <span className="text-gray-900 font-medium tabular-nums">{msToHuman(segment.durationMs, true)}</span>
      </div>
    </div>,
    document.body
  )
}

export function SessionFlowTimeline({
  segments,
  range,
  onSelectSegment,
  selectedSegmentId,
  height = 24,
  className = '',
}: SessionFlowTimelineProps) {
  const [hoveredSegment, setHoveredSegment] = useState<SessionSegment | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  
  const totalDuration = range.end - range.start
  
  // Calculate segment positions
  const positionedSegments = useMemo(() => {
    if (totalDuration <= 0) return []
    
    return segments
      .filter(seg => seg.end > range.start && seg.start < range.end)
      .map(seg => {
        // Clamp to range boundaries
        const clampedStart = Math.max(seg.start, range.start)
        const clampedEnd = Math.min(seg.end, range.end)
        
        const leftPercent = ((clampedStart - range.start) / totalDuration) * 100
        const widthPercent = ((clampedEnd - clampedStart) / totalDuration) * 100
        
        return {
          ...seg,
          leftPercent,
          widthPercent,
        }
      })
      .filter(seg => seg.widthPercent > 0.1) // Filter out tiny segments
  }, [segments, range, totalDuration])
  
  const handleMouseEnter = (
    segment: SessionSegment, 
    event: React.MouseEvent
  ) => {
    setHoveredSegment(segment)
    setTooltipPosition({ x: event.clientX, y: event.clientY })
  }
  
  const handleMouseMove = (event: React.MouseEvent) => {
    if (hoveredSegment) {
      setTooltipPosition({ x: event.clientX, y: event.clientY })
    }
  }
  
  const handleMouseLeave = () => {
    setHoveredSegment(null)
  }
  
  if (segments.length === 0) {
    return (
      <div className={`relative bg-gray-100 ${className}`} style={{ height }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs text-gray-400">No activity data</span>
        </div>
      </div>
    )
  }
  
  return (
    <div className={`w-full ${className}`}>
      {/* Timeline bar */}
      <div 
        className="relative bg-gray-100 overflow-hidden"
        style={{ height }}
        onMouseMove={handleMouseMove}
      >
        {/* Activity segments */}
        {positionedSegments.map((segment) => {
          const isSelected = selectedSegmentId === segment.id
          const isHovered = hoveredSegment?.id === segment.id
          
          // Use varying opacity based on segment kind for visual interest
          const baseOpacity = segment.kind === 'work' ? 0.9 : segment.kind === 'web' ? 0.7 : 0.5
          const opacity = isHovered ? 0.6 : baseOpacity
          
          return (
            <div
              key={segment.id}
              className={`absolute top-0 bottom-0 transition-opacity cursor-pointer bg-gray-900 hover:opacity-60 ${
                isSelected ? 'ring-2 ring-gray-900 ring-offset-1 z-10' : ''
              }`}
              style={{
                left: `${segment.leftPercent}%`,
                width: `${segment.widthPercent}%`,
                opacity,
                minWidth: 2,
              }}
              onClick={() => onSelectSegment?.(segment)}
              onMouseEnter={(e) => handleMouseEnter(segment, e)}
              onMouseLeave={handleMouseLeave}
            />
          )
        })}
        
        {/* Time marker lines */}
        <div className="absolute inset-0 flex items-center justify-between pointer-events-none">
          {[0, 25, 50, 75, 100].map((percent) => (
            <div
              key={percent}
              className="w-px h-full bg-white/50"
            />
          ))}
        </div>
      </div>
      
      {/* Time labels */}
      <div className="flex justify-between mt-2">
        <span className="text-xs text-gray-500 tabular-nums">
          {formatTime(range.start)}
        </span>
        <span className="text-xs text-gray-500 tabular-nums">
          {formatTime(range.end)}
        </span>
      </div>
      
      {/* Tooltip */}
      {hoveredSegment && (
        <SegmentTooltip 
          segment={hoveredSegment} 
          position={tooltipPosition}
        />
      )}
    </div>
  )
}

/**
 * Daily stacked timeline for longer ranges (30D+)
 */
export function DailyStackedTimeline({
  segments,
  range,
  onSelectDay,
  className = '',
}: {
  segments: SessionSegment[]
  range: { start: number; end: number }
  onSelectDay?: (date: Date) => void
  className?: string
}) {
  // Group segments by day
  const dailyData = useMemo(() => {
    const days = new Map<string, { date: Date; totalMs: number; segments: SessionSegment[] }>()
    
    for (const seg of segments) {
      const dateKey = new Date(seg.start).toLocaleDateString('en-CA')
      
      if (!days.has(dateKey)) {
        days.set(dateKey, {
          date: new Date(seg.start),
          totalMs: 0,
          segments: [],
        })
      }
      
      const day = days.get(dateKey)!
      day.totalMs += seg.durationMs
      day.segments.push(seg)
    }
    
    return Array.from(days.values()).sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [segments])
  
  const maxDailyMs = Math.max(...dailyData.map(d => d.totalMs), 1)
  
  if (dailyData.length === 0) {
    return (
      <div className={`h-20 bg-gray-50 flex items-center justify-center ${className}`}>
        <span className="text-xs text-gray-400">No activity data</span>
      </div>
    )
  }
  
  return (
    <div className={`flex items-end gap-px ${className}`} style={{ height: 60 }}>
      {dailyData.map((day, i) => {
        const heightPercent = (day.totalMs / maxDailyMs) * 100
        const dayLabel = day.date.toLocaleDateString('en-US', { weekday: 'narrow' })
        
        return (
          <div
            key={day.date.toISOString()}
            className="flex-1 flex flex-col items-center cursor-pointer group"
            onClick={() => onSelectDay?.(day.date)}
          >
            <div 
              className="w-full bg-gray-300 group-hover:bg-gray-400 transition-colors"
              style={{ 
                height: `${Math.max(heightPercent, 4)}%`,
                minHeight: 2,
              }}
              title={`${day.date.toLocaleDateString()}: ${msToHuman(day.totalMs)}`}
            />
            {dailyData.length <= 14 && (
              <span className="text-[9px] text-gray-400 mt-1">{dayLabel}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default SessionFlowTimeline
