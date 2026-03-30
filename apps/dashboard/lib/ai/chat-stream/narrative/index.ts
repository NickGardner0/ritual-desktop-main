/**
 * Barrel re-export for narrative builder modules.
 */

export { buildContextMemoryNarrative, formatNarrativeDateLabel } from './context-memory';

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
  parseExplicitRecapAnchorDate,
} from './activity-summary';
