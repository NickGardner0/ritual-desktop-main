/**
 * OverviewView - Dashboard/Index content extracted for unified Analytics page
 * 
 * Displays habits in a clean list format with totals and stats.
 * Designed to work with shared filter context or standalone.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { DateRange } from 'react-day-picker';
import { isWithinInterval, parseISO, format, startOfDay, endOfDay } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import * as Sentry from '@sentry/nextjs';
import { Spinner } from "@/components/ui/kibo-ui/spinner";
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import type { HabitStats } from '@/lib/services/analytics-api';
import { Button } from "@/components/ui/button";
import type { Habit } from '@/contexts/HabitsContext';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';
import { isComputerHabitName } from '@/lib/computer-time-habit';
import { getHabitLogLocalDate as resolveHabitLogLocalDate } from '@/lib/habit-log-time';
import { perfInfo } from '@/lib/perf-debug';
import { isTauri } from '@/lib/tauri-utils';
import { OverviewInitialSection } from '@/components/analytics/overview-initial-section';
import { useUpdateHabitMutation } from '@/hooks/use-habits-query';
import { useComputerSnapshotQuery } from '@/hooks/use-computer-snapshot-query';
import {
  buildWearableDailyRows,
  getWearableDateRange,
  getWearableMetricType,
  getWearableProviderForHabit,
  isWearableBackedHabit,
  summarizeWearableDailyRows,
  usesAverageDisplay,
  type WearableDailyTotal,
} from '@/lib/wearables-dashboard';
import type {
  ComputerDailyResponseRow as ComputerDailyRow,
  ComputerSummaryResponse as ComputerSummaryState,
} from '@/lib/computerActivity/client';

const HabitSelectionModal = dynamic(
  () => import("@/components/habit-selection-modal").then(m => ({ default: m.HabitSelectionModal })),
  { ssr: false }
);

const DataImportModal = dynamic(
  () => import("@/components/data-import-modal").then(m => ({ default: m.DataImportModal })),
  { ssr: false }
);


interface MetricLogEntry {
  habitId: string;
  localDate: string;
  amount: number | null;
  duration: number | null;
}

interface HabitMetricStatsData {
  unitLabel: string;
  sumFormatted: string;
  avgFormatted: string;
  minFormatted: string;
  maxFormatted: string;
  stdDevFormatted: string;
  daysWithData: number;
  trackedDays: number;
}

interface HabitMetricData {
  display: string;
  stats: HabitMetricStatsData;
}

const EMPTY_OVERVIEW_LOGS: any[] = [];

function formatMetricAmount(value: number, unitType: string): string {
  const rounded = Math.round(value * 100) / 100;
  const unitLower = unitType.toLowerCase();

  if (['bpm', 'steps', 'count', 'pages', 'reps', 'sets', 'sessions'].includes(unitLower)) {
    return Math.round(rounded).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  if (['miles', 'km', 'kilometers'].includes(unitLower)) {
    return rounded.toLocaleString(undefined, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }

  if (['hours', 'minutes'].includes(unitLower)) {
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return Number.isInteger(rounded)
    ? rounded.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function isPercentLikeUnit(unitType: string): boolean {
  const normalized = unitType.trim().toLowerCase();
  return normalized.includes('percentage') || normalized === 'percent' || normalized === '%';
}

function buildComputerSummaryFromRows(rows: ComputerDailyRow[]): ComputerSummaryState {
  const totalActiveMs = rows.reduce((sum, row) => sum + Number(row.active_ms || 0), 0);
  const totalHours = rows.reduce((sum, row) => sum + Number(row.active_hours || 0), 0);
  const totalEvents = rows.reduce((sum, row) => sum + Number(row.events_count || 0), 0);
  const daysTracked = rows.filter((row) => Number(row.active_ms || 0) > 0).length;

  return {
    total_active_ms: totalActiveMs,
    total_afk_ms: 0,
    total_hours: totalHours,
    total_events: totalEvents,
    days_tracked: daysTracked,
    avg_daily_hours: daysTracked > 0 ? totalHours / daysTracked : 0,
  };
}

function calculateTrackedSpanDays(dateKeys: string[]): number {
  const validDates = dateKeys
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .sort();

  if (validDates.length === 0) return 0;
  if (validDates.length === 1) return 1;

  const first = new Date(`${validDates[0]}T00:00:00`);
  const last = new Date(`${validDates[validDates.length - 1]}T00:00:00`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) {
    return validDates.length;
  }

  return Math.max(1, Math.floor((last.getTime() - first.getTime()) / 86_400_000) + 1);
}

function formatMetricDisplay(value: number, unitType: string): string {
  if (isPercentLikeUnit(unitType)) {
    return `${formatMetricAmount(value, unitType)}%`;
  }
  return `${formatMetricAmount(value, unitType)} ${unitType}`;
}

interface OverviewViewProps {
  // Optional: Allow passing in external filter state for standalone use
  externalDateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  // Hide controls when used inside unified page (controls are in parent)
  hideControls?: boolean;
  initialOverviewStats?: Record<string, HabitStats>;
}


export function OverviewView({
  externalDateRange,
  onDateRangeChange,
  hideControls = false,
  initialOverviewStats,
}: OverviewViewProps) {
  const isDesktopShell = typeof window !== 'undefined' && isTauri();
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
  const effectiveComputerActivityDaily = useMemo<ComputerDailyRow[]>(
    () => computerSnapshotQuery.data?.daily ?? [],
    [computerSnapshotQuery.data?.daily],
  );
  const effectiveComputerActivitySummary = useMemo<ComputerSummaryState | null>(
    () => computerSnapshotQuery.data?.summary ?? null,
    [computerSnapshotQuery.data?.summary],
  );
  const computerSnapshotLooksEmpty = useMemo(() => {
    const snapshot = computerSnapshotQuery.data;
    if (!snapshot) return true;

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
  const wearableHabits = useMemo(
    () => habits.filter((habit) => isWearableBackedHabit(habit)),
    [habits],
  );
  const wearableDailyTotalsQuery = useQuery({
    queryKey: [
      'overview-wearable-daily-totals',
      user?.id,
      dateRange?.from?.toISOString() || 'all',
      dateRange?.to?.toISOString() || 'all',
      wearableHabits
        .map((habit) => `${getWearableProviderForHabit(habit) || 'preferred'}:${getWearableMetricType(habit) || ''}:${habit.id || ''}`)
        .sort()
        .join('|'),
    ],
    queryFn: async () => {
      const { startDate, endDate } = getWearableDateRange(dateRange);
      const groupedMetrics = new Map<string, Set<string>>();

      for (const habit of wearableHabits) {
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

          const response = await fetch(`/api/wearables/daily-totals?${params.toString()}`, {
            cache: 'no-store',
            credentials: 'include',
          });
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
    enabled: Boolean(user?.id) && wearableHabits.length > 0,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const wearableMetricDataByHabitId = useMemo(() => {
    const next = new Map<string, HabitMetricData>();
    const totalsByProvider = wearableDailyTotalsQuery.data || {};

    for (const habit of wearableHabits) {
      const habitId = habit.id || '';
      const metricType = getWearableMetricType(habit);
      if (!habitId || !metricType) continue;

      const providerKey = getWearableProviderForHabit(habit) || '__preferred__';
      const dailyRows = buildWearableDailyRows(totalsByProvider[providerKey] || [], metricType);
      const summary = summarizeWearableDailyRows(dailyRows);
      if (summary.daysWithData === 0) continue;

      const unitLabel = habit.unit_type || summary.unit || 'sessions';
      const displayValue = usesAverageDisplay(habit.metric_type, habit.unit_type, habit.name)
        ? summary.average
        : summary.total;

      next.set(habitId, {
        display: formatMetricDisplay(displayValue, unitLabel),
        stats: {
          unitLabel,
          sumFormatted: formatMetricDisplay(summary.total, unitLabel),
          avgFormatted: formatMetricDisplay(summary.average, unitLabel),
          minFormatted: formatMetricDisplay(summary.min, unitLabel),
          maxFormatted: formatMetricDisplay(summary.max, unitLabel),
          stdDevFormatted: formatMetricDisplay(summary.stdDev, unitLabel),
          daysWithData: summary.daysWithData,
          trackedDays: dailyRows.length,
        },
      });
    }

    return next;
  }, [wearableDailyTotalsQuery.data, wearableHabits]);

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
      is_tauri: typeof window !== 'undefined' ? isTauri() : false,
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

  const formatHabitStatNumber = useCallback((n: number) => {
    const rounded = Math.round(n * 100) / 100;
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, []);

  const isSleepLikeHabit = useCallback((habit: Habit) => {
    const metricType = String(habit.metric_type || '').trim().toLowerCase();
    const habitName = String(habit.name || '').trim().toLowerCase();
    const category = String(habit.category || '').trim().toLowerCase();
    const integrationSource = String(habit.integration_source || '').trim().toLowerCase();

    if (metricType && ['sleep', 'sleep_session', 'sleep_duration', 'sleep_total', 'in_bed'].includes(metricType)) {
      return true;
    }

    if (habitName.includes('sleep')) {
      return true;
    }

    if (category.includes('sleep') && ['whoop', 'oura', 'apple_health', 'fitbit', 'garmin'].includes(integrationSource)) {
      return true;
    }

    return false;
  }, []);

  // Metrics where the display should show average, not sum (percentages, rates, averages)
  const isAverageDisplayMetric = useCallback((habit: Habit) => {
    const metricType = String(habit.metric_type || '').trim().toLowerCase();
    const unitType = String(habit.unit_type || '').trim().toLowerCase();

    const averageMetricTypes = new Set([
      'oxygen_saturation', 'hr', 'resting_hr', 'walking_hr', 'hrv', 'respiratory_rate',
      'body_mass', 'body_mass_index', 'body_fat_percentage', 'lean_body_mass', 'height', 'waist_circumference',
      'blood_pressure_systolic', 'blood_pressure_diastolic', 'blood_glucose', 'body_temperature',
      'walking_speed', 'walking_step_length', 'walking_asymmetry',
    ]);

    if (averageMetricTypes.has(metricType)) return true;
    if (unitType.includes('percentage') || unitType === 'percent' || unitType === 'bpm' || unitType === '%') return true;

    return false;
  }, []);

  const filteredMetricLogEntries = useMemo<MetricLogEntry[]>(() => {
    return traceSyncComputation(
      'overview.compute.filtered_metric_log_entries',
      {
        display_log_count: displayLogs.length,
        has_date_range: Boolean(dateRange?.from),
      },
      () => {
        const rangeStart = dateRange?.from ? startOfDay(dateRange.from) : null;
        const rangeEnd = dateRange?.from ? endOfDay(dateRange.to ?? dateRange.from) : null;

        return displayLogs.reduce<MetricLogEntry[]>((entries, log) => {
          const habitId = typeof log.habit_id === 'string' ? log.habit_id : '';
          const isCompleted = log.status === 'completed' || (log.status as any) === 'success' || !log.status;

          if (!habitId || !isCompleted) {
            return entries;
          }

          const localDate = getLogLocalDate(log);

          if (rangeStart && rangeEnd) {
            if (!localDate) return entries;
            const logDate = parseISO(localDate);
            if (Number.isNaN(logDate.getTime())) return entries;
            if (!isWithinInterval(logDate, { start: rangeStart, end: rangeEnd })) {
              return entries;
            }
          }

          entries.push({
            habitId,
            localDate,
            amount: typeof log.amount === 'number' && Number.isFinite(log.amount) ? log.amount : null,
            duration: typeof log.duration === 'number' && Number.isFinite(log.duration) ? log.duration : null,
          });
          return entries;
        }, []);
      },
    );
  }, [dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), displayLogs, getLogLocalDate, traceSyncComputation]);

  const metricEntriesByHabitId = useMemo(() => {
    const grouped = new Map<string, MetricLogEntry[]>();

    for (const entry of filteredMetricLogEntries) {
      const existing = grouped.get(entry.habitId);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(entry.habitId, [entry]);
      }
    }

    return grouped;
  }, [filteredMetricLogEntries]);

  const computerActivityByDay = useMemo(() => {
    const rows = new Map<string, ComputerDailyRow>();
    for (const row of effectiveComputerActivityDaily) {
      if (row.day) {
        rows.set(row.day, row);
      }
    }
    return rows;
  }, [effectiveComputerActivityDaily]);

  const habitMetricDataById = useMemo(() => {
    return traceSyncComputation(
      'overview.compute.habit_metric_data_map',
      {
        ordered_habit_count: orderedHabits.length,
        habit_count: habits.length,
        metric_entry_count: filteredMetricLogEntries.length,
        computer_row_count: effectiveComputerActivityDaily.length,
      },
      () => {
        const next = new Map<string, HabitMetricData>();
        const habitsForMetrics = orderedHabits.length > 0 ? orderedHabits : habits;

        const buildLocalMetricData = (habit: Habit, entries: MetricLogEntry[]): HabitMetricData => {
          const unitLabel = habit.unit_type || 'sessions';
          const unitLower = unitLabel.toLowerCase();
          const isHourBased = unitLower.includes('hour');
          const isMinuteBased = unitLower.includes('minute');
          const useMaxPerDay = isSleepLikeHabit(habit);

          if (entries.length === 0) {
            const zeroDisplay = formatMetricDisplay(0, unitLabel);
            return {
              display: zeroDisplay,
              stats: {
                unitLabel,
                sumFormatted: zeroDisplay,
                avgFormatted: zeroDisplay,
                minFormatted: zeroDisplay,
                maxFormatted: zeroDisplay,
                stdDevFormatted: zeroDisplay,
                daysWithData: 0,
                trackedDays: 0,
              },
            };
          }

      let totalValue = 0;
      const dailyValues = new Map<string, number>();

      for (const entry of entries) {
        let aggregateValue = 0;

        if (entry.duration !== null && entry.duration > 0) {
          if (isHourBased) {
            aggregateValue = entry.duration / 3600;
          } else if (isMinuteBased) {
            aggregateValue = entry.duration / 60;
          } else {
            aggregateValue = entry.duration;
          }
        } else if (entry.amount !== null) {
          if (isHourBased) {
            aggregateValue = entry.amount;
          } else if (isMinuteBased) {
            aggregateValue = entry.amount;
          } else {
            aggregateValue = entry.amount;
          }
        } else {
          aggregateValue = 1;
        }

        totalValue += aggregateValue;

        if (!entry.localDate) continue;
        const previousValue = dailyValues.get(entry.localDate) || 0;
        dailyValues.set(
          entry.localDate,
          useMaxPerDay ? Math.max(previousValue, aggregateValue) : previousValue + aggregateValue,
        );
      }

      const values = Array.from(dailyValues.values()).filter((value) => Number.isFinite(value));
      const trackedDays = calculateTrackedSpanDays(Array.from(dailyValues.keys()));
      const total = values.reduce((sum, value) => sum + value, 0);
      const average = values.length ? total / values.length : 0;
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      const variance = values.length
        ? values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / values.length
        : 0;

      const useAvgDisplay = isAverageDisplayMetric(habit);
      const displayValue = useAvgDisplay ? average : totalValue;

      return {
        display: formatMetricDisplay(displayValue, unitLabel),
        stats: {
          unitLabel,
          sumFormatted: formatMetricDisplay(total, unitLabel),
          avgFormatted: formatMetricDisplay(average, unitLabel),
          minFormatted: formatMetricDisplay(min, unitLabel),
          maxFormatted: formatMetricDisplay(max, unitLabel),
          stdDevFormatted: formatMetricDisplay(Math.sqrt(variance), unitLabel),
          daysWithData: values.filter((value) => value > 0).length,
          trackedDays,
        },
      };
    };

        for (const habit of habitsForMetrics) {
          const habitId = habit.id || '';
          if (!habitId) continue;

      if (isComputerHabitName(habit.name)) {
        const cachedStats = effectiveCachedStats[habitId];
        const shouldUseCachedComputerFallback =
          Boolean(cachedStats)
          && (
            computerSnapshotQuery.isPlaceholderData
            || computerSnapshotLooksEmpty
          );

        if (shouldUseCachedComputerFallback && cachedStats) {
          next.set(habitId, {
            display: `${formatHabitStatNumber(Number(cachedStats.total || 0))} Hours`,
            stats: {
              unitLabel: 'Hours',
              sumFormatted: `${formatHabitStatNumber(Number(cachedStats.total || 0))} Hours`,
              avgFormatted: `${formatHabitStatNumber(Number(cachedStats.average || 0))} Hours`,
              minFormatted: `${formatHabitStatNumber(Number(cachedStats.min || 0))} Hours`,
              maxFormatted: `${formatHabitStatNumber(Number(cachedStats.max || 0))} Hours`,
              stdDevFormatted: `${formatHabitStatNumber(Number(cachedStats.std_dev || Math.sqrt(cachedStats.variance || 0)))} Hours`,
              daysWithData: Number(cachedStats.days_with_data || 0),
              trackedDays: Number(cachedStats.days_with_data || 0),
            },
          });
          continue;
        }

        const rows = effectiveComputerActivityDaily;
        const rowsSummary = rows.length > 0 ? buildComputerSummaryFromRows(rows) : null;
        const summaryForDisplay = !dateRange?.from && rowsSummary
          ? rowsSummary
          : effectiveComputerActivitySummary;
        const totalHours = summaryForDisplay
          ? Number(summaryForDisplay.total_hours || 0)
          : rows.reduce((sum, row) => sum + Number(row.active_hours || 0), 0);

        if (rows.length === 0 && effectiveComputerActivitySummary) {
          next.set(habitId, {
            display: `${formatHabitStatNumber(totalHours)} Hours`,
            stats: {
              unitLabel: 'Hours',
              sumFormatted: `${formatHabitStatNumber(Number(effectiveComputerActivitySummary.total_hours || 0))} Hours`,
              avgFormatted: `${formatHabitStatNumber(Number(effectiveComputerActivitySummary.avg_daily_hours || 0))} Hours`,
              minFormatted: '—',
              maxFormatted: '—',
              stdDevFormatted: '—',
              daysWithData: Number(effectiveComputerActivitySummary.days_tracked || 0),
              trackedDays: Number(effectiveComputerActivitySummary.days_tracked || 0),
            },
          });
          continue;
        }

        const values = rows
          .map((row) => Number(row.active_hours || 0))
          .filter((value) => Number.isFinite(value) && value >= 0);
        const trackedDays = calculateTrackedSpanDays(
          rows.map((row) => row.day || '').filter((value): value is string => Boolean(value)),
        );
        const average = values.length ? totalHours / values.length : 0;
        const min = values.length ? Math.min(...values) : 0;
        const max = values.length ? Math.max(...values) : 0;
        const variance = values.length
          ? values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / values.length
          : 0;

        next.set(habitId, {
          display: `${formatHabitStatNumber(totalHours)} Hours`,
          stats: {
            unitLabel: 'Hours',
            sumFormatted: `${formatHabitStatNumber(totalHours)} Hours`,
            avgFormatted: `${formatHabitStatNumber(average)} Hours`,
            minFormatted: `${formatHabitStatNumber(min)} Hours`,
            maxFormatted: `${formatHabitStatNumber(max)} Hours`,
            stdDevFormatted: `${formatHabitStatNumber(Math.sqrt(variance))} Hours`,
            daysWithData: values.filter((value) => value > 0).length,
            trackedDays,
          },
        });
        continue;
      }

      const wearableMetricData = wearableMetricDataByHabitId.get(habitId);
      if (wearableMetricData) {
        next.set(habitId, wearableMetricData);
        continue;
      }

      const localMetricData = buildLocalMetricData(habit, metricEntriesByHabitId.get(habitId) || []);

      // In ranged mode, derive the overview metrics directly from the locally
      // filtered logs so the list always respects the active date picker.
      if (dateRange?.from) {
        next.set(habitId, localMetricData);
        continue;
      }

      const stats = effectiveCachedStats[habitId];
      if (stats) {
        const unitLabel = habit.unit_type || stats.unit || 'sessions';
        const cachedDisplayValue = isAverageDisplayMetric(habit) ? Number(stats.average || 0) : Number(stats.total || 0);
        next.set(habitId, {
          display: formatMetricDisplay(cachedDisplayValue, unitLabel),
          stats: {
            unitLabel,
            sumFormatted: formatMetricDisplay(Number(stats.total || 0), unitLabel),
            avgFormatted: formatMetricDisplay(Number(stats.average || 0), unitLabel),
            minFormatted: formatMetricDisplay(Number(stats.min || 0), unitLabel),
            maxFormatted: formatMetricDisplay(Number(stats.max || 0), unitLabel),
            stdDevFormatted: formatMetricDisplay(Number(stats.std_dev || Math.sqrt(stats.variance || 0)), unitLabel),
            daysWithData: stats.days_with_data,
            trackedDays: Number(stats.days_with_data || 0),
          },
        });
        continue;
      }

          next.set(habitId, localMetricData);
        }

        return next;
      },
    );
  }, [
    habits,
    orderedHabits,
    dateRange?.from?.toISOString(),
    effectiveComputerActivitySummary,
    effectiveCachedStats,
    effectiveComputerActivityDaily,
    formatHabitStatNumber,
    isAverageDisplayMetric,
    isSleepLikeHabit,
    metricEntriesByHabitId,
    wearableMetricDataByHabitId,
    computerSnapshotQuery.isPlaceholderData,
    traceSyncComputation,
  ]);

  const getHabitMetricDisplay = useCallback((habit: Habit, previewValue?: number | null): string => {
    const unitType = habit.unit_type || 'sessions';

    if (isComputerHabitName(habit.name) && scrubberHoveredDate) {
      const hoveredRow = computerActivityByDay.get(scrubberHoveredDate);
      if (hoveredRow) {
        return `${formatHabitStatNumber(Number(hoveredRow.active_hours || 0))} Hours`;
      }
    }

    if (previewValue !== undefined && previewValue !== null) {
      if (unitType.toLowerCase().includes('hour')) {
        return `${formatHabitStatNumber(previewValue / 60)} Hours`;
      }
      if (unitType.toLowerCase().includes('minute')) {
        return `${Math.round(previewValue)} Minutes`;
      }
      return formatMetricDisplay(previewValue, unitType);
    }

    return habitMetricDataById.get(habit.id || '')?.display || `0 ${unitType}`;
  }, [computerActivityByDay, formatHabitStatNumber, habitMetricDataById, scrubberHoveredDate]);

  const getHabitMetricClassName = useCallback(() => 'text-gray-900', []);

  const getHabitMetricStats = useCallback((habit: Habit) => {
    const unitLabel = habit.unit_type || 'sessions';
    return habitMetricDataById.get(habit.id || '')?.stats || {
      unitLabel,
      sumFormatted: formatMetricDisplay(0, unitLabel),
      avgFormatted: formatMetricDisplay(0, unitLabel),
      minFormatted: formatMetricDisplay(0, unitLabel),
      maxFormatted: formatMetricDisplay(0, unitLabel),
      stdDevFormatted: formatMetricDisplay(0, unitLabel),
      daysWithData: 0,
      trackedDays: 0,
    };
  }, [habitMetricDataById]);

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

  const hasRenderableCachedHabits = habits.length > 0;

  // When desktop relaunches, render immediately from persisted habit cache even
  // if Clerk is still rehydrating. Avoid blocking Overview on auth hydration
  // when we already have usable data on-screen.
  if (
    (isLoading && !hasRenderableCachedHabits)
    || (!isLoaded && !hasRenderableCachedHabits)
    || (isLoaded && !user && !hasRenderableCachedHabits)
  ) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="space-y-0 h-[calc(100vh-160px)] overflow-hidden">
      <OverviewInitialSection
        hideControls={hideControls}
        isDesktopShell={isDesktopShell}
        habits={habits}
        orderedHabits={orderedHabits}
        displayLogs={scrubberDisplayLogs}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        scrubberSelectedDate={scrubberSelectedDate}
        onScrubberHover={handleScrubberHover}
        onScrubberSelect={handleScrubberSelect}
        onShowSelectionModal={handleOpenSelectionModal}
        onShowImportModal={handleOpenImportModal}
        onReorder={handleReorder}
        getHabitMetricDisplay={getHabitMetricDisplay}
        getHabitMetricClassName={getHabitMetricClassName}
        scrubberHoveredDate={scrubberHoveredDate}
        scrubberHoveredValues={scrubberHoveredValues}
        activeTooltip={activeTooltip}
        setActiveTooltip={setActiveTooltip}
        getHabitMetricStats={getHabitMetricStats}
        onUpdateHabitDetails={handleUpdateHabitDetails}
        updatingHabitId={updateHabitMutation.isPending ? updateHabitMutation.variables?.habitId : null}
        confirmDelete={confirmDelete}
        deletingHabit={deletingHabit}
      />

      {/* Empty state */}
      {isBackendUnavailable && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] mt-8 text-center">
          <div className="text-xl text-black" style={{ fontWeight: 500 }}>
            Backend unavailable
          </div>
          <div className="mt-2 max-w-xl text-sm leading-tight text-black" style={{ fontWeight: 400 }}>
            We couldn&apos;t load your data right now.
            <br />
            Retrying in the background.
          </div>
          <button
            onClick={() => {
              fetchHabits();
              fetchHabitLogs();
            }}
            className="mt-4 text-sm text-black underline underline-offset-4"
            style={{ fontWeight: 400 }}
          >
            Retry now
          </button>
        </div>
      )}

      {!isBackendUnavailable && habits.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] mt-8">
          <div className="text-xl mb-2 text-center" style={{ fontWeight: 500 }}>
            Start tracking anything
          </div>
          <div className="text-sm font-normal mb-2 text-center max-w-xl leading-tight" style={{ fontWeight: 400, color: '#9C9C9D' }}>
            Ritual is your hub for personal insights, understanding
            <br />
            behavioral trends, and getting a quantified view of your life.
          </div>
          <button
            onClick={() => setShowSelectionModal(true)}
            className="mt-2 px-3 py-2 bg-black text-white rounded-sm text-sm font-normal shadow transition-colors duration-200 hover:bg-[#27251E]"
            style={{ fontWeight: 400 }}
          >
            Start Tracking
          </button>
        </div>
      )}

      {/* Modals */}
      {showSelectionModal && (
        <HabitSelectionModal
          isOpen={showSelectionModal}
          onClose={() => setShowSelectionModal(false)}
          onHabitCreated={handleHabitCreated}
        />
      )}

      {showImportModal && (
        <DataImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImportComplete={() => {
            fetchHabits();
            fetchHabitLogs();
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {habitToDelete && (
        <div className="fixed inset-0 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-sm max-w-md w-full mx-4 shadow-lg border border-gray-300">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Delete Habit</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this habit? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={cancelDelete}
                className="rounded-sm px-3 py-1.5 text-sm hover:bg-white focus:bg-white"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleDeleteHabit(habitToDelete)}
                disabled={deletingHabit === habitToDelete}
                className="rounded-sm bg-black text-white px-3 py-1.5 text-sm"
              >
                {deletingHabit === habitToDelete ? (
                  <Spinner className="w-4 h-4" />
                ) : (
                  'Delete'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
