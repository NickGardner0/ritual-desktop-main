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
} from './metrics-view.shared';
import type {
  ChartDataPoint,
  HabitData,
  HeartRateSeriesRow,
  HeartRateSummaryRow,
  LocalMetricSummaryRow,
  MetricsViewProps,
  BarListItem,
  BarListRange,
} from './metrics-view.shared';
import { useMetricsDataEffects } from './use-metrics-data-effects';
import { useMetricsCardSections } from './metrics-view-card-sections';
import { MetricsExpandedSection } from './metrics-expanded-section';
import { MetricsShareModal } from './metrics-share-modal';
import { useMetricsExpandedEffects } from './use-metrics-expanded-effects';

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
  const habitById = React.useMemo(() => {
    const next = new Map<string, HabitData>();
    for (const habit of availableHabits) {
      if (habit.habit_id) {
        next.set(habit.habit_id, habit);
      }
    }
    return next;
  }, [availableHabits]);
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

  const fetchWearableDailyTotalsForHabits = useCallback(
    async (habitIds: string[], startDate: string, endDate: string) => {
      const groupedMetrics = new Map<string, Set<string>>();

      for (const habitId of habitIds) {
        const habit = habitById.get(habitId);
        if (!habit || !isWearableBackedHabit(habit)) continue;
        const metricType = getWearableMetricType(habit);
        if (!metricType) continue;
        const provider = getWearableProviderForHabit(habit) || '__preferred__';
        const existing = groupedMetrics.get(provider) || new Set<string>();
        existing.add(metricType);
        groupedMetrics.set(provider, existing);
      }

      const responses = await Promise.all(
        Array.from(groupedMetrics.entries()).map(async ([provider, metricTypes]) => {
          const params = new URLSearchParams({
            start_date: startDate,
            end_date: endDate,
            metric_types: Array.from(metricTypes).join(','),
          });
          if (provider !== '__preferred__') {
            params.set('providers', provider);
          }

          const response = await fetch(`/api/wearables/daily-totals?${params.toString()}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch wearable daily totals (${provider})`);
          }

          const payload = await response.json();
          return {
            provider,
            days: Array.isArray(payload?.days) ? (payload.days as WearableDailyTotal[]) : [],
          };
        }),
      );

      return responses.reduce<Record<string, WearableDailyTotal[]>>((acc, entry) => {
        acc[entry.provider] = entry.days;
        return acc;
      }, {});
    },
    [habitById],
  );

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
        const [{ save }, { writeFile }] = await Promise.all([
          import('@tauri-apps/plugin-dialog'),
          import('@tauri-apps/plugin-fs'),
        ]);
        const destination = await save({
          defaultPath: fileName,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });
        if (!destination) return;

        const bytes = new Uint8Array(await blob.arrayBuffer());
        await writeFile(destination, bytes);
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
        const { invoke } = await import('@tauri-apps/api/core');
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

  const {
    mergedBarListAnalyticsData,
    mergedBarListSummaryMetrics,
    mergedCardAnalyticsData,
    mergedCardSummaryMetrics,
  } = useMetricsDataEffects({
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

  useMetricsExpandedEffects({
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
            habitSparkSources={habitSparkSources}
            miniChartEmptyHint={
              pinnedHabitIds.length === 0
                ? 'Pin a habit card above to feature it here.'
                : undefined
            }
          />

          <MetricsExpandedSection
            availableHabits={availableHabits}
            captureExpandedChart={captureExpandedChart}
            chartRef={chartRef}
            compareHabitId={compareHabitId}
            comparisonLogs={comparisonLogs}
            correlationData={correlationData}
            dateRange={dateRange}
            expandedHabit={expandedHabit}
            expandedHabitData={expandedHabitData}
            expandedHabitUsesGranularHeartRate={expandedHabitUsesGranularHeartRate}
            expandedLogs={expandedLogs}
            expandedTimeRange={expandedTimeRange}
            exportCardRef={exportCardRef}
            filteredHabits={filteredHabits}
            getHabitCardData={getHabitCardData}
            hasCustomDateRange={hasCustomDateRange}
            heartRateExpandedSeries={heartRateExpandedSeries}
            heartRateExpandedSummary={heartRateExpandedSummary}
            isCapturing={isCapturing}
            loadingCorrelation={loadingCorrelation}
            loadingExpandedLogs={loadingExpandedLogs}
            setCompareHabitId={setCompareHabitId}
            setExpandedHabit={setExpandedHabit}
            setExpandedTimeRange={setExpandedTimeRange}
          />
        </>
      ) : null}



      {showShareModal ? (
        <MetricsShareModal
          closeShareModal={closeShareModal}
          copyShareImage={copyShareImage}
          copyState={copyState}
          downloadShareImage={downloadShareImage}
          downloadState={downloadState}
          isCapturing={isCapturing}
          shareImageUrl={shareImageUrl}
          shareLabel={shareLabel}
        />
      ) : null}

    </>
  );
}
