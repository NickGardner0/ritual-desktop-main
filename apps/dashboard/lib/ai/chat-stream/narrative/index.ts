/**
 * Barrel re-export for narrative builder modules.
 */

export {
  generateWeeklyOverviewNarrative,
  streamWeeklyOverviewNarrative,
  buildWeeklyOverviewNarrative,
  buildWeeklyOverviewHighlights,
  buildWeeklyOverviewSynthesisPayload,
} from './weekly-overview';

export type {
  WeeklyOverviewPayload,
  WeeklyOverviewHabitSummary,
  WeeklyOverviewComputerSummary,
} from './weekly-overview';

export {
  inferRecapAnchorDate,
  buildCalendarStyleActivitySummary,
  buildRichActivitySummaryFromStoryPlan,
  formatNarrativeDateLabel,
  parseExplicitRecapAnchorDate,
} from './activity-summary';
