'use client';

import React from 'react';
import { Camera } from 'lucide-react';
import { format, parseISO, startOfDay, eachDayOfInterval } from 'date-fns';
import { habitToFinanceSeries } from '@/lib/charts/habitToFinanceSeries';
import { computeMeaningfulPercentChange } from '@/lib/analytics-change';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { ExpandedMetricCard } from '@/components/metrics/ExpandedMetricCard';
import type { RangeOption } from '@/components/metrics/RangeSegmentedControl';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import {
  COMPUTER_ACTIVITY_CARD_ID,
  CompareSelect,
  ComputerActivitySection,
  PerplexityExpandedHabitChart,
  getRangeDates,
  isSleepLikeHabit,
} from './metrics-view.shared';
import type { HabitData } from './metrics-view.shared';

export function MetricsExpandedSection(ctx: Record<string, any>) {
  const {
    availableHabits,
    captureExpandedChart,
    chartRef,
    compareHabitId,
    comparisonLogs,
    correlationData,
    dateRange,
    expandedHabit,
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
  } = ctx;

  const getHeartRateExpandedData = React.useCallback(() => {
    if (!heartRateExpandedSeries.length && !heartRateExpandedSummary) return null;

    const chartData = heartRateExpandedSeries
      .map((row: any) => {
        const date = parseISO(row.bucket_start);
        return {
          date: format(date, 'MMM d, yyyy h:mm a'),
          shortDate: format(date, 'MMM d'),
          value: Number(row.bpm_avg || 0),
          unit: 'bpm',
          samples: Number(row.sample_count || 0),
          rawDate: date,
        };
      })
      .sort((a: any, b: any) => a.rawDate.getTime() - b.rawDate.getTime());

    const values = chartData.map((d: any) => Number(d.value || 0)).filter((value: number) => Number.isFinite(value) && value > 0);
    const total = values.reduce((sum: number, value: number) => sum + value, 0);
    const average = values.length > 0
      ? total / values.length
      : Number(heartRateExpandedSummary?.current_avg_bpm || 0);
    const min = values.length > 0
      ? Math.min(...values)
      : Number(heartRateExpandedSummary?.min_bpm || 0);
    const max = values.length > 0
      ? Math.max(...values)
      : Number(heartRateExpandedSummary?.max_bpm || 0);

    const latestVal = values.length > 0 ? values[values.length - 1] : average;
    const prevVal = values.length > 1 ? values[values.length - 2] : Number(heartRateExpandedSummary?.previous_avg_bpm || 0);
    const change = computeMeaningfulPercentChange(latestVal, prevVal, 'bpm');
    const absoluteChange = latestVal - prevVal;

    return {
      chartData,
      average,
      min,
      max,
      totalSamples: Number(heartRateExpandedSummary?.total_samples || 0),
      buckets: chartData.length,
      daysWithData: Number(heartRateExpandedSummary?.days_with_data || 0),
      change,
      absoluteChange: Number.isFinite(absoluteChange) ? absoluteChange : 0,
    };
  }, [heartRateExpandedSeries, heartRateExpandedSummary]);

  // Get expanded data
  const getExpandedData = (habitId: string) => {
    const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
    if (!habit) return null;
    const isMainSleepHabit = isSleepLikeHabit(habit);

    const processLogsToMap = (logsSource: any[], unitType: any, useMaxPerDay = false) => {
      if (!logsSource || !logsSource.length) return { byDate: {}, logs: {} };

      const uniqueLogs = logsSource.reduce((acc: any[], log: any) => {
        const key = log.id || `${log.habit_id || ''}:${log.date || ''}`;
        const existingIndex = acc.findIndex((l: any) => (l.id || `${l.habit_id || ''}:${l.date || ''}`) === key);
        if (existingIndex >= 0) {
          if (log.metadata && log.metadata !== '{}' && (!acc[existingIndex].metadata || acc[existingIndex].metadata === '{}')) {
            acc[existingIndex] = log;
          }
        } else {
          acc.push(log);
        }
        return acc;
      }, []);

      const logsMap = uniqueLogs.reduce((acc: any, log: any) => {
        if (!acc[log.date]) acc[log.date] = [];
        acc[log.date].push(log);
        return acc;
      }, {});

      const valuesMap: Record<string, number> = {};
      const unit = (unitType || '').toString().toLowerCase();

      Object.keys(logsMap).forEach(dateStr => {
        let total = 0;
        const dayLogs = logsMap[dateStr];
        dayLogs.forEach((log: any) => {
          if (log.daily_value !== undefined && log.daily_value !== null) {
            const dailyValue = Number(log.daily_value || 0);
            total = useMaxPerDay ? Math.max(total, dailyValue) : total + dailyValue;
            return;
          }

          const duration = Number(log.duration || 0);
          const amount = Number(log.amount || 0);
          let nextValue = 0;

          if (unit.includes('hour')) {
            if (duration > 0) nextValue = duration / 3600;
            else if (amount > 0) nextValue = amount;
          } else if (unit.includes('minute')) {
            if (duration > 0) nextValue = duration / 60;
            else if (amount > 0) nextValue = amount;
          } else {
            nextValue = amount > 0 ? amount : (duration > 0 ? 1 : 0);
          }

          total = useMaxPerDay ? Math.max(total, nextValue) : total + nextValue;
        });
        valuesMap[dateStr] = total;
      });

      return { byDate: valuesMap, logs: logsMap };
    };

    const mainData = processLogsToMap(expandedLogs, habit.unit_type || (habit as any).unit, isMainSleepHabit);

    let compData = { byDate: {}, logs: {} };
    let compHabit: any = null;
    if (compareHabitId) {
      compHabit = availableHabits.find((h: HabitData) => h.habit_id === compareHabitId);
      if (compHabit) {
        compData = processLogsToMap(
          comparisonLogs,
          compHabit.unit_type || (compHabit as any).unit,
          isSleepLikeHabit(compHabit),
        );
      }
    }

    const rangeDates = hasCustomDateRange
      ? { from: dateRange!.from!, to: dateRange!.to! }
      : getRangeDates(expandedTimeRange);
    const allDatesInRange = eachDayOfInterval({ start: startOfDay(rangeDates.from), end: startOfDay(rangeDates.to) })
      .map(d => format(d, 'yyyy-MM-dd'));
    const dataDateSet = new Set([...Object.keys(mainData.byDate), ...Object.keys(compData.byDate)]);
    const allDates = isMainSleepHabit
      ? Array.from(dataDateSet).sort()
      : Array.from(new Set([...allDatesInRange, ...dataDateSet])).sort();

    const values = Object.values(mainData.byDate) as number[];
    const totalValue = values.reduce((a, b) => a + b, 0);
    const avgValue = values.length ? totalValue / values.length : 0;
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;
    const variance = values.length ? values.reduce((a, b) => a + Math.pow(b - avgValue, 2), 0) / values.length : 0;
    const stdDev = Math.sqrt(variance);

    const chartData = allDates.map(dateStr => {
      const date = parseISO(dateStr);
      const val = (mainData.byDate as any)[dateStr] || 0;
      const cVal = (compData.byDate as any)[dateStr];

      const dayLogs = (mainData.logs as any)[dateStr] || [];
      const logsWithMeta = dayLogs.filter((l: any) => l.metadata && l.metadata !== '{}');
      const logToUse = logsWithMeta.length > 0 ? logsWithMeta[0] : dayLogs[0];

      let metadata = {};
      if (logToUse && logToUse.metadata) {
        try {
          const meta = typeof logToUse.metadata === 'string' ? JSON.parse(logToUse.metadata) : logToUse.metadata;
          const sleepOnset = meta.sleep_onset || meta.sleepOnset || null;
          const sleepEnd = meta.sleep_end || meta.sleepEnd || null;
          if (sleepOnset) metadata = { ...metadata, sleepOnset };
          if (sleepEnd) metadata = { ...metadata, sleepEnd };
        } catch (e) { }
      }

      if (logToUse) {
        const sleepOnset = logToUse.sleep_onset || logToUse.sleepOnset || null;
        const sleepEnd = logToUse.sleep_end || logToUse.sleepEnd || null;
        if (sleepOnset) metadata = { ...metadata, sleepOnset };
        if (sleepEnd) metadata = { ...metadata, sleepEnd };
      }

      if (logToUse && logToUse.completed_at) {
        try {
          const dt = new Date(logToUse.completed_at);
          const h = dt.getHours();
          const m = dt.getMinutes();
          const ampm = h >= 12 ? 'pm' : 'am';
          metadata = { ...metadata, time: `${h % 12 || 12}:${m.toString().padStart(2, '0')}${ampm}` };
        } catch { }
      }

      return {
        date: format(date, 'MMM d, yyyy'),
        shortDate: format(date, 'MMM d'),
        value: val,
        compValue: cVal !== undefined ? cVal : null,
        unit: habit.unit_type || (habit as any).unit || '',
        compUnit: compHabit ? (compHabit.unit_type || (compHabit as any).unit || '') : '',
        ...metadata
      };
    });

    const enrichedChartData = chartData.map((point: any, index: number, arr: any[]) => {
      const prevValue = index > 0 ? arr[index - 1].value : point.value;
      return {
        ...point,
        upValue: point.value >= prevValue ? point.value : null,
        downValue: point.value < prevValue ? point.value : null,
      };
    });

    return {
      habit,
      compHabit,
      chartData: enrichedChartData,
      totalValue,
      avgValue,
      minValue,
      maxValue,
      stdDev
    };
  };



  if (!expandedHabit) return null;

  return (
    <div className="mx-auto mt-4 w-full max-w-[920px]">
      {expandedHabit === COMPUTER_ACTIVITY_CARD_ID ? (
        <ComputerActivitySection onClose={() => setExpandedHabit(null)} />
      ) : expandedHabitUsesGranularHeartRate ? (
        (() => {
          if (loadingExpandedLogs) {
            return (
              <div className="flex h-[400px] items-center justify-center rounded-xl border border-gray-100 bg-gray-50/30">
                <div className="text-center">
                  <BrailleSpinner className="mx-auto mb-2 text-2xl text-gray-400" />
                  <p className="text-[13px] text-gray-400">Loading metrics...</p>
                </div>
              </div>
            );
          }

          const expandedData = getHeartRateExpandedData();
          if (!expandedData) return null;
          const heartRateTitle = expandedHabitData?.habit_name || 'Heart Rate';

          const ranges: RangeOption[] = [
            { value: '1D', label: '1D' },
            { value: '5D', label: '5D' },
            { value: '1W', label: '1W' },
            { value: '1M', label: '1M' },
            { value: '6M', label: '6M' },
            { value: 'YTD', label: 'YTD' },
            { value: '1Y', label: '1Y' },
            { value: '5Y', label: '5Y' },
            { value: 'MAX', label: 'MAX' },
          ];
          const points = habitToFinanceSeries(expandedData.chartData);
          const firstPoint = points[0];
          const lastPoint = points[points.length - 1];
          const dateRangeText = hasCustomDateRange
            ? `${format(dateRange!.from!, 'MMM d, yyyy')} – ${format(dateRange!.to!, 'MMM d, yyyy')}`
            : (firstPoint && lastPoint
              ? `${format(new Date(firstPoint.t), 'MMM d, yyyy')} – ${format(new Date(lastPoint.t), 'MMM d, yyyy')}`
              : 'No data');
          const deltaDirection = expandedData.change === undefined
            ? 'neutral'
            : expandedData.change >= 0
              ? 'up'
              : 'down';
          const deltaValueText = `${expandedData.absoluteChange >= 0 ? '+' : ''}${expandedData.absoluteChange.toFixed(1)}`;
          const deltaPercentText = expandedData.change === undefined
            ? undefined
            : `${expandedData.change >= 0 ? '+' : ''}${expandedData.change.toFixed(2)}%`;
          const primaryValue = lastPoint
            ? Number(lastPoint.close).toFixed(0)
            : '--';

          const stats: Array<{ label: string; value: string }> = [
            { label: 'Average', value: `${expandedData.average.toFixed(1)} bpm` },
            { label: 'Min', value: `${expandedData.min.toFixed(0)} bpm` },
            { label: 'Max', value: `${expandedData.max.toFixed(0)} bpm` },
            { label: 'Samples', value: expandedData.totalSamples.toLocaleString() },
            { label: 'Days', value: String(expandedData.daysWithData || 0) },
          ];

          return (
            <div ref={exportCardRef}>
              <ExpandedMetricCard
                title={heartRateTitle}
                primaryValue={primaryValue}
                unit="bpm"
                deltaValue={deltaValueText}
                deltaPercent={deltaPercentText}
                deltaDirection={deltaDirection}
                dateRangeText={dateRangeText}
                rangePreset={expandedTimeRange}
                onRangePresetChange={(value) => setExpandedTimeRange(value as RangeKey)}
                rangeOptions={ranges}
                rangeLockedText={hasCustomDateRange ? 'Custom range' : undefined}
                actions={(
                  <button
                    type="button"
                    onClick={() => captureExpandedChart(heartRateTitle)}
                    disabled={isCapturing}
                    aria-label="Export chart image"
                    title="Export chart image"
                    className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[rgba(39,37,30,0.07)] bg-white text-[rgba(39,37,30,0.45)] transition-all duration-150 hover:bg-gray-50 hover:text-[#27251E] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset"
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                )}
                onClose={() => setExpandedHabit(null)}
              >
                <div ref={chartRef}>
                  <PerplexityExpandedHabitChart
                    points={points}
                    range={expandedTimeRange}
                    unit="bpm"
                    chartType="bar"
                    showGrid
                    higherIsBetter={false}
                  />
                </div>
              </ExpandedMetricCard>
            </div>
          );
        })()
      ) : loadingExpandedLogs ? (
        <div className="flex h-[400px] items-center justify-center">
          <div className="text-center">
            <BrailleSpinner className="mx-auto mb-2 text-2xl text-gray-600" />
            <p className="text-sm text-gray-500">Loading metrics...</p>
          </div>
        </div>
      ) : (() => {
        const expandedData = getExpandedData(expandedHabit);
        if (!expandedData) return null;

        const { habit, compHabit, chartData, totalValue, avgValue, minValue, maxValue, stdDev } = expandedData;
        const expandedCardData = getHabitCardData(expandedHabit);
        const ranges: RangeOption[] = [
          { value: '1D', label: '1D' },
          { value: '5D', label: '5D' },
          { value: '1W', label: '1W' },
          { value: '1M', label: '1M' },
          { value: '6M', label: '6M' },
          { value: 'YTD', label: 'YTD' },
          { value: '1Y', label: '1Y' },
          { value: '5Y', label: '5Y' },
          { value: 'MAX', label: 'MAX' },
        ];
        const points = habitToFinanceSeries(chartData);
        const firstPoint = points[0];
        const lastPoint = points[points.length - 1];
        const dateRangeText = hasCustomDateRange
          ? `${format(dateRange!.from!, 'MMM d, yyyy')} – ${format(dateRange!.to!, 'MMM d, yyyy')}`
          : (firstPoint && lastPoint
            ? `${format(new Date(firstPoint.t), 'MMM d, yyyy')} – ${format(new Date(lastPoint.t), 'MMM d, yyyy')}`
            : 'No data');
        const deltaDirection = expandedCardData?.change === undefined
          ? 'neutral'
          : expandedCardData.change >= 0
            ? 'up'
            : 'down';
        const deltaValueText = expandedCardData?.absoluteChange === undefined
          ? undefined
          : `${expandedCardData.absoluteChange >= 0 ? '+' : ''}${expandedCardData.absoluteChange.toFixed(2)}`;
        const deltaPercentText = expandedCardData?.change === undefined
          ? undefined
          : `${expandedCardData.change >= 0 ? '+' : ''}${expandedCardData.change.toFixed(2)}%`;
        const primaryValue = lastPoint
          ? Number(lastPoint.close).toFixed(Number(lastPoint.close) < 10 ? 2 : 0)
          : '--';

        const compareOptions = filteredHabits
          .filter((h: any) => h.habit_id !== expandedHabit)
          .map((h: any) => ({ label: h.habit_name, value: h.habit_id }));

        const stats: Array<{ label: string; value: string }> = [
          { label: 'Total', value: totalValue.toFixed(1) },
          { label: 'Average', value: avgValue.toFixed(1) },
          { label: 'Min', value: minValue.toFixed(1) },
          { label: 'Max', value: maxValue.toFixed(1) },
          { label: 'Std Dev', value: stdDev.toFixed(1) },
        ];

        if (compHabit) {
          stats.push({
            label: 'Correlation',
            value: loadingCorrelation ? '...' : (correlationData?.correlation?.coefficient?.toFixed(2) ?? 'N/A'),
          });
        }

        return (
          <div ref={exportCardRef}>
            <ExpandedMetricCard
              title={habit.habit_name}
              primaryValue={primaryValue}
              unit={habit.unit_type || (habit as any).unit || ''}
              deltaValue={deltaValueText}
              deltaPercent={deltaPercentText}
              deltaDirection={deltaDirection}
              higherIsBetter={expandedCardData?.higherIsBetter}
              dateRangeText={dateRangeText}
              rangePreset={expandedTimeRange}
              onRangePresetChange={(value) => setExpandedTimeRange(value as RangeKey)}
              rangeOptions={ranges}
              rangeLockedText={hasCustomDateRange ? 'Custom range' : undefined}
              compareControl={(
                <CompareSelect
                  value={compareHabitId}
                  options={compareOptions}
                  onChange={(val) => setCompareHabitId(val)}
                  placeholder="None"
                />
              )}
              actions={(
                <button
                  type="button"
                  onClick={() => captureExpandedChart(habit.habit_name)}
                  disabled={isCapturing}
                  aria-label="Export chart image"
                  title="Export chart image"
                  className="inline-flex h-[30px] w-[30px] items-center justify-center border border-[rgba(39,37,30,0.07)] bg-white text-[rgba(39,37,30,0.65)] transition-colors hover:bg-[rgba(39,37,30,0.02)] hover:text-[#27251E] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset"
                >
                  <Camera className="h-3.5 w-3.5" />
                </button>
              )}
              onClose={() => setExpandedHabit(null)}
              stats={stats}
              showStats
            >
              <div ref={chartRef}>
                <PerplexityExpandedHabitChart
                  points={points}
                  range={expandedTimeRange}
                  unit={habit.unit_type || (habit as any).unit || ''}
                  compareLabel={compHabit?.habit_name}
                  compareUnit={compHabit?.unit_type || (compHabit as any)?.unit || ''}
                  chartType="bar"
                  showGrid
                  higherIsBetter={expandedCardData?.higherIsBetter}
                />
              </div>
            </ExpandedMetricCard>
          </div>
        );
      })()}
    </div>
  );
}
