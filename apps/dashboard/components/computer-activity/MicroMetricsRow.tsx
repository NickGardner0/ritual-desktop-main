/**
 * MicroMetricsRow
 * 
 * Subtle inline metrics: focus blocks, switches, longest session.
 * Very minimal by default, more visible on hover.
 */

'use client'

import React from 'react'
import { MicroMetrics } from '@ritual/shared-contracts/computer-activity'
import { msToHuman } from '@/lib/computerActivity/derive'

interface MicroMetricsRowProps {
  metrics: MicroMetrics
  className?: string
}

export function MicroMetricsRow({ metrics, className = '' }: MicroMetricsRowProps) {
  const items = [
    {
      label: 'Focus blocks',
      value: metrics.focusBlocks.toString(),
      tooltip: 'Sessions ≥ 25 minutes',
    },
    {
      label: 'Switches',
      value: metrics.switches.toString(),
      tooltip: 'Context switches between apps',
    },
    {
      label: 'Longest',
      value: msToHuman(metrics.longestBlockMs, true),
      tooltip: metrics.longestBlockLabel 
        ? `Longest session: ${metrics.longestBlockLabel}` 
        : 'Longest continuous session',
    },
  ]
  
  return (
    <div className={`flex items-center gap-6 ${className}`}>
      {items.map((item) => (
        <div 
          key={item.label}
          className="group flex items-center gap-1.5"
          title={item.tooltip}
        >
          <span className="text-xs text-gray-400 group-hover:text-gray-500 transition-colors">
            {item.label}
          </span>
          <span className="text-xs font-medium text-gray-500 group-hover:text-gray-700 tabular-nums transition-colors">
            {item.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export default MicroMetricsRow

