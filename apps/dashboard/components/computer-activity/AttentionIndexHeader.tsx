/**
 * AttentionIndexHeader
 * 
 * Primary metric display with delta and sparkline.
 * Inspired by Perplexity Finance's minimal header style.
 */

'use client'

import React, { useMemo } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { AttentionHeader, SparklinePoint } from '@/lib/computerActivity/contracts'
import { msToHuman, msToDecimalHours } from '@/lib/computerActivity/derive'

interface AttentionIndexHeaderProps {
  header: AttentionHeader
  className?: string
}

/**
 * Minimal SVG sparkline component
 */
function Sparkline({ 
  points, 
  width = 120, 
  height = 32,
  className = ''
}: { 
  points: SparklinePoint[]
  width?: number
  height?: number
  className?: string
}) {
  const pathData = useMemo(() => {
    if (points.length === 0) return ''
    
    const maxY = Math.max(...points.map(p => p.yMs), 1)
    const minY = 0
    const range = maxY - minY || 1
    
    const xStep = width / Math.max(points.length - 1, 1)
    
    const pathPoints = points.map((point, i) => {
      const x = i * xStep
      const y = height - ((point.yMs - minY) / range) * (height - 4) - 2 // 2px padding
      return `${x},${y}`
    })
    
    return `M ${pathPoints.join(' L ')}`
  }, [points, width, height])
  
  if (points.length === 0) {
    return (
      <svg width={width} height={height} className={className}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#E5E7EB"
          strokeWidth={1}
          strokeDasharray="4 2"
        />
      </svg>
    )
  }
  
  return (
    <svg width={width} height={height} className={className}>
      {/* Main line only - no fill */}
      <path
        d={pathData}
        fill="none"
        stroke="#374151"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function AttentionIndexHeader({ header, className = '' }: AttentionIndexHeaderProps) {
  const formattedValue = msToHuman(header.primaryValueMs)
  const decimalHours = msToDecimalHours(header.primaryValueMs)
  
  const hasPositiveDelta = header.deltaPct !== null && header.deltaPct !== undefined && header.deltaPct > 0
  const hasNegativeDelta = header.deltaPct !== null && header.deltaPct !== undefined && header.deltaPct < 0
  const hasDelta = header.deltaPct !== null && header.deltaPct !== undefined
  
  return (
    <div className={`flex items-center justify-between ${className}`}>
      {/* Left: Primary metric */}
      <div className="flex items-baseline gap-3">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">
            {header.primaryLabel}
          </p>
          <p className="text-3xl font-semibold text-gray-900 tabular-nums">
            {decimalHours}
          </p>
        </div>
        
        {/* Delta indicator */}
        {hasDelta && (
          <div className={`flex items-center gap-1 ${
            hasPositiveDelta ? 'text-gray-600' : hasNegativeDelta ? 'text-gray-400' : 'text-gray-400'
          }`}>
            {hasPositiveDelta ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : hasNegativeDelta ? (
              <TrendingDown className="w-3.5 h-3.5" />
            ) : null}
            <span className="text-sm tabular-nums">
              {header.deltaPct! > 0 ? '+' : ''}{header.deltaPct!.toFixed(0)}%
            </span>
          </div>
        )}
      </div>
      
      {/* Right: Sparkline */}
      <div className="flex-shrink-0">
        <Sparkline 
          points={header.sparkline} 
          width={140}
          height={36}
          className="opacity-80"
        />
      </div>
    </div>
  )
}

export default AttentionIndexHeader
