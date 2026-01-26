"use client"

import React, { useRef, useCallback, useMemo, useEffect, useState } from 'react'
import { format, subDays, parseISO } from 'date-fns'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Types
interface HabitLog {
  id: string
  habit_id: string
  date: string
  amount?: number
  duration?: number
  status?: string
}

interface DailyDataPoint {
  date: string
  dateObj: Date
  hasData: boolean
  habitValues: Record<string, number>
}

interface HistoryScrubberProps {
  habitLogs: HabitLog[]
  habits: Array<{ id?: string; name: string; unit_type?: string }>
  daysToShow?: number
  onHoverDate: (date: string | null, values: Record<string, number> | null) => void
  onSelectDate: (date: string | null) => void
  selectedDate: string | null
  className?: string
  /** Visual variant: 'ambient' for thin/subtle Overview, 'detailed' for Metrics */
  variant?: 'ambient' | 'detailed'
}

// Precompute daily series from habit logs
function computeDailySeries(
  habitLogs: HabitLog[],
  habits: Array<{ id?: string; name: string; unit_type?: string }>,
  daysToShow: number
): DailyDataPoint[] {
  const today = new Date()
  const series: DailyDataPoint[] = []
  
  const logsByDateAndHabit = new Map<string, Map<string, number>>()
  
  habitLogs.forEach(log => {
    if (log.status && log.status !== 'completed' && log.status !== 'success') return
    
    const dateKey = log.date?.split('T')[0]
    if (!dateKey) return
    
    if (!logsByDateAndHabit.has(dateKey)) {
      logsByDateAndHabit.set(dateKey, new Map())
    }
    
    const dateMap = logsByDateAndHabit.get(dateKey)!
    const habitId = log.habit_id
    
    const currentVal = dateMap.get(habitId) || 0
    const logValue = log.duration ? log.duration / 60 : (log.amount || 1)
    dateMap.set(habitId, currentVal + logValue)
  })
  
  for (let i = daysToShow - 1; i >= 0; i--) {
    const date = subDays(today, i)
    const dateKey = format(date, 'yyyy-MM-dd')
    const habitMap = logsByDateAndHabit.get(dateKey) || new Map()
    
    const habitValues: Record<string, number> = {}
    habits.forEach(habit => {
      if (habit.id) {
        habitValues[habit.id] = habitMap.get(habit.id) || 0
      }
    })
    
    series.push({
      date: dateKey,
      dateObj: date,
      hasData: habitMap.size > 0,
      habitValues
    })
  }
  
  return series
}

// Gaussian function for smooth ripple effect
function gaussian(x: number, mean: number, sigma: number): number {
  return Math.exp(-((x - mean) ** 2) / (2 * sigma ** 2))
}

