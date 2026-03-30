/**
 * Barrel re-export for all tool executor modules.
 *
 * Usage in orchestrator.ts:
 *   import { executeGetHabitStats, executeGetWeeklyOverview, ... } from './executors';
 */

// Shared API helpers (also used directly by orchestrator for non-executor calls)
export {
  fetchPythonApi,
  fetchPythonApiPost,
  getTimezoneYmd,
  shiftYmd,
  formatTzDay,
  formatTzTimestamp,
  clampDaysBack,
  clampSearchLimit,
  compactScreenWarning,
  formatWeeklyNumber,
} from './shared-api';

// Screen search helpers (also used by orchestrator for normalizing prefetched context)
export {
  parseRelativeTimeWindowMs,
  inferScreenDaysBackFromQuery,
  inferRelativeCutoffTimestamp,
  rerankScreenResultsByQuery,
  mergeScreenResults,
  hasSubstantiveOcrEvidence,
  isActivityAggregateText,
  buildScreenSearchDebug,
  mapRetrievalTierToStatus,
  mapRetrievalTierToMode,
  buildActivityFallbackResults,
  fetchOnDemandScreenSearchContext,
  fetchLocalScreenSearchContext,
  resolveScreenSearchContext,
  buildBroadOverviewEvidence,
} from './screen-search-helpers';

// Habit executors
export {
  executeGetHabitStats,
  executeGetDailyBreakdown,
  executeGetCorrelation,
  executeListHabits,
  executeGetHabitTrends,
  executeGetHabitAnomalies,
} from './habits';

// Overview executors
export {
  executeGetWeeklyOverview,
  executeGetDailyOverview,
  executeGetMonthlyOverview,
} from './overviews';

// Context memory & screen recording executors
export {
  executeSearchScreenRecordings,
  executeSearchContextMemory,
  executeGetActivitySummary,
} from './context-memory';

// Computer time executor
export {
  executeGetComputerTimeSpentBreakdown,
} from './computer-time';

// Biometrics executor
export {
  executeGetDailyBiometrics,
} from './biometrics';

// Screen time (iPhone) executor
export {
  executeGetScreenTimeSummary,
} from './screen-time';

// Calendar executor
export {
  executeGetCalendarEvents,
} from './calendar';
