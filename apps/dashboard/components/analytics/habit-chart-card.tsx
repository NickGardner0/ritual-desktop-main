'use client';

import React, { useState, useMemo } from 'react';
import { parseISO, subDays, subMonths, subYears, startOfYear, format } from 'date-fns';
import { ExpandedMetricCard } from '@/components/metrics/ExpandedMetricCard';
import { PerplexityExpandedHabitChart } from '@/components/charts/PerplexityExpandedHabitChart';
import { habitToFinanceSeries } from '@/lib/charts/habitToFinanceSeries';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import type { RangeOption } from '@/components/metrics/RangeSegmentedControl';

interface HabitChartCardProps {
  habitName: string;
  unit: string;
  logs: any[];
  higherIsBetter?: boolean | null;
  change?: number;
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

export function HabitChartCard({ habitName, unit, logs, higherIsBetter, change }: HabitChartCardProps) {
  const [range, setRange] = useState<RangeKey>('1M');

  const { points, chartData, totalValue, avgValue, minValue, maxValue, stdDev, primaryValue, dateRangeText } = useMemo(() => {
    const cutoff = getRangeCutoff(range);

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

    // Cap extreme outliers for chart display (>4x median → clip to 2x the next highest)
    const rawValues = rawCd.map((d) => d.value).filter((v) => v > 0);
    let outlierCap = Infinity;
    if (rawValues.length >= 3) {
      const sorted = [...rawValues].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      if (sorted[sorted.length - 1] > median * 4 && median > 0) {
        outlierCap = Math.max(p95 * 1.5, median * 3);
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
  }, [logs, range]);

  // Compute % change for this specific range
  const rangeChange = useMemo(() => {
    if (points.length < 2) return 0;
    const mid = Math.floor(points.length / 2);
    const firstHalf = points.slice(0, mid);
    const secondHalf = points.slice(mid);
    const firstAvg = firstHalf.reduce((s, p) => s + p.close, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, p) => s + p.close, 0) / secondHalf.length;
    if (firstAvg === 0) return secondAvg > 0 ? 100 : 0;
    return ((secondAvg - firstAvg) / firstAvg) * 100;
  }, [points]);

  const deltaDirection = rangeChange >= 0 ? 'up' : 'down';
  const deltaPercentText = `${rangeChange >= 0 ? '+' : ''}${rangeChange.toFixed(2)}%`;

  const stats = [
    { label: 'Total', value: totalValue.toFixed(1) },
    { label: 'Average', value: avgValue.toFixed(1) },
    { label: 'Min', value: minValue.toFixed(1) },
    { label: 'Max', value: maxValue.toFixed(1) },
    { label: 'Std Dev', value: stdDev.toFixed(1) },
  ];

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
