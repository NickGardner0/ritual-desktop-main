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
  formatWeeklyNumber,
} from './shared-api';

// Habit executors
export {
  executeGetHabitStats,
  executeGetDailyBreakdown,
  executeGetCorrelation,
  executeListHabits,
  executeGetHabitTrends,
  executeGetHabitAnomalies,
  executeGetStreaks,
  executeLogHabit,
  executeCreateHabit,
} from './habits';

// Overview executors
export {
  executeGetWeeklyOverview,
  executeGetDailyOverview,
  executeGetMonthlyOverview,
} from './overviews';

// Project-time activity summary executor
export {
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

// SMS preferences executors
export {
  executeGetSmsPreferences,
  executeUpdateSmsPreferences,
} from './sms-preferences';