export function HistoryScrubber({
  habitLogs,
  habits,
  daysToShow = 90,
  onHoverDate,
  onSelectDate,
  selectedDate,
  className,
  variant = 'ambient'
}: HistoryScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  
  // Number of ticks - dense but subtle
  const numTicks = 120
  
  // Ambient dimensions - subtle, control-like (not chart-like)
  const svgHeight = 24
  const barMaxHeight = 18
  
  // Precompute daily series
  const dailySeries = useMemo(
    () => computeDailySeries(habitLogs, habits, daysToShow),
    [habitLogs, habits, daysToShow]
  )
  
  // Map tick index to day index
  const tickToDayIndex = useCallback((tickIndex: number): number => {
    return Math.floor((tickIndex / numTicks) * dailySeries.length)
  }, [dailySeries.length])
  
  // Find selected tick
  const selectedTick = useMemo(() => {
    if (!selectedDate) return null
    const dayIndex = dailySeries.findIndex(d => d.date === selectedDate)
    if (dayIndex === -1) return null
    return Math.floor((dayIndex / dailySeries.length) * numTicks)
  }, [selectedDate, dailySeries])
  
  // RAF-throttled hover handler
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (rafRef.current) return
    
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      
      if (!containerRef.current) return
      
      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const width = rect.width
      
      const tickIndex = Math.floor((x / width) * numTicks)
      const clampedTick = Math.max(0, Math.min(numTicks - 1, tickIndex))
      
      if (clampedTick !== hoveredIndex) {
        setHoveredIndex(clampedTick)
        const dayIndex = tickToDayIndex(clampedTick)
        const day = dailySeries[dayIndex]
        if (day) {
          onHoverDate(day.date, day.habitValues)
        }
      }
    })
  }, [numTicks, hoveredIndex, tickToDayIndex, dailySeries, onHoverDate])
  
  const handlePointerEnter = useCallback(() => {
    setIsHovering(true)
  }, [])
  
  const handlePointerLeave = useCallback(() => {
    setIsHovering(false)
    setHoveredIndex(null)
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    onHoverDate(null, null)
  }, [onHoverDate])
  
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return
    
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const width = rect.width
    
    const tickIndex = Math.floor((x / width) * numTicks)
    const clampedTick = Math.max(0, Math.min(numTicks - 1, tickIndex))
    const dayIndex = tickToDayIndex(clampedTick)
    const day = dailySeries[dayIndex]
    
    if (day) {
      if (selectedDate === day.date) {
        onSelectDate(null)
      } else {
        onSelectDate(day.date)
      }
    }
  }, [numTicks, tickToDayIndex, dailySeries, selectedDate, onSelectDate])
  
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])
  
  // Get hovered day info for label
  const hoveredDay = hoveredIndex !== null ? dailySeries[tickToDayIndex(hoveredIndex)] : null
  
  // Calculate bar height - uniform for ambient, subtle ripple on hover
  const getBarHeight = useCallback((tickIndex: number): number => {
    // Ambient: uniform height, subtle ripple on hover
    const baseHeight = 0.6 // 60% base - uniform texture
    
    if (!isHovering || hoveredIndex === null) {
      return baseHeight
    }
    
    // Very subtle ripple - just enough to show position
    const sigma = 8
    const ripple = gaussian(tickIndex, hoveredIndex, sigma)
    const maxHeight = 1.0
    
    return baseHeight + (maxHeight - baseHeight) * ripple * 0.5
  }, [isHovering, hoveredIndex])

  // Generate tick array
  const ticks = useMemo(() => Array.from({ length: numTicks }, (_, i) => i), [numTicks])

  // Current display date (hovered or selected)
  const displayDate = hoveredDay?.dateObj || (selectedDate ? parseISO(selectedDate) : null)
  
  // Calculate tooltip position based on hovered index
  const tooltipLeft = hoveredIndex !== null ? `${(hoveredIndex / numTicks) * 100}%` : '50%'
  
  return (
    <div className={cn("relative px-1", className)}>
      {/* Tooltip above scrubber - only shows on hover */}
      {isHovering && displayDate && (
        <div 
          className="absolute -top-6 transform -translate-x-1/2 pointer-events-none z-10"
          style={{ left: tooltipLeft }}
        >
          <span className="text-xs text-gray-500 bg-white px-1.5 py-0.5 rounded shadow-sm border border-gray-200 whitespace-nowrap">
            {format(displayDate, 'MMM d, yyyy')}
          </span>
        </div>
      )}
      
      {/* Scrubber - full width, aligned with habit rows */}
      <div
        ref={containerRef}
        className="relative w-full cursor-pointer select-none opacity-40 hover:opacity-60 transition-opacity"
        style={{ height: `${svgHeight}px` }}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
      >
        <svg 
          viewBox={`0 0 ${numTicks * 4} ${svgHeight}`} 
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          {ticks.map((i) => {
            const heightFactor = getBarHeight(i)
            const barHeight = heightFactor * barMaxHeight
            const x = i * 4 // 4px per tick slot (2px bar + 2px gap)
            const yTop = (svgHeight - barHeight) / 2
            
            const isSelected = selectedTick === i
            const isHovered = hoveredIndex === i
            
            // Subtle grey bars, slightly darker on hover/select
            let fill = '#9CA3AF' // gray-400
            if (isSelected) {
              fill = '#4B5563' // gray-600 for selected
            } else if (isHovered) {
              fill = '#6B7280' // gray-500 for hovered
            }
            
            return (
              <rect
                key={i}
                x={x}
                y={yTop}
                width={2}
                height={barHeight}
                fill={fill}
              />
            )
          })}
          
          {/* Subtle playhead for selection */}
          {selectedTick !== null && (
            <rect
              x={selectedTick * 4}
              y={0}
              width={2}
              height={svgHeight}
              fill="#374151"
              opacity={0.8}
            />
          )}
        </svg>
      </div>
      
      {/* Clear selection button - positioned at right */}
      {selectedDate && (
        <button
          onClick={() => onSelectDate(null)}
          className="absolute right-0 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 rounded transition-colors"
          aria-label="Clear selection"
        >
          <X className="w-3 h-3 text-gray-400" />
        </button>
      )}
    </div>
  )
}
