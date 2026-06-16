'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, differenceInDays } from 'date-fns';
import { analyticsApi } from '@/lib/services/analytics-api';
import {
  getWearableMetricType,
  getWearableProviderForHabit,
  isWearableBackedHabit,
  type WearableSeriesPoint,
} from '@/lib/wearables-dashboard';
import {
  COMPUTER_ACTIVITY_CARD_ID,
  buildWearableMetricSeriesRows,
  getHeartRateBucket,
  getRangeDates,
  isSleepLikeHabit,
  type HabitData,
} from '../metrics-view.shared';
import { mapDailyBreakdownRows } from '@/components/analytics/metrics-derived';

export function useMetricsExpandedQueries(ctx: Record<string, any>) {
  const {
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
  } = ctx;

// Fetch correlation data via React Query
const correlationEnabled = Boolean(
  expandedHabit
  && compareHabitId
  && expandedHabit !== COMPUTER_ACTIVITY_CARD_ID
  && !expandedHabitUsesGranularHeartRate,
);

const correlationQuery = useQuery({
  queryKey: ['metrics-correlation', expandedHabit, compareHabitId],
  queryFn: async () => {
    const params = new URLSearchParams({
      habit1_id: String(expandedHabit),
      habit2_id: String(compareHabitId),
      days_back: '90',
    });
    const res = await fetch(`/api/analytics/correlation?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.success && data.data ? data.data : null;
  },
  enabled: correlationEnabled,
  staleTime: 60_000,
  refetchOnWindowFocus: false,
});

useEffect(() => {
  setLoadingCorrelation(correlationQuery.isFetching);
}, [correlationQuery.isFetching, setLoadingCorrelation]);

useEffect(() => {
  if (!correlationEnabled) {
    setCorrelationData(null);
    return;
  }
  setCorrelationData(correlationQuery.data ?? null);
}, [correlationEnabled, correlationQuery.data, setCorrelationData]);

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

      if (expandedHabitData && isWearableBackedHabit(expandedHabitData)) {
        const metricType = getWearableMetricType(expandedHabitData);
        if (metricType) {
          const params = new URLSearchParams({
            metric_type: metricType,
            start_time: `${startDate}T00:00:00Z`,
            end_time: `${endDate}T23:59:59Z`,
            resolution: 'daily',
            limit: '4000',
          });
          const provider = getWearableProviderForHabit(expandedHabitData);
          if (provider) {
            params.set('provider', provider);
          }

          const response = await fetch(`/api/wearables/series?${params.toString()}`);
          if (!response.ok) {
            throw new Error(`Failed to load wearable series (${response.status})`);
          }

          const payload = await response.json();
          setExpandedSyncContext({ source: 'wearables-series' });
          setExpandedLogs(buildWearableMetricSeriesRows(
            expandedHabitData,
            Array.isArray(payload?.points) ? (payload.points as WearableSeriesPoint[]) : [],
          ));
          return;
        }
      }

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
          // Run sleep-metadata enrichment on this path too so tooltips can
          // show sleep/wake times even when the Python breakdown's entries
          // don't include sleep_start/sleep_end directly.
          const enrichedRows = await enrichRowsWithSleepMetadata(
            rows,
            expandedHabit,
            startDate,
            endDate,
          );
          setExpandedLogs(enrichedRows);
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

      if (compareHabit && isWearableBackedHabit(compareHabit)) {
        const metricType = getWearableMetricType(compareHabit);
        if (metricType) {
          const params = new URLSearchParams({
            metric_type: metricType,
            start_time: `${startDate}T00:00:00Z`,
            end_time: `${endDate}T23:59:59Z`,
            resolution: 'daily',
            limit: '4000',
          });
          const provider = getWearableProviderForHabit(compareHabit);
          if (provider) {
            params.set('provider', provider);
          }

          const response = await fetch(`/api/wearables/series?${params.toString()}`);
          if (!response.ok) {
            throw new Error(`Failed to load wearable comparison series (${response.status})`);
          }

          const payload = await response.json();
          setComparisonLogs(buildWearableMetricSeriesRows(
            compareHabit,
            Array.isArray(payload?.points) ? (payload.points as WearableSeriesPoint[]) : [],
          ));
          return;
        }
      }

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
}, [
  compareHabitId,
  expandedTimeRange,
  expandedHabit,
  hasCustomDateRange,
  dateRange?.from?.toISOString(),
  dateRange?.to?.toISOString(),
  availableHabits,
  getToken,
]);

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

}

/** @deprecated Use useMetricsExpandedQueries */
export const useMetricsExpandedEffects = useMetricsExpandedQueries;
