/**
 * SessionFlowTimeline
 * 
 * Horizontal session flow visualization inspired by ActivityWatch.
 * Shows stacked segments for each activity session.
 */

'use client'

import React, { useMemo, useState } from 'react'
import { SessionSegment, KIND_COLORS, KIND_COLORS_ACCENT } from '@/types/computerActivity'
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
 * Tooltip component for segment hover - Frosted glass style
 */
function SegmentTooltip({ 
  segment, 
  position 
}: { 
  segment: SessionSegment
  position: { x: number; y: number }
}) {
  return (
    <div 
      className="fixed z-50 pointer-events-none"
      style={{ 
        left: position.x, 
        top: position.y - 70,
        transform: 'translateX(-50%)'
      }}
    >
      <div 
        className="px-3 py-2 text-xs border border-gray-200/60 shadow-lg"
        style={{
          background: 'rgba(255, 255, 255, 0.82)',
          backdropFilter: 'blur(12px) saturate(180%)',
          WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        }}
      >
        <p className="font-medium text-gray-900 mb-1">{segment.label}</p>
        <div className="flex items-center gap-3 text-gray-500">
          <span>{formatTime(segment.start)} – {formatTime(segment.end)}</span>
          <span className="text-gray-900 font-semibold tabular-nums">{msToHuman(segment.durationMs, true)}</span>
        </div>
      </div>
    </div>
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
    <div className={`relative ${className}`}>
      {/* Timeline bar */}
      <div 
        className="relative bg-gray-100 overflow-hidden"
        style={{ height }}
        onMouseMove={handleMouseMove}
      >
        {positionedSegments.map((segment) => {
          const isSelected = selectedSegmentId === segment.id
          const isHovered = hoveredSegment?.id === segment.id
          const color = isHovered || isSelected 
            ? KIND_COLORS_ACCENT[segment.kind] 
            : KIND_COLORS[segment.kind]
          
          return (
            <div
              key={segment.id}
              className={`absolute top-0 bottom-0 transition-all duration-150 cursor-pointer ${
                isSelected ? 'ring-2 ring-gray-900 ring-offset-1 z-10' : ''
              } ${isHovered ? 'brightness-110' : ''}`}
              style={{
                left: `${segment.leftPercent}%`,
                width: `${segment.widthPercent}%`,
                backgroundColor: color,
                minWidth: 2,
              }}
              onClick={() => onSelectSegment?.(segment)}
              onMouseEnter={(e) => handleMouseEnter(segment, e)}
              onMouseLeave={handleMouseLeave}
            />
          )
        })}
      </div>
      
      {/* Time labels */}
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-gray-400 tabular-nums">
          {formatTime(range.start)}
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums">
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
      const dateKey = new Date(seg.start).toISOString().split('T')[0]
      
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

