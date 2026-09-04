'use client';

import { useMemo } from 'react';
import { useUser, useAuth } from '@/lib/desktop-session';
import { useQuery } from '@tanstack/react-query';
import { subDays } from 'date-fns';
import { apiOperationWithAuth } from '@/lib/api/client';
import { useHabits, type Habit, type HabitLog } from '@/contexts/HabitsContext';
import { useComputerSnapshotQuery } from '@/hooks/use-computer-snapshot-query';
import { getHabitLogLocalDate as resolveHabitLogLocalDate } from '@/lib/habit-log-time';
import { getHabitDisplayName } from '@/lib/computer-time-habit';
import type { WearableDailyTotal } from '@/lib/wearables-dashboard';

/** Metric type keys that represent sleep duration, in preference order. */
const SLEEP_METRIC_TYPES = ['sleep_duration', 'sleep_total', 'sleep', 'in_bed'];

export interface OverviewWidgetMetrics {
  today: {
    logCount: number;
    topHabitName: string | null;
  };
  week: {
    thisWeekCount: number;
    lastWeekCount: number;
    /** Null when lastWeekCount is 0 (percent change undefined). */
    deltaPct: number | null;
    /** Log counts for the past 7 days, oldest to newest. Always 7 entries. */
    dailyCounts: number[];
  };
  streak: {
    days: number;
  };
  mostTracked: {
    habitName: string | null;
    count: number;
  };
  sleep: {
    lastNightHours: number | null;
    sevenDayAvgHours: number | null;
    /** 7-day series in hours. Entries are 0 for days without data. */
    dailySeries: number[];
  };
  computerTime: {
    yesterdayHours: number | null;
    sevenDayHours: number | null;
    /** 7-day series in hours, oldest to newest. */
    dailySeries: number[];
  };
  isLoading: boolean;
}

function toLocalIsoDate(d: Date): string {
  // en-CA locale yields YYYY-MM-DD, matching HabitsContext's own usage.
  return d.toLocaleDateString('en-CA');
}

function getLogLocalDate(log: HabitLog, habit: Habit | undefined): string | null {
  return resolveHabitLogLocalDate({
    date: log.date,
    completed_at: log.completed_at,
    integration_source: habit?.integration_source,
    metric_type: habit?.metric_type,
    time_precision: log.time_precision,
  });
}

