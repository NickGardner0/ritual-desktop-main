/**
 * MetricsView - Analytics/Metrics content for unified Analytics page
 * 
 * Metrics content used by the unified analytics page.
 * Designed to work with shared filter context or standalone.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useAuth, useUser } from '@clerk/nextjs';
import {
  Copy,
  Camera,
  ChevronDown,
  Download,
  X,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, differenceInDays, subDays, eachDayOfInterval } from 'date-fns';
import { analyticsApi } from '@/lib/services/analytics-api';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';
import { useHabits } from '@/contexts/HabitsContext';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import { habitToFinanceSeries } from '@/lib/charts/habitToFinanceSeries';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { ExpandedMetricCard } from '@/components/metrics/ExpandedMetricCard';
import { MetricsInitialSection } from '@/components/analytics/metrics-initial-section';
import type { RangeOption } from '@/components/metrics/RangeSegmentedControl';
import { isTauri } from '@/lib/tauri-utils';
import { computeMeaningfulPercentChange } from '@/lib/analytics-change';
import {
  COMPUTER_HABIT_DISPLAY_NAME,
  getHabitDisplayName,
  isComputerHabitName,
} from '@/lib/computer-time-habit';
import {
  buildComputerActivityMetricCardData,
  buildHabitMetricCardData,
  buildMetricStreakData,
  buildMetricsBarData,
  formatMetricBarValue,
  getMetricCategoryForHabit,
  inferHigherIsBetter,
  mapDailyBreakdownRows,
  type MetricCardData,
  type MetricDailyRow,
  type MetricHabitLike,
} from '@/components/analytics/metrics-derived';
import {
  buildWearableDailyRows,
  getWearableDateRange,
  getWearableMetricType,
  getWearableProviderForHabit,
  isWearableBackedHabit,
  summarizeWearableDailyRows,
  type WearableDailyTotal,
  type WearableSeriesPoint,
} from '@/lib/wearables-dashboard';
import type { HabitSparkSource } from '@/components/analytics/habit-mini-charts-section';
import {
  auditLocalStorage,
  perfError,
  perfInfo,
  startPerfTimer,
} from '@/lib/perf-debug';
import type { TimeRangePreset } from '@/lib/computerActivity/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useComputerSnapshotQuery } from '@/hooks/use-computer-snapshot-query';

export const DateRangePicker = dynamic(
  () => import('@/components/date-range-picker').then(m => ({ default: m.DateRangePicker })),
  { ssr: false }
);

export const HabitTickerCard = dynamic(
  () => import('@/components/analytics/habit-ticker-view').then(m => ({ default: m.HabitTickerCard })),
  { ssr: false }
);

export const PerplexityExpandedHabitChart = dynamic(
  () => import('@/components/charts/PerplexityExpandedHabitChart').then(m => ({ default: m.PerplexityExpandedHabitChart })),
  { ssr: false }
);

export const ComputerActivitySection = dynamic(
  () => import('@/components/analytics/computer-activity').then(m => ({ default: m.ComputerActivitySection })),
  { ssr: false }
);

import type { BarListItem, BarListRange } from '@/components/analytics/vercel-bar-list';
export type { BarListItem, BarListRange } from '@/components/analytics/vercel-bar-list';

export type HabitData = {
  habit_id: string;
  habit_name: string;
  category: string;
  icon?: string;
  unit_type?: string;
  [key: string]: any;
};

export type ChartDataPoint = {
  value: number;
  [key: string]: any;
};

export const COMPUTER_ACTIVITY_CARD_ID = '__computer_activity__';
export const CARD_ORDER_KEY = 'ritual-metric-card-order';
export const DEFAULT_METRICS_SPARKLINE_DAYS = 180;
export const DEFAULT_METRICS_SUMMARY_DAYS = 1095;
export const CARDS_PER_PAGE = 4;

// ── Metric Category Tabs ──
export const METRIC_CATEGORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'health', label: 'Health' },
  { id: 'digital', label: 'Digital' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'experiments', label: 'Experiments' },
] as const;

export function barListRangeToTimePreset(range: BarListRange): TimeRangePreset {
  switch (range) {
    case '12H':
      return '12H';
    case '1D':
      return '1D';
    case '1W':
      return '7D';
    case '1M':
      return '30D';
    case '3M':
      return '90D';
    case '6M':
    case '1Y':
      return 'ALL';
    default:
      return '30D';
  }
}

export function SortableMetricCard({ id, children }: { id: string; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="min-w-0">
      {children}
    </div>
  );
}

export type HeartRateSummaryRow = {
  current_avg_bpm?: number;
  previous_avg_bpm?: number;
  change_pct?: number;
  absolute_change?: number;
  min_bpm?: number;
  max_bpm?: number;
  total_samples?: number;
  days_with_data?: number;
  first_day?: string;
  last_day?: string;
};

export type HeartRateSeriesRow = {
  bucket_start: string;
  bpm_avg: number;
  bpm_min: number;
  bpm_max: number;
  sample_count: number;
};

export type LocalMetricSummaryRow = {
  habit_id: string;
  habit_name: string;
  unit: string;
  total_value: number;
  current_value: number;
  days_with_data: number;
};

export function getHeartRateBucket(rangeKey: RangeKey, rangeDays?: number): '1m' | 'hour' | 'day' {
  if (typeof rangeDays === 'number' && Number.isFinite(rangeDays)) {
    if (rangeDays <= 1) return '1m';
    if (rangeDays <= 7) return 'hour';
    return 'day';
  }

  switch (rangeKey) {
    case '1D':
      return '1m';
    case '5D':
    case '1W':
      return 'hour';
    default:
      return 'day';
  }
}

export function isSleepLikeHabit(habit?: HabitData | null): boolean {
  if (!habit) return false;

  const metricType = String((habit as any)?.metric_type || '').toLowerCase();
  const habitName = String(habit.habit_name || '').toLowerCase();

  return metricType.includes('sleep') || habitName.includes('sleep');
}

export function isGranularHeartRateHabit(habit?: HabitData | null): boolean {
  if (!habit) return false;

  const metricType = String((habit as any)?.metric_type || '').toLowerCase();
  const habitName = String(habit.habit_name || '').toLowerCase();
  const integrationSource = String((habit as any)?.integration_source || '').toLowerCase();

  if (integrationSource !== 'whoop') return false;
  return metricType === 'heart_rate' || metricType === 'hr' || habitName === 'heart rate';
}

export function getMetricUnitLabel(habit: HabitData): string {
  return String((habit as any)?.target_unit || habit.unit_type || (habit as any)?.unit || 'count');
}

export function isCompletedMetricLogStatus(status?: string | null): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === '' || normalized === 'completed' || normalized === 'success';
}

export function getMetricLogDateValue(log: { date?: string; completed_at?: string | null }): string | null {
  if (typeof log.date === 'string' && log.date.trim()) {
    return log.date.slice(0, 10);
  }
  if (typeof log.completed_at === 'string' && log.completed_at.trim()) {
    return log.completed_at.slice(0, 10);
  }
  return null;
}

export function getMetricLogNumericValue(habit: HabitData, log: { duration?: number | null; amount?: number | null }): number {
  const unitLabel = getMetricUnitLabel(habit).toLowerCase();
  const duration = Number(log.duration || 0);
  const amount = Number(log.amount || 0);

  if (duration > 0) {
    if (unitLabel.includes('hour')) return duration / 3600;
    if (unitLabel.includes('minute')) return duration / 60;
    return duration;
  }

  if (amount > 0) return amount;
  return 1;
}

export function extractSleepMetadataFromLog(log: {
  metadata?: unknown;
  sleep_onset?: string | null;
  sleepOnset?: string | null;
  sleep_end?: string | null;
  sleepEnd?: string | null;
  time?: string | null;
  completed_at?: string | null;
}) {
  let parsedMeta: Record<string, unknown> = {};
  if (log.metadata) {
    if (typeof log.metadata === 'string') {
      try {
        parsedMeta = JSON.parse(log.metadata);
      } catch {
        parsedMeta = {};
      }
    } else if (typeof log.metadata === 'object') {
      parsedMeta = { ...(log.metadata as Record<string, unknown>) };
    }
  }

  const sleepOnset = (
    parsedMeta.sleep_onset
    ?? parsedMeta.sleepOnset
    ?? log.sleep_onset
    ?? log.sleepOnset
    ?? null
  ) as string | null;
  const sleepEnd = (
    parsedMeta.sleep_end
    ?? parsedMeta.sleepEnd
    ?? log.sleep_end
    ?? log.sleepEnd
    ?? null
  ) as string | null;
  const time = (
    parsedMeta.time
    ?? log.time
    ?? log.completed_at
    ?? null
  ) as string | null;

  return {
    metadata: parsedMeta,
    sleepOnset,
    sleepEnd,
    time,
  };
}

export function buildLocalMetricDailyRows(
  habit: HabitData,
  logs: Array<{
    date?: string;
    completed_at?: string | null;
    status?: string | null;
    duration?: number | null;
    amount?: number | null;
    metadata?: unknown;
    sleep_onset?: string | null;
    sleepOnset?: string | null;
    sleep_end?: string | null;
    sleepEnd?: string | null;
    time?: string | null;
  }>,
  minDateInclusive?: string,
  maxDateInclusive?: string,
): MetricDailyRow[] {
  if (!habit.habit_id || !logs.length) return [];

  const useMaxPerDay = isSleepLikeHabit(habit);
  const dailyValues = new Map<string, number>();
  const dailySleepMetadata = new Map<
    string,
    {
      sleep_onset?: string | null;
      sleep_end?: string | null;
      time?: string | null;
      completed_at?: string | null;
      metadata?: Record<string, unknown>;
      score: number;
    }
  >();

  for (const log of logs) {
    if (!isCompletedMetricLogStatus(log.status)) continue;
    const day = getMetricLogDateValue(log);
    if (!day) continue;
    if (minDateInclusive && day < minDateInclusive) continue;
    if (maxDateInclusive && day > maxDateInclusive) continue;

    const value = getMetricLogNumericValue(habit, log);
    const previous = dailyValues.get(day) || 0;
    dailyValues.set(day, useMaxPerDay ? Math.max(previous, value) : previous + value);

    if (useMaxPerDay) {
      const { metadata, sleepOnset, sleepEnd, time } = extractSleepMetadataFromLog(log);
      const score =
        Number(Boolean(sleepOnset))
        + Number(Boolean(sleepEnd))
        + Number(Boolean(time));
      if (score > 0) {
        const existing = dailySleepMetadata.get(day);
        const existingTs = existing?.completed_at ? new Date(existing.completed_at).getTime() : 0;
        const candidateTs = log.completed_at ? new Date(log.completed_at).getTime() : 0;
        if (!existing || score > existing.score || (score === existing.score && candidateTs > existingTs)) {
          dailySleepMetadata.set(day, {
            sleep_onset: sleepOnset,
            sleep_end: sleepEnd,
            time,
            completed_at: log.completed_at ?? null,
            metadata,
            score,
          });
        }
      }
    }
  }

  return Array.from(dailyValues.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => {
      const sleepMetadata = dailySleepMetadata.get(date);
      return {
        habit_id: habit.habit_id,
        date,
        daily_value: value,
        total_amount: value,
        unit: getMetricUnitLabel(habit),
        completed_count: value > 0 ? 1 : 0,
        sleep_onset: sleepMetadata?.sleep_onset ?? null,
        sleep_end: sleepMetadata?.sleep_end ?? null,
        time: sleepMetadata?.time ?? null,
        completed_at: sleepMetadata?.completed_at ?? null,
        metadata: sleepMetadata?.metadata ?? null,
      };
    });
}

export function buildLocalMetricSummary(
  habit: HabitData,
  rows: MetricDailyRow[],
): LocalMetricSummaryRow | null {
  const values = rows
    .map((row) => Number(row.daily_value ?? row.value ?? row.total_amount ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) return null;

  const total = values.reduce((sum, value) => sum + value, 0);
  const average = total / values.length;

  return {
    habit_id: habit.habit_id,
    habit_name: habit.habit_name,
    unit: getMetricUnitLabel(habit),
    total_value: total,
    current_value: average,
    days_with_data: values.length,
  };
}

export function buildWearableMetricDailyRowsForHabit(
  habit: HabitData,
  days: WearableDailyTotal[],
  minDateInclusive?: string,
  maxDateInclusive?: string,
): MetricDailyRow[] {
  const metricType = getWearableMetricType(habit);
  if (!metricType) return [];

  return buildWearableDailyRows(days, metricType)
    .filter((row) => {
      if (minDateInclusive && row.date < minDateInclusive) return false;
      if (maxDateInclusive && row.date > maxDateInclusive) return false;
      return true;
    })
    .map((row) => ({
      habit_id: habit.habit_id,
      date: row.date,
      daily_value: row.value,
      total_amount: row.value,
      unit: habit.unit_type || row.unit || getMetricUnitLabel(habit),
      completed_count: row.value > 0 ? 1 : 0,
      completed_at: `${row.date}T00:00:00Z`,
    }));
}

export function buildWearableMetricSeriesRows(
  habit: HabitData,
  points: WearableSeriesPoint[],
): MetricDailyRow[] {
  return points.map((point) => ({
    habit_id: habit.habit_id,
    date: String(point.attributed_date || point.timestamp).slice(0, 10),
    daily_value: Number(point.value || 0),
    total_amount: Number(point.value || 0),
    unit: habit.unit_type || point.unit || getMetricUnitLabel(habit),
    completed_count: Number(point.value || 0) > 0 ? 1 : 0,
    completed_at: point.start_time || point.timestamp,
  }));
}

export function hasUsableMetricSummary(summary?: Record<string, any> | null): boolean {
  if (!summary) return false;

  const totalValue = Number(summary.total_value ?? 0);
  const currentValue = Number(summary.current_value ?? 0);
  const daysWithData = Number(summary.days_with_data ?? 0);

  return (
    (Number.isFinite(totalValue) && totalValue > 0)
    || (Number.isFinite(currentValue) && currentValue > 0)
    || (Number.isFinite(daysWithData) && daysWithData > 0)
  );
}

export function dateRangeToBarListRange(range?: DateRange): BarListRange {
  if (!range?.from || !range?.to) return '1M';

  const totalDays = differenceInDays(range.to, range.from) + 1;
  if (totalDays <= 1) return '1D';
  if (totalDays <= 7) return '1W';
  if (totalDays <= 31) return '1M';
  if (totalDays <= 92) return '3M';
  if (totalDays <= 183) return '6M';
  return '1Y';
}

export interface MetricsViewProps {
  externalDateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  hideControls?: boolean;
  initialAnalyticsData?: Record<string, any[]>;
  initialSummaryMetrics?: Record<string, any>;
  initialBarListAnalyticsData?: Record<string, any[]>;
  initialBarListSummaryMetrics?: Record<string, any>;
}


// Custom Dropdown Component
export type CompareOption = { label: string; value: string };

export interface CompareSelectProps {
  value: string | null;
  options: CompareOption[];
  onChange: (value: string | null) => void;
  placeholder?: string;
}

export const COMPARE_NONE_VALUE = '__none__';

export const CompareSelect = ({
  value,
  options,
  onChange,
  placeholder = 'None',
}: CompareSelectProps) => (
  <Select
    value={value ?? COMPARE_NONE_VALUE}
    onValueChange={(nextValue) =>
      onChange(nextValue === COMPARE_NONE_VALUE ? null : nextValue)
    }
  >
    <SelectTrigger className="h-[30px] min-w-[80px] border-[rgba(39,37,30,0.07)] bg-white px-2 text-[12px] font-medium tracking-[-0.4px] text-[rgba(39,37,30,0.65)] transition-colors hover:bg-[rgba(39,37,30,0.02)] hover:text-[#27251E] focus:outline-none focus:ring-0">
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent align="end" className="border-[rgba(39,37,30,0.07)] bg-white shadow-[0_12px_24px_rgba(39,37,30,0.12)]">
      <SelectItem value={COMPARE_NONE_VALUE} className="text-muted-foreground">
        None
      </SelectItem>
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

// Helper to determine start/end dates
export const getRangeDates = (range: RangeKey) => {
  const now = new Date();
  const todayStart = startOfDay(now);
  switch (range) {
    // Inclusive ranges: e.g. 1W = 7 calendar days including today.
    case '1D': return { from: todayStart, to: now };
    case '5D': return { from: subDays(todayStart, 4), to: now };
    case '1W': return { from: subDays(todayStart, 6), to: now };
    case '1M': return { from: subDays(todayStart, 29), to: now };
    case '3M': return { from: subDays(todayStart, 89), to: now };
    case '6M': return { from: subDays(todayStart, 179), to: now };
    case 'YTD': return { from: startOfDay(new Date(now.getFullYear(), 0, 1)), to: now };
    case '1Y': return { from: subDays(todayStart, 364), to: now };
    case '5Y': return { from: subDays(todayStart, (365 * 5) - 1), to: now };
    case 'MAX': return { from: subDays(todayStart, (365 * 5) - 1), to: now };
    case 'ALL': return { from: subDays(todayStart, (365 * 5) - 1), to: now };
    default: return { from: subDays(todayStart, 29), to: now };
  }
};
