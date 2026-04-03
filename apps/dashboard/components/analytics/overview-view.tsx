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
import { isWithinInterval, parseISO, format, startOfDay, endOfDay, subDays } from 'date-fns';
import * as Sentry from '@sentry/nextjs';
import { Spinner } from "@/components/ui/kibo-ui/spinner";
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import { analyticsApi, type HabitStats } from '@/lib/services/analytics-api';
import { Button } from "@/components/ui/button";
import type { Habit } from '@/contexts/HabitsContext';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';
import { isComputerHabitName } from '@/lib/computer-time-habit';
import { normalizeComputerDailySummaryRow } from '@/lib/computerActivity/normalize';
import { getComputerTimeDaily, getComputerTimeSummary } from '@/lib/computerActivity/client';
import { auditLocalStorage, perfError, perfInfo, startPerfTimer } from '@/lib/perf-debug';
import { isTauri } from '@/lib/tauri-utils';
import { OverviewInitialSection } from '@/components/analytics/overview-initial-section';

const HabitSelectionModal = dynamic(
  () => import("@/components/habit-selection-modal").then(m => ({ default: m.HabitSelectionModal })),
  { ssr: false }
);

const DataImportModal = dynamic(
  () => import("@/components/data-import-modal").then(m => ({ default: m.DataImportModal })),
  { ssr: false }
);


interface ComputerDailyRow {
  day: string;
  active_hours: number;
  active_ms: number;
  events_count: number;
}

interface ComputerSummaryState {
  total_active_ms: number;
  total_hours: number;
  total_events?: number;
  days_tracked?: number;
  avg_daily_hours?: number;
}

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
}

interface HabitMetricData {
  display: string;
  stats: HabitMetricStatsData;
}

const OVERVIEW_STATS_CACHE_VERSION = 'v3';
const OVERVIEW_STATS_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 12;
const EMPTY_OVERVIEW_LOGS: any[] = [];

