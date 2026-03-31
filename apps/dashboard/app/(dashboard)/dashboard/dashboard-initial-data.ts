import type { DehydratedState } from '@tanstack/react-query';
import type { HabitStats } from '@/lib/services/analytics-api';
import type { ViewMode } from '@/components/analytics/view-mode-toggle';

export type MetricDailyPoint = {
  habit_id: string;
  date: string;
  value: number;
  daily_value: number;
  total_amount: number;
  unit: string;
};

export type MetricsSummaryRow = {
  habit_id: string;
  habit_name: string;
  unit: string;
  total_value: number;
  current_value: number;
  days_with_data: number;
};

export interface DashboardDerivedInitialData {
  overviewStats: Record<string, HabitStats>;
  metricsAnalyticsData: Record<string, MetricDailyPoint[]>;
  metricsSummaryMetrics: Record<string, MetricsSummaryRow>;
  metricsBarListAnalyticsData: Record<string, MetricDailyPoint[]>;
  metricsBarListSummaryMetrics: Record<string, MetricsSummaryRow>;
}

export interface DashboardInitialData {
  dehydratedState: DehydratedState;
  initialViewMode: ViewMode;
  derived: DashboardDerivedInitialData;
}
