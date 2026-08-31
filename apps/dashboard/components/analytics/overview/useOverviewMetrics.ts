/**
 * useOverviewMetrics - data layer for OverviewView
 */

'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { DateRange } from 'react-day-picker';
import { parseISO } from 'date-fns';
import * as Sentry from '@sentry/nextjs';
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import type { Habit } from '@/contexts/HabitsContext';
import { useAnalyticsFiltersOptional } from '../analytics-filter-context';
import { getHabitLogLocalDate as resolveHabitLogLocalDate } from '@/lib/habit-log-time';
import { perfInfo } from '@/lib/perf-debug';
import { useDesktopCapabilities } from '@/lib/desktop-capabilities';
import { getMetricContextFetchWindow } from '@/components/analytics/metric-context-builder';
import { useUpdateHabitMutation } from '@/hooks/use-habits-query';
import { useComputerSnapshotQuery } from '@/hooks/use-computer-snapshot-query';
import type {
  ComputerDailyResponseRow as ComputerDailyRow,
  ComputerSummaryResponse as ComputerSummaryState,
} from '@/lib/computerActivity';
import {
  EMPTY_OVERVIEW_LOGS,
  isProjectTimeRollupSnapshot,
} from '@/components/analytics/overview-view.helpers';
import type { OverviewViewProps } from './types';
import { useOverviewWearableMetrics } from './useOverviewWearableMetrics';
import { useOverviewHabitMetrics } from './useOverviewHabitMetrics';
import { useOverviewMetricContext } from './useOverviewMetricContext';

