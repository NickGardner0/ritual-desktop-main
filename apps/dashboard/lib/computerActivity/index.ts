'use client'

// Product rule:
// - User-facing computer activity analytics should read from backend `/api/watcher/stats/*`
//   first so desktop and web share the same Turso-backed authority.
// - Native Tauri activity queries remain available only as desktop fallback when the backend
//   is unavailable/offline. Do not import native computer activity commands directly from UI
//   components for normal analytics reads.

export type {
  AggregatedComputerStatsResponse,
  ComputerActivityRangeParams,
  ComputerDailyResponseRow,
  ComputerSummaryResponse,
  TopAppResponseRow,
  TopDomainResponseRow,
} from './types'

export { clearComputerActivityClientCaches } from './backend-read'

export {
  getAggregatedComputerStats,
  getComputerTimeDaily,
  getComputerTimeSummary,
  getTopApps,
  getTopDomains,
} from './api'

export { COMPUTER_ACTIVITY_POLICY } from './policy'
