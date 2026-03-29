/**
 * Computer Activity Section
 * 
 * Redesigned analytics view inspired by Perplexity Finance + ActivityWatch.
 * This is a wrapper that uses the new ComputerActivityPanel.
 * 
 * DATA SOURCES:
 * - Backend/Turso-first aggregated analytics for desktop and web
 * - Local Tauri event timeline for desktop drill-down/offline fallback
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
import type { TimeRangePreset } from '@/lib/computerActivity/contracts'

interface ComputerActivityProps {
  startDate?: string
  endDate?: string
  daysBack?: number
  /** When provided, the panel uses this preset and hides its own range picker */
  externalRange?: TimeRangePreset
  /** When provided, renders a close button in the header */
  onClose?: () => void
}

/**
 * Main export - wraps the new ComputerActivityPanel
 */
export function ComputerActivitySection({
  externalRange,
  onClose,
}: ComputerActivityProps) {
  return <ComputerActivityPanel externalRange={externalRange} onClose={onClose} />
}

// Default export for backward compatibility
export default ComputerActivitySection

// Re-export the new panel for direct imports
export { ComputerActivityPanel } from '@/components/computer-activity'