export function useOverviewMetrics({
  hideControls = false,
  externalDateRange,
  onDateRangeChange,
  initialOverviewStats,
  isOverviewSnapshotFetching = false,
}: OverviewViewProps) {
  const { isDesktop } = useDesktopCapabilities();
  const router = useRouter();
  const isDesktopShell = typeof window !== 'undefined' && isDesktop;
  const desktopPerfDebug = isDesktopShell && (
    process.env.NEXT_PUBLIC_SENTRY_DESKTOP_DEBUG_PERF === '1'
    || process.env.NEXT_PUBLIC_SENTRY_SMOKE_TEST_DESKTOP === '1'
  );
  const { user } = useUser();
  const { isLoaded } = useAuth();
  const {
    habits,
    habitLogs,
    isLoading,
    isLoadingLogs,
    error,
    fetchHabits,
    fetchHabitLogs,
    deleteHabit
  } = useHabits();

  // Try to use shared filter context, fall back to local state
  const filterContext = useAnalyticsFiltersOptional();
  
  // Local state for when not using context
  const [localDateRange, setLocalDateRange] = useState<DateRange | undefined>(undefined);
  
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

  // Local UI state
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [habitToDelete, setHabitToDelete] = useState<string | null>(null);
  const [deletingHabit, setDeletingHabit] = useState<string | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [selectedContextHabitId, setSelectedContextHabitId] = useState<string | null>(null);
  const [optimisticLogs, setOptimisticLogs] = useState<any[]>([]);
  const [orderedHabits, setOrderedHabits] = useState<Habit[]>([]);

  // History scrubber state
  const [scrubberHoveredDate, setScrubberHoveredDate] = useState<string | null>(null);
  const [scrubberHoveredValues, setScrubberHoveredValues] = useState<Record<string, number> | null>(null);
  const [scrubberSelectedDate, setScrubberSelectedDate] = useState<string | null>(null);
  const firstUsablePaintLoggedRef = useRef(false);
  const mountTimeRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const isBackendUnavailable = habits.length === 0 && !isLoading && Boolean(error);
  const updateHabitMutation = useUpdateHabitMutation();
  const statsLoading = false;
  const effectiveCachedStats = useMemo(
    () => initialOverviewStats ?? {},
    [initialOverviewStats],
  );
  const computerSnapshotQuery = useComputerSnapshotQuery({
    userId: user?.id,
    dateRange,
    enabled: Boolean(user?.id),
  });
  const computerSnapshotUsesProjectTimeRollups = isProjectTimeRollupSnapshot(computerSnapshotQuery.data);
  const effectiveComputerActivityDaily = useMemo<ComputerDailyRow[]>(
    () => computerSnapshotUsesProjectTimeRollups ? [] : computerSnapshotQuery.data?.daily ?? [],
    [computerSnapshotQuery.data?.daily, computerSnapshotUsesProjectTimeRollups],
  );
  const effectiveComputerActivitySummary = useMemo<ComputerSummaryState | null>(
    () => computerSnapshotUsesProjectTimeRollups ? null : computerSnapshotQuery.data?.summary ?? null,
    [computerSnapshotQuery.data?.summary, computerSnapshotUsesProjectTimeRollups],
  );
  const computerSnapshotLooksEmpty = useMemo(() => {
    const snapshot = computerSnapshotQuery.data;
    if (!snapshot) return true;
    if (isProjectTimeRollupSnapshot(snapshot)) return true;

    const summary = snapshot.summary;
    const hasSummaryData =
      Number(summary?.total_active_ms || 0) > 0
      || Number(summary?.total_hours || 0) > 0
      || Number(summary?.days_tracked || 0) > 0
      || Number(summary?.total_events || 0) > 0;

    return !hasSummaryData
      && snapshot.daily.length === 0
      && snapshot.apps.length === 0
      && snapshot.domains.length === 0;
  }, [computerSnapshotQuery.data]);
  const computerActivityResolved = !user?.id || computerSnapshotQuery.isFetched || computerSnapshotQuery.isSuccess;
  const contextFetchWindow = useMemo(
    () => getMetricContextFetchWindow(dateRange),
    [dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
  );
  const contextComputerDateRange = useMemo<DateRange>(
    () => ({
      from: parseISO(contextFetchWindow.startDate),
      to: parseISO(contextFetchWindow.endDate),
    }),
    [contextFetchWindow.startDate, contextFetchWindow.endDate],
  );

  const { wearableMetricDataByHabitId, wearableDailyTotalsQuery } = useOverviewWearableMetrics({
    user,
    dateRange,
    habits,
    effectiveCachedStats,
    isOverviewSnapshotFetching,
  });

  const traceSyncComputation = useCallback(<T,>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => T,
  ): T => {
    if (!desktopPerfDebug) {
      return fn();
    }
    return Sentry.startSpan(
      {
        name,
        op: 'ui.compute',
        attributes,
      },
      fn,
    );
  }, [desktopPerfDebug]);

  const handleScrubberHover = useCallback((date: string | null, values: Record<string, number> | null) => {
    setScrubberHoveredDate(date);
    setScrubberHoveredValues(values);
  }, []);

  const handleScrubberSelect = useCallback((date: string | null) => {
    setScrubberSelectedDate(date);
  }, []);

  const displayLogs = useMemo(() => {
    return [...habitLogs, ...optimisticLogs];
  }, [habitLogs, optimisticLogs]);

  const habitsById = useMemo(() => {
    const next = new Map<string, Habit>();
    for (const habit of habits) {
      if (habit.id) {
        next.set(habit.id, habit);
      }
    }
    return next;
  }, [habits]);


  const scrubberDisplayLogs = useMemo(
    () => (isDesktopShell ? EMPTY_OVERVIEW_LOGS : displayLogs),
    [displayLogs, isDesktopShell],
  );

  const getLogLocalDate = useCallback((log: { date?: string; completed_at?: string }) => {
    const habitId = typeof (log as { habit_id?: string }).habit_id === 'string'
      ? (log as { habit_id?: string }).habit_id || ''
      : '';
    const habit = habitId ? habitsById.get(habitId) : null;
    return resolveHabitLogLocalDate({
      date: log.date,
      completed_at: log.completed_at,
      integration_source: habit?.integration_source,
      metric_type: habit?.metric_type,
    });
  }, [habitsById]);

  useEffect(() => {
    perfInfo('overview-view', 'mount', {
      is_tauri: typeof window !== 'undefined' ? isDesktop : false,
      has_date_range: Boolean(dateRange?.from),
    });
    if (desktopPerfDebug) {
      Sentry.addBreadcrumb({
        category: 'overview.lifecycle',
        level: 'info',
        message: 'OverviewView mounted',
        data: {
          has_date_range: Boolean(dateRange?.from),
          is_desktop_shell: isDesktopShell,
        },
      });
    }
  }, []);

  useEffect(() => {
    if (firstUsablePaintLoggedRef.current) return;
    if (isLoading || statsLoading || !computerActivityResolved) return;
    if (habits.length === 0 && effectiveComputerActivityDaily.length === 0) return;

    firstUsablePaintLoggedRef.current = true;
    const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    perfInfo('overview-view', 'first-usable-paint', {
      duration_ms: Number((end - mountTimeRef.current).toFixed(2)),
      habit_count: habits.length,
      stats_count: Object.keys(effectiveCachedStats).length,
      computer_rows: effectiveComputerActivityDaily.length,
    });
    if (desktopPerfDebug) {
      Sentry.captureMessage('Overview first usable paint', {
        level: 'info',
        tags: {
          runtime: 'desktop',
          surface: 'desktop-overview',
          perf_debug: 'true',
        },
        extra: {
          duration_ms: Number((end - mountTimeRef.current).toFixed(2)),
          habit_count: habits.length,
          stats_count: Object.keys(effectiveCachedStats).length,
          computer_rows: effectiveComputerActivityDaily.length,
        },
      });
    }
  }, [
    desktopPerfDebug,
    computerActivityResolved,
    effectiveCachedStats,
    effectiveComputerActivityDaily,
    habits.length,
    isLoading,
    statsLoading,
  ]);

  // Initialize ordered habits
  useEffect(() => {
    if (habits.length === 0) {
      setOrderedHabits([]);
      return;
    }

    const savedOrder = localStorage.getItem(`habit-order-${user?.id}`);
    if (savedOrder) {
      try {
        const orderArray: string[] = JSON.parse(savedOrder);
        const sorted = [...habits].sort((a, b) => {
          const aIndex = orderArray.indexOf(a.id || '');
          const bIndex = orderArray.indexOf(b.id || '');
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
        setOrderedHabits(sorted);
      } catch (e) {
        setOrderedHabits(habits);
      }
    } else {
      setOrderedHabits(habits);
    }
  }, [habits, user?.id]);

  const handleReorder = useCallback((reorderedHabits: Habit[]) => {
    setOrderedHabits(reorderedHabits);
    const orderIds = reorderedHabits.map(h => h.id || '');
    localStorage.setItem(`habit-order-${user?.id}`, JSON.stringify(orderIds));
  }, [user?.id]);

  // Close tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (activeTooltip) {
        const target = event.target as Element;
        if (!target.closest('.tooltip-container')) {
          setActiveTooltip(null);
        }
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeTooltip) {
        setActiveTooltip(null);
      }
    };

    if (activeTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [activeTooltip]);

  useEffect(() => {
    if (!user || !isBackendUnavailable) return;

    const retryTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      fetchHabits();
      fetchHabitLogs();
    }, 60_000);

    return () => clearInterval(retryTimer);
  }, [user, isBackendUnavailable, fetchHabits, fetchHabitLogs]);


  const handleUpdateHabitDetails = useCallback(
    async (
      habitId: string | undefined,
      updates: { name?: string; unit_type?: string },
    ) => {
      if (!habitId) return;

      const nextUpdates: { name?: string; unit_type?: string } = {};
      if (typeof updates.name === 'string' && updates.name.trim()) {
        nextUpdates.name = updates.name.trim();
      }
      if (typeof updates.unit_type === 'string' && updates.unit_type.trim()) {
        nextUpdates.unit_type = updates.unit_type.trim();
      }
      if (Object.keys(nextUpdates).length === 0) return;

      await updateHabitMutation.mutateAsync({
        habitId,
        updates: nextUpdates,
      });
    },
    [updateHabitMutation],
  );

  const handleHabitCreated = useCallback(async (newHabit: Habit) => {
    try {
      await fetchHabits();
    } catch (error) {
      console.error('❌ Error refreshing habits list:', error);
    }
  }, [fetchHabits]);

  const confirmDelete = useCallback((habitId: string | undefined) => {
    if (!habitId) return;
    setHabitToDelete(habitId);
  }, []);

  const cancelDelete = useCallback(() => {
    setHabitToDelete(null);
  }, []);

  const handleOpenSelectionModal = useCallback(() => {
    setShowSelectionModal(true);
  }, []);

  const handleOpenImportModal = useCallback(() => {
    setShowImportModal(true);
  }, []);

  const handleOpenCommandPalette = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true,
        bubbles: true,
      }),
    );
  }, []);

  const handleDeleteHabit = async (habitId: string | null) => {
    if (!habitId) {
      setHabitToDelete(null);
      return;
    }
    setDeletingHabit(habitId);
    try {
      await deleteHabit(habitId);
      setHabitToDelete(null);
    } catch (error) {
      console.error('❌ Failed to delete habit:', error);
    } finally {
      setDeletingHabit(null);
    }
  };

  const {
    getHabitMetricDisplay,
    getHabitMetricClassName,
    getHabitMetricStats,
    habitMetricDataById,
  } = useOverviewHabitMetrics({
    habits,
    orderedHabits,
    dateRange,
    displayLogs,
    habitsById,
    effectiveCachedStats,
    effectiveComputerActivityDaily,
    effectiveComputerActivitySummary,
    computerSnapshotQuery,
    computerSnapshotLooksEmpty,
    wearableMetricDataByHabitId,
    wearableDailyTotalsQuery,
    isLoadingLogs,
    isOverviewSnapshotFetching,
    scrubberHoveredDate,
    traceSyncComputation,
  });

  const handleOpenContext = useCallback((habitId: string) => {
    setSelectedContextHabitId(habitId);
  }, []);

  const handleCloseContext = useCallback(() => {
    setSelectedContextHabitId(null);
  }, []);

  const {
    metricContextModel,
    isMetricContextLoading,
    overviewContextStyle,
  } = useOverviewMetricContext({
    user,
    dateRange,
    habits,
    orderedHabits,
    habitsById,
    selectedContextHabitId,
    setSelectedContextHabitId,
    habitMetricDataById,
    effectiveComputerActivityDaily,
    computerSnapshotQuery,
    contextFetchWindow,
    contextComputerDateRange,
  });

  const hasRenderableCachedHabits = habits.length > 0;

  const shouldShowLoadingSpinner =
    !hasRenderableCachedHabits
    && (
      isLoading
      || (!isLoaded)
      || (isLoaded && !user)
    );

  return {
    router,
    hideControls,
    isDesktopShell,
    habits,
    orderedHabits,
    isLoading,
    isLoaded,
    user,
    error,
    fetchHabits,
    fetchHabitLogs,
    isBackendUnavailable,
    shouldShowLoadingSpinner,
    dateRange,
    setDateRange,
    scrubberDisplayLogs,
    scrubberSelectedDate,
    scrubberHoveredDate,
    scrubberHoveredValues,
    handleScrubberHover,
    handleScrubberSelect,
    showSelectionModal,
    setShowSelectionModal,
    showImportModal,
    setShowImportModal,
    handleOpenSelectionModal,
    handleOpenImportModal,
    handleOpenCommandPalette,
    handleReorder,
    getHabitMetricDisplay,
    getHabitMetricClassName,
    getHabitMetricStats,
    activeTooltip,
    setActiveTooltip,
    handleUpdateHabitDetails,
    updateHabitMutation,
    confirmDelete,
    deletingHabit,
    selectedContextHabitId,
    handleOpenContext,
    handleCloseContext,
    metricContextModel,
    isMetricContextLoading,
    overviewContextStyle,
    habitToDelete,
    cancelDelete,
    handleDeleteHabit,
    handleHabitCreated,
  };
}
