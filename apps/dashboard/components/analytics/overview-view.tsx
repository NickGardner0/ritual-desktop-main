/**
 * OverviewView - Dashboard/Index content extracted for unified Analytics page
 * 
 * Displays habits in a clean list format with totals and stats.
 * Designed to work with shared filter context or standalone.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Download } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { isWithinInterval, parseISO, format, startOfDay, endOfDay, subDays } from 'date-fns';
import { Spinner } from "@/components/ui/kibo-ui/spinner";
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import { analyticsApi, type HabitStats } from '@/lib/services/analytics-api';
import { HistoryScrubber } from '@/components/history-scrubber';
import { Button } from "@/components/ui/button";
import type { Habit } from '@/contexts/HabitsContext';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';
import { isComputerHabitName } from '@/lib/computer-time-habit';
import { normalizeComputerDailySummaryRow } from '@/lib/computerActivity/normalize';
import { getComputerTimeDaily } from '@/lib/computerActivity/client';

const DateRangePicker = dynamic(
  () => import("@/components/date-range-picker").then(m => ({ default: m.DateRangePicker })),
  { ssr: false }
);

const HabitSelectionModal = dynamic(
  () => import("@/components/habit-selection-modal").then(m => ({ default: m.HabitSelectionModal })),
  { ssr: false }
);

const DataImportModal = dynamic(
  () => import("@/components/data-import-modal").then(m => ({ default: m.DataImportModal })),
  { ssr: false }
);

const SortableHabitList = dynamic(
  () => import('./sortable-habit-list').then(m => ({ default: m.SortableHabitList })),
  { ssr: false }
);

interface ComputerDailyRow {
  day: string;
  active_hours: number;
  active_ms: number;
  events_count: number;
}

const OVERVIEW_STATS_CACHE_VERSION = 'v2';
const OVERVIEW_STATS_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 12;

function readOverviewStatsCache(cacheKey: string | null): Record<string, HabitStats> {
  if (typeof window === 'undefined' || !cacheKey) return {};

  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as {
      timestamp?: number;
      stats?: Record<string, HabitStats>;
    };

    if (!parsed?.stats) return {};
    if (parsed.timestamp && Date.now() - parsed.timestamp > OVERVIEW_STATS_CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(cacheKey);
      return {};
    }

    return parsed.stats;
  } catch (cacheError) {
    console.warn('Failed to restore overview stats cache:', cacheError);
    return {};
  }
}

function readOverviewComputerCache(cacheKey: string | null): ComputerDailyRow[] {
  if (typeof window === 'undefined' || !cacheKey) return [];

  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as {
      timestamp?: number;
      rows?: ComputerDailyRow[];
    };

    if (!parsed?.rows) return [];
    if (parsed.timestamp && Date.now() - parsed.timestamp > OVERVIEW_STATS_CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(cacheKey);
      return [];
    }

    return parsed.rows
      .map(normalizeComputerDailySummaryRow)
      .filter((row): row is ComputerDailyRow => Boolean(row));
  } catch (cacheError) {
    console.warn('Failed to restore overview computer cache:', cacheError);
    return [];
  }
}

interface OverviewViewProps {
  // Optional: Allow passing in external filter state for standalone use
  externalDateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  // Hide controls when used inside unified page (controls are in parent)
  hideControls?: boolean;
}

export function OverviewView({ 
  externalDateRange, 
  onDateRangeChange,
  hideControls = false 
}: OverviewViewProps) {
  const { user, isLoaded: userLoaded, isSignedIn } = useUser();
  const { isLoaded, getToken } = useAuth();
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

  // Cached stats from Python analytics API
  const [cachedStats, setCachedStats] = useState<Record<string, HabitStats>>({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsResolved, setStatsResolved] = useState(false);

  // History scrubber state
  const [scrubberHoveredDate, setScrubberHoveredDate] = useState<string | null>(null);
  const [scrubberHoveredValues, setScrubberHoveredValues] = useState<Record<string, number> | null>(null);
  const [scrubberSelectedDate, setScrubberSelectedDate] = useState<string | null>(null);
  const [computerActivityDaily, setComputerActivityDaily] = useState<ComputerDailyRow[]>([]);
  const [computerActivityResolved, setComputerActivityResolved] = useState(false);
  const isBackendUnavailable = habits.length === 0 && !isLoading && Boolean(error);

  const overviewStatsCacheKey = useMemo(() => {
    if (!user?.id) return null;
    return `ritual:overview-stats:${OVERVIEW_STATS_CACHE_VERSION}:${user.id}:all-time`;
  }, [user?.id]);

  const overviewComputerCacheKey = useMemo(() => {
    if (!user?.id) return null;
    return `ritual:overview-computer:${OVERVIEW_STATS_CACHE_VERSION}:${user.id}:all-time`;
  }, [user?.id]);

  const bootstrappedCachedStats = useMemo(
    () => (dateRange?.from ? {} : readOverviewStatsCache(overviewStatsCacheKey)),
    [dateRange?.from, overviewStatsCacheKey],
  );

  const bootstrappedComputerActivityDaily = useMemo(
    () => (dateRange?.from ? [] : readOverviewComputerCache(overviewComputerCacheKey)),
    [dateRange?.from, overviewComputerCacheKey],
  );

  const effectiveCachedStats = useMemo(() => {
    if (statsResolved || Object.keys(cachedStats).length > 0) {
      return cachedStats;
    }
    return bootstrappedCachedStats;
  }, [bootstrappedCachedStats, cachedStats, statsResolved]);

  const effectiveComputerActivityDaily = useMemo(() => {
    if (computerActivityResolved || computerActivityDaily.length > 0) {
      return computerActivityDaily;
    }
    return bootstrappedComputerActivityDaily;
  }, [
    bootstrappedComputerActivityDaily,
    computerActivityDaily,
    computerActivityResolved,
  ]);

  const handleScrubberHover = useCallback((date: string | null, values: Record<string, number> | null) => {
    setScrubberHoveredDate(date);
    setScrubberHoveredValues(values);
  }, []);

  const handleScrubberSelect = useCallback((date: string | null) => {
    setScrubberSelectedDate(date);
    if (date) {
      const selectedDateObj = parseISO(date);
      setDateRange({ from: selectedDateObj, to: selectedDateObj });
    } else {
      setDateRange(undefined);
    }
  }, [setDateRange]);

  const displayLogs = useMemo(() => {
    return [...habitLogs, ...optimisticLogs];
  }, [habitLogs, optimisticLogs]);

  const getLogLocalDate = useCallback((log: { date?: string; completed_at?: string }) => {
    if (log.completed_at) {
      const completedAt = parseISO(log.completed_at);
      if (!Number.isNaN(completedAt.getTime())) {
        return format(completedAt, 'yyyy-MM-dd');
      }
    }

    return typeof log.date === 'string' ? log.date.split('T')[0] : '';
  }, []);

  useEffect(() => {
    if (dateRange?.from) return;
    if (!overviewStatsCacheKey) return;

    const restored = readOverviewStatsCache(overviewStatsCacheKey);
    if (Object.keys(restored).length > 0) {
      setCachedStats(restored);
    }
  }, [dateRange?.from, overviewStatsCacheKey]);

  // Clear cached stats when date range changes so stale all-time data
  // doesn't display while the date-filtered API call is in flight
  useEffect(() => {
    if (!dateRange?.from) return;
    setCachedStats({});
    setStatsResolved(false);
  }, [dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]);

  useEffect(() => {
    if (dateRange?.from) return;
    if (!overviewComputerCacheKey) return;

    const restored = readOverviewComputerCache(overviewComputerCacheKey);
    if (restored.length > 0) {
      setComputerActivityDaily(restored);
    }
  }, [dateRange?.from, overviewComputerCacheKey]);

  // Fetch stats from Python analytics API
  useEffect(() => {
    const fetchStats = async () => {
      if (!habits.length) return;

      try {
        setStatsResolved(false);
        setStatsLoading(true);
        const token = await getToken();
        if (!token) return;

        const params: { startDate?: string; endDate?: string; daysBack?: number } = {};
        if (dateRange?.from) {
          params.startDate = format(dateRange.from, 'yyyy-MM-dd');
          if (dateRange.to) {
            params.endDate = format(dateRange.to, 'yyyy-MM-dd');
          } else {
            params.endDate = params.startDate;
          }
        } else {
          // Cap "All time" to 3 years — 36500 days (~100 years) was causing very slow loads
          params.daysBack = 1095;
        }

        const result = await analyticsApi.getHabitStats(token, params);

        if (result.success && result.habits) {
          const statsMap: Record<string, HabitStats> = {};
          result.habits.forEach(stat => {
            statsMap[stat.id] = stat;
          });
          setCachedStats(statsMap);

          if (typeof window !== 'undefined' && !dateRange?.from && overviewStatsCacheKey) {
            window.localStorage.setItem(
              overviewStatsCacheKey,
              JSON.stringify({
                timestamp: Date.now(),
                stats: statsMap,
              }),
            );
          }
        }
      } catch (error) {
        console.error('❌ Failed to fetch stats from Python API:', error);
      } finally {
        setStatsLoading(false);
        setStatsResolved(true);
      }
    };

    fetchStats();
  }, [habits, habitLogs.length, dateRange, getToken]);

  useEffect(() => {
    if (!userLoaded || !isSignedIn || !user) return;

    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    const fetchComputerActivity = async () => {
      try {
        setComputerActivityResolved(false);
        const now = new Date();
        // When "All time" (dateRange undefined), use 3-year range like habit stats
        let startDate: string;
        let endDate: string;
        if (dateRange?.from) {
          startDate = format(dateRange.from, 'yyyy-MM-dd');
          endDate = format(dateRange.to ?? dateRange.from, 'yyyy-MM-dd');
        } else {
          startDate = format(subDays(now, 180), 'yyyy-MM-dd');
          endDate = format(now, 'yyyy-MM-dd');
        }

        const rows = await getComputerTimeDaily({
          startDate,
          endDate,
        });
        if (controller.signal.aborted) return;

        setComputerActivityDaily(rows);

        if (typeof window !== 'undefined' && !dateRange?.from && overviewComputerCacheKey) {
          window.localStorage.setItem(
            overviewComputerCacheKey,
            JSON.stringify({
              timestamp: Date.now(),
              rows,
            }),
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('❌ Failed loading overview computer activity:', error);
        setComputerActivityDaily([]);
      } finally {
        if (!controller.signal.aborted) {
          setComputerActivityResolved(true);
        }
      }
    };

    fetchComputerActivity();
    refreshTimer = setInterval(fetchComputerActivity, 60_000);
    return () => {
      controller.abort();
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
    };
  }, [dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), overviewComputerCacheKey, userLoaded, isSignedIn, user]);

  // Initialize ordered habits
  useEffect(() => {
    if (habits.length > 0) {
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

  // Load habit logs on mount
  const hasLoadedLogs = useRef(false);
  useEffect(() => {
    if (user && !isLoading && habitLogs.length === 0 && !hasLoadedLogs.current) {
      hasLoadedLogs.current = true;
      fetchHabitLogs();
    }
  }, [user, isLoading, fetchHabitLogs]);

  // Force fetch logs when habits are loaded
  useEffect(() => {
    if (habits.length > 0 && habitLogs.length === 0 && user) {
      fetchHabitLogs();
    }
  }, [habits.length, habitLogs.length, user, fetchHabitLogs]);

  useEffect(() => {
    if (!user || !isBackendUnavailable) return;

    const retryTimer = setInterval(() => {
      fetchHabits();
      fetchHabitLogs();
    }, 8_000);

    return () => clearInterval(retryTimer);
  }, [user, isBackendUnavailable, fetchHabits, fetchHabitLogs]);

  // Get display text for habit metrics
  const getHabitMetricDisplay = useCallback((habit: Habit, previewValue?: number | null): string => {
    const unitType = habit.unit_type || 'sessions';
    const isComputerHabit = isComputerHabitName(habit.name);
    const cachedHabitStats = effectiveCachedStats[habit.id || ''];

    if (isComputerHabit) {
      const totalHours = Math.round(
        effectiveComputerActivityDaily.reduce((sum, row) => sum + Number(row.active_hours || 0), 0) * 100
      ) / 100;

      // The history scrubber is derived from habit logs and does not include
      // local desktop watcher data. When the computer habit is displayed, use
      // the local watcher rows directly for hovered dates and otherwise fall
      // back to the real desktop total instead of showing an unrelated 0-hour
      // habit-log preview.
      if (scrubberHoveredDate) {
        const hoveredRow = effectiveComputerActivityDaily.find((row) => row.day === scrubberHoveredDate);
        if (hoveredRow) {
          const hoveredHours = Math.round(Number(hoveredRow.active_hours || 0) * 100) / 100;
          return `${hoveredHours} Hours`;
        }
      }

      return `${totalHours} Hours`;
    }
    
    if (previewValue !== undefined && previewValue !== null) {
      if (unitType.toLowerCase().includes('hour')) {
        const hours = Math.round((previewValue / 60) * 100) / 100;
        return `${hours} Hours`;
      } else if (unitType.toLowerCase().includes('minute')) {
        return `${Math.round(previewValue)} Minutes`;
      }
      
      const unitLower = unitType.toLowerCase();
      let formattedAmount: string;
      
      if (['bpm', 'steps', 'count', 'pages', 'reps', 'sets', 'sessions'].includes(unitLower)) {
        formattedAmount = Math.round(previewValue).toString();
      } else if (['miles', 'km', 'kilometers'].includes(unitLower)) {
        formattedAmount = previewValue.toFixed(1);
      } else {
        formattedAmount = Number.isInteger(previewValue) 
          ? previewValue.toString() 
          : (Math.round(previewValue * 100) / 100).toString();
      }
      
      return `${formattedAmount} ${unitType}`;
    }

    if (cachedHabitStats && !scrubberHoveredDate) {
      const totalAmount = cachedHabitStats.total || 0;
      const unitLower = unitType.toLowerCase();
      let formattedAmount: string;

      if (['bpm', 'steps', 'count', 'pages', 'reps', 'sets', 'sessions'].includes(unitLower)) {
        formattedAmount = Math.round(totalAmount).toString();
      } else if (['miles', 'km', 'kilometers'].includes(unitLower)) {
        formattedAmount = totalAmount.toFixed(1);
      } else if (['hours', 'minutes'].includes(unitLower)) {
        formattedAmount = (Math.round(totalAmount * 100) / 100).toString();
      } else {
        formattedAmount = Number.isInteger(totalAmount)
          ? totalAmount.toString()
          : (Math.round(totalAmount * 100) / 100).toString();
      }

      return `${formattedAmount} ${unitType}`;
    }

    let filteredLogs = displayLogs.filter(log => {
      const matchesHabit = log.habit_id === habit.id;
      const isCompleted = log.status === 'completed' || (log.status as any) === 'success' || !log.status;
      return matchesHabit && isCompleted;
    });

    if (dateRange?.from) {
      filteredLogs = filteredLogs.filter(log => {
        const localDate = getLogLocalDate(log);
        if (!localDate) return false;

        const logDate = parseISO(localDate);
        if (Number.isNaN(logDate.getTime())) {
          return false;
        }

        if (dateRange.to) {
          return isWithinInterval(logDate, {
            start: startOfDay(dateRange.from!),
            end: endOfDay(dateRange.to),
          });
        }

        const filterDateStr = format(dateRange.from!, 'yyyy-MM-dd');
        return localDate === filterDateStr;
      });
    }

    if (filteredLogs.length === 0) {
      return `0 ${unitType}`;
    }

    if (unitType.toLowerCase().includes('hour') || unitType.toLowerCase().includes('minute')) {
      const totalDurationSeconds = filteredLogs.reduce((sum, log) => {
        if (log.duration && log.duration > 0) {
          return sum + log.duration;
        } else if (log.amount && log.amount > 0) {
          if (unitType.toLowerCase().includes('hour')) {
            return sum + (log.amount * 3600);
          } else if (unitType.toLowerCase().includes('minute')) {
            return sum + (log.amount * 60);
          } else {
            return sum + log.amount;
          }
        }
        return sum;
      }, 0);

      if (unitType.toLowerCase().includes('hour')) {
        const totalHours = Math.round((totalDurationSeconds / 3600) * 100) / 100;
        return `${totalHours} Hours`;
      } else {
        const totalMinutes = Math.round(totalDurationSeconds / 60);
        return `${totalMinutes} Minutes`;
      }
    }

    const totalAmount = filteredLogs.reduce((sum, log) => sum + (log.amount || 1), 0);
    const unitLower = unitType.toLowerCase();
    let formattedAmount: string;
    
    if (['bpm', 'steps', 'count', 'pages', 'reps', 'sets', 'sessions'].includes(unitLower)) {
      formattedAmount = Math.round(totalAmount).toString();
    } else if (['miles', 'km', 'kilometers'].includes(unitLower)) {
      formattedAmount = totalAmount.toFixed(1);
    } else if (['hours', 'minutes'].includes(unitLower)) {
      formattedAmount = (Math.round(totalAmount * 100) / 100).toString();
    } else {
      formattedAmount = Number.isInteger(totalAmount) 
        ? totalAmount.toString() 
        : (Math.round(totalAmount * 100) / 100).toString();
    }
    
    return `${formattedAmount} ${unitType}`;
  }, [
    effectiveCachedStats,
    displayLogs,
    dateRange,
    effectiveComputerActivityDaily,
    getLogLocalDate,
    scrubberHoveredDate,
  ]);

  const getHabitMetricClassName = useCallback(() => 'text-gray-900', []);

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

  const getLocalHabitStats = useCallback((habit: Habit) => {
    const unitLabel = habit.unit_type || 'sessions';
    const unitLower = unitLabel.toLowerCase();
    const isHourBased = unitLower.includes('hour');
    const isMinuteBased = unitLower.includes('minute');
    const useMaxPerDay = isSleepLikeHabit(habit);

    const filteredLogs = displayLogs.filter(log => {
      const matchesHabit = log.habit_id === habit.id;
      const isCompleted = log.status === 'completed' || (log.status as any) === 'success' || !log.status;
      if (!matchesHabit || !isCompleted) return false;

      if (!dateRange?.from) return true;

      const localDate = getLogLocalDate(log);
      if (!localDate) return false;

      const logDate = parseISO(localDate);
      if (Number.isNaN(logDate.getTime())) return false;

      if (dateRange.to) {
        return isWithinInterval(logDate, {
          start: startOfDay(dateRange.from),
          end: endOfDay(dateRange.to),
        });
      }

      return localDate === format(dateRange.from, 'yyyy-MM-dd');
    });

    const dailyValues = new Map<string, number>();

    filteredLogs.forEach((log) => {
      const localDate = getLogLocalDate(log);
      if (!localDate) return;

      let numericValue = 0;

      if (typeof log.duration === 'number' && Number.isFinite(log.duration) && log.duration > 0) {
        if (isHourBased) {
          numericValue = log.duration / 3600;
        } else if (isMinuteBased) {
          numericValue = log.duration / 60;
        } else {
          numericValue = log.duration;
        }
      } else if (typeof log.amount === 'number' && Number.isFinite(log.amount)) {
        numericValue = log.amount;
      } else {
        numericValue = 1;
      }

      const previousValue = dailyValues.get(localDate) || 0;
      dailyValues.set(localDate, useMaxPerDay ? Math.max(previousValue, numericValue) : previousValue + numericValue);
    });

    const values = Array.from(dailyValues.values()).filter((value) => Number.isFinite(value));
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = values.length ? total / values.length : 0;
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const variance = values.length
      ? values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / values.length
      : 0;

    return {
      unitLabel,
      sumFormatted: `${formatHabitStatNumber(total)} ${unitLabel}`,
      avgFormatted: `${formatHabitStatNumber(average)} ${unitLabel}`,
      minFormatted: `${formatHabitStatNumber(min)} ${unitLabel}`,
      maxFormatted: `${formatHabitStatNumber(max)} ${unitLabel}`,
      stdDevFormatted: `${formatHabitStatNumber(Math.sqrt(variance))} ${unitLabel}`,
      daysWithData: values.filter((value) => value > 0).length,
    };
  }, [dateRange, displayLogs, formatHabitStatNumber, getLogLocalDate, isSleepLikeHabit]);

  // Detailed stats for tooltip
  const getHabitMetricStats = useCallback((habit: Habit) => {
    if (isComputerHabitName(habit.name)) {
      const rows = effectiveComputerActivityDaily;
      const values = rows.map(row => Number(row.active_hours || 0)).filter(value => Number.isFinite(value) && value >= 0);
      const total = values.reduce((sum, value) => sum + value, 0);
      const average = values.length ? total / values.length : 0;
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      const variance = values.length
        ? values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / values.length
        : 0;
      return {
        unitLabel: 'Hours',
        sumFormatted: `${formatHabitStatNumber(total)} Hours`,
        avgFormatted: `${formatHabitStatNumber(average)} Hours`,
        minFormatted: `${formatHabitStatNumber(min)} Hours`,
        maxFormatted: `${formatHabitStatNumber(max)} Hours`,
        stdDevFormatted: `${formatHabitStatNumber(Math.sqrt(variance))} Hours`,
        daysWithData: values.filter(value => value > 0).length,
      };
    }

    const stats = effectiveCachedStats[habit.id || ''];

    if (stats) {
      const unitLabel = stats.unit || habit.unit_type || 'sessions';
      return {
        unitLabel,
        sumFormatted: `${formatHabitStatNumber(stats.total)} ${unitLabel}`,
        avgFormatted: `${formatHabitStatNumber(stats.average)} ${unitLabel}`,
        minFormatted: `${formatHabitStatNumber(stats.min)} ${unitLabel}`,
        maxFormatted: `${formatHabitStatNumber(stats.max)} ${unitLabel}`,
        stdDevFormatted: `${formatHabitStatNumber(stats.std_dev || Math.sqrt(stats.variance || 0))} ${unitLabel}`,
        daysWithData: stats.days_with_data,
      };
    }

    return getLocalHabitStats(habit);
  }, [effectiveCachedStats, effectiveComputerActivityDaily, formatHabitStatNumber, getLocalHabitStats]);

  const handleHabitCreated = useCallback(async (newHabit: Habit) => {
    try {
      await fetchHabits();
    } catch (error) {
      console.error('❌ Error refreshing habits list:', error);
    }
  }, [fetchHabits]);

  const confirmDelete = (habitId: string | undefined) => {
    if (!habitId) return;
    setHabitToDelete(habitId);
  };

  const cancelDelete = () => {
    setHabitToDelete(null);
  };

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

  // Show spinner while loading
  if (isLoading || !isLoaded || !user) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Header with controls - only show if not hidden */}
      {!hideControls && (
        <div className="relative flex items-center justify-end h-14">
          {/* History Scrubber - centered */}
          {habits.length > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 w-[500px]">
              <HistoryScrubber
                habitLogs={displayLogs}
                habits={orderedHabits}
                daysToShow={90}
                onHoverDate={handleScrubberHover}
                onSelectDate={handleScrubberSelect}
                selectedDate={scrubberSelectedDate}
              />
            </div>
          )}
          
          <div className="flex items-center space-x-1 relative z-10">
            {/* Add Habit button */}
            <div className="relative group">
              <button
                onClick={() => setShowSelectionModal(true)}
                className="h-9 px-3 py-2 border border-gray-300 bg-white text-black hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors rounded-sm flex items-center justify-center"
                aria-label="Add Habit"
              >
                <Plus className="w-4 h-4" />
              </button>
              <div className="absolute top-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                Add
              </div>
            </div>

            {/* Import button */}
            <div className="relative group">
              <button
                onClick={() => setShowImportModal(true)}
                className="h-9 px-3 py-2 border border-gray-300 bg-white text-black hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors rounded-sm flex items-center justify-center"
                aria-label="Import Data"
              >
                <Download className="w-4 h-4" />
              </button>
              <div className="absolute top-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                Import
              </div>
            </div>

            {/* Date Range Picker */}
            <DateRangePicker
              className="w-auto"
              onDateRangeChange={setDateRange}
              initialDateRange={dateRange}
            />
          </div>
        </div>
      )}

      {/* Habits List */}
      <div className="pt-6">
        <div className="max-w-[500px] mx-auto w-full">
          <SortableHabitList
            habits={orderedHabits}
            onReorder={handleReorder}
            getHabitMetricDisplay={getHabitMetricDisplay}
            getHabitMetricClassName={getHabitMetricClassName}
            scrubberHoveredDate={scrubberHoveredDate}
            scrubberHoveredValues={scrubberHoveredValues}
            activeTooltip={activeTooltip}
            setActiveTooltip={setActiveTooltip}
            getHabitMetricStats={getHabitMetricStats}
            confirmDelete={confirmDelete}
            deletingHabit={deletingHabit}
          />
        </div>
      </div>

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
            behavioral trends, and getting a holistic view of your life.
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
                className="rounded-sm px-3 py-1.5 text-sm hover:bg-[#F3F3F3] focus:bg-[#F3F3F3]"
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
