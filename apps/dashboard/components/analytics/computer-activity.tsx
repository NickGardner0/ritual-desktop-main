/**
 * Computer Activity Section
 * 
 * Redesigned analytics view inspired by Perplexity Finance + ActivityWatch.
 * This is a wrapper that uses the new ComputerActivityPanel.
 * 
 * DATA SOURCES:
 * - Local-first via Tauri: get_detailed_activity(), get_activity_timeline()
 * - Fallback to backend API for web version
 * 
 * FEATURES:
 * - Attention Index header with sparkline
 * - Session flow timeline (horizontal segments)
 * - Ranked apps/websites distributions
 * - Micro-metrics (focus blocks, switches, longest)
 * - Deep drill-down on segment click
 */

'use client'

import React from 'react'
import { ComputerActivityPanel } from '@/components/computer-activity'

interface ComputerActivityProps {
  startDate?: string
  endDate?: string
  daysBack?: number
  onDismiss?: () => void
  isVisible?: boolean
}

/**
 * Main export - wraps the new ComputerActivityPanel
 */
export function ComputerActivitySection({
  onDismiss,
  isVisible = true,
}: ComputerActivityProps) {
  if (!isVisible) return null
  
  return (
    <ComputerActivityPanel 
      onDismiss={onDismiss}
    />
  )
}

// Default export for backward compatibility
export default ComputerActivitySection

// Re-export the new panel for direct imports
export { ComputerActivityPanel } from '@/components/computer-activity'
