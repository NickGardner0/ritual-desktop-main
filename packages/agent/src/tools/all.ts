import type { ToolDefinition } from '../types.js';
import { getHabitStatsTool } from './get-habit-stats.js';
import { getDailyBreakdownTool } from './get-daily-breakdown.js';
import { getCorrelationTool } from './get-correlation.js';
import { listHabitsTool } from './list-habits.js';
import { getHabitTrendsTool } from './get-habit-trends.js';
import { getWeeklyOverviewTool } from './get-weekly-overview.js';
import { getDailyOverviewTool } from './get-daily-overview.js';
import { getMonthlyOverviewTool } from './get-monthly-overview.js';
import { getHabitAnomaliesTool } from './get-habit-anomalies.js';
import { getComputerTimeSpentBreakdownTool } from './get-computer-time-spent-breakdown.js';
import { getActivitySummaryTool } from './get-activity-summary.js';
import { getDailyBiometricsTool } from './get-daily-biometrics.js';
import { getScreenTimeSummaryTool } from './get-screen-time-summary.js';
import { getCalendarEventsTool } from './get-calendar-events.js';
import { getStreaksTool } from './get-streaks.js';
import { logHabitTool } from './log-habit.js';
import { createHabitTool } from './create-habit.js';

export const allTools: ToolDefinition[] = [
  getHabitStatsTool,
  getDailyBreakdownTool,
  getCorrelationTool,
  listHabitsTool,
  getHabitTrendsTool,
  getWeeklyOverviewTool,
  getDailyOverviewTool,
  getMonthlyOverviewTool,
  getHabitAnomaliesTool,
  getComputerTimeSpentBreakdownTool,
  getActivitySummaryTool,
  getDailyBiometricsTool,
  getScreenTimeSummaryTool,
  getCalendarEventsTool,
  getStreaksTool,
  logHabitTool,
  createHabitTool,
];
