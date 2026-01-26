/**
 * Analytics Components Index
 * Exports all analytics-related components for clean imports
 */

// View Mode Toggle (Midday-style segmented control)
export { ViewModeToggle } from './view-mode-toggle';
export type { ViewMode } from './view-mode-toggle';

// Filter Context (shared state for filters)
export { 
  AnalyticsFilterProvider, 
  useAnalyticsFilters, 
  useAnalyticsFiltersOptional 
} from './analytics-filter-context';

// View Components
export { OverviewView } from './overview-view';
export { MetricsView } from './metrics-view';
export { UnifiedAnalyticsClient } from './unified-analytics-client';

// Existing components (re-export for convenience)
export { HabitTickerGrid, HabitTickerCard, AnalyticsViewToggle } from './habit-ticker-view';
export { ComputerActivitySection } from './computer-activity';
