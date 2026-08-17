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
import { useAnalyticsFiltersOptional } from '../analytics-filter-context';
import { useHabits } from '@/contexts/HabitsContext';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import { habitToFinanceSeries } from '@/lib/charts/habitToFinanceSeries';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { ExpandedMetricCard } from '@/components/metrics/ExpandedMetricCard';
import { MetricsInitialSection } from '@/components/analytics/metrics-initial-section';
import type { RangeOption } from '@/components/metrics/RangeSegmentedControl';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
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
} from '@ritual/ui/select';
import { useComputerSnapshotQuery } from '@/hooks/use-computer-snapshot-query';

import {
  CARD_ORDER_KEY,
  CARDS_PER_PAGE,
  COMPUTER_ACTIVITY_CARD_ID,
  CompareSelect,
  ComputerActivitySection,
  DateRangePicker,
  DEFAULT_METRICS_SPARKLINE_DAYS,
  DEFAULT_METRICS_SUMMARY_DAYS,
  HabitTickerCard,
  METRIC_CATEGORY_TABS,
  PerplexityExpandedHabitChart,
  SortableMetricCard,
  buildLocalMetricDailyRows,
  buildLocalMetricSummary,
  buildWearableMetricDailyRowsForHabit,
  buildWearableMetricSeriesRows,
  dateRangeToBarListRange,
  getHeartRateBucket,
  getRangeDates,
  hasUsableMetricSummary,
  isGranularHeartRateHabit,
  isSleepLikeHabit,
} from '../metrics-view.shared';
import type {
  ChartDataPoint,
  HabitData,
  HeartRateSeriesRow,
  HeartRateSummaryRow,
  LocalMetricSummaryRow,
  MetricsRowsByHabit,
  MetricsSummaryByHabit,
  MetricsSyncContext,
  MetricsViewProps,
  BarListItem,
  BarListRange,
} from '../metrics-view.shared';
import { useMetricsDataQueries } from './useMetricsDataQueries';
import { useMetricsCardSections } from '../metrics-view-card-sections';
import { MetricsExpandedSection } from '../metrics-expanded-section';
import { MetricsShareModal } from '../metrics-share-modal';
import { useMetricsShare } from './useMetricsShare';
import { useMetricsExpandedQueries } from './useMetricsExpandedQueries';
import { useMetricsViewDerived } from './useMetricsViewDerived';

