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
} from './shared-api.js';

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
} from './habits.js';

// Overview executors
export {
  executeGetWeeklyOverview,
  executeGetDailyOverview,
  executeGetMonthlyOverview,
} from './overviews.js';

// Project-time activity summary executor
export {
  executeGetActivitySummary,
} from './context-memory.js';

// Computer time executor
export {
  executeGetComputerTimeSpentBreakdown,
} from './computer-time.js';

// Biometrics executor
export {
  executeGetDailyBiometrics,
} from './biometrics.js';

// Screen time (iPhone) executor
export {
  executeGetScreenTimeSummary,
} from './screen-time.js';

// Calendar executor
export {
  executeGetCalendarEvents,
} from './calendar.js';

// SMS preferences executors
export {
  executeGetSmsPreferences,
  executeUpdateSmsPreferences,
} from './sms-preferences.js';
