'use client';

import { useCallback, useMemo } from 'react';
import type { DateRange } from 'react-day-picker';
import { isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';
import type { Habit } from '@/contexts/HabitsContext';
import { isComputerTimeHabit } from '@/lib/computer-time-habit';
import { getHabitLogLocalDate as resolveHabitLogLocalDate } from '@/lib/habit-log-time';
import { useComputerSnapshotQuery } from '@/hooks/use-computer-snapshot-query';
import { isWearableBackedHabit } from '@/lib/wearables-dashboard';
import type {
  ComputerDailyResponseRow as ComputerDailyRow,
  ComputerSummaryResponse as ComputerSummaryState,
} from '@/lib/computerActivity';
import {
  buildComputerSummaryFromRows,
  calculateTrackedSpanDays,
  formatMetricDisplay,
  getComputerSummaryHours,
  getComputerUnavailableDisplay,
  type HabitMetricData,
  type MetricLogEntry,
} from '@/components/analytics/overview-view.helpers';


export type OverviewMetricsComputationInput = {
  habits: Habit[];
  orderedHabits: Habit[];
  dateRange: DateRange | undefined;
  displayLogs: any[];
  habitsById: Map<string, Habit>;
  effectiveCachedStats: Record<string, import('@/lib/services/analytics-api').HabitStats>;
  effectiveComputerActivityDaily: ComputerDailyRow[];
  effectiveComputerActivitySummary: ComputerSummaryState | null;
  computerSnapshotQuery: ReturnType<typeof useComputerSnapshotQuery>;
  computerSnapshotLooksEmpty: boolean;
  wearableMetricDataByHabitId: Map<string, HabitMetricData>;
  wearableDailyTotalsQuery: { isLoading: boolean; isFetching: boolean };
  isLoadingLogs: boolean;
  isOverviewSnapshotFetching: boolean;
  scrubberHoveredDate: string | null;
  traceSyncComputation: <T,>(name: string, attrs: Record<string, string | number | boolean>, fn: () => T) => T;
};

export function useOverviewHabitMetrics(input: OverviewMetricsComputationInput) {
  const {
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
  } = input;
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
  }, [dateRange, displayLogs, getLogLocalDate, traceSyncComputation]);

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
              aggregateValue = entry.amount;
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

        const buildPendingMetricData = (habit: Habit): HabitMetricData => {
          const unitLabel = habit.unit_type || 'sessions';
          return {
            display: '—',
            stats: {
              unitLabel,
              sumFormatted: '—',
              avgFormatted: '—',
              minFormatted: '—',
              maxFormatted: '—',
              stdDevFormatted: '—',
              daysWithData: 0,
              trackedDays: 0,
            },
          };
        };

        const buildUnavailableComputerMetricData = (display: string): HabitMetricData => ({
          display,
          stats: {
            unitLabel: 'Hours',
            sumFormatted: display,
            avgFormatted: '—',
            minFormatted: '—',
            maxFormatted: '—',
            stdDevFormatted: '—',
            daysWithData: 0,
            trackedDays: 0,
          },
        });

        for (const habit of habitsForMetrics) {
          const habitId = habit.id || '';
          if (!habitId) continue;

          if (isComputerTimeHabit(habit)) {
            const unavailableDisplay = getComputerUnavailableDisplay({
              state: computerSnapshotQuery.data?.state,
              emptyReason: computerSnapshotQuery.data?.emptyReason,
              looksEmpty: computerSnapshotLooksEmpty,
              isPlaceholder: computerSnapshotQuery.isPlaceholderData,
            });
            if (unavailableDisplay) {
              const display = unavailableDisplay;
              next.set(habitId, buildUnavailableComputerMetricData(display));
              continue;
            }

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
            const summaryForDisplay = !dateRange?.from
              ? effectiveComputerActivitySummary ?? rowsSummary
              : rowsSummary ?? effectiveComputerActivitySummary;
            const totalHours = summaryForDisplay
              ? getComputerSummaryHours(summaryForDisplay)
              : rows.reduce((sum, row) => sum + Number(row.active_hours || 0), 0);
            if (rows.length === 0 && effectiveComputerActivitySummary) {
              next.set(habitId, {
                display: `${formatHabitStatNumber(totalHours)} Hours`,
                stats: {
                  unitLabel: 'Hours',
                  sumFormatted: `${formatHabitStatNumber(getComputerSummaryHours(effectiveComputerActivitySummary))} Hours`,
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

          const entries = metricEntriesByHabitId.get(habitId) || [];
          if (
            entries.length === 0
            && (
              isLoadingLogs
              || isOverviewSnapshotFetching
              || (
                isWearableBackedHabit(habit)
                && (wearableDailyTotalsQuery.isLoading || wearableDailyTotalsQuery.isFetching)
              )
            )
          ) {
            next.set(habitId, buildPendingMetricData(habit));
            continue;
          }

          const localMetricData = buildLocalMetricData(habit, entries);

          // In ranged mode, derive the overview metrics directly from the locally
          // filtered logs so the list always respects the active date picker.
          if (dateRange?.from) {
            next.set(habitId, localMetricData);
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
    dateRange?.from,
    dateRange?.to,
    effectiveComputerActivitySummary,
    effectiveCachedStats,
    effectiveComputerActivityDaily,
    formatHabitStatNumber,
    isAverageDisplayMetric,
    isSleepLikeHabit,
    isLoadingLogs,
    isOverviewSnapshotFetching,
    metricEntriesByHabitId,
    filteredMetricLogEntries.length,
    wearableMetricDataByHabitId,
    wearableDailyTotalsQuery.isFetching,
    wearableDailyTotalsQuery.isLoading,
    computerSnapshotQuery.isPlaceholderData,
    computerSnapshotLooksEmpty,
    traceSyncComputation,
  ]);

  const getHabitMetricDisplay = useCallback((habit: Habit, previewValue?: number | null): string => {
    const unitType = habit.unit_type || 'sessions';

    if (isComputerTimeHabit(habit) && scrubberHoveredDate) {
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


  return {
    getHabitMetricDisplay,
    getHabitMetricClassName,
    getHabitMetricStats,
    habitMetricDataById,
    filteredMetricLogEntries,
    metricEntriesByHabitId,
    computerActivityByDay,
    getLogLocalDate,
    formatHabitStatNumber,
    isSleepLikeHabit,
    isAverageDisplayMetric,
  };
}
