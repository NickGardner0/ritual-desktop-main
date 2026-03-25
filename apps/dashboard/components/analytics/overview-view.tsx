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
import { isTauri } from '@/lib/tauri-utils';
import { invokeDailySummariesWithInitRetry } from '@/lib/computerActivity/tauri-activity';
import { normalizeComputerDailySummaryRow } from '@/lib/computerActivity/normalize';

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

function getTauriBridgeState() {
  if (typeof window === 'undefined') {
    return { tauriGlobal: false, tauriIpc: false };
  }
  const w = window as Window & { __TAURI__?: unknown; __TAURI_IPC__?: unknown };
  return {
    tauriGlobal: Boolean(w.__TAURI__),
    tauriIpc: typeof w.__TAURI_IPC__ === 'function',
  };
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

  // History scrubber state
  const [scrubberHoveredDate, setScrubberHoveredDate] = useState<string | null>(null);
  const [scrubberHoveredValues, setScrubberHoveredValues] = useState<Record<string, number> | null>(null);
  const [scrubberSelectedDate, setScrubberSelectedDate] = useState<string | null>(null);
  const [computerActivityDaily, setComputerActivityDaily] = useState<ComputerDailyRow[]>([]);
  const isBackendUnavailable = habits.length === 0 && !isLoading && Boolean(error);
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

  // Fetch stats from Python analytics API
  useEffect(() => {
    const fetchStats = async () => {
      if (!habits.length) return;

      try {
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
        }
      } catch (error) {
        console.error('❌ Failed to fetch stats from Python API:', error);
      } finally {
        setStatsLoading(false);
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

        if (isTauri()) {
          console.log('[Overview] isTauri()=true, attempting Tauri invoke for daily summaries…');
          const bridgeState = getTauriBridgeState();
          console.log(`[Overview] Bridge state: __TAURI__=${bridgeState.tauriGlobal}, __TAURI_IPC__=${bridgeState.tauriIpc}`);
          try {
            const summaries = await invokeDailySummariesWithInitRetry(startDate, endDate);
            console.log(`[Overview] Tauri invoke succeeded: ${summaries.length} summaries returned`);

            if (controller.signal.aborted) return;

            const rows = summaries
              .map(normalizeComputerDailySummaryRow)
              .filter((row): row is ComputerDailyRow => Boolean(row));

            setComputerActivityDaily(rows);
            return;
          } catch (tauriError) {
            console.error('[Overview] Tauri invoke FAILED — IPC bridge likely unavailable on remote URL:', tauriError);
            console.log('[Overview] Falling through to HTTP fetch…');
          }
        }

        const query = `start_date=${startDate}&end_date=${endDate}`;
        const res = await fetch(`/api/watcher/stats/daily?${query}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) {
          // Gracefully degrade: show empty data instead of throwing. Common after app
          // restart when backend may not be ready yet or auth is still settling.
          console.warn('Computer activity API returned', res.status, await res.text().catch(() => ''));
          setComputerActivityDaily([]);
          return;
        }
        const payload = await res.json();
        if (controller.signal.aborted) return;
        const rows = (payload?.data || [])
          .map(normalizeComputerDailySummaryRow)
          .filter((row: ComputerDailyRow) => row.day);
        setComputerActivityDaily(rows);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('❌ Failed loading overview computer activity:', error);
        setComputerActivityDaily([]);
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
  }, [dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), userLoaded, isSignedIn, user]);

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

    if (isComputerHabit) {
      const totalHours = Math.round(
        computerActivityDaily.reduce((sum, row) => sum + Number(row.active_hours || 0), 0) * 100
      ) / 100;

      // The history scrubber is derived from habit logs and does not include
      // local desktop watcher data. When the computer habit is displayed, use
      // the local watcher rows directly for hovered dates and otherwise fall
      // back to the real desktop total instead of showing an unrelated 0-hour
      // habit-log preview.
      if (scrubberHoveredDate) {
        const hoveredRow = computerActivityDaily.find((row) => row.day === scrubberHoveredDate);
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

    let filteredLogs = displayLogs.filter(log => {
      const matchesHabit = log.habit_id === habit.id;
      const isCompleted = log.status === 'completed' || (log.status as any) === 'success' || !log.status;
      return matchesHabit && isCompleted;
    });

    if (dateRange?.from) {
      filteredLogs = filteredLogs.filter(log => {
        const logDate = parseISO(log.date);
        let isInRange = false;

        if (dateRange.to) {
          isInRange = isWithinInterval(logDate, {
            start: startOfDay(dateRange.from!),
            end: endOfDay(dateRange.to),
          });
        } else {
          const filterDateStr = dateRange.from!.toLocaleDateString('en-CA');
          const logDateStr = typeof log.date === 'string' ? log.date.split('T')[0] : '';
          isInRange = logDateStr === filterDateStr;
        }

        return isInRange;
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
  }, [displayLogs, dateRange, computerActivityDaily, scrubberHoveredDate]);

  const getHabitMetricClassName = useCallback(() => 'text-gray-900', []);

  // Detailed stats for tooltip
  const getHabitMetricStats = useCallback((habit: Habit) => {
    const formatNum = (n: number) => {
      const rounded = Math.round(n * 100) / 100;
      return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
    };

    if (isComputerHabitName(habit.name)) {
      const rows = computerActivityDaily;
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
        sumFormatted: `${formatNum(total)} Hours`,
        avgFormatted: `${formatNum(average)} Hours`,
        minFormatted: `${formatNum(min)} Hours`,
        maxFormatted: `${formatNum(max)} Hours`,
        stdDevFormatted: `${formatNum(Math.sqrt(variance))} Hours`,
        daysWithData: values.filter(value => value > 0).length,
      };
    }

    const stats = cachedStats[habit.id || ''];

    if (stats) {
      const unitLabel = stats.unit || habit.unit_type || 'sessions';
      return {
        unitLabel,
        sumFormatted: `${formatNum(stats.total)} ${unitLabel}`,
        avgFormatted: `${formatNum(stats.average)} ${unitLabel}`,
        minFormatted: `${formatNum(stats.min)} ${unitLabel}`,
        maxFormatted: `${formatNum(stats.max)} ${unitLabel}`,
        stdDevFormatted: `${formatNum(stats.std_dev || Math.sqrt(stats.variance || 0))} ${unitLabel}`,
        daysWithData: stats.days_with_data,
      };
    }

    const unitLabel = habit.unit_type || 'sessions';
    if (statsLoading) {
      return {
        unitLabel,
        sumFormatted: `Loading...`,
        avgFormatted: `Loading...`,
        minFormatted: `Loading...`,
        maxFormatted: `Loading...`,
        stdDevFormatted: `Loading...`,
      };
    }

    return {
      unitLabel,
      sumFormatted: `0 ${unitLabel}`,
      avgFormatted: `0 ${unitLabel}`,
      minFormatted: `0 ${unitLabel}`,
      maxFormatted: `0 ${unitLabel}`,
      stdDevFormatted: `0 ${unitLabel}`,
    };
  }, [cachedStats, statsLoading, computerActivityDaily]);

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