function computeCurrentStreak(dateSet: Set<string>, todayIso: string): number {
  // Start from today; if today has no log yet, grace-allow starting from yesterday.
  const cursor = new Date(`${todayIso}T00:00:00`);
  if (!dateSet.has(todayIso)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  for (let i = 0; i < 400; i += 1) {
    const iso = toLocalIsoDate(cursor);
    if (!dateSet.has(iso)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function pickSleepHours(metrics: WearableDailyTotal['metrics']): number | null {
  for (const metricType of SLEEP_METRIC_TYPES) {
    const metric = metrics?.[metricType];
    if (!metric) continue;
    const raw = Number(metric.value);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const unit = (metric.unit || '').toLowerCase();
    if (unit === 'seconds' || unit === 's') return raw / 3600;
    if (unit === 'minutes' || unit === 'min') return raw / 60;
    // Assume hours when unit is unknown/absent (already the canonical unit).
    return raw;
  }
  return null;
}

export function useOverviewWidgetMetrics(): OverviewWidgetMetrics {
  const { user } = useUser();
  const { getToken } = useAuth();
  const userId = user?.id ?? null;
  const { habits, habitLogs, isLoading: habitsLoading, isLoadingLogs } = useHabits();

  // Fixed 8-day window so we have yesterday + the last 7 days in one fetch.
  const computerRange = useMemo(() => {
    const today = new Date();
    return { from: subDays(today, 8), to: today };
  }, []);

  const computerSnapshot = useComputerSnapshotQuery({
    userId,
    dateRange: computerRange,
  });

  // Dedicated fixed-window sleep fetch. Keyed separately from the Overview's
  // main wearable query so the date picker below does not affect widget data.
  const sleepQuery = useQuery<WearableDailyTotal[]>({
    queryKey: ['overview-summary-sleep', userId],
    enabled: Boolean(userId),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const today = new Date();
      const payload = await apiOperationWithAuth(
        'get_wearable_daily_totals_api_wearables_daily_totals_get',
        getToken,
        {
          query: {
            start_date: toLocalIsoDate(subDays(today, 7)),
            end_date: toLocalIsoDate(today),
            metric_types: SLEEP_METRIC_TYPES.join(','),
          },
        },
        userId,
      );
      return Array.isArray(payload.days) ? (payload.days as WearableDailyTotal[]) : [];
    },
  });

  return useMemo<OverviewWidgetMetrics>(() => {
    const today = new Date();
    const todayIso = toLocalIsoDate(today);
    const yesterdayIso = toLocalIsoDate(subDays(today, 1));
    const sevenDaysAgoIso = toLocalIsoDate(subDays(today, 7));
    const fourteenDaysAgoIso = toLocalIsoDate(subDays(today, 14));

    const habitsById = new Map<string, Habit>();
    for (const habit of habits) {
      if (habit.id) habitsById.set(habit.id, habit);
    }

    // Build an ordered list of the last 7 day ISO strings (oldest -> newest)
    const last7DayIsos: string[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      last7DayIsos.push(toLocalIsoDate(subDays(today, i)));
    }
    const last7IndexByIso = new Map<string, number>();
    last7DayIsos.forEach((iso, idx) => last7IndexByIso.set(iso, idx));

    let todayLogCount = 0;
    const todayLogsByHabit = new Map<string, number>();
    let thisWeekCount = 0;
    const thisWeekByHabit = new Map<string, number>();
    let lastWeekCount = 0;
    const dateSet = new Set<string>();
    const weekDailyCounts = new Array<number>(7).fill(0);

    for (const log of habitLogs) {
      if (log.status !== 'completed') continue;
      const habit = log.habit_id ? habitsById.get(log.habit_id) : undefined;
      const localDate = getLogLocalDate(log, habit);
      if (!localDate) continue;
      dateSet.add(localDate);

      if (localDate === todayIso) {
        todayLogCount += 1;
        if (log.habit_id) {
          todayLogsByHabit.set(log.habit_id, (todayLogsByHabit.get(log.habit_id) || 0) + 1);
        }
      }

      // Last 7 days = todayIso, todayIso-1, ... , todayIso-6 → strictly greater than (today-7)
      const weekIdx = last7IndexByIso.get(localDate);
      if (weekIdx !== undefined) {
        thisWeekCount += 1;
        weekDailyCounts[weekIdx] += 1;
        if (log.habit_id) {
          thisWeekByHabit.set(log.habit_id, (thisWeekByHabit.get(log.habit_id) || 0) + 1);
        }
      } else if (localDate > fourteenDaysAgoIso && localDate <= sevenDaysAgoIso) {
        lastWeekCount += 1;
      }
    }

    // Top habit today
    let topHabitToday: { name: string; count: number } | null = null;
    for (const [habitId, count] of todayLogsByHabit) {
      if (!topHabitToday || count > topHabitToday.count) {
        const habit = habitsById.get(habitId);
        topHabitToday = {
          name: getHabitDisplayName(habit?.name) || 'Unknown',
          count,
        };
      }
    }

    // Most tracked in last 7 days
    let mostTracked: { name: string; count: number } | null = null;
    for (const [habitId, count] of thisWeekByHabit) {
      if (!mostTracked || count > mostTracked.count) {
        const habit = habitsById.get(habitId);
        mostTracked = {
          name: getHabitDisplayName(habit?.name) || 'Unknown',
          count,
        };
      }
    }

    const streakDays = computeCurrentStreak(dateSet, todayIso);

    const deltaPct =
      lastWeekCount > 0
        ? Math.round(((thisWeekCount - lastWeekCount) / lastWeekCount) * 100)
        : null;

    // Computer Time: filter the fixed-range snapshot's daily rows.
    let yesterdayHours: number | null = null;
    let computerSevenDayHours: number | null = null;
    const computerDailySeries = new Array<number>(7).fill(0);
    const computerDaily = computerSnapshot.data?.daily ?? [];
    if (computerDaily.length > 0) {
      let sum = 0;
      let touchedAnyDay = false;
      for (const row of computerDaily) {
        const day = row.day;
        if (!day) continue;
        const hours = Number(row.active_hours || 0);
        if (day === yesterdayIso) {
          yesterdayHours = hours;
          touchedAnyDay = true;
        }
        const idx = last7IndexByIso.get(day);
        if (idx !== undefined) {
          computerDailySeries[idx] = hours;
          sum += hours;
          touchedAnyDay = true;
        }
      }
      if (touchedAnyDay) {
        computerSevenDayHours = sum;
      }
    }

    // Sleep: latest day with valid sleep value + average over the window.
    const sleepDays = sleepQuery.data ?? [];
    const sleepDailySeries = new Array<number>(7).fill(0);
    let lastNightHours: number | null = null;
    let latestSleepDate = '';
    let sleepSum = 0;
    let sleepCount = 0;

    for (const day of sleepDays) {
      const hours = pickSleepHours(day.metrics);
      if (hours === null) continue;
      sleepSum += hours;
      sleepCount += 1;
      if (day.date && day.date > latestSleepDate) {
        latestSleepDate = day.date;
        lastNightHours = hours;
      }
      if (day.date) {
        const idx = last7IndexByIso.get(day.date);
        if (idx !== undefined) {
          sleepDailySeries[idx] = hours;
        }
      }
    }

    const sevenDayAvgHours = sleepCount > 0 ? sleepSum / sleepCount : null;

    return {
      today: {
        logCount: todayLogCount,
        topHabitName: topHabitToday?.name ?? null,
      },
      week: {
        thisWeekCount,
        lastWeekCount,
        deltaPct,
        dailyCounts: weekDailyCounts,
      },
      streak: { days: streakDays },
      mostTracked: {
        habitName: mostTracked?.name ?? null,
        count: mostTracked?.count ?? 0,
      },
      sleep: {
        lastNightHours,
        sevenDayAvgHours,
        dailySeries: sleepDailySeries,
      },
      computerTime: {
        yesterdayHours,
        sevenDayHours: computerSevenDayHours,
        dailySeries: computerDailySeries,
      },
      isLoading:
        habitsLoading ||
        isLoadingLogs ||
        computerSnapshot.isLoading ||
        sleepQuery.isLoading,
    };
  }, [
    habits,
    habitLogs,
    habitsLoading,
    isLoadingLogs,
    computerSnapshot.data,
    computerSnapshot.isLoading,
    sleepQuery.data,
    sleepQuery.isLoading,
  ]);
}
