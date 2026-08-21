'use client'

// Product rule:
// - Desktop raw/recent activity reads local activity.db. The result is
//   observable as local | synced | unavailable; cloud is not a hidden fallback.
// - Web/iOS and long-range desktop aggregates read hosted `/api/watcher/stats/*`.
// - Offline desktop may use activity.db for ranges that include today (explicit local).

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