function formatMetricAmount(value: number, unitType: string): string {
  const rounded = Math.round(value * 100) / 100;
  const unitLower = unitType.toLowerCase();

  if (['bpm', 'steps', 'count', 'pages', 'reps', 'sets', 'sessions'].includes(unitLower)) {
    return Math.round(rounded).toString();
  }

  if (['miles', 'km', 'kilometers'].includes(unitLower)) {
    return rounded.toFixed(1);
  }

  if (['hours', 'minutes'].includes(unitLower)) {
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return Number.isInteger(rounded)
    ? rounded.toString()
    : rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMetricDisplay(value: number, unitType: string): string {
  return `${formatMetricAmount(value, unitType)} ${unitType}`;
}

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

function readOverviewComputerSummaryCache(cacheKey: string | null): ComputerSummaryState | null {
  if (typeof window === 'undefined' || !cacheKey) return null;

  try {
    const raw = window.localStorage.getItem(`${cacheKey}:summary`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      timestamp?: number;
      summary?: ComputerSummaryState | null;
    };

    if (!parsed?.summary) return null;
    if (parsed.timestamp && Date.now() - parsed.timestamp > OVERVIEW_STATS_CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(`${cacheKey}:summary`);
      return null;
    }

    return parsed.summary;
  } catch (cacheError) {
    console.warn('Failed to restore overview computer summary cache:', cacheError);
    return null;
  }
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
  const hasInitialOverviewStats = Boolean(initialOverviewStats && Object.keys(initialOverviewStats).length > 0);
  const skippedInitialStatsFetchRef = useRef(false);
  const [cachedStats, setCachedStats] = useState<Record<string, HabitStats>>(initialOverviewStats ?? {});
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsResolved, setStatsResolved] = useState(hasInitialOverviewStats);

  // History scrubber state
  const [scrubberHoveredDate, setScrubberHoveredDate] = useState<string | null>(null);
  const [scrubberHoveredValues, setScrubberHoveredValues] = useState<Record<string, number> | null>(null);
  const [scrubberSelectedDate, setScrubberSelectedDate] = useState<string | null>(null);
  const [computerActivityDaily, setComputerActivityDaily] = useState<ComputerDailyRow[]>([]);
  const [computerActivityResolved, setComputerActivityResolved] = useState(false);
  const [computerActivitySummary, setComputerActivitySummary] = useState<ComputerSummaryState | null>(null);
  const lastGoodComputerActivityRef = useRef<ComputerDailyRow[]>([]);
  const firstUsablePaintLoggedRef = useRef(false);
  const mountTimeRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const isBackendUnavailable = habits.length === 0 && !isLoading && Boolean(error);

  const overviewStatsCacheKey = useMemo(() => {
    if (!user?.id) return null;
    return `ritual:overview-stats:${OVERVIEW_STATS_CACHE_VERSION}:${user.id}:all-time`;
  }, [user?.id]);

  const overviewComputerCacheKey = useMemo(() => {
    if (!user?.id) return null;
    return `ritual:overview-computer:${OVERVIEW_STATS_CACHE_VERSION}:${user.id}:all-time`;
  }, [user?.id]);

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

  const bootstrappedCachedStats = useMemo(
    () => (dateRange?.from ? {} : readOverviewStatsCache(overviewStatsCacheKey)),
    [dateRange?.from, overviewStatsCacheKey],
  );

  const bootstrappedComputerActivityDaily = useMemo(
    () => (dateRange?.from ? [] : readOverviewComputerCache(overviewComputerCacheKey)),
    [dateRange?.from, overviewComputerCacheKey],
  );

  const bootstrappedComputerActivitySummary = useMemo(
    () => (dateRange?.from ? null : readOverviewComputerSummaryCache(overviewComputerCacheKey)),
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
  }, []);

  const displayLogs = useMemo(() => {
    return [...habitLogs, ...optimisticLogs];
  }, [habitLogs, optimisticLogs]);

  const scrubberDisplayLogs = useMemo(
    () => (isDesktopShell ? EMPTY_OVERVIEW_LOGS : displayLogs),
    [displayLogs, isDesktopShell],
  );

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
    if (process.env.NODE_ENV === 'production') return;
    auditLocalStorage(
      'overview-view',
      [overviewStatsCacheKey, overviewComputerCacheKey, 'ritual:react-query-cache:v1'].filter(
        (key): key is string => Boolean(key),
      ),
    );
  }, [overviewComputerCacheKey, overviewStatsCacheKey]);

  // Clear cached stats when date range changes so stale all-time data
  // doesn't display while the date-filtered API call is in flight
  useEffect(() => {
    if (!dateRange?.from) return;
    setCachedStats({});
    setStatsResolved(false);
  }, [dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]);

  useEffect(() => {
    if (dateRange?.from) return;
    if (computerActivityDaily.length > 0) return;
    if (bootstrappedComputerActivityDaily.length > 0) {
      perfInfo('overview-view', 'restore-computer-cache', {
        cache_key: overviewComputerCacheKey,
        row_count: bootstrappedComputerActivityDaily.length,
      });
      setComputerActivityDaily(bootstrappedComputerActivityDaily);
      lastGoodComputerActivityRef.current = bootstrappedComputerActivityDaily;
    }
  }, [bootstrappedComputerActivityDaily, computerActivityDaily.length, dateRange?.from, overviewComputerCacheKey]);

  useEffect(() => {
    if (dateRange?.from) return;
    if (computerActivitySummary) return;
    if (bootstrappedComputerActivitySummary) {
      perfInfo('overview-view', 'restore-computer-summary-cache', {
        cache_key: overviewComputerCacheKey,
        total_active_ms: Number(bootstrappedComputerActivitySummary.total_active_ms || 0),
      });
      setComputerActivitySummary(bootstrappedComputerActivitySummary);
    }
  }, [bootstrappedComputerActivitySummary, computerActivitySummary, dateRange?.from, overviewComputerCacheKey]);

  // Fetch stats from Python analytics API
  useEffect(() => {
    const fetchStats = async () => {
      if (!habits.length) return;
      if (!dateRange?.from && hasInitialOverviewStats && !skippedInitialStatsFetchRef.current) {
        skippedInitialStatsFetchRef.current = true;
        setStatsResolved(true);
        return;
      }

      const stopTimer = startPerfTimer('overview-view', 'fetch-stats', {
        habit_count: habits.length,
        has_date_range: Boolean(dateRange?.from),
      });
      try {
        setStatsResolved(false);
        setStatsLoading(true);
        const token = await getToken();
        if (!token) {
          stopTimer({ skipped: 'missing-token' });
          return;
        }

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

        const result = await Sentry.startSpan(
          {
            name: 'overview.fetch_habit_stats',
            op: 'ui.load',
            attributes: {
              habit_count: habits.length,
              has_date_range: Boolean(dateRange?.from),
              days_back: params.daysBack ?? 0,
            },
          },
          async () => analyticsApi.getHabitStats(token, params),
        );

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

          stopTimer({
            success: true,
            stats_count: result.habits.length,
            cache_written: !dateRange?.from,
          });
        } else {
          stopTimer({ success: false, reason: 'empty-result' });
        }
      } catch (error) {
        perfError('overview-view', 'fetch-stats-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        stopTimer({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setStatsLoading(false);
        setStatsResolved(true);
      }
    };

    fetchStats();
  }, [dateRange, getToken, habitLogs.length, habits, hasInitialOverviewStats]);

  useEffect(() => {
    if (!userLoaded || !isSignedIn || !user) return;

    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let deferredDailyTimer: number | null = null;

    const fetchComputerActivity = async () => {
      const stopTimer = startPerfTimer('overview-view', 'fetch-computer-activity', {
        has_date_range: Boolean(dateRange?.from),
      });
      try {
        setComputerActivityResolved(false);
        const now = new Date();
        // When "All time" (dateRange undefined), use 3-year range like habit stats
        let startDate: string;
        let endDate: string;
        if (dateRange?.from) {
          startDate = format(dateRange.from, 'yyyy-MM-dd');
          endDate = format(dateRange.to ?? dateRange.from, 'yyyy-MM-dd');
          const rows = await Sentry.startSpan(
            {
              name: 'overview.fetch_computer_time_daily',
              op: 'ui.load',
              attributes: {
                start_date: startDate,
                end_date: endDate,
                mode: 'range',
              },
            },
            async () => getComputerTimeDaily({
              startDate,
              endDate,
            }),
          );
          if (controller.signal.aborted) return;
          const normalizedRows = Array.isArray(rows) ? rows : [];
          const hasMeaningfulRows = normalizedRows.some((row) => Number(row.active_ms || 0) > 0);

          const rowsToPersist = hasMeaningfulRows
            ? normalizedRows
            : (lastGoodComputerActivityRef.current.length > 0 ? lastGoodComputerActivityRef.current : normalizedRows);

          if (hasMeaningfulRows || computerActivityDaily.length === 0) {
            setComputerActivityDaily(normalizedRows);
          }

          if (hasMeaningfulRows) {
            lastGoodComputerActivityRef.current = normalizedRows;
          }

          setComputerActivitySummary({
            total_active_ms: normalizedRows.reduce((sum, row) => sum + Number(row.active_ms || 0), 0),
            total_hours: normalizedRows.reduce((sum, row) => sum + Number(row.active_hours || 0), 0),
            total_events: normalizedRows.reduce((sum, row) => sum + Number(row.events_count || 0), 0),
            days_tracked: normalizedRows.filter((row) => Number(row.active_ms || 0) > 0).length,
          })

          if (typeof window !== 'undefined' && overviewComputerCacheKey) {
            window.localStorage.setItem(
              overviewComputerCacheKey,
              JSON.stringify({
                timestamp: Date.now(),
                rows: rowsToPersist,
              }),
            );
          }
          stopTimer({
            success: true,
            mode: 'daily-range',
            row_count: normalizedRows.length,
            meaningful_rows: hasMeaningfulRows,
            used_last_good_rows: !hasMeaningfulRows && rowsToPersist.length > 0,
          });
          return;
        } else {
          startDate = format(subDays(now, 1095), 'yyyy-MM-dd');
          endDate = format(now, 'yyyy-MM-dd');
        }

        if (isDesktopShell) {
          const hasComputerHabit = habits.some((habit) => isComputerHabitName(habit.name));
          if (!dateRange?.from && hasComputerHabit) {
            if (bootstrappedComputerActivitySummary) {
              setComputerActivitySummary(bootstrappedComputerActivitySummary);
            }
            perfInfo('overview-view', 'computer-summary-bootstrap-used', {
              used_cached_summary: Boolean(bootstrappedComputerActivitySummary),
            });
          }
        }

        const summary = await Sentry.startSpan(
          {
            name: 'overview.fetch_computer_time_summary',
            op: 'ui.load',
            attributes: {
              start_date: startDate,
              end_date: endDate,
              mode: dateRange?.from ? 'range' : 'all-time',
            },
          },
          async () => getComputerTimeSummary({
            startDate,
            endDate,
          }),
        );
        if (controller.signal.aborted) return;
        setComputerActivitySummary({
          total_active_ms: Number(summary.total_active_ms || 0),
          total_hours: Number(summary.total_hours || 0),
          total_events: Number(summary.total_events || 0),
          days_tracked: Number(summary.days_tracked || 0),
          avg_daily_hours: Number(summary.avg_daily_hours || 0),
        })

        if (typeof window !== 'undefined' && overviewComputerCacheKey) {
          window.localStorage.setItem(
            `${overviewComputerCacheKey}:summary`,
            JSON.stringify({
              timestamp: Date.now(),
              summary: {
                total_active_ms: Number(summary.total_active_ms || 0),
                total_hours: Number(summary.total_hours || 0),
                total_events: Number(summary.total_events || 0),
                days_tracked: Number(summary.days_tracked || 0),
                avg_daily_hours: Number(summary.avg_daily_hours || 0),
              },
            }),
          );
        }

        const existingRows =
          lastGoodComputerActivityRef.current.length > 0
            ? lastGoodComputerActivityRef.current
            : bootstrappedComputerActivityDaily
        if (existingRows.length > 0) {
          setComputerActivityDaily(existingRows)
        }

        if (isDesktopShell) {
          stopTimer({
            success: true,
            mode: 'summary-only-desktop',
            total_active_ms: Number(summary.total_active_ms || 0),
          });
          return;
        }

        deferredDailyTimer = window.setTimeout(async () => {
          if (controller.signal.aborted) return
          try {
            const rows = await Sentry.startSpan(
              {
                name: 'overview.fetch_computer_time_daily_deferred',
                op: 'ui.load',
                attributes: {
                  start_date: startDate,
                  end_date: endDate,
                  mode: 'deferred-all-time',
                },
              },
              async () => getComputerTimeDaily({ startDate, endDate }),
            )
            if (controller.signal.aborted) return
            const normalizedRows = Array.isArray(rows) ? rows : []
            const hasMeaningfulRows = normalizedRows.some((row) => Number(row.active_ms || 0) > 0)
            if (!hasMeaningfulRows) return
            lastGoodComputerActivityRef.current = normalizedRows
            setComputerActivityDaily(normalizedRows)
            if (typeof window !== 'undefined' && overviewComputerCacheKey) {
              window.localStorage.setItem(
                overviewComputerCacheKey,
                JSON.stringify({
                  timestamp: Date.now(),
                  rows: normalizedRows,
                }),
              )
            }
            perfInfo('overview-view', 'deferred-computer-daily-loaded', {
              row_count: normalizedRows.length,
            })
          } catch (dailyError) {
            if (!controller.signal.aborted) {
              perfError('overview-view', 'deferred-computer-daily-failed', {
                error: dailyError instanceof Error ? dailyError.message : String(dailyError),
              })
            }
          }
        }, 800)

        stopTimer({
          success: true,
          mode: 'summary-first',
          total_active_ms: Number(summary.total_active_ms || 0),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        perfError('overview-view', 'fetch-computer-activity-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        stopTimer({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!controller.signal.aborted) {
          setComputerActivityResolved(true);
        }
      }
    };

    fetchComputerActivity();
    if (!dateRange?.from) {
      refreshTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          return;
        }
        void fetchComputerActivity();
      }, isDesktopShell ? 5 * 60_000 : 60_000);
    }
    return () => {
      controller.abort();
      if (deferredDailyTimer) {
        clearTimeout(deferredDailyTimer);
      }
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
    };
  }, [bootstrappedComputerActivityDaily, bootstrappedComputerActivitySummary, computerActivityDaily.length, dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), habits, isDesktopShell, overviewComputerCacheKey, userLoaded, isSignedIn, user]);

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

  useEffect(() => {
    if (!user || !isBackendUnavailable) return;

    const retryTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      fetchHabits();
      fetchHabitLogs();
    }, 30_000);

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
      const total = values.reduce((sum, value) => sum + value, 0);
      const average = values.length ? total / values.length : 0;
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      const variance = values.length
        ? values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / values.length
        : 0;

      return {
        display: formatMetricDisplay(totalValue, unitLabel),
        stats: {
          unitLabel,
          sumFormatted: `${formatHabitStatNumber(total)} ${unitLabel}`,
          avgFormatted: `${formatHabitStatNumber(average)} ${unitLabel}`,
          minFormatted: `${formatHabitStatNumber(min)} ${unitLabel}`,
          maxFormatted: `${formatHabitStatNumber(max)} ${unitLabel}`,
          stdDevFormatted: `${formatHabitStatNumber(Math.sqrt(variance))} ${unitLabel}`,
          daysWithData: values.filter((value) => value > 0).length,
        },
      };
    };

        for (const habit of habitsForMetrics) {
          const habitId = habit.id || '';
          if (!habitId) continue;

      if (isComputerHabitName(habit.name)) {
        const rows = effectiveComputerActivityDaily;
        const totalHours = !dateRange?.from && computerActivitySummary
          ? Number(computerActivitySummary.total_hours || 0)
          : rows.reduce((sum, row) => sum + Number(row.active_hours || 0), 0);

        if (rows.length === 0 && computerActivitySummary) {
          next.set(habitId, {
            display: `${formatHabitStatNumber(totalHours)} Hours`,
            stats: {
              unitLabel: 'Hours',
              sumFormatted: `${formatHabitStatNumber(Number(computerActivitySummary.total_hours || 0))} Hours`,
              avgFormatted: `${formatHabitStatNumber(Number(computerActivitySummary.avg_daily_hours || 0))} Hours`,
              minFormatted: '—',
              maxFormatted: '—',
              stdDevFormatted: '—',
              daysWithData: Number(computerActivitySummary.days_tracked || 0),
            },
          });
          continue;
        }

        const values = rows
          .map((row) => Number(row.active_hours || 0))
          .filter((value) => Number.isFinite(value) && value >= 0);
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
          },
        });
        continue;
      }

      const stats = effectiveCachedStats[habitId];
      if (stats) {
        const unitLabel = stats.unit || habit.unit_type || 'sessions';
        next.set(habitId, {
          display: formatMetricDisplay(Number(stats.total || 0), unitLabel),
          stats: {
            unitLabel,
            sumFormatted: `${formatHabitStatNumber(stats.total)} ${unitLabel}`,
            avgFormatted: `${formatHabitStatNumber(stats.average)} ${unitLabel}`,
            minFormatted: `${formatHabitStatNumber(stats.min)} ${unitLabel}`,
            maxFormatted: `${formatHabitStatNumber(stats.max)} ${unitLabel}`,
            stdDevFormatted: `${formatHabitStatNumber(stats.std_dev || Math.sqrt(stats.variance || 0))} ${unitLabel}`,
            daysWithData: stats.days_with_data,
          },
        });
        continue;
      }

          next.set(habitId, buildLocalMetricData(habit, metricEntriesByHabitId.get(habitId) || []));
        }

        return next;
      },
    );
  }, [
    habits,
    orderedHabits,
    computerActivitySummary,
    dateRange?.from?.toISOString(),
    effectiveCachedStats,
    effectiveComputerActivityDaily,
    formatHabitStatNumber,
    isSleepLikeHabit,
    metricEntriesByHabitId,
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
      return `${formatMetricAmount(previewValue, unitType)} ${unitType}`;
    }

    return habitMetricDataById.get(habit.id || '')?.display || `0 ${unitType}`;
  }, [computerActivityByDay, formatHabitStatNumber, habitMetricDataById, scrubberHoveredDate]);

  const getHabitMetricDisplayRef = useRef(getHabitMetricDisplay);
  getHabitMetricDisplayRef.current = getHabitMetricDisplay;

  const getHabitMetricDisplayStable = useCallback(
    (habit: Habit, previewValue?: number | null): string => getHabitMetricDisplayRef.current(habit, previewValue),
    [],
  );

  const getHabitMetricClassName = useCallback(() => 'text-gray-900', []);

  const getHabitMetricStats = useCallback((habit: Habit) => {
    const unitLabel = habit.unit_type || 'sessions';
    return habitMetricDataById.get(habit.id || '')?.stats || {
      unitLabel,
      sumFormatted: `0 ${unitLabel}`,
      avgFormatted: `0 ${unitLabel}`,
      minFormatted: `0 ${unitLabel}`,
      maxFormatted: `0 ${unitLabel}`,
      stdDevFormatted: `0 ${unitLabel}`,
      daysWithData: 0,
    };
  }, [habitMetricDataById]);

  const getHabitMetricStatsRef = useRef(getHabitMetricStats);
  getHabitMetricStatsRef.current = getHabitMetricStats;

  const getHabitMetricStatsStable = useCallback(
    (habit: Habit) => getHabitMetricStatsRef.current(habit),
    [],
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

  // Show spinner while loading
  if (isLoading || !isLoaded || !user) {
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
        getHabitMetricDisplay={getHabitMetricDisplayStable}
        getHabitMetricClassName={getHabitMetricClassName}
        scrubberHoveredDate={scrubberHoveredDate}
        scrubberHoveredValues={scrubberHoveredValues}
        activeTooltip={activeTooltip}
        setActiveTooltip={setActiveTooltip}
        getHabitMetricStats={getHabitMetricStatsStable}
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
