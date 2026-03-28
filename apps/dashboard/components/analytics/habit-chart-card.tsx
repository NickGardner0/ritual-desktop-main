'use client';

import React, { useState, useMemo } from 'react';
import { parseISO, subDays, subMonths, subYears, startOfYear, format } from 'date-fns';
import { ExpandedMetricCard } from '@/components/metrics/ExpandedMetricCard';
import { PerplexityExpandedHabitChart } from '@/components/charts/PerplexityExpandedHabitChart';
import { habitToFinanceSeries } from '@/lib/charts/habitToFinanceSeries';
import { computeMeaningfulPercentChange } from '@/lib/analytics-change';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import type { RangeOption } from '@/components/metrics/RangeSegmentedControl';

interface HabitChartCardProps {
  habitName: string;
  unit: string;
  logs: any[];
  higherIsBetter?: boolean | null;
  change?: number;
  compact?: boolean;
  fixedRange?: RangeKey;
}

function formatDisplayValue(value: number): string {
  if (!Number.isFinite(value)) return '--';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (abs >= 100) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (abs >= 10) return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shouldUseAverageInRange(habitName: string, unit: string): boolean {
  const normalizedName = habitName.toLowerCase();
  const normalizedUnit = unit.toLowerCase();
  return normalizedName.includes('heart rate') || normalizedUnit.includes('bpm');
}

const RANGE_OPTIONS: RangeOption[] = [
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'MAX', label: 'MAX' },
];

function getRangeCutoff(range: RangeKey): Date {
  const now = new Date();
  switch (range) {
    case '1D': return subDays(now, 1);
    case '5D': return subDays(now, 5);
    case '1W': return subDays(now, 7);
    case '1M': return subMonths(now, 1);
    case '3M': return subMonths(now, 3);
    case '6M': return subMonths(now, 6);
    case 'YTD': return startOfYear(now);
    case '1Y': return subYears(now, 1);
    case '5Y': return subYears(now, 5);
    case 'ALL':
    case 'MAX':
    default: return new Date(0);
  }
}

