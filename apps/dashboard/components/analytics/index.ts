/**
 * Analytics Components Index
 * 
 * IMPORTANT: Only export lightweight components and types here.
 * Heavy view components (OverviewView, MetricsView) should be imported
 * directly from their files to enable proper code splitting.
 */

// View Mode Toggle (Midday-style segmented control) - lightweight
export { ViewModeToggle } from './view-mode-toggle';
export type { ViewMode } from './view-mode-toggle';

// Filter Context (shared state for filters) - lightweight
export { 
  AnalyticsFilterProvider, 
  useAnalyticsFilters, 
  useAnalyticsFiltersOptional 
} from './analytics-filter-context';

// Main entry point - this lazy loads heavy components internally
export { UnifiedAnalyticsClient } from './unified-analytics-client';

// NOTE: Do NOT export OverviewView, MetricsView, HabitTickerGrid, etc. here
// Import them directly from their files when needed to enable code splitting:
//   import { OverviewView } from '@/components/analytics/overview-view';
//   import { MetricsView } from '@/components/analytics/metrics-view';

// Lightweight toggle component - from separate file to avoid recharts import
export { AnalyticsViewToggle } from './analytics-view-toggle';
