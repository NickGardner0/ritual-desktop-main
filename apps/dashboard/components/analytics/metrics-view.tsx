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
} from '@/components/analytics/metrics-derived';
import type { HabitSparkSeries } from '@/components/analytics/habit-mini-charts-section';
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

const DateRangePicker = dynamic(
  () => import('@/components/date-range-picker').then(m => ({ default: m.DateRangePicker })),
  { ssr: false }
);

const HabitTickerCard = dynamic(
  () => import('@/components/analytics/habit-ticker-view').then(m => ({ default: m.HabitTickerCard })),
  { ssr: false }
);

const PerplexityExpandedHabitChart = dynamic(
  () => import('@/components/charts/PerplexityExpandedHabitChart').then(m => ({ default: m.PerplexityExpandedHabitChart })),
  { ssr: false }
);

const ComputerActivitySection = dynamic(
  () => import('@/components/analytics/computer-activity').then(m => ({ default: m.ComputerActivitySection })),
  { ssr: false }
);

import type { BarListItem, BarListRange } from '@/components/analytics/vercel-bar-list';

type HabitData = {
  habit_id: string;
  habit_name: string;
  category: string;
  icon?: string;
  unit_type?: string;
  [key: string]: any;
};

type ChartDataPoint = {
  value: number;
  [key: string]: any;
};

const COMPUTER_ACTIVITY_CARD_ID = '__computer_activity__';
const CARD_ORDER_KEY = 'ritual-metric-card-order';
const DEFAULT_METRICS_SPARKLINE_DAYS = 180;
const DEFAULT_METRICS_SUMMARY_DAYS = 1095;
const CARDS_PER_PAGE = 4;

// ── Metric Category Tabs ──
const METRIC_CATEGORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'health', label: 'Health' },
  { id: 'digital', label: 'Digital' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'experiments', label: 'Experiments' },
] as const;

function barListRangeToTimePreset(range: BarListRange): TimeRangePreset {
  switch (range) {
    case '1W':
      return '7D';
    case '1M':
      return '30D';
    case '3M':
      return '90D';
    case '6M':
    case '1Y':
    case 'ALL':
      return 'ALL';
    default:
      return '30D';
  }
}