export function HabitChartCard({
  habitName,
  unit,
  logs,
  higherIsBetter,
  change,
  compact = false,
  fixedRange,
}: HabitChartCardProps) {
  const [range, setRange] = useState<RangeKey>('1M');
  const effectiveRange = fixedRange ?? range;

  const { points, chartData, totalValue, avgValue, minValue, maxValue, stdDev, primaryValue, dateRangeText } = useMemo(() => {
    const cutoff = getRangeCutoff(effectiveRange);

    // Process logs into daily values
    const byDate: Record<string, number> = {};
    for (const log of logs) {
      if (!log.date) continue;
      const date = parseISO(log.date);
      if (date < cutoff) continue;
      const dateStr = log.date;
      const value = Number(log.daily_value ?? log.value ?? log.total_amount ?? log.amount ?? 0);
      byDate[dateStr] = (byDate[dateStr] || 0) + value;
    }

    const sortedDates = Object.keys(byDate).sort();
    const rawCd = sortedDates.map((d) => ({
      date: d,
      shortDate: format(parseISO(d), 'M/d'),
      value: byDate[d],
      rawDate: parseISO(d),
    }));

    // Cap extreme outliers for chart display so one bad log does not flatten the full month.
    const rawValues = rawCd.map((d) => d.value).filter((v) => v > 0);
    let outlierCap = Infinity;
    if (rawValues.length >= 3) {
      const sorted = [...rawValues].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const maxValue = sorted[sorted.length - 1];
      const secondHighest = sorted[sorted.length - 2] ?? maxValue;
      if (median > 0 && secondHighest > 0 && maxValue > median * 4 && maxValue > secondHighest * 3) {
        outlierCap = Math.max(secondHighest * 2, median * 3);
      }
    }

    const cd = rawCd.map((d) => ({
      ...d,
      value: Math.min(d.value, outlierCap),
    }));

    // Stats use raw (uncapped) values
    const values = rawCd.map((d) => d.value);
    const total = values.reduce((a, b) => a + b, 0);
    const avg = values.length > 0 ? total / values.length : 0;
    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const variance = values.length > 0
      ? values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length
      : 0;
    const sd = Math.sqrt(variance);

    const pts = habitToFinanceSeries(cd);
    const lastPt = pts[pts.length - 1];
    const firstPt = pts[0];
    const pv = lastPt ? Number(lastPt.close).toFixed(Number(lastPt.close) < 10 ? 2 : 0) : '--';
    const drt = firstPt && lastPt
      ? `${format(new Date(firstPt.t), 'MMM d, yyyy')} – ${format(new Date(lastPt.t), 'MMM d, yyyy')}`
      : '';

    return {
      points: pts,
      chartData: cd,
      totalValue: total,
      avgValue: avg,
      minValue: min,
      maxValue: max,
      stdDev: sd,
      primaryValue: pv,
      dateRangeText: drt,
    };
  }, [effectiveRange, logs]);

  // Compute % change for this specific range
  const useAverageInRange = shouldUseAverageInRange(habitName, unit);

  const rangeChange = useMemo(() => {
    if (points.length < 2) return undefined;
    const mid = Math.floor(points.length / 2);
    const firstHalf = points.slice(0, mid);
    const secondHalf = points.slice(mid);
    if (firstHalf.length === 0 || secondHalf.length === 0) return undefined;
    const firstAvg = firstHalf.reduce((s, p) => s + p.close, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, p) => s + p.close, 0) / secondHalf.length;
    return computeMeaningfulPercentChange(secondAvg, firstAvg, unit);
  }, [points, unit]);

  const deltaDirection = rangeChange === undefined ? 'neutral' : rangeChange >= 0 ? 'up' : 'down';
  const deltaPercentText = rangeChange === undefined
    ? 'New'
    : `${rangeChange >= 0 ? '+' : ''}${rangeChange.toFixed(2)}%`;

  const compactPrimaryValue = useAverageInRange ? avgValue : totalValue;
  const compactPrimaryLabel = useAverageInRange ? 'Average in range' : 'Total in range';
  const compactPrimaryText = formatDisplayValue(compactPrimaryValue);

  const stats = [
    { label: 'Total', value: totalValue.toFixed(1) },
    { label: 'Average', value: avgValue.toFixed(1) },
    { label: 'Min', value: minValue.toFixed(1) },
    { label: 'Max', value: maxValue.toFixed(1) },
    { label: 'Std Dev', value: stdDev.toFixed(1) },
  ];

  if (compact) {
    return (
      <div className="overflow-hidden rounded-xl border border-[rgba(39,37,30,0.08)] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <div className="flex items-start justify-between px-4 pt-3 pb-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[14px] font-medium tracking-[-0.3px] text-[#27251E]">
                {habitName}
              </h3>
              <span
                className={
                  deltaDirection === 'up'
                    ? 'text-[12px] font-medium tracking-[-0.2px] text-[#136A22]'
                    : deltaDirection === 'down'
                      ? 'text-[12px] font-medium tracking-[-0.2px] text-[#A23544]'
                      : 'text-[12px] font-medium tracking-[-0.2px] text-[rgba(39,37,30,0.5)]'
                }
              >
                {deltaDirection === 'up' ? '↗ ' : deltaDirection === 'down' ? '↘ ' : ''}
                {deltaPercentText}
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-[18px] font-medium leading-none tracking-[-0.3px] text-[#27251E] tabular-nums">
                {compactPrimaryText}
              </span>
              <span className="text-[12px] leading-none tracking-[-0.2px] text-[rgba(39,37,30,0.45)]">
                {unit}
              </span>
            </div>
            <p className="mt-1 text-[11px] tracking-[-0.1px] text-[rgba(39,37,30,0.45)]">
              {compactPrimaryLabel}
            </p>
            {dateRangeText ? (
              <p className="mt-0.5 text-[11px] tracking-[-0.1px] text-[rgba(39,37,30,0.4)]">
                {dateRangeText}
              </p>
            ) : null}
          </div>
        </div>
        <div className="px-3 pb-3">
          <PerplexityExpandedHabitChart
            points={points}
            range={effectiveRange}
            unit={unit}
            chartType="bar"
            showGrid
            higherIsBetter={higherIsBetter}
            height={170}
          />
        </div>
      </div>
    );
  }

  return (
    <ExpandedMetricCard
      title={habitName}
      primaryValue={primaryValue}
      unit={unit}
      deltaPercent={deltaPercentText}
      deltaDirection={deltaDirection}
      higherIsBetter={higherIsBetter}
      dateRangeText={dateRangeText}
      rangePreset={range}
      onRangePresetChange={(v) => setRange(v as RangeKey)}
      rangeOptions={RANGE_OPTIONS}
      stats={stats}
      showStats
    >
      <PerplexityExpandedHabitChart
        points={points}
        range={range}
        unit={unit}
        chartType="bar"
        showGrid
        higherIsBetter={higherIsBetter}
      />
    </ExpandedMetricCard>
  );
}
