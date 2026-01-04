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
  className
}: HistoryScrubberProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  
  // Number of ticks - fewer ticks = thicker bars with gaps
  const numTicks = 120
  
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
  
// Calculate bar height with Thymer-style ripple - BIGGER bars
  const getBarHeight = useCallback((tickIndex: number): number => {
    const baseHeight = 0.45 // 45% when not hovered (prominent baseline)
    const maxHeight = 1.0   // 100% at peak
    
    if (!isHovering || hoveredIndex === null) {
      return baseHeight
    }
    
    // Wider gaussian for smoother, more pronounced ripple
    const sigma = 10
    const ripple = gaussian(tickIndex, hoveredIndex, sigma)
    
    return baseHeight + (maxHeight - baseHeight) * ripple
  }, [isHovering, hoveredIndex])

  // Generate tick array
  const ticks = useMemo(() => Array.from({ length: numTicks }, (_, i) => i), [numTicks])
  
  // SVG dimensions - taller bars
  const svgHeight = 48
  const barMaxHeight = 44
  
  // Calculate tooltip position - flip to left side if too close to right edge
  const tooltipPosition = useMemo(() => {
    if (hoveredIndex === null) return { percentage: 0, flipToLeft: false }
    const percentage = (hoveredIndex / numTicks) * 100
    // Flip to left side if we're past 70% of the width
    const flipToLeft = percentage > 70
    return { percentage, flipToLeft }
  }, [hoveredIndex, numTicks])

  return (
    <div className={cn("relative", className)}>
      {/* Selected date badge - inline at right */}
      {selectedDate && selectedTick !== null && !isHovering && (
        <div className="absolute top-1/2 -translate-y-1/2 right-0 flex items-center gap-2 z-10">
          <span className="text-xs text-gray-500">
            Viewing: {format(parseISO(selectedDate), 'MMM d, yyyy')}
          </span>
          <button
            onClick={() => onSelectDate(null)}
            className="p-0.5 hover:bg-gray-100 rounded transition-colors"
            aria-label="Clear selection"
          >
            <X className="w-3 h-3 text-gray-400" />
          </button>
        </div>
      )}
      
      {/* Waveform container - Thymer style */}
      <div
        ref={containerRef}
        className="relative w-full cursor-pointer select-none"
        style={{ height: `${svgHeight}px` }}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
      >
        {/* SVG for crisp rendering */}
        <svg 
          viewBox={`0 0 ${numTicks * 6} ${svgHeight}`} 
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          {ticks.map((i) => {
            const heightFactor = getBarHeight(i)
            const barHeight = heightFactor * barMaxHeight
            const x = i * 6 + 1 // 6px per tick slot (4px bar + 2px gap)
            const yTop = (svgHeight - barHeight) / 2 // Center vertically
            
            const isSelected = selectedTick === i
            
            // Same color for all bars - only height changes on hover
            let fill = '#D4D4D4' // neutral gray matching button hover style
            if (isSelected) {
              fill = '#22C55E' // green-500 for selected
            }
            
            return (
              <rect
                key={i}
                x={x}
                y={yTop}
                width={4}
                height={barHeight}
                rx={2}
                fill={fill}
              />
            )
          })}
          
          {/* Green playhead for selection only */}
          {selectedTick !== null && (
            <rect
              x={selectedTick * 6}
              y={0}
              width={5}
              height={svgHeight}
              fill="#22C55E"
              opacity={0.85}
            />
          )}
        </svg>
        
        {/* Floating date label inside scrubber - appears to the side of hovered position */}
        {isHovering && hoveredDay && (
          <div 
            className="absolute top-1/2 -translate-y-1/2 px-3 py-1.5 text-xs font-medium whitespace-nowrap z-10 pointer-events-none shadow-lg"
            style={{
              left: tooltipPosition.flipToLeft ? 'auto' : `calc(${tooltipPosition.percentage}% + 12px)`,
              right: tooltipPosition.flipToLeft ? `calc(${100 - tooltipPosition.percentage}% + 12px)` : 'auto',
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(12px) saturate(180%)',
              WebkitBackdropFilter: 'blur(12px) saturate(180%)',
              border: '1px solid rgba(0, 0, 0, 0.08)',
              borderRadius: '4px',
            }}
          >
            <span className="text-gray-800">{format(hoveredDay.dateObj, 'EEE, MMM d, yyyy')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