function SortableMetricCard({ id, children }: { id: string; children: React.ReactNode }) {
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

type HeartRateSummaryRow = {
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

type HeartRateSeriesRow = {
  bucket_start: string;
  bpm_avg: number;
  bpm_min: number;
  bpm_max: number;
  sample_count: number;
};

type LocalMetricSummaryRow = {
  habit_id: string;
  habit_name: string;
  unit: string;
  total_value: number;
  current_value: number;
  days_with_data: number;
};

function getHeartRateBucket(rangeKey: RangeKey, rangeDays?: number): '1m' | 'hour' | 'day' {
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

function isSleepLikeHabit(habit?: HabitData | null): boolean {
  if (!habit) return false;

  const metricType = String((habit as any)?.metric_type || '').toLowerCase();
  const habitName = String(habit.habit_name || '').toLowerCase();

  return metricType.includes('sleep') || habitName.includes('sleep');
}

function isGranularHeartRateHabit(habit?: HabitData | null): boolean {
  if (!habit) return false;

  const metricType = String((habit as any)?.metric_type || '').toLowerCase();
  const habitName = String(habit.habit_name || '').toLowerCase();
  const integrationSource = String((habit as any)?.integration_source || '').toLowerCase();

  if (integrationSource !== 'whoop') return false;
  return metricType === 'heart_rate' || metricType === 'hr' || habitName === 'heart rate';
}

function getMetricUnitLabel(habit: HabitData): string {
  return String((habit as any)?.target_unit || habit.unit_type || (habit as any)?.unit || 'count');
}

function isCompletedMetricLogStatus(status?: string | null): boolean {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === '' || normalized === 'completed' || normalized === 'success';
}

function getMetricLogDateValue(log: { date?: string; completed_at?: string | null }): string | null {
  if (typeof log.date === 'string' && log.date.trim()) {
    return log.date.slice(0, 10);
  }
  if (typeof log.completed_at === 'string' && log.completed_at.trim()) {
    return log.completed_at.slice(0, 10);
  }
  return null;
}

function getMetricLogNumericValue(habit: HabitData, log: { duration?: number | null; amount?: number | null }): number {
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

function buildLocalMetricDailyRows(
  habit: HabitData,
  logs: Array<{
    date?: string;
    completed_at?: string | null;
    status?: string | null;
    duration?: number | null;
    amount?: number | null;
  }>,
  minDateInclusive?: string,
  maxDateInclusive?: string,
): MetricDailyRow[] {
  if (!habit.habit_id || !logs.length) return [];

  const useMaxPerDay = isSleepLikeHabit(habit);
  const dailyValues = new Map<string, number>();

  for (const log of logs) {
    if (!isCompletedMetricLogStatus(log.status)) continue;
    const day = getMetricLogDateValue(log);
    if (!day) continue;
    if (minDateInclusive && day < minDateInclusive) continue;
    if (maxDateInclusive && day > maxDateInclusive) continue;

    const value = getMetricLogNumericValue(habit, log);
    const previous = dailyValues.get(day) || 0;
    dailyValues.set(day, useMaxPerDay ? Math.max(previous, value) : previous + value);
  }

  return Array.from(dailyValues.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({
      habit_id: habit.habit_id,
      date,
      daily_value: value,
      total_amount: value,
      unit: getMetricUnitLabel(habit),
      completed_count: value > 0 ? 1 : 0,
    }));
}

function buildLocalMetricSummary(
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

function hasUsableMetricSummary(summary?: Record<string, any> | null): boolean {
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

function dateRangeToBarListRange(range?: DateRange): BarListRange {
  if (!range?.from || !range?.to) return 'ALL';

  const totalDays = differenceInDays(range.to, range.from) + 1;
  if (totalDays <= 7) return '1W';
  if (totalDays <= 31) return '1M';
  if (totalDays <= 92) return '3M';
  if (totalDays <= 183) return '6M';
  if (totalDays <= 366) return '1Y';
  return 'ALL';
}

interface MetricsViewProps {
  externalDateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  hideControls?: boolean;
  initialAnalyticsData?: Record<string, any[]>;
  initialSummaryMetrics?: Record<string, any>;
  initialBarListAnalyticsData?: Record<string, any[]>;
  initialBarListSummaryMetrics?: Record<string, any>;
}


// Custom Dropdown Component
type CompareOption = { label: string; value: string };

interface CompareSelectProps {
  value: string | null;
  options: CompareOption[];
  onChange: (value: string | null) => void;
  placeholder?: string;
}

const COMPARE_NONE_VALUE = '__none__';

const CompareSelect = ({
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
const getRangeDates = (range: RangeKey) => {
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

export function MetricsView({
  externalDateRange,
  onDateRangeChange,
  hideControls = false,
  initialAnalyticsData,
  initialSummaryMetrics,
  initialBarListAnalyticsData,
  initialBarListSummaryMetrics,
}: MetricsViewProps) {
  const { getToken } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  
  // Use shared habits context instead of separate query
  const { habits: contextHabits, habitLogs, isLoading: habitsLoading } = useHabits();
  
  // Transform habits to match expected format (habit_id instead of id)
  const transformedHabits = React.useMemo(() => 
    contextHabits
      .filter(h => h.id) // Filter out habits without id
      .map(h => ({
        ...h,
        habit_id: h.id!, // Assert non-null since we filtered
        habit_name: h.name,
        category: h.category,
        icon: h.icon,
        unit_type: h.unit_type,
      })), [contextHabits]
  );
  
  // Try to use shared filter context, fall back to local state
  const filterContext = useAnalyticsFiltersOptional();
  
  // Local state for when not using context
  const [localDateRange, setLocalDateRange] = useState<DateRange | undefined>(undefined);
  const [localSelectedHabits, setLocalSelectedHabits] = useState<string[]>([]);
  
  // Use context, external props, or local state
  const dateRange = filterContext?.dateRange ?? externalDateRange ?? localDateRange;
  const setDateRange = useCallback((range: DateRange | undefined) => {
    if (filterContext) {
      filterContext.setDateRange(range);
    } else if (onDateRangeChange) {
      onDateRangeChange(range);
    } else {
      setLocalDateRange(range);
    }
  }, [filterContext, onDateRangeChange]);
  
  const selectedHabits = filterContext?.selectedHabits ?? localSelectedHabits;
  const setSelectedHabits = filterContext?.setSelectedHabits ?? setLocalSelectedHabits;
  
  // Only show loading for initial load, not background refetches
  const queryLoading = habitsLoading;

  const hasInitialMetricsAnalytics = Boolean(initialAnalyticsData && Object.keys(initialAnalyticsData).length > 0);
  const hasInitialMetricsSummary = Boolean(initialSummaryMetrics && Object.keys(initialSummaryMetrics).length > 0);
  const hasInitialBarListAnalytics = Boolean(initialBarListAnalyticsData && Object.keys(initialBarListAnalyticsData).length > 0);
  const hasInitialBarListSummary = Boolean(initialBarListSummaryMetrics && Object.keys(initialBarListSummaryMetrics).length > 0);
  const lastHydratedCanonicalRangeKeyRef = useRef<string | null>(null);
  const skippedInitialBarListFetchRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>(initialAnalyticsData ?? {});
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<any[]>([]);
  const [expandedSyncContext, setExpandedSyncContext] = useState<any>(null);
  const [loadingExpandedLogs, setLoadingExpandedLogs] = useState(false);

  const [summaryMetrics, setSummaryMetrics] = useState<Record<string, any>>(initialSummaryMetrics ?? {});
  const [barListAnalyticsData, setBarListAnalyticsData] = useState<Record<string, any[]>>(initialBarListAnalyticsData ?? {});
  const [barListSummaryMetrics, setBarListSummaryMetrics] = useState<Record<string, any>>(initialBarListSummaryMetrics ?? {});

  const [expandedTimeRange, setExpandedTimeRange] = useState<RangeKey>('1M');
  const [barListRange, setBarListRange] = useState<BarListRange>(() => dateRangeToBarListRange(dateRange));
  const [compareHabitId, setCompareHabitId] = useState<string | null>(null);
  const [comparisonLogs, setComparisonLogs] = useState<any[]>([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [activeCategoryTab, setActiveCategoryTab] = useState<string | null>(null);
  const [cardPage, setCardPage] = useState(0);
  const [totalCardPages, setTotalCardPages] = useState(1);
  const clampedCardPage = Math.min(cardPage, Math.max(totalCardPages - 1, 0));

  const [correlationData, setCorrelationData] = useState<any>(null);
  const [loadingCorrelation, setLoadingCorrelation] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [realtimeRefreshTick, setRealtimeRefreshTick] = useState(0);
  const [heartRateExpandedSeries, setHeartRateExpandedSeries] = useState<HeartRateSeriesRow[]>([]);
  const [heartRateExpandedSummary, setHeartRateExpandedSummary] = useState<HeartRateSummaryRow | null>(null);

  // Drag-to-reorder: persisted card order
  const [appliedCardOrder, setAppliedCardOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(CARD_ORDER_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Track current visible card IDs so handleDragEnd can seed order if needed
  const visibleCardIdsRef = useRef<string[]>([]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setAppliedCardOrder((prev) => {
      // If order is empty, seed from current visible IDs
      const base = prev.length > 0 ? prev : visibleCardIdsRef.current;
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = base.indexOf(activeId);
      const newIndex = base.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return base;
      const next = arrayMove(base, oldIndex, newIndex);
      try { localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const [isCapturing, setIsCapturing] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const exportCardRef = useRef<HTMLDivElement>(null);
  const shareObjectUrlRef = useRef<string | null>(null);
  const backfillAttempted = useRef(false);
  const metricsMountTimeRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const metricsFirstUsablePaintLoggedRef = useRef(false);
  const lastCanonicalFetchKeyRef = useRef<string | null>(null);
  const lastBarListFetchKeyRef = useRef<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);

  const dateRangeSyncKey = dateRange?.from && dateRange?.to
    ? `${dateRange.from.toISOString()}|${dateRange.to.toISOString()}`
    : 'all-time';
  const lastSyncedBarListRangeKeyRef = useRef<string | null>(null);
  const computerSnapshotQuery = useComputerSnapshotQuery({
    userId: user?.id,
    dateRange,
    enabled: isUserLoaded && Boolean(user?.id),
    allTimeDays: 90,
  });
  const computerActivityDaily = useMemo<MetricDailyRow[]>(
    () =>
      (computerSnapshotQuery.data?.daily ?? []).map((row) => ({
        day: row.day,
        active_hours: row.active_hours,
        active_ms: row.active_ms,
        events_count: row.events_count,
        apps_count: row.apps_count ?? 0,
        domains_count: row.domains_count ?? 0,
      })),
    [computerSnapshotQuery.data?.daily],
  );

  useEffect(() => {
    perfInfo('metrics-view', 'mount', {
      has_date_range: Boolean(dateRange?.from),
      selected_habit_count: selectedHabits.length,
      available_habit_count: availableHabits.length,
    });
    if (process.env.NODE_ENV === 'production') return;
    auditLocalStorage('metrics-view', ['ritual:react-query-cache:v1', CARD_ORDER_KEY]);
  }, []);
  const [shareImageBlob, setShareImageBlob] = useState<Blob | null>(null);
  const [shareLabel, setShareLabel] = useState<string>('chart');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [downloadState, setDownloadState] = useState<'idle' | 'done' | 'failed'>('idle');

  // Use transformed habits from shared context
  const availableHabits = transformedHabits;
  const detectedComputerHabitId = React.useMemo(
    () => availableHabits.find((habit) => isComputerHabitName(habit.habit_name))?.habit_id || null,
    [availableHabits],
  );
  const filteredHabits = React.useMemo(
    () => availableHabits.filter((habit) => !isComputerHabitName(habit.habit_name)),
    [availableHabits],
  );
  const filteredHabitIds = React.useMemo(
    () => filteredHabits.map((habit: HabitData) => habit.habit_id).filter((id: string): id is string => !!id),
    [filteredHabits],
  );
  const visibleMetricHabitIds = React.useMemo(() => {
    const validSelected = selectedHabits.filter((id: string): id is string => !!id);
    const selectedFilteredHabitIds = validSelected.length > 0
      ? validSelected.filter((id) => filteredHabitIds.includes(id))
      : filteredHabitIds;

    const orderedIds = appliedCardOrder.length > 0
      ? [
          ...appliedCardOrder.filter((id: string) => selectedFilteredHabitIds.includes(id)),
          ...selectedFilteredHabitIds.filter((id: string) => !appliedCardOrder.includes(id)),
        ]
      : selectedFilteredHabitIds;

    const categoryFilteredIds = activeCategoryTab
      ? orderedIds.filter((id) => {
          const habit = filteredHabits.find((candidate: HabitData) => candidate.habit_id === id);
          return habit ? getMetricCategoryForHabit(habit.habit_name, habit.category) === activeCategoryTab : false;
        })
      : orderedIds;

    const totalPages = Math.max(1, Math.ceil(categoryFilteredIds.length / CARDS_PER_PAGE));
    const safePage = Math.min(cardPage, totalPages - 1);
    const pageStart = safePage * CARDS_PER_PAGE;
    return categoryFilteredIds.slice(pageStart, pageStart + CARDS_PER_PAGE);
  }, [activeCategoryTab, appliedCardOrder, cardPage, filteredHabitIds, filteredHabits, selectedHabits]);
  const hasCustomDateRange = !!(dateRange?.from && dateRange?.to);
  const expandedHabitData = React.useMemo(
    () => availableHabits.find((h: HabitData) => h.habit_id === expandedHabit) || null,
    [availableHabits, expandedHabit],
  );
  const expandedHabitUsesGranularHeartRate = isGranularHeartRateHabit(expandedHabitData);

  const habitLogsByHabitId = useMemo(() => {
    const grouped = new Map<string, typeof habitLogs>();
    for (const log of habitLogs) {
      if (!log?.habit_id) continue;
      const habitId = String(log.habit_id);
      const existing = grouped.get(habitId);
      if (existing) {
        existing.push(log);
      } else {
        grouped.set(habitId, [log]);
      }
    }
    return grouped;
  }, [habitLogs]);

  useEffect(() => {
    if (lastSyncedBarListRangeKeyRef.current === dateRangeSyncKey) return;
    lastSyncedBarListRangeKeyRef.current = dateRangeSyncKey;
    setBarListRange(dateRangeToBarListRange(dateRange));
  }, [dateRange, dateRangeSyncKey]);

  useEffect(() => {
    setAnalyticsData(initialAnalyticsData ?? {});
    setSummaryMetrics(initialSummaryMetrics ?? {});
    if (
      Object.keys(initialAnalyticsData ?? {}).length > 0
      || Object.keys(initialSummaryMetrics ?? {}).length > 0
    ) {
      lastHydratedCanonicalRangeKeyRef.current = dateRangeSyncKey;
    }
  }, [dateRangeSyncKey, initialAnalyticsData, initialSummaryMetrics]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleRealtimeHabitUpdate = () => {
      setRealtimeRefreshTick((tick) => tick + 1);
    };

    window.addEventListener('ritual:habit-log-updated', handleRealtimeHabitUpdate);
    return () => {
      window.removeEventListener('ritual:habit-log-updated', handleRealtimeHabitUpdate);
    };
  }, []);

  const captureExpandedChart = useCallback(async (label: string) => {
    const captureTarget = exportCardRef.current || chartRef.current;
    if (!captureTarget || isCapturing) return;

    setShareLabel(label);
    setShowShareModal(true);
    setShareImageUrl(null);
    setShareImageBlob(null);
    setCopyState('idle');
    setDownloadState('idle');
    setIsCapturing(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const scale = Math.max(2, Math.min(4, (window.devicePixelRatio || 1) * 2));
      const canvas = await html2canvas(captureTarget, {
        backgroundColor: '#FFFFFF',
        scale,
        useCORS: true,
        logging: false,
        removeContainer: true,
        onclone: (clonedDoc) => {
          clonedDoc.querySelectorAll<HTMLElement>('[data-export-title]').forEach((el) => {
            el.style.overflow = 'visible';
            el.style.textOverflow = 'clip';
            el.style.whiteSpace = 'normal';
          });
          clonedDoc.querySelectorAll<HTMLElement>('[data-export-close]').forEach((el) => {
            el.style.display = 'none';
          });
        },
      });

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), 'image/png', 1);
      });
      if (!blob) {
        throw new Error('Failed to render image blob');
      }

      const objectUrl = URL.createObjectURL(blob);
      if (shareObjectUrlRef.current) {
        URL.revokeObjectURL(shareObjectUrlRef.current);
      }
      shareObjectUrlRef.current = objectUrl;
      setShareImageUrl(objectUrl);
      setShareImageBlob(blob);
    } catch (error) {
      console.error('Failed to export chart image:', error);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  const closeShareModal = useCallback(() => {
    setShowShareModal(false);
    setCopyState('idle');
    setDownloadState('idle');
    setShareImageBlob(null);
    setShareImageUrl(null);
    if (shareObjectUrlRef.current) {
      URL.revokeObjectURL(shareObjectUrlRef.current);
      shareObjectUrlRef.current = null;
    }
  }, []);

  const getShareFileName = useCallback(() => {
    const fileBase = shareLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'habit-chart';
    return `${fileBase}-${format(new Date(), 'yyyyMMdd')}.png`;
  }, [shareLabel]);

  const getShareBlob = useCallback(async (): Promise<Blob | null> => {
    if (shareImageBlob) return shareImageBlob;
    if (!shareImageUrl) return null;
    const response = await fetch(shareImageUrl);
    if (!response.ok) return null;
    return response.blob();
  }, [shareImageBlob, shareImageUrl]);

  const downloadShareImage = useCallback(async () => {
    try {
      const blob = await getShareBlob();
      if (!blob) {
        setDownloadState('failed');
        return;
      }

      const fileName = getShareFileName();

      if (isTauri()) {
        const [{ save }, { writeBinaryFile }] = await Promise.all([
          import('@tauri-apps/api/dialog'),
          import('@tauri-apps/api/fs'),
        ]);
        const destination = await save({
          defaultPath: fileName,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });
        if (!destination) return;

        const bytes = new Uint8Array(await blob.arrayBuffer());
        await writeBinaryFile({
          path: destination,
          contents: bytes,
        });
      } else {
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = fileName;
        link.href = downloadUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 250);
      }

      setDownloadState('done');
    } catch (error) {
      console.error('Failed to download chart image:', error);
      setDownloadState('failed');
    }
  }, [getShareBlob, getShareFileName]);

  const copyShareImage = useCallback(async () => {
    try {
      const blob = await getShareBlob();
      if (!blob) {
        setCopyState('failed');
        return;
      }

      if (typeof navigator !== 'undefined'
        && navigator.clipboard?.write
        && typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          [blob.type || 'image/png']: blob,
        });
        await navigator.clipboard.write([item]);
        setCopyState('copied');
        return;
      }

      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        const png_base64 = btoa(binary);
        await invoke('copy_png_to_clipboard', { png_base64 });
        setCopyState('copied');
        return;
      }

      setCopyState('failed');
    } catch (error) {
      console.error('Failed to copy chart image:', error);
      setCopyState('failed');
    }
  }, [getShareBlob]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (downloadState === 'idle') return;
    const timer = window.setTimeout(() => setDownloadState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [downloadState]);

  useEffect(() => {
    return () => {
      if (shareObjectUrlRef.current) {
        URL.revokeObjectURL(shareObjectUrlRef.current);
        shareObjectUrlRef.current = null;
      }
    };
  }, []);

  // Auto-select all habits when data loads
  useEffect(() => {
    if (availableHabits.length > 0 && selectedHabits.length === 0) {
      const allHabitIds = availableHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);
      if (allHabitIds.length > 0) {
        setSelectedHabits(allHabitIds);
      }
    }
  }, [availableHabits, selectedHabits.length, setSelectedHabits]);

  const localCardFallbackData = useMemo(() => {
    const now = new Date();
    const hasExplicitRange = Boolean(dateRange?.from && dateRange?.to);
    const selectedFrom = hasExplicitRange ? dateRange!.from! : subDays(now, DEFAULT_METRICS_SUMMARY_DAYS);
    const selectedTo = hasExplicitRange ? dateRange!.to! : now;
    const comparisonWindowMs = hasExplicitRange ? selectedTo.getTime() - selectedFrom.getTime() : 0;
    const dailyFrom = hasExplicitRange
      ? new Date(selectedFrom.getTime() - comparisonWindowMs)
      : subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS);
    const dailyFromDate = format(dailyFrom, 'yyyy-MM-dd');
    const summaryFromDate = format(selectedFrom, 'yyyy-MM-dd');
    const summaryToDate = format(selectedTo, 'yyyy-MM-dd');

    const analyticsDataByHabit: Record<string, MetricDailyRow[]> = {};
    const summaryByHabit: Record<string, LocalMetricSummaryRow> = {};

    for (const habit of filteredHabits) {
      const logs = habitLogsByHabitId.get(habit.habit_id) || [];
      const dailyRows = buildLocalMetricDailyRows(
        habit,
        logs,
        dailyFromDate,
        summaryToDate,
      );
      const summaryRows = buildLocalMetricDailyRows(
        habit,
        logs,
        summaryFromDate,
        summaryToDate,
      );
      const summary = buildLocalMetricSummary(habit, summaryRows);

      if (dailyRows.length > 0) {
        analyticsDataByHabit[habit.habit_id] = dailyRows;
      }
      if (summary) {
        summaryByHabit[habit.habit_id] = summary;
      }
    }

    return {
      analyticsDataByHabit,
      summaryByHabit,
    };
  }, [
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
    filteredHabits,
    habitLogsByHabitId,
  ]);

  const localBarListFallbackData = useMemo(() => {
    const { from, to } = getRangeDates(barListRange as RangeKey);
    const isAllRange = (barListRange as RangeKey) === 'ALL';
    const windowMs = to.getTime() - from.getTime();
    const fetchFrom = isAllRange ? from : new Date(from.getTime() - windowMs);
    const dailyFromDate = format(fetchFrom, 'yyyy-MM-dd');
    const summaryFromDate = format(from, 'yyyy-MM-dd');
    const summaryToDate = format(to, 'yyyy-MM-dd');

    const analyticsDataByHabit: Record<string, MetricDailyRow[]> = {};
    const summaryByHabit: Record<string, LocalMetricSummaryRow> = {};

    for (const habit of filteredHabits) {
      const logs = habitLogsByHabitId.get(habit.habit_id) || [];
      const dailyRows = buildLocalMetricDailyRows(
        habit,
        logs,
        dailyFromDate,
        summaryToDate,
      );
      const summaryRows = buildLocalMetricDailyRows(
        habit,
        logs,
        summaryFromDate,
        summaryToDate,
      );
      const summary = buildLocalMetricSummary(habit, summaryRows);

      if (dailyRows.length > 0) {
        analyticsDataByHabit[habit.habit_id] = dailyRows;
      }
      if (summary) {
        summaryByHabit[habit.habit_id] = summary;
      }
    }

    return {
      analyticsDataByHabit,
      summaryByHabit,
    };
  }, [barListRange, filteredHabits, habitLogsByHabitId]);

  const mergedCardAnalyticsData = useMemo(() => {
    const merged: Record<string, MetricDailyRow[]> = { ...analyticsData };
    for (const habit of filteredHabits) {
      if (!merged[habit.habit_id]?.length) {
        const fallbackRows = localCardFallbackData.analyticsDataByHabit[habit.habit_id];
        if (fallbackRows?.length) {
          merged[habit.habit_id] = fallbackRows;
        }
      }
    }
    return merged;
  }, [analyticsData, filteredHabits, localCardFallbackData.analyticsDataByHabit]);

  const mergedCardSummaryMetrics = useMemo(() => {
    const merged: Record<string, any> = { ...summaryMetrics };
    for (const habit of filteredHabits) {
      if (!hasUsableMetricSummary(merged[habit.habit_id])) {
        const fallbackSummary = localCardFallbackData.summaryByHabit[habit.habit_id];
        if (fallbackSummary) {
          merged[habit.habit_id] = fallbackSummary;
        }
      }
    }
    return merged;
  }, [filteredHabits, localCardFallbackData.summaryByHabit, summaryMetrics]);

  const mergedBarListAnalyticsData = useMemo(() => {
    const merged: Record<string, MetricDailyRow[]> = { ...barListAnalyticsData };
    for (const habit of filteredHabits) {
      if (!merged[habit.habit_id]?.length) {
        const fallbackRows = localBarListFallbackData.analyticsDataByHabit[habit.habit_id];
        if (fallbackRows?.length) {
          merged[habit.habit_id] = fallbackRows;
        }
      }
    }
    return merged;
  }, [barListAnalyticsData, filteredHabits, localBarListFallbackData.analyticsDataByHabit]);

  const mergedBarListSummaryMetrics = useMemo(() => {
    const merged: Record<string, any> = { ...barListSummaryMetrics };
    for (const habit of filteredHabits) {
      if (!hasUsableMetricSummary(merged[habit.habit_id])) {
        const fallbackSummary = localBarListFallbackData.summaryByHabit[habit.habit_id];
        if (fallbackSummary) {
          merged[habit.habit_id] = fallbackSummary;
        }
      }
    }
    return merged;
  }, [barListSummaryMetrics, filteredHabits, localBarListFallbackData.summaryByHabit]);

  // Fetch canonical daily values + summary (Tinybird first, Python fallback only on failure)
  useEffect(() => {
    if (!isUserLoaded || !user?.id) return;

    const habitsToFetch = visibleMetricHabitIds;
    const hasQueryBackedCanonicalData =
      Object.keys(initialAnalyticsData ?? {}).length > 0 ||
      Object.keys(initialSummaryMetrics ?? {}).length > 0;

    if (habitsToFetch.length === 0) {
      setAnalyticsData({});
      setSummaryMetrics({});
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchCanonicalAnalytics = async () => {
      const useWideRange = !dateRange?.from || !dateRange?.to;
      const canonicalFetchKey = [
        habitsToFetch.join(','),
        useWideRange ? `wide:${DEFAULT_METRICS_SPARKLINE_DAYS}:${DEFAULT_METRICS_SUMMARY_DAYS}` : `${dateRange!.from!.toISOString()}:${dateRange!.to!.toISOString()}`,
        realtimeRefreshTick,
      ].join('|');

      if (
        lastCanonicalFetchKeyRef.current === canonicalFetchKey &&
        (Object.keys(analyticsData).length > 0 || Object.keys(summaryMetrics).length > 0)
      ) {
        return;
      }
      lastCanonicalFetchKeyRef.current = canonicalFetchKey;

      const stopTimer = startPerfTimer('metrics-view', 'fetch-canonical-analytics', {
        habit_count: habitsToFetch.length,
        has_existing_data: Object.keys(analyticsData).length > 0,
        use_wide_range: useWideRange,
      });
      const hasExistingData = Object.keys(analyticsData).length > 0;
      if (!hasExistingData) {
        setLoading(true);
      }
      setAnalyticsError(null);

      const params = new URLSearchParams();
      const dailyParams = new URLSearchParams();
      const summaryParams = new URLSearchParams();

      if (!useWideRange) {
        const startDate = format(dateRange!.from!, 'yyyy-MM-dd');
        const endDate = format(dateRange!.to!, 'yyyy-MM-dd');
        // Extend the daily fetch back by one window length so the spark cards
        // can compute "vs prior equivalent window" without a second round trip.
        // The summary range still reflects the user-selected window only.
        const windowMs = dateRange!.to!.getTime() - dateRange!.from!.getTime();
        const priorFromDate = new Date(dateRange!.from!.getTime() - windowMs);
        const dailyStartDate = format(priorFromDate, 'yyyy-MM-dd');
        dailyParams.set('start_date', dailyStartDate);
        dailyParams.set('end_date', endDate);
        summaryParams.set('start_date', startDate);
        summaryParams.set('end_date', endDate);
      } else {
        // Keep "All time" totals, but cap sparkline history so the initial metrics
        // grid does not have to download years of daily rows for every habit.
        dailyParams.set('days_back', String(DEFAULT_METRICS_SPARKLINE_DAYS));
        summaryParams.set('days_back', String(DEFAULT_METRICS_SUMMARY_DAYS));
      }

      if (habitsToFetch.length === 1) {
        dailyParams.set('habit_id', habitsToFetch[0]);
        summaryParams.set('habit_id', habitsToFetch[0]);
      } else {
        const joinedIds = habitsToFetch.join(',');
        dailyParams.set('habit_ids', joinedIds);
        summaryParams.set('habit_ids', joinedIds);
      }

      try {
        const [dailyRes, summaryRes] = await Promise.all([
          fetch(`/api/analytics/habits/daily-values?output=daily&${dailyParams.toString()}`),
          fetch(`/api/analytics/habits/daily-values?output=summary&${summaryParams.toString()}`),
        ]);
        if (cancelled) return;

        if (!dailyRes.ok || !summaryRes.ok) {
          throw new Error(`Tinybird canonical fetch failed (daily=${dailyRes.status}, summary=${summaryRes.status})`);
        }

        const [dailyPayload, summaryPayload] = await Promise.all([
          dailyRes.json(),
          summaryRes.json(),
        ]);
        if (cancelled) return;

        const dataByHabit: Record<string, any[]> = {};
        habitsToFetch.forEach((habitId: string) => {
          dataByHabit[habitId] = [];
        });

        (dailyPayload.data || []).forEach((row: any) => {
          if (habitsToFetch.includes(row.habit_id)) {
            dataByHabit[row.habit_id].push(row);
          }
        });

        const summaryMap: Record<string, any> = {};
        (summaryPayload.data || []).forEach((row: any) => {
          summaryMap[row.habit_id] = row;
        });

        const totalDailyRows = Object.values(dataByHabit).reduce((sum, rows) => sum + rows.length, 0);
        const habitsWithData = Object.values(dataByHabit).filter(rows => rows.length > 0).length;
        const coverageRatio = habitsToFetch.length > 0 ? habitsWithData / habitsToFetch.length : 0;

        if (totalDailyRows === 0) {
          throw new Error('Tinybird returned no daily data, falling back to Python backend');
        }

        if (habitsToFetch.length > 1 && coverageRatio < 0.5) {
          console.warn(`⚠️ Tinybird only has data for ${habitsWithData}/${habitsToFetch.length} habits (${(coverageRatio * 100).toFixed(0)}%), falling back to Python`);
          throw new Error('Tinybird data too sparse, falling back to Python backend');
        }

        const sleepHabitIds = habitsToFetch.filter((habitId) =>
          isSleepLikeHabit(availableHabits.find((habit: HabitData) => habit.habit_id === habitId))
        );

        if (sleepHabitIds.length > 0) {
          const token = await getToken();
          if (token) {
            const now = new Date();
            const to = useWideRange ? now : (dateRange?.to || now);
            const summaryFrom = useWideRange ? subDays(now, DEFAULT_METRICS_SUMMARY_DAYS) : (dateRange?.from || subDays(now, DEFAULT_METRICS_SUMMARY_DAYS));
            const dailyFrom = useWideRange ? subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS) : (dateRange?.from || subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS));
            const summaryStartDate = format(summaryFrom, 'yyyy-MM-dd');
            const dailyStartDate = format(dailyFrom, 'yyyy-MM-dd');
            const endDate = format(to, 'yyyy-MM-dd');
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

            const [statsResult, dailyResults] = await Promise.all([
              analyticsApi.getHabitStats(token, { startDate: summaryStartDate, endDate }),
              Promise.all(
                sleepHabitIds.map((habitId) =>
                  analyticsApi.getDailyBreakdown(token, {
                    habitId,
                    startDate: dailyStartDate,
                    endDate,
                    timezone,
                  }).catch(() => null)
                )
              ),
            ]);

            const statsById = new Map(
              (statsResult.habits || []).map((stat: any) => [stat.id, stat])
            );

            sleepHabitIds.forEach((habitId, index) => {
              const stat = statsById.get(habitId);
              if (stat) {
                summaryMap[habitId] = {
                  ...(summaryMap[habitId] || {}),
                  habit_id: stat.id,
                  habit_name: stat.name,
                  unit: stat.unit,
                  total_value: stat.total,
                  current_value: stat.average,
                  days_with_data: stat.days_with_data,
                };
              }

              const response = dailyResults[index];
              const rows = response?.data || response?.daily_data || [];
              if (rows.length > 0) {
                dataByHabit[habitId] = mapDailyBreakdownRows(habitId, rows);
              }
            });
          }
        }

        if (cancelled) return;
        setAnalyticsData(dataByHabit);
        setSummaryMetrics(summaryMap);
        stopTimer({
          success: true,
          source: 'tinybird_primary',
          daily_rows: totalDailyRows,
          habits_with_data: habitsWithData,
          summary_rows: Object.keys(summaryMap).length,
        });
      } catch (error) {
        perfError('metrics-view', 'fetch-canonical-analytics-primary-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          const token = await getToken();
          if (!token) {
            throw new Error('Authentication required to load analytics metrics.');
          }

          const now = new Date();
          const to = useWideRange ? now : (dateRange?.to || now);
          const summaryFrom = useWideRange ? subDays(now, DEFAULT_METRICS_SUMMARY_DAYS) : (dateRange?.from || subDays(now, DEFAULT_METRICS_SUMMARY_DAYS));
          const dailyFrom = useWideRange ? subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS) : (dateRange?.from || subDays(now, DEFAULT_METRICS_SPARKLINE_DAYS));
          const fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

          const [statsResult, dailyResults] = await Promise.all([
            analyticsApi.getHabitStats(token, {
              startDate: format(summaryFrom, 'yyyy-MM-dd'),
              endDate: format(to, 'yyyy-MM-dd'),
            }),
            Promise.all(
              habitsToFetch.map((habitId) =>
                analyticsApi.getDailyBreakdown(token, {
                  habitId,
                  startDate: format(dailyFrom, 'yyyy-MM-dd'),
                  endDate: format(to, 'yyyy-MM-dd'),
                  timezone: fallbackTimezone,
                }).catch(() => null)
              )
            ),
          ]);
          if (cancelled) return;

          const fallbackSummaryMap: Record<string, any> = {};
          (statsResult.habits || []).forEach((stat: any) => {
            fallbackSummaryMap[stat.id] = {
              habit_id: stat.id,
              habit_name: stat.name,
              unit: stat.unit,
              total_value: stat.total,
              current_value: stat.average,
              previous_value: 0,
              change_pct: 0,
              absolute_change: 0,
              days_with_data: stat.days_with_data,
            };
          });

          const fallbackDailyByHabit: Record<string, any[]> = {};
          habitsToFetch.forEach((habitId: string, index: number) => {
            const response = dailyResults[index];
            const rows = response?.data || response?.daily_data || [];
            fallbackDailyByHabit[habitId] = mapDailyBreakdownRows(habitId, rows);
          });

          if (cancelled) return;
          setSummaryMetrics(fallbackSummaryMap);
          setAnalyticsData(fallbackDailyByHabit);
          stopTimer({
            success: true,
            source: 'python_fallback',
            summary_rows: Object.keys(fallbackSummaryMap).length,
            daily_habits: Object.keys(fallbackDailyByHabit).length,
          });

          if (!backfillAttempted.current) {
            backfillAttempted.current = true;
            fetch(`${process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000'}/api/analytics/tinybird-backfill`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            }).then(r => r.json())
              .then(res => console.log('📊 Tinybird backfill result:', res))
              .catch(err => console.warn('⚠️ Tinybird backfill failed (non-critical):', err));
          }
        } catch (fallbackError) {
          lastCanonicalFetchKeyRef.current = null;
          perfError('metrics-view', 'fetch-canonical-analytics-fallback-failed', {
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
          setAnalyticsData({});
          setSummaryMetrics({});
          setAnalyticsError(
            fallbackError instanceof Error
              ? fallbackError.message
              : 'Unable to load analytics metrics at the moment.',
          );
          stopTimer({
            success: false,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    if (
      hasQueryBackedCanonicalData
      && (
        (!dateRange?.from && hasInitialMetricsAnalytics && hasInitialMetricsSummary)
        || Boolean(dateRange?.from)
      )
      && lastHydratedCanonicalRangeKeyRef.current !== dateRangeSyncKey
    ) {
      lastHydratedCanonicalRangeKeyRef.current = dateRangeSyncKey;
      setLoading(false);
      return;
    }

    fetchCanonicalAnalytics();

    return () => {
      cancelled = true;
    };
  }, [
    visibleMetricHabitIds.join(','),
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
    isUserLoaded,
    realtimeRefreshTick,
    user?.id,
    getToken,
    initialAnalyticsData,
    initialSummaryMetrics,
    hasInitialMetricsAnalytics,
    hasInitialMetricsSummary,
  ]);

  useEffect(() => {
    if (!isUserLoaded || !user?.id) return;

    const validSelected = selectedHabits.filter((id: string): id is string => !!id);
    const habitsToFetch = validSelected.length > 0
      ? validSelected.filter((id: string) => filteredHabitIds.includes(id))
      : filteredHabitIds;

    if (habitsToFetch.length === 0) {
      setBarListAnalyticsData({});
      setBarListSummaryMetrics({});
      return;
    }

    const { from, to } = getRangeDates(barListRange as RangeKey);
    // Fetch one extra window-length backwards so the bar list can compare the
    // visible window against the prior equivalent window. ALL is excluded from
    // the comparison (see buildMetricsBarData) so we don't double its payload.
    const isAllRange = (barListRange as RangeKey) === 'ALL';
    const windowMs = to.getTime() - from.getTime();
    const fetchFrom = isAllRange ? from : new Date(from.getTime() - windowMs);
    const startDate = format(fetchFrom, 'yyyy-MM-dd');
    const endDate = format(to, 'yyyy-MM-dd');
    const controller = new AbortController();
    const barListFetchKey = [
      habitsToFetch.join(','),
      barListRange,
      startDate,
      endDate,
      realtimeRefreshTick,
    ].join('|');

    const fetchBarListAnalytics = async () => {
      if (
        lastBarListFetchKeyRef.current === barListFetchKey &&
        (Object.keys(barListAnalyticsData).length > 0 || Object.keys(barListSummaryMetrics).length > 0)
      ) {
        return;
      }
      lastBarListFetchKeyRef.current = barListFetchKey;

      const stopTimer = startPerfTimer('metrics-view', 'fetch-bar-list-analytics', {
        habit_count: habitsToFetch.length,
        range: barListRange,
      });
      try {
        const dailyParams = new URLSearchParams({
          output: 'daily',
          habit_ids: habitsToFetch.join(','),
          start_date: startDate,
          end_date: endDate,
        });

        const summaryParams = new URLSearchParams({
          start_date: startDate,
          end_date: endDate,
        });

        const [dailyRes, summaryRes] = await Promise.all([
          fetch(`/api/analytics/habits/daily-values?${dailyParams.toString()}`, {
            signal: controller.signal,
          }),
          fetch(`/api/analytics/habits/summary?${summaryParams.toString()}`, {
            signal: controller.signal,
          }),
        ]);

        if (!dailyRes.ok || !summaryRes.ok) {
          throw new Error(`Bar list analytics failed (daily=${dailyRes.status}, summary=${summaryRes.status})`);
        }

        const [dailyPayload, summaryPayload] = await Promise.all([
          dailyRes.json(),
          summaryRes.json(),
        ]);

        if (controller.signal.aborted) return;

        const nextDailyByHabit: Record<string, any[]> = {};
        habitsToFetch.forEach((habitId) => {
          nextDailyByHabit[habitId] = [];
        });

        for (const row of Array.isArray(dailyPayload?.data) ? dailyPayload.data : []) {
          if (row?.habit_id && nextDailyByHabit[row.habit_id]) {
            nextDailyByHabit[row.habit_id].push(row);
          }
        }

        const nextSummaryByHabit: Record<string, any> = {};
        for (const row of Array.isArray(summaryPayload?.data) ? summaryPayload.data : []) {
          if (row?.habit_id && habitsToFetch.includes(row.habit_id)) {
            nextSummaryByHabit[row.habit_id] = row;
          }
        }

        setBarListAnalyticsData(nextDailyByHabit);
        setBarListSummaryMetrics(nextSummaryByHabit);
        stopTimer({
          success: true,
          daily_habits: Object.keys(nextDailyByHabit).length,
          summary_rows: Object.keys(nextSummaryByHabit).length,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        lastBarListFetchKeyRef.current = null;
        perfError('metrics-view', 'fetch-bar-list-analytics-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        setBarListAnalyticsData({});
        setBarListSummaryMetrics({});
        stopTimer({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    if (!dateRange?.from && hasInitialBarListAnalytics && hasInitialBarListSummary && !skippedInitialBarListFetchRef.current) {
      skippedInitialBarListFetchRef.current = true;
      return;
    }

    fetchBarListAnalytics();

    return () => {
      controller.abort();
    };
  }, [
    barListRange,
    filteredHabitIds.join(','),
    getToken,
    isUserLoaded,
    realtimeRefreshTick,
    selectedHabits.join(','),
    user?.id,
    hasInitialBarListAnalytics,
    hasInitialBarListSummary,
  ]);

  useEffect(() => {
    if (metricsFirstUsablePaintLoggedRef.current) return;
    if (queryLoading || loading) return;
    if (
      Object.keys(summaryMetrics).length === 0 &&
      Object.keys(barListSummaryMetrics).length === 0 &&
      computerActivityDaily.length === 0
    ) {
      return;
    }

    metricsFirstUsablePaintLoggedRef.current = true;
    const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    perfInfo('metrics-view', 'first-usable-paint', {
      duration_ms: Number((end - metricsMountTimeRef.current).toFixed(2)),
      summary_rows: Object.keys(summaryMetrics).length,
      bar_list_summary_rows: Object.keys(barListSummaryMetrics).length,
      computer_daily_rows: computerActivityDaily.length,
    });
  }, [
    barListSummaryMetrics,
    computerActivityDaily.length,
    loading,
    queryLoading,
    summaryMetrics,
  ]);



  // Fetch correlation data
  useEffect(() => {
    if (!expandedHabit || !compareHabitId || expandedHabit === COMPUTER_ACTIVITY_CARD_ID || expandedHabitUsesGranularHeartRate) {
      setCorrelationData(null);
      return;
    }

    const fetchCorrelation = async () => {
      setLoadingCorrelation(true);
      try {
        const params = new URLSearchParams({
          habit1_id: expandedHabit,
          habit2_id: compareHabitId,
          days_back: '90',
        });

        const res = await fetch(`/api/analytics/correlation?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data) {
            setCorrelationData(data.data);
          }
        }
      } catch (error) {
        console.error('❌ Failed to fetch correlation:', error);
      } finally {
        setLoadingCorrelation(false);
      }
    };

    fetchCorrelation();
  }, [expandedHabit, compareHabitId, expandedHabitUsesGranularHeartRate]);

  useEffect(() => {
    if (!expandedHabitUsesGranularHeartRate) {
      setHeartRateExpandedSeries([]);
      setHeartRateExpandedSummary(null);
      return;
    }

    const controller = new AbortController();
    const rangeDates = hasCustomDateRange
      ? { from: dateRange!.from!, to: dateRange!.to! }
      : getRangeDates(expandedTimeRange);
    const rangeSpanDays = differenceInDays(rangeDates.to, rangeDates.from) + 1;
    const bucket = getHeartRateBucket(expandedTimeRange, rangeSpanDays);
    const params = new URLSearchParams({
      start_date: format(rangeDates.from, 'yyyy-MM-dd'),
      end_date: format(rangeDates.to, 'yyyy-MM-dd'),
      bucket,
    });

    const fetchExpandedHeartRate = async () => {
      setLoadingExpandedLogs(true);
      try {
        const [summaryRes, seriesRes] = await Promise.all([
          fetch(`/api/analytics/heart-rate/summary?${params.toString()}`, { signal: controller.signal }),
          fetch(`/api/analytics/heart-rate/series?${params.toString()}`, { signal: controller.signal }),
        ]);

        if (!summaryRes.ok || !seriesRes.ok) {
          throw new Error(`Failed to load heart-rate detail (summary=${summaryRes.status}, series=${seriesRes.status})`);
        }

        const [summaryPayload, seriesPayload] = await Promise.all([
          summaryRes.json(),
          seriesRes.json(),
        ]);

        if (controller.signal.aborted) return;

        setHeartRateExpandedSummary(summaryPayload?.data || null);
        setHeartRateExpandedSeries(Array.isArray(seriesPayload?.data) ? seriesPayload.data : []);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('Failed to load expanded heart-rate analytics:', error);
        setHeartRateExpandedSummary(null);
        setHeartRateExpandedSeries([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoadingExpandedLogs(false);
        }
      }
    };

    fetchExpandedHeartRate();

    return () => controller.abort();
  }, [
    expandedHabitUsesGranularHeartRate,
    expandedTimeRange,
    hasCustomDateRange,
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
  ]);

  // Fetch expanded logs
  useEffect(() => {
    if (!expandedHabit) {
      setExpandedLogs([]);
      setExpandedSyncContext(null);
      setExpandedTimeRange('1M');
      setCompareHabitId(null);
      setComparisonLogs([]);
      return;
    }

    if (expandedHabit === COMPUTER_ACTIVITY_CARD_ID || expandedHabitUsesGranularHeartRate) {
      setExpandedLogs([]);
      setExpandedSyncContext(null);
      setCompareHabitId(null);
      setComparisonLogs([]);
      if (expandedHabit === COMPUTER_ACTIVITY_CARD_ID) {
        setLoadingExpandedLogs(false);
      }
      return;
    }

    const metricType = String((expandedHabitData as any)?.metric_type || '').toLowerCase();
    const habitName = String(expandedHabitData?.habit_name || '').toLowerCase();
    const shouldAttachSleepMetadata = metricType.includes('sleep') || habitName.includes('sleep');
    const shouldPreferPythonBreakdown = isSleepLikeHabit(expandedHabitData);

    const enrichRowsWithSleepMetadata = async (
      rows: any[],
      habitId: string,
      startDate: string,
      endDate: string,
    ) => {
      if (!shouldAttachSleepMetadata || rows.length === 0) {
        return rows;
      }

      try {
        const params = new URLSearchParams({
          habits: habitId,
          statuses: 'completed',
          start_date: startDate,
          end_date: endDate,
          sort: 'date',
          order: 'asc',
          limit: '1000',
        });
        const response = await fetch(`/api/analytics/habits/logs/all?${params.toString()}`);
        if (!response.ok) {
          return rows;
        }

        const payload = await response.json();
        const logs = Array.isArray(payload?.data) ? payload.data : [];
        if (logs.length === 0) {
          return rows;
        }

        const metadataByDate = new Map<string, { metadata: Record<string, unknown>; completed_at?: string; score: number }>();

        logs.forEach((log: any) => {
          let parsedMeta: Record<string, unknown> = {};
          if (log?.metadata) {
            if (typeof log.metadata === 'string') {
              try {
                parsedMeta = JSON.parse(log.metadata);
              } catch {
                parsedMeta = {};
              }
            } else if (typeof log.metadata === 'object') {
              parsedMeta = { ...log.metadata };
            }
          }

          const sleepOnset = (
            parsedMeta.sleep_onset
            ?? parsedMeta.sleepOnset
            ?? log?.sleep_onset
            ?? log?.sleepOnset
            ?? null
          ) as string | null;
          const sleepEnd = (
            parsedMeta.sleep_end
            ?? parsedMeta.sleepEnd
            ?? log?.sleep_end
            ?? log?.sleepEnd
            ?? null
          ) as string | null;
          const completedAt = (log?.completed_at ?? log?.timestamp ?? null) as string | null;
          const dateKey = log?.date as string | undefined;

          if (!dateKey || (!sleepOnset && !sleepEnd && !completedAt)) {
            return;
          }

          const normalizedMeta: Record<string, unknown> = { ...parsedMeta };
          if (sleepOnset) normalizedMeta.sleep_onset = sleepOnset;
          if (sleepEnd) normalizedMeta.sleep_end = sleepEnd;

          const score = Number(Boolean(sleepOnset)) + Number(Boolean(sleepEnd));
          const existing = metadataByDate.get(dateKey);
          if (!existing) {
            metadataByDate.set(dateKey, {
              metadata: normalizedMeta,
              completed_at: completedAt || undefined,
              score,
            });
            return;
          }

          const existingTs = existing.completed_at ? new Date(existing.completed_at).getTime() : 0;
          const candidateTs = completedAt ? new Date(completedAt).getTime() : 0;
          const shouldReplace = score > existing.score || (score === existing.score && candidateTs > existingTs);
          if (shouldReplace) {
            metadataByDate.set(dateKey, {
              metadata: normalizedMeta,
              completed_at: completedAt || undefined,
              score,
            });
          }
        });

        if (metadataByDate.size === 0) {
          return rows;
        }

        return rows.map((row: any) => {
          const match = metadataByDate.get(row.date);
          if (!match) return row;

          let existingMeta: Record<string, unknown> = {};
          if (row.metadata) {
            if (typeof row.metadata === 'string') {
              try {
                existingMeta = JSON.parse(row.metadata);
              } catch {
                existingMeta = {};
              }
            } else if (typeof row.metadata === 'object') {
              existingMeta = { ...row.metadata };
            }
          }

          return {
            ...row,
            metadata: { ...existingMeta, ...match.metadata },
            completed_at: row.completed_at || match.completed_at,
          };
        });
      } catch {
        return rows;
      }
    };

    const fetchExpandedLogs = async () => {
      setLoadingExpandedLogs(true);
      try {
        let from: Date, to: Date;
        if (hasCustomDateRange) {
          from = dateRange!.from!;
          to = dateRange!.to!;
        } else {
          const rangeDates = getRangeDates(expandedTimeRange);
          from = rangeDates.from;
          to = rangeDates.to;
        }

        const startDate = format(from, 'yyyy-MM-dd');
        const endDate = format(to, 'yyyy-MM-dd');

        if (shouldPreferPythonBreakdown) {
          const token = await getToken();
          if (token) {
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: expandedHabit,
              startDate,
              endDate,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            }).catch(() => null);
            setExpandedSyncContext(fallback?.sync_context || null);
            const rows = mapDailyBreakdownRows(expandedHabit, fallback?.data || fallback?.daily_data || []);
            setExpandedLogs(rows);
            return;
          }
        }

        const response = await fetch(
          `/api/analytics/habits/daily-values?output=daily&habit_id=${expandedHabit}&start_date=${startDate}&end_date=${endDate}`
        );

        const result = await response.json();
        if (result.success && result.data?.length > 0) {
          setExpandedSyncContext(null);
          const enrichedRows = await enrichRowsWithSleepMetadata(
            result.data,
            expandedHabit,
            startDate,
            endDate,
          );
          setExpandedLogs(enrichedRows);
        } else {
          const token = await getToken();
          if (token) {
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: expandedHabit,
              startDate,
              endDate,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            }).catch(() => null);
            setExpandedSyncContext(fallback?.sync_context || null);
            const rows = mapDailyBreakdownRows(expandedHabit, fallback?.data || fallback?.daily_data || []);
            const enrichedRows = await enrichRowsWithSleepMetadata(
              rows,
              expandedHabit,
              startDate,
              endDate,
            );
            setExpandedLogs(enrichedRows);
          } else {
            setExpandedSyncContext(null);
            setExpandedLogs([]);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching expanded logs:', error);
        setExpandedSyncContext(null);
        setExpandedLogs([]);
      } finally {
        setLoadingExpandedLogs(false);
      }
    };

    fetchExpandedLogs();
  }, [
    expandedHabit,
    expandedTimeRange,
    hasCustomDateRange,
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
    expandedHabitData,
    expandedHabitUsesGranularHeartRate,
    getToken,
  ]);

  // Fetch comparison logs
  useEffect(() => {
    if (!expandedHabit || !compareHabitId || expandedHabit === COMPUTER_ACTIVITY_CARD_ID) {
      setComparisonLogs([]);
      return;
    }

    const fetchComparisonLogs = async () => {
      setLoadingComparison(true);
      try {
        let from: Date, to: Date;
        if (hasCustomDateRange) {
          from = dateRange!.from!;
          to = dateRange!.to!;
        } else {
          const rangeDates = getRangeDates(expandedTimeRange);
          from = rangeDates.from;
          to = rangeDates.to;
        }
        const startDate = format(from, 'yyyy-MM-dd');
        const endDate = format(to, 'yyyy-MM-dd');
        const compareHabit = availableHabits.find((h: HabitData) => h.habit_id === compareHabitId);

        if (isSleepLikeHabit(compareHabit)) {
          const token = await getToken();
          if (token) {
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: compareHabitId,
              startDate,
              endDate,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            }).catch(() => null);
            setComparisonLogs(mapDailyBreakdownRows(compareHabitId, fallback?.data || fallback?.daily_data || []));
            return;
          }
        }

        const response = await fetch(
          `/api/analytics/habits/daily-values?output=daily&habit_id=${compareHabitId}&start_date=${startDate}&end_date=${endDate}`
        );

        const result = await response.json();
        if (result.success && result.data?.length > 0) {
          setComparisonLogs(result.data);
        } else {
          const token = await getToken();
          if (token) {
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: compareHabitId,
              startDate,
              endDate,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            }).catch(() => null);
            const rows = mapDailyBreakdownRows(compareHabitId, fallback?.data || fallback?.daily_data || []);
            setComparisonLogs(rows);
          } else {
            setComparisonLogs([]);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching comparison logs:', error);
        setComparisonLogs([]);
      } finally {
        setLoadingComparison(false);
      }
    };

    fetchComparisonLogs();
  }, [compareHabitId, expandedTimeRange, expandedHabit, hasCustomDateRange, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]);

  useEffect(() => {
    if (expandedHabit !== COMPUTER_ACTIVITY_CARD_ID) return;
    if (detectedComputerHabitId && !selectedHabits.includes(detectedComputerHabitId)) {
      setExpandedHabit(null);
      return;
    }
    if (!computerActivityDaily.length) {
      setExpandedHabit(null);
    }
  }, [computerActivityDaily.length, detectedComputerHabitId, expandedHabit, selectedHabits]);

  const toggleHabit = (habitId: string) => {
    if (filterContext) {
      filterContext.toggleHabit(habitId);
    } else {
      setLocalSelectedHabits(prev =>
        prev.includes(habitId)
          ? prev.filter(id => id !== habitId)
          : [...prev, habitId]
      );
    }
  };

  const isWideRange = Boolean(!hasCustomDateRange || (
    dateRange?.from &&
    dateRange?.to &&
    differenceInDays(dateRange.to, dateRange.from) > 60
  ));

  // When the user has explicitly selected a date range, pass it through so the
  // spark cards compare that exact window vs the prior equivalent window.
  const sparkRangeFrom = hasCustomDateRange ? dateRange!.from! : undefined;
  const sparkRangeTo = hasCustomDateRange ? dateRange!.to! : undefined;

  const habitCardDataById = useMemo<Record<string, MetricCardData>>(() => {
    const next: Record<string, MetricCardData> = {};
    for (const habit of availableHabits) {
      const habitId = habit.habit_id;
      if (!habitId || isComputerHabitName(habit.habit_name)) continue;
      const card = buildHabitMetricCardData({
        habit,
        logs: mergedCardAnalyticsData[habitId] || [],
        summary: mergedCardSummaryMetrics[habitId] || {},
        isWideRange,
        rangeFrom: sparkRangeFrom,
        rangeTo: sparkRangeTo,
      });
      if (card) {
        next[habitId] = card;
      }
    }
    return next;
  }, [availableHabits, isWideRange, mergedCardAnalyticsData, mergedCardSummaryMetrics, sparkRangeFrom, sparkRangeTo]);

  const getHabitCardData = useCallback((habitId: string) => habitCardDataById[habitId] || null, [habitCardDataById]);

  const computerActivityCard = useMemo(
    () => buildComputerActivityMetricCardData({
      rows: computerActivityDaily,
      isWideRange,
      rangeFrom: sparkRangeFrom,
      rangeTo: sparkRangeTo,
    }),
    [computerActivityDaily, isWideRange, sparkRangeFrom, sparkRangeTo],
  );

  const getHeartRateExpandedData = React.useCallback(() => {
    if (!heartRateExpandedSeries.length && !heartRateExpandedSummary) return null;

    const chartData = heartRateExpandedSeries
      .map((row) => {
        const date = parseISO(row.bucket_start);
        return {
          date: format(date, 'MMM d, yyyy h:mm a'),
          shortDate: format(date, 'MMM d'),
          value: Number(row.bpm_avg || 0),
          unit: 'bpm',
          samples: Number(row.sample_count || 0),
          rawDate: date,
        };
      })
      .sort((a, b) => a.rawDate.getTime() - b.rawDate.getTime());

    const values = chartData.map((d) => Number(d.value || 0)).filter((value) => Number.isFinite(value) && value > 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = values.length > 0
      ? total / values.length
      : Number(heartRateExpandedSummary?.current_avg_bpm || 0);
    const min = values.length > 0
      ? Math.min(...values)
      : Number(heartRateExpandedSummary?.min_bpm || 0);
    const max = values.length > 0
      ? Math.max(...values)
      : Number(heartRateExpandedSummary?.max_bpm || 0);

    const latestVal = values.length > 0 ? values[values.length - 1] : average;
    const prevVal = values.length > 1 ? values[values.length - 2] : Number(heartRateExpandedSummary?.previous_avg_bpm || 0);
    const change = computeMeaningfulPercentChange(latestVal, prevVal, 'bpm');
    const absoluteChange = latestVal - prevVal;

    return {
      chartData,
      average,
      min,
      max,
      totalSamples: Number(heartRateExpandedSummary?.total_samples || 0),
      buckets: chartData.length,
      daysWithData: Number(heartRateExpandedSummary?.days_with_data || 0),
      change,
      absoluteChange: Number.isFinite(absoluteChange) ? absoluteChange : 0,
    };
  }, [heartRateExpandedSeries, heartRateExpandedSummary]);

  // Get expanded data
  const getExpandedData = (habitId: string) => {
    const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
    if (!habit) return null;
    const isMainSleepHabit = isSleepLikeHabit(habit);

    const processLogsToMap = (logsSource: any[], unitType: any, useMaxPerDay = false) => {
      if (!logsSource || !logsSource.length) return { byDate: {}, logs: {} };

      const uniqueLogs = logsSource.reduce((acc: any[], log: any) => {
        const key = log.id || `${log.habit_id || ''}:${log.date || ''}`;
        const existingIndex = acc.findIndex((l: any) => (l.id || `${l.habit_id || ''}:${l.date || ''}`) === key);
        if (existingIndex >= 0) {
          if (log.metadata && log.metadata !== '{}' && (!acc[existingIndex].metadata || acc[existingIndex].metadata === '{}')) {
            acc[existingIndex] = log;
          }
        } else {
          acc.push(log);
        }
        return acc;
      }, []);

      const logsMap = uniqueLogs.reduce((acc: any, log: any) => {
        if (!acc[log.date]) acc[log.date] = [];
        acc[log.date].push(log);
        return acc;
      }, {});

      const valuesMap: Record<string, number> = {};
      const unit = (unitType || '').toString().toLowerCase();

      Object.keys(logsMap).forEach(dateStr => {
        let total = 0;
        const dayLogs = logsMap[dateStr];
        dayLogs.forEach((log: any) => {
          if (log.daily_value !== undefined && log.daily_value !== null) {
            const dailyValue = Number(log.daily_value || 0);
            total = useMaxPerDay ? Math.max(total, dailyValue) : total + dailyValue;
            return;
          }

          const duration = Number(log.duration || 0);
          const amount = Number(log.amount || 0);
          let nextValue = 0;

          if (unit.includes('hour')) {
            if (duration > 0) nextValue = duration / 3600;
            else if (amount > 0) nextValue = amount;
          } else if (unit.includes('minute')) {
            if (duration > 0) nextValue = duration / 60;
            else if (amount > 0) nextValue = amount;
          } else {
            nextValue = amount > 0 ? amount : (duration > 0 ? 1 : 0);
          }

          total = useMaxPerDay ? Math.max(total, nextValue) : total + nextValue;
        });
        valuesMap[dateStr] = total;
      });

      return { byDate: valuesMap, logs: logsMap };
    };

    const mainData = processLogsToMap(expandedLogs, habit.unit_type || (habit as any).unit, isMainSleepHabit);

    let compData = { byDate: {}, logs: {} };
    let compHabit: any = null;
    if (compareHabitId) {
      compHabit = availableHabits.find((h: HabitData) => h.habit_id === compareHabitId);
      if (compHabit) {
        compData = processLogsToMap(
          comparisonLogs,
          compHabit.unit_type || (compHabit as any).unit,
          isSleepLikeHabit(compHabit),
        );
      }
    }

    const rangeDates = hasCustomDateRange
      ? { from: dateRange!.from!, to: dateRange!.to! }
      : getRangeDates(expandedTimeRange);
    const allDatesInRange = eachDayOfInterval({ start: startOfDay(rangeDates.from), end: startOfDay(rangeDates.to) })
      .map(d => format(d, 'yyyy-MM-dd'));
    const dataDateSet = new Set([...Object.keys(mainData.byDate), ...Object.keys(compData.byDate)]);
    const allDates = isMainSleepHabit
      ? Array.from(dataDateSet).sort()
      : Array.from(new Set([...allDatesInRange, ...dataDateSet])).sort();

    const values = Object.values(mainData.byDate) as number[];
    const totalValue = values.reduce((a, b) => a + b, 0);
    const avgValue = values.length ? totalValue / values.length : 0;
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;
    const variance = values.length ? values.reduce((a, b) => a + Math.pow(b - avgValue, 2), 0) / values.length : 0;
    const stdDev = Math.sqrt(variance);

    const chartData = allDates.map(dateStr => {
      const date = parseISO(dateStr);
      const val = (mainData.byDate as any)[dateStr] || 0;
      const cVal = (compData.byDate as any)[dateStr];

      const dayLogs = (mainData.logs as any)[dateStr] || [];
      const logsWithMeta = dayLogs.filter((l: any) => l.metadata && l.metadata !== '{}');
      const logToUse = logsWithMeta.length > 0 ? logsWithMeta[0] : dayLogs[0];

      let metadata = {};
      if (logToUse && logToUse.metadata) {
        try {
          const meta = typeof logToUse.metadata === 'string' ? JSON.parse(logToUse.metadata) : logToUse.metadata;
          const sleepOnset = meta.sleep_onset || meta.sleepOnset || null;
          const sleepEnd = meta.sleep_end || meta.sleepEnd || null;
          if (sleepOnset) metadata = { ...metadata, sleepOnset };
          if (sleepEnd) metadata = { ...metadata, sleepEnd };
        } catch (e) { }
      }

      if (logToUse) {
        const sleepOnset = logToUse.sleep_onset || logToUse.sleepOnset || null;
        const sleepEnd = logToUse.sleep_end || logToUse.sleepEnd || null;
        if (sleepOnset) metadata = { ...metadata, sleepOnset };
        if (sleepEnd) metadata = { ...metadata, sleepEnd };
      }

      if (logToUse && logToUse.completed_at) {
        try {
          const dt = new Date(logToUse.completed_at);
          const h = dt.getHours();
          const m = dt.getMinutes();
          const ampm = h >= 12 ? 'pm' : 'am';
          metadata = { ...metadata, time: `${h % 12 || 12}:${m.toString().padStart(2, '0')}${ampm}` };
        } catch { }
      }

      return {
        date: format(date, 'MMM d, yyyy'),
        shortDate: format(date, 'MMM d'),
        value: val,
        compValue: cVal !== undefined ? cVal : null,
        unit: habit.unit_type || (habit as any).unit || '',
        compUnit: compHabit ? (compHabit.unit_type || (compHabit as any).unit || '') : '',
        ...metadata
      };
    });

    const enrichedChartData = chartData.map((point: any, index: number, arr: any[]) => {
      const prevValue = index > 0 ? arr[index - 1].value : point.value;
      return {
        ...point,
        upValue: point.value >= prevValue ? point.value : null,
        downValue: point.value < prevValue ? point.value : null,
      };
    });

    return {
      habit,
      compHabit,
      chartData: enrichedChartData,
      totalValue,
      avgValue,
      minValue,
      maxValue,
      stdDev
    };
  };

  const barListDerivedData = useMemo(() => {
    const { from: rangeFrom, to: rangeTo } = getRangeDates(barListRange as RangeKey);
    const habitBarData = buildMetricsBarData({
      habits: filteredHabits,
      analyticsDataByHabit: mergedBarListAnalyticsData,
      summaryByHabit: mergedBarListSummaryMetrics,
      rangeFrom,
      rangeTo,
      computerActivityDaily,
    });
    const streakData = buildMetricStreakData(habitBarData, mergedBarListAnalyticsData);
    return {
      habitBarData,
      streakData,
    };
  }, [
    barListRange,
    computerActivityDaily,
    filteredHabits,
    mergedBarListAnalyticsData,
    mergedBarListSummaryMetrics,
  ]);

  const habitBarItems = useMemo<BarListItem[]>(() => {
    const { habitBarData } = barListDerivedData;
    if (!habitBarData.length) return [];
    const maxVal = Math.max(...habitBarData.map((habit) => Math.abs(habit.avg)), 1);
    return [...habitBarData]
      .sort((left, right) => right.avg - left.avg)
      .map((habit) => ({
        name: habit.name,
        value: formatMetricBarValue(habit.avg, habit.unit),
        change: habit.change,
        changeLabel: habit.changeLabel,
        higherIsBetter: habit.higherIsBetter ?? undefined,
        barPercent: Math.round((Math.abs(habit.avg) / maxVal) * 100),
      }));
  }, [barListDerivedData]);

  const habitSparkSeries = useMemo<HabitSparkSeries[]>(() => {
    const { habitBarData } = barListDerivedData;
    if (!habitBarData.length) return [];
    const { from: rangeFrom, to: rangeTo } = getRangeDates(barListRange as RangeKey);
    const days = eachDayOfInterval({ start: rangeFrom, end: rangeTo });
    const toKey = (d: Date) => format(d, 'yyyy-MM-dd');
    const showShortLabel = days.length > 14;

    return [...habitBarData]
      .sort((left, right) => right.avg - left.avg)
      .map((habit) => {
        const dailyMap = new Map<string, number>();
        if (habit.habitId === '__computer_activity__') {
          for (const row of computerActivityDaily) {
            if (!row.day) continue;
            dailyMap.set(
              String(row.day),
              (dailyMap.get(String(row.day)) ?? 0) + Number(row.active_hours || 0),
            );
          }
        } else {
          const logs = mergedBarListAnalyticsData[habit.habitId] || [];
          for (const log of logs) {
            if (!log.date) continue;
            const v = Number(log.daily_value ?? log.value ?? log.total_amount ?? 0);
            dailyMap.set(log.date, (dailyMap.get(log.date) ?? 0) + v);
          }
        }

        const data = days.map((day) => {
          const key = toKey(day);
          return {
            date: key,
            label: showShortLabel ? format(day, 'M/d') : format(day, 'MMM d'),
            value: dailyMap.get(key) ?? 0,
          };
        });

        const total = data.reduce((sum, point) => sum + point.value, 0);

        return {
          habitId: habit.habitId,
          name: habit.name,
          unit: habit.unit,
          avg: habit.avg,
          total,
          change: habit.change,
          higherIsBetter: habit.higherIsBetter,
          daysWithData: habit.daysWithData,
          data,
        };
      });
  }, [barListDerivedData, barListRange, computerActivityDaily, mergedBarListAnalyticsData]);

  const habitSparkRangeLabel = useMemo(() => {
    switch (barListRange as RangeKey) {
      case '1D':
        return 'Today';
      case '5D':
        return 'Last 5 days';
      case '1W':
        return 'Last 7 days';
      case '1M':
        return 'Last 30 days';
      case '3M':
        return 'Last 90 days';
      case '6M':
        return 'Last 6 months';
      case 'YTD':
        return 'Year to date';
      case '1Y':
        return 'Last 12 months';
      case '5Y':
        return 'Last 5 years';
      case 'MAX':
      case 'ALL':
        return 'All time';
      default:
        return '';
    }
  }, [barListRange]);

  const streakBarItems = useMemo<BarListItem[]>(() => {
    const { streakData } = barListDerivedData;
    if (!streakData.length) return [];
    const maxStreak = Math.max(...streakData.map((streak) => streak.streak), 1);
    return streakData.map((streak) => ({
      name: streak.name,
      value: `${streak.streak}d`,
      barPercent: Math.round((streak.streak / maxStreak) * 100),
    }));
  }, [barListDerivedData]);
  const metricCardsContent = useMemo(() => {
    const validSelectedHabits = selectedHabits.filter((id: string): id is string => !!id);
    const selectedFilteredHabitIds = validSelectedHabits.filter((id: string) => filteredHabitIds.includes(id));
    const computerCardData = computerActivityCard;
    const isComputerSelected = detectedComputerHabitId ? validSelectedHabits.includes(detectedComputerHabitId) : true;
    const showComputerCard = Boolean(computerCardData) && isComputerSelected;

    const habitsToShow = validSelectedHabits.length > 0
      ? selectedFilteredHabitIds
      : filteredHabitIds;

    const unorderedIds = [...habitsToShow];
    if (showComputerCard) {
      unorderedIds.push(COMPUTER_ACTIVITY_CARD_ID);
    }

    const metricCardIds = appliedCardOrder.length > 0
      ? [
          ...appliedCardOrder.filter((id: string) => unorderedIds.includes(id)),
          ...unorderedIds.filter((id: string) => !appliedCardOrder.includes(id)),
        ]
      : unorderedIds;

    visibleCardIdsRef.current = metricCardIds;

    const visibleIds = activeCategoryTab
      ? metricCardIds.filter((id) => {
          if (id === COMPUTER_ACTIVITY_CARD_ID) {
            return activeCategoryTab === 'digital';
          }
          const habit = filteredHabits.find((candidate: HabitData) => candidate.habit_id === id);
          return habit ? getMetricCategoryForHabit(habit.habit_name, habit.category) === activeCategoryTab : false;
        })
      : metricCardIds;

    const totalPages = Math.ceil(visibleIds.length / CARDS_PER_PAGE);
    const safeCardPage = Math.min(clampedCardPage, Math.max(totalPages - 1, 0));
    const pageStart = safeCardPage * CARDS_PER_PAGE;
    const pageIds = visibleIds.slice(pageStart, pageStart + CARDS_PER_PAGE);

    return (
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={pageIds} strategy={rectSortingStrategy}>
          <div
            className={`mx-auto relative w-full max-w-[920px] transition-opacity duration-300 ${
              expandedHabit ? 'opacity-40 pointer-events-auto' : 'opacity-100'
            }`}
          >
            <div className="grid w-full grid-cols-2 gap-[6px] sm:grid-cols-3 lg:grid-cols-4">
              {pageIds.map((habitId: string) => {
                const cardData = habitId === COMPUTER_ACTIVITY_CARD_ID
                  ? computerCardData
                  : getHabitCardData(habitId);
                const habit = habitId === COMPUTER_ACTIVITY_CARD_ID
                  ? null
                  : filteredHabits.find((candidate: HabitData) => candidate.habit_id === habitId);

                let tickerName: string;
                let tickerUnit: string;
                let tickerCurrentValue: number;
                let tickerPercentChange: number | undefined;
                let tickerAbsoluteChange: number;
                let tickerChartData: { value: number }[];
                let tickerHigherIsBetter: boolean | null | undefined;

                if (habitId === COMPUTER_ACTIVITY_CARD_ID && computerCardData) {
                  tickerName = COMPUTER_HABIT_DISPLAY_NAME;
                  tickerUnit = computerCardData.unit || 'hours';
                  tickerCurrentValue = computerCardData.currentValue || 0;
                  tickerPercentChange = computerCardData.change;
                  tickerAbsoluteChange = computerCardData.absoluteChange || 0;
                  tickerChartData = (computerCardData.chartData || []).map((point: ChartDataPoint) => ({ value: point.value || 0 }));
                  tickerHigherIsBetter = computerCardData.higherIsBetter;
                } else if (cardData && habit) {
                  tickerName = cardData.habitName || habit.habit_name || 'Unknown';
                  tickerUnit = cardData.unit || habit.unit_type || 'count';
                  tickerCurrentValue = cardData.currentValue || 0;
                  tickerPercentChange = cardData.change;
                  tickerAbsoluteChange = cardData.absoluteChange || 0;
                  tickerChartData = (cardData.chartData || []).map((point: ChartDataPoint) => ({ value: point.value || 0 }));
                  tickerHigherIsBetter = cardData.higherIsBetter;
                } else if (habit) {
                  tickerName = habit.habit_name || 'Unknown';
                  tickerUnit = habit.unit_type || 'count';
                  tickerCurrentValue = 0;
                  tickerPercentChange = undefined;
                  tickerAbsoluteChange = 0;
                  tickerChartData = [];
                  tickerHigherIsBetter = inferHigherIsBetter(habit.habit_name, habit.unit_type);
                } else {
                  return null;
                }

                return (
                  <SortableMetricCard key={habitId} id={habitId}>
                    <HabitTickerCard
                      habitName={tickerName}
                      unit={tickerUnit}
                      currentValue={tickerCurrentValue}
                      percentChange={tickerPercentChange}
                      absoluteChange={tickerAbsoluteChange}
                      chartData={tickerChartData}
                      higherIsBetter={tickerHigherIsBetter}
                      onClick={() => {
                        if (habitId === COMPUTER_ACTIVITY_CARD_ID) return;
                        setExpandedHabit(expandedHabit === habitId ? null : habitId);
                      }}
                      onRemove={() => {
                        const removedHabitId = habitId === COMPUTER_ACTIVITY_CARD_ID
                          ? detectedComputerHabitId
                          : habitId;
                        if (!removedHabitId) return;
                        if (filterContext) {
                          filterContext.setSelectedHabits((prev: string[]) => prev.filter((id) => id !== removedHabitId));
                        } else {
                          setLocalSelectedHabits((prev) => prev.filter((id) => id !== removedHabitId));
                        }
                        if (expandedHabit === habitId) {
                          setExpandedHabit(null);
                        }
                      }}
                    />
                  </SortableMetricCard>
                );
              })}
            </div>
          </div>
        </SortableContext>
      </DndContext>
    );
  }, [
    activeCategoryTab,
    appliedCardOrder,
    clampedCardPage,
    computerActivityCard,
    detectedComputerHabitId,
    dndSensors,
    expandedHabit,
    filterContext,
    filteredHabitIds,
    filteredHabits,
    getHabitCardData,
    handleDragEnd,
    selectedHabits,
  ]);
  const hasRenderableMetricCards = filteredHabits.length > 0 || Boolean(computerActivityCard);
  const hasValidHabitData = (availableHabits.length > 0 && availableHabits[0]?.habit_id) || Boolean(computerActivityCard);

  if (!hasValidHabitData && (loading || queryLoading)) {
    return (
      <div className="mx-auto w-full max-w-[920px] space-y-5">
        <div className="flex items-center gap-2 border-b border-[rgba(39,37,30,0.06)] pb-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-7 w-20 rounded-md animate-pulse bg-gray-100" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-[6px] sm:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-[100px] rounded-lg border border-gray-100 animate-pulse bg-gray-50/80" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Top Bar: Controls Layout - only show if not hidden */}
      {!hideControls && (
        <div className="mx-auto w-full max-w-[920px] flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <DateRangePicker
              className="w-auto"
              onDateRangeChange={setDateRange}
              initialDateRange={dateRange}
            />
          </div>
        </div>
      )}

      {/* Controls are now in parent (unified-analytics-client) when hideControls is true */}
      {analyticsError && (
        <div className="mx-auto mb-4 w-full max-w-[920px] rounded-lg border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-[13px] leading-relaxed text-amber-800">
          <span className="font-medium">Unable to load metrics</span>
          <span className="mx-1.5 text-amber-300">·</span>
          {analyticsError}
        </div>
      )}

      {/* ── Category Tabs ── */}
      <div className="mx-auto w-full max-w-[920px] mb-5">
        <div className="flex items-center gap-1 border-b border-[rgba(39,37,30,0.06)] pb-px">
            {METRIC_CATEGORY_TABS.map((tab) => {
              const isActive = (tab.id === 'all' && activeCategoryTab === null) || activeCategoryTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveCategoryTab(tab.id === 'all' ? null : (isActive ? null : tab.id)); setCardPage(0); }}
                  className={`relative px-3.5 py-2 text-[13px] font-medium tracking-[-0.1px] transition-all duration-200 ${
                    isActive
                      ? 'text-[#27251E]'
                      : 'text-[rgba(39,37,30,0.4)] hover:text-[rgba(39,37,30,0.7)]'
                  }`}
                >
                  {tab.label}
                  <span className={`absolute bottom-0 left-3 right-3 h-[1.5px] rounded-full transition-all duration-200 ${
                    isActive ? 'bg-[#27251E] opacity-100' : 'bg-transparent opacity-0'
                  }`} />
                </button>
              );
            })}
        </div>
      </div>

      {/* Habit Metrics Grid */}
      {(loading || queryLoading) ? (
        <div className="mx-auto w-full max-w-[920px] grid grid-cols-2 gap-[6px] sm:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-[100px] rounded-lg border border-gray-100 animate-pulse bg-gray-50/80">
              <div className="px-3 pt-3">
                <div className="h-3 w-20 rounded bg-gray-100/80" />
                <div className="mt-2 h-3 w-12 rounded bg-gray-100/60" />
              </div>
            </div>
          ))}
        </div>
      ) : !hasRenderableMetricCards ? (
        <div className="mx-auto w-full max-w-[920px] px-6 py-16 text-center">
          <div className="max-w-sm mx-auto">
            <div className="text-xl mb-2 text-center" style={{ fontWeight: 500 }}>No metrics yet</div>
            <div className="text-sm font-normal leading-tight text-center" style={{ fontWeight: 400, color: '#9C9C9D' }}>
              Start tracking anything from the Overview tab<br />to see your analytics and trends here.
            </div>
          </div>
        </div>
      ) : selectedHabits.length > 0 || availableHabits.length > 0 || Boolean(computerActivityCard) ? (
        <>
          <MetricsInitialSection
            cardGrid={metricCardsContent}
            showInsights={!expandedHabit}
            showBarLists={!expandedHabit && filteredHabits.length > 0}
            habitBarItems={habitBarItems}
            streakBarItems={streakBarItems}
            barListRange={barListRange}
            onBarListRangeChange={setBarListRange}
            computerTimeRangePreset={barListRangeToTimePreset(barListRange)}
            habitSparkSeries={habitSparkSeries}
            habitSparkRangeLabel={habitSparkRangeLabel}
          />

          {/* Expanded View */}
          {expandedHabit && (
            <div className="mx-auto mt-4 w-full max-w-[920px]">
              {expandedHabit === COMPUTER_ACTIVITY_CARD_ID ? (
                <ComputerActivitySection onClose={() => setExpandedHabit(null)} />
              ) : expandedHabitUsesGranularHeartRate ? (
                (() => {
                  if (loadingExpandedLogs) {
                    return (
                      <div className="flex h-[400px] items-center justify-center rounded-xl border border-gray-100 bg-gray-50/30">
                        <div className="text-center">
                          <BrailleSpinner className="mx-auto mb-2 text-2xl text-gray-400" />
                          <p className="text-[13px] text-gray-400">Loading metrics...</p>
                        </div>
                      </div>
                    );
                  }

                  const expandedData = getHeartRateExpandedData();
                  if (!expandedData) return null;
                  const heartRateTitle = expandedHabitData?.habit_name || 'Heart Rate';

                  const ranges: RangeOption[] = [
                    { value: '1D', label: '1D' },
                    { value: '5D', label: '5D' },
                    { value: '1W', label: '1W' },
                    { value: '1M', label: '1M' },
                    { value: '6M', label: '6M' },
                    { value: 'YTD', label: 'YTD' },
                    { value: '1Y', label: '1Y' },
                    { value: '5Y', label: '5Y' },
                    { value: 'MAX', label: 'MAX' },
                  ];
                  const points = habitToFinanceSeries(expandedData.chartData);
                  const firstPoint = points[0];
                  const lastPoint = points[points.length - 1];
                  const dateRangeText = hasCustomDateRange
                    ? `${format(dateRange!.from!, 'MMM d, yyyy')} – ${format(dateRange!.to!, 'MMM d, yyyy')}`
                    : (firstPoint && lastPoint
                      ? `${format(new Date(firstPoint.t), 'MMM d, yyyy')} – ${format(new Date(lastPoint.t), 'MMM d, yyyy')}`
                      : 'No data');
                  const deltaDirection = expandedData.change === undefined
                    ? 'neutral'
                    : expandedData.change >= 0
                      ? 'up'
                      : 'down';
                  const deltaValueText = `${expandedData.absoluteChange >= 0 ? '+' : ''}${expandedData.absoluteChange.toFixed(1)}`;
                  const deltaPercentText = expandedData.change === undefined
                    ? undefined
                    : `${expandedData.change >= 0 ? '+' : ''}${expandedData.change.toFixed(2)}%`;
                  const primaryValue = lastPoint
                    ? Number(lastPoint.close).toFixed(0)
                    : '--';

                  const stats: Array<{ label: string; value: string }> = [
                    { label: 'Average', value: `${expandedData.average.toFixed(1)} bpm` },
                    { label: 'Min', value: `${expandedData.min.toFixed(0)} bpm` },
                    { label: 'Max', value: `${expandedData.max.toFixed(0)} bpm` },
                    { label: 'Samples', value: expandedData.totalSamples.toLocaleString() },
                    { label: 'Days', value: String(expandedData.daysWithData || 0) },
                  ];

                  return (
                    <div ref={exportCardRef}>
                      <ExpandedMetricCard
                        title={heartRateTitle}
                        primaryValue={primaryValue}
                        unit="bpm"
                        deltaValue={deltaValueText}
                        deltaPercent={deltaPercentText}
                        deltaDirection={deltaDirection}
                        dateRangeText={dateRangeText}
                        rangePreset={expandedTimeRange}
                        onRangePresetChange={(value) => setExpandedTimeRange(value as RangeKey)}
                        rangeOptions={ranges}
                        rangeLockedText={hasCustomDateRange ? 'Custom range' : undefined}
                        actions={(
                          <button
                            type="button"
                            onClick={() => captureExpandedChart(heartRateTitle)}
                            disabled={isCapturing}
                            aria-label="Export chart image"
                            title="Export chart image"
                            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[rgba(39,37,30,0.07)] bg-white text-[rgba(39,37,30,0.45)] transition-all duration-150 hover:bg-gray-50 hover:text-[#27251E] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset"
                          >
                            <Camera className="h-3.5 w-3.5" />
                          </button>
                        )}
                        onClose={() => setExpandedHabit(null)}
                      >
                        <div ref={chartRef}>
                          <PerplexityExpandedHabitChart
                            points={points}
                            range={expandedTimeRange}
                            unit="bpm"
                            chartType="bar"
                            showGrid
                            higherIsBetter={false}
                          />
                        </div>
                      </ExpandedMetricCard>
                    </div>
                  );
                })()
              ) : loadingExpandedLogs ? (
                <div className="flex h-[400px] items-center justify-center">
                  <div className="text-center">
                    <BrailleSpinner className="mx-auto mb-2 text-2xl text-gray-600" />
                    <p className="text-sm text-gray-500">Loading metrics...</p>
                  </div>
                </div>
              ) : (() => {
                const expandedData = getExpandedData(expandedHabit);
                if (!expandedData) return null;

                const { habit, compHabit, chartData, totalValue, avgValue, minValue, maxValue, stdDev } = expandedData;
                const expandedCardData = getHabitCardData(expandedHabit);
                const ranges: RangeOption[] = [
                  { value: '1D', label: '1D' },
                  { value: '5D', label: '5D' },
                  { value: '1W', label: '1W' },
                  { value: '1M', label: '1M' },
                  { value: '6M', label: '6M' },
                  { value: 'YTD', label: 'YTD' },
                  { value: '1Y', label: '1Y' },
                  { value: '5Y', label: '5Y' },
                  { value: 'MAX', label: 'MAX' },
                ];
                const points = habitToFinanceSeries(chartData);
                const firstPoint = points[0];
                const lastPoint = points[points.length - 1];
                const dateRangeText = hasCustomDateRange
                  ? `${format(dateRange!.from!, 'MMM d, yyyy')} – ${format(dateRange!.to!, 'MMM d, yyyy')}`
                  : (firstPoint && lastPoint
                    ? `${format(new Date(firstPoint.t), 'MMM d, yyyy')} – ${format(new Date(lastPoint.t), 'MMM d, yyyy')}`
                    : 'No data');
                const deltaDirection = expandedCardData?.change === undefined
                  ? 'neutral'
                  : expandedCardData.change >= 0
                    ? 'up'
                    : 'down';
                const deltaValueText = expandedCardData?.absoluteChange === undefined
                  ? undefined
                  : `${expandedCardData.absoluteChange >= 0 ? '+' : ''}${expandedCardData.absoluteChange.toFixed(2)}`;
                const deltaPercentText = expandedCardData?.change === undefined
                  ? undefined
                  : `${expandedCardData.change >= 0 ? '+' : ''}${expandedCardData.change.toFixed(2)}%`;
                const primaryValue = lastPoint
                  ? Number(lastPoint.close).toFixed(Number(lastPoint.close) < 10 ? 2 : 0)
                  : '--';

                const compareOptions = filteredHabits
                  .filter((h: any) => h.habit_id !== expandedHabit)
                  .map((h: any) => ({ label: h.habit_name, value: h.habit_id }));

                const stats: Array<{ label: string; value: string }> = [
                  { label: 'Total', value: totalValue.toFixed(1) },
                  { label: 'Average', value: avgValue.toFixed(1) },
                  { label: 'Min', value: minValue.toFixed(1) },
                  { label: 'Max', value: maxValue.toFixed(1) },
                  { label: 'Std Dev', value: stdDev.toFixed(1) },
                ];

                if (compHabit) {
                  stats.push({
                    label: 'Correlation',
                    value: loadingCorrelation ? '...' : (correlationData?.correlation?.coefficient?.toFixed(2) ?? 'N/A'),
                  });
                }

                return (
                  <div ref={exportCardRef}>
                    <ExpandedMetricCard
                      title={habit.habit_name}
                      primaryValue={primaryValue}
                      unit={habit.unit_type || (habit as any).unit || ''}
                      deltaValue={deltaValueText}
                      deltaPercent={deltaPercentText}
                      deltaDirection={deltaDirection}
                      higherIsBetter={expandedCardData?.higherIsBetter}
                      dateRangeText={dateRangeText}
                      rangePreset={expandedTimeRange}
                      onRangePresetChange={(value) => setExpandedTimeRange(value as RangeKey)}
                      rangeOptions={ranges}
                      rangeLockedText={hasCustomDateRange ? 'Custom range' : undefined}
                      compareControl={(
                        <CompareSelect
                          value={compareHabitId}
                          options={compareOptions}
                          onChange={(val) => setCompareHabitId(val)}
                          placeholder="None"
                        />
                      )}
                      actions={(
                        <button
                          type="button"
                          onClick={() => captureExpandedChart(habit.habit_name)}
                          disabled={isCapturing}
                          aria-label="Export chart image"
                          title="Export chart image"
                          className="inline-flex h-[30px] w-[30px] items-center justify-center border border-[rgba(39,37,30,0.07)] bg-white text-[rgba(39,37,30,0.65)] transition-colors hover:bg-[rgba(39,37,30,0.02)] hover:text-[#27251E] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset"
                        >
                          <Camera className="h-3.5 w-3.5" />
                        </button>
                      )}
                      onClose={() => setExpandedHabit(null)}
                      stats={stats}
                      showStats
                    >
                      <div ref={chartRef}>
                        <PerplexityExpandedHabitChart
                          points={points}
                          range={expandedTimeRange}
                          unit={habit.unit_type || (habit as any).unit || ''}
                          compareLabel={compHabit?.habit_name}
                          compareUnit={compHabit?.unit_type || (compHabit as any)?.unit || ''}
                          chartType="bar"
                          showGrid
                          higherIsBetter={expandedCardData?.higherIsBetter}
                        />
                      </div>
                    </ExpandedMetricCard>
                  </div>
                );
              })()}
            </div>
          )}
        </>
      ) : null}



      {showShareModal ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-[2px] transition-opacity duration-200"
            onClick={closeShareModal}
          />
          <div className="relative z-10 w-[min(92vw,680px)] max-h-[86vh] overflow-hidden rounded-xl border border-[rgba(39,37,30,0.08)] bg-white p-4 sm:p-5 shadow-[0_24px_48px_rgba(0,0,0,0.12),0_8px_16px_rgba(0,0,0,0.06)]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[20px] font-semibold leading-[1.1] tracking-[-0.4px] text-[#27251E]">
                Share screenshot
              </h2>
              <button
                type="button"
                onClick={closeShareModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(39,37,30,0.08)] bg-white text-[rgba(39,37,30,0.4)] transition-all duration-150 hover:bg-gray-50 hover:text-[#27251E]"
                aria-label="Close share screenshot modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2.5 bg-white">
              {isCapturing ? (
                <div className="flex min-h-[220px] items-center justify-center">
                  <div className="text-center">
                    <BrailleSpinner className="mx-auto text-[30px] text-[rgba(39,37,30,0.6)]" />
                    <p className="mt-2 text-sm text-[rgba(39,37,30,0.62)]">Preparing screenshot...</p>
                  </div>
                </div>
              ) : shareImageUrl ? (
                <div className="max-h-[52vh] overflow-auto">
                  <img
                    src={shareImageUrl}
                    alt={`${shareLabel} chart screenshot preview`}
                    className="block h-auto w-full rounded-sm object-contain"
                  />
                </div>
              ) : (
                <div className="flex min-h-[220px] items-center justify-center text-sm text-[rgba(39,37,30,0.62)]">
                  Couldn&apos;t prepare screenshot preview.
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={copyShareImage}
                disabled={!shareImageUrl || isCapturing}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[rgba(39,37,30,0.08)] bg-white px-3 text-[13px] font-medium tracking-[-0.2px] text-[#2E2C24] transition-all duration-150 hover:bg-gray-50 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5" />
                {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy image'}
              </button>

              <button
                type="button"
                onClick={downloadShareImage}
                disabled={!shareImageUrl || isCapturing}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#27251E] px-3 text-[13px] font-medium tracking-[-0.2px] text-white transition-all duration-150 hover:bg-[#3a3830] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {downloadState === 'done' ? 'Downloaded!' : downloadState === 'failed' ? 'Download failed' : 'Download image'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </>
  );
}