export function useMetricsView({
  externalDateRange,
  onDateRangeChange,
  hideControls = false,
  initialAnalyticsData,
  initialSummaryMetrics,
  initialBarListAnalyticsData,
  initialBarListSummaryMetrics,
}: MetricsViewProps) {
  const { isDesktop } = useDesktopCapabilities();
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
  const [analyticsData, setAnalyticsData] = useState<MetricsRowsByHabit>(initialAnalyticsData ?? {});
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<MetricDailyRow[]>([]);
  const [expandedSyncContext, setExpandedSyncContext] = useState<MetricsSyncContext | null>(null);
  const [loadingExpandedLogs, setLoadingExpandedLogs] = useState(false);

  const [summaryMetrics, setSummaryMetrics] = useState<MetricsSummaryByHabit>(initialSummaryMetrics ?? {});
  const [barListAnalyticsData, setBarListAnalyticsData] = useState<MetricsRowsByHabit>(initialBarListAnalyticsData ?? {});
  const [barListSummaryMetrics, setBarListSummaryMetrics] = useState<MetricsSummaryByHabit>(initialBarListSummaryMetrics ?? {});

  const [expandedTimeRange, setExpandedTimeRange] = useState<RangeKey>('1M');
  const [barListRange, setBarListRange] = useState<BarListRange>(() => dateRangeToBarListRange(dateRange));
  const [pinnedHabitIds, setPinnedHabitIds] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('ritual:metricsPinnedHabits');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('ritual:metricsPinnedHabits', JSON.stringify(pinnedHabitIds));
    } catch {
      // ignore storage failures — pin state is non-critical
    }
  }, [pinnedHabitIds]);

  const togglePinnedHabit = React.useCallback((habitId: string) => {
    setPinnedHabitIds((prev) => {
      if (prev.includes(habitId)) return prev.filter((id) => id !== habitId);
      // Soft cap at 4 — oldest pin rolls off so the focused set stays tight.
      const next = [...prev, habitId];
      return next.length > 4 ? next.slice(next.length - 4) : next;
    });
  }, []);
  const unpinHabit = React.useCallback((habitId: string) => {
    setPinnedHabitIds((prev) => prev.filter((id) => id !== habitId));
  }, []);
  const [compareHabitId, setCompareHabitId] = useState<string | null>(null);
  const [comparisonLogs, setComparisonLogs] = useState<MetricDailyRow[]>([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [activeCategoryTab, setActiveCategoryTab] = useState<string | null>(null);
  const [cardPage, setCardPage] = useState(0);
  const [totalCardPages, setTotalCardPages] = useState(1);
  const clampedCardPage = Math.min(cardPage, Math.max(totalCardPages - 1, 0));

  const [correlationData, setCorrelationData] = useState<unknown>(null);
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

  const {
    dateRangeSyncKey,
    computerActivityDaily,
    availableHabits,
    detectedComputerHabitId,
    filteredHabits,
    habitById,
    filteredHabitIds,
    visibleMetricHabitIds,
    hasCustomDateRange,
    expandedHabitData,
    expandedHabitUsesGranularHeartRate,
    habitLogsByHabitId,
    fetchWearableDailyTotalsForHabits,
  } = useMetricsViewDerived({
    user,
    isUserLoaded,
    dateRange,
    transformedHabits,
    habitLogs,
    selectedHabits,
    appliedCardOrder,
    activeCategoryTab,
    cardPage,
    expandedHabit,
    initialAnalyticsData,
    initialSummaryMetrics,
    lastHydratedCanonicalRangeKeyRef,
    setBarListRange,
    setAnalyticsData,
    setSummaryMetrics,
    setRealtimeRefreshTick,
  });

  const chartRef = useRef<HTMLDivElement>(null);
  const exportCardRef = useRef<HTMLDivElement>(null);
  const backfillAttempted = useRef(false);
  const [metricsMountTime] = useState(() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const metricsMountTimeRef = useRef(metricsMountTime);
  const metricsFirstUsablePaintLoggedRef = useRef(false);
  const lastCanonicalFetchKeyRef = useRef<string | null>(null);
  const lastBarListFetchKeyRef = useRef<string | null>(null);
  const {
    showShareModal,
    shareLabel,
    shareImageUrl,
    shareImageBlob,
    copyState,
    downloadState,
    isCapturing,
    captureExpandedChart,
    closeShareModal,
    downloadShareImage,
    copyShareImage,
    getShareFileName,
  } = useMetricsShare({ chartRef, exportCardRef });

  const {
    mergedBarListAnalyticsData,
    mergedBarListSummaryMetrics,
    mergedCardAnalyticsData,
    mergedCardSummaryMetrics,
  } = useMetricsDataQueries({
    analyticsData,
    availableHabits,
    backfillAttempted,
    barListAnalyticsData,
    barListRange,
    barListSummaryMetrics,
    computerActivityDaily,
    dateRange,
    dateRangeSyncKey,
    fetchWearableDailyTotalsForHabits,
    filteredHabitIds,
    filteredHabits,
    getToken,
    habitById,
    habitLogsByHabitId,
    hasInitialBarListAnalytics,
    hasInitialBarListSummary,
    hasInitialMetricsAnalytics,
    hasInitialMetricsSummary,
    initialAnalyticsData,
    initialSummaryMetrics,
    isUserLoaded,
    lastBarListFetchKeyRef,
    lastCanonicalFetchKeyRef,
    lastHydratedCanonicalRangeKeyRef,
    loading,
    metricsFirstUsablePaintLoggedRef,
    metricsMountTimeRef,
    queryLoading,
    realtimeRefreshTick,
    selectedHabits,
    setAnalyticsData,
    setAnalyticsError,
    setBarListAnalyticsData,
    setBarListSummaryMetrics,
    setLoading,
    setSelectedHabits,
    setSummaryMetrics,
    skippedInitialBarListFetchRef,
    summaryMetrics,
    user,
    visibleMetricHabitIds,
  });

  useMetricsExpandedQueries({
    availableHabits,
    compareHabitId,
    computerActivityDaily,
    dateRange,
    detectedComputerHabitId,
    expandedHabit,
    expandedHabitData,
    expandedHabitUsesGranularHeartRate,
    expandedTimeRange,
    getToken,
    hasCustomDateRange,
    selectedHabits,
    setCompareHabitId,
    setComparisonLogs,
    setCorrelationData,
    setExpandedHabit,
    setExpandedLogs,
    setExpandedSyncContext,
    setExpandedTimeRange,
    setHeartRateExpandedSeries,
    setHeartRateExpandedSummary,
    setLoadingComparison,
    setLoadingCorrelation,
    setLoadingExpandedLogs,
  });

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
  const miniChartDefaultRange = useMemo<RangeKey>(() => {
    if (!dateRange?.from || !dateRange?.to) return 'MAX';
    const days = Math.max(1, differenceInDays(dateRange.to, dateRange.from) + 1);
    if (days <= 1) return '1D';
    if (days <= 7) return '1W';
    if (days <= 31) return '1M';
    if (days <= 93) return '3M';
    if (days <= 183) return '6M';
    if (days <= 370) return '1Y';
    return 'MAX';
  }, [dateRange?.from, dateRange?.to]);

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

  const {
    habitBarItems,
    habitSparkSources,
    metricCardsContent,
    streakBarItems,
  } = useMetricsCardSections({
    activeCategoryTab,
    appliedCardOrder,
    barListRange,
    clampedCardPage,
    computerActivityCard,
    computerActivityDaily,
    detectedComputerHabitId,
    dndSensors,
    expandedHabit,
    filterContext,
    filteredHabitIds,
    filteredHabits,
    getHabitCardData,
    handleDragEnd,
    habitLogsByHabitId,
    mergedCardAnalyticsData,
    mergedBarListAnalyticsData,
    mergedBarListSummaryMetrics,
    pinnedHabitIds,
    selectedHabits,
    setExpandedHabit,
    setLocalSelectedHabits,
    togglePinnedHabit,
    visibleCardIdsRef,
  });
  const hasRenderableMetricCards = filteredHabits.length > 0 || Boolean(computerActivityCard);
  const hasValidHabitData = (availableHabits.length > 0 && availableHabits[0]?.habit_id) || Boolean(computerActivityCard);

  const shouldShowInitialLoading = !hasValidHabitData && (loading || queryLoading);

  return {
    hideControls,
    shouldShowInitialLoading,
    dateRange,
    setDateRange,
    loading,
    queryLoading,
    analyticsError,
    activeCategoryTab,
    setActiveCategoryTab,
    setCardPage,
    expandedHabit,
    metricCardsContent,
    habitBarItems,
    streakBarItems,
    habitSparkSources,
    barListRange,
    setBarListRange,
    miniChartDefaultRange,
    unpinHabit,
    pinnedHabitIds,
    captureExpandedChart,
    chartRef,
    compareHabitId,
    comparisonLogs,
    correlationData,
    expandedHabitData,
    expandedHabitUsesGranularHeartRate,
    expandedLogs,
    expandedTimeRange,
    exportCardRef,
    filteredHabits,
    getHabitCardData,
    hasCustomDateRange,
    heartRateExpandedSeries,
    heartRateExpandedSummary,
    isCapturing,
    loadingCorrelation,
    loadingExpandedLogs,
    setCompareHabitId,
    setExpandedHabit,
    setExpandedTimeRange,
    showShareModal,
    closeShareModal,
    copyShareImage,
    copyState,
    downloadShareImage,
    downloadState,
    shareImageUrl,
    shareLabel,
    hasRenderableMetricCards,
    hasValidHabitData,
    availableHabits,
    computerActivityCard,
    selectedHabits,
  };
}
