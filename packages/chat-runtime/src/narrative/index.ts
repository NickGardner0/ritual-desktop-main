/**
 * Barrel re-export for narrative builder modules.
 */

export {
  generateWeeklyOverviewNarrative,
  streamWeeklyOverviewNarrative,
  buildWeeklyOverviewNarrative,
  buildWeeklyOverviewHighlights,
  buildWeeklyOverviewSynthesisPayload,
} from './weekly-overview.js';

export type {
  WeeklyOverviewPayload,
  WeeklyOverviewHabitSummary,
  WeeklyOverviewComputerSummary,
} from './weekly-overview.js';

export {
  inferRecapAnchorDate,
  buildCalendarStyleActivitySummary,
  buildRichActivitySummaryFromStoryPlan,
  formatNarrativeDateLabel,
  parseExplicitRecapAnchorDate,
} from './activity-summary.js';
