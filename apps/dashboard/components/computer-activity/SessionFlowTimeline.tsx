/**
 * SessionFlowTimeline
 * 
 * Horizontal session flow visualization inspired by ActivityWatch.
 * Shows stacked segments for each activity session.
 */

'use client'

import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { SessionSegment, KIND_COLORS, KIND_COLORS_ACCENT } from '@/lib/computerActivity/contracts'
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
        top: position.y - 12,
        transform: 'translate(-50%, -100%)'
      }}
    >
      <div
        className="min-w-[220px] border border-[rgba(39,37,30,0.14)] px-2.5 py-2 text-[11px] shadow-[0_12px_28px_rgba(15,23,42,0.15)]"
        style={{
          background: 'linear-gradient(150deg, rgba(255,255,255,0.88), rgba(247,248,250,0.72))',
          backdropFilter: 'blur(14px) saturate(185%)',
          WebkitBackdropFilter: 'blur(14px) saturate(185%)',
        }}
      >
        <div className="mb-1 border-b border-[rgba(39,37,30,0.08)] pb-1 text-[12px] font-medium text-[#1F2937]">
          {segment.label}
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          <span className="text-[rgba(39,37,30,0.58)]">Time</span>
          <span className="justify-self-end tabular-nums text-[rgba(39,37,30,0.82)]">
            {formatTime(segment.start)} - {formatTime(segment.end)}
          </span>
          <span className="text-[rgba(39,37,30,0.58)]">Duration</span>
          <span className="justify-self-end font-medium tabular-nums text-[#111827]">
            {msToHuman(segment.durationMs, true)}
          </span>
        </div>
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
  const midpoint = range.start + totalDuration / 2
  
  // Calculate segment positions
  const positionedSegments = useMemo(() => {
    if (totalDuration <= 0) return []
    
    return segments
      .filter(seg => seg.end > range.start && seg.start < range.end)
      .map(seg => {
        // Clamp to range boundaries
        const clampedStart = Math.max(seg.start, range.start)
        const clampedEnd = Math.min(seg.end, range.end)
        const clampedDurationMs = Math.max(0, clampedEnd - clampedStart)
        
        const leftPercent = ((clampedStart - range.start) / totalDuration) * 100
        const widthPercent = (clampedDurationMs / totalDuration) * 100
        
        return {
          ...seg,
          start: clampedStart,
          end: clampedEnd,
          durationMs: clampedDurationMs,
          leftPercent,
          widthPercent,
        }
      })
      .filter(seg => seg.widthPercent > 0.02) // Keep short sessions visible while ignoring zero-width entries
  }, [segments, range, totalDuration])

  const activeMs = useMemo(
    () => positionedSegments.reduce((sum, segment) => sum + segment.durationMs, 0),
    [positionedSegments],
  )
  const activePct = totalDuration > 0 ? Math.min(100, (activeMs / totalDuration) * 100) : 0
  const sessionCount = positionedSegments.length
  
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
      <div className={`w-full border border-[rgba(39,37,30,0.08)] bg-[rgba(39,37,30,0.015)] px-3 py-3 ${className}`}>
        <div className="relative flex items-center justify-center border border-[rgba(39,37,30,0.07)] bg-[rgba(255,255,255,0.78)]" style={{ height }}>
          <span className="text-xs text-[rgba(39,37,30,0.45)]">No activity data</span>
        </div>
      </div>
    )
  }
  
  return (
    <div className={`w-full ${className}`}>
      <div 
        className="relative overflow-hidden border border-[rgba(39,37,30,0.08)] bg-[linear-gradient(180deg,rgba(39,37,30,0.015),rgba(39,37,30,0.03))] px-2.5 py-2"
        style={{ minHeight: height + 36 }}
        onMouseMove={handleMouseMove}
      >
        <div className="mb-1 flex items-center justify-between text-[11px] leading-none">
          <span className="text-[rgba(39,37,30,0.56)] tabular-nums">{formatTime(range.start)}</span>
          <span className="text-[rgba(39,37,30,0.42)] tabular-nums">{formatTime(midpoint)}</span>
          <span className="text-[rgba(39,37,30,0.56)] tabular-nums">{formatTime(range.end)}</span>
        </div>

        <div
          className="relative overflow-hidden border border-[rgba(39,37,30,0.08)] bg-[rgba(255,255,255,0.84)]"
          style={{ height }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(39,37,30,0.02)_0%,rgba(39,37,30,0.035)_100%]" />

          <div className="pointer-events-none absolute inset-0">
            {[25, 50, 75].map((percent) => (
              <div
                key={percent}
                className="absolute top-0 bottom-0 w-px bg-[rgba(39,37,30,0.07)]"
                style={{ left: `${percent}%` }}
              />
            ))}
          </div>

          {positionedSegments.map((segment) => {
            const isSelected = selectedSegmentId === segment.id
            const isHovered = hoveredSegment?.id === segment.id

            const baseColor = KIND_COLORS[segment.kind] || '#6B7280'
            const accentColor = KIND_COLORS_ACCENT[segment.kind] || baseColor
            const baseOpacity = segment.kind === 'work' ? 0.88 : segment.kind === 'web' ? 0.76 : 0.62
            const opacity = isSelected ? 0.96 : isHovered ? 0.9 : baseOpacity
            const minWidth = segment.widthPercent < 0.15 ? 2 : 0

            return (
              <div
                key={segment.id}
                className={`absolute cursor-pointer transition-[opacity,transform,box-shadow] duration-150 ${
                  isSelected ? 'z-10' : 'z-[1]'
                }`}
                style={{
                  left: `${segment.leftPercent}%`,
                  width: `${segment.widthPercent}%`,
                  top: 2,
                  bottom: 2,
                  minWidth,
                  opacity,
                  background: `linear-gradient(180deg, ${accentColor}, ${baseColor})`,
                  boxShadow: isHovered || isSelected ? '0 0 0 1px rgba(39,37,30,0.16) inset' : 'none',
                  transform: isHovered ? 'translateY(-0.5px)' : 'translateY(0)',
                }}
                onClick={() => onSelectSegment?.(segment)}
                onMouseEnter={(e) => handleMouseEnter(segment, e)}
                onMouseLeave={handleMouseLeave}
                title={segment.label}
              />
            )
          })}
        </div>

        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[11px] text-[rgba(39,37,30,0.48)] tabular-nums">
            {Math.round(activePct)}% active
          </span>
          <span className="text-[11px] text-[rgba(39,37,30,0.52)] tabular-nums">
            {sessionCount} sessions · {msToHuman(activeMs, true)}
          </span>
        </div>
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
      <div className={`h-20 border border-[rgba(39,37,30,0.08)] bg-[rgba(39,37,30,0.015)] flex items-center justify-center ${className}`}>
        <span className="text-xs text-[rgba(39,37,30,0.45)]">No activity data</span>
      </div>
    )
  }
  
  return (
    <div className={`border border-[rgba(39,37,30,0.08)] bg-[linear-gradient(180deg,rgba(39,37,30,0.015),rgba(39,37,30,0.03))] px-2 py-2 ${className}`}>
      <div className="flex items-end gap-0.5" style={{ height: 60 }}>
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
              className="w-full bg-[#5A6474]/65 group-hover:bg-[#4B5563]/85 transition-colors"
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
    </div>
  )
}

export default SessionFlowTimeline
